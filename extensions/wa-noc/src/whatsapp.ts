export type Chat = { key: string; label: string; phone: string | null };

export function phoneFromTitle(raw: string): string | null {
    if (!/^[+\d\s().-]+$/.test(raw.trim())) return null;
    let phone = raw.replace(/\D/g, '');
    if (phone.startsWith('00')) phone = phone.slice(2);
    if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;
    else if (phone.startsWith('8')) phone = `62${phone}`;
    return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

// Only inspect the active chat header. Never match numbers from message bodies,
// participant lists or unrelated contact drawers. Saved names use manual lookup.
export function observeChat(onChange: (chat: Chat | null) => void): () => void {
    let previous = '';
    let previousHeader: Element | null = null;
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function inspect() {
        const header = document.querySelector('#main header');
        const title = header?.querySelector<HTMLElement>('span[title]');
        const label = title?.getAttribute('title')?.trim() || '';
        const signature = `${label}|${header ? 'open' : 'closed'}`;
        if (signature === previous && header === previousHeader) return;
        previous = signature;
        previousHeader = header;
        revision++;
        onChange(label ? { key: `${revision}:${label}`, label, phone: phoneFromTitle(label) } : null);
    }
    const observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => { timer = undefined; inspect(); }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    inspect();
    return () => { observer.disconnect(); clearTimeout(timer); };
}
