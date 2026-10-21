import { Components, definePlugin, filters, find, findAllExports, getStore, I18n, Menu, openLayer, React, registerCommand, useLocale } from "@evi/api";
import type { CloseLayer, PluginContext } from "@evi/api";
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import {
    addSnippet, BUTTON_PATCH, commandChoices, compareByName, dateValues, deleteSnippet, EMPTY, expandPlaceholders, getSnippet, MAX_NAME_LENGTH,
    MAX_TEXT_LENGTH, nameError, parseState, PLACEHOLDERS, PlaceholderValues, recordUse, resolveSnippet, searchSnippets, Snippet,
    SnippetInput, SnippetState, suggestName, textError, updateSnippet, usedPlaceholders,
} from "./snippets";
import type { SayKey } from "./snippets";
import { t } from "./strings";

/**
 * Saved replies. Snippets live in this plugin's settings entry under a key the generated settings
 * don't show, so they stay on this device and survive restarts.
 *
 * - The chat bar button (source patch in snippets.ts) opens a searchable picker: arrows move,
 *   Enter puts the snippet in the message box, and snippets can be added, edited and deleted there.
 * - /snip name:<snippet> sends it, or puts it in the message box. Discord suggests the names as you
 *   type (they're the option's choices, re-registered whenever the snippets change) until there are
 *   more than Discord shows; then the name is matched and a miss lists the close ones.
 * - "Save as Snippet" on a message's right-click menu starts a snippet from its text.
 *
 * Text goes into the message box through Discord's ComponentDispatch INSERT_TEXT event, the one its
 * own "Mention" menu item uses: the last mounted message box appends it and takes focus.
 */

const STORAGE_KEY = "snippets";

type Settings = typeof settings;
const settings = {
    showButton: {
        type: "boolean",
        get label() { return t("settings.showButton"); },
        get description() { return t("settings.showButton.description"); },
        default: true,
    },
    commandAction: {
        type: "select",
        get label() { return t("settings.commandAction"); },
        get description() { return t("settings.commandAction.description"); },
        default: "send",
        options: [
            { get label() { return t("settings.commandAction.send"); }, value: "send" },
            { get label() { return t("settings.commandAction.insert"); }, value: "insert" },
        ],
    },
} as const;

let ctx: PluginContext<Settings> | undefined;
/** The settings panel can show while the plugin is off: it reads and writes through its own context then */
let panelCtx: PluginContext<Settings> | undefined;
let state: SnippetState = EMPTY;

type Storage = { get(key: string): unknown; set(key: string, value: unknown): void; };
const storage = () => (ctx ?? panelCtx)?.settings as unknown as Storage | undefined;

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
const useSnippets = () => React.useSyncExternalStore(subscribe, () => state);

function notify() {
    for (const fn of [...listeners]) fn();
}

function commit(next: SnippetState) {
    if (next === state) return;
    state = next;
    storage()?.set(STORAGE_KEY, state);
    notify();
    syncCommand();
}

function load() {
    state = parseState(storage()?.get(STORAGE_KEY));
    notify();
}

const store = (name: string): any => {
    try {
        return getStore(name);
    } catch {
        return undefined;
    }
};

/** ComponentDispatch: the event bus message boxes listen on. The one with an INSERT_TEXT listener. */
let dispatcher: any;
function componentDispatch() {
    const listening = (d: any) => {
        try {
            return d?.emitter?.listeners?.("INSERT_TEXT")?.length > 0;
        } catch {
            return false;
        }
    };
    if (listening(dispatcher)) return dispatcher;
    const all = findAllExports(filters.byProps("dispatchToLastSubscribed", "emitter")).map(f => f.value);
    dispatcher = all.find(listening);
    return dispatcher;
}

/** Appends text to the message box (the last one mounted) and focuses it. False if there is none. */
function insertText(text: string) {
    const d = componentDispatch();
    if (!d) return false;
    d.dispatchToLastSubscribed("INSERT_TEXT", { plainText: text, rawText: text });
    return true;
}

function displayName(user: any, guildId?: string) {
    if (!user) return undefined;
    const nick = guildId ? store("GuildMemberStore")?.getMember?.(guildId, user.id)?.nick : undefined;
    return nick || user.globalName || user.global_name || user.username;
}

async function readClipboard() {
    try {
        const native = (window as any).DiscordNative?.clipboard;
        if (typeof native?.read === "function") return String(await native.read() ?? "");
        return await navigator.clipboard.readText();
    } catch {
        return "";
    }
}

/** Values for the placeholders this text uses, in this channel */
async function placeholderValues(text: string, channel: any): Promise<PlaceholderValues> {
    const used = usedPlaceholders(text);
    if (!used.size) return {};
    channel ??= store("ChannelStore")?.getChannel?.(store("SelectedChannelStore")?.getChannelId?.());
    const guildId: string | undefined = channel?.guild_id ?? undefined;
    const users = store("UserStore");
    const values: PlaceholderValues = { ...dateValues(new Date()) };

    if (used.has("user") && channel) {
        const reply = store("PendingReplyStore")?.getPendingReply?.(channel.id);
        let user = reply?.message?.author;
        if (!user && channel.isDM?.()) {
            const id = channel.getRecipientId?.() ?? channel.recipients?.[0];
            user = id ? users?.getUser?.(id) : undefined;
        }
        values.user = displayName(user, guildId);
    }
    if (used.has("me")) values.me = displayName(users?.getCurrentUser?.(), guildId);
    if (used.has("channel") && channel?.name) values.channel = channel.name;
    if (used.has("server") && guildId) values.server = store("GuildStore")?.getGuild?.(guildId)?.name;
    if (used.has("clipboard")) values.clipboard = await readClipboard();
    return values;
}

async function expand(snippet: Snippet, channel: any) {
    return expandPlaceholders(snippet.text, await placeholderValues(snippet.text, channel));
}

/** The pure module's messages, in Discord's language */
const say = (key: SayKey, vars?: Record<string, string | number>) => t(key, vars);

/** Puts a snippet in the message box and counts the use */
async function insertSnippet(snippet: Snippet, channel: any) {
    const text = await expand(snippet, channel);
    if (!insertText(text)) {
        ctx?.toast(t("toast.noBox"), { type: "failure" });
        return false;
    }
    commit(recordUse(state, snippet.id));
    return true;
}

let unregisterCommand: (() => void) | undefined;
let registeredChoices = "";

/** (Re-)registers /snip whenever its choices, the snippet names, change */
function syncCommand() {
    if (!ctx) return;
    const choices = commandChoices(state);
    const key = JSON.stringify([choices ?? null, I18n.locale]);
    if (unregisterCommand && key === registeredChoices) return;
    unregisterCommand?.();
    registeredChoices = key;
    const plugin = ctx;
    unregisterCommand = registerCommand({
        name: "snip",
        description: t("command.description"),
        options: [
            {
                name: "name",
                description: choices ? t("command.name.choices") : t("command.name.free"),
                type: "string",
                required: true,
                choices,
            },
            {
                name: "send",
                description: t("command.send"),
                type: "boolean",
                required: false,
            },
        ],
        async execute(args, command) {
            const found = resolveSnippet(state, args.name, say);
            if ("error" in found) return { ephemeral: found.error };
            const text = await expand(found.snippet, command.channel);
            commit(recordUse(state, found.snippet.id));
            const send = typeof args.send === "boolean" ? args.send : plugin.settings.get("commandAction") === "send";
            if (send) return { content: text };
            // After Discord has cleared the message box of the command
            setTimeout(() => {
                if (!insertText(text)) plugin.toast(t("toast.noBox"), { type: "failure" });
            }, 50);
        },
    }, plugin.id);
}

interface EditorProps {
    /** The snippet being edited, undefined for a new one */
    snippet?: Snippet;
    initial?: Partial<SnippetInput>;
    onDone(saved: Snippet | null): void;
    autoFocusText?: boolean;
}

function Editor({ snippet, initial, onDone, autoFocusText }: EditorProps) {
    useLocale();
    const current = useSnippets();
    const [name, setName] = React.useState(snippet?.name ?? initial?.name ?? "");
    const [text, setText] = React.useState(snippet?.text ?? initial?.text ?? "");
    const [tried, setTried] = React.useState(false);
    const textRef = React.useRef<HTMLTextAreaElement>(null);
    const nameProblem = nameError(current, name, snippet?.id, say);
    const textProblem = textError(text, say);
    const error = nameProblem ?? textProblem;

    const save = () => {
        setTried(true);
        if (error) return;
        const result = snippet ? updateSnippet(state, snippet.id, { name, text }) : addSnippet(state, { name, text });
        if (result.error || !result.snippet) return;
        commit(result.state);
        onDone(result.snippet);
    };

    const insertPlaceholder = (key: string) => {
        const el = textRef.current;
        const token = `{${key}}`;
        const start = el?.selectionStart ?? text.length;
        const end = el?.selectionEnd ?? text.length;
        setText(text.slice(0, start) + token + text.slice(end));
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(start + token.length, start + token.length);
        });
    };

    const onKeyDown = (e: ReactKeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
        } else if (e.key === "Escape") {
            e.preventDefault();
            onDone(null);
        }
    };

    return (
        <form className="evi-snip-editor" onSubmit={e => (e.preventDefault(), save())} onKeyDown={onKeyDown}>
            <label className="evi-snip-label">
                <span>{t("editor.name")}</span>
                <input
                    className="evi-snip-input"
                    value={name}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder={t("editor.namePlaceholder")}
                    aria-invalid={tried && !!nameProblem}
                    autoFocus={!autoFocusText}
                    onChange={e => setName(e.currentTarget.value)}
                />
            </label>
            <label className="evi-snip-label">
                <span>{t("editor.text")}</span>
                <textarea
                    ref={textRef}
                    className="evi-snip-input evi-snip-textarea"
                    value={text}
                    maxLength={MAX_TEXT_LENGTH}
                    rows={5}
                    placeholder={t("editor.textPlaceholder")}
                    aria-invalid={tried && !nameProblem && !!textProblem}
                    autoFocus={autoFocusText}
                    onChange={e => setText(e.currentTarget.value)}
                />
            </label>
            <div className="evi-snip-placeholders" aria-label={t("editor.placeholders")}>
                {PLACEHOLDERS.map(p => (
                    <button key={p.key} type="button" className="evi-snip-chip" title={t(`ph.${p.key}`)} onClick={() => insertPlaceholder(p.key)}>
                        {`{${p.key}}`}
                    </button>
                ))}
            </div>
            <div className="evi-snip-editor-foot">
                <span className="evi-snip-error" role="alert">{tried && error ? error : ""}</span>
                <button type="button" className="evi-snip-button" onClick={() => onDone(null)}>{t("editor.cancel")}</button>
                <button type="submit" className="evi-snip-button evi-snip-primary">{snippet ? t("editor.save") : t("editor.add")}</button>
            </div>
        </form>
    );
}

function Row({ snippet, active, id, onPick, onEdit, onDelete, onHover }: {
    snippet: Snippet;
    active?: boolean;
    id?: string;
    onPick?(): void;
    onEdit(): void;
    onDelete(): void;
    onHover?(): void;
}) {
    const [confirming, setConfirming] = React.useState(false);
    React.useEffect(() => {
        if (!confirming) return;
        const timer = setTimeout(() => setConfirming(false), 4000);
        return () => clearTimeout(timer);
    }, [confirming]);
    const preview = snippet.text.replace(/\s+/g, " ").slice(0, 140);

    return (
        <li
            id={id}
            className="evi-snip-row"
            role={onPick ? "option" : undefined}
            aria-selected={onPick ? !!active : undefined}
            data-active={active || undefined}
            onMouseMove={onHover}
            onClick={onPick}
        >
            <div className="evi-snip-row-text">
                <span className="evi-snip-name">{snippet.name}</span>
                <span className="evi-snip-preview">{preview}</span>
            </div>
            <div className="evi-snip-actions" onClick={e => e.stopPropagation()}>
                {confirming
                    ? (
                        <button type="button" className="evi-snip-button evi-snip-danger" tabIndex={-1} onClick={onDelete}>{t("row.delete")}</button>
                    )
                    : (
                        <>
                            <button type="button" className="evi-snip-icon" tabIndex={-1} aria-label={t("row.editLabel", { name: snippet.name })} title={t("row.edit")} onClick={onEdit}>
                                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="m13.96 5.46 4.58 4.58L8.58 20H4v-4.58l9.96-9.96Zm1.41-1.41 1.84-1.84a2 2 0 0 1 2.83 0l1.75 1.75a2 2 0 0 1 0 2.83l-1.84 1.84-4.58-4.58Z" /></svg>
                            </button>
                            <button type="button" className="evi-snip-icon" tabIndex={-1} aria-label={t("row.deleteLabel", { name: snippet.name })} title={t("row.delete")} onClick={() => setConfirming(true)}>
                                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z" /></svg>
                            </button>
                        </>
                    )}
            </div>
        </li>
    );
}

type View = { kind: "list"; } | { kind: "edit"; snippet?: Snippet; initial?: Partial<SnippetInput>; };

function Picker({ channel, onClose }: { channel: any; onClose(): void; }) {
    useLocale();
    const current = useSnippets();
    const [query, setQuery] = React.useState("");
    const [index, setIndex] = React.useState(0);
    const [view, setView] = React.useState<View>({ kind: "list" });
    const listRef = React.useRef<HTMLUListElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const results = React.useMemo(() => searchSnippets(current, query), [current, query]);
    const active = Math.min(index, Math.max(0, results.length - 1));

    React.useEffect(() => setIndex(0), [query]);
    React.useEffect(() => {
        listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
    }, [active, results]);

    const pick = async (snippet: Snippet | undefined) => {
        if (!snippet) return;
        onClose();
        await insertSnippet(snippet, channel);
    };

    const backToList = () => {
        setView({ kind: "list" });
        requestAnimationFrame(() => searchRef.current?.focus());
    };

    if (view.kind === "edit") {
        return (
            <div className="evi-snip-picker">
                <header className="evi-snip-head">
                    <h2 className="evi-snip-title">{view.snippet ? t("picker.editTitle") : t("picker.newTitle")}</h2>
                </header>
                <Editor
                    snippet={view.snippet}
                    initial={view.initial}
                    autoFocusText={!!view.snippet}
                    onDone={saved => {
                        if (saved) setQuery("");
                        backToList();
                    }}
                />
            </div>
        );
    }

    const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!results.length) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setIndex((active + step + results.length) % results.length);
        } else if (e.key === "PageDown" || e.key === "PageUp") {
            e.preventDefault();
            setIndex(Math.max(0, Math.min(results.length - 1, active + (e.key === "PageDown" ? 5 : -5))));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (results[active]) void pick(results[active]);
            else if (query.trim()) setView({ kind: "edit", initial: { name: query.trim() } });
        } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }
    };

    return (
        <div className="evi-snip-picker">
            <header className="evi-snip-head">
                <input
                    ref={searchRef}
                    className="evi-snip-input evi-snip-search"
                    placeholder={current.snippets.length ? t("picker.search") : t("picker.nameFirst")}
                    aria-label={t("picker.search")}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="evi-snip-list"
                    aria-activedescendant={results[active] ? `evi-snip-${results[active].id}` : undefined}
                    value={query}
                    autoFocus
                    onChange={e => setQuery(e.currentTarget.value)}
                    onKeyDown={onKeyDown}
                />
                <button
                    type="button"
                    className="evi-snip-button evi-snip-primary"
                    onClick={() => setView({ kind: "edit", initial: { name: results.length ? "" : query.trim() } })}
                >
                    {t("picker.new")}
                </button>
            </header>
            {results.length
                ? (
                    <ul id="evi-snip-list" className="evi-snip-list" role="listbox" aria-label={t("picker.list")} ref={listRef}>
                        {results.map((s, i) => (
                            <Row
                                key={s.id}
                                id={`evi-snip-${s.id}`}
                                snippet={s}
                                active={i === active}
                                onHover={() => i !== active && setIndex(i)}
                                onPick={() => void pick(s)}
                                onEdit={() => setView({ kind: "edit", snippet: s })}
                                onDelete={() => commit(deleteSnippet(state, s.id))}
                            />
                        ))}
                    </ul>
                )
                : (
                    <p className="evi-snip-empty">
                        {current.snippets.length ? t("picker.noMatch", { query }) : t("picker.empty")}
                    </p>
                )}
            <footer className="evi-snip-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> {t("picker.hintChoose")}</span>
                <span><kbd>Enter</kbd> {t("picker.hintInsert")}</span>
                <span><kbd>Esc</kbd> {t("picker.hintClose")}</span>
            </footer>
        </div>
    );
}

let closeOpen: CloseLayer | undefined;
let openAnchor: HTMLElement | null = null;
const openListeners = new Set<() => void>();
const useOpenAnchor = () => React.useSyncExternalStore(fn => (openListeners.add(fn), () => void openListeners.delete(fn)), () => openAnchor);
const setOpenAnchor = (el: HTMLElement | null) => {
    openAnchor = el;
    for (const fn of [...openListeners]) fn();
};

/**
 * Renders into its own layer on document.body. With an anchor it's a popover above it, otherwise a
 * centred dialog. Escape and clicks outside close it; focus goes back where it was.
 */
function showLayer(render: (close: CloseLayer) => ReactNode, anchor?: HTMLElement) {
    closeOpen?.();
    const previous = document.activeElement as HTMLElement | null;
    let host: HTMLElement | null = null;
    const setHost = (el: HTMLElement | null) => void (host = el);

    const onPointer = (e: MouseEvent) => {
        const target = e.target as Node;
        if (host?.contains(target) || anchor?.contains(target)) return;
        close();
    };
    // Focus elsewhere: Escape closes before Discord sees it
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || host?.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
    };
    // Focus inside: the picker and editor handle keys first (Escape in the editor goes back to the
    // list), then nothing reaches Discord's keybinds. Escape nobody handled still closes.
    const onInnerKey = (e: ReactKeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Escape" && !e.nativeEvent.defaultPrevented) close();
    };
    const close: CloseLayer = options => {
        if (closeOpen === close) {
            closeOpen = undefined;
            setOpenAnchor(null);
            window.removeEventListener("mousedown", onPointer, true);
            window.removeEventListener("keydown", onKey, true);
            if (!anchor && previous?.isConnected) previous.focus?.();
        }
        closeLayer(options);
    };

    let content: ReactNode;
    if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const right = Math.max(8, window.innerWidth - rect.right - 8);
        const bottom = Math.max(8, window.innerHeight - rect.top + 8);
        content = (
            <div className="evi-snip-popover evi-popout" data-side="top" role="dialog" aria-label={t("picker.list")} style={{ right, bottom, maxHeight: Math.max(240, rect.top - 24) }} ref={setHost} onKeyDown={onInnerKey}>
                {render(close)}
            </div>
        );
    } else {
        content = (
            <div className="evi-snip-scrim evi-scrim" ref={setHost} onKeyDown={onInnerKey} onMouseDown={e => e.target === e.currentTarget && close()}>
                <div className="evi-snip-dialog evi-modal" role="dialog" aria-modal="true" aria-label={t("dialog.snippet")}>{render(close)}</div>
            </div>
        );
    }
    const closeLayer = openLayer(() => content, { className: "evi-snip-layer" });
    closeOpen = close;
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    setOpenAnchor(anchor ?? null);
    return close;
}

function openPicker(anchor: HTMLElement, channel: any) {
    if (closeOpen && openAnchor === anchor) return closeOpen();
    showLayer(close => <Picker channel={channel} onClose={close} />, anchor);
}

function openEditorDialog(initial: Partial<SnippetInput>) {
    showLayer(close => (
        <div className="evi-snip-picker">
            <header className="evi-snip-head"><h2 className="evi-snip-title">{t("dialog.saveTitle")}</h2></header>
            <Editor
                initial={initial}
                autoFocusText={false}
                onDone={saved => {
                    close();
                    if (saved) ctx?.toast(t("toast.saved", { name: saved.name }), { type: "success" });
                }}
            />
        </div>
    ));
}

/**
 * A webpack lookup, kept once found. Each search walks every loaded module, and the chat bar renders
 * on every keystroke, so a miss (Discord renamed it) is searched again at most every 10 seconds.
 */
function lookup<T>(search: () => T | undefined): () => T | undefined {
    let value: T | undefined;
    let missedAt = -Infinity;
    return () => {
        if (value !== undefined || performance.now() - missedAt < 10_000) return value;
        value = search();
        if (value === undefined) missedAt = performance.now();
        return value;
    };
}

/** Wrapper class of Discord's apps button, from its CSS module { buttonContainer, button, ... } */
const getContainerClass = lookup(() => Object.values(find(v =>
    typeof v === "object" && Object.values(v).some(c => typeof c === "string" && c.startsWith("channelAppLauncherButtonPopoutIconAnimation_")),
) ?? {}).find((c): c is string => typeof c === "string" && c.startsWith("buttonContainer_")));

/** Discord's chat bar button (the one gift, sticker and apps use) */
const chatButtonFilter = filters.componentByCode("CHAT_INPUT_BUTTON_NOTIFICATION", "sparkle");
const getChatButton = lookup<ComponentType<any>>(() => find(chatButtonFilter));

function SnippetIcon() {
    return (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2v3.5a.5.5 0 0 0 .85.35L11.7 18H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm2 4h10v2H7V7Zm0 4h7v2H7v-2Z" />
        </svg>
    );
}

const noSettings = () => undefined;
const noSubscribe = () => () => { };

/**
 * The settings, or undefined once the plugin stopped. Stopping closes an open picker, which re-renders
 * the button after ctx is gone (the patch keeps it in the chat bar). One useSyncExternalStore either
 * way, so the hooks stay in the same order.
 */
const useSettings = () => ctx ? ctx.settings.use() : React.useSyncExternalStore(noSubscribe, noSettings);

function SnippetsButton({ channel }: { channel: any; }) {
    useLocale();
    const showButton = useSettings()?.showButton;
    const ref = React.useRef<HTMLDivElement>(null);
    const anchor = useOpenAnchor();
    if (!showButton) return null;
    const open = !!anchor && anchor === ref.current;
    const onClick = () => ref.current && openPicker(ref.current, channel);
    const label = t("button.label");
    const ChatButton = getChatButton();

    const button = ChatButton
        ? <ChatButton onClick={onClick} isActive={open} aria-label={label} aria-expanded={open} sparkle={false}><SnippetIcon /></ChatButton>
        : <button type="button" className="evi-snip-fallback" onClick={onClick} aria-label={label} aria-expanded={open}><SnippetIcon /></button>;
    const Tooltip = Components.Tooltip;
    return (
        <div ref={ref} className={getContainerClass()} data-evi-snippets="">
            {Tooltip && !open ? <Tooltip text={label} position="top"><div className="evi-snip-tip">{button}</div></Tooltip> : button}
        </div>
    );
}

/** "Type \{user} to keep one as written", with the example in a <code> wherever the translation puts it */
function escapeHint() {
    const [before, after = ""] = t("panel.escape").split("{code}");
    return <>{before}<code>{"\\{user}"}</code>{after}</>;
}

function ManagePanel() {
    useLocale();
    const current = useSnippets();
    const [editing, setEditing] = React.useState<string | "new" | null>(null);
    const sorted = [...current.snippets].sort(compareByName);
    const editingSnippet = editing && editing !== "new" ? getSnippet(current, editing) : undefined;

    return (
        <section className="evi-snip-panel">
            <div className="evi-snip-panel-head">
                <h3 className="evi-snip-title">{t("panel.title", { count: current.snippets.length })}</h3>
                {editing === null && <button type="button" className="evi-snip-button evi-snip-primary" onClick={() => setEditing("new")}>{t("panel.new")}</button>}
            </div>
            {editing !== null && (editing === "new" || editingSnippet) && (
                <div className="evi-snip-panel-editor">
                    <Editor key={editing} snippet={editingSnippet} onDone={() => setEditing(null)} />
                </div>
            )}
            {sorted.length
                ? (
                    <ul className="evi-snip-list">
                        {sorted.map(s => (
                            <Row key={s.id} snippet={s} onEdit={() => setEditing(s.id)} onDelete={() => commit(deleteSnippet(state, s.id))} />
                        ))}
                    </ul>
                )
                : editing === null && <p className="evi-snip-empty">{t("panel.empty")}</p>}
            <p className="evi-snip-hint">
                {t("panel.placeholders", { list: PLACEHOLDERS.map(p => `{${p.key}}`).join(" ") })} {escapeHint()}
            </p>
        </section>
    );
}

export default definePlugin({
    settings,
    patches: [BUTTON_PATCH],

    /** Called by the patched ChannelTextAreaButtons with its button list (before the send button) and props */
    injectButton(buttons: unknown[], props: any) {
        try {
            if (!ctx?.settings.get("showButton") || !Array.isArray(buttons) || props?.channel?.id == null) return;
            buttons.push(<SnippetsButton key="evi-snippets" channel={props.channel} />);
        } catch (err) {
            ctx?.logger.error("Couldn't add the chat bar button", err);
        }
    },

    settingsPanel(context) {
        if (!ctx && panelCtx !== context) {
            panelCtx = context;
            load();
        }
        return <ManagePanel />;
    },

    /** For tests and debugging */
    getState: () => state,
    insertText,

    css: `
.evi-snip-layer { position: fixed; inset: 0; z-index: 1002; pointer-events: none; }
.evi-snip-layer > * { pointer-events: auto; }
.evi-snip-popover, .evi-snip-dialog {
    --evi-snip-text: var(--text-default, var(--text-normal, #dbdee1));
    --evi-snip-muted: var(--text-muted, #949ba4);
    --evi-snip-bg: var(--background-surface-high, var(--background-floating, #2b2d31));
    --evi-snip-input: var(--input-background, var(--background-tertiary, #1e1f22));
    --evi-snip-hover: var(--background-mod-normal, rgba(78, 80, 88, 0.48));
    --evi-snip-border: var(--border-subtle, rgba(255, 255, 255, 0.08));
    --evi-snip-brand: var(--brand-500, #5865f2);
    color: var(--evi-snip-text);
    background: var(--evi-snip-bg);
    border: 1px solid var(--evi-snip-border);
    border-radius: 12px;
    box-shadow: var(--shadow-high, 0 8px 24px rgba(0, 0, 0, 0.35));
    font-size: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.evi-snip-popover { position: fixed; width: min(420px, calc(100vw - 16px)); }
.evi-snip-scrim { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.6); }
.evi-snip-dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100vh - 64px); }
.evi-snip-picker { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.evi-snip-head { display: flex; gap: 8px; align-items: center; padding: 12px 12px 8px; }
.evi-snip-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--header-primary, var(--evi-snip-text)); }
.evi-snip-input {
    box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
    background: var(--evi-snip-input, var(--input-background, #1e1f22)); color: inherit; font: inherit; outline: none;
}
.evi-snip-input:focus { border-color: var(--evi-snip-brand, #5865f2); }
.evi-snip-input[aria-invalid="true"] { border-color: var(--status-danger, #da373c); }
.evi-snip-input::placeholder { color: var(--evi-snip-muted, #949ba4); }
.evi-snip-search { flex: 1; }
.evi-snip-textarea { resize: vertical; min-height: 96px; max-height: 320px; line-height: 1.4; }
.evi-snip-list { list-style: none; margin: 0; padding: 0 6px 6px; overflow-y: auto; min-height: 0; flex: 1; }
.evi-snip-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; cursor: pointer; }
.evi-snip-panel .evi-snip-row { cursor: default; }
.evi-snip-row[data-active], .evi-snip-panel .evi-snip-row:hover { background: var(--evi-snip-hover, var(--background-mod-normal, rgba(78, 80, 88, 0.48))); }
.evi-snip-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.evi-snip-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-snip-preview { color: var(--evi-snip-muted, #949ba4); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-snip-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 120ms ease; }
.evi-snip-row:hover .evi-snip-actions, .evi-snip-row[data-active] .evi-snip-actions, .evi-snip-actions:focus-within { opacity: 1; }
.evi-snip-icon {
    display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none;
    color: var(--interactive-normal, #b5bac1); cursor: pointer;
}
.evi-snip-icon:hover { color: var(--interactive-active, #fff); background: var(--background-mod-strong, rgba(78, 80, 88, 0.6)); }
.evi-snip-button {
    flex-shrink: 0; height: 32px; padding: 0 14px; border: 0; border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer;
    background: var(--button-secondary-background, #4e5058); color: #fff; transition: filter 120ms ease;
}
.evi-snip-button:hover { filter: brightness(1.1); }
.evi-snip-button:focus-visible, .evi-snip-icon:focus-visible, .evi-snip-chip:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 1px; }
.evi-snip-primary { background: var(--brand-500, #5865f2); }
.evi-snip-danger { background: var(--status-danger, #da373c); height: 28px; padding: 0 10px; }
.evi-snip-empty { margin: 0; padding: 16px 16px 20px; color: var(--evi-snip-muted, #949ba4); text-align: center; line-height: 1.4; }
.evi-snip-foot { display: flex; gap: 14px; padding: 8px 12px; border-top: 1px solid var(--evi-snip-border); color: var(--evi-snip-muted); font-size: 12px; }
.evi-snip-foot kbd {
    display: inline-block; min-width: 14px; margin-right: 3px; padding: 0 4px; border-radius: 4px; text-align: center;
    background: var(--evi-snip-input); font: inherit; font-size: 11px;
}
.evi-snip-editor { display: flex; flex-direction: column; gap: 10px; padding: 4px 12px 12px; overflow-y: auto; }
.evi-snip-label { display: flex; flex-direction: column; gap: 6px; }
.evi-snip-label > span { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--header-secondary, #b5bac1); }
.evi-snip-placeholders { display: flex; flex-wrap: wrap; gap: 6px; }
.evi-snip-chip {
    height: 24px; padding: 0 8px; border-radius: 12px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    background: var(--background-mod-subtle, rgba(78, 80, 88, 0.3)); color: var(--interactive-normal, #b5bac1);
    font-family: var(--font-code, monospace); font-size: 12px; cursor: pointer;
}
.evi-snip-chip:hover { color: var(--interactive-active, #fff); }
.evi-snip-editor-foot { display: flex; align-items: center; gap: 8px; }
.evi-snip-error { flex: 1; color: var(--text-danger, #f23f43); font-size: 13px; }
.evi-snip-fallback {
    display: flex; align-items: center; justify-content: center; height: 100%; padding: 4px; background: none; border: 0; cursor: pointer;
    color: var(--interactive-normal, #b5bac1);
}
.evi-snip-fallback:hover, .evi-snip-fallback[aria-expanded="true"] { color: var(--interactive-active, #fff); }
.evi-snip-tip { display: flex; align-items: center; height: 100%; }
.evi-snip-panel { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.evi-snip-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.evi-snip-panel .evi-snip-list { padding: 0; }
.evi-snip-panel-editor {
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); border-radius: 12px; padding-top: 10px;
    --evi-snip-input: var(--input-background, var(--background-tertiary, #1e1f22));
    --evi-snip-brand: var(--brand-500, #5865f2);
}
.evi-snip-hint { margin: 0; color: var(--text-muted, #949ba4); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .evi-snip-actions, .evi-snip-button { transition: none; } }
`,

    start(context) {
        ctx = context;
        panelCtx = undefined;
        load();
        syncCommand();

        context.contextMenu("message", (children, props) => {
            const content: string = typeof props?.message?.content === "string" ? props.message.content : "";
            if (!content.trim()) return;
            children.push(
                <Menu.Group key="evi-snippets">
                    <Menu.Item
                        id="evi-snippets-save"
                        label={t("menu.save")}
                        action={() => openEditorDialog({ name: suggestName(state, content), text: content })}
                    />
                </Menu.Group>,
            );
        });

        // Switching channels closes the picker: its insert would go to the new channel's message box
        context.flux.subscribe("CHANNEL_SELECT", () => {
            if (openAnchor) closeOpen?.();
        });

        context.onDispose(() => {
            closeOpen?.({ instant: true });
            unregisterCommand?.();
            unregisterCommand = undefined;
            registeredChoices = "";
            ctx = undefined;
            // An open settings panel keeps working with the plugin off
            panelCtx = context;
        });
    },
});
