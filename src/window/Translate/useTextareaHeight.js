import { useEffect } from 'react';

export function useTextareaHeight(ref, value, fontSize, collapsed = false) {
    useEffect(() => {
        const textarea = ref.current;
        if (!textarea) return;
        const resize = () => {
            textarea.style.height = '0px';
            textarea.style.height = collapsed
                ? `${Math.min(textarea.scrollHeight, 2 * parseFloat(getComputedStyle(textarea).lineHeight))}px`
                : `${textarea.scrollHeight}px`;
        };
        resize();
        let width = textarea.clientWidth;
        const observer = new ResizeObserver(() => {
            if (textarea.clientWidth === width) return;
            width = textarea.clientWidth;
            resize();
        });
        observer.observe(textarea);
        return () => observer.disconnect();
    }, [ref, value, fontSize, collapsed]);
}
