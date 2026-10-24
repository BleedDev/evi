/**
 * Settings UI building blocks. Controls and typography are Discord's own (see discord.tsx) so the
 * settings look and behave exactly like the rest of Discord's; Evi's versions below are only
 * fallbacks for when Discord renames one of its components. Layout (sections, lists, rows) follows
 * the measurements of Discord's own settings layout, see styles.css.
 */
import type { ButtonHTMLAttributes, ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from "react";

import { comboFromEvent, comboKeys, comboProblem, ComboProblem, formatCombo } from "@shared/keybinds";

import { t } from "../i18n";
import { isRecording, RECORDING_ATTR } from "../keybinds";
import type { SettingDefinition } from "../plugins/types";
import { exitDone } from "../toolkit/layer";
import { React, ReactDOM } from "../webpack/common";
import { DiscordUI } from "./discord";
import { Icon, iconComponent, IconName } from "./icons";

export { Icon, iconComponent };
export type { IconName };

export const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/** A Discord user's avatar on Discord's CDN, or their default one. "auto" is a GIF for animated avatars. */
export function discordAvatarUrl(userId: string, avatar: string | null | undefined, size: number, format: "png" | "webp" | "auto" = "png") {
    if (avatar) {
        const ext = format === "auto" ? (avatar.startsWith("a_") ? "gif" : "png") : format;
        return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${ext}?size=${size}`;
    }
    const index = /^\d+$/.test(userId) ? Number((BigInt(userId) >> 22n) % 6n) : 0;
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/**
 * Discord's text component: `variant` is a name from its type scale ("heading-md/medium",
 * "text-sm/normal", ...) and `color` one of its text tokens ("text-strong", "text-subtle", ...).
 */
export function Text({ variant, tag = "div", color, className, id, children, tabular, role }: {
    variant: string;
    tag?: string;
    color?: string;
    className?: string;
    id?: string;
    children?: ReactNode;
    tabular?: boolean;
    role?: string;
}) {
    const Native = DiscordUI.Text.get;
    if (Native) {
        return <Native variant={variant} tag={tag} color={color} className={className} id={id} tabularNumbers={tabular} role={role}>{children}</Native>;
    }
    const Tag = tag as "div";
    return <Tag className={cx("dl-text", tabular && "dl-tabular", className)} data-variant={variant} data-color={color} id={id} role={role}>{children}</Tag>;
}

type ButtonVariant = "accent" | "secondary" | "danger" | "icon";

const manaVariant = { accent: "primary", secondary: "secondary", danger: "critical-secondary", icon: "icon-only" } as const;

/**
 * Discord's button. `children` is the label and `icon` goes before it. Variant "icon" is icon-only
 * and needs an aria-label; prefer IconButton, which adds the tooltip.
 */
export function Button({ variant = "secondary", size = "sm", icon, children, onClick, disabled, type = "button", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: "sm" | "md";
    icon?: IconName;
}) {
    const text = typeof children === "string" ? children : undefined;
    const Mana = DiscordUI.ManaButton.get;
    // Discord's button takes a plain-text label; anything richer uses the fallbacks below
    if (Mana && (text || (variant === "icon" && icon))) {
        return (
            <Mana
                variant={manaVariant[variant]}
                size={size}
                text={text}
                icon={icon && iconComponent(icon)}
                type={type as "button" | "submit"}
                onClick={onClick as () => void}
                disabled={disabled}
                className={className}
                id={props.id}
                aria-label={props["aria-label"]}
                aria-expanded={props["aria-expanded"] as boolean | undefined}
                aria-controls={props["aria-controls"]}
            />
        );
    }

    const Legacy = DiscordUI.Button.get;
    if (Legacy && variant !== "icon") {
        const { Colors = {}, Sizes = {} } = Legacy as any;
        return (
            <Legacy
                color={variant === "accent" ? Colors.BRAND : variant === "danger" ? Colors.RED : Colors.PRIMARY}
                size={Sizes.SMALL}
                onClick={onClick as any}
                disabled={disabled}
                aria-label={props["aria-label"]}
            >
                <span className="dl-button-content">{icon && <Icon name={icon} />}{children}</span>
            </Legacy>
        );
    }

    return (
        <button type={type} className={cx("dl-button", className)} data-variant={variant} data-size={size} onClick={onClick} disabled={disabled} {...props}>
            {icon && <Icon name={icon} />}
            {children}
        </button>
    );
}

/** Discord's tooltip on a focusable element; without it, the element's aria-label still names it */
export function Tooltip({ text, children }: { text: string; children: ReactElement; }) {
    const Native = DiscordUI.Tooltip.get;
    return Native ? <Native text={text}>{children}</Native> : children;
}

/** Icon-only button: the label is both its accessible name and its tooltip */
export function IconButton({ icon, label, onClick, className, ...props }: {
    icon: IconName;
    label: string;
    onClick(): void;
    className?: string;
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
    disabled?: boolean;
}) {
    return (
        <Tooltip text={label}>
            <Button variant="icon" icon={icon} aria-label={label} onClick={onClick} className={className} {...props} />
        </Tooltip>
    );
}

export function Switch({ checked, onChange, label, labelledBy, disabled }: {
    checked: boolean;
    onChange(checked: boolean): void;
    /** Accessible name when there's no visible label to point at */
    label?: string;
    labelledBy?: string;
    /** Say why next to it: a disabled control's tooltip never opens for the keyboard */
    disabled?: boolean;
}) {
    const Native = DiscordUI.Switch.get;
    // Discord's switch is named through labelledBy only. Its real checkbox sits in a visually hidden,
    // absolutely placed box: without a positioned parent that box lands far down the page, and
    // clicking the switch focused it there, scrolling Discord's settings away from the switch.
    if (Native && labelledBy) return <span className="dl-switch-anchor"><Native checked={checked} onChange={onChange} labelledBy={labelledBy} disabled={disabled} /></span>;
    return (
        <button
            type="button"
            role="switch"
            className="dl-switch"
            aria-checked={checked}
            aria-label={label}
            aria-labelledby={labelledBy}
            disabled={disabled}
            onClick={() => onChange(!checked)}
        />
    );
}

/** Discord's settings toggle row: label and description on the left, switch on the right */
export function SwitchRow({ id, label, description, checked, onChange }: {
    id: string;
    label: string;
    description?: string;
    checked: boolean;
    onChange(checked: boolean): void;
}) {
    const Native = DiscordUI.SwitchRow.get;
    if (Native) return <Native label={label} description={description} checked={checked} onChange={onChange} />;
    const labelId = `${id}-label`;
    return (
        <div className="dl-switch-row">
            <div className="dl-switch-row-text">
                <Text variant="text-md/medium" color="text-strong" id={labelId}>{label}</Text>
                {description && <Text tag="p" variant="text-sm/normal" color="text-subtle">{description}</Text>}
            </div>
            <Switch checked={checked} onChange={onChange} labelledBy={labelId} />
        </div>
    );
}

/**
 * Text input with its label and description. The input is Discord's standard one (never its
 * inline-edit field, which only turns into an input on hover); the label and description around it
 * are ours, so every setting reads the same whichever input renders.
 */
export function TextField({ id, label, hideLabel, description, value, onChange, placeholder, multiline, type = "text", inputMode, spellCheck }: {
    id: string;
    label: string;
    hideLabel?: boolean;
    description?: string;
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    multiline?: boolean;
    type?: string;
    inputMode?: string;
    spellCheck?: boolean;
}) {
    const hintId = description ? `${id}-hint` : undefined;
    const Area = DiscordUI.TextArea.get;
    const Input = DiscordUI.TextInput.get ?? DiscordUI.TextField.get;

    let control: ReactNode;
    if (multiline && Area) {
        control = <Area {...{ id, value, onChange, placeholder, rows: 4, autosize: true, "aria-describedby": hintId } as any} />;
    } else if (!multiline && Input) {
        control = <Input {...{ id, value, onChange, placeholder, type, inputMode, spellCheck, size: "md", "aria-describedby": hintId } as any} />;
    } else {
        const common = { id, placeholder, value, spellCheck, "aria-describedby": hintId };
        control = multiline
            ? <textarea className="dl-textarea" rows={4} {...common} onChange={e => onChange(e.currentTarget.value)} />
            : <input className="dl-input" type={type} inputMode={inputMode as any} {...common} onChange={e => onChange(e.currentTarget.value)} />;
    }

    return (
        <div className="dl-field">
            <label className={hideLabel ? "dl-sr-only" : "dl-label"} htmlFor={id}>{label}</label>
            {description && <p className="dl-hint" id={hintId}>{description}</p>}
            {control}
        </div>
    );
}

/** Search input with Discord's magnifying glass and clear button */
export function SearchField({ id, label, value, onChange, placeholder }: {
    id: string;
    label: string;
    value: string;
    onChange(value: string): void;
    placeholder?: string;
}) {
    const Input = DiscordUI.TextInput.get;
    if (Input) {
        return (
            <Input
                id={id}
                label={label}
                hideLabel
                type="search"
                leading={iconComponent("search")}
                clearable
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                autoComplete="off"
                spellCheck={false}
            />
        );
    }
    return (
        <div className="dl-search-fallback">
            <label className="dl-sr-only" htmlFor={id}>{label}</label>
            <Icon name="search" />
            <input className="dl-input" id={id} type="search" autoComplete="off" spellCheck={false} placeholder={placeholder} value={value} onChange={e => onChange(e.currentTarget.value)} />
        </div>
    );
}

/** Large code textarea (Quick CSS), Discord's when available. The label names it for screen readers. */
export function CodeArea({ id, value, onChange, placeholder, label }: {
    id: string;
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    label?: string;
}) {
    const Native = DiscordUI.TextArea.get;
    if (Native) {
        return (
            <div className="dl-code-native">
                <Native id={id} label={label} hideLabel value={value} onChange={onChange} placeholder={placeholder} rows={22} spellCheck={false} />
            </div>
        );
    }
    return (
        <div className="dl-field">
            {label && <label className="dl-sr-only" htmlFor={id}>{label}</label>}
            <textarea id={id} className="dl-textarea dl-code-editor" spellCheck={false} placeholder={placeholder} value={value} onChange={e => onChange(e.currentTarget.value)} />
        </div>
    );
}

/** A row of single-choice filter chips, Discord's filter tags when available */
export function FilterChips<K extends string>({ label, options, value, onChange }: {
    label: string;
    options: { id: K; label: string; count?: number; }[];
    value: K;
    onChange(value: K): void;
}) {
    const Native = DiscordUI.TagGroup.get;
    if (Native) {
        return (
            <div className="dl-chips-native">
                <Native
                    label={label}
                    items={options.map(o => ({ id: o.id, label: o.count === undefined ? o.label : `${o.label} ${o.count}` }))}
                    selectionMode="single"
                    disallowEmptySelection
                    selectedKeys={[value]}
                    onSelectionChange={keys => {
                        const [next] = keys;
                        if (next) onChange(next as K);
                    }}
                    variant="filter"
                    size="sm"
                />
            </div>
        );
    }
    return (
        <div className="dl-chips" role="group" aria-label={label}>
            {options.map(o => (
                <button key={o.id} type="button" className="dl-chip" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
                    {o.label}
                    {o.count !== undefined && <span className="dl-tabular">{o.count}</span>}
                </button>
            ))}
        </div>
    );
}

/**
 * Tabs along the top of a page, like Discord's settings tab bars. Each tab's id is `${id}-${tab}`
 * and the panel it controls is `${id}-panel`. Arrows move between tabs, Home and End jump to the ends.
 */
export function TabBar<K extends string>({ id, label, tabs, value, onChange }: {
    id: string;
    label: string;
    /** `count` shows as a red pill, for things waiting on you (updates) */
    tabs: readonly { id: K; label: string; icon?: IconName; count?: number; }[];
    value: K;
    onChange(value: K): void;
}) {
    const onKeyDown = (e: ReactKeyboardEvent) => {
        const index = tabs.findIndex(tab => tab.id === value);
        const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const target = tabs[(next + tabs.length) % tabs.length];
        onChange(target.id);
        document.getElementById(`${id}-${target.id}`)?.focus();
    };

    return (
        <div className="dl-tabbar" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`${id}-${tab.id}`}
                    className="dl-tabbar-item"
                    aria-selected={tab.id === value}
                    aria-controls={`${id}-panel`}
                    tabIndex={tab.id === value ? 0 : -1}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.icon && <Icon name={tab.icon} size={18} />}
                    {tab.label}
                    {!!tab.count && <span className="dl-tabbar-count dl-tabular">{tab.count}</span>}
                </button>
            ))}
        </div>
    );
}

/**
 * One page of `items` at a time. Back to the first page whenever `resetKey` changes (a new search or
 * filter), and never past the last page when the list shrinks under you.
 */
export function usePages<T>(items: readonly T[], size: number, resetKey: unknown) {
    const [page, setPage] = React.useState(0);
    const [key, setKey] = React.useState(resetKey);
    if (key !== resetKey) {
        setKey(resetKey);
        setPage(0);
    }
    const count = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(key === resetKey ? page : 0, count - 1);
    return { page: current, count, items: items.slice(current * size, (current + 1) * size), setPage };
}

/** First, last, and the pages around the current one; null where pages are skipped */
export function pageNumbers(page: number, count: number): (number | null)[] {
    if (count <= 7) return Array.from({ length: count }, (_, i) => i);
    const shown = [...new Set([0, page - 1, page, page + 1, count - 1])].filter(p => p >= 0 && p < count).sort((a, b) => a - b);
    return shown.flatMap((p, i) => i > 0 && p - shown[i - 1] > 1 ? [null, p] : [p]);
}

/** Brings the top of a list back into view when its page changes, if you'd scrolled past it */
export function scrollToTop(el: HTMLElement | null) {
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
}

/** Numbered page buttons with previous and next, hidden when everything fits on one page */
export function Pagination({ page, count, onChange, label }: { page: number; count: number; onChange(page: number): void; label: string; }) {
    if (count <= 1) return null;
    return (
        <nav className="dl-pagination" aria-label={label}>
            <button type="button" className="dl-page" aria-label={t("pagination.previous")} disabled={page === 0} onClick={() => onChange(page - 1)}>
                <Icon name="chevronLeft" size={16} />
            </button>
            {pageNumbers(page, count).map((p, i) => p === null
                ? <span key={`gap-${i}`} className="dl-page-gap" aria-hidden="true">…</span>
                : (
                    <button
                        key={p}
                        type="button"
                        className="dl-page dl-tabular"
                        aria-label={t("pagination.page", { page: p + 1 })}
                        aria-current={p === page ? "page" : undefined}
                        onClick={() => onChange(p)}
                    >
                        {p + 1}
                    </button>
                ))}
            <button type="button" className="dl-page" aria-label={t("pagination.next")} disabled={page === count - 1} onClick={() => onChange(page + 1)}>
                <Icon name="chevronRight" size={16} />
            </button>
        </nav>
    );
}

export type Tone = "success" | "warning" | "danger" | "muted";

const toneIcon = { success: "circleCheck", warning: "warning", danger: "circleError", muted: "clock" } as const;

/** Status is always icon + words, never color alone */
export function Status({ tone, children, quiet }: {
    tone: Tone;
    children: ReactNode;
    /** Only the icon takes the tone's color: for the expected state, which shouldn't draw the eye */
    quiet?: boolean;
}) {
    return (
        <span className="dl-status" data-tone={tone} data-quiet={quiet ? "" : undefined}>
            <Icon name={toneIcon[tone]} size={14} />
            {children}
        </span>
    );
}

/** A small label next to a title, styled like Discord's badges */
export function Badge({ children, tone }: { children: ReactNode; tone?: "warning"; }) {
    return <span className="dl-badge" data-tone={tone}>{children}</span>;
}

/** Discord's inline notice with an optional action; Evi's banner when it isn't available */
export function Notice({ tone, action, children }: { tone: "warning" | "danger" | "info"; action?: ReactNode; children: ReactNode; }) {
    const Native = DiscordUI.Notice.get;
    const messageType = ({ warning: "warn", danger: "danger", info: "info" } as const)[tone];
    const body = Native
        ? <Native messageType={messageType} action={action}>{children}</Native>
        : (
            <div className="dl-banner" data-tone={tone}>
                <Icon name={tone === "info" ? "info" : tone === "danger" ? "circleError" : "warning"} size={20} />
                <span className="dl-banner-text">{children}</span>
                {action}
            </div>
        );
    return <div className="dl-notice" role={tone === "danger" ? "alert" : "status"}>{body}</div>;
}

/** A titled group of settings, like one of Discord's settings categories */
export function Section({ title, description, action, children, id }: {
    title?: string;
    description?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    /** Id for the title, which labels the section */
    id?: string;
}) {
    const titleId = title && id ? `${id}-title` : undefined;
    return (
        <section className="dl-section" id={id} aria-labelledby={titleId}>
            {(title || action) && (
                <div className="dl-section-head">
                    <div className="dl-section-text">
                        {title && <Text tag="h2" variant="heading-xl/normal" color="text-strong" id={titleId}>{title}</Text>}
                        {description && <Text tag="p" variant="text-sm/normal" color="text-subtle">{description}</Text>}
                    </div>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

/** Rows in one bordered group with dividers between them, like Discord's settings cards */
export function List({ children, label }: { children: ReactNode; label?: string; }) {
    return <ul className="dl-list" aria-label={label}>{children}</ul>;
}

/** Orients the reader when a list is empty and offers the one next step */
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode; }) {
    return (
        <div className="dl-empty">
            <span className="dl-empty-icon"><Icon name={icon} size={24} /></span>
            <Text tag="h3" variant="heading-md/semibold" color="text-strong">{title}</Text>
            {children && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-empty-text">{children}</Text>}
            {action}
        </div>
    );
}

/**
 * Expands and collapses its content with an interruptible height transition. The content mounts on
 * first open and then stays, hidden from focus and screen readers while collapsed.
 */
export function Collapse({ open, id, children }: { open: boolean; id: string; children: ReactNode; }) {
    const [mounted, setMounted] = React.useState(open);
    if (open && !mounted) setMounted(true);
    return (
        <div className="dl-collapse" id={id} data-open={open ? "" : undefined}>
            <div className="dl-collapse-clip">{(open || mounted) && children}</div>
        </div>
    );
}

/** Lists longer than this get a filter box */
const FILTER_FROM = 12;
const LIST_MAX = 320;

/**
 * A select that looks and moves like Discord's, with no browser popup: the list opens in a layer
 * on <body>, so a dialog never clips it, with its scrollbar hidden. Focus stays on the button
 * (aria-activedescendant points at the active option) except while typing in the filter box.
 * Discord's own Select and the native <select> both showed a scrollbar in long lists.
 */
export function Dropdown<V extends string>({ id, label, labelledBy, options, value, onChange, disabled, className }: {
    id: string;
    label: string;
    labelledBy?: string;
    /** A disabled option shows greyed out and can't be picked */
    options: readonly { label: string; value: V; disabled?: boolean; }[];
    value: V;
    onChange(value: V): void;
    disabled?: boolean;
    /** Added to the button, for plugins that size it to their own layout */
    className?: string;
}) {
    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const button = React.useRef<HTMLButtonElement>(null);
    const closeList = React.useRef<() => void>(() => setOpen(false));
    const typed = React.useRef({ text: "", at: 0 });
    const filterable = options.length > FILTER_FROM;
    const shown = React.useMemo(() => {
        const q = query.trim().toLocaleLowerCase();
        return q ? options.filter(o => o.label.toLocaleLowerCase().includes(q)) : options;
    }, [options, query]);
    const current = options.find(o => o.value === value);
    const listId = `${id}-list`;
    const optionId = (i: number) => `${id}-option-${i}`;

    const show = () => {
        if (open || disabled) return;
        setQuery("");
        setActive(Math.max(0, options.findIndex(o => o.value === value)));
        setOpen(true);
    };
    const hide = (refocus = true) => {
        closeList.current();
        if (refocus) button.current?.focus();
    };
    const choose = (option: { value: V; disabled?: boolean; } | undefined) => {
        if (!option || option.disabled) return;
        if (option.value !== value) onChange(option.value);
        hide();
    };

    /** Jumps to the next option starting with what's been typed, like a native select */
    const typeAhead = (key: string) => {
        const now = Date.now();
        const t = typed.current;
        t.text = now - t.at > 600 ? key : t.text + key;
        t.at = now;
        const text = t.text.toLocaleLowerCase();
        const from = open ? active : options.findIndex(o => o.value === value);
        const list = open ? shown : options;
        for (let n = 1; n <= list.length; n++) {
            const i = (from + (t.text.length > 1 ? 0 : n) + list.length) % list.length;
            if (!list[i]?.disabled && list[i]?.label.toLocaleLowerCase().startsWith(text)) {
                if (open) setActive(i);
                else onChange(list[i].value);
                return;
            }
        }
    };

    /** Keys while the list is open, from the button or the filter box */
    const onListKey = (e: ReactKeyboardEvent, inFilter: boolean) => {
        const last = shown.length - 1;
        const move = (to: number) => {
            e.preventDefault();
            setActive(Math.max(0, Math.min(last, to)));
        };
        switch (e.key) {
            case "ArrowDown": return move(active + 1);
            case "ArrowUp": return move(active - 1);
            case "PageDown": return move(active + 8);
            case "PageUp": return move(active - 8);
            case "Home": if (!inFilter) return move(0); return;
            case "End": if (!inFilter) return move(last); return;
            case "Enter":
                e.preventDefault();
                return choose(shown[active]);
            case " ":
                if (inFilter) return;
                e.preventDefault();
                return choose(shown[active]);
            case "Tab":
                return hide(false);
        }
        if (inFilter || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        if (filterable) {
            // Typing goes to the filter box
            setQuery(q => q + e.key);
            document.getElementById(`${id}-filter`)?.focus();
        } else typeAhead(e.key);
    };

    const onButtonKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (open) return onListKey(e, false);
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            typeAhead(e.key);
        }
    };

    return (
        <>
            <button
                ref={button}
                id={id}
                type="button"
                className={cx("dl-select", className)}
                disabled={disabled}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
                aria-label={labelledBy ? undefined : label}
                aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
                onClick={() => open ? hide() : show()}
                onKeyDown={onButtonKey}
            >
                <span className="dl-select-value">{current?.label ?? ""}</span>
                <Icon name="chevronDown" size={18} className="dl-select-chevron" />
            </button>
            {open && (
                <SelectList
                    anchor={button}
                    id={listId}
                    label={label}
                    closeRef={closeList}
                    focusInside={filterable}
                    onClosed={() => setOpen(false)}
                    onDismiss={hide}
                >
                    {filterable && (
                        <input
                            id={`${id}-filter`}
                            className="dl-select-filter"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={t("common.filter")}
                            aria-label={t("common.filter")}
                            aria-controls={listId}
                            aria-activedescendant={shown[active] ? optionId(active) : undefined}
                            value={query}
                            onChange={e => {
                                setQuery(e.currentTarget.value);
                                setActive(0);
                            }}
                            onKeyDown={e => onListKey(e, true)}
                        />
                    )}
                    <div className="dl-select-options" role="listbox" id={listId} aria-label={label}>
                        {shown.map((o, i) => (
                            <div
                                key={o.value}
                                id={optionId(i)}
                                role="option"
                                className="dl-select-option"
                                aria-selected={o.value === value}
                                aria-disabled={o.disabled || undefined}
                                data-active={i === active ? "" : undefined}
                                // Keeps focus where it is: the button, or the filter box
                                onMouseDown={e => e.preventDefault()}
                                onMouseMove={() => i !== active && setActive(i)}
                                onClick={() => choose(o)}
                            >
                                <span className="dl-select-option-label">{o.label}</span>
                                {o.value === value && <Icon name="circleCheck" size={18} className="dl-select-check" />}
                            </div>
                        ))}
                        {!shown.length && <div className="dl-select-empty">{t("common.noMatches")}</div>}
                    </div>
                </SelectList>
            )}
        </>
    );
}

/**
 * The open list: fixed under its button (above it when there's no room below), as wide as it,
 * following it on scroll and resize. Escape and clicks outside dismiss it; Escape never reaches
 * the dialog or panel underneath. Counts as a dialog while open, for the same reason.
 */
function SelectList({ anchor, id, label, closeRef, focusInside, onClosed, onDismiss, children }: {
    anchor: React.RefObject<HTMLButtonElement | null>;
    id: string;
    label: string;
    closeRef: React.MutableRefObject<() => void>;
    /** The filter box takes focus: inside Discord's settings it needs its own focus layer to keep it */
    focusInside: boolean;
    onClosed(): void;
    onDismiss(refocus?: boolean): void;
    children: ReactNode;
}) {
    const exit = useExit(onClosed);
    closeRef.current = exit.close;
    const popout = React.useRef<HTMLDivElement>(null);
    const [place, setPlace] = React.useState<{ left: number; top: number; width: number; maxHeight: number; side: "top" | "bottom"; }>();

    // Follows the button every frame while open: it can move without a scroll or resize, like
    // while its dialog is still scaling in. Only a change re-renders.
    React.useLayoutEffect(() => {
        let frame = 0;
        let last = "";
        const measure = () => {
            frame = requestAnimationFrame(measure);
            const box = anchor.current?.getBoundingClientRect();
            if (!box) return;
            const gap = 8;
            const want = Math.min(LIST_MAX, popout.current?.scrollHeight ?? LIST_MAX);
            const below = window.innerHeight - box.bottom - gap * 2;
            const above = box.top - gap * 2;
            const side = below >= want || below >= above ? "bottom" : "top";
            const maxHeight = Math.round(Math.max(120, Math.min(LIST_MAX, side === "bottom" ? below : above)));
            const width = Math.round(Math.max(box.width, 180));
            const left = Math.round(Math.min(Math.max(gap, box.left), window.innerWidth - width - gap));
            const top = Math.round(side === "bottom" ? box.bottom + gap : box.top - gap);
            const key = `${left} ${top} ${width} ${maxHeight} ${side}`;
            if (key === last) return;
            last = key;
            setPlace({ left, width, maxHeight, side, top });
        };
        measure();
        return () => cancelAnimationFrame(frame);
    }, []);

    // The chosen option in view on open, then the active one as the keys move it
    React.useEffect(() => {
        const list = popout.current;
        if (!list || !place) return;
        const observer = new MutationObserver(() => list.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }));
        observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-active"] });
        list.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
        list.querySelector<HTMLInputElement>(".dl-select-filter")?.focus();
        return () => observer.disconnect();
    }, [!!place]);

    React.useEffect(() => {
        openDialogs++;
        const self = {};
        dialogStack.push(self);
        // Capture phase on window, before the dialog's and the panel's own Escape handlers
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || dialogStack.at(-1) !== self) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            onDismiss();
        };
        const onDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (popout.current?.contains(target) || anchor.current?.contains(target)) return;
            onDismiss(false);
        };
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("pointerdown", onDown, true);
        return () => {
            openDialogs--;
            dialogStack.splice(dialogStack.indexOf(self), 1);
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("pointerdown", onDown, true);
        };
    }, []);

    const list = (
                <div
                    ref={popout}
                    className="dl-select-popout evi-popout"
                    data-side={place?.side}
                    aria-label={label}
                    data-list={id}
                    style={place
                        ? { left: place.left, width: place.width, maxHeight: place.maxHeight, ...(place.side === "bottom" ? { top: place.top } : { bottom: window.innerHeight - place.top }) }
                        : { visibility: "hidden" }}
                >
                    {children}
                </div>
    );
    return ReactDOM.createPortal(
        <div className="dl-root dl-select-layer" {...exit.closingProps}>
            {focusInside ? <FocusLayer containerRef={popout}>{list}</FocusLayer> : list}
        </div>,
        document.body,
    );
}

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** A shortcut as keycaps */
export function Keys({ value }: { value: string; }) {
    return (
        <span className="dl-keys">
            {comboKeys(value, IS_MAC).map((key, i) => <kbd key={i} className="dl-kbd">{key}</kbd>)}
        </span>
    );
}

/**
 * Records a keyboard shortcut: click, press the keys. Esc cancels, leaving the field too. The keys
 * pressed while recording go nowhere else: not to Discord, not to Evi's or plugins' own shortcuts.
 */
export function KeybindField({ id, label, description, value, onChange, usedBy }: {
    id: string;
    label: string;
    description?: string;
    value: string;
    onChange(value: string): void;
    /** Who else has this shortcut, if anyone */
    usedBy?(value: string): string | undefined;
}) {
    const [recording, setRecording] = React.useState(false);
    const [problem, setProblem] = React.useState<ComboProblem>();
    const ref = React.useRef<HTMLButtonElement>(null);
    const hintId = `${id}-hint`;
    const statusId = `${id}-status`;

    React.useEffect(() => {
        if (!recording) return;
        // Capture phase on window, ahead of Discord's shortcuts; Evi's own step aside (isRecording)
        const onKey = (e: KeyboardEvent) => {
            if (e.target !== ref.current) return;
            if (e.key === "Tab") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
                setRecording(false);
                setProblem(undefined);
                return;
            }
            const combo = comboFromEvent(e);
            if (!combo) return;
            const wrong = comboProblem(combo);
            setProblem(wrong);
            if (wrong) return;
            setRecording(false);
            onChange(formatCombo(combo));
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [recording]);

    const other = !recording && value ? usedBy?.(value) : undefined;
    const buttonLabel = recording ? t("keybind.recording") : value ? t("keybind.change", { label }) : t("keybind.record", { label });

    return (
        <div className="dl-field">
            <Text variant="text-md/medium" color="text-strong" id={`${id}-label`}>{label}</Text>
            {description && <p className="dl-hint" id={hintId}>{description}</p>}
            <div className="dl-keybind-row">
                <button
                    ref={ref}
                    id={id}
                    type="button"
                    className="dl-keybind"
                    aria-label={buttonLabel}
                    aria-describedby={cx(description && hintId, (problem || other) && statusId) || undefined}
                    aria-invalid={problem ? true : undefined}
                    {...{ [RECORDING_ATTR]: recording ? "" : undefined }}
                    onClick={() => setRecording(r => !r)}
                    onBlur={() => {
                        setRecording(false);
                        setProblem(undefined);
                    }}
                >
                    {recording
                        ? <span className="dl-keybind-prompt">{t("keybind.pressKeys")}</span>
                        : value
                            ? <Keys value={value} />
                            : <span className="dl-keybind-prompt">{t("keybind.none")}</span>}
                    <span className="dl-keybind-action" aria-hidden="true">
                        {recording ? t("keybind.escToCancel") : value ? t("keybind.changeShort") : t("keybind.recordShort")}
                    </span>
                </button>
                {value && !recording && <IconButton icon="close" label={t("keybind.clear", { label })} onClick={() => onChange("")} />}
            </div>
            <span id={statusId} role="status">
                {problem && <Status tone="danger">{t(problem === "reserved" ? "keybind.reserved" : "keybind.needsModifier")}</Status>}
                {other && <Status tone="warning">{t("keybind.usedBy", { name: other })}</Status>}
            </span>
        </div>
    );
}

export function SettingField({ id, definition, value, onChange, keybindUsedBy }: {
    id: string;
    definition: SettingDefinition;
    value: unknown;
    onChange(value: unknown): void;
    keybindUsedBy?(value: string): string | undefined;
}) {
    const labelId = `${id}-label`;

    if (definition.type === "keybind") {
        return <KeybindField id={id} label={definition.label} description={definition.description} value={String(value ?? "")} onChange={onChange} usedBy={keybindUsedBy} />;
    }

    if (definition.type === "boolean") {
        return <SwitchRow id={id} label={definition.label} description={definition.description} checked={!!value} onChange={onChange} />;
    }

    if (definition.type === "string") {
        return (
            <TextField
                id={id}
                label={definition.label}
                description={definition.description}
                value={String(value ?? "")}
                onChange={onChange}
                placeholder={definition.placeholder}
                multiline={definition.multiline}
            />
        );
    }

    let control: ReactNode;
    const Slider = DiscordUI.Slider.get;

    if (definition.type === "select") {
        control = <Dropdown id={id} labelledBy={labelId} label={definition.label} options={definition.options} value={value as string} onChange={onChange} />;
    } else {
        const { min, max, step = 1 } = definition;
        const ranged = min !== undefined && max !== undefined && (max - min) / step <= 20;
        if (ranged && Slider) {
            const markers = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + i * step);
            control = (
                <Slider
                    initialValue={Number(value)}
                    minValue={min}
                    maxValue={max}
                    markers={markers}
                    stickToMarkers
                    keyboardStep={step}
                    onValueChange={onChange}
                    onMarkerRender={String}
                    onValueRender={v => String(Math.round(v / step) * step)}
                />
            );
        } else {
            return (
                <TextField
                    id={id}
                    label={definition.label}
                    description={definition.description}
                    value={String(value ?? "")}
                    type="number"
                    inputMode="decimal"
                    onChange={v => {
                        const n = Number(v);
                        if (v.trim() && !Number.isNaN(n)) onChange(n);
                    }}
                />
            );
        }
    }

    return (
        <div className="dl-field">
            <Text variant="text-md/medium" color="text-strong" id={labelId}>{definition.label}</Text>
            {definition.description && <Text tag="p" variant="text-sm/normal" color="text-subtle">{definition.description}</Text>}
            {control}
        </div>
    );
}

/** Subscribes a component to an external store */
export function useStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T) {
    return React.useSyncExternalStore(subscribe, getSnapshot);
}

type BoundaryProps = { children: ReactNode; resetKey?: unknown; };
let Boundary: ComponentType<BoundaryProps> | undefined;

/**
 * Keeps a view that throws while rendering from taking the whole panel down with it: shows what
 * went wrong in its place instead. `resetKey` changing (another tab) tries again.
 */
export function ErrorBoundary(props: BoundaryProps) {
    // React is only there once Discord's modules load, so the class is made on first use
    Boundary ??= class extends React.Component<BoundaryProps, { error?: Error; key?: unknown; }> {
        override state: { error?: Error; key?: unknown; } = {};

        static getDerivedStateFromError(error: Error) {
            return { error };
        }

        static getDerivedStateFromProps(props: BoundaryProps, state: { error?: Error; key?: unknown; }) {
            return props.resetKey !== state.key ? { error: undefined, key: props.resetKey } : null;
        }

        override componentDidCatch(error: Error) {
            console.error("[Evi] A settings view crashed", error);
        }

        override render() {
            const { error } = this.state;
            if (!error) return this.props.children;
            return (
                <div className="dl-stack" role="alert">
                    <Notice tone="danger">{t("boundary.crashed")}</Notice>
                    <pre className="dl-error">{String(error.stack ?? error)}</pre>
                </div>
            );
        }
    };
    return <Boundary {...props} />;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab cycling inside `container` */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void; }, container: HTMLElement | null) {
    if (e.key !== "Tab" || !container) return;
    const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
    }
}

/** How many Evi dialogs are open: Escape closes the top one instead of the whole panel */
export let openDialogs = 0;
/** Open dialogs, newest last: with one opened from another, Escape closes only the newest */
const dialogStack: object[] = [];

/**
 * What every Evi dialog does: focus moves in on open and back where it was on close, Tab stays
 * inside, and Escape closes it. Put `ref` and `onKeyDown` on the dialog element.
 */
export function useModal(onClose: () => void) {
    const ref = React.useRef<HTMLDivElement>(null);
    const closeRef = React.useRef(onClose);
    closeRef.current = onClose;

    React.useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        ref.current?.focus();
        openDialogs++;
        const self = {};
        dialogStack.push(self);
        // Capture phase on window, so Discord's own Escape handling (closing settings) never sees it
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || dialogStack.at(-1) !== self || isRecording(e.target)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            closeRef.current();
        };
        window.addEventListener("keydown", onKey, true);
        return () => {
            openDialogs--;
            dialogStack.splice(dialogStack.indexOf(self), 1);
            window.removeEventListener("keydown", onKey, true);
            previous?.focus?.();
        };
    }, []);

    return { ref, onKeyDown: (e: React.KeyboardEvent) => trapTab(e, ref.current) };
}

/**
 * Our dialogs are rendered into <body>, outside Discord's settings screen, which pulls focus back
 * whenever it leaves (Discord's focus layers). Inside it, a dropdown lost focus as it opened and
 * closed again. As its own layer on top, like Discord's nested modals, focus may stay in the dialog.
 */
export function FocusLayer({ containerRef, children }: { containerRef: React.RefObject<HTMLElement | null>; children: ReactNode; }) {
    // Resolved once, so the tree under it never remounts when Discord's module turns up later
    const [Lock] = React.useState(() => DiscordUI.FocusLock.get);
    return Lock ? <Lock containerRef={containerRef}>{children}</Lock> : <>{children}</>;
}

/**
 * Plays an exit before `onClose` unmounts what's closing: spread `closingProps` on an element
 * around the animated parts (they animate by class, see toolkit/layer.ts), and call `close`
 * instead of `onClose`.
 */
export function useExit(onClose: () => void) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [closing, setClosing] = React.useState(false);
    const closeRef = React.useRef(onClose);
    closeRef.current = onClose;

    React.useLayoutEffect(() => {
        if (!closing) return;
        let live = true;
        void exitDone(ref.current).then(() => live && closeRef.current());
        return () => void (live = false);
    }, [closing]);

    const close = React.useCallback(() => setClosing(true), []);
    return { close, closing, closingProps: { ref, "data-closing": closing ? "" : undefined } };
}

/**
 * A dialog over everything, so opening it never moves the page underneath. Rendered into <body>,
 * which also gets it out of Discord's settings scroller when the tab is embedded there.
 * Escape and clicking beside it close it; focus stays inside and goes back where it was after.
 * `children` can be a function of `close`, for content that closes the dialog itself (with its exit).
 */
export function Dialog({ title, onClose, children, id, className }: { title: ReactNode; onClose(): void; children: ReactNode | ((close: () => void) => ReactNode); id: string; /** On the dialog box, e.g. for a wider one */ className?: string; }) {
    const exit = useExit(onClose);
    const { ref, onKeyDown } = useModal(exit.close);
    const body = React.useRef<HTMLDivElement>(null);

    // A dialog opens at its top, or on what its content marks with data-dialog-start (a setting the
    // search found). Inside Discord's settings, Discord's focus lock can move focus to a field further
    // down as the dialog opens, which scrolled the body there: until the user scrolls or presses a key
    // themselves, any scroll that focus causes goes back to where it opened
    React.useLayoutEffect(() => {
        const el = body.current;
        if (!el) return;
        el.scrollTop = 0;
        el.querySelector("[data-dialog-start]")?.scrollIntoView({ block: "nearest" });
        const start = el.scrollTop;
        let settled = false;
        const settle = () => void (settled = true);
        const onScroll = () => { if (!settled) el.scrollTop = start; };
        el.addEventListener("scroll", onScroll);
        el.addEventListener("wheel", settle, { passive: true });
        el.addEventListener("pointerdown", settle);
        el.addEventListener("keydown", settle);
        el.addEventListener("touchstart", settle, { passive: true });
        const timer = setTimeout(settle, 1000);
        return () => {
            clearTimeout(timer);
            el.removeEventListener("scroll", onScroll);
            el.removeEventListener("wheel", settle);
            el.removeEventListener("pointerdown", settle);
            el.removeEventListener("keydown", settle);
            el.removeEventListener("touchstart", settle);
        };
    }, []);

    return ReactDOM.createPortal(
        <div className="dl-root" {...exit.closingProps}>
            <div className="dl-scrim dl-dialog-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && exit.close()}>
                <div className={cx("dl-dialog evi-modal", className)} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} ref={ref} onKeyDown={onKeyDown} id={id}>
                    <FocusLayer containerRef={ref}>
                        <header className="dl-dialog-head">
                            <Text tag="h2" variant="heading-lg/semibold" color="text-strong" id={`${id}-title`}>{title}</Text>
                            <IconButton icon="close" label={t("common.close")} onClick={exit.close} />
                        </header>
                        <div className="dl-dialog-body" ref={body}>{typeof children === "function" ? children(exit.close) : children}</div>
                    </FocusLayer>
                </div>
            </div>
        </div>,
        document.body,
    );
}
