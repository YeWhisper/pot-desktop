import { appWindow } from '@tauri-apps/api/window';
import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { warn } from 'tauri-plugin-log-api';
import React, { lazy, Suspense, useEffect } from 'react';
import { useTheme } from 'next-themes';

import { invoke } from '@tauri-apps/api/tauri';
import { store } from './utils/store';
import { useConfig } from './hooks';
import './style.css';
import './i18n';

const Translate = lazy(() => import('./window/Translate'));
const Screenshot = lazy(() => import('./window/Screenshot'));
const Recognize = lazy(() => import('./window/Recognize'));
const Config = lazy(() => import('./window/Config'));
const Updater = lazy(() => import('./window/Updater'));

const windowMap = {
    translate: <Translate />,
    screenshot: <Screenshot />,
    recognize: <Recognize />,
    config: <Config />,
    updater: <Updater />,
};

export default function App() {
    const [devMode] = useConfig('dev_mode', false);
    const [appTheme] = useConfig('app_theme', 'system');
    const [appLanguage] = useConfig('app_language', 'en');
    const [appFont] = useConfig('app_font', 'default');
    const [appFallbackFont] = useConfig('app_fallback_font', 'default');
    const [appFontSize] = useConfig('app_font_size', 16);
    const { setTheme } = useTheme();
    const { i18n } = useTranslation();

    useEffect(() => {
        store.load();
    }, []);

    useEffect(() => {
        const handleKeyDown = async (e) => {
            const allowKeys = ['c', 'v', 'x', 'a', 'z', 'y'];
            if (e.ctrlKey && !allowKeys.includes(e.key.toLowerCase())) {
                e.preventDefault();
            }
            if (devMode && e.key === 'F12') {
                await invoke('open_devtools');
            }
            if (e.key.startsWith('F') && e.key.length > 1) {
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                await appWindow.close();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [devMode]);

    useEffect(() => {
        if (appTheme !== null) {
            if (appTheme !== 'system') {
                setTheme(appTheme);
            } else {
                try {
                    const media = window.matchMedia('(prefers-color-scheme: dark)');
                    const updateTheme = (e) => setTheme(e.matches ? 'dark' : 'light');
                    updateTheme(media);
                    media.addEventListener('change', updateTheme);
                    return () => media.removeEventListener('change', updateTheme);
                } catch {
                    warn("Can't detect system theme.");
                }
            }
        }
    }, [appTheme]);

    useEffect(() => {
        if (appLanguage !== null) {
            i18n.changeLanguage(appLanguage);
        }
    }, [appLanguage]);

    useEffect(() => {
        if (appFont !== null && appFallbackFont !== null) {
            document.documentElement.style.fontFamily = `"${appFont === 'default' ? 'sans-serif' : appFont}","${
                appFallbackFont === 'default' ? 'sans-serif' : appFallbackFont
            }"`;
        }
        if (appFontSize !== null) {
            document.documentElement.style.fontSize = `${appFontSize}px`;
        }
    }, [appFont, appFallbackFont, appFontSize]);

    return (
        <BrowserRouter>
            <Suspense fallback={null}>{windowMap[appWindow.label]}</Suspense>
        </BrowserRouter>
    );
}
