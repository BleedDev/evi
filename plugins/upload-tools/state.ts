/**
 * Shared state for Upload Tools: its settings, the running context, Discord lookups and how sizes
 * and times read. index.tsx fills it; details.tsx, preview.tsx and edit.tsx read it.
 */
import { filters, find, I18n } from "@evi/api";
import type { PluginContext } from "@evi/api";

import { size, timeLeft } from "./progress";
import { t } from "./strings";

export const settings = {
    details: {
        type: "boolean",
        get label() { return t("settings.details"); },
        get description() { return t("settings.details.description"); },
        default: true,
    },
    taskbar: {
        type: "boolean",
        get label() { return t("settings.taskbar"); },
        get description() { return t("settings.taskbar.description"); },
        default: true,
    },
    previewTools: {
        type: "boolean",
        get label() { return t("settings.previewTools"); },
        get description() { return t("settings.previewTools.description"); },
        default: true,
    },
    editFiles: {
        type: "boolean",
        get label() { return t("settings.editFiles"); },
        get description() { return t("settings.editFiles.description"); },
        default: true,
    },
} as const;

export type Settings = typeof settings;

export const state: { ctx?: PluginContext<Settings>; } = {};

/** Whether a part is on: the plugin is running and its setting is on */
export const isOn = (key: keyof Settings) => !!state.ctx?.settings.get(key);

/**
 * A webpack lookup, kept once found. A miss (Discord renamed it) is searched again at most every 10
 * seconds, since these are asked for while rendering.
 */
export function lookup<T>(search: () => T | undefined): () => T | undefined {
    let value: T | undefined;
    let missedAt = -Infinity;
    return () => {
        if (value !== undefined || performance.now() - missedAt < 10_000) return value;
        value = search();
        if (value === undefined) missedAt = performance.now();
        return value;
    };
}

/** The draft upload actions: addFiles, update, setUploads... (UPLOAD_ATTACHMENT_*) */
export const uploadActions = filters.byProps("addFiles", "setFile", "setUploads");
/** Discord's message actions; patchMessageAttachments is what its own "remove attachment" uses */
export const messageActions = filters.byProps("patchMessageAttachments", "editMessage", "endEditMessage");

/** Discord's CloudUpload: one file, uploaded to Discord's storage before the message is sent */
export const getCloudUpload = lookup<any>(() => find(v => typeof v === "function"
    && typeof v.prototype?.uploadFileToCloud === "function" && typeof v.prototype?.upload === "function"));

const numbers = new Map<string, Intl.NumberFormat>();
function number(n: number) {
    const locale = I18n.discordLocale;
    let format = numbers.get(locale);
    if (!format) {
        try {
            format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
        } catch {
            format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
        }
        numbers.set(locale, format);
    }
    return format.format(n);
}

export function formatSize(bytes: number) {
    const { unit, value } = size(bytes);
    return t(`size.${unit}`, { value: number(value) });
}

export function formatLeft(seconds: number) {
    const { unit, count } = timeLeft(seconds);
    return t(`left.${unit}`, { count });
}

export function formatPercent(fraction: number) {
    return t("edit.percent", { percent: Math.floor(fraction * 100) });
}
