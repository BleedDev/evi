/**
 * Draws the README's banner: "evi" as a field of dots, in the same dot language as the blog's covers
 * and the wordmark on evi.rest (src/shared/versionCover.ts). The word is set in a browser, sampled on
 * the dot grid, and every dot gets bigger and brighter with how much of the word, or its glow, it's in.
 *
 *   node scripts/readme-art.ts    writes docs/art/banner.svg (node: Playwright doesn't run under Bun)
 *
 * The feature pictures next to it are copies of the blog's covers (evi.rest/blog).
 */
import { existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { chromium } from "playwright-core";

const ROOT = resolve(import.meta.dirname, "..");
const W = 1280, H = 400, STEP = 12, LEVELS = 14;

const CHROME = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
].find(p => !!p && existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
/** Per dot: [core 0..1, glow 0..1], row by row */
const samples: [number, number][] = await page.evaluate(({ W, H, STEP }) => {
    const draw = (blur: number) => {
        const c = document.createElement("canvas");
        c.width = W;
        c.height = H;
        const ctx = c.getContext("2d", { willReadFrequently: true })!;
        ctx.filter = blur ? `blur(${blur}px)` : "none";
        ctx.fillStyle = "#fff";
        ctx.font = `800 ${H * 0.78}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("evi", W / 2, H / 2 + H * 0.03);
        return ctx.getImageData(0, 0, W, H).data;
    };
    const core = draw(0), glow = draw(28);
    const out: [number, number][] = [];
    for (let y = STEP / 2; y < H; y += STEP) for (let x = STEP / 2; x < W; x += STEP) {
        const i = (Math.floor(y) * W + Math.floor(x)) * 4 + 3;
        out.push([core[i] / 255, glow[i] / 255]);
    }
    return out;
}, { W, H, STEP });
await browser.close();

const levels: string[][] = Array.from({ length: LEVELS }, () => []);
let n = 0;
for (let y = STEP / 2; y < H; y += STEP) for (let x = STEP / 2; x < W; x += STEP) {
    const [core, glow] = samples[n++];
    const v = Math.max(core, glow * 0.4);
    if (v < 0.06) continue;
    levels[Math.min(LEVELS - 1, Math.floor(v * LEVELS))].push(`M${x} ${y}h0`);
}

const paths = levels.map((d, i) => {
    if (!d.length) return "";
    const t = (i + 0.5) / LEVELS;
    return `<path d="${d.join("")}" stroke-width="${((0.14 + t * 0.44) * STEP).toFixed(2)}" stroke-opacity="${(0.14 + t ** 1.3 * 0.86).toFixed(3)}"/>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`
    + `<defs>`
    + `<pattern id="g" width="${STEP}" height="${STEP}" patternUnits="userSpaceOnUse"><circle cx="${STEP / 2}" cy="${STEP / 2}" r="1.1" fill="#fff" fill-opacity=".08"/></pattern>`
    + `<radialGradient id="l" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="v" cx=".5" cy=".5" r=".75"><stop offset=".45" stop-color="#0b0c0d" stop-opacity="0"/><stop offset="1" stop-color="#0b0c0d"/></radialGradient>`
    + `<clipPath id="c"><rect width="${W}" height="${H}" rx="24"/></clipPath>`
    + `</defs>`
    + `<g clip-path="url(#c)">`
    + `<rect width="${W}" height="${H}" fill="#0b0c0d"/>`
    + `<rect width="${W}" height="${H}" fill="url(#g)"/>`
    + `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${W * 0.4}" ry="${H * 0.7}" fill="url(#l)"/>`
    + `<g fill="none" stroke="#fff" stroke-linecap="round">${paths}</g>`
    + `<rect width="${W}" height="${H}" fill="url(#v)"/>`
    + `</g></svg>`;

const out = join(ROOT, "docs", "art", "banner.svg");
writeFileSync(out, svg);
console.log(`✓ docs/art/banner.svg (${(svg.length / 1024).toFixed(0)} KB)`);
