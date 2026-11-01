/**
 * Pure detection of personal information in a piece of text, kept free of DOM and Discord so it can
 * be tested on its own. Two kinds of evidence:
 *  - patterns: emails (masked ones too), phone numbers (international and common national formats,
 *    masked ones too), card masks like "•••• 1234", IPv4 and IPv6 addresses
 *  - known values: the user's own email, phone, username, connected account names, session
 *    locations, billing address... matched as whole words (substring) or as the entire text (exact)
 */

export type SensitiveKind = "email" | "phone" | "card" | "ip" | "known";

export interface KnownValues {
    /** Found anywhere in the text, as a whole word, case-insensitively */
    substrings: string[];
    /** Only when they are the entire (trimmed) text, case-insensitively: short generic names like app names */
    exact: string[];
    /** Phone numbers, compared by digits so any formatting matches */
    phones: string[];
}

export const emptyKnown = (): KnownValues => ({ substrings: [], exact: [], phones: [] });

const EMAIL = /[\p{L}\p{N}._%+\-*•]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}/u;

/** "•••• 1234", "**** **** **** 1234", "*******6789" (Discord's masked phone), "ending in 1234" */
const MASK = /(?:[*•●∙]{2,}[\s-]?){1,4}\d{2,4}\b/;
const ENDING_IN = /\bend(?:ing|s) in \d{4}\b/i;

const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]|\.\d)/;
const IPV6_CANDIDATE = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;

/** Something phone-shaped: digits with spaces, dots, dashes and parentheses, optionally led by + or 00 */
const PHONE_CANDIDATE = /(?<![\w.:/\-+])(?:\+|\b00)?\(?\d[\d\s().\-]{5,}\d(?![\w:/]|\.\d)/g;
/** Dates like 2026-09-27, 27.09.2026, 09/27/26 */
const DATE_LIKE = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})$/;

function isIpv6(candidate: string) {
    const doubles = candidate.split("::").length - 1;
    if (doubles > 1) return false;
    const groups = candidate.split(":").filter(g => g !== "");
    if (groups.length === 0 || groups.some(g => g.length > 4)) return false;
    if (doubles === 0 && groups.length !== 8) return false;
    if (doubles === 1 && groups.length > 7) return false;
    // Rules out times like 12:30:45: a real address has a hex letter or a 3-4 digit group somewhere
    return groups.some(g => g.length >= 3 || /[a-f]/i.test(g));
}

function isPhone(raw: string) {
    const candidate = raw.trim();
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return false;
    if (DATE_LIKE.test(candidate)) return false;
    const international = /^(?:\+|00)/.test(candidate);
    if (international) return digits.length >= 8;

    const groups = candidate.replace(/[()]/g, " ").split(/[\s.\-]+/).filter(Boolean);
    // One unbroken run of digits is a count, an id or a code, not a phone number we can tell apart
    if (groups.length < 2) return false;
    const separators = new Set(candidate.replace(/[\d()]/g, "").replace(/\s+/g, " ").split(""));
    // 192.168.1.10-style dotted quads and versions
    if (separators.size === 1 && separators.has(".") && groups.every(g => g.length <= 3)) return false;
    const areaCode = /^\(\d{2,5}\)/.test(candidate);
    if (areaCode) return digits.length >= 7;
    // National numbers: 555-123-4567, 0532 123 45 67, 020 7946 0958
    return digits.length >= 10 && groups.length <= 5 && groups.every(g => g.length >= 2 && g.length <= 5);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern per value, made once: a settings screen has hundreds of text nodes, each checked against every value */
const wordPatterns = new Map<string, RegExp | null>();

function wordPattern(value: string) {
    let pattern = wordPatterns.get(value);
    if (pattern !== undefined) return pattern;
    const v = value.trim();
    pattern = v.length < 3 ? null : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(v)}(?![\\p{L}\\p{N}_])`, "iu");
    if (wordPatterns.size >= 500) wordPatterns.clear();
    wordPatterns.set(value, pattern);
    return pattern;
}

function containsWord(text: string, value: string) {
    return wordPattern(value)?.test(text) ?? false;
}

function matchesKnown(text: string, known: KnownValues) {
    if (known.substrings.some(v => containsWord(text, v))) return true;
    const trimmed = text.trim().toLowerCase();
    if (trimmed && known.exact.some(v => v.trim().length >= 2 && v.trim().toLowerCase() === trimmed)) return true;
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 7) {
        for (const phone of known.phones) {
            const p = phone.replace(/\D/g, "");
            // The last 7 digits cover numbers written without their country code
            if (p.length >= 7 && (digits.includes(p) || digits.includes(p.slice(-7)))) return true;
        }
    }
    return false;
}

/** The first kind of personal information found in `text`, or null */
export function detectSensitive(text: string, known: KnownValues = emptyKnown()): SensitiveKind | null {
    if (!text || !text.trim()) return null;
    if (matchesKnown(text, known)) return "known";
    if (EMAIL.test(text)) return "email";
    if (MASK.test(text) || ENDING_IN.test(text)) return "card";
    if (IPV4.test(text)) return "ip";
    for (const m of text.matchAll(IPV6_CANDIDATE)) if (isIpv6(m[0])) return "ip";
    for (const m of text.matchAll(PHONE_CANDIDATE)) if (isPhone(m[0])) return "phone";
    return null;
}

const FIELD_TYPES = new Set(["text", "email", "tel", "search", "url"]);

/** A text box whose value is looked at, by its tag and type: passwords are already hidden, checkboxes hold no text */
export function isTextField(tagName: string, type?: string | null) {
    const tag = tagName.toUpperCase();
    return tag === "TEXTAREA" || (tag === "INPUT" && FIELD_TYPES.has((type || "text").toLowerCase()));
}

/** Discord's shapes, loosely typed: whatever is missing is skipped */
export interface KnownSources {
    user?: { email?: string | null; phone?: string | null; username?: string; discriminator?: string; } | null;
    connectedAccounts?: { name?: string; }[];
    authorizedApps?: { application?: { name?: string; }; }[];
    sessions?: { client_info?: { location?: string; ip?: string; }; }[];
    paymentSources?: Record<string, { email?: string; billingAddress?: Record<string, unknown>; }> | null;
}

/** Collects the values to look for from Discord's stores */
export function collectKnown(src: KnownSources): KnownValues {
    const known = emptyKnown();
    const add = (list: string[], v: unknown) => {
        if (typeof v === "string" && v.trim() && !list.includes(v.trim())) list.push(v.trim());
    };
    const { user } = src;
    if (user) {
        add(known.substrings, user.email);
        add(known.phones, user.phone);
        add(known.substrings, user.username);
        if (user.username && user.discriminator && user.discriminator !== "0") add(known.substrings, `${user.username}#${user.discriminator}`);
    }
    for (const a of src.connectedAccounts ?? []) add(known.substrings, a?.name);
    for (const t of src.authorizedApps ?? []) add(known.exact, t?.application?.name);
    for (const s of src.sessions ?? []) {
        add(known.substrings, s?.client_info?.location);
        add(known.substrings, s?.client_info?.ip);
    }
    for (const p of Object.values(src.paymentSources ?? {})) {
        add(known.substrings, p?.email);
        for (const [key, value] of Object.entries(p?.billingAddress ?? {})) {
            if (key !== "country") add(known.substrings, value);
        }
    }
    return known;
}
