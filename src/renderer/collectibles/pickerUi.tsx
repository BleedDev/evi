/**
 * What Evi draws inside Discord's pickers (pickers.ts): the mark on an Evi item's tile (Evi's "e" on
 * one you own, a lock and its price in Sparks on one you don't), and the details under the preview.
 * Small and in Discord's own overlay style, so an Evi item reads as one of Discord's with a maker's mark.
 */
import { I18n, t } from "../i18n";
import { createStyle } from "../styles";
import { React } from "../webpack/common";
import { previewOf } from "./pickers";
import { Collectibles } from "./store";

const css = `
.evi-picker-mark {
    position: absolute;
    inset-block-start: 6px;
    inset-inline-end: 6px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 20px;
    height: 20px;
    padding-inline: 4px;
    box-sizing: border-box;
    justify-content: center;
    border-radius: 10px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
}
.evi-picker-mark svg { flex: none; display: block; }
.evi-picker-details { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; }
.evi-picker-details-title { display: flex; align-items: center; gap: 6px; color: var(--text-strong, var(--header-primary)); font-size: 14px; font-weight: 600; line-height: 18px; }
.evi-picker-details-text { color: var(--text-muted); font-size: 12px; line-height: 16px; text-wrap: pretty; }
`;

let styled = false;
function ensureStyle() {
    if (styled) return;
    styled = true;
    createStyle(css, "evi-collectibles-pickers");
}

/** Evi's "e" (the same mark as Evi's Shop tab) */
function EviMark({ size }: { size: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M21.89 13.4A10 9.4 0 1 0 19.66 18.04A2 2 0 0 0 17.2 15.4C15.6 16.9 13.9 17.5 12.4 17.4C10 17.3 8.4 15.8 8 13.4ZM8.8 8.4H11.1A1.8 1.8 0 1 1 12.9 8.4H15.2A1.4 1.4 0 0 1 16.6 9.8A1.4 1.4 0 0 1 15.2 11.2H8.8A1.4 1.4 0 0 1 7.4 9.8A1.4 1.4 0 0 1 8.8 8.4Z"
            />
        </svg>
    );
}

function LockGlyph({ size }: { size: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" fillRule="evenodd" d="M6 9V7a6 6 0 1 1 12 0v2a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Zm10-2v2H8V7a4 4 0 1 1 8 0Z" />
        </svg>
    );
}

function SparkGlyph({ size }: { size: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 1.5c.5 0 .9.33 1.03.8l1.3 4.66a4 4 0 0 0 2.71 2.71l4.66 1.3a1.07 1.07 0 0 1 0 2.06l-4.66 1.3a4 4 0 0 0-2.71 2.71l-1.3 4.66a1.07 1.07 0 0 1-2.06 0l-1.3-4.66a4 4 0 0 0-2.71-2.71l-4.66-1.3a1.07 1.07 0 0 1 0-2.06l4.66-1.3a4 4 0 0 0 2.71-2.71l1.3-4.66c.13-.47.54-.8 1.03-.8Z" />
        </svg>
    );
}

const formatSparks = (n: number) => n.toLocaleString(I18n.discordLocale);

/** The mark on an Evi item's tile in a picker */
function TileMark({ skuId }: { skuId: string; }) {
    ensureStyle();
    React.useSyncExternalStore(Collectibles.subscribe, Collectibles.getVersion);
    const shown = previewOf(skuId);
    if (!shown) return null;
    if (shown.owned) {
        return <span className="evi-picker-mark" role="img" aria-label={t("collectibles.picker.mark")}><EviMark size={13} /></span>;
    }
    const { price } = shown;
    return (
        <span className="evi-picker-mark" role="img" aria-label={price === undefined ? t("collectibles.picker.locked") : t("collectibles.picker.lockedPrice", { amount: formatSparks(price) })}>
            <LockGlyph size={11} />
            {price !== undefined && <>
                <SparkGlyph size={11} />
                <span>{formatSparks(price)}</span>
            </>}
        </span>
    );
}

/** What Discord's item-tile badge draws instead for an evi: SKU */
export function tileMark(skuId: string) {
    return <TileMark skuId={skuId} />;
}

function Details({ skuId }: { skuId: string; }) {
    ensureStyle();
    React.useSyncExternalStore(Collectibles.subscribe, Collectibles.getVersion);
    const shown = previewOf(skuId);
    if (!shown) return null;
    const { bundle, owned, price } = shown;
    return (
        <div className="evi-picker-details">
            <div className="evi-picker-details-title"><EviMark size={16} />{bundle.name}</div>
            <div className="evi-picker-details-text">
                {owned ? t("collectibles.picker.owned") : price === undefined ? t("collectibles.picker.codeOnly") : t("collectibles.picker.buy", { amount: formatSparks(price) })}
            </div>
        </div>
    );
}

/** What the picker's details under its preview show for an evi: SKU */
export function previewDetails(skuId: string) {
    return <Details skuId={skuId} />;
}
