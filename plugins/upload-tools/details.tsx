/**
 * Upload details: under Discord's own bar on a message that's sending files, its speed and time left,
 * and when it has several files, each one with its own progress and a cancel button.
 *
 * Checked against Discord's code on 2026-10-25: a message with files is sent by an Uploader that
 * uploads each file on its own (a CloudUpload each, straight to Discord's storage, all at once),
 * then posts the message with the ones it still has. Its progress reaches the pending message as
 * `file`: { id, progress, currentSize, items: the CloudUploads, each with id, filename, loaded,
 * currentSize, status }. Discord's UploadStore already handles UPLOAD_ITEM_CANCEL_REQUEST
 * ({ file, itemId }) by calling the Uploader's cancelItem: it drops that file and sends the message
 * with the rest (cancelling the last one cancels the message). Discord's desktop app has no button
 * for it; we add one.
 */
import { Dispatcher, React, useLocale } from "@evi/api";

import { fraction, SpeedMeter } from "./progress";
import { formatLeft, formatPercent, formatSize, state } from "./state";
import { t } from "./strings";

export interface UploadItem {
    id: string;
    filename?: string;
    loaded?: number;
    currentSize?: number;
    status?: string;
}
export interface UploaderFile {
    id: string;
    progress: number;
    currentSize: number;
    items?: UploadItem[];
}

const CLOSE = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";

export function CloseGlyph({ size = 16 }: { size?: number; }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={CLOSE} /></svg>;
}

const itemTotal = (item: UploadItem) => Math.max(0, item.currentSize ?? 0);
const itemLoaded = (item: UploadItem) => item.status === "COMPLETED" ? itemTotal(item) : Math.min(itemTotal(item), Math.max(0, item.loaded ?? 0));

export function UploadDetails({ channelId, file }: { channelId: string; file: UploaderFile; }) {
    useLocale();
    const [meter] = React.useState(() => new SpeedMeter());
    // Files cancelled here, hidden at once: Discord's file only lists them again on its next progress
    const [cancelled, setCancelled] = React.useState<ReadonlySet<string>>(() => new Set());
    const [, tick] = React.useState(0);

    const done = file.progress >= 100;
    // A stalled upload sends no progress: look again every second so the speed falls
    React.useEffect(() => {
        if (done) return;
        const timer = setInterval(() => tick(n => n + 1), 1000);
        return () => clearInterval(timer);
    }, [done]);

    if (done) return null;
    const items = (file.items ?? []).filter(item => item && !cancelled.has(item.id));
    const total = items.length ? items.reduce((sum, item) => sum + itemTotal(item), 0) : Math.max(0, file.currentSize);
    const loaded = items.length ? items.reduce((sum, item) => sum + itemLoaded(item), 0) : total * file.progress / 100;
    const speed = total > 0 ? meter.sample(loaded, total, performance.now()) : undefined;

    const stats = [
        speed && speed.rate > 0 ? t("details.speed", { size: formatSize(speed.rate) }) : t("details.starting"),
        speed?.secondsLeft !== undefined && speed.rate > 0 ? formatLeft(speed.secondsLeft) : undefined,
        total > 0 ? t("details.progress", { done: formatSize(loaded), total: formatSize(total) }) : undefined,
    ].filter(Boolean).join(" · ");

    const cancel = (item: UploadItem) => {
        try {
            Dispatcher.dispatch({ type: "UPLOAD_ITEM_CANCEL_REQUEST", channelId, file, itemId: item.id });
            setCancelled(prev => new Set(prev).add(item.id));
        } catch (err) {
            state.ctx?.logger.error("Couldn't cancel", item.filename, err);
        }
    };

    return (
        <div className="evi-ut-details">
            <div className="evi-ut-stats">{stats}</div>
            {items.length > 1 && (
                <ul className="evi-ut-files" aria-label={t("details.files")}>
                    {items.map(item => {
                        const part = fraction(itemLoaded(item), itemTotal(item));
                        const name = item.filename ?? "";
                        const uploaded = item.status === "COMPLETED";
                        return (
                            <li key={item.id} className="evi-ut-file">
                                <span className="evi-ut-file-name" title={name}>{name}</span>
                                <span className="evi-ut-file-bar" aria-hidden="true"><span style={{ transform: `scaleX(${part})` }} /></span>
                                <span className="evi-ut-file-state">{uploaded ? t("details.uploaded") : formatPercent(part)}</span>
                                <button type="button" className="evi-ut-icon-button" aria-label={t("details.cancel", { name })} title={t("details.cancel", { name })} onClick={() => cancel(item)}>
                                    <CloseGlyph />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
