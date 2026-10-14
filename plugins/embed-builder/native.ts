/**
 * Main-process side of Embed Builder: sends webhook requests. Since October 2026 Discord refuses a
 * webhook call that comes from its own page ("Invalid request origin", code 50067, for any request
 * carrying Origin: https://discord.com), so the page can't send them itself. Node's fetch here sends no
 * Origin. Only Discord webhook URLs are accepted, nothing else.
 */
import type { NativePlugin } from "@evi/api/native";

const WEBHOOK = /^https:\/\/discord\.com\/api\/v10\/webhooks\/\d{17,20}\/[\w-]{20,100}(\/messages\/\d{17,20})?(\?[\w=&]*)?$/;
const MAX_BYTES = 30 * 1024 * 1024;

interface SentFile {
    name: string;
    type: string;
    bytes: Uint8Array;
}

export default {
    /** ctx.native.call("webhook", url, method, body?, files?) -> { status, text } */
    async webhook(url: string, method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>, files: SentFile[] = []) {
        if (typeof url !== "string" || !WEBHOOK.test(url)) throw new Error("Not a Discord webhook URL");
        if (!["GET", "POST", "PATCH"].includes(method)) throw new Error("Unsupported method");
        let init: RequestInit = { method };
        if (body && files.length) {
            if (files.reduce((n, f) => n + (f.bytes?.byteLength ?? 0), 0) > MAX_BYTES) throw new Error("Files are too big");
            const form = new FormData();
            form.append("payload_json", JSON.stringify(body));
            files.forEach((f, i) => form.append(`files[${i}]`, new Blob([Buffer.from(f.bytes)], { type: f.type || "application/octet-stream" }), f.name));
            init = { method, body: form };
        } else if (body) {
            init = { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        }
        const res = await fetch(url, init);
        return { status: res.status, text: await res.text() };
    },
} satisfies NativePlugin;
