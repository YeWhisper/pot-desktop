import { Button, Card, CardBody, CardFooter, ButtonGroup, Tooltip } from '@nextui-org/react';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import React, { useEffect, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { HiOutlineVolumeUp } from 'react-icons/hi';
import { BiCollapseVertical, BiExpandVertical } from 'react-icons/bi';
import { appWindow } from '@tauri-apps/api/window';
import toast from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { MdContentCopy } from 'react-icons/md';
import { MdSmartButton } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import { HiTranslate } from 'react-icons/hi';
import { LuDelete } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api';
import { useSetAtom } from 'jotai';
import { getServiceName, getServiceSouceType, ServiceSourceType } from '../../../../utils/service_instance';
import { useConfig, useVoice, useToastStyle } from '../../../../hooks';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as recognizeServices from '../../../../services/recognize';
import * as builtinTtsServices from '../../../../services/tts';
import { store } from '../../../../utils/store';
import { getCachedInlineTranslate } from '../../inlineTranslateCache';

import { SOURCE_LANGUAGE, sourceTextAtom, inlineTranslateAtom } from '../../state';
import { useTextareaHeight } from '../../useTextareaHeight';

export default function SourceArea(props) {
    const { pluginList, serviceInstanceConfigMap } = props;
    const [appFontSize] = useConfig('app_font_size', 16);
    const sourceFontSize = (appFontSize || 16) + 4;
    const [sourceText, setSourceTextState] = useState('');
    const sourceTextRef = useRef('');
    const setSubmittedText = useSetAtom(sourceTextAtom);
    const sourceTextChangeTimer = useRef(null);
    const incomingTextVersion = useRef(0);
    const [incrementalTranslate] = useConfig('incremental_translate', false);
    const [dynamicTranslate] = useConfig('dynamic_translate', false);
    const setInlineTranslate = useSetAtom(inlineTranslateAtom);
    const [deleteNewline] = useConfig('translate_delete_newline', false);
    const [recognizeLanguage] = useConfig('recognize_language', 'auto');
    const [recognizeServiceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [hideSource] = useConfig('hide_source', false);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const [windowType, setWindowType] = useState('[SELECTION_TRANSLATE]');
    const [sourceCollapsed, setSourceCollapsed] = useState(true);
    const toastStyle = useToastStyle();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const lastInlineTranslateRef = useRef(false);
    const speak = useVoice();

    const setSourceText = (text) => {
        sourceTextRef.current = text;
        setSourceTextState(text);
    };

    const submitSourceText = (text = sourceTextRef.current) => {
        clearTimeout(sourceTextChangeTimer.current);
        setSubmittedText(text);
    };

    const acceptText = (text, append = false) => {
        const normalized = deleteNewline ? text.replace(/\-\s+/g, '').replace(/\s+/g, ' ').trim() : text.trim();
        const nextText = append ? `${sourceTextRef.current} ${normalized}`.trim() : normalized;
        setSourceText(nextText);
        submitSourceText(nextText);
        setSourceCollapsed(true);
    };

    const recognizeImage = async () => {
        const base64 = await invoke('get_base64');
        const instanceKey = recognizeServiceList[0];
        const serviceName = getServiceName(instanceKey);
        const config = serviceInstanceConfigMap[instanceKey];
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            const language = pluginList.recognize[serviceName].language;
            if (!(recognizeLanguage in language)) throw new Error('Language not supported');
            const [recognize, utils] = await invoke_plugin('recognize', serviceName);
            return recognize(base64, language[recognizeLanguage], { config, utils });
        }
        const service = recognizeServices[serviceName];
        if (!(recognizeLanguage in service.Language)) throw new Error('Language not supported');
        return service.recognize(base64, service.Language[recognizeLanguage], { config });
    };

    const handleNewText = async (value) => {
        let text = value.trim();
        if (!text) return;
        const version = ++incomingTextVersion.current;
        clearTimeout(sourceTextChangeTimer.current);
        const isInline = text.startsWith('[INLINE_TRANSLATE]');
        if (isInline) text = text.substring('[INLINE_TRANSLATE]'.length).trim();
        setInlineTranslate(isInline);
        if (isInline || (hideWindow && text !== '[INPUT_TRANSLATE]')) {
            appWindow.hide();
        } else {
            appWindow.show();
            appWindow.setFocus();
        }
        if (isInline) {
            const cachedText = getCachedInlineTranslate(text);
            if (cachedText) {
                setInlineTranslate(false);
                lastInlineTranslateRef.current = true;
                submitSourceText('');
                await invoke('inline_paste', { text: cachedText });
                return;
            }
        }
        if (text === '[INPUT_TRANSLATE]') {
            setWindowType(text);
            setSourceText('');
            submitSourceText('');
            setSourceCollapsed(false);
            lastInlineTranslateRef.current = false;
            return;
        }
        if (text === '[IMAGE_TRANSLATE]') {
            setWindowType(text);
            submitSourceText('');
            try {
                const recognizedText = await recognizeImage();
                if (version !== incomingTextVersion.current) return;
                acceptText(recognizedText, incrementalTranslate && !lastInlineTranslateRef.current);
            } catch (error) {
                if (version !== incomingTextVersion.current) return;
                setSourceText(error.toString());
                toast.error(error.toString(), { style: toastStyle });
            }
        } else {
            setWindowType('[SELECTION_TRANSLATE]');
            acceptText(text, incrementalTranslate && !isInline && !lastInlineTranslateRef.current);
        }
        lastInlineTranslateRef.current = isInline;
    };

    const keyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitSourceText();
        }
        if (event.key === 'Escape') appWindow.close();
        if (event.altKey && event.shiftKey && event.code === 'KeyU') {
            event.preventDefault();
            const input = event.currentTarget;
            const { selectionStart, selectionEnd, value } = input;
            const converted = transformVarName(value.substring(selectionStart, selectionEnd));
            changeSourceText(value.substring(0, selectionStart) + converted + value.substring(selectionEnd));
            requestAnimationFrame(() => {
                textAreaRef.current?.setSelectionRange(selectionStart, selectionStart + converted.length);
            });
        }
    };

    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        const detected = SOURCE_LANGUAGE;
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            if (!(detected in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(sourceText, ttsPluginInfo.language[detected], {
                config: pluginConfig,
                utils,
            });
            await speak(data);
        } else {
            if (!(detected in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = (await store.get(instanceKey)) ?? {};
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                sourceText,
                builtinTtsServices[getServiceName(instanceKey)].Language[detected],
                {
                    config: instanceConfig,
                }
            );
            await speak(data);
        }
    };

    const handleNewTextRef = useRef(handleNewText);
    handleNewTextRef.current = handleNewText;
    const ready = [deleteNewline, incrementalTranslate, recognizeLanguage, recognizeServiceList, hideWindow].every(
        (value) => value !== null
    );
    useEffect(() => {
        if (!ready) return;
        let disposed = false;
        let receivedText = false;
        const unlisten = listen('new_text', (event) => {
            if (disposed) return;
            receivedText = true;
            void handleNewTextRef.current(event.payload ?? '');
        });
        unlisten.then(() => {
            if (disposed) return;
            invoke('get_text').then((text) => {
                if (!disposed && !receivedText) void handleNewTextRef.current(text);
            });
        });
        return () => {
            disposed = true;
            incomingTextVersion.current++;
            clearTimeout(sourceTextChangeTimer.current);
            unlisten.then((cleanup) => cleanup());
        };
    }, [ready]);

    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    useTextareaHeight(textAreaRef, sourceText, sourceFontSize, sourceCollapsed);

    const changeSourceText = (text) => {
        incomingTextVersion.current++;
        setSourceText(text);
        clearTimeout(sourceTextChangeTimer.current);
        if (!text.trim()) submitSourceText('');
        else if (dynamicTranslate) {
            sourceTextChangeTimer.current = setTimeout(() => submitSourceText(text), 1000);
        }
    };

    const transformVarName = function (str) {
        let str2 = str;

        // snake_case to SNAKE_CASE
        if (/_[a-z]/.test(str2)) {
            str2 = str2
                .split('_')
                .map((it) => it.toLocaleUpperCase())
                .join('_');
        }
        if (str2 !== str) {
            return str2;
        }

        // SNAKE_CASE to kebab-case
        if (/^[A-Z]+(_[A-Z]+)*$/.test(str2)) {
            str2 = str2
                .split('_')
                .map((it) => it.toLocaleLowerCase())
                .join('-');
        }
        if (str2 !== str) {
            return str2;
        }

        // kebab-case to dot.notation
        if (/-/.test(str2)) {
            str2 = str2
                .split('-')
                .map((it) => it.toLocaleLowerCase())
                .join('.');
        }
        if (str2 !== str) {
            return str2;
        }

        // dot.notation to space separated
        if (/\.[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/(\.)([a-z])/g, (_, _2, it) => ' ' + it);
        }
        if (str2 !== str) {
            return str2;
        }

        // space separated to Title Case
        if (/\s[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([a-z])/g, (_, it) => ' ' + it.toLocaleUpperCase());
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // Title Case to CamelCase
        if (/\s[A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([A-Z])/g, (_, it) => it);
            str2 = str2.substring(0, 1).toLocaleLowerCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // CamelCase to PascalCase
        if (/^[a-z]+[A-Z]+/.test(str2)) {
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // PascalCase to snake_case
        if (/[^\s][A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/[A-Z]/g, (it, offset) => {
                return (offset == 0 ? '' : '_') + it.toLocaleLowerCase();
            });
        }

        return str2;
    };
    return (
        <div className={hideSource && windowType !== '[INPUT_TRANSLATE]' ? 'hidden' : ''}>
            <Card
                shadow='none'
                className='paper-source'
            >
                <CardBody className='paper-source-body max-h-[40vh] overflow-y-auto'>
                    <textarea
                        autoFocus
                        ref={textAreaRef}
                        rows={1}
                        aria-label={t('config.translate.source')}
                        placeholder={t('translate.input_placeholder')}
                        style={{ fontSize: sourceFontSize, lineHeight: 1.4 }}
                        className='paper-source-text w-full resize-none bg-transparent outline-none'
                        value={sourceText}
                        onKeyDown={keyDown}
                        onChange={(e) => {
                            const v = e.target.value;
                            changeSourceText(v);
                        }}
                    />
                </CardBody>

                <CardFooter className='paper-source-actions'>
                    <div className='flex justify-start'>
                        <ButtonGroup className='gap-0'>
                            <Tooltip content={t('translate.speak')}>
                                <Button
                                    aria-label={t('translate.speak')}
                                    isDisabled={!sourceText.trim()}
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        handleSpeak().catch((e) => {
                                            toast.error(e.toString(), { style: toastStyle });
                                        });
                                    }}
                                >
                                    <HiOutlineVolumeUp className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.copy')}>
                                <Button
                                    aria-label={t('translate.copy')}
                                    isDisabled={!sourceText.trim()}
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        writeText(sourceText);
                                    }}
                                >
                                    <MdContentCopy className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.delete_newline')}>
                                <Button
                                    aria-label={t('translate.delete_newline')}
                                    isDisabled={!sourceText.trim()}
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        const newText = sourceText.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                        setSourceText(newText);
                                        submitSourceText(newText);
                                    }}
                                >
                                    <MdSmartButton className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t(sourceCollapsed ? 'translate.expand' : 'translate.collapse')}>
                                <Button
                                    aria-label={t(sourceCollapsed ? 'translate.expand' : 'translate.collapse')}
                                    variant='light'
                                    size='sm'
                                    isIconOnly
                                    isDisabled={sourceText === ''}
                                    onPress={() => {
                                        setSourceCollapsed((v) => !v);
                                    }}
                                >
                                    {sourceCollapsed ? (
                                        <BiExpandVertical className='text-[16px]' />
                                    ) : (
                                        <BiCollapseVertical className='text-[16px]' />
                                    )}
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('common.clear')}>
                                <Button
                                    aria-label={t('common.clear')}
                                    variant='light'
                                    size='sm'
                                    isIconOnly
                                    isDisabled={sourceText === ''}
                                    onPress={() => {
                                        changeSourceText('');
                                    }}
                                >
                                    <LuDelete className='text-[16px]' />
                                </Button>
                            </Tooltip>
                        </ButtonGroup>
                    </div>
                    <Tooltip content={t('translate.translate')}>
                        <Button
                            size='sm'
                            color='primary'
                            variant='flat'
                            isDisabled={!sourceText.trim()}
                            aria-label={t('translate.translate')}
                            className='min-w-0 px-2 font-medium'
                            startContent={<HiTranslate className='text-[16px]' />}
                            onPress={() => submitSourceText()}
                        >
                            {t('translate.translate')}
                        </Button>
                    </Tooltip>
                </CardFooter>
            </Card>
        </div>
    );
}
