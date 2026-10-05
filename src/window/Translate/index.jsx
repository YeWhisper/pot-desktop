import { readDir, BaseDirectory, readTextFile, exists } from '@tauri-apps/api/fs';
import { DragDropContext, Draggable, Droppable } from 'react-beautiful-dnd';
import { appWindow, currentMonitor } from '@tauri-apps/api/window';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { Button, Tooltip } from '@nextui-org/react';
import { HiOutlineX } from 'react-icons/hi';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'react-hot-toast';
import React, { useState, useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { BsPin, BsPinFill } from 'react-icons/bs';

import LanguageArea from './components/LanguageArea';
import SourceArea from './components/SourceArea';
import TargetArea from './components/TargetArea';
import { isFirstEnabledService } from './service_order';
import { osType } from '../../utils/env';
import { useConfig } from '../../hooks';
import { store } from '../../utils/store';
import { useWindowPin } from './useWindowPin';
import { useAutoFitWindow } from './useAutoFitWindow';
import './paper.css';

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
    const [pinned, setPinned] = useWindowPin(alwaysOnTop, closeOnBlur);
    const { t } = useTranslation();
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
    // 保存窗口位置
    useEffect(() => {
        if (windowPosition !== null && windowPosition === 'pre_state') {
            let moveTimeout;
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
                clearTimeout(moveTimeout);
                unlistenMove.then((f) => {
                    f();
                });
            };
        }
    }, [windowPosition]);
    // 保存窗口大小
    useEffect(() => {
        if (rememberWindowSize !== null && rememberWindowSize) {
            let resizeTimeout;
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
                clearTimeout(resizeTimeout);
                unlistenResize.then((f) => {
                    f();
                });
            };
        }
    }, [rememberWindowSize, autoFitHeight]);

    useAutoFitWindow(contentRef, autoFitHeight, !!pluginList && !!serviceInstanceConfigMap);

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
        const unlisten = listen('reload_plugin_list', loadPluginList);
        return () => {
            unlisten.then((cleanup) => cleanup());
        };
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
        <div className='translate-paper flex h-screen w-screen flex-col'>
            <Toaster />
            <header className='paper-header'>
                <div
                    className={`paper-heading ${osType === 'Darwin' ? 'pl-16' : ''}`}
                    data-tauri-drag-region='true'
                >
                    <LanguageArea compact={hideLanguage} />
                </div>
                <Tooltip content={t(pinned ? 'translate.unpin' : 'translate.pin')}>
                    <Button
                        isIconOnly
                        size='sm'
                        variant={pinned ? 'flat' : 'light'}
                        color={pinned ? 'primary' : 'default'}
                        aria-label={t(pinned ? 'translate.unpin' : 'translate.pin')}
                        aria-pressed={pinned}
                        className='paper-window-button'
                        onPress={() => setPinned(!pinned)}
                    >
                        {pinned ? <BsPinFill className='text-base' /> : <BsPin className='text-base' />}
                    </Button>
                </Tooltip>
                {osType !== 'Darwin' && (
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        aria-label={t('translate.close')}
                        className='paper-window-button'
                        onPress={() => void appWindow.close()}
                    >
                        <HiOutlineX className='text-lg text-default-500' />
                    </Button>
                )}
            </header>
            <main className='min-h-0 flex-1 overflow-y-auto'>
                <div
                    ref={contentRef}
                    className='paper-content'
                >
                    {pluginList && serviceInstanceConfigMap && (
                        <>
                            <SourceArea
                                pluginList={pluginList}
                                serviceInstanceConfigMap={serviceInstanceConfigMap}
                            />
                            <DragDropContext onDragEnd={onDragEnd}>
                                <Droppable
                                    droppableId='droppable'
                                    direction='vertical'
                                >
                                    {(provided) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            className='paper-results'
                                        >
                                            {translateServiceInstanceList?.map((serviceInstanceKey, index) => {
                                                const config = serviceInstanceConfigMap[serviceInstanceKey] ?? {};
                                                if (config.enable === false) return null;
                                                return (
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
                                                                    name={serviceInstanceKey}
                                                                    isPrimaryService={isFirstEnabledService(
                                                                        serviceInstanceKey,
                                                                        translateServiceInstanceList,
                                                                        serviceInstanceConfigMap
                                                                    )}
                                                                    translateServiceInstanceList={
                                                                        translateServiceInstanceList
                                                                    }
                                                                    pluginList={pluginList}
                                                                    serviceInstanceConfigMap={serviceInstanceConfigMap}
                                                                />
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                );
                                            })}
                                            {provided.placeholder}
                                        </div>
                                    )}
                                </Droppable>
                            </DragDropContext>
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
