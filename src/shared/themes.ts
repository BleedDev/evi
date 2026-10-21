import type { ThemeMeta } from "./ipc";
import type { PluginLocales } from "./pluginLocales";
import { englishTr, Tr } from "./tr";

/** Largest theme we download, remote themes are usually well under 200 KB */
export const MAX_THEME_BYTES = 2 * 1024 * 1024;

export const isThemeFile = (file: string) => /\.css$/i.test(file);

/** A plain file name of a theme: no folders, no "..", no hidden files, ends in .css */
export const isPlainThemeFileName = (file: unknown): file is string =>
    typeof file === "string" && isThemeFile(file) && file.length > 4 && !/[\\/:*?"<>|\x00-\x1f]/.test(file) && !file.startsWith(".") && !file.includes("..") && file === file.trim();

/**
 * Reads a BetterDiscord-style header, the first comment of the file:
 *
 *   /**
 *    * @name Midnight
 *    * @description A dark theme
 *    * @author someone
 *    * @version 1.2.0
 *    *\/
 *
 * Tags may also share a line. Missing names fall back to the file name. Other languages add a
 * language code to the tag, `@name:de Mitternacht` or `@description:pt-BR Um tema escuro`, and
 * become `locales` like a plugin's.
 */
export function parseThemeMeta(css: string, file: string): ThemeMeta {
    const header = css.match(/^\s*\/\*([\s\S]*?)\*\//)?.[1] ?? "";
    const tags: Record<string, string> = {};
    const locales: PluginLocales = {};
    // A tag starts after whitespace (so emails don't count) and runs to the next tag or line end
    for (const [, key, lang, value] of header.matchAll(/(?:^|\s)@(\w+)(?::([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?))?[ \t]+(.*?)(?=[ \t]+@\w+(?::[\w-]+)?[ \t]|[ \t]*\r?\n|[ \t]*$)/g)) {
        const k = key.toLowerCase();
        const text = value.trim();
        if (!text) continue;
        if (lang) {
            if (k !== "name" && k !== "description") continue;
            const l = locales[lang] ??= {};
            if (!l[k]) l[k] = text;
        } else if (!(k in tags)) tags[k] = text;
    }

    return {
        file,
        name: tags.name ?? file.replace(/\.css$/i, ""),
        description: tags.description,
        author: tags.author,
        version: tags.version,
        ...Object.keys(locales).length && { locales },
    };
}

/** Why a downloaded body isn't a usable theme, or undefined when it looks like CSS */
export function whyNotCss(text: string, contentType = "", tr: Tr = englishTr): string | undefined {
    const type = contentType.split(";")[0].trim().toLowerCase();
    if (/html|json|javascript|image|video|audio|octet-stream|zip/.test(type)) return tr("check.css.type", { type });
    if (text.includes("\0")) return tr("check.css.binary");
    if (/^\s*</.test(text)) return tr("check.css.page");
    if (!/[{}]|@import/.test(text)) return tr("check.css.noRules");
}

/** A safe file name for a theme downloaded from a URL: always one isPlainThemeFileName accepts, so it can be deleted again */
export function themeFileName(url: URL, meta: { name?: string; }) {
    const segment = url.pathname.split("/").pop() ?? "";
    let last: string;
    try {
        last = decodeURIComponent(segment);
    } catch {
        // A stray % that isn't an escape (a%E0.css): the name as written
        last = segment;
    }
    const base = isThemeFile(last) ? last.replace(/\.css$/i, "") : meta.name || url.hostname;
    const safe = base.replace(/[^\w.-]+/g, "-").replace(/\.{2,}/g, ".").slice(0, 80).replace(/^[-.]+|[-.]+$/g, "") || "theme";
    return `${safe}.css`;
}
