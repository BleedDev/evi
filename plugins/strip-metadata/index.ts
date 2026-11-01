import { definePlugin, filters, showToast } from "@evi/api";
import type { HookContext, PluginContext } from "@evi/api";

import { collectFiles, dropFiles, swapUploadFile, uploadFile } from "./args";
import { askToUpload, closeDialogs, dialogCss, listNames } from "./dialog";
import { t } from "./strings";
import { detectImage, randomFileName, stripMetadata } from "./strip";

/**
 * Picks, drops and pastes go through Discord's upload entry point, (files, channel, draftType,
 * { requireConfirm }). It either queues them with the upload attachment actions
 * (addFiles({ files: [{ file, platform }], channelId, ... })) or, for uploads that skip the queue,
 * sends them right away. addFile queues one (polls, activity shares, image pickers) and setFile
 * replaces an edited attachment. Checked against Discord's code of 2026-10-28: every file someone
 * picks reaches one of these; forum and media posts too, as they're queued like any message's.
 *
 * We hook all of them with `instead`: the File objects found in the arguments are read, cleaned and
 * swapped for new Files before the original runs. Calls carrying no File run straight through,
 * synchronously as before. Queued uploads are cleaned at addFiles rather than at the entry point,
 * because Discord converts HEIC photos to JPEG in between and the JPEG is one we can clean.
 *
 * An image we can't clean (HEIC, AVIF, TIFF, over 100 MB, or one that doesn't parse) never goes out
 * silently: the upload waits while a dialog asks, and "Don't upload" leaves it out of the call.
 *
 * Last of all, every CloudUpload reads its file's name and size through getUploadPayload just before
 * asking where to send it, after Discord's own conversions. Uploads made without the queue (Upload
 * Tools' files added while editing a message, anything else that builds a CloudUpload) are cleaned
 * there. Its callers await it, so it can wait for the cleaning; files cleaned earlier pass straight on.
 */

type Settings = typeof settings;
const settings = {
    stripImages: {
        type: "boolean",
        get label() { return t("settings.stripImages"); },
        get description() { return t("settings.stripImages.description"); },
        default: true,
    },
    randomNames: {
        type: "boolean",
        get label() { return t("settings.randomNames"); },
        get description() { return t("settings.randomNames.description"); },
        default: true,
    },
} as const;

/** Images bigger than this aren't read into memory: they're asked about instead */
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const IMAGE_NAME = /\.(jpe?g|jfif|png|apng|webp|gif)$/i;
/** Images whose metadata we can't remove, by name or type, for when the bytes don't tell */
const UNSUPPORTED_NAME = /\.(hei[cf]s?|avifs?|tiff?|jxl|dng)$/i;
const UNSUPPORTED_TYPE = /^image\/(hei[cf](-sequence)?|avifs?|tiff|jxl|x-adobe-dng)$/i;
const METHODS = ["addFiles", "addFile", "setFile"];

const uploadActions = filters.byProps("addFiles", "clearAll");
/** The entry point: its instant branch sends without the queue, so those files never reach addFiles */
const uploadEntry = filters.byCode("INSTANT_UPLOAD", "requireConfirm");
/** { getUploadPayload(upload) }: the file's name and size for the upload URL, read right before it's sent */
const uploadPayload = filters.byProps("getUploadPayload");

let context: PluginContext<Settings> | undefined;
/** Whether addFiles is hooked, so queued uploads can be left to it */
let queueHooked = false;
/** Files we made or were told to upload as they are, so a call passing them on isn't handled twice */
const handled = new WeakSet<File>();

interface Cleaned {
    file: File;
    /** An image that may still carry its metadata */
    unclean: boolean;
}

async function cleanFile(file: File): Promise<Cleaned> {
    const ctx = context;
    if (!ctx || handled.has(file)) return { file, unclean: false };
    const strip = ctx.settings.get("stripImages");
    const rename = ctx.settings.get("randomNames");
    let parts: BlobPart[] = [file];
    let name = file.name;
    let unclean = false;

    if (strip) {
        // The first bytes find images whatever their name says; reading them doesn't load the file
        const kind = detectImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
        const unsupported = UNSUPPORTED_NAME.test(file.name) || UNSUPPORTED_TYPE.test(file.type);
        const image = !!kind || unsupported || file.type.startsWith("image/") || IMAGE_NAME.test(file.name);
        if (unsupported || (image && file.size > MAX_IMAGE_BYTES)) {
            unclean = true;
        } else if (image) {
            const result = stripMetadata(new Uint8Array(await file.arrayBuffer()));
            if (result.failed) unclean = true;
            else if (result.changed) parts = [result.data as Uint8Array<ArrayBuffer>];
        }
    }
    if (rename) name = randomFileName(file.name);
    if (parts[0] === file && name === file.name) return { file, unclean };
    return { file: new File(parts, name, { type: file.type, lastModified: Date.now() }), unclean };
}

/**
 * The file to upload in place of each one, or null to leave it out: images we couldn't clean are
 * asked about first. Reading a file that fails counts as couldn't clean.
 */
async function prepare(files: File[]): Promise<Map<File, File | null>> {
    const results = await Promise.all(files.map(file => cleanFile(file).catch(err => {
        context?.logger.error("Couldn't clean", file.name, err);
        return { file, unclean: true };
    })));
    const unclean = files.filter((_, i) => results[i].unclean);
    let upload = true;
    if (unclean.length) {
        const answer = await askToUpload(unclean.map(f => f.name)).catch(err => {
            context?.logger.error("Couldn't ask about", unclean.map(f => f.name), err);
            return "stopped" as const;
        });
        upload = answer === "upload";
        // Nobody chose to leave them out: say why they didn't go
        if (answer === "stopped") showToast(t("toast.notUploaded", { count: unclean.length, name: listNames(unclean.map(f => f.name)) }), { type: "failure" });
    }
    const out = new Map<File, File | null>();
    files.forEach((file, i) => {
        const { file: clean, unclean: asked } = results[i];
        if (asked && !upload) return void out.set(file, null);
        handled.add(clean);
        out.set(file, clean);
    });
    return out;
}

/** Cleans the files in the arguments in place. False when the call should be dropped: every file in it was left out */
async function cleanArgs(args: any[]) {
    const found = collectFiles(args);
    const files = [...new Set(found.map(f => f.file))];
    const replacements = await prepare(files);
    const drop = new Set(files.filter(f => replacements.get(f) === null));
    if (drop.size === files.length) return false;

    for (const { owner, key, file } of found) {
        const clean = replacements.get(file);
        if (!clean || clean === file) continue;
        owner[key] = clean;
        // Some upload items carry the name next to the file
        for (const prop of ["name", "filename"]) {
            if (!Array.isArray(owner) && owner[prop] === file.name) owner[prop] = clean.name;
        }
    }
    return !drop.size || dropFiles(args, drop);
}

function hasFiles(args: any[]) {
    return collectFiles(args).some(f => !handled.has(f.file));
}

const enabled = () => !!context && (context.settings.get("stripImages") || context.settings.get("randomNames"));

/** The entry point takes a FileList or an array of Files first */
function interceptEntry(call: HookContext) {
    const [files, ...rest] = call.args;
    const list: unknown[] = files && typeof files === "object" && typeof files.length === "number" ? Array.from(files as ArrayLike<unknown>) : [];
    const queued = rest[2]?.requireConfirm !== false;
    if (!enabled() || (queued && queueHooked) || !list.some(f => f instanceof File && !handled.has(f))) {
        return call.callOriginal(...call.args);
    }
    return prepare(list.filter((f): f is File => f instanceof File)).then(replacements => {
        const kept = list.flatMap(f => f instanceof File ? replacements.get(f) ?? [] : [f]);
        if (kept.length) return call.callOriginal(kept, ...rest);
    });
}

function interceptUpload(call: HookContext) {
    if (!enabled() || !hasFiles(call.args)) {
        return call.callOriginal(...call.args);
    }
    return cleanArgs(call.args).then(go => go ? call.callOriginal(...call.args) : undefined);
}

/** An upload about to be sent: its file cleaned first, or, left out, the upload ended with Discord's own error */
function interceptPayload(call: HookContext) {
    const [upload] = call.args;
    const file = uploadFile(upload);
    if (!enabled() || !file || handled.has(file)) return call.callOriginal(...call.args);
    return prepare([file]).then(replacements => {
        const clean = replacements.get(file);
        if (clean === null) {
            // Discord refuses a payload without a name (INVALID_FILE_ASSET), ending it like any failed upload
            return { ...call.callOriginal(...call.args), filename: "" };
        }
        if (clean && clean !== file) swapUploadFile(upload, clean);
        return call.callOriginal(...call.args);
    });
}

export default definePlugin({
    settings,

    css: dialogCss,

    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            context = undefined;
            queueHooked = false;
            closeDialogs();
        });

        ctx.hookExport("instead", uploadEntry, interceptEntry);
        ctx.waitFor(uploadActions, actions => {
            for (const method of METHODS) {
                if (typeof actions[method] === "function") ctx.hook.instead(actions, method, interceptUpload);
            }
            queueHooked = typeof actions.addFiles === "function";
        });
        ctx.waitFor(uploadPayload, payload => {
            if (typeof payload.getUploadPayload === "function") ctx.hook.instead(payload, "getUploadPayload", interceptPayload);
        });
    },
});
