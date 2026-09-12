import { readDir, BaseDirectory, readTextFile, exists } from '@tauri-apps/api/fs';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { appWindow, currentMonitor, LogicalSize } from '@tauri-apps/api/window';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { Spacer, Button } from '@nextui-org/react';
import { AiFillCloseCircle } from 'react-icons/ai';
import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { BsPinFill } from 'react-icons/bs';

import LanguageArea from './components/LanguageArea';
import SourceArea from './components/SourceArea';
import TargetArea from './components/TargetArea';
import { isFirstEnabledService } from './service_order';
import { osType } from '../../utils/env';
import { useConfig } from '../../hooks';
import { store } from '../../utils/store';
import { info, error as logError } from 'tauri-plugin-log-api';

let blurTimeout = null;
let resizeTimeout = null;
let moveTimeout = null;

const listenBlur = () => {
    return listen('tauri://blur', () => {
        if (appWindow.label === 'translate') {
            if (blurTimeout) {
                clearTimeout(blurTimeout);
            }
            info('Blur');
            // 100ms后关闭窗口，因为在 windows 下拖动窗口时会先切换成 blur 再立即切换成 focus
            // 如果直接关闭将导致窗口无法拖动
            blurTimeout = setTimeout(async () => {
                info('Confirm Blur');
                await appWindow.close();
            }, 100);
        }
    });
};

let unlisten = listenBlur();
// 取消 blur 监听
const unlistenBlur = () => {
    unlisten.then((f) => {
        f();
    });
};

// 监听 focus 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://focus', () => {
    info('Focus');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});
// 监听 move 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://move', () => {
    info('Move');
    if (blurTimeout) {
        info('Cancel Close');
        clearTimeout(blurTimeout);
    }
});

export default function Translate() {
    const [closeOnBlur] = useConfig('translate_close_on_blur', true);
    const [alwaysOnTop] = useConfig('translate_always_on_top', false);
    const [windowPosition] = useConfig('translate_window_position', 'mouse');
    const [rememberWindowSize] = useConfig('translate_remember_window_size', false);
    const [autoFitHeight] = useConfig('translate_auto_fit_height', true);
    const [translateServiceInstanceList, setTranslateServiceInstanceList] = useConfig('translate_service_list', [
        'deepl',
        'bing',
        'lingva',
        'yandex',
        'google',
        'ecdict',
    ]);
    const [recognizeServiceInstanceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceInstanceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [collectionServiceInstanceList] = useConfig('collection_service_list', []);
    const [hideLanguage] = useConfig('hide_language', false);
    const [pined, setPined] = useState(false);
    const [pluginList, setPluginList] = useState(null);
    const [serviceInstanceConfigMap, setServiceInstanceConfigMap] = useState(null);
    const contentRef = useRef(null);
    const reorder = (list, startIndex, endIndex) => {
        const result = Array.from(list);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        return result;
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const items = reorder(translateServiceInstanceList, result.source.index, result.destination.index);
        setTranslateServiceInstanceList(items);
    };
    // 是否自动关闭窗口
    useEffect(() => {
        if (closeOnBlur !== null && !closeOnBlur) {
            unlistenBlur();
        }
    }, [closeOnBlur]);
    // 是否默认置顶
    useEffect(() => {
        if (alwaysOnTop !== null && alwaysOnTop) {
            appWindow.setAlwaysOnTop(true);
            unlistenBlur();
            setPined(true);
        }
    }, [alwaysOnTop]);
    // 保存窗口位置
    useEffect(() => {
        if (windowPosition !== null && windowPosition === 'pre_state') {
            const unlistenMove = listen('tauri://move', async () => {
                if (moveTimeout) {
                    clearTimeout(moveTimeout);
                }
                moveTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let position = await appWindow.outerPosition();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        position = position.toLogical(factor);
                        await store.set('translate_window_position_x', parseInt(position.x));
                        await store.set('translate_window_position_y', parseInt(position.y));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenMove.then((f) => {
                    f();
                });
            };
        }
    }, [windowPosition]);
    // 保存窗口大小
    useEffect(() => {
        if (rememberWindowSize !== null && rememberWindowSize) {
            const unlistenResize = listen('tauri://resize', async () => {
                if (resizeTimeout) {
                    clearTimeout(resizeTimeout);
                }
                resizeTimeout = setTimeout(async () => {
                    if (appWindow.label === 'translate') {
                        let size = await appWindow.outerSize();
                        const monitor = await currentMonitor();
                        const factor = monitor.scaleFactor;
                        size = size.toLogical(factor);
                        // 自适应开启时尺寸由内容决定，不持久化
                        if (autoFitHeight) return;
                        await store.set('translate_window_height', parseInt(size.height));
                        await store.set('translate_window_width', parseInt(size.width));
                        await store.save();
                    }
                }, 100);
            });
            return () => {
                unlistenResize.then((f) => {
                    f();
                });
            };
        }
    }, [rememberWindowSize, autoFitHeight]);

    // 高度+宽度自适应内容
    useEffect(() => {
        if (autoFitHeight !== true) return;
        if (!contentRef.current) return;

        const HEADER = osType === 'Linux' ? 37 : 35;
        const MIN_HEIGHT = 180;
        const MIN_WIDTH = 260;
        const MAX_WIDTH = 400;
        const SCREEN_MARGIN = 80;
        const H_PADDING = 32; // px-[8px] * 2 + scrollbar + border
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
                const font = `${fontSize}px ${taStyle.fontFamily || fontFamily}`;
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
    }, [autoFitHeight, pluginList, serviceInstanceConfigMap]);

    const loadPluginList = async () => {
        const serviceTypeList = ['translate', 'tts', 'recognize', 'collection'];
        let temp = {};
        for (const serviceType of serviceTypeList) {
            temp[serviceType] = {};
            if (await exists(`plugins/${serviceType}`, { dir: BaseDirectory.AppConfig })) {
                const plugins = await readDir(`plugins/${serviceType}`, { dir: BaseDirectory.AppConfig });
                for (const plugin of plugins) {
                    const infoStr = await readTextFile(`plugins/${serviceType}/${plugin.name}/info.json`, {
                        dir: BaseDirectory.AppConfig,
                    });
                    let pluginInfo = JSON.parse(infoStr);
                    if ('icon' in pluginInfo) {
                        const appConfigDirPath = await appConfigDir();
                        const iconPath = await join(
                            appConfigDirPath,
                            `/plugins/${serviceType}/${plugin.name}/${pluginInfo.icon}`
                        );
                        pluginInfo.icon = convertFileSrc(iconPath);
                    }
                    temp[serviceType][plugin.name] = pluginInfo;
                }
            }
        }
        setPluginList({ ...temp });
    };

    useEffect(() => {
        loadPluginList();
        if (!unlisten) {
            unlisten = listen('reload_plugin_list', loadPluginList);
        }
    }, []);

    const loadServiceInstanceConfigMap = async () => {
        const config = {};
        for (const serviceInstanceKey of translateServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of recognizeServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of ttsServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        for (const serviceInstanceKey of collectionServiceInstanceList) {
            config[serviceInstanceKey] = (await store.get(serviceInstanceKey)) ?? {};
        }
        setServiceInstanceConfigMap({ ...config });
    };
    useEffect(() => {
        if (
            translateServiceInstanceList !== null &&
            recognizeServiceInstanceList !== null &&
            ttsServiceInstanceList !== null &&
            collectionServiceInstanceList !== null
        ) {
            loadServiceInstanceConfigMap();
        }
    }, [
        translateServiceInstanceList,
        recognizeServiceInstanceList,
        ttsServiceInstanceList,
        collectionServiceInstanceList,
    ]);

    return (
        pluginList && (
            <div
                className={`bg-background h-screen w-screen ${
                    osType === 'Linux' && 'rounded-[10px] border-1 border-default-100'
                }`}
            >
                <div
                    className='fixed top-[5px] left-[5px] right-[5px] h-[30px]'
                    data-tauri-drag-region='true'
                />
                <div className={`h-[35px] w-full flex ${osType === 'Darwin' ? 'justify-end' : 'justify-between'}`}>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='flat'
                        disableAnimation
                        className='my-auto bg-transparent'
                        onPress={() => {
                            if (pined) {
                                if (closeOnBlur) {
                                    unlisten = listenBlur();
                                }
                                appWindow.setAlwaysOnTop(false);
                            } else {
                                unlistenBlur();
                                appWindow.setAlwaysOnTop(true);
                            }
                            setPined(!pined);
                        }}
                    >
                        <BsPinFill className={`text-[20px] ${pined ? 'text-primary' : 'text-default-400'}`} />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='flat'
                        disableAnimation
                        className={`my-auto ${osType === 'Darwin' && 'hidden'} bg-transparent`}
                        onPress={() => {
                            void appWindow.close();
                        }}
                    >
                        <AiFillCloseCircle className='text-[20px] text-default-400' />
                    </Button>
                </div>
                <div className={`${osType === 'Linux' ? 'h-[calc(100vh-37px)]' : 'h-[calc(100vh-35px)]'} px-[8px]`}>
                    <div className='h-full overflow-y-auto'>
                        <div ref={contentRef}>
                            <div>
                                {serviceInstanceConfigMap !== null && (
                                    <SourceArea
                                        pluginList={pluginList}
                                        serviceInstanceConfigMap={serviceInstanceConfigMap}
                                    />
                                )}
                            </div>
                            <div className={`${hideLanguage && 'hidden'}`}>
                                <LanguageArea />
                                <Spacer y={1} />
                            </div>
                            <DragDropContext onDragEnd={onDragEnd}>
                            <Droppable
                                droppableId='droppable'
                                direction='vertical'
                            >
                                {(provided) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.droppableProps}
                                    >
                                        {translateServiceInstanceList !== null &&
                                            serviceInstanceConfigMap !== null &&
                                            translateServiceInstanceList.map((serviceInstanceKey, index) => {
                                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                                const enable = config['enable'] ?? true;
                                                const isPrimaryService = isFirstEnabledService(
                                                    serviceInstanceKey,
                                                    translateServiceInstanceList,
                                                    serviceInstanceConfigMap
                                                );

                                                return enable ? (
                                                    <Draggable
                                                        key={serviceInstanceKey}
                                                        draggableId={serviceInstanceKey}
                                                        index={index}
                                                    >
                                                        {(provided) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                            >
                                                                <TargetArea
                                                                    {...provided.dragHandleProps}
                                                                    index={index}
                                                                    name={serviceInstanceKey}
                                                                    isPrimaryService={isPrimaryService}
                                                                    translateServiceInstanceList={
                                                                        translateServiceInstanceList
                                                                    }
                                                                    pluginList={pluginList}
                                                                    serviceInstanceConfigMap={serviceInstanceConfigMap}
                                                                />
                                                                <Spacer y={1} />
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ) : (
                                                    <></>
                                                );
                                            })}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>
                        </div>
                    </div>
                </div>
            </div>
        )
    );
}
