/**
 * Reordering attachments and building an edit's attachment list, pure so tests/uploadTools.test.ts
 * can check them. No Discord or DOM access here.
 */

/** `list` with the item at `from` moved to `to` */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
    const out = [...list];
    if (from < 0 || from >= out.length) return out;
    const [item] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
    return out;
}

/**
 * Every upload in the new order, when only some of them are shown (Discord hides the one being
 * edited): the shown ones take the shown ones' places in `shown` order, the rest stay where they are.
 */
export function reorderShown<T extends { id: string; }>(all: readonly T[], shown: readonly T[]): T[] {
    const ids = new Set(shown.map(u => u.id));
    const queue = shown.filter(u => all.some(a => a.id === u.id));
    if (queue.length !== all.filter(a => ids.has(a.id)).length) return [...all];
    let next = 0;
    return all.map(u => ids.has(u.id) ? queue[next++] : u);
}

export interface Rect { left: number; top: number; width: number; height: number; }

/** The slot whose centre is closest to the pointer, in any layout (a row, or rows that wrap) */
export function nearestSlot(slots: readonly Rect[], x: number, y: number): number {
    let best = -1, bestDistance = Infinity;
    slots.forEach((s, i) => {
        const d = (s.left + s.width / 2 - x) ** 2 + (s.top + s.height / 2 - y) ** 2;
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    });
    return best;
}

/** Where the item at `index` sits while the one at `from` is held over `to`: the ones between shift by one */
export function shiftedIndex(index: number, from: number, to: number): number {
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
}

/** Discord takes up to 10 attachments on a message */
export const MAX_ATTACHMENTS = 10;

/** How many more files a message with `existing` attachments can take, with `pending` already picked */
export function roomFor(existing: number, pending: number, max = MAX_ATTACHMENTS): number {
    return Math.max(0, max - existing - pending);
}

export interface Uploaded { filename: string; uploadedFilename: string; spoiler?: boolean; description?: string | null; }

/**
 * The `attachments` of an edit that adds files: every attachment the message has, by id (so none is
 * removed), then each new one by its place in the list, pointing at the file already uploaded to
 * Discord's storage, like Discord's own messages with attachments are sent.
 */
export interface EditAttachment { id: string; filename?: string; uploaded_filename?: string; is_spoiler?: boolean; description?: string; }

export function editAttachments(existing: readonly { id: string; }[], added: readonly Uploaded[]): EditAttachment[] {
    return [
        ...existing.map(a => ({ id: a.id })),
        ...added.map((u, i) => ({
            id: String(i),
            filename: u.filename,
            uploaded_filename: u.uploadedFilename,
            ...u.spoiler ? { is_spoiler: true } : {},
            ...u.description ? { description: u.description } : {},
        })),
    ];
}
