/**
 * Upload tools: in Discord's upload preview (the files above the chat bar, waiting to be sent), drag
 * a file to reorder, Alt+arrow keys on a selected file to move it, and one button to mark them all as
 * spoilers or none.
 *
 * Checked against Discord's code on 2026-10-25: the preview is a <ul> of one <li> tile per upload
 * from UploadAttachmentStore.getUploads(channelId, draftType). Each upload is a CloudUpload that
 * starts uploading when it's added. The order it's sent in is the store's order, which
 * setUploads({ channelId, draftType, uploads }) replaces (same uploads, so nothing uploads again);
 * update(channelId, id, draftType, { spoiler }) is what each tile's own spoiler button calls.
 * index.tsx's patch hands us the tiles; we add a last <li> with the spoiler button, which also
 * listens on the list for drags. Tiles are moved with transforms while dragging and the new order
 * is set when the tile is dropped.
 */
import { Components, find, getStore, React, useLocale } from "@evi/api";
import type { ReactNode } from "react";

import { move, nearestSlot, reorderShown, shiftedIndex } from "./order";
import type { Rect } from "./order";
import { isOn, state, uploadActions } from "./state";
import { t } from "./strings";

interface Upload { id: string; spoiler?: boolean; }

const EYE = "M12 5C6.5 5 2.73 9.11 1.5 12c1.23 2.89 5 7 10.5 7s9.27-4.11 10.5-7C21.27 9.11 17.5 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z";
const EYE_OFF = "M2.3 3.7a1 1 0 0 1 1.4-1.4l18 18a1 1 0 0 1-1.4 1.4l-3.04-3.03A11.6 11.6 0 0 1 12 19c-5.5 0-9.27-4.11-10.5-7a12.9 12.9 0 0 1 3.75-4.84L2.3 3.7Zm6.3 6.3a4 4 0 0 0 5.4 5.4l-1.53-1.53a2 2 0 0 1-2.34-2.34L8.6 10ZM12 5c5.5 0 9.27 4.11 10.5 7a13.3 13.3 0 0 1-2.86 4.03L15.9 12.3a4 4 0 0 0-4.2-4.2L9.33 5.73A11.6 11.6 0 0 1 12 5Z";

/** A drag starts once the pointer has moved this far, so clicks on a tile still open it */
const DRAG_FROM_PX = 5;
/** How long a dropped tile takes to settle into its place, as in index.tsx's CSS */
const SETTLE_MS = 160;
/** Near a scrolling list's edge, dragging scrolls it */
const EDGE_PX = 48;

function setUploads(channelId: string, draftType: number, shown: Upload[]) {
    const actions = find(uploadActions);
    if (typeof actions?.setUploads !== "function") return false;
    const store = getStore("UploadAttachmentStore") as any;
    const all: Upload[] = store?.getUploads?.(channelId, draftType) ?? shown;
    actions.setUploads({ channelId, draftType, uploads: reorderShown(all, shown) });
    return true;
}

function clearShift(list: HTMLElement) {
    list.classList.remove("evi-ut-sorting");
    for (const el of list.children) {
        if (!(el instanceof HTMLElement)) continue;
        el.classList.remove("evi-ut-dragged", "evi-ut-settling");
        el.style.removeProperty("transform");
    }
}

/** The nearest element that scrolls, the list itself included */
function scrollerOf(el: HTMLElement): HTMLElement {
    for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if ((/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth)
            || (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight)) return node;
    }
    return document.documentElement;
}

interface Source { uploads(): Upload[]; commit(order: Upload[]): boolean; }

/** Pointer and keyboard reordering on the preview's list. Returns its cleanup */
function attachSorting(list: HTMLElement, tools: HTMLElement, source: Source): () => void {
    const tiles = () => [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "LI" && el !== tools);

    let pressed: { tile: HTMLElement; from: number; x: number; y: number; pointerId: number; } | undefined;
    let drag: {
        tile: HTMLElement; from: number; to: number; all: HTMLElement[]; slots: Rect[];
        scroller: HTMLElement; startX: number; startY: number; x: number; y: number; pointerId: number;
    } | undefined;
    let settling: ReturnType<typeof setTimeout> | undefined;
    let scrolling = 0;

    /** Client coordinates as positions in the scroller's content, which don't change as it scrolls */
    const contentPoint = (x: number, y: number) => drag ? { x: x + drag.scroller.scrollLeft, y: y + drag.scroller.scrollTop } : { x, y };

    function layout() {
        if (!drag) return;
        const { x, y } = contentPoint(drag.x, drag.y);
        drag.to = Math.max(0, nearestSlot(drag.slots, x, y));
        drag.tile.style.transform = `translate(${x - drag.startX}px, ${y - drag.startY}px)`;
        drag.all.forEach((el, i) => {
            if (i === drag!.from) return;
            const at = shiftedIndex(i, drag!.from, drag!.to);
            const dx = drag!.slots[at].left - drag!.slots[i].left, dy = drag!.slots[at].top - drag!.slots[i].top;
            if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
            else el.style.removeProperty("transform");
        });
    }

    function autoScroll() {
        scrolling = 0;
        if (!drag) return;
        const box = drag.scroller.getBoundingClientRect();
        const step = (p: number, start: number, end: number) => p < start + EDGE_PX ? -Math.ceil((start + EDGE_PX - p) / 4) : p > end - EDGE_PX ? Math.ceil((p - end + EDGE_PX) / 4) : 0;
        const dx = drag.scroller.scrollWidth > drag.scroller.clientWidth ? step(drag.x, box.left, box.right) : 0;
        const dy = drag.scroller.scrollHeight > drag.scroller.clientHeight ? step(drag.y, box.top, box.bottom) : 0;
        if (!dx && !dy) return;
        drag.scroller.scrollBy(dx, dy);
        layout();
        scrolling = requestAnimationFrame(autoScroll);
    }

    function begin() {
        if (!pressed) return;
        const all = tiles();
        if (all.length !== source.uploads().length || all.indexOf(pressed.tile) !== pressed.from) return void (pressed = undefined);
        const scroller = scrollerOf(list);
        const slots = all.map(el => {
            const r = el.getBoundingClientRect();
            return { left: r.left + scroller.scrollLeft, top: r.top + scroller.scrollTop, width: r.width, height: r.height };
        });
        drag = {
            tile: pressed.tile, from: pressed.from, to: pressed.from, all, slots, scroller, pointerId: pressed.pointerId,
            startX: pressed.x + scroller.scrollLeft, startY: pressed.y + scroller.scrollTop, x: pressed.x, y: pressed.y,
        };
        pressed = undefined;
        try {
            list.setPointerCapture(drag.pointerId);
        } catch { }
        list.classList.add("evi-ut-sorting");
        drag.tile.classList.add("evi-ut-dragged");
    }

    /** The click that ends a drag isn't a click on the tile */
    function swallowClick() {
        const stop = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener("click", stop, true);
        setTimeout(() => window.removeEventListener("click", stop, true), 0);
    }

    function finish(commit: boolean) {
        const done = drag;
        drag = undefined;
        cancelAnimationFrame(scrolling);
        if (!done) return;
        try {
            list.releasePointerCapture(done.pointerId);
        } catch { }
        const to = commit ? done.to : done.from;
        if (!commit) done.all.forEach((el, i) => i !== done.from && el.style.removeProperty("transform"));
        // The dropped tile glides into its new place; the order changes once it's there
        done.tile.classList.add("evi-ut-settling");
        const target = done.slots[to], origin = done.slots[done.from];
        done.tile.style.transform = target.left === origin.left && target.top === origin.top ? "translate(0px, 0px)" : `translate(${target.left - origin.left}px, ${target.top - origin.top}px)`;
        settling = setTimeout(() => {
            settling = undefined;
            const uploads = source.uploads();
            // Tools clears the transforms as the new order renders; without a new order, clear them now
            if (to === done.from || uploads.length !== done.all.length || !source.commit(move(uploads, done.from, to))) clearShift(list);
        }, SETTLE_MS);
    }

    const onDown = (e: PointerEvent) => {
        if (e.button !== 0 || drag || settling) return;
        const tile = (e.target as Element | null)?.closest?.("li");
        if (!(tile instanceof HTMLElement) || tile.parentElement !== list || tile === tools) return;
        pressed = { tile, from: tiles().indexOf(tile), x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
        if (pressed && e.pointerId === pressed.pointerId && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) >= DRAG_FROM_PX) begin();
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        layout();
        if (!scrolling) scrolling = requestAnimationFrame(autoScroll);
    };
    const onUp = (e: PointerEvent) => {
        pressed = undefined;
        if (!drag || e.pointerId !== drag.pointerId) return;
        swallowClick();
        finish(e.type === "pointerup");
    };
    const onKey = (e: KeyboardEvent) => {
        if (drag && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            return finish(false);
        }
        if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || drag || settling) return;
        const tile = (e.target as Element | null)?.closest?.("li");
        if (!(tile instanceof HTMLElement) || tile.parentElement !== list || tile === tools) return;
        const all = tiles(), uploads = source.uploads();
        const from = all.indexOf(tile);
        const rtl = getComputedStyle(list).direction === "rtl";
        const to = from + ((e.key === "ArrowRight") !== rtl ? 1 : -1);
        if (from < 0 || to < 0 || to >= all.length || all.length !== uploads.length) return;
        e.preventDefault();
        e.stopPropagation();
        if (source.commit(move(uploads, from, to))) requestAnimationFrame(() => tile.isConnected && tile.focus());
    };
    // Dragging a picture would start the browser's own drag of it
    const onDragStart = (e: DragEvent) => {
        if ((e.target as Element | null)?.closest?.("li") !== tools) e.preventDefault();
    };

    list.classList.add("evi-ut-sortable");
    list.addEventListener("pointerdown", onDown);
    list.addEventListener("pointermove", onMove);
    list.addEventListener("pointerup", onUp);
    list.addEventListener("pointercancel", onUp);
    list.addEventListener("keydown", onKey, true);
    list.addEventListener("dragstart", onDragStart);
    return () => {
        list.removeEventListener("pointerdown", onDown);
        list.removeEventListener("pointermove", onMove);
        list.removeEventListener("pointerup", onUp);
        list.removeEventListener("pointercancel", onUp);
        list.removeEventListener("keydown", onKey, true);
        list.removeEventListener("dragstart", onDragStart);
        cancelAnimationFrame(scrolling);
        clearTimeout(settling);
        drag = pressed = undefined;
        clearShift(list);
        list.classList.remove("evi-ut-sortable");
    };
}

function Tools({ uploads, channelId, draftType }: { uploads: Upload[]; channelId: string; draftType: number; }) {
    useLocale();
    const ref = React.useRef<HTMLLIElement>(null);
    const latest = React.useRef(uploads);
    latest.current = uploads;
    const order = uploads.map(u => u.id).join(",");

    // The new order is on screen: the tiles are where their transforms put them, so drop those
    // before it's painted
    React.useLayoutEffect(() => {
        const list = ref.current?.parentElement;
        if (list) clearShift(list);
    }, [order]);

    React.useEffect(() => {
        const tools = ref.current, list = tools?.parentElement;
        if (!tools || !list) return;
        return attachSorting(list, tools, {
            uploads: () => latest.current,
            commit: shown => {
                try {
                    return setUploads(channelId, draftType, shown);
                } catch (err) {
                    state.ctx?.logger.error("Couldn't reorder", err);
                    return false;
                }
            },
        });
    }, [channelId, draftType]);

    const allSpoilers = uploads.every(u => u.spoiler);
    const label = allSpoilers ? t("tools.unspoilerAll") : t("tools.spoilerAll");
    const toggle = () => {
        const actions = find(uploadActions);
        if (typeof actions?.update !== "function") return;
        for (const u of uploads) {
            if (!!u.spoiler === !allSpoilers) continue;
            actions.update(channelId, u.id, draftType, { spoiler: !allSpoilers });
        }
    };

    const button = (
        <button type="button" className="evi-ut-tool" aria-label={label} aria-pressed={allSpoilers} onClick={toggle}>
            <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={allSpoilers ? EYE_OFF : EYE} /></svg>
        </button>
    );
    const Tooltip = Components.Tooltip;
    return (
        <li ref={ref} className="evi-ut-tools" aria-label={t("tools.label")}>
            {Tooltip ? <Tooltip text={label}>{button}</Tooltip> : React.cloneElement(button, { title: label })}
        </li>
    );
}

/** The patched preview's tiles, and our tools after them when there are two or more files */
export function withTools(tiles: ReactNode, uploads: Upload[], channelId: string, draftType: number): ReactNode {
    if (!isOn("previewTools") || !Array.isArray(tiles) || !Array.isArray(uploads) || uploads.length < 2) return tiles;
    return [...tiles, <Tools key="evi-upload-tools" uploads={uploads} channelId={channelId} draftType={draftType} />];
}
