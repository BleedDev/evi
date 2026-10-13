/**
 * Keeps Evi's collectible SKUs ("evi:<bundle>") out of what Discord sends. Discord's code reads
 * the patched user records, so without this its analytics would report "evi:sakura" as someone's
 * decoration or effect (telling Discord that person runs Evi), and a profile save could send it to
 * Discord's API.
 *
 * - Analytics: patches.ts calls scrub() on each event's properties where Discord tracks, queues and
 *   uploads events; an Evi SKU becomes null, as if nothing were worn.
 * - Requests: a changing request to Discord's API whose JSON names an Evi SKU has that field taken
 *   out (not nulled, which could remove a real Discord decoration), so nothing changes there.
 * - Addresses: a request to Discord's API with an Evi SKU in its address (fetching a product by SKU)
 *   asks for SKU "0" instead, which Discord doesn't have. patches.ts already stops the one Evi knows
 *   of; this catches any other.
 */
import { bundleFromSku } from "@shared/collectibles";

const isEviSku = (v: unknown) => bundleFromSku(v) !== undefined;
const MAX_DEPTH = 8;

/** Analytics properties: Evi SKUs become null, in place. Returns how many it found. */
export function scrub(value: unknown, depth = 0): number {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return 0;
    let found = 0;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (isEviSku(value[i])) {
                value[i] = null;
                found++;
            } else found += scrub(value[i], depth + 1);
        }
        return found;
    }
    for (const key of Object.keys(value)) {
        const v = (value as Record<string, unknown>)[key];
        if (isEviSku(v)) {
            (value as Record<string, unknown>)[key] = null;
            found++;
        } else if (v && typeof v === "object") found += scrub(v, depth + 1);
    }
    return found;
}

/** A batch of events about to be uploaded: [{ type, properties }] */
export function scrubAll(events: unknown): number {
    if (!Array.isArray(events)) return 0;
    return events.reduce((n, e) => n + scrub((e as { properties?: unknown; } | null)?.properties), 0);
}

/** Fields that hold a collectible: anything else (a message's text, say) is never touched */
const COLLECTIBLE_KEY = /sku|decoration|effect|nameplate|collectible/i;

/** A request body without Evi SKUs: collectible fields holding one are left out */
function strip(value: unknown, depth = 0): unknown {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
    if (Array.isArray(value)) return value.map(v => strip(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        if (COLLECTIBLE_KEY.test(k)) {
            if (isEviSku(v)) continue;
            if (Array.isArray(v)) {
                out[k] = v.filter(x => !isEviSku(x)).map(x => strip(x, depth + 1));
                continue;
            }
            // { sku_id: "evi:…", asset: … }: an Evi item as a whole
            if (v && typeof v === "object" && Object.entries(v).some(([kk, vv]) => COLLECTIBLE_KEY.test(kk) && isEviSku(vv))) continue;
        }
        out[k] = strip(v, depth + 1);
    }
    return out;
}

const DISCORD_API = /^(https:\/\/(\w+\.)?discord(app)?\.com)?\/api\/v\d+\//;
/** An Evi SKU as a whole path segment ("/skus/evi:sakura/"), never inside a search's text */
const SKU_IN_PATH = /(?<=\/)evi(?::|%3A)[a-z0-9][a-z0-9-]{0,39}(?=[/?#]|$)/gi;

/** The address to ask instead, or undefined to ask it as it is */
export function outgoingUrl(url: string): string | undefined {
    if (!DISCORD_API.test(url)) return undefined;
    const cut = url.search(/[?#]/);
    const path = cut < 0 ? url : url.slice(0, cut);
    const cleaned = path.replace(SKU_IN_PATH, "0");
    return cleaned === path ? undefined : cleaned + (cut < 0 ? "" : url.slice(cut));
}

/** The body to send instead, or undefined to send it as it is */
export function outgoing(method: string | undefined, url: string, body: unknown): string | undefined {
    if (typeof body !== "string" || !body.includes('"evi:')) return undefined;
    if (!method || method.toUpperCase() === "GET" || !DISCORD_API.test(url)) return undefined;
    let json: unknown;
    try {
        json = JSON.parse(body);
    } catch {
        return undefined;
    }
    const cleaned = strip(json);
    const text = JSON.stringify(cleaned);
    return text === body ? undefined : text;
}

let installed = false;

/** Wraps the page's XHR and fetch once, for the life of the page */
export function guardRequests() {
    if (installed) return;
    installed = true;
    const xhr = XMLHttpRequest.prototype;
    const open = xhr.open;
    const send = xhr.send;
    const requests = new WeakMap<XMLHttpRequest, { method: string; url: string; }>();
    xhr.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
        const address = outgoingUrl(String(url)) ?? String(url);
        requests.set(this, { method, url: address });
        return (open as any).call(this, method, address === String(url) ? url : address, ...rest);
    };
    xhr.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const request = requests.get(this);
        const rewritten = request && outgoing(request.method, request.url, body);
        return send.call(this, rewritten ?? body);
    };
    const nativeFetch = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        const address = outgoingUrl(url);
        if (address !== undefined) input = input instanceof Request ? new Request(address, input) : address;
        const rewritten = outgoing(init?.method ?? (input instanceof Request ? input.method : undefined), url, init?.body);
        return nativeFetch.call(this, input, rewritten === undefined ? init : { ...init, body: rewritten });
    } as typeof fetch;
}
