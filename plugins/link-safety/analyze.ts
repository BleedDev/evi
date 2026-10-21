import type { SourcePatch } from "@evi/api";

/**
 * Pure pieces of Link Safety: the link analysis and the source patch, free of Discord and Evi
 * runtime imports so tests can run them directly.
 *
 * analyzeLink() looks at where a link really goes (and, for masked links, what it claims to be)
 * and returns a risk level with plain-language reasons. "info" findings are shown but never raise
 * the level on their own.
 */

export type RiskLevel = "safe" | "caution" | "danger";
export type FindingLevel = "info" | "caution" | "danger";

export interface Finding {
    level: FindingLevel;
    code: string;
    message: string;
    /** Translation key when the same code has more than one wording (defaults to the code) */
    key?: string;
    /** Values the wording is built from, so the dialog can say it in another language */
    vars?: Record<string, string>;
}

export interface UrlParts {
    /** "https://" plus any user:password@ part */
    prefix: string;
    /** Subdomains, with the trailing dot ("cdn.") */
    subdomain: string;
    /** The registrable domain, the part that decides who runs the site ("discordapp.com") */
    domain: string;
    /** Port, path, query and fragment */
    rest: string;
}

export interface Analysis {
    level: RiskLevel;
    url: string;
    /** Hostname as the browser sees it (punycode), empty when the link couldn't be read */
    hostname: string;
    /** Hostname with punycode decoded, for display */
    displayHostname: string;
    /** The registrable domain ("discordapp.com" for cdn.discordapp.com) */
    domain: string;
    findings: Finding[];
    parts?: UrlParts;
}

export interface AnalyzeOptions {
    /** What the link shows in chat, for masked links */
    text?: string;
    /** Domains the user trusts: the domain and all its subdomains are safe */
    allowlist?: readonly string[];
}

const RANK: Record<FindingLevel | RiskLevel, number> = { safe: 0, info: 0, caution: 1, danger: 2 };

/** Whether a result should show the warning, for a threshold of "caution" or "danger" */
export function meetsThreshold(level: RiskLevel, threshold: RiskLevel) {
    return RANK[level] > 0 && RANK[level] >= RANK[threshold];
}

/** Two-part public suffixes that matter for the domains people link, plus free hosting platforms */
const MULTI_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au", "edu.au", "co.nz", "org.nz",
    "co.jp", "ne.jp", "or.jp", "ac.jp", "com.br", "net.br", "org.br", "com.mx", "com.tr", "com.cn", "net.cn", "com.hk", "com.tw",
    "co.in", "net.in", "org.in", "co.kr", "or.kr", "co.za", "com.ar", "com.pl", "com.ua", "com.ru", "com.sg", "com.my", "co.id",
    "com.ph", "com.vn", "co.il", "com.eg", "com.sa", "co.th", "com.co", "com.pe", "com.es", "co.at", "com.de",
]);

/** Where anyone can get a subdomain: the subdomain is the site's owner */
const HOSTING_SUFFIXES = new Set([
    "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app", "herokuapp.com", "web.app", "firebaseapp.com",
    "glitch.me", "repl.co", "replit.app", "replit.dev", "blogspot.com", "weebly.com", "wixsite.com", "000webhostapp.com", "ngrok.io",
    "ngrok-free.app", "ngrok.app", "trycloudflare.com", "onrender.com", "fly.dev", "surge.sh", "webflow.io", "carrd.co", "square.site",
    "godaddysites.com", "azurewebsites.net", "js.org", "framer.website", "framer.app",
]);

const SHORTENERS = new Set([
    "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "v.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at",
    "rb.gy", "tiny.cc", "t.ly", "s.id", "bit.do", "lnkd.in", "adf.ly", "shorte.st", "ouo.io", "bl.ink", "qrco.de", "tiny.one", "shrtco.de",
    "clck.ru", "u.to", "linktr.ee", "href.li", "urlz.fr", "soo.gd", "short.io", "surl.li", "gg.gg", "rotf.lol", "y2u.be",
]);

export function normalizeDomain(value: string) {
    let d = value.trim().toLowerCase();
    d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\*\./, "").replace(/^\.+/, "");
    d = d.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.+$/, "");
    return d;
}

/** Splits a free-form list ("a.com, b.org\nc.net") into normalised domains */
export function parseAllowlist(value: unknown): string[] {
    if (typeof value !== "string") return [];
    return value.split(/[\s,;]+/).map(normalizeDomain).filter(d => d.includes("."));
}

const isIPv4 = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
const isIP = (host: string) => isIPv4(host) || host.startsWith("[") || host.includes(":");

/** The part of a hostname that decides who runs the site: cdn.discordapp.com -> discordapp.com */
export function registrableDomain(host: string) {
    host = host.toLowerCase().replace(/\.$/, "");
    if (isIP(host)) return host;
    const labels = host.split(".");
    if (labels.length <= 2) return host;
    const last2 = labels.slice(-2).join(".");
    const last3 = labels.slice(-3).join(".");
    if (HOSTING_SUFFIXES.has(last2) || MULTI_SUFFIXES.has(last2)) return labels.length >= 3 ? last3 : host;
    if (HOSTING_SUFFIXES.has(last3)) return labels.length >= 4 ? labels.slice(-4).join(".") : host;
    return last2;
}

/** The public suffix of a registrable domain ("com", "co.uk", "vercel.app") */
function suffixOf(domain: string) {
    const labels = domain.split(".");
    const last2 = labels.slice(-2).join(".");
    if (labels.length >= 3 && (HOSTING_SUFFIXES.has(last2) || MULTI_SUFFIXES.has(last2))) return last2;
    const last3 = labels.slice(-3).join(".");
    if (labels.length >= 4 && HOSTING_SUFFIXES.has(last3)) return last3;
    return labels[labels.length - 1];
}

const withinDomain = (host: string, domain: string) => host === domain || host.endsWith("." + domain);

interface Brand {
    name: string;
    /** Names people imitate ("discord", "discordapp") */
    keys: string[];
    /** Registrable domains the brand runs */
    domains: string[];
    /** Its name under a country TLD (google.de, paypal.co.uk) is also the brand */
    countryTlds?: boolean;
}

export const BRANDS: Brand[] = [
    {
        name: "Discord",
        keys: ["discord", "discordapp"],
        domains: [
            "discord.com", "discord.gg", "discord.gift", "discordapp.com", "discordapp.net", "discord.media", "discord.new", "discord.dev",
            "discord.co", "discordstatus.com", "discord.design", "discord.store", "discordmerch.com", "dis.gd", "discord.tools",
            "discordcdn.com", "discord.gifts",
        ],
    },
    {
        name: "Steam",
        keys: ["steamcommunity", "steampowered"],
        domains: [
            "steamcommunity.com", "steampowered.com", "steamstatic.com", "steamgames.com", "steamusercontent.com", "steamserver.net",
            "steamchina.com", "steamdeck.com", "s.team", "valvesoftware.com", "steamcontent.com", "steam-chat.com", "steam.tv",
        ],
    },
    { name: "PayPal", keys: ["paypal"], domains: ["paypal.com", "paypal.me", "paypalobjects.com"], countryTlds: true },
    {
        name: "Google",
        keys: ["google", "gmail"],
        domains: ["google.com", "gmail.com", "googleapis.com", "gstatic.com", "googleusercontent.com", "googlevideo.com", "goo.gl", "g.co", "withgoogle.com", "google.dev"],
        countryTlds: true,
    },
    { name: "YouTube", keys: ["youtube"], domains: ["youtube.com", "youtu.be", "ytimg.com", "youtube-nocookie.com", "youtubekids.com", "youtube.be"], countryTlds: true },
    { name: "GitHub", keys: ["github"], domains: ["github.com", "githubusercontent.com", "githubassets.com", "github.dev", "githubstatus.com", "github.blog", "ghcr.io"] },
    { name: "Roblox", keys: ["roblox"], domains: ["roblox.com", "rbxcdn.com", "roblox.qq.com", "rbx.com", "robloxlabs.com", "roblox.cn"] },
    { name: "Epic Games", keys: ["epicgames"], domains: ["epicgames.com", "epicgames.dev", "unrealengine.com", "fortnite.com", "epicgamescdn.com"] },
    { name: "Twitch", keys: ["twitch"], domains: ["twitch.tv", "twitchcdn.net", "twitchsvc.net", "jtvnw.net", "twitch.com"] },
    { name: "X (Twitter)", keys: ["twitter"], domains: ["x.com", "twitter.com", "t.co", "twimg.com", "fxtwitter.com", "vxtwitter.com", "fixupx.com", "fixvx.com"] },
    { name: "Instagram", keys: ["instagram"], domains: ["instagram.com", "cdninstagram.com", "ig.me", "instagr.am", "ddinstagram.com"] },
    { name: "Facebook", keys: ["facebook"], domains: ["facebook.com", "fb.com", "fbcdn.net", "fb.me", "messenger.com", "facebook.net", "meta.com"] },
    {
        name: "Microsoft",
        keys: ["microsoft", "outlook", "xbox"],
        domains: ["microsoft.com", "microsoftonline.com", "live.com", "outlook.com", "office.com", "xbox.com", "azure.com", "msn.com", "bing.com", "windows.com", "office365.com", "sharepoint.com", "onedrive.com", "microsoft365.com", "xboxlive.com", "skype.com"],
        countryTlds: true,
    },
    { name: "Apple", keys: ["apple", "icloud"], domains: ["apple.com", "icloud.com", "apple.news", "mzstatic.com", "me.com"] },
    { name: "Amazon", keys: ["amazon"], domains: ["amazon.com", "amazonaws.com", "amzn.to", "amzn.eu", "media-amazon.com", "ssl-images-amazon.com", "amazon.dev"], countryTlds: true },
    { name: "Netflix", keys: ["netflix"], domains: ["netflix.com", "nflxext.com", "nflximg.net", "nflxvideo.net"] },
    { name: "Spotify", keys: ["spotify"], domains: ["spotify.com", "spotify.link", "scdn.co", "spotifycdn.com", "spoti.fi"] },
    { name: "Reddit", keys: ["reddit"], domains: ["reddit.com", "redd.it", "redditmedia.com", "redditstatic.com", "reddithelp.com", "redditinc.com"] },
    { name: "TikTok", keys: ["tiktok"], domains: ["tiktok.com", "tiktokcdn.com", "tiktokv.com", "tiktokcdn-us.com"] },
    { name: "Minecraft", keys: ["minecraft", "mojang"], domains: ["minecraft.net", "mojang.com", "minecraft.com", "minecraftservices.com"] },
    { name: "Riot Games", keys: ["riotgames", "leagueoflegends"], domains: ["riotgames.com", "leagueoflegends.com", "playvalorant.com", "riotcdn.net"] },
    { name: "Coinbase", keys: ["coinbase"], domains: ["coinbase.com", "cb.com"] },
    { name: "MetaMask", keys: ["metamask"], domains: ["metamask.io"] },
];

/** Third-party sites with a brand in their name that people share a lot */
const KNOWN_SAFE = new Set([
    "steamdb.info", "discord.me", "discords.com", "discordbotlist.com", "discordservers.com", "discordjs.dev", "discordpy.readthedocs.io",
    "discordlookup.com", "twitchtracker.com", "twitchmetrics.net", "googleblog.com", "githubassets.com", "robloxden.com",
    "facebookmail.com", "spotifycharts.com", "discord.js.org", "discohook.org", "discordtemplates.me", "betterdiscord.app", "discordapp.page",
]);

const BRAND_DOMAINS = new Map<string, Brand>();
for (const brand of BRANDS) for (const d of brand.domains) BRAND_DOMAINS.set(d, brand);

/** The brand that runs a registrable domain, if it's a well known one */
export function officialBrand(domain: string): Brand | undefined {
    const direct = BRAND_DOMAINS.get(domain);
    if (direct) return direct;
    for (const brand of BRANDS) {
        if (!brand.countryTlds) continue;
        const [name, ...rest] = domain.split(".");
        if (!brand.keys.includes(name)) continue;
        const suffix = rest.join(".");
        if (/^[a-z]{2}$/.test(suffix) || /^(?:co|com)\.[a-z]{2}$/.test(suffix)) return brand;
    }
    return undefined;
}

/** Characters that look like Latin letters or digits that look like letters, mapped to what they imitate */
const CONFUSABLES: Record<string, string> = {
    // Cyrillic
    "а": "a", "в": "b", "е": "e", "ё": "e", "һ": "h", "і": "i", "ї": "i", "ј": "j", "к": "k", "ӏ": "l", "м": "m", "н": "h", "о": "o",
    "р": "p", "с": "c", "ѕ": "s", "т": "t", "у": "y", "х": "x", "ԁ": "d", "ԛ": "q", "ԝ": "w", "ү": "y", "ɡ": "g", "ց": "g", "ո": "n",
    "ս": "u", "օ": "o", "զ": "q", "հ": "h", "ᴠ": "v", "ʏ": "y", "ɩ": "i", "ı": "i", "ȷ": "j",
    // Greek
    "α": "a", "β": "b", "ε": "e", "η": "n", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
    "γ": "y", "μ": "u",
    // Digits and symbols that stand in for letters
    "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "$": "s", "@": "a", "|": "l", "!": "l",
};

/**
 * A comparison form where lookalikes collapse together: "dlscord", "d1scord", "disсord" (Cyrillic
 * с) and "discord" all give the same skeleton.
 */
export function skeleton(value: string) {
    let s = value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
    s = [...s].map(c => CONFUSABLES[c] ?? c).join("");
    return s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d").replace(/i/g, "l").replace(/-/g, "");
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swaps of neighbours */
export function editDistance(a: string, b: string) {
    const rows = a.length + 1, cols = b.length + 1;
    const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[rows - 1][cols - 1];
}

/** RFC 3492 decoding of one label's payload (without the "xn--") */
function punycodeDecode(input: string): string | null {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const output: number[] = [];
    let n = 128, i = 0, bias = 72;
    const basic = input.lastIndexOf("-");
    for (let j = 0; j < Math.max(basic, 0); j++) {
        if (input.charCodeAt(j) >= 128) return null;
        output.push(input.charCodeAt(j));
    }
    const digit = (c: number) => (c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base);
    const adapt = (delta: number, points: number, first: boolean) => {
        let k = 0;
        delta = first ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / points);
        for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
        return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    };
    for (let pos = basic > 0 ? basic + 1 : 0; pos < input.length;) {
        const oldI = i;
        for (let w = 1, k = base; ; k += base) {
            if (pos >= input.length) return null;
            const dg = digit(input.charCodeAt(pos++));
            if (dg >= base) return null;
            i += dg * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (dg < t) break;
            w *= base - t;
            if (w > 1e9) return null;
        }
        bias = adapt(i - oldI, output.length + 1, oldI === 0);
        n += Math.floor(i / (output.length + 1));
        i %= output.length + 1;
        if (n > 0x10ffff) return null;
        output.splice(i++, 0, n);
    }
    return String.fromCodePoint(...output);
}

/** A hostname with its xn-- labels shown as the characters they stand for */
export function decodeHostname(host: string) {
    return host.split(".").map(label => {
        if (!label.toLowerCase().startsWith("xn--")) return label;
        return punycodeDecode(label.slice(4).toLowerCase()) ?? label;
    }).join(".");
}

type Script = "latin" | "cyrillic" | "greek" | "armenian" | "other";

function scriptOf(char: string): Script | null {
    const c = char.codePointAt(0)!;
    if ((c >= 48 && c <= 57) || c === 45 || c === 95) return null;
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 0xc0 && c <= 0x24f) || (c >= 0x1e00 && c <= 0x1eff)) return "latin";
    if (c >= 0x400 && c <= 0x52f) return "cyrillic";
    if (c >= 0x370 && c <= 0x3ff) return "greek";
    if (c >= 0x530 && c <= 0x58f) return "armenian";
    return "other";
}

/** Labels that mix Latin with Cyrillic, Greek or Armenian letters (or those with each other) */
export function mixedScriptLabels(host: string) {
    const confusable = new Set<Script>(["cyrillic", "greek", "armenian"]);
    return host.split(".").filter(label => {
        const scripts = new Set([...label].map(scriptOf).filter((s): s is Script => s != null && s !== "other"));
        const odd = [...scripts].filter(s => confusable.has(s));
        return odd.length > 1 || (odd.length === 1 && scripts.has("latin"));
    });
}

const DOMAIN_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^\s/@:]+(?::[^\s/@]*)?@)?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]\S*)?$/iu;
const DOMAIN_IN_TEXT = /(?:^|[\s(<"'])((?:https?:\/\/)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:com|net|org|gg|gift|io|co|app|dev|tv|me|xyz|ru|gl|ly|be|info|link|site|shop|store|online|top|click|live|pro|uk|de|fr|us)(?:[/?#][^\s)>"']*)?)(?=$|[\s)>"'.,!?:;])/iu;

/** The hostname a piece of link text shows, if it looks like an address */
export function hostnameInText(text: string): { host: string; whole: boolean; } | null {
    const trimmed = text.trim().replace(/^<(.*)>$/, "$1").replace(/[.,!?:;]+$/, "");
    if (!trimmed || trimmed.length > 2048) return null;
    const parse = (value: string) => {
        try {
            const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
            return url.hostname.toLowerCase().replace(/\.$/, "") || null;
        } catch {
            return null;
        }
    };
    if (DOMAIN_LIKE.test(trimmed)) {
        const host = parse(trimmed);
        if (host) return { host, whole: true };
    }
    const inner = DOMAIN_IN_TEXT.exec(trimmed);
    if (inner) {
        const host = parse(inner[1]);
        if (host) return { host, whole: false };
    }
    return null;
}

const SCAM_WORDS = ["gift", "nitro", "free", "promo", "claim", "drop", "airdrop", "login", "verify", "verification", "auth", "oauth", "trade",
    "giveaway", "bonus", "reward", "secure", "account", "support", "qr", "wallet", "skins", "case", "offer", "event", "prize", "appeal", "staff"];

const SCAM_PATTERNS: { id: string; re: RegExp; what: string; }[] = [
    { id: "free-nitro", re: /free[-_.\s]*(?:discord[-_.\s]*)?nitro/, what: "free Nitro" },
    { id: "nitro-giveaway", re: /nitro[-_.\s]*(?:gift|free|drop|claim|generator|gen)s?\b/, what: "a Nitro giveaway" },
    { id: "discord-gift", re: /discord[-_.]?(?:gift|nitro|airdrop|promo|drop|claim)s?/, what: "a Discord gift" },
    { id: "steam", re: /steam[-_.]?(?:gift|giveaway|trade[-_.]?offer|free|drop|claim|skins?)s?/, what: "a Steam gift or trade" },
    { id: "currency", re: /(?:free|claim)[-_.\s]*(?:robux|vbucks|v-bucks|skins?|cs2?[-_.]?skins?)/, what: "free in-game currency or skins" },
    { id: "crypto", re: /(?:airdrop|claim)[-_.\s]*(?:crypto|token|nft|eth|btc|usdt)/, what: "a crypto airdrop" },
];

const DANGEROUS_EXTENSIONS = new Set([
    "exe", "scr", "bat", "cmd", "msi", "msp", "apk", "xapk", "apkm", "jar", "vbs", "vbe", "ps1", "psm1", "pif", "hta", "lnk", "reg", "dll",
    "cpl", "wsf", "wsh", "jse", "msix", "msixbundle", "appx", "appxbundle", "dmg", "pkg", "iso", "img", "vhd", "vhdx", "com", "gadget",
    "application", "run", "sh", "deb", "rpm", "ipa", "inf", "sys", "chm", "scf", "url", "xll", "docm", "xlsm", "pptm",
]);

/** TLDs that read like file names */
const FILE_LIKE_TLDS = new Set(["zip", "mov"]);

function brandLookalike(domain: string, displayDomain: string): Finding | null {
    if (officialBrand(domain) || KNOWN_SAFE.has(domain)) return null;
    const suffix = suffixOf(displayDomain);
    const name = displayDomain.slice(0, -(suffix.length + 1)).toLowerCase();
    if (!name) return null;
    const flat = name.replace(/-/g, "");
    const tokens = name.split(/[-.]/).filter(t => t.length >= 3);
    const hasScamWord = SCAM_WORDS.some(w => name.includes(w));
    const nameSkeleton = skeleton(name);
    const candidates = new Set([nameSkeleton, ...tokens.map(skeleton)]);

    // Exact names and lookalikes first, for every brand, so "discordapp.io" isn't reported as merely mentioning "discord"
    for (const brand of BRANDS) {
        const official = brand.domains[0];
        for (const key of brand.keys) {
            if (name === key) {
                return { level: "danger", code: "brand-tld", vars: { brand: brand.name, domain: displayDomain, official }, message: `Uses ${brand.name}'s name on a domain ${brand.name} doesn't own: this is ${displayDomain}, not ${official}.` };
            }
            if (nameSkeleton === skeleton(key)) {
                return { level: "danger", code: "lookalike", key: "lookalike-swap", vars: { brand: brand.name, domain: displayDomain, official }, message: `${displayDomain} is made to look like ${official} by swapping lookalike characters. It isn't run by ${brand.name}.` };
            }
        }
    }

    for (const brand of BRANDS) {
        const official = brand.domains[0];
        for (const key of brand.keys) {
            if (key.length < 5) continue;
            const keySkeleton = skeleton(key);
            if (flat.includes(key) || tokens.includes(key)) {
                return hasScamWord
                    ? { level: "danger", code: "brand-scam", vars: { brand: brand.name, domain: displayDomain }, message: `Puts ${brand.name}'s name next to words like "gift", "free" or "login" on a site ${brand.name} doesn't run (${displayDomain}). That's how most phishing links look.` }
                    : { level: "caution", code: "brand-mention", vars: { brand: brand.name, domain: displayDomain }, message: `Has ${brand.name}'s name in it but isn't one of ${brand.name}'s sites: ${displayDomain} is run by someone else.` };
            }
            if (nameSkeleton.includes(keySkeleton)) {
                return { level: "danger", code: "lookalike", vars: { brand: brand.name, domain: displayDomain }, message: `${displayDomain} imitates ${brand.name}'s name with lookalike characters. It isn't run by ${brand.name}.` };
            }
            if (key.length < 6) continue;
            const max = key.length >= 10 ? 2 : 1;
            for (const candidate of candidates) {
                if (Math.abs(candidate.length - keySkeleton.length) > max) continue;
                if (editDistance(candidate, keySkeleton) <= max) {
                    return {
                        // Long names don't get mistyped into a registered domain by accident
                        level: hasScamWord || key.length >= 10 ? "danger" : "caution",
                        code: "typosquat",
                        vars: { domain: displayDomain, official },
                        message: `${displayDomain} is one or two letters off from ${official}. Typo domains like this are often used to steal accounts.`,
                    };
                }
            }
        }
    }
    return null;
}

/**
 * Analyses where a link goes. Pass the text the link shows in chat to catch masked links that
 * claim to be somewhere else.
 */
export function analyzeLink(href: string, options: AnalyzeOptions = {}): Analysis {
    const findings: Finding[] = [];
    const add = (level: FindingLevel, code: string, message: string, vars?: Record<string, string>, key?: string) => void findings.push({ level, code, message, ...(key && { key }), ...(vars && { vars }) });
    const result = (url: string, hostname: string, extra: Partial<Analysis> = {}): Analysis => {
        const level = findings.reduce<RiskLevel>((max, f) => (RANK[f.level] > RANK[max] ? (f.level as RiskLevel) : max), "safe");
        return { level, url, hostname, displayHostname: decodeHostname(hostname), domain: registrableDomain(hostname), findings, ...extra };
    };

    const raw = (href ?? "").trim();
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        add("caution", "unreadable", "This link couldn't be read as a normal web address.");
        return result(raw, "");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return result(url.href, url.hostname);

    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const displayHost = decodeHostname(host);
    const domain = registrableDomain(host);
    const displayDomain = registrableDomain(displayHost);
    const subLength = host.length - domain.length;
    const parts: UrlParts = {
        prefix: `${url.protocol}//${url.username || url.password ? `${url.username}${url.password ? `:${url.password}` : ""}@` : ""}`,
        subdomain: displayHost.slice(0, displayHost.length - displayDomain.length) || (subLength > 0 ? host.slice(0, subLength) : ""),
        domain: displayDomain,
        rest: `${url.port ? `:${url.port}` : ""}${url.pathname === "/" && !url.search && !url.hash && !raw.endsWith("/") ? "" : url.pathname}${url.search}${url.hash}`,
    };
    const done = () => result(url.href, host, { parts, displayHostname: displayHost });

    const allowlist = (options.allowlist ?? []).map(normalizeDomain).filter(Boolean);
    if (allowlist.some(d => withinDomain(host, d))) {
        add("info", "allowlisted", `${displayDomain} is on your allowlist.`, { domain: displayDomain });
        return done();
    }

    const brand = officialBrand(domain);
    const official = brand != null;

    // What a masked link claims vs where it goes
    if (options.text) {
        const shown = hostnameInText(options.text);
        if (shown && shown.host !== host) {
            const shownDomain = registrableDomain(shown.host);
            const shownBrand = officialBrand(shownDomain);
            const sameOwner = shownDomain === domain || (shownBrand != null && shownBrand === brand);
            if (!sameOwner) {
                const shownDisplay = decodeHostname(shown.host);
                const message = `The link says ${shownDisplay} but actually goes to ${displayHost}.`;
                if (shown.whole) add(official ? "caution" : "danger", "masked-mismatch", message, { shown: shownDisplay, host: displayHost });
                else add("caution", "masked-mention", `The link text mentions ${shownDisplay}, but the link goes to ${displayHost}.`, { shown: shownDisplay, host: displayHost });
            }
        }
    }

    // https://discord.com@evil.xyz goes to evil.xyz
    if (url.username || url.password) {
        const fake = decodeURIComponent(url.username);
        const looksLikeHost = /\./.test(fake) || /\./.test(url.password);
        add(
            looksLikeHost || !official ? "danger" : "caution",
            "userinfo",
            looksLikeHost
                ? `Everything before the "@" is ignored: this link starts with "${fake}" but goes to ${displayHost}.`
                : `The link has a hidden "name@" part before the address. It goes to ${displayHost}.`,
            { fake, host: displayHost },
            looksLikeHost ? "userinfo-host" : "userinfo-hidden",
        );
    }

    if (isIP(host)) {
        add("caution", "ip-address", `Goes to a bare IP address (${host}) instead of a named website. Real services almost never link like this.`, { host });
    } else {
        // Punycode and lookalike scripts
        const mixed = mixedScriptLabels(displayHost);
        if (mixed.length) {
            add("danger", "mixed-script", `The address mixes alphabets (like Latin with Cyrillic or Greek) in "${mixed.join(".")}", a trick to make a fake domain look real.`, { labels: mixed.join(".") });
        } else if (host.split(".").some(l => l.startsWith("xn--"))) {
            add("caution", "punycode", `The address uses international characters (${displayHost}, written ${host}). Some of these are lookalikes of normal letters.`, { display: displayHost, host });
        }

        // discord.com.evil.xyz
        if (!official) {
            for (const b of BRANDS) {
                const hit = b.domains.find(d => host.startsWith(d + ".") && d !== domain);
                if (hit) {
                    add("danger", "subdomain-trick", `Starts with ${hit} but the site is really ${displayDomain}. Everything to the left of it is just a label its owner picked.`, { hit, domain: displayDomain });
                    break;
                }
            }
        }

        const lookalike = brandLookalike(domain, displayDomain);
        if (lookalike) findings.push(lookalike);

        const tld = host.slice(host.lastIndexOf(".") + 1);
        if (FILE_LIKE_TLDS.has(tld)) add("caution", "file-tld", `The address ends in .${tld}, which looks like a file name but is a website.`, { tld });

        if (SHORTENERS.has(domain) || SHORTENERS.has(host)) {
            add("info", "shortener", `${displayDomain} is a link shortener: where it really leads is hidden until you open it.`, { domain: displayDomain });
        }
        const suffix = suffixOf(domain);
        if (HOSTING_SUFFIXES.has(suffix) && !official) {
            add("info", "free-hosting", `Hosted on ${suffix}, where anyone can make a site for free.`, { suffix });
        }
    }

    // Scam wording in the address or the text
    if (!official) {
        let decodedPath = url.pathname + url.search;
        try {
            decodedPath = decodeURIComponent(decodedPath);
        } catch { /* keep it encoded */ }
        const haystacks = [displayHost, decodedPath, options.text ?? ""].map(s => s.toLowerCase());
        const scam = SCAM_PATTERNS.find(p => haystacks.some(h => p.re.test(h)));
        if (scam) {
            const inHost = scam.re.test(displayHost.toLowerCase());
            add(inHost ? "danger" : "caution", "scam-words", `Mentions ${scam.what}, the most common bait in Discord scams.`, { what: scam.what }, `scam-words-${scam.id}`);
        }
    }

    // Programs and installers
    let file = url.pathname.split("/").pop() ?? "";
    try {
        file = decodeURIComponent(file);
    } catch { /* keep it encoded */ }
    const pieces = file.toLowerCase().split(".");
    if (pieces.length >= 2) {
        const ext = pieces[pieces.length - 1];
        const isDomainRoot = url.pathname === "/" || url.pathname === "";
        if (DANGEROUS_EXTENSIONS.has(ext) && !isDomainRoot) {
            const fake = pieces[pieces.length - 2];
            const doubled = pieces.length >= 3 && /^(?:png|jpe?g|gif|webp|mp4|mp3|pdf|txt|docx?|xlsx?|zip|rar)$/.test(fake);
            add(
                doubled ? "danger" : "caution",
                "dangerous-file",
                doubled
                    ? `Downloads "${file}", a program disguised as a .${fake} file.`
                    : `Downloads a .${ext} file ("${file}"), which can run code on your computer. Only open it if you trust the sender.`,
                doubled ? { file, fake } : { file, ext },
                doubled ? "dangerous-file-disguised" : "dangerous-file",
            );
        }
    }

    if (url.protocol === "http:" && findings.every(f => f.level === "info")) {
        add("info", "http", "The connection to this site isn't encrypted (http).");
    }

    return done();
}

/**
 * Discord's link click handler (the one behind masked links, plain links and embeds). Right after
 * it builds its "open the link" function, and before its blocked-domain and "Leaving Discord"
 * checks, we ask the plugin first:
 *
 *     function V(){(w&&p.A.trackAnnouncementMessageLinkClicked({...}),null!=E)?E():(0,d.A)(P)}
 *     if(null!==I.isBlockedDomain(P)){t?.preventDefault(),_.show(P),b();return}
 *
 * $self.intercept(url, event, open, cancel, props) returns true when it took over the click. A
 * domain on Discord's blocklist never reaches it: our "Open anyway" calls open() directly, so it
 * would skip Discord's hard block.
 * Found against Discord's web build cached in test-results/chunks (Sep 2026).
 */
export const PATCH: SourcePatch = {
    find: "isProtocol:!0,contextKey:",
    replace: {
        match: /(?<=function (\i)\(\)\{\(\i&&\i\.\i\.trackAnnouncementMessageLinkClicked\([^}]*\}\),null!=\i\)\?\i\(\):\(0,\i\.\i\)\(\i\)\})(?=if\(null!==(\i)\.isBlockedDomain\((\i)\)\)\{(\i)\?\.preventDefault\(\),\i\.show\(\i\),(\i)\(\);return\})/,
        with: "if(null===$2.isBlockedDomain($3)&&$self?.intercept?.($3,$4,$1,$5,arguments[0]))return;",
    },
};
