import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';

export function useWindowPin(alwaysOnTop, closeOnBlur) {
    const [pinned, setPinned] = useState(false);

    useEffect(() => {
        if (alwaysOnTop !== null) setPinned(alwaysOnTop);
    }, [alwaysOnTop]);

    useEffect(() => {
        void appWindow.setAlwaysOnTop(pinned);
        if (!closeOnBlur || pinned) return;

        let timer;
        let disposed = false;
        const cancelClose = () => clearTimeout(timer);
        const listeners = [
            listen('tauri://blur', () => {
                cancelClose();
                // Windows emits blur before focus while dragging a window.
                timer = setTimeout(() => {
                    if (!disposed && appWindow.label === 'translate') void appWindow.close();
                }, 100);
            }),
            listen('tauri://focus', cancelClose),
            listen('tauri://move', cancelClose),
        ];
        return () => {
            disposed = true;
            cancelClose();
            listeners.forEach((listener) => listener.then((unlisten) => unlisten()));
        };
    }, [pinned, closeOnBlur]);

    return [pinned, setPinned];
}
