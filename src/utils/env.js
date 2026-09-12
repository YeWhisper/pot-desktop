import { type, arch as archFn, version } from '@tauri-apps/api/os';
import { getVersion } from '@tauri-apps/api/app';

export let osType = '';
export let arch = '';
export let osVersion = '';
export let appVersion = '';

export async function initEnv() {
    [osType, arch, osVersion, appVersion] = await Promise.all([type(), archFn(), version(), getVersion()]);
}
