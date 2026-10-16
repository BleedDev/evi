/**
 * Main-process side of Look Inside: reads part of a zip attachment. Discord's CDN sends zips without
 * an Access-Control-Allow-Origin header (checked 2026-10-16), so its own page can't read them, and a
 * fetch from there always fails. Node's fetch here isn't held to CORS. Only Discord attachment URLs,
 * only byte ranges, and no more than the end of a zip and its directory.
 */
import type { NativePlugin } from "@evi/api/native";

import { MAX_DIRECTORY_BYTES, TAIL_BYTES } from "./zip";

const ATTACHMENT = /^https:\/\/cdn\.discordapp\.com\/(ephemeral-)?attachments\/\d{17,20}\/\d{17,20}\/[^/?#]+(\?[^#]*)?$/;
const MAX_RANGE = Math.max(TAIL_BYTES, MAX_DIRECTORY_BYTES);

export default {
    /** ctx.native.call("range", url, start, end) -> bytes [start, end). A server that ignores the range would send the whole file: that's cancelled. */
    async range(url: string, start: number, end: number) {
        if (typeof url !== "string" || !ATTACHMENT.test(url)) throw new Error("Not a Discord attachment URL");
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end - start > MAX_RANGE) throw new Error("Bad range");
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
        const whole = res.status === 200 && start === 0 && Number(res.headers.get("content-length")) === end;
        if (res.status !== 206 && !whole) {
            void res.body?.cancel();
            throw new Error(`HTTP ${res.status}`);
        }
        return new Uint8Array(await res.arrayBuffer());
    },
} satisfies NativePlugin;
