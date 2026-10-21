/**
 * Which links Fix Embeds rewrites, and to what. Each service lists its own hosts, the paths that are
 * a post (a profile or a home page embeds fine as it is) and the fix-up sites that embed its posts,
 * first one the default. These sites come and go, Instagram's most, so each is a choice.
 */

export interface Service {
    id: string;
    /** Shown as is in every language: it's a brand */
    name: string;
    hosts: string[];
    /** Subdomains kept on the fix-up site (TikTok's short links) */
    keepSubdomains?: string[];
    post: RegExp;
    sites: string[];
}

export const SERVICES: Service[] = [
    { id: "twitter", name: "X / Twitter", hosts: ["x.com", "twitter.com"], post: /^\/\w+\/status\/\d+/, sites: ["fixupx.com", "fxtwitter.com", "fixvx.com", "vxtwitter.com"] },
    { id: "instagram", name: "Instagram", hosts: ["instagram.com"], post: /^\/(?:[\w.]+\/)?(?:p|reels?|tv|share)\//, sites: ["kkinstagram.com", "instagramez.com", "ddinstagram.com"] },
    { id: "tiktok", name: "TikTok", hosts: ["tiktok.com"], keepSubdomains: ["vm", "vt"], post: /^\/(?:@[\w.-]+\/(?:video|photo)\/\d+|t\/\w+)/, sites: ["tnktok.com", "vxtiktok.com", "tiktxk.com"] },
    { id: "reddit", name: "Reddit", hosts: ["reddit.com"], post: /^\/r\/\w+\/(?:comments|s)\//, sites: ["rxddit.com", "vxreddit.com"] },
    { id: "bluesky", name: "Bluesky", hosts: ["bsky.app"], post: /^\/profile\/[^/]+\/post\/\w+/, sites: ["fxbsky.app", "bskx.app"] },
    { id: "threads", name: "Threads", hosts: ["threads.net", "threads.com"], post: /^\/@[\w.]+\/post\/[\w-]+/, sites: ["vxthreads.net"] },
    { id: "pixiv", name: "Pixiv", hosts: ["pixiv.net"], post: /^\/(?:\w{2}\/)?artworks\/\d+/, sites: ["phixiv.net"] },
    { id: "tumblr", name: "Tumblr", hosts: ["tumblr.com"], post: /^\/[\w-]+\/\d+/, sites: ["tpmblr.com"] },
];

/** Subdomains that are the same site: www.instagram.com, mobile.x.com, old.reddit.com */
const SAME_SITE = new Set(["www", "m", "mobile", "old", "new"]);

/** Which fix-up site each service uses, or "off" */
export type Choices = Record<string, string>;

/** ) ] | * close masked links, spoilers and bold, so a link never runs into them */
const URL_REGEX = /https?:\/\/[^\s<>"'`)\]|*]+/g;
/** What ends a sentence or a ~~strikethrough~~ after a link rather than belonging to it */
const TRAILING = /[.,!?:;~]+$/;
/** Code blocks and inline code: links in them are quoted, not shared */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

export function fixLink(raw: string, choices: Choices): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return raw;
    }
    const hostname = url.hostname.toLowerCase();
    const labels = hostname.split(".");
    for (const service of SERVICES) {
        const site = choices[service.id];
        if (!site || site === "off") continue;
        const host = service.hosts.find(h => hostname === h || hostname.endsWith(`.${h}`));
        if (!host) continue;
        const sub = labels.slice(0, labels.length - host.split(".").length);
        if (sub.length > 1) return raw;
        const kept = sub[0] && service.keepSubdomains?.includes(sub[0]) ? `${sub[0]}.` : "";
        if (sub[0] && !kept && !SAME_SITE.has(sub[0])) return raw;
        // A short link (vm.tiktok.com/abc) is a post whatever its path
        if (!kept && !service.post.test(url.pathname)) return raw;
        // The query is share tracking (igsh, s=20, is_from_webapp); the fix-up site doesn't need it
        return `https://${kept}${site}${url.pathname}${url.hash}`;
    }
    return raw;
}

/** Rewrites the links in a message, leaving code and <links without an embed> alone */
export function fixMessage(content: string, choices: Choices): string {
    if (!content?.includes("http")) return content;
    let out = "";
    let last = 0;
    for (const code of content.matchAll(CODE)) {
        out += fixText(content.slice(last, code.index), choices) + code[0];
        last = code.index! + code[0].length;
    }
    return out + fixText(content.slice(last), choices);
}

function fixText(text: string, choices: Choices) {
    return text.replace(URL_REGEX, (raw, offset: number) => {
        if (text[offset - 1] === "<") return raw;
        // The fix-up link drops the query, so what follows the link has to be kept out of it
        const tail = TRAILING.exec(raw)?.[0] ?? "";
        return fixLink(raw.slice(0, raw.length - tail.length), choices) + tail;
    });
}
