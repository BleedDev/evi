/**
 * Takes tracking parameters out of the links in a message. Only the tracked key=value pairs are cut
 * from the link as it was typed, so everything else in it (other parameters, their encoding, the
 * markdown and punctuation around it) is sent exactly as written.
 */

export const DEFAULT_PARAMS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
    "fbclid", "gclid", "dclid", "msclkid", "igshid", "mc_eid", "si", "ref_src", "ref_url", "_hsenc", "_hsmi",
];

/** | * ] close spoilers, bold and masked links, so a link never runs into them */
const URL_REGEX = /https?:\/\/[^\s<>"'`|*\]]+/g;
/** Code blocks and inline code: links in them are quoted, not shared */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;
/** What ends a sentence or a ~~strikethrough~~ after a link rather than belonging to it */
const TRAILING = ".,!?:;~";

const count = (text: string, char: string) => text.split(char).length - 1;

/** Splits a match into the link and what follows it: trailing punctuation, and a ) that closes a masked link or a bracket */
function splitTail(raw: string): [string, string] {
    let end = raw.length;
    while (end > 0) {
        const char = raw[end - 1];
        const link = raw.slice(0, end);
        if (TRAILING.includes(char) || (char === ")" && count(link, ")") > count(link, "("))) end--;
        else break;
    }
    return [raw.slice(0, end), raw.slice(end)];
}

function decodeKey(key: string) {
    try {
        return decodeURIComponent(key.replace(/\+/g, " "));
    } catch {
        return key;
    }
}

export function cleanLink(link: string, params: Set<string>): string {
    try {
        new URL(link);
    } catch {
        return link;
    }
    const hashAt = link.indexOf("#");
    const beforeHash = hashAt === -1 ? link : link.slice(0, hashAt);
    const hash = hashAt === -1 ? "" : link.slice(hashAt);
    const queryAt = beforeHash.indexOf("?");
    if (queryAt === -1) return link;

    const pairs = beforeHash.slice(queryAt + 1).split("&");
    const kept = pairs.filter(pair => !params.has(decodeKey(pair.split("=")[0])));
    if (kept.length === pairs.length) return link;
    const query = kept.filter(Boolean).join("&");
    return beforeHash.slice(0, queryAt) + (query ? `?${query}` : "") + hash;
}

/** Cleans the links in a message, leaving code alone */
export function cleanMessage(content: string, params: Set<string>): string {
    if (!content?.includes("http")) return content;
    let out = "";
    let last = 0;
    for (const code of content.matchAll(CODE)) {
        out += cleanText(content.slice(last, code.index), params) + code[0];
        last = code.index! + code[0].length;
    }
    return out + cleanText(content.slice(last), params);
}

function cleanText(text: string, params: Set<string>) {
    return text.replace(URL_REGEX, raw => {
        const [link, tail] = splitTail(raw);
        return cleanLink(link, params) + tail;
    });
}
