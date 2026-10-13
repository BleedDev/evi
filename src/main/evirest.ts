/**
 * Talking to the evi.rest API from main: where it is, this install's id, and requests with a size
 * cap. The page never reaches the API itself, only through the few IPC calls built on this.
 */
import { DEFAULT_API_URL, isInstallId } from "@shared/stars";
import { whyNotStoreUrl } from "@shared/store";
import { randomUUID } from "crypto";
import { net } from "electron";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { readCapped } from "./download";
import { DATA_DIR, isDevBuild } from "./paths";

const CONFIG_FILE = join(DATA_DIR, "store.json");
/** A random id for this install, so a star counts once. Nothing else is sent. */
const INSTALL_FILE = join(DATA_DIR, "install-id");

/**
 * `apiUrl` in store.json, EVI_API_URL, or evi.rest. A dev build may point at an evi.rest running on
 * this computer over plain http (`EVI_API_URL=http://127.0.0.1:8799/v1`); anything else must be https.
 */
export function apiUrl() {
    if (process.env.EVI_API_URL) return process.env.EVI_API_URL.replace(/\/+$/, "");
    try {
        const { apiUrl } = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
        if (typeof apiUrl === "string" && apiUrl.trim()) return apiUrl.trim().replace(/\/+$/, "");
    } catch { }
    return DEFAULT_API_URL;
}

/** A dev build talking to evi.rest on this computer: http is fine there, and only there */
export function isLocalDevApi(base: string) {
    try {
        const url = new URL(base);
        return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && isDevBuild();
    } catch {
        return false;
    }
}

let installId: string | undefined;
export function getInstallId() {
    if (installId) return installId;
    try {
        const saved = readFileSync(INSTALL_FILE, "utf8").trim();
        if (isInstallId(saved)) return (installId = saved);
    } catch { }
    installId = randomUUID();
    try {
        writeFileSync(INSTALL_FILE, installId);
    } catch { }
    return installId;
}

export interface ApiResponse {
    status: number;
    etag: string | null;
    json: any;
}

/** A request to the API (`path` starts with /), answered as JSON. Throws on network errors and 4xx/5xx. */
export async function apiRequest(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: {
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    max?: number;
} = {}): Promise<ApiResponse> {
    const base = apiUrl();
    const bad = isLocalDevApi(base) ? undefined : whyNotStoreUrl(base);
    if (bad) throw new Error(`The API URL can't be used: ${bad}`);

    const res = await net.fetch(`${base}${path}`, {
        method,
        headers: { "X-Evi-Install": getInstallId(), "Accept": "application/json", ...options.headers },
        body: options.body as BodyInit | undefined,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
    });
    if (res.status === 304) return { status: 304, etag: res.headers.get("etag"), json: undefined };

    const body = await readCapped(res, options.max ?? 1024 * 1024);
    if (!body) throw new Error("The API's answer was too large");
    let json: any;
    try {
        json = JSON.parse(new TextDecoder().decode(body));
    } catch {
        throw new Error(`The API answered ${res.status} without JSON`);
    }
    // The status and the answer go along, for callers that tell "not linked" (401) or why it refused
    if (!res.ok) throw Object.assign(new Error(typeof json?.error === "string" ? json.error.slice(0, 200) : `The API answered ${res.status}`), { status: res.status, json });
    return { status: res.status, etag: res.headers.get("etag"), json };
}
