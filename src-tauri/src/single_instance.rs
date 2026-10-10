use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, HANDLE,
};
use windows::Win32::System::Threading::CreateMutexW;

// Keep the handle alive until process exit. Local scopes it to this login session.
pub struct InstanceGuard(HANDLE);

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn try_acquire(name: &str) -> Result<Option<InstanceGuard>, windows::core::Error> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    unsafe {
        match CreateMutexW(None, false, PCWSTR(name.as_ptr())) {
            Ok(handle) => {
                let exists = GetLastError() == ERROR_ALREADY_EXISTS;
                let guard = InstanceGuard(handle);
                if exists {
                    // Do not retain another process's handle while waiting for it to exit.
                    drop(guard);
                    Ok(None)
                } else {
                    Ok(Some(guard))
                }
            }
            // A normal launch cannot open an administrator instance's mutex.
            Err(error) if error.code() == ERROR_ACCESS_DENIED.to_hresult() => Ok(None),
            Err(error) => Err(error),
        }
    }
}

pub fn acquire(
    name: &str,
    timeout: Duration,
) -> Result<Option<InstanceGuard>, windows::core::Error> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(guard) = try_acquire(name)? {
            return Ok(Some(guard));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        // Restart (including elevation) launches the replacement before the old process exits.
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicates_and_releases_on_exit() {
        let name = format!("Local\\pot-test-{}-release", std::process::id());
        let first = acquire(&name, Duration::ZERO).unwrap().unwrap();
        assert!(acquire(&name, Duration::ZERO).unwrap().is_none());
        drop(first);
        assert!(acquire(&name, Duration::ZERO).unwrap().is_some());
    }

    #[test]
    fn allows_restart_after_previous_instance_exits() {
        let name = format!("Local\\pot-test-{}-restart", std::process::id());
        let other_name = name.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let previous = std::thread::spawn(move || {
            let _guard = acquire(&other_name, Duration::ZERO).unwrap().unwrap();
            tx.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(200));
        });
        rx.recv().unwrap();
        assert!(acquire(&name, Duration::from_secs(3)).unwrap().is_some());
        previous.join().unwrap();
    }

    #[test]
    fn rejects_another_process() {
        let name = format!("Local\\pot-test-{}-child", std::process::id());
        let _guard = acquire(&name, Duration::ZERO).unwrap().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "single_instance::tests::child_probe"])
            .env("POT_TEST_MUTEX", name)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    fn child_probe() {
        if let Ok(name) = std::env::var("POT_TEST_MUTEX") {
            assert!(acquire(&name, Duration::ZERO).unwrap().is_none());
        }
    }
}
