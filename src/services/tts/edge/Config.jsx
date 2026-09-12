import { Button, Input, Select, SelectItem } from '@nextui-org/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast, { Toaster } from 'react-hot-toast';

import { useConfig, useToastStyle, useVoice } from '../../../hooks';
import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { tts } from './index';
import { chineseVoices, englishVoices, defaultConfig } from './voices';

export function Config({ instanceKey, updateServiceList, onClose }) {
    const { t } = useTranslation();
    const [config, setConfig] = useConfig(
        instanceKey,
        { [INSTANCE_NAME_CONFIG_KEY]: 'Edge TTS', ...defaultConfig },
        { sync: false }
    );
    const [loading, setLoading] = useState(null);
    const speak = useVoice();
    const toastStyle = useToastStyle();
    const label = (key) => t(`services.tts.edge_tts.${key}`);

    async function preview(lang) {
        setLoading(lang);
        try {
            const text = lang === 'zh' ? '你好，这是微软语音朗读测试。' : 'Hello! This is a pronunciation test.';
            await speak(await tts(text, lang, { config }));
        } catch (error) {
            toast.error(t('config.service.test_failed') + error.toString(), { style: toastStyle });
        } finally {
            setLoading(null);
        }
    }

    if (!config) return null;

    return (
        <>
            <Toaster />
            <div className='flex'>
                <Input
                    label={t('services.instance_name')}
                    value={config[INSTANCE_NAME_CONFIG_KEY] ?? 'Edge TTS'}
                    variant='bordered'
                    onValueChange={(value) => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: value })}
                />
            </div>
            <p className='text-sm text-default-500'>{label('description')}</p>
            {[
                { key: 'chineseVoice', lang: 'zh', voices: chineseVoices },
                { key: 'englishVoice', lang: 'en', voices: englishVoices },
            ].map(({ key, lang, voices }) => (
                <div
                    key={key}
                    className='flex items-center gap-3'
                >
                    <Select
                        label={label(key)}
                        selectedKeys={[config[key] ?? defaultConfig[key]]}
                        disallowEmptySelection
                        variant='bordered'
                        onSelectionChange={(keys) => {
                            const value = Array.from(keys)[0];
                            if (value) setConfig({ ...config, [key]: value });
                        }}
                    >
                        {voices.map((voice) => (
                            <SelectItem key={voice}>{label(voice)}</SelectItem>
                        ))}
                    </Select>
                    <Button
                        isLoading={loading === lang}
                        isDisabled={loading !== null}
                        onPress={() => preview(lang)}
                    >
                        {label('preview')}
                    </Button>
                </div>
            ))}
            <Button
                fullWidth
                color='primary'
                isDisabled={loading !== null}
                onPress={() => {
                    setConfig(config, true);
                    updateServiceList(instanceKey);
                    onClose();
                }}
            >
                {t('common.save')}
            </Button>
        </>
    );
}
