import { Button, Dropdown, DropdownMenu, DropdownTrigger, DropdownItem } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { HiArrowRight, HiChevronDown } from 'react-icons/hi';
import React, { useEffect } from 'react';
import { useAtom } from 'jotai';

import { languageList } from '../../../../utils/language';
import { useConfig } from '../../../../hooks';
import { SOURCE_LANGUAGE, targetLanguageAtom } from '../../state';

export default function LanguageArea({ compact = false }) {
    const [rememberLanguage] = useConfig('translate_remember_language', false);
    const [translateTargetLanguage, setTranslateTargetLanguage] = useConfig('translate_target_language', 'zh_cn');
    const [targetLanguage, setTargetLanguage] = useAtom(targetLanguageAtom);
    const { t } = useTranslation();
    const language = targetLanguage || translateTargetLanguage || 'zh_cn';
    const label = language === 'zh_cn' ? '简中' : language === 'zh_tw' ? '繁中' : t(`languages.${language}`);

    useEffect(() => {
        if (translateTargetLanguage) setTargetLanguage(translateTargetLanguage);
    }, [translateTargetLanguage]);

    return (
        <div className='paper-language'>
            <span
                title={t('translate.fixed_english')}
                aria-label={t(`languages.${SOURCE_LANGUAGE}`)}
            >
                EN
            </span>
            <HiArrowRight aria-hidden='true' />
            {compact ? (
                <span title={t(`languages.${language}`)}>{label}</span>
            ) : (
                <Dropdown>
                    <DropdownTrigger>
                        <Button
                            size='sm'
                            variant='light'
                            className='paper-target-language'
                            aria-label={t('config.translate.target_language')}
                            endContent={<HiChevronDown />}
                        >
                            {label}
                        </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                        aria-label={t('config.translate.target_language')}
                        className='max-h-[50vh] overflow-y-auto'
                        selectionMode='single'
                        selectedKeys={targetLanguage ? [targetLanguage] : []}
                        onAction={(key) => {
                            setTargetLanguage(key);
                            if (rememberLanguage) setTranslateTargetLanguage(key);
                        }}
                    >
                        {languageList.map((language) => (
                            <DropdownItem key={language}>{t(`languages.${language}`)}</DropdownItem>
                        ))}
                    </DropdownMenu>
                </Dropdown>
            )}
        </div>
    );
}
