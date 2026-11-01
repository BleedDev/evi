/**
 * The question asked before an image goes out with its metadata, in Discord's dialog motion
 * (openLayer). One at a time: uploads that need asking while one is open wait their turn.
 */
import { openLayer, React } from "@evi/api";
import type { CloseLayer } from "@evi/api";

import { t } from "./strings";

/** How many names the dialog lists before "…" */
const MAX_NAMES = 3;

/** "a.heic, b.tiff, c.avif, …" */
export function listNames(names: string[]) {
    return names.slice(0, MAX_NAMES).join(", ") + (names.length > MAX_NAMES ? ", …" : "");
}

/** "stopped": the plugin stopped before the person answered */
export type Answer = "upload" | "skip" | "stopped";

let queue: Promise<unknown> = Promise.resolve();
/** Bumped when the plugin stops, so questions still waiting their turn aren't asked */
let generation = 0;
/** Closes the open dialog without an answer */
let stopOpen: (() => void) | undefined;

export function askToUpload(names: string[]): Promise<Answer> {
    const asked = generation;
    const answer = queue.then(() => asked === generation ? ask(names) : "stopped" as const);
    queue = answer.catch(() => {});
    return answer;
}

/** The plugin is stopping: the open dialog and every waiting one end as "stopped" */
export function closeDialogs() {
    generation++;
    stopOpen?.();
}

function ask(names: string[]) {
    return new Promise<Answer>(resolve => {
        let settled = false;
        const finish = (answer: Answer, options?: { instant?: boolean; }) => {
            if (settled) return;
            settled = true;
            close(options);
            resolve(answer);
        };
        const stop = () => finish("stopped", { instant: true });
        const close: CloseLayer = openLayer(() => <Prompt names={names} onUpload={() => finish("upload")} onSkip={() => finish("skip")} />, {
            onClosed: () => void (stopOpen === stop && (stopOpen = undefined)),
        });
        stopOpen = stop;
    });
}

function Prompt({ names, onUpload, onSkip }: { names: string[]; onUpload(): void; onSkip(): void; }) {
    const skipRef = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        skipRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            onSkip();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            window.removeEventListener("keydown", onKey, true);
            previous?.focus?.();
        };
    }, []);

    const count = names.length;
    const listed = listNames(names);

    return (
        <div className="evi-strip-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && onSkip()}>
            <div className="evi-strip-modal evi-modal" role="alertdialog" aria-modal="true" aria-labelledby="evi-strip-title" aria-describedby="evi-strip-body">
                <div className="evi-strip-content">
                    <h2 id="evi-strip-title">{t("dialog.title", { count })}</h2>
                    <p id="evi-strip-body">{t("dialog.body", { count, name: listed })}</p>
                </div>
                <footer className="evi-strip-actions">
                    <button className="evi-strip-upload" onClick={onUpload}>{t("dialog.upload", { count })}</button>
                    <button className="evi-strip-skip" ref={skipRef} onClick={onSkip}>{t("dialog.skip")}</button>
                </footer>
            </div>
        </div>
    );
}

export const dialogCss = `
.evi-strip-scrim { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center; background: rgba(0,0,0,.7); }
.evi-strip-modal { width: min(440px, calc(100vw - 32px)); display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
  background: var(--modal-background, var(--background-base-low, #313338)); color: var(--text-default, var(--text-normal, #dbdee1)); border: 1px solid var(--border-subtle, transparent);
  box-shadow: var(--shadow-high, 0 8px 24px rgba(0,0,0,.4)); font-family: var(--font-primary); }
.evi-strip-content { padding: 20px 20px 16px; }
.evi-strip-content h2 { margin: 0 0 8px; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-strip-content p { margin: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.evi-strip-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 20px 20px; }
.evi-strip-actions button { min-height: 38px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.evi-strip-skip { background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); }
.evi-strip-skip:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
.evi-strip-upload { background: none; color: var(--text-default, #dbdee1); }
.evi-strip-upload:hover { text-decoration: underline; }
.evi-strip-actions button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
`;
