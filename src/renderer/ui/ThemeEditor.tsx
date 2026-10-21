/**
 * The theme editor: start from Discord's dark or light colours or from a theme you have, pick
 * colours and watch Discord change as you go, save it as a theme of your own, then send it to the
 * Theme Store for review. The draft and its live preview live in ../themeEditor.ts; this is the tab,
 * the dialogs, and the small bar that keeps an unsaved preview in view while settings are closed.
 */
import { COLOR_GROUPS, ColorKey, contrast, PRESETS, RADIUS_MAX, RADIUS_MIN, RADIUS_STEP, ThemeBase, blankDraft, themeSlug, toHex } from "@shared/themeEditor";
import { MAX_THEME_SCREENSHOT_BYTES, ScreenshotType, SCREENSHOT_EXTENSIONS, whyNotCommunityCss } from "@shared/themeSubmissions";
import { isVersion } from "@shared/store";

import { I18n, t } from "../i18n";
import { Native } from "../native";
import { EditorSession, ThemeEditor } from "../themeEditor";
import { Themes } from "../themes";
import { openLayer, type CloseLayer } from "../toolkit/layer";
import { React } from "../webpack/common";
import { AccountTab } from "./AccountTab";
import { Button, Collapse, CodeArea, Dialog, Dropdown, Icon, List, Notice, Section, Status, Text, TextField, useStore } from "./components";
import { SettingsUI } from "./index";
import { showTab } from "./nav";
import { SafeModeHint } from "./SafeModeNotice";

// The bar shown while an unsaved preview is on and the editor isn't

/** Editors on screen: the floating panel and Discord's own settings can each show one */
let editorsShown = 0;
let closeBar: CloseLayer | undefined;

function syncBar() {
    const want = editorsShown === 0 && ThemeEditor.dirty();
    if (want && !closeBar) {
        const close: CloseLayer = openLayer(() => <PreviewBar />, { className: "dl-root", onClosed: () => void (closeBar === close && (closeBar = undefined)) });
        closeBar = close;
    } else if (!want && closeBar) {
        closeBar();
        closeBar = undefined;
    }
}
ThemeEditor.subscribe(syncBar);

function PreviewBar() {
    const session = useStore(ThemeEditor.subscribe, ThemeEditor.getSnapshot);
    const name = session?.draft.name.trim() || t("themeEditor.untitled");
    return (
        <div className="dl-preview-bar evi-popout" role="status">
            <Icon name="palette" size={18} />
            <Text variant="text-sm/medium" color="text-strong" className="dl-grow">{t("themeEditor.previewBar", { name })}</Text>
            <Button
                variant="accent"
                onClick={() => {
                    showTab("themes", "editor");
                    SettingsUI.open("themes");
                }}
            >
                {t("themeEditor.keepEditing")}
            </Button>
            <Button onClick={() => ThemeEditor.close()}>{t("themeEditor.discard")}</Button>
        </div>
    );
}

/** Which appearance Discord shows now, kept up to date as it switches */
function useDiscordBase(): ThemeBase {
    const read = () => (document.documentElement.classList.contains("theme-light") ? "light" : "dark");
    const [base, setBase] = React.useState<ThemeBase>(read);
    React.useEffect(() => {
        const observer = new MutationObserver(() => setBase(read()));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return base;
}

/** The minimum contrast on Chat before a colour gets a warning: body text needs more than the rest */
const MIN_CONTRAST: Partial<Record<ColorKey, number>> = { text: 4.5, strong: 4.5, muted: 3, icon: 3, link: 3 };

/** The colour a hex field's text means: the leading # can be left out */
function fieldHex(text: string) {
    const value = text.trim();
    return toHex(value.startsWith("#") || /^rgba?\(/i.test(value) ? value : `#${value}`);
}

function ColorRow({ colorKey, value, chat, onChange }: { colorKey: ColorKey; value: string; chat: string; onChange(hex: string): void; }) {
    const id = `dl-theme-color-${colorKey}`;
    const name = t(`themeEditor.color.${colorKey}`);
    const [text, setText] = React.useState(value);
    // Picked with the swatch, or a new start: the field follows
    React.useEffect(() => {
        if (fieldHex(text) !== value) setText(value);
    }, [value]);
    const invalid = !fieldHex(text);
    const min = MIN_CONTRAST[colorKey];
    const ratio = min && colorKey !== "chat" ? contrast(value, chat) : undefined;

    return (
        <li className="dl-row">
            <div className="dl-row-head">
                <div className="dl-row-text">
                    <label htmlFor={`${id}-hex`}><Text variant="text-md/semibold" color="text-strong">{name}</Text></label>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle" id={`${id}-hint`}>{t(`themeEditor.color.${colorKey}Hint`)}</Text>
                    {ratio !== undefined && ratio < min! && <Status tone="warning">{t("themeEditor.lowContrast", { ratio: ratio.toLocaleString(I18n.discordLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</Status>}
                </div>
                <div className="dl-color-controls">
                    <input
                        type="color"
                        className="dl-color-swatch"
                        aria-label={t("themeEditor.pick", { name })}
                        value={value}
                        onChange={e => onChange(e.currentTarget.value)}
                    />
                    <input
                        id={`${id}-hex`}
                        className="dl-input dl-color-hex"
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={9}
                        aria-describedby={`${id}-hint`}
                        aria-invalid={invalid || undefined}
                        value={text}
                        onChange={e => {
                            const next = e.currentTarget.value;
                            setText(next);
                            const hex = fieldHex(next);
                            if (hex) onChange(hex);
                        }}
                        onBlur={() => invalid && setText(value)}
                    />
                </div>
            </div>
        </li>
    );
}

/** A folded section's toggle and body, like the store's settings */
function Folded({ id, title, children }: { id: string; title: string; children: React.ReactNode; }) {
    const [open, setOpen] = React.useState(false);
    return (
        <section className="dl-stack">
            <button type="button" className="dl-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
                <Icon name="chevronRight" size={16} />
                <Text tag="span" variant="text-sm/semibold" color="text-subtle">{title}</Text>
            </button>
            <Collapse open={open} id={id}>{children}</Collapse>
        </section>
    );
}

/** Discord's own colours in miniature: frame, panel, chat, a line of text and the accent */
function Mini({ base }: { base: ThemeBase; }) {
    const c = PRESETS[base];
    return (
        <span className="dl-editor-mini" aria-hidden="true" style={{ background: c.frame }}>
            <span className="dl-editor-mini-panel" style={{ background: c.panel }} />
            <span className="dl-editor-mini-chat" style={{ background: c.chat }}>
                <span style={{ background: c.strong }} />
                <span style={{ background: c.muted }} />
                <span className="dl-editor-mini-accent" style={{ background: c.accent }} />
            </span>
        </span>
    );
}

function StartPicker() {
    const themes = useStore(Themes.subscribe, Themes.getSnapshot);
    const [from, setFrom] = React.useState(themes[0]?.file ?? "");
    const picked = themes.some(theme => theme.file === from) ? from : themes[0]?.file ?? "";

    return (
        <Section id="dl-theme-editor-start" title={t("themeEditor.startTitle")} description={t("themeEditor.startHint")}>
            <div className="dl-stack-loose">
                <div className="dl-editor-starts">
                    {(["dark", "light"] as const).map(base => (
                        <button key={base} type="button" className="dl-editor-start" id={`dl-theme-editor-blank-${base}`} onClick={() => ThemeEditor.start(blankDraft(base))}>
                            <Mini base={base} />
                            <span className="dl-editor-start-text">
                                <Text tag="span" variant="text-md/semibold" color="text-strong">{t(base === "dark" ? "themeEditor.blankDark" : "themeEditor.blankLight")}</Text>
                                <Text tag="span" variant="text-sm/normal" color="text-subtle">{t(base === "dark" ? "themeEditor.blankDarkHint" : "themeEditor.blankLightHint")}</Text>
                            </span>
                        </button>
                    ))}
                </div>
                {themes.length > 0 && (
                    <div className="dl-field">
                        <Text variant="text-md/medium" color="text-strong" id="dl-theme-editor-from-label">{t("themeEditor.fromTheme")}</Text>
                        <div className="dl-toolbar">
                            <div className="dl-grow">
                                <Dropdown
                                    id="dl-theme-editor-from"
                                    label={t("themeEditor.fromTheme")}
                                    labelledBy="dl-theme-editor-from-label"
                                    options={themes.map(theme => ({ value: theme.file, label: theme.name }))}
                                    value={picked}
                                    onChange={setFrom}
                                />
                            </div>
                            <Button icon="pencil" onClick={() => picked && ThemeEditor.startFrom(picked)}>{t("themeEditor.startFrom")}</Button>
                        </div>
                    </div>
                )}
            </div>
        </Section>
    );
}

type Problems = Partial<Record<"name" | "version" | "save", string>>;

function Editor({ session }: { session: EditorSession; }) {
    const { draft } = session;
    const discordBase = useDiscordBase();
    const [problems, setProblems] = React.useState<Problems>({});
    const [saving, setSaving] = React.useState(false);
    const [asking, setAsking] = React.useState<"discard" | "publish">();
    const [copied, setCopied] = React.useState(false);
    const dirty = ThemeEditor.dirty();
    const saved = !!session.savedCss;
    const css = ThemeEditor.css();
    const name = draft.name.trim() || t("themeEditor.untitled");

    const save = async () => {
        const next: Problems = {
            name: draft.name.trim() ? undefined : t("themeEditor.nameMissing"),
            version: isVersion(draft.version) ? undefined : t("themeEditor.versionInvalid"),
        };
        setProblems(next);
        const first = (["name", "version"] as const).find(k => next[k]);
        if (first) return document.getElementById(`dl-theme-editor-${first}`)?.focus();
        setSaving(true);
        const result = await ThemeEditor.save().catch(err => ({ ok: false as const, error: String((err as Error)?.message ?? err) }));
        setSaving(false);
        if (!result.ok) setProblems({ save: result.error });
    };

    const set = (change: Parameters<typeof ThemeEditor.update>[0]) => ThemeEditor.update(change);
    const radius = draft.radius;

    return (
        <>
            <div className="dl-editor-bar" role="group" aria-label={t("themeEditor.previewing")}>
                <div className="dl-grow dl-row-text">
                    <Text variant="text-md/semibold" color="text-strong">{name}</Text>
                    <span role="status">
                        {problems.save
                            ? <Status tone="danger">{problems.save}</Status>
                            : dirty
                                ? <Status tone="muted">{`${t("themeEditor.previewing")} · ${t("themeEditor.unsaved")}`}</Status>
                                : <Status tone="success">{t("themeEditor.savedAs", { file: session.file ?? "" })}</Status>}
                    </span>
                </div>
                <Button onClick={() => (dirty ? setAsking("discard") : ThemeEditor.close())}>{dirty ? t("themeEditor.discard") : t("themeEditor.close")}</Button>
                {saved && !dirty && <Button icon="store" onClick={() => setAsking("publish")}>{t("themeEditor.publish")}</Button>}
                {(dirty || !saved) && <Button variant="accent" disabled={saving} onClick={() => void save()}>{saving ? t("themeEditor.saving") : t("themeEditor.save")}</Button>}
            </div>

            {discordBase !== draft.base && <Notice tone="info">{t(draft.base === "dark" ? "themeEditor.modeMismatch.dark" : "themeEditor.modeMismatch.light")}</Notice>}
            {session.startedFrom && <Notice tone="info">{t("themeEditor.startedFrom", { name: session.startedFrom })}</Notice>}

            <Section id="dl-theme-editor-details" title={t("themeEditor.details")}>
                <div className="dl-editor-grid">
                    <Field id="dl-theme-editor-name" label={t("themeEditor.name")} error={problems.name}>
                        {p => <input {...p} className="dl-input" type="text" maxLength={80} value={draft.name} placeholder={t("themeEditor.untitled")} onChange={e => { set({ name: e.currentTarget.value }); setProblems({ ...problems, name: undefined }); }} />}
                    </Field>
                    <Field id="dl-theme-editor-author" label={t("themeEditor.author")}>
                        {p => <input {...p} className="dl-input" type="text" maxLength={80} value={draft.author} onChange={e => set({ author: e.currentTarget.value })} />}
                    </Field>
                    <Field id="dl-theme-editor-description" label={t("themeEditor.description")} wide>
                        {p => <input {...p} className="dl-input" type="text" maxLength={300} value={draft.description} onChange={e => set({ description: e.currentTarget.value })} />}
                    </Field>
                    <Field id="dl-theme-editor-version" label={t("themeEditor.version")} error={problems.version}>
                        {p => <input {...p} className="dl-input dl-tabular" type="text" inputMode="decimal" spellCheck={false} maxLength={32} value={draft.version} onChange={e => { set({ version: e.currentTarget.value.trim() }); setProblems({ ...problems, version: undefined }); }} />}
                    </Field>
                </div>
            </Section>

            <Section id="dl-theme-editor-colors" title={t("themeEditor.colors")} description={t("themeEditor.colorsHint")}>
                <div className="dl-stack-loose">
                    {COLOR_GROUPS.map(group => (
                        <div className="dl-stack" key={group.id}>
                            <Text tag="h3" variant="text-sm/semibold" color="text-subtle">{t(`themeEditor.group.${group.id}`)}</Text>
                            <List label={t(`themeEditor.group.${group.id}`)}>
                                {group.keys.map(key => (
                                    <ColorRow key={key} colorKey={key} value={draft.colors[key]} chat={draft.colors.chat} onChange={hex => set({ colors: { ...draft.colors, [key]: hex } })} />
                                ))}
                            </List>
                        </div>
                    ))}
                </div>
            </Section>

            <Section id="dl-theme-editor-shape" title={t("themeEditor.shape")}>
                <List label={t("themeEditor.shape")}>
                    <li className="dl-row">
                        <div className="dl-row-head">
                            <div className="dl-row-text">
                                <label htmlFor="dl-theme-editor-radius"><Text variant="text-md/semibold" color="text-strong">{t("themeEditor.corners")}</Text></label>
                                <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("themeEditor.cornersHint")}</Text>
                            </div>
                            <div className="dl-editor-range">
                                <input
                                    id="dl-theme-editor-radius"
                                    type="range"
                                    min={RADIUS_MIN}
                                    max={RADIUS_MAX}
                                    step={RADIUS_STEP}
                                    value={radius}
                                    aria-valuetext={radius === 100 ? t("themeEditor.cornersDiscord") : `${radius}%`}
                                    onChange={e => set({ radius: Number(e.currentTarget.value) })}
                                />
                                <Text variant="text-sm/medium" color="text-default" tabular className="dl-editor-range-value">
                                    {radius === 100 ? t("themeEditor.cornersDiscord") : radius === 0 ? t("themeEditor.cornersSquare") : `${radius}%`}
                                </Text>
                            </div>
                        </div>
                    </li>
                    <li className="dl-row">
                        <TextField id="dl-theme-editor-font" label={t("themeEditor.font")} description={t("themeEditor.fontHint")} placeholder="gg sans" spellCheck={false} value={draft.font} onChange={font => set({ font })} />
                    </li>
                </List>
            </Section>

            <Folded id="dl-theme-editor-extra" title={t("themeEditor.extraCss")}>
                <div className="dl-stack">
                    <p className="dl-hint">{t("themeEditor.extraCssHint")}</p>
                    <CodeArea id="dl-theme-editor-extra-css" label={t("themeEditor.extraCss")} value={draft.extraCss} onChange={extraCss => set({ extraCss })} />
                </div>
            </Folded>

            <Folded id="dl-theme-editor-css" title={t("themeEditor.seeCss")}>
                <div className="dl-stack">
                    <pre className="dl-editor-css" tabIndex={0} aria-label={t("themeEditor.seeCss")}>{css}</pre>
                    <div className="dl-toolbar">
                        <Button
                            icon="copy"
                            onClick={() => {
                                void navigator.clipboard.writeText(css).then(() => setCopied(true));
                            }}
                        >
                            {t("themeEditor.copyCss")}
                        </Button>
                        <span role="status">{copied && <Status tone="success">{t("themeEditor.copied")}</Status>}</span>
                    </div>
                </div>
            </Folded>

            {asking === "discard" && (
                <Dialog id="dl-theme-editor-discard" title={t("themeEditor.discardTitle")} onClose={() => setAsking(undefined)}>
                    {close => (
                        <div className="dl-stack">
                            <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("themeEditor.discardBody")}</Text>
                            <div className="dl-toolbar">
                                <Button variant="danger" onClick={() => ThemeEditor.close()}>{t("themeEditor.discard")}</Button>
                                <Button onClick={close}>{t("themeEditor.keepEditing")}</Button>
                            </div>
                        </div>
                    )}
                </Dialog>
            )}
            {asking === "publish" && <PublishDialog session={session} onClose={() => setAsking(undefined)} />}
        </>
    );
}

/** A labelled input with its error under it, as the store's report form does it */
function Field({ id, label, error, wide, children }: {
    id: string;
    label: string;
    error?: string;
    wide?: boolean;
    children(props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; }): React.ReactNode;
}) {
    return (
        <div className="dl-field" data-wide={wide ? "" : undefined}>
            <label className="dl-label" htmlFor={id}>{label}</label>
            {children({ id, ...(error && { "aria-invalid": true, "aria-describedby": `${id}-error` }) })}
            {error && <span id={`${id}-error`}><Status tone="danger">{error}</Status></span>}
        </div>
    );
}

type Account = { state: "checking"; } | { state: "linked"; } | { state: "unlinked"; } | { state: "offline"; error: string; };
type Sent = { name: string; version: string; };

function PublishDialog({ session, onClose }: { session: EditorSession; onClose(): void; }) {
    const { draft } = session;
    const [account, setAccount] = React.useState<Account>({ state: "checking" });
    const [id, setId] = React.useState(() => themeSlug(draft.name));
    const [notes, setNotes] = React.useState("");
    const [shot, setShot] = React.useState<{ name: string; type: ScreenshotType; data: string; }>();
    const [problem, setProblem] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const [sent, setSent] = React.useState<Sent>();
    const fileRef = React.useRef<HTMLInputElement>(null);
    const css = session.savedCss ?? "";
    const policyProblem = whyNotCommunityCss(css, t);

    // Checked again every few seconds while it isn't linked, so linking from here moves on by itself
    React.useEffect(() => {
        if (account.state !== "checking" && account.state !== "unlinked") return;
        let live = true;
        const check = () => Native.accountStatus().then(res => live && setAccount(!res.ok ? { state: "offline", error: res.error } : res.user ? { state: "linked" } : { state: "unlinked" }));
        if (account.state === "checking") void check();
        const timer = setInterval(check, 3000);
        return () => {
            live = false;
            clearInterval(timer);
        };
    }, [account.state]);

    const pick = (file: File | undefined) => {
        setProblem("");
        if (!file) return;
        if (!(file.type in SCREENSHOT_EXTENSIONS)) return setProblem(t("themeEditor.screenshotType"));
        if (file.size > MAX_THEME_SCREENSHOT_BYTES) return setProblem(t("themeEditor.screenshotTooBig"));
        const reader = new FileReader();
        reader.onload = () => setShot({ name: file.name, type: file.type as ScreenshotType, data: String(reader.result).replace(/^data:[^,]*,/, "") });
        reader.readAsDataURL(file);
    };

    const send = async () => {
        if (sending) return;
        setSending(true);
        setProblem("");
        const result = await Native.submitTheme({
            id,
            name: draft.name.trim(),
            description: draft.description.trim(),
            version: draft.version,
            tags: [draft.base],
            notes: notes.split("\n").map(n => n.trim()).filter(Boolean),
            css,
            ...(shot && { screenshot: { type: shot.type, data: shot.data } }),
        }).catch(err => ({ ok: false as const, error: String((err as Error)?.message ?? err) }));
        setSending(false);
        if (!result.ok) return setProblem(result.error);
        setSent({ name: draft.name.trim(), version: result.submission.version });
    };

    return (
        <Dialog id="dl-theme-editor-publish" title={t("themeEditor.publishTitle", { name: draft.name.trim() })} onClose={onClose}>
            {close => (
                <div className="dl-stack-loose">
                    {sent ? (
                        <>
                            <Status tone="success">{t("themeEditor.sent", { name: sent.name, version: sent.version })}</Status>
                            <div className="dl-toolbar">
                                <Button variant="accent" onClick={() => void Native.openDashboard()}>{t("themeEditor.openDashboard")}</Button>
                                <Button onClick={close}>{t("common.close")}</Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("themeEditor.publishIntro")}</Text>
                            <p className="dl-store-trust"><Icon name="info" size={16} /><span>{t("themeEditor.publishPolicy")}</span></p>
                            {policyProblem && <Status tone="danger">{policyProblem}</Status>}

                            {account.state === "checking" && <Status tone="muted">{t("themeEditor.checking")}</Status>}
                            {account.state === "offline" && <Status tone="danger">{account.error}</Status>}
                            {account.state === "unlinked" && (
                                <div className="dl-stack">
                                    <Text tag="p" variant="text-sm/normal" color="text-default">{t("themeEditor.needsLink")}</Text>
                                    {/* Linking right here: the form below shows as soon as it's done */}
                                    <AccountTab />
                                </div>
                            )}

                            {account.state === "linked" && (
                                <form className="dl-stack-loose" onSubmit={e => { e.preventDefault(); void send(); }} noValidate>
                                    <TextField id="dl-theme-publish-id" label={t("themeEditor.storeId")} description={t("themeEditor.storeIdHint")} spellCheck={false} value={id} onChange={v => setId(v.trim().toLowerCase())} />
                                    <div className="dl-field">
                                        <label className="dl-label" htmlFor="dl-theme-publish-notes">{t("themeEditor.notes")}</label>
                                        <p className="dl-hint" id="dl-theme-publish-notes-hint">{t("themeEditor.notesHint")}</p>
                                        <textarea id="dl-theme-publish-notes" className="dl-textarea dl-editor-notes" rows={3} maxLength={3000} aria-describedby="dl-theme-publish-notes-hint" value={notes} onChange={e => setNotes(e.currentTarget.value)} />
                                    </div>
                                    <div className="dl-field">
                                        <Text variant="text-md/medium" color="text-strong" id="dl-theme-publish-shot-label">{t("themeEditor.screenshot")}</Text>
                                        <p className="dl-hint">{t("themeEditor.screenshotHint")}</p>
                                        <div className="dl-toolbar">
                                            <Button icon="folder" onClick={() => fileRef.current?.click()} aria-describedby="dl-theme-publish-shot-label">{t("themeEditor.chooseScreenshot")}</Button>
                                            {shot && <Text variant="text-sm/normal" color="text-default" className="dl-grow dl-mono">{shot.name}</Text>}
                                            {shot && <Button onClick={() => setShot(undefined)}>{t("themeEditor.removeScreenshot")}</Button>}
                                        </div>
                                        <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
                                    </div>
                                    {problem && <span role="alert"><Status tone="danger">{problem}</Status></span>}
                                    <div className="dl-toolbar">
                                        <Button type="submit" variant="accent" icon="store" disabled={sending || !!policyProblem}>{sending ? t("common.sending") : t("themeEditor.send")}</Button>
                                        <Button onClick={close}>{t("common.cancel")}</Button>
                                    </div>
                                </form>
                            )}
                        </>
                    )}
                </div>
            )}
        </Dialog>
    );
}

export function ThemeEditorTab() {
    const session = useStore(ThemeEditor.subscribe, ThemeEditor.getSnapshot);
    // While it's on screen, the preview bar isn't needed
    React.useEffect(() => {
        editorsShown++;
        syncBar();
        return () => {
            editorsShown--;
            syncBar();
        };
    }, []);

    return (
        <div className="dl-tab dl-theme-editor">
            <SafeModeHint what="themes" />
            {session ? <Editor session={session} /> : <StartPicker />}
        </div>
    );
}
