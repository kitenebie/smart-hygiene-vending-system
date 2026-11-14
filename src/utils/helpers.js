// ─── Slot status ────────────────────────────────────────────────────────────
export function slotStatus(stock, threshold) {
    if (stock <= 0)
        return 'empty';
    if (stock <= threshold)
        return 'low';
    return 'ok';
}
// ─── Time ago ────────────────────────────────────────────────────────────────
export function timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60)
        return 'just now';
    if (diff < 3600)
        return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400)
        return Math.floor(diff / 3600) + ' hr ago';
    return Math.floor(diff / 86400) + ' day(s) ago';
}
// UI-safe payment-reference preview: 1234567890 becomes 123****890.
export function maskPaymentReference(reference) {
    if (reference.length <= 2)
        return '*'.repeat(reference.length);
    if (reference.length <= 6)
        return `${reference.slice(0, 1)}${'*'.repeat(reference.length - 2)}${reference.slice(-1)}`;
    return `${reference.slice(0, 3)}${'*'.repeat(reference.length - 6)}${reference.slice(-3)}`;
}
// ─── Format uptime seconds → "6d 14h" ────────────────────────────────────────
export function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    return `${days}d ${hours}h`;
}
// ─── Parse numeric from display strings like "₱10.00" or "5 units" ──────────
export function parseNumber(str) {
    const n = parseFloat(str.replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : n;
}
// ─── Status / level meta maps ────────────────────────────────────────────────
export const statusMeta = {
    ok: { color: 'var(--sage)', tag: 'ok', label: 'In stock' },
    low: { color: 'var(--amber)', tag: 'low', label: 'Low stock' },
    empty: { color: 'var(--rust)', tag: 'empty', label: 'Empty' },
};
export const levelMeta = {
    info: { icon: '✓', color: 'var(--sage)', bg: 'var(--sage-bg)' },
    warning: { icon: '!', color: 'var(--amber)', bg: 'var(--amber-bg)' },
    critical: { icon: '✕', color: 'var(--rust)', bg: 'var(--rust-bg)' },
};
// ─── Client-side CSV export ──────────────────────────────────────────────────
export function downloadCSV(rows, filename) {
    if (!rows.length)
        return;
    const headers = Object.keys(rows[0]);
    const cell = (value) => {
        const text = String(value ?? '');
        const safe = typeof value === 'string' && /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
        return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = [
        headers.map(cell).join(','),
        ...rows.map(r => headers.map(h => cell(r[h])).join(',')),
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
}
