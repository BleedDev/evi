/**
 * Quick Markup's drawing: a list of marks over the picture, drawn in order on a canvas at the
 * picture's own size. Blur pixelates what's under it at that point, so a box drawn after it shows
 * on top. Crop is kept apart: the last one wins, and it's applied when saving.
 */

export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; w: number; h: number; }

export type Mark =
    | { kind: "blur"; rect: Rect; seed: number; }
    | { kind: "box"; rect: Rect; color: string; width: number; }
    | { kind: "arrow"; from: Point; to: Point; color: string; width: number; }
    | { kind: "pen"; points: Point[]; color: string; width: number; };

export type Tool = "crop" | Mark["kind"];

/** A rectangle between two corners, in either direction, clamped to the picture */
export function rectFrom(a: Point, b: Point, size: { w: number; h: number; }): Rect {
    const x1 = clamp(Math.min(a.x, b.x), 0, size.w), y1 = clamp(Math.min(a.y, b.y), 0, size.h);
    const x2 = clamp(Math.max(a.x, b.x), 0, size.w), y2 = clamp(Math.max(a.y, b.y), 0, size.h);
    return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Too small to mean anything: a click rather than a drag */
export const isTiny = (r: Rect) => r.w < 4 || r.h < 4;

/** Line width that reads the same on a phone screenshot and a 4K one */
export const strokeFor = (size: { w: number; h: number; }) => Math.max(3, Math.round(Math.max(size.w, size.h) / 250));

/**
 * Blocks big enough that the text under them can't be read back: at most two across the short side,
 * never under 16px. Blocks smaller than the letters, over a known font, can be matched back to the
 * text they came from (that's how Depix reads pixelated passwords).
 */
export const blockFor = (r: Rect) => Math.max(16, Math.round(Math.min(r.w, r.h) / 2));

/** How many blocks across and down: whole blocks only, so none is smaller than blockFor */
export function blockGrid(r: Rect) {
    const block = blockFor(r);
    return { cols: Math.max(1, Math.floor(r.w / block)), rows: Math.max(1, Math.floor(r.h / block)) };
}

/** How far a block's brightness is moved at random, either way */
export const BLOCK_NOISE = 12;

/** Random numbers from a seed: a blur keeps its noise while it's redrawn, and nobody else knows it */
export function seeded(seed: number) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Moves each block's brightness by a random amount (RGBA pixels, one per block). The averages then
 * don't match what any guessed text would give, which is what reading pixelation back relies on.
 */
export function addNoise(pixels: Uint8ClampedArray, random: () => number) {
    for (let i = 0; i < pixels.length; i += 4) {
        const n = Math.round((random() * 2 - 1) * BLOCK_NOISE);
        pixels[i] += n;
        pixels[i + 1] += n;
        pixels[i + 2] += n;
    }
}

/**
 * The area scaled down to cols x rows, in halving steps: smoothing at 2:1 averages every pixel,
 * while one big step only samples a few of them per block.
 */
function shrink(source: HTMLCanvasElement, r: Rect, cols: number, rows: number) {
    let from: HTMLCanvasElement = source, { x, y, w, h } = r;
    for (;;) {
        const last = w <= cols * 2 && h <= rows * 2;
        const canvas = document.createElement("canvas");
        canvas.width = last ? cols : Math.max(cols, Math.ceil(w / 2));
        canvas.height = last ? rows : Math.max(rows, Math.ceil(h / 2));
        const g = canvas.getContext("2d", { willReadFrequently: last })!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = "high";
        g.drawImage(from, x, y, w, h, 0, 0, canvas.width, canvas.height);
        if (last) return canvas;
        from = canvas;
        x = y = 0;
        w = canvas.width;
        h = canvas.height;
    }
}

/** The arrow head's two side points, for a head `len` long */
export function arrowHead(from: Point, to: Point, len: number): [Point, Point] {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const spread = Math.PI / 7;
    return [
        { x: to.x - len * Math.cos(angle - spread), y: to.y - len * Math.sin(angle - spread) },
        { x: to.x - len * Math.cos(angle + spread), y: to.y - len * Math.sin(angle + spread) },
    ];
}

export function drawMark(ctx: CanvasRenderingContext2D, mark: Mark) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    switch (mark.kind) {
        case "blur": {
            const { x, y, w, h } = mark.rect;
            if (w < 1 || h < 1) break;
            const { cols, rows } = blockGrid(mark.rect);
            const small = shrink(ctx.canvas, mark.rect, cols, rows);
            const s = small.getContext("2d")!;
            const blocks = s.getImageData(0, 0, cols, rows);
            addNoise(blocks.data, seeded(mark.seed));
            s.putImageData(blocks, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
            break;
        }
        case "box":
            ctx.strokeStyle = mark.color;
            ctx.lineWidth = mark.width;
            ctx.strokeRect(mark.rect.x, mark.rect.y, mark.rect.w, mark.rect.h);
            break;
        case "arrow": {
            ctx.strokeStyle = ctx.fillStyle = mark.color;
            ctx.lineWidth = mark.width;
            const [l, r] = arrowHead(mark.from, mark.to, mark.width * 4);
            ctx.beginPath();
            ctx.moveTo(mark.from.x, mark.from.y);
            ctx.lineTo(mark.to.x, mark.to.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(mark.to.x, mark.to.y);
            ctx.lineTo(l.x, l.y);
            ctx.lineTo(r.x, r.y);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case "pen":
            if (mark.points.length < 2) break;
            ctx.strokeStyle = mark.color;
            ctx.lineWidth = mark.width;
            ctx.beginPath();
            ctx.moveTo(mark.points[0].x, mark.points[0].y);
            for (const p of mark.points.slice(1)) ctx.lineTo(p.x, p.y);
            ctx.stroke();
            break;
    }
    ctx.restore();
}

/** The picture with every mark, at full size */
export function render(canvas: HTMLCanvasElement, image: CanvasImageSource, size: { w: number; h: number; }, marks: Mark[]) {
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, size.w, size.h);
    for (const mark of marks) drawMark(ctx, mark);
}

/** What the saved file is: PNG stays PNG, JPEG and WebP keep their type, anything else becomes PNG */
export function outputType(type: string, name: string): { type: string; name: string; } {
    if (type === "image/jpeg" || type === "image/webp") return { type, name };
    return { type: "image/png", name: /\.png$/i.test(name) ? name : name.replace(/\.[^.]*$/, "") + ".png" };
}

/** Images Quick Markup can open: still pictures the canvas can read (not GIFs, which would lose their motion) */
export const canMarkUp = (file: { type: string; name: string; }) =>
    /^image\/(png|jpeg|webp|bmp)$/.test(file.type) || /\.(png|jpe?g|jfif|webp|bmp)$/i.test(file.name);
