/**
 * Translates messages in place: a "Translate" item in the message menu and a button in the message
 * hover bar put the translation right under the message, rendered with Discord's own markdown.
 *
 * - Network: Discord's CSP blocks translate.googleapis.com from the page, so native.ts makes the
 *   request in the main process (Google's free "gtx" endpoint, which also names the detected language).
 * - Rendering: the exported function that renders a message's accessories (the one Message Logger
 *   uses) is hooked to put our block first, directly under the message text.
 * - Hover bar: a source patch adds our button after Discord's Reply button.
 * - Automatic mode: when a message from someone else renders, it's queued (one request every
 *   1.2s, newest kept when scrolling floods it) and the translation only shows if the detected
 *   language is one the user listed, or anything but theirs. Results are cached per message and
 *   target language (LRU, memory only). Code, links, mentions and emoji are never sent for translation.
 */
import { definePlugin, filters, findMenuGroup, getStore, Menu, React } from "@evi/api";
import type { Filter, PluginContext } from "@evi/api";

import {
    cacheKey, googleLanguage, isTranslatable, languageName, LRU, normalizeLanguage, parseLanguageList, protect, RateQueue, restore,
    shouldAutoTranslate, shouldShowAuto,
} from "./translate";
import { t } from "./strings";
import type { AutoMode, AutoOptions, Translation } from "./translate";

const settings = {
    target: {
        type: "string",
        get label() { return t("settings.target"); },
        get description() { return t("settings.target.description"); },
        placeholder: "en",
        default: "",
    },
    autoMode: {
        type: "select",
        get label() { return t("settings.autoMode"); },
        get description() { return t("settings.autoMode.description"); },
        default: "off",
        options: [
            { get label() { return t("settings.autoMode.off"); }, value: "off" },
            { get label() { return t("settings.autoMode.list"); }, value: "list" },
            { get label() { return t("settings.autoMode.foreign"); }, value: "foreign" },
        ],
    },
    autoLanguages: {
        type: "string",
        get label() { return t("settings.autoLanguages"); },
        get description() { return t("settings.autoLanguages.description"); },
        placeholder: "es, ja, de",
        default: "",
    },
    ignoreBots: { type: "boolean", get label() { return t("settings.ignoreBots"); }, get description() { return t("settings.ignoreBots.description"); }, default: true },
    hoverButton: { type: "boolean", get label() { return t("settings.hoverButton"); }, get description() { return t("settings.hoverButton.description"); }, default: true },
} as const;

type Ctx = PluginContext<typeof settings>;

/** Waits between two requests to Google, and how long to back off after "too many requests" */
const INTERVAL = 1200;
const BACKOFF = 60_000;
const MAX_QUEUED = 25;
const CACHE_SIZE = 500;

const accessoriesFilter = filters.byCode("channelMessageProps:{message:", "isAutomodBlockedMessage:");
const renderedContentFilter = filters.byCode('"useMessageRenderedContent"', "hideSimpleEmbedContent");
const MARKUP_CLASS = /^markup_+[\da-f]+$/;
/** Discord's `markup` CSS module. Plain-string code hints: a regex over every module's source costs far more. */
const markupFilter: Filter = Object.assign(
    (v: any) => !!v && typeof v === "object" && !Array.isArray(v)
        && Object.values(v).some(c => typeof c === "string" && MARKUP_CLASS.test(c))
        && Object.values(v).some(c => typeof c === "string" && /^codeContainer_+[\da-f]+$/.test(c)),
    { $code: ['"markup_', '"codeContainer_'] },
);

type RenderedContent = (message: any, options: Record<string, unknown>) => { content: React.ReactNode; };
let useRenderedContent: RenderedContent | undefined;
let markupClass = "";

type Entry =
    | { state: "loading"; content: string; }
    | { state: "done"; content: string; result: Translation; }
    | { state: "error"; content: string; error: string; };

/** What the block under a message shows: the translation, only its caption, or nothing */
type View = "shown" | "collapsed" | "dismissed";

const css = `
.dl-it {
    text-indent: 0;
    margin: 0.125rem 0 0.25rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--brand-500, var(--brand-experiment, #5865f2));
    font-family: var(--font-primary);
    max-width: 100%;
}
.dl-it-text {
    color: var(--text-normal, #dbdee1);
    font-size: 1rem;
    line-height: 1.375rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.dl-it-caption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    color: var(--text-muted, #949ba4);
    font-size: 0.75rem;
    line-height: 1rem;
    font-weight: 500;
}
.dl-it-error { color: var(--text-feedback-critical, var(--status-danger, #f23f43)); }
.dl-it-link {
    all: unset;
    cursor: pointer;
    color: var(--text-link, #00a8fc);
    border-radius: 3px;
}
.dl-it-link:hover { text-decoration: underline; }
.dl-it-link:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
`;

const stores = new Map<string, any>();

/** A Flux store, found once: every message render asks */
function store(name: string): any {
    let found = stores.get(name);
    if (found) return found;
    try {
        found = getStore(name);
    } catch {
        return undefined;
    }
    stores.set(name, found);
    return found;
}

function discordLocale(): string {
    return store("LocaleStore")?.locale || document.documentElement.lang || navigator.language || "en";
}

/** Your id, looked up once and again on reconnect */
let me: string | undefined;
const currentUserId = (): string | undefined => me ??= store("UserStore")?.getCurrentUser?.()?.id;

function isOwn(message: any) {
    const id = currentUserId();
    return !!id && message?.author?.id === id;
}

/** Everything that lives while the plugin runs */
class Runtime {
    readonly cache = new LRU<string, Entry>(CACHE_SIZE);
    readonly views = new LRU<string, View>(CACHE_SIZE);
    /**
     * Listeners per message and target (cacheKey): a translation arriving re-renders its own
     * message's block and button, not every message on screen
     */
    private listeners = new Map<string, Set<() => void>>();
    /** Bumped when everything re-renders: settings, Discord's language, stopping */
    epoch = 0;
    readonly queue: RateQueue;
    /** The target language and automatic mode options, worked out once per settings or language change */
    private cachedTarget: string | undefined;
    private cachedOptions: AutoOptions | undefined;

    constructor(readonly ctx: Ctx) {
        // A dropped auto job forgets its "loading" entry, so it's queued again when it renders next
        this.queue = new RateQueue(INTERVAL, MAX_QUEUED, key => {
            if (this.cache.peek(key)?.state === "loading") {
                this.cache.delete(key);
                this.emit(key);
            }
        });
    }

    subscribe(key: string, fn: () => void) {
        let set = this.listeners.get(key);
        if (!set) this.listeners.set(key, set = new Set());
        set.add(fn);
        return () => {
            set.delete(fn);
            if (!set.size && this.listeners.get(key) === set) this.listeners.delete(key);
        };
    }

    /** Re-renders one message's block and button, or everything without a key */
    emit(key?: string) {
        if (key === undefined) {
            this.epoch++;
            for (const set of [...this.listeners.values()]) for (const fn of [...set]) fn();
            return;
        }
        const set = this.listeners.get(key);
        if (set) for (const fn of [...set]) fn();
    }

    /** Settings or Discord's language changed: work the target and options out again, re-render everything */
    invalidate() {
        this.cachedTarget = undefined;
        this.cachedOptions = undefined;
        this.emit();
    }

    target() {
        return this.cachedTarget ??= normalizeLanguage(this.ctx.settings.get("target")) ?? googleLanguage(discordLocale());
    }

    autoMode() {
        return this.ctx.settings.get("autoMode") as AutoMode;
    }

    autoOptions(): AutoOptions {
        const id = currentUserId();
        if (this.cachedOptions && this.cachedOptions.currentUserId === id) return this.cachedOptions;
        return this.cachedOptions = {
            mode: this.autoMode(),
            languages: parseLanguageList(this.ctx.settings.get("autoLanguages")),
            target: this.target(),
            currentUserId: id,
            ignoreBots: this.ctx.settings.get("ignoreBots"),
        };
    }

    setView(key: string, view: View | undefined) {
        if (view) this.views.set(key, view);
        else this.views.delete(key);
        this.emit(key);
    }

    /** Queues a translation unless an up-to-date one is cached or on its way */
    request(message: any, urgent: boolean) {
        const content: string = message.content;
        const target = this.target();
        const key = cacheKey(message.id, target);
        const cached = this.cache.get(key);
        if (cached && cached.content === content) {
            if (cached.state === "done") return;
            if (cached.state === "error" && !urgent) return;
            // Already running, or queued: only a click moves it to the front
            if (cached.state === "loading" && (!urgent || !this.queue.has(key))) return;
        }

        this.cache.set(key, { state: "loading", content });
        this.emit(key);

        this.queue.add(key, async () => {
            const auto = !urgent;
            try {
                const { text, tokens } = protect(content);
                const result = await this.ctx.native.call<Translation>("translate", text, target);
                const translation = { source: result.source, text: restore(result.text, tokens) };
                if (this.cache.peek(key)?.content !== content) return;
                this.cache.set(key, { state: "done", content, result: translation });
                if (auto && !this.views.has(key) && shouldShowAuto(translation, content, this.autoOptions())) this.views.set(key, "shown");
            } catch (err) {
                const error = String((err as Error)?.message ?? err).replace(/^Error invoking remote method[^:]*:\s*(?:Error:\s*)?/, "");
                if (/\b429\b/.test(error)) this.queue.pause(BACKOFF);
                if (this.cache.peek(key)?.content === content) this.cache.set(key, { state: "error", content, error });
                if (!auto) this.ctx.logger.warn("Translation failed", error);
            } finally {
                this.emit(key);
            }
        }, urgent);
    }

    /** Menu item and hover button: show, or hide when already showing */
    toggle(message: any) {
        const key = cacheKey(message.id, this.target());
        if (this.views.peek(key) === "shown") return this.setView(key, "dismissed");
        this.views.set(key, "shown");
        this.request(message, true);
        this.emit(key);
    }

    isShown(message: any) {
        return this.views.peek(cacheKey(message.id, this.target())) === "shown";
    }

    /** What a message's block shows, as one value that changes when it should re-render */
    snapshot(key: string) {
        return `${this.epoch}|${this.views.peek(key) ?? ""}|${this.cache.peek(key)?.state ?? ""}`;
    }

    dispose() {
        this.queue.stop();
        this.cache.clear();
        this.views.clear();
        this.emit();
    }
}

let active: Runtime | undefined;

function RichText({ message, text }: { message: any; text: string; }) {
    const render = useRenderedContent!;
    const record = React.useMemo(() => message.set?.("content", text) ?? { ...message, content: text }, [message, text]);
    const rendered = render(record, { hideSimpleEmbedContent: false, formatInline: false, allowLinks: true, allowList: true, allowHeading: true });
    return <>{rendered?.content ?? text}</>;
}

function Caption({ children }: { children: React.ReactNode; }) {
    const items = React.Children.toArray(children);
    return (
        <div className="dl-it-caption">
            {items.map((item, i) => <React.Fragment key={i}>{i > 0 && <span aria-hidden="true">·</span>}{item}</React.Fragment>)}
        </div>
    );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode; }) {
    return <button type="button" className="dl-it-link" onClick={onClick}>{children}</button>;
}

/** Re-renders when this message's translation or view changes, or on a settings change */
function useMessageState(runtime: Runtime, key: string) {
    const subscribe = React.useCallback((fn: () => void) => runtime.subscribe(key, fn), [runtime, key]);
    return React.useSyncExternalStore(subscribe, () => runtime.snapshot(key));
}

function Inline({ runtime, message }: { runtime: Runtime; message: any; }) {
    const target = runtime.target();
    const key = cacheKey(message.id, target);
    useMessageState(runtime, key);
    const entry = runtime.cache.peek(key);
    const view = runtime.views.peek(key);
    const content: string = typeof message.content === "string" ? message.content : "";

    // Automatic mode, and manual translations that went stale after an edit
    React.useEffect(() => {
        if (!content) return;
        const shown = runtime.views.peek(key) === "shown";
        // Most messages: nothing is shown and automatic mode is off, so there's nothing to work out
        if (!shown && runtime.autoMode() === "off") return;
        const cached = runtime.cache.peek(key);
        if (cached && cached.content === content) return;
        if (shown) return runtime.request(message, true);
        if (runtime.views.peek(key) !== "dismissed" && shouldAutoTranslate(message, runtime.autoOptions())) runtime.request(message, false);
    }, [key, content, runtime.epoch]);

    if (!view || view === "dismissed" || !entry || entry.content !== content) return null;
    const dismiss = () => runtime.setView(key, "dismissed");
    const uiLocale = discordLocale();

    if (entry.state === "loading") {
        return <div className="dl-it" role="status"><Caption><span>{t("translating")}</span></Caption></div>;
    }
    if (entry.state === "error") {
        return (
            <div className="dl-it" role="alert">
                <Caption>
                    <span className="dl-it-error">{t("error")}</span>
                    <LinkButton onClick={() => { runtime.setView(key, "shown"); runtime.request(message, true); }}>{t("retry")}</LinkButton>
                    <LinkButton onClick={dismiss}>{t("dismiss")}</LinkButton>
                </Caption>
            </div>
        );
    }

    const from = languageName(entry.result.source, uiLocale);
    return (
        <div className="dl-it" lang={target}>
            {view === "shown" && (
                <div className={`dl-it-text ${markupClass}`}>
                    {useRenderedContent ? <RichText message={message} text={entry.result.text} /> : entry.result.text}
                </div>
            )}
            <Caption>
                <span>{t("from", { language: from })}</span>
                {view === "shown"
                    ? <LinkButton onClick={() => runtime.setView(key, "collapsed")}>{t("original.show")}</LinkButton>
                    : <LinkButton onClick={() => runtime.setView(key, "shown")}>{t("translation.show")}</LinkButton>}
                <LinkButton onClick={dismiss}>{t("dismiss")}</LinkButton>
            </Caption>
        </div>
    );
}

/** Material Symbols "translate", sized by Discord's hover bar icon class */
function TranslateIcon(props: { className?: string; color?: string; }) {
    return (
        <svg className={props.className} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill={props.color ?? "currentColor"}>
            <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
        </svg>
    );
}

function HoverButton({ runtime, Button, message }: { runtime: Runtime; Button: React.ComponentType<any>; message: any; }) {
    useMessageState(runtime, cacheKey(message.id, runtime.target()));
    const shown = runtime.isShown(message);
    return <Button label={t(shown ? "translate.hide" : "translate")} icon={TranslateIcon} onClick={() => runtime.toggle(message)} />;
}

const canTranslate = (message: any) => !!message?.id && typeof message.content === "string" && isTranslatable(message.content) && !isOwn(message);

export default definePlugin({
    settings,

    patches: [{
        // The message hover bar: (0,a.jsx)(nt.qv,{label:…,icon:…,onClick:e=>(0,tx.$b)(t,n,e)},"reply-other"):null,
        // (the button was a plain local, nl, before Discord's October 2026 build; either works)
        find: '},"reply-other")',
        replace: {
            match: /(\(0,\i\.jsx\)\((\i(?:\.\i)?),\{label:[^{}]*?onClick:\i=>\(0,\i\.\i\)\((\i),(\i),\i\)\},"reply-other"\):null,)/,
            with: "$1$self.hoverButton($2,$3,$4),",
        },
    }],

    /** Called by the hover bar for every message: our button, or nothing */
    hoverButton(Button: React.ComponentType<any>, _channel: unknown, message: any) {
        try {
            const runtime = active;
            if (!runtime || !Button || !runtime.ctx.settings.get("hoverButton") || !canTranslate(message)) return null;
            return <HoverButton key="evi-translate" runtime={runtime} Button={Button} message={message} />;
        } catch {
            return null;
        }
    },

    start(ctx) {
        const runtime = new Runtime(ctx);
        active = runtime;
        ctx.onDispose(() => {
            if (active === runtime) active = undefined;
            runtime.dispose();
        });

        ctx.addStyle(css);
        // Kept from an earlier start: no need to search every module again
        if (!useRenderedContent) ctx.waitFor(renderedContentFilter, fn => void (useRenderedContent = fn));
        if (!markupClass) ctx.waitFor(markupFilter, classes => {
            markupClass = Object.values(classes).find((c): c is string => typeof c === "string" && MARKUP_CLASS.test(c)) ?? "";
        });

        // Discord's renderMessageAccessories({ channelMessageProps: { message }, ... }): our block goes first
        ctx.hookExport("after", accessoriesFilter, ({ args, result }) => {
            const props = args[0];
            const message = props?.channelMessageProps?.message;
            if (result == null || props.isMessageSnapshot || !message?.id || typeof message.content !== "string" || !message.content) return;
            return <><Inline key="evi-translate" runtime={runtime} message={message} />{result}</>;
        });

        ctx.contextMenu("message", (children, { message }) => {
            if (!canTranslate(message)) return;
            (findMenuGroup(children, "copy-text") ?? children).push(
                <Menu.Item
                    id="evi-inline-translate"
                    label={t(runtime.isShown(message) ? "translate.hide" : "translate")}
                    action={() => runtime.toggle(message)}
                />,
            );
        });

        // Settings changes re-render every block (target language, automatic mode), and so does
        // changing Discord's language when the target follows it
        ctx.settings.onChange(() => runtime.invalidate());
        const locale = store("LocaleStore");
        let lastLocale = locale?.locale;
        const onLocale = () => {
            if (locale.locale === lastLocale) return;
            lastLocale = locale.locale;
            runtime.invalidate();
        };
        locale?.addChangeListener?.(onLocale);
        ctx.onDispose(() => locale?.removeChangeListener?.(onLocale));
        // Another account: your own messages are someone else's now. A reconnect to the same one
        // (waking up, a network blip) changes nothing, so every message isn't redrawn for it
        ctx.flux.subscribe("CONNECTION_OPEN", action => {
            const previous = me;
            me = typeof action.user?.id === "string" ? action.user.id : undefined;
            if (me !== undefined && me === previous) return;
            runtime.invalidate();
        });
        ctx.onDispose(() => void (me = undefined));
    },
});
