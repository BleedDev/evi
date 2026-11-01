/**
 * The safety check on evi.rest's Review page: what in an upload's code a reviewer should look at
 * before publishing it, each with the lines it was found on.
 *
 * pluginPermissions.ts says what a plugin can touch (network, patches, menus...), which is mostly
 * fine. This looks for what plugins shouldn’t do at all, or only for a good reason: reading the
 * token, a built-in webhook, code it downloads, code written so it can't be read, account endpoints,
 * and for native.js, programs, files and Electron's protections. Each flag is one of:
 *   danger  no plugin we'd publish does this; reject it unless the code clearly shows why
 *   warn    some plugins have a reason to; read the lines and make sure it's this one's
 *   note    usually fine; worth a look at what goes in
 *
 * It reads text and runs nothing, so it can't prove code is safe: a clean check only means none of
 * these were written plainly. Against the version the store has, flags it didn't have are marked new:
 * an update that starts reading the token is the one to catch.
 *
 * Pure: no DOM, no network, no disk, shared by the server and the tests.
 */
import { hostAllowed, readPermissions } from "./declaredPermissions";
import { scanBundle } from "./pluginPermissions";

export type Severity = "danger" | "warn" | "note";
export type FileName = "index.js" | "native.js";

export interface Hit {
    file: FileName;
    /** 1-based */
    line: number;
    /** Index into the file's text, where the match starts */
    at: number;
    length: number;
    /** The line around the match, cut to fit */
    text: string;
}

export interface Flag {
    id: string;
    severity: Severity;
    /** "Reads your Discord token" */
    title: string;
    /** Why it matters, and what makes it all right, in a sentence or two */
    why: string;
    /** Specifics: hosts, endpoints, modules */
    details: string[];
    /** The first few places it's written */
    hits: Hit[];
    /** Every line it's on, for "and 12 more" */
    count: number;
    /** Not in the version the store has. Undefined when there's no version to compare with. */
    new?: boolean;
}

export interface CodeReview {
    verdict: "danger" | "warn" | "clean";
    /** One line for the top of the check */
    headline: string;
    /** danger first, then warn, then note */
    flags: Flag[];
    /** The version compared with, when there was one */
    comparedWith?: string;
}

export interface CodeReviewInput {
    code: string;
    nativeCode?: string | null;
    /** For permissions.network: requests to sites it didn't declare */
    manifest?: { permissions?: unknown; } | null;
    /** The store's version of the same plugin, to say what's new */
    previous?: { version: string; code: string; nativeCode?: string | null; } | null;
}

interface Rule {
    id: string;
    severity: Severity;
    title: string;
    why: string;
    /** Global regexes; a hit for each match */
    patterns: RegExp[];
    /** Which file it reads: both by default */
    file?: FileName;
    /** The detail a match adds ("api.telegram.org") */
    detail?: (m: RegExpMatchArray) => string | undefined;
    /** At least this many matches before it counts (minified names show up a few times by chance) */
    min?: number;
}

const MAX_HITS = 6;
const EXCERPT = 150;
const SEVERITY_ORDER: Record<Severity, number> = { danger: 0, warn: 1, note: 2 };

/** Modules the page side gets from Evi (manager.ts requireMap): anything else is reaching for more */
const PAGE_MODULES = String.raw`@evi\/api|@delight\/api|react|react-dom|react\/jsx-runtime|react\/jsx-dev-runtime`;

/** Where people send what they took: request catchers, tunnels, pastes, chat bots, IP loggers */
const EXFIL_HOSTS = String.raw`webhook\.site|requestbin\.(?:com|net)|pipedream\.net|[\w-]+\.ngrok(?:-free)?\.(?:io|app|dev)|[\w-]+\.trycloudflare\.com|api\.telegram\.org|pastebin\.com|hastebin\.com|paste\.ee|grabify\.link|iplogger\.(?:org|com|ru)|2no\.co|interact\.sh|oast\.(?:pro|live|site|online|fun|me)|burpcollaborator\.net|canarytokens\.com`;
const IP_LOOKUP_HOSTS = String.raw`api\.ipify\.org|ipinfo\.io|ip-api\.com|ipapi\.co|ifconfig\.me|icanhazip\.com|checkip\.amazonaws\.com|myexternalip\.com`;

const RULES: Rule[] = [
    {
        id: "token",
        severity: "danger",
        title: "Reads your Discord token",
        why: "The token logs in as you without your password or 2FA. No plugin needs it: Discord’s own request functions add it to requests themselves.",
        patterns: [
            /\bgetToken\s*\(/g,
            /["'`]getToken["'`]/g,
            // The store alone isn't the token: AuthenticationStore also has the session and user ids
            /\b(?:AuthenticationStore|TokenStore)["'`]?\s*\)?\s*\??\.\s*(?:getToken|token)\b/g,
            /\blocalStorage\s*(?:\.\s*getItem\s*\(\s*["'`]token["'`]|\.\s*token\b|\[\s*["'`]token["'`]\s*\])/g,
            /\bwebpackChunkdiscord_app\b[\s\S]{0,200}?\btoken\b/g,
        ],
    },
    {
        id: "webhook",
        severity: "danger",
        title: "Has a Discord webhook address built in",
        why: "A webhook anyone can post to is the usual way stolen tokens and messages leave someone’s computer. Plugins that work with webhooks get them from the channel the person picks.",
        patterns: [/\b(?:https?:)?\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{15,}\/[\w-]{20,}/g],
    },
    {
        id: "exfil",
        severity: "danger",
        title: "Contacts a site used for collecting stolen data",
        why: "Request catchers, tunnels, paste sites, Telegram bots and IP loggers are where grabbers send what they take. A plugin rarely has a real reason to talk to one.",
        patterns: [new RegExp(String.raw`\b(${EXFIL_HOSTS})\b`, "gi")],
        detail: m => m[1].toLowerCase(),
    },
    {
        id: "ipLookup",
        severity: "warn",
        title: "Looks up your IP address",
        why: "These sites only answer with the asker’s IP and where it is. Fine for a weather or time plugin that says so, otherwise it’s tracking.",
        patterns: [new RegExp(String.raw`\b(${IP_LOOKUP_HOSTS})\b`, "gi")],
        detail: m => m[1].toLowerCase(),
    },
    {
        id: "remoteScript",
        severity: "danger",
        title: "Loads code from somewhere else",
        why: "Code loaded while it runs isn’t the code you’re reading: the server can send anything, to anyone, at any time after you publish.",
        patterns: [
            /\bcreateElement\s*\(\s*["'`]script["'`]\s*\)/g,
            /\bimportScripts\s*\(/g,
            /(?<![\w$.])import\s*\(\s*(?!["'`]\.{1,2}\/)/g,
            /\bloadURL\s*\(\s*["'`]javascript:/g,
        ],
    },
    {
        id: "dynamicCode",
        severity: "warn",
        title: "Builds and runs code while running",
        why: "eval and new Function run text as code, so what runs isn’t what’s written here. Check where the text comes from: anything from the network makes it code someone else controls.",
        patterns: [
            /(?<![\w$.])eval\s*\(/g,
            /\bnew\s+Function\s*\(/g,
            /(?<![\w$.])Function\s*\(\s*["'`]/g,
            /\b(?:setTimeout|setInterval)\s*\(\s*["'`]/g,
            /\bexecuteJavaScript\s*\(\s*(?!["'`])/g,
        ],
    },
    {
        id: "obfuscated",
        severity: "danger",
        title: "Written so it can’t be read",
        why: "Obfuscators rename everything to _0x… and pack the strings, which only hides what it does. Ask for the readable build.",
        patterns: [
            /\b_0x[0-9a-f]{4,6}\b/g,
            /\beval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/g,
        ],
        min: 3,
    },
    {
        id: "encoded",
        severity: "warn",
        title: "Has text hidden in code numbers or base64",
        why: "Escaped characters, char codes and long base64 can hide an address or code from a reader. Decode it and check what it says: images and fonts are fine.",
        patterns: [
            /(?:\\x[0-9a-fA-F]{2}){8,}/g,
            /(?:\\u[0-9a-fA-F]{4}){8,}/g,
            /\bString\.fromCharCode\s*\(\s*(?:\d+\s*,\s*){5,}/g,
            /(?<![\w$.])atob\s*\(\s*["'`]/g,
            /(?<!base64,)["'`](?=[A-Za-z0-9+/]*[0-9+/])[A-Za-z0-9+/]{300,}={0,2}["'`]/g,
        ],
    },
    {
        id: "pageEscape",
        severity: "danger",
        title: "Reaches for Node or Electron from Discord’s page",
        why: "The page side only gets @evi/api and React. Asking for Node’s or Electron’s modules, or Discord’s hidden require, is trying to get full access to the computer.",
        file: "index.js",
        patterns: [
            new RegExp(String.raw`\brequire\s*\(\s*["'\x60](?!(?:${PAGE_MODULES})["'\x60])([^"'\x60]+)["'\x60]`, "g"),
            /\b(?:nodeRequire|__non_webpack_require__)\b/g,
            /\bprocess\s*\.\s*(?:binding|mainModule|dlopen)\b/g,
            /\bDiscordNative\s*\.\s*nativeModules\b/g,
        ],
        detail: m => m[1],
    },
    {
        id: "discordNative",
        severity: "note",
        title: "Uses Discord’s desktop bridge",
        why: "DiscordNative reaches the desktop app: clipboard, files, window, processes. Check each use is what the plugin says it does.",
        file: "index.js",
        patterns: [/\bDiscordNative\s*\??\.\s*(\w+)/g],
        detail: m => `DiscordNative.${m[1]}`,
    },
    {
        id: "bypassGuard",
        severity: "warn",
        title: "Goes around Evi’s network check",
        why: "Evi holds a plugin’s own fetch to the sites it declares. Discord’s page copy, or one from another frame, isn’t checked, so requests through it skip what the manifest promises.",
        file: "index.js",
        patterns: [
            /\b(?:window|globalThis|self|top|parent|frames)\s*\.\s*(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/g,
            /\bcontentWindow\s*\.\s*(?:fetch|XMLHttpRequest|WebSocket)\b/g,
            /\bFunction\s*\(\s*["'`]return this["'`]\s*\)/g,
            /\bnavigator\s*\.\s*sendBeacon\s*\(/g,
        ],
    },
    {
        id: "account",
        severity: "warn",
        title: "Calls Discord’s account endpoints",
        why: "These change your account, money, sign-in or servers you’re in. Fine when it’s what the plugin is for and only on your click; never on its own.",
        patterns: [/["'`](\/(?:users\/@me(?:\/(?:settings|billing|mfa|connections|guilds|relationships|consent|harvest|devices|email|password|phone|entitlements)[\w/-]*)?|auth\/(?:login|logout|mfa|verify|authorize-ip)[\w/-]*|billing\/[\w/-]*|entitlements\/gift-codes[\w/-]*|invites\/[^"'`]*|oauth2\/authorize[^"'`]*|guilds\/[^"'`]*\/(?:bans|prune|members)[^"'`]*))(?=["'`?$])/g],
        detail: m => m[1].replace(/\$\{[^}]*\}/g, "…"),
    },
    {
        id: "personal",
        severity: "warn",
        title: "Reads your email, phone or password fields",
        why: "Plugins rarely need any of these. Check they stay on the page and aren’t sent anywhere.",
        patterns: [
            /\bgetCurrentUser\s*\(\s*\)\s*\??\.\s*(email|phone|mfaEnabled)\b/g,
            /\b(?:input\s*)?\[\s*type\s*=\s*\\?["']?password\\?["']?\s*\]/g,
            /\btype\s*===?\s*["'`]password["'`]/g,
        ],
    },
    {
        id: "mining",
        severity: "danger",
        title: "Looks like a crypto miner",
        why: "Mining uses someone’s computer to make money for someone else.",
        patterns: [/\b(coinhive|coin-hive|cryptonight|cryptoloot|webminepool|stratum\+tcp|xmrig|minero\.cc)\b/gi],
        detail: m => m[1].toLowerCase(),
    },
    {
        id: "rawHtml",
        severity: "note",
        title: "Puts raw HTML on the page",
        why: "HTML from messages, names, embeds or the web can run code in Discord. Fine for fixed markup; check nothing from outside goes in unescaped.",
        file: "index.js",
        patterns: [
            /\.\s*(?:innerHTML|outerHTML)\s*\+?=(?!=)/g,
            /\binsertAdjacentHTML\s*\(/g,
            /\bdangerouslySetInnerHTML\b/g,
            /\bdocument\s*\.\s*write(?:ln)?\s*\(/g,
            /\bcreateContextualFragment\s*\(/g,
        ],
    },

    // native.js: runs in Discord's main process with full access to the computer
    {
        id: "programs",
        severity: "warn",
        title: "Runs programs on the computer",
        why: "It can start anything the person could. Check the command is fixed, and that nothing from messages or the web can get into it.",
        file: "native.js",
        patterns: [
            /\brequire\s*\(\s*["'`](?:node:)?child_process["'`]\s*\)/g,
            // Called off the module (import_child_process.exec) or destructured; regex.exec( isn't a program
            /\b[\w$]*child_process[\w$]*\s*\.\s*(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/g,
            /(?<![\w$.])(?:execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/g,
            /\bshell\s*\.\s*openPath\s*\(/g,
        ],
    },
    {
        id: "secrets",
        severity: "danger",
        title: "Looks where logins and wallets are kept",
        why: "Discord’s Local Storage and leveldb hold the token; browsers keep passwords and cookies in Login Data and Cookies. Grabbers read exactly these.",
        file: "native.js",
        patterns: [/\b(Local Storage|leveldb|Login Data|Local State|Web Data|Cookies|\.ssh|Exodus|MetaMask|Electrum|Atomic Wallet|wallet\.dat|Telegram Desktop|tdata|keychain|Credential Manager)\b/g],
        detail: m => m[1],
    },
    {
        id: "files",
        severity: "warn",
        title: "Writes or deletes files",
        why: "Fine inside its own folder. Check the paths: one built from messages or the web can write anywhere the person can.",
        file: "native.js",
        patterns: [/\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|chmod|chmodSync|symlink|symlinkSync)\s*\(/g],
        detail: m => m[1],
    },
    {
        id: "electronSafety",
        severity: "danger",
        title: "Turns off Electron’s protections",
        why: "Pages in a window like this can reach the computer, or skip the browser’s rules about other sites. Pretty Notifications and Side Browser show how to make windows without it.",
        file: "native.js",
        patterns: [/\b(webSecurity\s*:\s*false|nodeIntegration(?:InSubFrames|InWorker)?\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|allowRunningInsecureContent\s*:\s*true|webviewTag\s*:\s*true|experimentalFeatures\s*:\s*true)/g],
        detail: m => m[1].replace(/\s+/g, ""),
    },
    {
        id: "certificates",
        severity: "danger",
        title: "Accepts bad security certificates",
        why: "That lets anyone on the network read and change Discord’s traffic, token included.",
        file: "native.js",
        patterns: [/["'`]certificate-error["'`]|\bsetCertificateVerifyProc\s*\(|ignore-certificate-errors|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized\s*:\s*false/g],
    },
    {
        id: "traffic",
        severity: "warn",
        title: "Changes Discord’s web traffic",
        why: "It can block, redirect or rewrite what Discord loads, or drop security headers like the content policy. Check what it matches and what it changes.",
        file: "native.js",
        patterns: [
            /\b(onBeforeRequest|onBeforeSendHeaders|onHeadersReceived|onBeforeRedirect)\s*\(/g,
            /content-security-policy/gi,
            /\bprotocol\s*\.\s*(?:handle|intercept\w*|register\w*Protocol)\s*\(/g,
        ],
    },
    {
        id: "devicePermissions",
        severity: "warn",
        title: "Decides what pages may use",
        why: "Camera, microphone, screen, notifications, files. Check it denies by default and only allows what the plugin needs.",
        file: "native.js",
        patterns: [/\b(setPermissionRequestHandler|setPermissionCheckHandler|setDevicePermissionHandler|setDisplayMediaRequestHandler)\s*\(/g],
        detail: m => m[1],
    },
    {
        id: "nativeNetwork",
        severity: "warn",
        title: "Makes web requests from outside the page",
        why: "Evi can’t hold native.js to the sites the manifest declares. Check every address is fixed, and what’s sent.",
        file: "native.js",
        patterns: [
            /\brequire\s*\(\s*["'`](?:node:)?(https?|net|tls|dgram|http2)["'`]\s*\)/g,
            /\bnet\s*\.\s*(?:request|fetch)\s*\(/g,
            /(?<![\w$.])fetch\s*\(/g,
        ],
    },
    {
        id: "computerInfo",
        severity: "note",
        title: "Reads details about the computer",
        why: "Environment variables, user and host names can identify someone. Check they stay on the computer.",
        file: "native.js",
        patterns: [/\bprocess\s*\.\s*env\b|\bos\s*\.\s*(?:userInfo|hostname|networkInterfaces|homedir)\s*\(|\bapp\s*\.\s*getPath\s*\(\s*["'`](?:home|appData|userData|documents|desktop|downloads)["'`]/g],
    },
    {
        id: "openExternal",
        severity: "note",
        title: "Opens things in other apps",
        why: "shell.openExternal opens any address in its app: file: and custom ones can run programs. Check only http(s) gets through.",
        file: "native.js",
        patterns: [/\bopenExternal\s*\(/g],
    },
];

/** Comments blanked to spaces, so offsets and lines stay where they are */
function blankComments(code: string) {
    return code
        .replace(/^[ \t]*\/\/.*$/gm, s => " ".repeat(s.length))
        .replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " "));
}

function lineStarts(code: string) {
    const starts = [0];
    for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) starts.push(i + 1);
    return starts;
}

function lineOf(starts: number[], at: number) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= at) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function excerpt(code: string, starts: number[], line: number, at: number, length: number) {
    const start = starts[line];
    const end = line + 1 < starts.length ? starts[line + 1] - 1 : code.length;
    const room = Math.max(0, EXCERPT - Math.min(length, EXCERPT));
    const from = Math.max(start, at - Math.floor(room / 2));
    const to = Math.min(end, Math.max(at + length, from + EXCERPT));
    const text = code.slice(from, to).replace(/\s+/g, " ").trim();
    return `${from > start ? "…" : ""}${text}${to < end ? "…" : ""}`;
}

interface Found { rule: Rule; hits: Hit[]; count: number; details: Set<string>; }

function scanFile(file: FileName, original: string, found: Map<string, Found>) {
    const code = blankComments(original);
    const starts = lineStarts(code);
    for (const rule of RULES) {
        if (rule.file && rule.file !== file) continue;
        const entry = found.get(rule.id) ?? { rule, hits: [], count: 0, details: new Set<string>() };
        let matches = 0;
        const fileHits: Hit[] = [];
        const fileDetails: string[] = [];
        const all = rule.patterns.flatMap(pattern => [...code.matchAll(pattern)]).sort((a, b) => a.index! - b.index!);
        // One hit per line, its first match: two patterns matching the same line are one place to look
        const lines = new Set<number>();
        for (const m of all) {
            matches++;
            const detail = rule.detail?.(m);
            if (detail) fileDetails.push(detail);
            const line = lineOf(starts, m.index!);
            if (lines.has(line)) continue;
            lines.add(line);
            if (fileHits.length + entry.hits.length < MAX_HITS) {
                fileHits.push({ file, line: line + 1, at: m.index!, length: m[0].length, text: excerpt(original, starts, line, m.index!, m[0].length) });
            }
        }
        if (matches < (rule.min ?? 1)) continue;
        entry.count += lines.size;
        entry.hits.push(...fileHits);
        for (const d of fileDetails) entry.details.add(d);
        found.set(rule.id, entry);
    }
}

/** Flags for one version of a plugin, with nothing marked new */
function flagsFor(code: string, nativeCode: string | null | undefined, manifest: CodeReviewInput["manifest"]): Flag[] {
    const found = new Map<string, Found>();
    scanFile("index.js", code, found);
    if (nativeCode) scanFile("native.js", nativeCode, found);
    const flags: Flag[] = [...found.values()].map(({ rule, hits, count, details }) => ({
        id: rule.id, severity: rule.severity, title: rule.title, why: rule.why,
        details: [...details].slice(0, 12), hits, count,
    }));

    // Code built from text is code someone else writes when the text comes off the network
    const scan = scanBundle(code);
    const dynamic = flags.find(f => f.id === "dynamicCode");
    if (dynamic && scan.network.length) {
        dynamic.severity = "danger";
        dynamic.title = "Can run code it downloads";
        dynamic.why = "It makes web requests and runs text as code. If any of that text comes from a request, whoever runs the server decides what this plugin does, after you’ve published it.";
    }

    // Sites it talks to that the manifest doesn't list: Evi blocks those through its fetch, so it either breaks or goes around
    const declared = readPermissions(manifest?.permissions);
    if (declared && scan.network.length) {
        const undeclared = scan.domains.filter(d => !hostAllowed(declared, d));
        if (undeclared.length) {
            const starts = lineStarts(code);
            const hits: Hit[] = [];
            let count = 0;
            for (const host of undeclared) {
                for (const m of code.matchAll(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"))) {
                    count++;
                    if (hits.length >= MAX_HITS) continue;
                    const line = lineOf(starts, m.index!);
                    hits.push({ file: "index.js", line: line + 1, at: m.index!, length: m[0].length, text: excerpt(code, starts, line, m.index!, m[0].length) });
                }
            }
            flags.push({
                id: "undeclaredHosts", severity: "note", title: "Mentions sites its manifest doesn’t declare",
                why: "Evi blocks the plugin’s own requests to sites missing from permissions.network, so either they’re only links, or it reaches them another way. Check which.",
                details: undeclared.slice(0, 12), hits: hits.sort((a, b) => a.at - b.at), count,
            });
        }
    }

    // A keydown listener is common; with web requests and the page's text it's how keyloggers start
    const keys = /\baddEventListener\s*\(\s*["'`](?:keydown|keyup|keypress|input)["'`]/g;
    if (scan.network.length && /\b(?:document|window)\s*\.\s*addEventListener\s*\(\s*["'`](?:keydown|keyup|keypress|input)["'`]/.test(code)) {
        const starts = lineStarts(code);
        const all = [...code.matchAll(keys)];
        flags.push({
            id: "keystrokes", severity: "note", title: "Listens to keys anywhere on the page and makes web requests",
            why: "Most plugins listen for a shortcut. Check the handler only looks for its keys and nothing typed is kept or sent.",
            details: [], count: all.length,
            hits: all.slice(0, MAX_HITS).map(m => {
                const line = lineOf(starts, m.index!);
                return { file: "index.js" as const, line: line + 1, at: m.index!, length: m[0].length, text: excerpt(code, starts, line, m.index!, m[0].length) };
            }),
        });
    }

    if (scan.clipboardRead && scan.network.length) {
        flags.push({
            id: "clipboardOut", severity: "warn", title: "Reads your clipboard and makes web requests",
            why: "Clipboards hold passwords and codes. Check it reads only when you ask, and that what it reads isn’t sent.",
            details: [], hits: [], count: 1,
        });
    }

    return flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** What a reviewer should look at in an upload, highest first */
export function reviewCode(input: CodeReviewInput): CodeReview {
    const flags = flagsFor(input.code, input.nativeCode, input.manifest);
    let comparedWith: string | undefined;
    if (input.previous) {
        comparedWith = input.previous.version;
        const before = new Map(flagsFor(input.previous.code, input.previous.nativeCode, input.manifest).map(f => [f.id, f]));
        for (const f of flags) {
            const old = before.get(f.id);
            f.new = !old || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[old.severity];
        }
    }

    const dangers = flags.filter(f => f.severity === "danger");
    const warns = flags.filter(f => f.severity === "warn");
    const fresh = flags.filter(f => f.new && f.severity !== "note").length;
    const since = comparedWith ? fresh ? `, ${fresh} new since ${comparedWith}` : `, none new since ${comparedWith}` : "";
    const verdict = dangers.length ? "danger" : warns.length ? "warn" : "clean";
    const headline = verdict === "danger"
        ? `${dangers.length === 1 ? "1 thing" : `${dangers.length} things`} plugins shouldn’t do${since}`
        : verdict === "warn"
            ? `Nothing dangerous, ${warns.length === 1 ? "1 thing" : `${warns.length} things`} to check${since}`
            : "Nothing dangerous or unusual written in the code";
    return { verdict, headline, flags, ...comparedWith && { comparedWith } };
}
