import { useEffect } from 'react';
import { appWindow, currentMonitor, LogicalSize } from '@tauri-apps/api/window';
import { error as logError } from 'tauri-plugin-log-api';

export function useAutoFitWindow(contentRef, autoFitHeight, ready) {
    // 高度+宽度自适应内容
    useEffect(() => {
        if (autoFitHeight !== true) return;
        if (!contentRef.current) return;

        const HEADER = 34; // Compact header and paper border
        const MIN_HEIGHT = 136;
        const MIN_WIDTH = 256;
        const MAX_WIDTH = 288;
        const SCREEN_MARGIN = 80;
        const H_PADDING = 28; // Paper padding and border
        let raf = null;
        let lastH = 0;
        let lastW = 0;
        let measureCanvas = null;
        const textMeasurements = new WeakMap();
        let cachedMonitor = null;
        let monitorVersion = 0;
        let running = false;
        let pending = false;
        let disposed = false;

        const measureMaxTextWidth = (root) => {
            if (!measureCanvas) measureCanvas = document.createElement('canvas');
            const ctx = measureCanvas.getContext('2d');
            const rootStyle = getComputedStyle(root);
            const fontFamily = rootStyle.fontFamily || 'sans-serif';
            let maxW = 0;
            root.querySelectorAll('textarea').forEach((ta) => {
                const v = ta.value || '';
                if (!v) return;
                const taStyle = getComputedStyle(ta);
                const fontSize = parseFloat(taStyle.fontSize) || 16;
                const font = `${taStyle.fontWeight || 'normal'} ${fontSize}px ${taStyle.fontFamily || fontFamily}`;
                let measurement = textMeasurements.get(ta);
                if (!measurement || measurement.value !== v || measurement.font !== font) {
                    ctx.font = font;
                    let width = 0;
                    for (const line of v.split('\n')) {
                        width = Math.max(width, ctx.measureText(line).width);
                    }
                    measurement = { value: v, font, width };
                    textMeasurements.set(ta, measurement);
                }
                maxW = Math.max(maxW, measurement.width);
            });
            return maxW;
        };

        const apply = async () => {
            raf = null;
            if (disposed || appWindow.label !== 'translate' || !contentRef.current) return;
            running = true;
            pending = false;
            try {
                const version = monitorVersion;
                const monitor = cachedMonitor ?? (await currentMonitor());
                if (disposed || !monitor || !contentRef.current) return;
                if (version !== monitorVersion) {
                    pending = true;
                    return;
                }
                cachedMonitor = monitor;
                const contentH = contentRef.current.offsetHeight;
                const textMaxW = measureMaxTextWidth(contentRef.current);
                const factor = monitor.scaleFactor;
                const monitorLogicalH = monitor.size.height / factor;
                const monitorLogicalW = monitor.size.width / factor;
                const maxH = Math.max(MIN_HEIGHT, monitorLogicalH - SCREEN_MARGIN);
                const maxW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, monitorLogicalW - SCREEN_MARGIN));
                const targetH = Math.min(Math.max(HEADER + contentH, MIN_HEIGHT), maxH);
                const targetW = Math.min(Math.max(textMaxW + H_PADDING, MIN_WIDTH), maxW);
                if (Math.abs(targetH - lastH) < 2 && Math.abs(targetW - lastW) < 2) return;
                await appWindow.setSize(new LogicalSize(Math.round(targetW), Math.round(targetH)));
                lastH = targetH;
                lastW = targetW;
            } catch (e) {
                logError(`Auto-fit failed: ${e}`);
            } finally {
                running = false;
                if (pending) schedule();
            }
        };

        const schedule = () => {
            if (disposed) return;
            if (running) {
                pending = true;
                return;
            }
            if (raf !== null) return;
            raf = requestAnimationFrame(apply);
        };

        const invalidateMonitor = () => {
            cachedMonitor = null;
            monitorVersion++;
            schedule();
        };
        const unlisteners = [];
        for (const listener of [appWindow.onMoved(invalidateMonitor), appWindow.onScaleChanged(invalidateMonitor)]) {
            listener.then(
                (unlisten) => {
                    if (disposed) unlisten();
                    else unlisteners.push(unlisten);
                },
                (e) => logError(`Auto-fit listener failed: ${e}`)
            );
        }
        const observer = new ResizeObserver(schedule);
        observer.observe(contentRef.current);

        return () => {
            disposed = true;
            observer.disconnect();
            if (raf !== null) cancelAnimationFrame(raf);
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [autoFitHeight, ready]);
}
