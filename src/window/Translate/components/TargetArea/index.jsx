import {
    Card,
    CardBody,
    CardFooter,
    Button,
    ButtonGroup,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Tooltip,
} from '@nextui-org/react';
import { BiCollapseVertical, BiExpandVertical } from 'react-icons/bi';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { sendNotification } from '@tauri-apps/api/notification';
import React, { useEffect, useState, useRef } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { invoke } from '@tauri-apps/api';
import PulseLoader from 'react-spinners/PulseLoader';
import { TbTransformFilled } from 'react-icons/tb';
import { HiOutlineVolumeUp } from 'react-icons/hi';
import { semanticColors } from '@nextui-org/theme';
import toast from 'react-hot-toast';
import { MdContentCopy } from 'react-icons/md';
import { useTranslation } from 'react-i18next';
import Database from 'tauri-plugin-sql-api';
import { GiCycle } from 'react-icons/gi';
import { useTheme } from 'next-themes';
import { useAtomValue, useSetAtom } from 'jotai';

import * as builtinCollectionServices from '../../../../services/collection';
import { SOURCE_LANGUAGE, sourceTextAtom, targetLanguageAtom, inlineTranslateAtom } from '../../state';
import { useConfig, useToastStyle, useVoice } from '../../../../hooks';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as builtinServices from '../../../../services/translate';
import * as builtinTtsServices from '../../../../services/tts';
import { store } from '../../../../utils/store';
import { cacheInlineTranslatePair } from '../../inlineTranslateCache';
import { createTranslationRequest } from '../../translation_request';
import { useTextareaHeight } from '../../useTextareaHeight';

import { error as logError } from 'tauri-plugin-log-api';
import {
    INSTANCE_NAME_CONFIG_KEY,
    ServiceSourceType,
    getDisplayInstanceName,
    getServiceName,
    getServiceSouceType,
    whetherPluginService,
} from '../../../../utils/service_instance';

export default function TargetArea(props) {
    const { name, isPrimaryService, translateServiceInstanceList, pluginList, serviceInstanceConfigMap, ...drag } =
        props;

    const [currentTranslateServiceInstanceKey, setCurrentTranslateServiceInstanceKey] = useState(name);
    function getInstanceName(instanceKey, serviceNameSupplier) {
        const instanceConfig = serviceInstanceConfigMap[instanceKey] ?? {};
        return getDisplayInstanceName(instanceConfig[INSTANCE_NAME_CONFIG_KEY], serviceNameSupplier);
    }

    const [appFontSize] = useConfig('app_font_size', 16);
    const resultFontSize = (appFontSize || 16) + 8;
    const [collectionServiceList] = useConfig('collection_service_list', []);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [historyDisable] = useConfig('history_disable', false);
    const [isLoading, setIsLoading] = useState(false);
    const [hide, setHide] = useState(true);

    const [result, setResult] = useState('');
    const [error, setError] = useState('');
    const [resultLanguage, setResultLanguage] = useState();

    const sourceText = useAtomValue(sourceTextAtom);
    const targetLanguage = useAtomValue(targetLanguageAtom);
    const [autoCopy] = useConfig('translate_auto_copy', 'disable');
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [clipboardMonitor] = useConfig('clipboard_monitor', false);

    const inlineTranslate = useAtomValue(inlineTranslateAtom);
    const setInlineTranslate = useSetAtom(inlineTranslateAtom);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const toastStyle = useToastStyle();
    const speak = useVoice();
    const { resolvedTheme } = useTheme();
    const activeRequest = useRef(null);
    const resultOptions = useRef();
    resultOptions.current = { autoCopy, hideWindow, clipboardMonitor, historyDisable };
    const configReady = autoCopy !== null && hideWindow !== null && clipboardMonitor !== null;

    useEffect(() => {
        if (error) {
            logError(`[${currentTranslateServiceInstanceKey}]happened error: ` + error);
        }
    }, [error]);

    // listen to translation
    useEffect(() => {
        setResult('');
        setError('');
        setIsLoading(false);
        if (sourceText.trim() !== '' && targetLanguage && configReady) {
            if (isPrimaryService && autoCopy === 'source' && !clipboardMonitor) {
                writeText(sourceText).then(() => {
                    if (hideWindow) {
                        sendNotification({ title: t('common.write_clipboard'), body: sourceText });
                    }
                });
            }
            translate();
        }
        return () => activeRequest.current?.cancel();
    }, [sourceText, targetLanguage, currentTranslateServiceInstanceKey, configReady]);

    // todo: history panel use service instance key
    const addToHistory = async (text, source, target, serviceInstanceKey, result) => {
        const db = await Database.load('sqlite:history.db');

        await db
            .execute(
                'INSERT into history (text, source, target, service, result, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
                [text, source, target, serviceInstanceKey, result, Date.now()]
            )
            .then(
                (v) => {
                    db.close();
                },
                (e) => {
                    db.execute(
                        'CREATE TABLE history(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL,source TEXT NOT NULL,target TEXT NOT NULL,service TEXT NOT NULL, result TEXT NOT NULL,timestamp INTEGER NOT NULL)'
                    ).then(() => {
                        db.close();
                        addToHistory(text, source, target, serviceInstanceKey, result);
                    });
                }
            );
    };

    const handleInlineTranslateResult = (value) => {
        if (!inlineTranslate || !isPrimaryService) {
            return;
        }

        setInlineTranslate(false);
        const resultText = typeof value === 'string' ? value.trim() : '';
        if (resultText) {
            cacheInlineTranslatePair(sourceText.trim(), resultText);
            invoke('inline_paste', { text: resultText });
        }
    };

    const translate = async (text = sourceText, from = SOURCE_LANGUAGE, to = targetLanguage, translateBack = false) => {
        activeRequest.current?.cancel();
        const request = createTranslationRequest(setResult);
        activeRequest.current = request;
        setResult('');
        setError('');
        setIsLoading(true);
        setHide(false);
        setResultLanguage(to);

        const serviceName = getServiceName(currentTranslateServiceInstanceKey);
        try {
            const isPlugin = whetherPluginService(currentTranslateServiceInstanceKey);
            const service = isPlugin ? pluginList.translate[serviceName] : builtinServices[serviceName];
            const languages = isPlugin ? service.language : service.Language;
            if (!(from in languages) || !(to in languages)) throw new Error('Language not supported');

            let translateText = service.translate;
            let utils;
            if (isPlugin) [translateText, utils] = await invoke_plugin('translate', serviceName);
            if (!request.isActive()) return;
            const config = serviceInstanceConfigMap[currentTranslateServiceInstanceKey];
            const value = await translateText(text.trim(), languages[from], languages[to], {
                config: isPlugin ? { ...config, enable: 'true' } : config,
                detect: from,
                signal: request.signal,
                setResult: (value) => request.update(value),
                ...(isPlugin ? { utils } : {}),
            });
            if (!request.isActive()) return;
            const translated = typeof value === 'string' ? value.trim() : value;
            request.finish(translated);
            setIsLoading(false);
            if (translateBack) return;

            handleInlineTranslateResult(translated);
            const { autoCopy, hideWindow, clipboardMonitor, historyDisable } = resultOptions.current;
            if (!historyDisable) {
                addToHistory(text.trim(), from, to, serviceName, translated);
            }
            if (isPrimaryService && !clipboardMonitor && typeof translated === 'string') {
                const copyText =
                    autoCopy === 'target'
                        ? translated
                        : autoCopy === 'source_target'
                          ? `${text.trim()}\n\n${translated}`
                          : null;
                if (copyText !== null) {
                    await writeText(copyText);
                    if (hideWindow) sendNotification({ title: t('common.write_clipboard'), body: copyText });
                }
            }
        } catch (error) {
            if (!request.isActive()) return;
            request.cancel();
            setError(error.toString());
            setIsLoading(false);
            if (inlineTranslate && isPrimaryService) setInlineTranslate(false);
        }
    };

    useTextareaHeight(textAreaRef, result, resultFontSize);

    // Reveal new content even if the user collapsed the previous result.
    useEffect(() => {
        const hasResult = typeof result === 'string' ? result !== '' : result != null;
        if (hasResult || error !== '') {
            setHide(false);
        }
    }, [result, error]);

    // refresh tts config
    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    // handle tts speak
    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        const language = resultLanguage || targetLanguage;
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            if (!(language in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(result, ttsPluginInfo.language[language], {
                config: pluginConfig,
                utils,
            });
            await speak(data);
        } else {
            if (!(language in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = (await store.get(instanceKey)) ?? {};
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                result,
                builtinTtsServices[getServiceName(instanceKey)].Language[language],
                {
                    config: instanceConfig,
                }
            );
            await speak(data);
        }
    };

    const hasContent = (typeof result === 'string' ? result !== '' : result != null) || error !== '' || isLoading;

    return (
        <Card
            shadow='none'
            className='paper-result'
        >
            <div hidden={hide || !hasContent}>
                {/* result content */}
                <CardBody
                    style={{ fontSize: appFontSize || 16 }}
                    className='paper-result-body'
                >
                    {typeof result === 'string' ? (
                        <textarea
                            ref={textAreaRef}
                            aria-label={t('config.translate.target')}
                            rows={1}
                            style={{ fontSize: resultFontSize, lineHeight: 1.4 }}
                            className='paper-result-text w-full h-0 resize-none bg-transparent select-text outline-none'
                            readOnly
                            value={result}
                        />
                    ) : (
                        <div>
                            {result['pronunciations'] &&
                                result['pronunciations'].map((pronunciation, index) => {
                                    return (
                                        <div key={index}>
                                            {pronunciation['region'] && (
                                                <span className={`text-[${appFontSize}px] mr-[12px] text-default-500`}>
                                                    {pronunciation['region']}
                                                </span>
                                            )}
                                            {pronunciation['symbol'] && (
                                                <span className={`text-[${appFontSize}px] mr-[12px] text-default-500`}>
                                                    {pronunciation['symbol']}
                                                </span>
                                            )}
                                            {pronunciation['voice'] && pronunciation['voice'] !== '' && (
                                                <HiOutlineVolumeUp
                                                    className={`text-[${appFontSize}px] inline-block my-auto cursor-pointer`}
                                                    onClick={() => {
                                                        speak(pronunciation['voice']).catch((e) => {
                                                            toast.error(e.toString(), { style: toastStyle });
                                                        });
                                                    }}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            {result['explanations'] &&
                                result['explanations'].map((explanations, index) => {
                                    return (
                                        <div key={index}>
                                            {explanations['explains'] &&
                                                explanations['explains'].map((explain, index) => {
                                                    return (
                                                        <span key={index}>
                                                            {index === 0 ? (
                                                                <>
                                                                    <span
                                                                        className={`text-[${appFontSize - 2}px] text-default-500 mr-[12px]`}
                                                                    >
                                                                        {explanations['trait']}
                                                                    </span>
                                                                    <span
                                                                        className={`font-bold text-[${appFontSize}px] select-text`}
                                                                    >
                                                                        {explain}
                                                                    </span>
                                                                    <br />
                                                                </>
                                                            ) : (
                                                                <span
                                                                    className={`text-[${appFontSize - 2}px] text-default-500 select-text mr-1`}
                                                                >
                                                                    {explain}
                                                                </span>
                                                            )}
                                                        </span>
                                                    );
                                                })}
                                        </div>
                                    );
                                })}
                            <br />
                            {result['associations'] &&
                                result['associations'].map((association, index) => {
                                    return (
                                        <div key={index}>
                                            <span className={`text-[${appFontSize}px] text-default-500`}>
                                                {association}
                                            </span>
                                        </div>
                                    );
                                })}
                            {result['sentence'] &&
                                result['sentence'].map((sentence, index) => {
                                    return (
                                        <div key={index}>
                                            <span className={`text-[${appFontSize - 2}px] mr-[12px]`}>
                                                {index + 1}.
                                            </span>
                                            <>
                                                {sentence['source'] && (
                                                    <span
                                                        className={`text-[${appFontSize}px] select-text`}
                                                        dangerouslySetInnerHTML={{
                                                            __html: sentence['source'],
                                                        }}
                                                    />
                                                )}
                                            </>
                                            <>
                                                {sentence['target'] && (
                                                    <div
                                                        className={`text-[${appFontSize}px] select-text text-default-500`}
                                                        dangerouslySetInnerHTML={{
                                                            __html: sentence['target'],
                                                        }}
                                                    />
                                                )}
                                            </>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                    {error !== '' ? (
                        error.split('\n').map((v) => {
                            return (
                                <p
                                    key={v}
                                    className={`text-[${appFontSize}px] text-red-500`}
                                >
                                    {v}
                                </p>
                            );
                        })
                    ) : (
                        <></>
                    )}
                </CardBody>
            </div>
            <div className='paper-result-footer'>
                <div className='paper-service'>
                    {/* current service instance and available service instance to change */}
                    <div className='flex min-w-0 items-center gap-1'>
                        <Dropdown>
                            <DropdownTrigger>
                                <Button
                                    size='sm'
                                    variant='solid'
                                    className='min-w-0 max-w-full bg-transparent px-1.5'
                                    startContent={
                                        whetherPluginService(currentTranslateServiceInstanceKey) ? (
                                            <img
                                                src={
                                                    pluginList['translate'][
                                                        getServiceName(currentTranslateServiceInstanceKey)
                                                    ].icon
                                                }
                                                className='h-[20px] my-auto'
                                            />
                                        ) : (
                                            <img
                                                src={
                                                    builtinServices[getServiceName(currentTranslateServiceInstanceKey)]
                                                        .info.icon
                                                }
                                                className='h-[20px] my-auto'
                                            />
                                        )
                                    }
                                >
                                    {whetherPluginService(currentTranslateServiceInstanceKey) ? (
                                        <div className='my-auto truncate'>{`${getInstanceName(currentTranslateServiceInstanceKey, () => pluginList['translate'][getServiceName(currentTranslateServiceInstanceKey)].display)} `}</div>
                                    ) : (
                                        <div className='my-auto truncate'>
                                            {getInstanceName(currentTranslateServiceInstanceKey, () =>
                                                t(
                                                    `services.translate.${getServiceName(currentTranslateServiceInstanceKey)}.title`
                                                )
                                            )}
                                        </div>
                                    )}
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu
                                aria-label='app language'
                                className='max-h-[40vh] overflow-y-auto'
                                onAction={(key) => {
                                    setCurrentTranslateServiceInstanceKey(key);
                                }}
                            >
                                {translateServiceInstanceList.map((instanceKey) => {
                                    return (
                                        <DropdownItem
                                            key={instanceKey}
                                            startContent={
                                                whetherPluginService(instanceKey) ? (
                                                    <img
                                                        src={pluginList['translate'][getServiceName(instanceKey)].icon}
                                                        className='h-[20px] my-auto'
                                                    />
                                                ) : (
                                                    <img
                                                        src={builtinServices[getServiceName(instanceKey)].info.icon}
                                                        className='h-[20px] my-auto'
                                                    />
                                                )
                                            }
                                        >
                                            {whetherPluginService(instanceKey) ? (
                                                <div className='my-auto truncate'>{`${getInstanceName(instanceKey, () => pluginList['translate'][getServiceName(instanceKey)].display)} `}</div>
                                            ) : (
                                                <div className='my-auto truncate'>
                                                    {getInstanceName(instanceKey, () =>
                                                        t(`services.translate.${getServiceName(instanceKey)}.title`)
                                                    )}
                                                </div>
                                            )}
                                        </DropdownItem>
                                    );
                                })}
                            </DropdownMenu>
                        </Dropdown>
                        <PulseLoader
                            loading={isLoading}
                            color={
                                resolvedTheme === 'dark'
                                    ? semanticColors.dark.default[500]
                                    : semanticColors.light.default[500]
                            }
                            size={4}
                            cssOverride={{
                                display: 'inline-block',
                                margin: 'auto',
                                marginLeft: '4px',
                            }}
                        />
                    </div>
                    {/* content collapse */}
                    <div className='flex shrink-0 items-center'>
                        <span
                            {...drag}
                            aria-label={t('translate.drag_service')}
                            title={t('translate.drag_service')}
                            className='cursor-grab px-1 text-default-400'
                        >
                            ⠿
                        </span>
                        <Button
                            size='sm'
                            isIconOnly
                            variant='light'
                            aria-label={t(hide ? 'translate.expand_result' : 'translate.collapse_result')}
                            className='h-7 w-7 min-w-7'
                            onPress={() => setHide(!hide)}
                        >
                            {hide ? (
                                <BiExpandVertical className='text-[16px]' />
                            ) : (
                                <BiCollapseVertical className='text-[16px]' />
                            )}
                        </Button>
                    </div>
                </div>
                <CardFooter className={`paper-result-actions ${hide || !hasContent ? 'hidden' : ''}`}>
                    <ButtonGroup>
                        {/* speak button */}
                        <Tooltip content={t('translate.speak')}>
                            <Button
                                aria-label={t('translate.speak')}
                                isIconOnly
                                variant='light'
                                size='sm'
                                isDisabled={isLoading || typeof result !== 'string' || result === ''}
                                onPress={() => {
                                    handleSpeak().catch((e) => {
                                        toast.error(e.toString(), { style: toastStyle });
                                    });
                                }}
                            >
                                <HiOutlineVolumeUp className='text-[16px]' />
                            </Button>
                        </Tooltip>
                        {/* copy button */}
                        <Tooltip content={t('translate.copy')}>
                            <Button
                                aria-label={t('translate.copy')}
                                isIconOnly
                                variant='light'
                                size='sm'
                                isDisabled={isLoading || typeof result !== 'string' || result === ''}
                                onPress={() => {
                                    writeText(result);
                                }}
                            >
                                <MdContentCopy className='text-[16px]' />
                            </Button>
                        </Tooltip>
                        {/* translate back button */}
                        <Tooltip content={t('translate.translate_back')}>
                            <Button
                                aria-label={t('translate.translate_back')}
                                className='paper-secondary-action'
                                isIconOnly
                                variant='light'
                                size='sm'
                                isDisabled={isLoading || typeof result !== 'string' || result === ''}
                                onPress={() =>
                                    translate(result, resultLanguage || targetLanguage, SOURCE_LANGUAGE, true)
                                }
                            >
                                <TbTransformFilled className='text-[16px]' />
                            </Button>
                        </Tooltip>
                        {/* error retry button */}
                        <Tooltip content={t('translate.retry')}>
                            <Button
                                aria-label={t('translate.retry')}
                                isIconOnly
                                variant='light'
                                size='sm'
                                className={`${error === '' && 'hidden'}`}
                                onPress={() => {
                                    setError('');
                                    setResult('');
                                    translate();
                                }}
                            >
                                <GiCycle className='text-[16px]' />
                            </Button>
                        </Tooltip>
                        {/* available collection service instance */}
                        {collectionServiceList &&
                            collectionServiceList.map((collectionServiceInstanceName) => {
                                return (
                                    <Button
                                        key={collectionServiceInstanceName}
                                        isIconOnly
                                        variant='light'
                                        size='sm'
                                        onPress={async () => {
                                            if (
                                                getServiceSouceType(collectionServiceInstanceName) ===
                                                ServiceSourceType.PLUGIN
                                            ) {
                                                const pluginConfig =
                                                    serviceInstanceConfigMap[collectionServiceInstanceName];
                                                let [func, utils] = await invoke_plugin(
                                                    'collection',
                                                    getServiceName(collectionServiceInstanceName)
                                                );
                                                func(sourceText.trim(), result.toString(), {
                                                    config: pluginConfig,
                                                    utils,
                                                }).then(
                                                    (_) => {
                                                        toast.success(t('translate.add_collection_success'), {
                                                            style: toastStyle,
                                                        });
                                                    },
                                                    (e) => {
                                                        toast.error(e.toString(), { style: toastStyle });
                                                    }
                                                );
                                            } else {
                                                const instanceConfig =
                                                    serviceInstanceConfigMap[collectionServiceInstanceName];
                                                builtinCollectionServices[getServiceName(collectionServiceInstanceName)]
                                                    .collection(sourceText, result, {
                                                        config: instanceConfig,
                                                    })
                                                    .then(
                                                        (_) => {
                                                            toast.success(t('translate.add_collection_success'), {
                                                                style: toastStyle,
                                                            });
                                                        },
                                                        (e) => {
                                                            toast.error(e.toString(), { style: toastStyle });
                                                        }
                                                    );
                                            }
                                        }}
                                    >
                                        <img
                                            src={
                                                getServiceSouceType(collectionServiceInstanceName) ===
                                                ServiceSourceType.PLUGIN
                                                    ? pluginList['collection'][
                                                          getServiceName(collectionServiceInstanceName)
                                                      ].icon
                                                    : builtinCollectionServices[
                                                          getServiceName(collectionServiceInstanceName)
                                                      ].info.icon
                                            }
                                            className='h-[16px] w-[16px]'
                                        />
                                    </Button>
                                );
                            })}
                    </ButtonGroup>
                </CardFooter>
            </div>
        </Card>
    );
}
