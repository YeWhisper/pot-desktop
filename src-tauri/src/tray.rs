use crate::clipboard::*;
use crate::config::{get, set};
use crate::window::config_window;
use crate::window::input_translate;
use crate::window::ocr_recognize;
use crate::window::ocr_translate;
use crate::window::updater_window;
use log::{info, warn};
use tauri::CustomMenuItem;
use tauri::GlobalShortcutManager;
use tauri::SystemTrayEvent;
use tauri::SystemTrayMenu;
use tauri::SystemTrayMenuItem;
use tauri::SystemTraySubmenu;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn update_tray(app_handle: tauri::AppHandle, mut language: String, mut copy_mode: String) {
    let tray_handle = app_handle.tray_handle();

    if language.is_empty() {
        language = match get("app_language") {
            Some(v) => v.as_str().unwrap().to_string(),
            None => {
                set("app_language", "en");
                "en".to_string()
            }
        };
    }
    if copy_mode.is_empty() {
        copy_mode = match get("translate_auto_copy") {
            Some(v) => v.as_str().unwrap().to_string(),
            None => {
                set("translate_auto_copy", "disable");
                "disable".to_string()
            }
        };
    }

    info!(
        "Update tray with language: {}, copy mode: {}",
        language, copy_mode
    );
    tray_handle
        .set_menu(match language.as_str() {
            "en" => tray_menu_en(),
            "zh_cn" => tray_menu_zh_cn(),
            "zh_tw" => tray_menu_zh_tw(),
            "ja" => tray_menu_ja(),
            "ko" => tray_menu_ko(),
            "fr" => tray_menu_fr(),
            "de" => tray_menu_de(),
            "ru" => tray_menu_ru(),
            "pt_br" => tray_menu_pt_br(),
            "fa" => tray_menu_fa(),
            "uk" => tray_menu_uk(),
            _ => tray_menu_en(),
        })
        .unwrap();
    #[cfg(not(target_os = "linux"))]
    tray_handle
        .set_tooltip(&format!("pot {}", app_handle.package_info().version))
        .unwrap();

    let enable_clipboard_monitor = match get("clipboard_monitor") {
        Some(v) => v.as_bool().unwrap(),
        None => {
            set("clipboard_monitor", false);
            false
        }
    };

    tray_handle
        .get_item("clipboard_monitor")
        .set_selected(enable_clipboard_monitor)
        .unwrap();

    let _ = tray_handle
        .get_item("admin_autostart")
        .set_selected(admin_autostart_enabled());

    match copy_mode.as_str() {
        "source" => tray_handle
            .get_item("copy_source")
            .set_selected(true)
            .unwrap(),
        "target" => tray_handle
            .get_item("copy_target")
            .set_selected(true)
            .unwrap(),
        "source_target" => tray_handle
            .get_item("copy_source_target")
            .set_selected(true)
            .unwrap(),
        "disable" => tray_handle
            .get_item("copy_disable")
            .set_selected(true)
            .unwrap(),
        _ => {}
    }
}

pub fn tray_event_handler<'a>(app: &'a AppHandle, event: SystemTrayEvent) {
    match event {
        #[cfg(target_os = "windows")]
        SystemTrayEvent::LeftClick { .. } => on_tray_click(),
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "input_translate" => on_input_translate_click(),
            "copy_source" => on_auto_copy_click(app, "source"),
            "clipboard_monitor" => on_clipboard_monitor_click(app),
            "copy_target" => on_auto_copy_click(app, "target"),
            "copy_source_target" => on_auto_copy_click(app, "source_target"),
            "copy_disable" => on_auto_copy_click(app, "disable"),
            "ocr_recognize" => on_ocr_recognize_click(),
            "ocr_translate" => on_ocr_translate_click(),
            "config" => on_config_click(),
            "check_update" => on_check_update_click(),
            "view_log" => on_view_log_click(app),
            "restart" => on_restart_click(app),
            "restart_as_admin" => on_restart_as_admin_click(app),
            "admin_autostart" => on_admin_autostart_click(app),
            "quit" => on_quit_click(app),
            _ => {}
        },
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn on_tray_click() {
    let event = match get("tray_click_event") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => {
            set("tray_click_event", "config");
            "config".to_string()
        }
    };
    match event.as_str() {
        "config" => config_window(),
        "translate" => input_translate(),
        "ocr_recognize" => ocr_recognize(),
        "ocr_translate" => ocr_translate(),
        "disable" => {}
        _ => config_window(),
    }
}
fn on_input_translate_click() {
    input_translate();
}
fn on_clipboard_monitor_click(app: &AppHandle) {
    let enable_clipboard_monitor = match get("clipboard_monitor") {
        Some(v) => v.as_bool().unwrap(),
        None => {
            set("clipboard_monitor", false);
            false
        }
    };
    let current = !enable_clipboard_monitor;
    // Update Config File
    set("clipboard_monitor", current);
    // Update State and Start Monitor
    let state = app.state::<ClipboardMonitorEnableWrapper>();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., &current.to_string());
    if current {
        start_clipboard_monitor(app.app_handle());
    }
    // Update Tray Menu Status
    app.tray_handle()
        .get_item("clipboard_monitor")
        .set_selected(current)
        .unwrap();
}
fn on_auto_copy_click(app: &AppHandle, mode: &str) {
    info!("Set copy mode to: {}", mode);
    set("translate_auto_copy", mode);
    app.emit_all("translate_auto_copy_changed", mode).unwrap();
    update_tray(app.app_handle(), "".to_string(), mode.to_string());
}
fn on_ocr_recognize_click() {
    ocr_recognize();
}
fn on_ocr_translate_click() {
    ocr_translate();
}

fn on_config_click() {
    config_window();
}

fn on_check_update_click() {
    updater_window();
}
fn on_view_log_click(app: &AppHandle) {
    use tauri::api::path::app_log_dir;
    let log_path = app_log_dir(&app.config()).unwrap();
    tauri::api::shell::open(&app.shell_scope(), log_path.to_str().unwrap(), None).unwrap();
}
fn on_restart_click(app: &AppHandle) {
    info!("============== Restart App ==============");
    app.restart();
}

#[cfg(target_os = "windows")]
pub fn is_elevated() -> bool {
    use std::mem::size_of;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        ok.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_elevated() -> bool {
    false
}

fn on_restart_as_admin_click(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        if is_elevated() {
            info!("restart_as_admin: already elevated, doing normal restart");
            app.restart();
            return;
        }
        let exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(e) => {
                warn!("restart_as_admin: current_exe failed: {}", e);
                return;
            }
        };
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let exe_wide: Vec<u16> = exe
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let verb: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(exe_wide.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW returns > 32 on success; SE_ERR_ACCESSDENIED (5) when UAC dismissed.
        if (result.0 as isize) > 32 {
            info!("restart_as_admin: elevated process launched, exiting current");
            let _ = app.global_shortcut_manager().unregister_all();
            app.exit(0);
        } else {
            warn!(
                "restart_as_admin: ShellExecuteW failed code={} (likely UAC dismissed)",
                result.0 as isize
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        warn!("restart_as_admin: not supported on this platform, doing normal restart");
        app.restart();
    }
}

const ADMIN_AUTOSTART_TASK: &str = "PotAppAdminAutostart";

#[tauri::command]
pub fn enable_normal_autostart(app: AppHandle) -> Result<(), String> {
    if admin_autostart_enabled() {
        return Err("Administrator autostart is already enabled. Disable it in the tray menu first.".to_string());
    }
    app.autolaunch().enable().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn admin_autostart_enabled() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("schtasks")
        .args(["/Query", "/TN", ADMIN_AUTOSTART_TASK])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn admin_autostart_enabled() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn set_admin_autostart(app: &AppHandle, enable: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    if enable {
        if !is_elevated() {
            return Err("pot is not elevated; click '以管理员身份重启' first".to_string());
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy().into_owned();
        let output = std::process::Command::new("schtasks")
            .args([
                "/Create",
                "/TN",
                ADMIN_AUTOSTART_TASK,
                "/TR",
                &format!("\"{}\"", exe_str),
                "/SC",
                "ONLOGON",
                "/RL",
                "HIGHEST",
                "/F",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "schtasks /Create failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        app.autolaunch().disable().map_err(|e| e.to_string())
    } else {
        let _ = std::process::Command::new("schtasks")
            .args(["/Delete", "/TN", ADMIN_AUTOSTART_TASK, "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn set_admin_autostart(_app: &AppHandle, _enable: bool) -> Result<(), String> {
    Err("admin autostart is Windows-only".to_string())
}

fn on_admin_autostart_click(app: &AppHandle) {
    let currently_enabled = admin_autostart_enabled();
    let target = !currently_enabled;
    match set_admin_autostart(app, target) {
        Ok(()) => {
            let actual = admin_autostart_enabled();
            info!("admin_autostart toggled to {} (verified={})", target, actual);
            let _ = app
                .tray_handle()
                .get_item("admin_autostart")
                .set_selected(actual);
        }
        Err(e) => {
            warn!("admin_autostart toggle failed: {}", e);
            let _ = app
                .tray_handle()
                .get_item("admin_autostart")
                .set_selected(currently_enabled);
        }
    }
}

fn on_quit_click(app: &AppHandle) {
    app.global_shortcut_manager().unregister_all().unwrap();
    info!("============== Quit App ==============");
    app.exit(0);
}

fn tray_menu_en() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Input Translate");
    let copy_source = CustomMenuItem::new("copy_source", "Source");
    let copy_target = CustomMenuItem::new("copy_target", "Target");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Clipboard Monitor");
    let copy_source_target = CustomMenuItem::new("copy_source_target", "Source+Target");
    let copy_disable = CustomMenuItem::new("copy_disable", "Disable");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "OCR Recognize");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "OCR Translate");
    let config = CustomMenuItem::new("config", "Config");
    let check_update = CustomMenuItem::new("check_update", "Check Update");
    let view_log = CustomMenuItem::new("view_log", "View Log");
    let restart = CustomMenuItem::new("restart", "Restart");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Restart as Administrator");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Auto-start as Administrator");
    let quit = CustomMenuItem::new("quit", "Quit");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Auto Copy",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_zh_cn() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "输入翻译");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "监听剪切板");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "译文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+译文");
    let copy_disable = CustomMenuItem::new("copy_disable", "关闭");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "文字识别");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "截图翻译");
    let config = CustomMenuItem::new("config", "偏好设置");
    let check_update = CustomMenuItem::new("check_update", "检查更新");
    let restart = CustomMenuItem::new("restart", "重启应用");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "以管理员身份重启");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "管理员开机自启");
    let view_log = CustomMenuItem::new("view_log", "查看日志");
    let quit = CustomMenuItem::new("quit", "退出");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自动复制",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_zh_tw() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "輸入翻譯");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "偵聽剪貼簿");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "譯文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+譯文");
    let copy_disable = CustomMenuItem::new("copy_disable", "關閉");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "文字識別");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "截圖翻譯");
    let config = CustomMenuItem::new("config", "偏好設定");
    let check_update = CustomMenuItem::new("check_update", "檢查更新");
    let restart = CustomMenuItem::new("restart", "重啓程式");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "以管理員身份重啓");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "管理員開機自啟");
    let view_log = CustomMenuItem::new("view_log", "查看日誌");
    let quit = CustomMenuItem::new("quit", "退出");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自動複製",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_ja() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "翻訳を入力");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "クリップボードを監視する");
    let copy_source = CustomMenuItem::new("copy_source", "原文");
    let copy_target = CustomMenuItem::new("copy_target", "訳文");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "原文+訳文");
    let copy_disable = CustomMenuItem::new("copy_disable", "閉じる");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "テキスト認識");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "スクリーンショットの翻訳");
    let config = CustomMenuItem::new("config", "プリファレンス設定");
    let check_update = CustomMenuItem::new("check_update", "更新を確認する");
    let restart = CustomMenuItem::new("restart", "アプリの再起動");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "管理者として再起動");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "管理者として自動起動");
    let view_log = CustomMenuItem::new("view_log", "ログを見る");
    let quit = CustomMenuItem::new("quit", "退出する");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "自動コピー",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_ko() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "입력 번역");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "감청 전단판");
    let copy_source = CustomMenuItem::new("copy_source", "원문");
    let copy_target = CustomMenuItem::new("copy_target", "번역문");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "원문+번역문");
    let copy_disable = CustomMenuItem::new("copy_disable", "닫기");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "문자인식");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "스크린샷 번역");
    let config = CustomMenuItem::new("config", "기본 설정");
    let check_update = CustomMenuItem::new("check_update", "업데이트 확인");
    let restart = CustomMenuItem::new("restart", "응용 프로그램 다시 시작");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "관리자 권한으로 다시 시작");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "관리자 권한으로 자동 시작");
    let view_log = CustomMenuItem::new("view_log", "로그 보기");
    let quit = CustomMenuItem::new("quit", "퇴출");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "자동 복사",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_fr() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Traduction d'entrée");
    let clipboard_monitor =
        CustomMenuItem::new("clipboard_monitor", "Surveiller le presse-papiers");
    let copy_source = CustomMenuItem::new("copy_source", "Source");
    let copy_target = CustomMenuItem::new("copy_target", "Cible");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Source+Cible");
    let copy_disable = CustomMenuItem::new("copy_disable", "Désactiver");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Reconnaissance de texte");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Traduction d'image");
    let config = CustomMenuItem::new("config", "Paramètres");
    let check_update = CustomMenuItem::new("check_update", "Vérifier les mises à jour");
    let restart = CustomMenuItem::new("restart", "Redémarrer l'application");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Redémarrer en tant qu'administrateur");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Démarrage auto en tant qu'administrateur");
    let view_log = CustomMenuItem::new("view_log", "Voir le journal");
    let quit = CustomMenuItem::new("quit", "Quitter");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Copier automatiquement",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}
fn tray_menu_de() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Eingabeübersetzung");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Zwischenablage überwachen");
    let copy_source = CustomMenuItem::new("copy_source", "Quelle");
    let copy_target = CustomMenuItem::new("copy_target", "Ziel");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Quelle+Ziel");
    let copy_disable = CustomMenuItem::new("copy_disable", "Deaktivieren");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Texterkennung");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Bildübersetzung");
    let config = CustomMenuItem::new("config", "Einstellungen");
    let check_update = CustomMenuItem::new("check_update", "Auf Updates prüfen");
    let restart = CustomMenuItem::new("restart", "Anwendung neu starten");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Als Administrator neu starten");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Als Administrator automatisch starten");
    let view_log = CustomMenuItem::new("view_log", "Protokoll anzeigen");
    let quit = CustomMenuItem::new("quit", "Beenden");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Automatisch kopieren",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_ru() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Ввод перевода");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Следить за буфером обмена");
    let copy_source = CustomMenuItem::new("copy_source", "Источник");
    let copy_target = CustomMenuItem::new("copy_target", "Цель");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Источник+Цель");
    let copy_disable = CustomMenuItem::new("copy_disable", "Отключить");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Распознавание текста");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Перевод изображения");
    let config = CustomMenuItem::new("config", "Настройки");
    let check_update = CustomMenuItem::new("check_update", "Проверить обновления");
    let restart = CustomMenuItem::new("restart", "Перезапустить приложение");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Перезапустить от имени администратора");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Автозапуск от имени администратора");
    let view_log = CustomMenuItem::new("view_log", "Просмотр журнала");
    let quit = CustomMenuItem::new("quit", "Выход");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Автоматическое копирование",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_fa() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "متن");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "گوش دادن به تخته برش");
    let copy_source = CustomMenuItem::new("copy_source", "منبع");
    let copy_target = CustomMenuItem::new("copy_target", "هدف");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "منبع + هدف");
    let copy_disable = CustomMenuItem::new("copy_disable", "متن");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "تشخیص متن");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "ترجمه عکس");
    let config = CustomMenuItem::new("config", "تنظیمات ترجیح");
    let check_update = CustomMenuItem::new("check_update", "بررسی بروزرسانی");
    let restart = CustomMenuItem::new("restart", "راه‌اندازی مجدد برنامه");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "راه‌اندازی مجدد به‌عنوان مدیر");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "اجرای خودکار به‌عنوان مدیر");
    let view_log = CustomMenuItem::new("view_log", "مشاهده گزارشات");
    let quit = CustomMenuItem::new("quit", "خروج");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "کپی خودکار",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_pt_br() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Traduzir Entrada");
    let clipboard_monitor =
        CustomMenuItem::new("clipboard_monitor", "Monitorando a área de transferência");
    let copy_source = CustomMenuItem::new("copy_source", "Origem");
    let copy_target = CustomMenuItem::new("copy_target", "Destino");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Origem+Destino");
    let copy_disable = CustomMenuItem::new("copy_disable", "Desabilitar");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Reconhecimento de Texto");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Tradução de Imagem");
    let config = CustomMenuItem::new("config", "Configurações");
    let check_update = CustomMenuItem::new("check_update", "Checar por Atualização");
    let restart = CustomMenuItem::new("restart", "Reiniciar aplicativo");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Reiniciar como administrador");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Iniciar automaticamente como administrador");
    let view_log = CustomMenuItem::new("view_log", "Exibir Registro");
    let quit = CustomMenuItem::new("quit", "Sair");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Copiar Automaticamente",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}

fn tray_menu_uk() -> tauri::SystemTrayMenu {
    let input_translate = CustomMenuItem::new("input_translate", "Введення перекладу");
    let clipboard_monitor = CustomMenuItem::new("clipboard_monitor", "Стежити за буфером обміну");
    let copy_source = CustomMenuItem::new("copy_source", "Джерело");
    let copy_target = CustomMenuItem::new("copy_target", "Мета");

    let copy_source_target = CustomMenuItem::new("copy_source_target", "Джерело+Мета");
    let copy_disable = CustomMenuItem::new("copy_disable", "Відключивши");
    let ocr_recognize = CustomMenuItem::new("ocr_recognize", "Розпізнавання тексту");
    let ocr_translate = CustomMenuItem::new("ocr_translate", "Переклад зображення");
    let config = CustomMenuItem::new("config", "Настройка");
    let check_update = CustomMenuItem::new("check_update", "Перевірити оновлення");
    let restart = CustomMenuItem::new("restart", "Перезапустити додаток");
    let restart_as_admin = CustomMenuItem::new("restart_as_admin", "Перезапустити від імені адміністратора");
    let admin_autostart = CustomMenuItem::new("admin_autostart", "Автозапуск від імені адміністратора");
    let view_log = CustomMenuItem::new("view_log", "Перегляд журналу");
    let quit = CustomMenuItem::new("quit", "Вихід");
    SystemTrayMenu::new()
        .add_item(input_translate)
        .add_item(clipboard_monitor)
        .add_submenu(SystemTraySubmenu::new(
            "Автоматичне копіювання",
            SystemTrayMenu::new()
                .add_item(copy_source)
                .add_item(copy_target)
                .add_item(copy_source_target)
                .add_native_item(SystemTrayMenuItem::Separator)
                .add_item(copy_disable),
        ))
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(ocr_recognize)
        .add_item(ocr_translate)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(config)
        .add_item(check_update)
        .add_item(view_log)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(restart)
        .add_item(restart_as_admin)
        .add_item(admin_autostart)
        .add_item(quit)
}
