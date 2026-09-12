// Coalesce partial results; completion and cancellation must discard queued updates.
export function createTranslationRequest(commit) {
    const controller = new AbortController();
    let timer = null;
    let latest;
    let finished = false;
    const clear = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        latest = undefined;
    };
    return {
        signal: controller.signal,
        isActive: () => !controller.signal.aborted,
        update(value) {
            if (finished) return;
            latest = value;
            if (timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                const value = latest;
                latest = undefined;
                commit(value);
            }, 32);
        },
        finish(value) {
            if (finished) return;
            finished = true;
            clear();
            commit(value);
        },
        cancel() {
            finished = true;
            clear();
            controller.abort();
        },
    };
}
