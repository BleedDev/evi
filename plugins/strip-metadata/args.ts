/**
 * Finding and taking out the File objects in an upload call's arguments, whatever shape Discord
 * gives them: a FileList or array of Files, upload items ({ file, platform, ... }) in an array, or
 * one item or File passed on its own. Arrays and plain objects are followed a few levels deep.
 */

export type FoundFile = { owner: any; key: PropertyKey; file: File; };

const isPlain = (v: unknown): v is object => !!v && typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);

/** Finds every File in the arguments */
export function collectFiles(value: unknown, found: FoundFile[] = [], depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return found;
    const entries: [PropertyKey, unknown][] = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
    for (const [key, v] of entries) {
        if (v instanceof File) found.push({ owner: value, key, file: v });
        else if (isPlain(v)) collectFiles(v, found, depth + 1);
    }
    return found;
}

function dropIn(value: unknown, drop: Set<File>, depth: number): boolean {
    if (!isPlain(value) || depth > 4) return true;
    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
            const v = value[i];
            const holds = v instanceof File ? drop.has(v) : isPlain(v) && !Array.isArray(v) && Object.values(v).some(x => x instanceof File && drop.has(x));
            if (holds) value.splice(i, 1);
            else if (!dropIn(v, drop, depth + 1)) return false;
        }
        return true;
    }
    for (const v of Object.values(value)) {
        if (v instanceof File ? drop.has(v) : !dropIn(v, drop, depth + 1)) return false;
    }
    return true;
}

/**
 * Takes files out of a call's arguments, in place: an array item that is one, or an upload item
 * holding one, is removed. False when one sits where it can't be taken out (passed on its own, or
 * as the single item of an addFile call), so the call can't go ahead without it.
 */
export function dropFiles(args: unknown[], drop: Set<File>): boolean {
    return args.every(arg => arg instanceof File ? !drop.has(arg) : dropIn(arg, drop, 1));
}

/** What of Discord's CloudUpload a swap touches: the file it sends, its size, its name */
export interface UploadLike {
    item?: { file?: unknown; };
    currentSize?: number;
    setFilename?: (name: string) => void;
}

/** The File an upload is about to send, if it holds one */
export function uploadFile(upload: unknown): File | undefined {
    const file = (upload as UploadLike | null)?.item?.file;
    return file instanceof File ? file : undefined;
}

/**
 * Puts the cleaned file in an upload the way Discord's own HEIC conversion does: the file, the size
 * it checks against the limit, and the name it shows and sends.
 */
export function swapUploadFile(upload: UploadLike, file: File) {
    if (!upload.item) return;
    upload.item.file = file;
    upload.currentSize = file.size;
    if (typeof upload.setFilename === "function") upload.setFilename(file.name);
}
