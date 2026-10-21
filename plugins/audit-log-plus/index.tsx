/**
 * A readable audit log: right-click a server where you can view its audit log, "Audit Log Plus".
 * Every entry is a sentence with who did it, to what, and what changed (permissions by name, colours
 * as swatches, durations in words), filterable by person, kind of action, dates and text, and
 * exportable as CSV or JSON.
 *
 * Discord, checked against its web build on 2026-10-02:
 * - GET /guilds/:id/audit-logs?limit=100&before=&user_id= through Discord's own HTTP client
 *   ({ get, post, put, patch, del }; superagent, which also has Request and getXHR, is skipped)
 * - VIEW_AUDIT_LOG is permission bit 7, checked with PermissionStore.can
 * - transitionToGuild(guildId, channelId) logs "transitionToGuild - Transitioning to"
 * - openUserProfileModal({ userId, guildId }) is exported by name
 */
import { Components, definePlugin, Dropdown, filters, find, getStore, I18n, Menu, openLayer, React, useLocale } from "@evi/api";
import type { CloseLayer, PluginContext } from "@evi/api";

import {
    ChangeView, Described, describe, Directory, durationParts, exportName, ExportRow, Filters, Group, GROUPS, groupRuns, hexColor, humanize,
    matches, Person, RawEntry, RawLog, Target, toCsv,
} from "./audit";
import { t } from "./strings";

let context: PluginContext | undefined;

const store = (name: string): any => {
    try {
        return getStore(name);
    } catch {
        return undefined;
    }
};

type HttpClient = { get(opts: any): Promise<any>; };
const http = (): HttpClient | undefined => find(v => typeof v?.patch === "function" && typeof v?.del === "function"
    && typeof v?.get === "function" && !("getXHR" in v) && !("Request" in v));

const VIEW_AUDIT_LOG = 1n << 7n;

function canViewAuditLog(guild: any): boolean {
    try {
        return !!store("PermissionStore")?.can?.(VIEW_AUDIT_LOG, guild);
    } catch {
        return false;
    }
}

function openChannel(guildId: string, channelId: string) {
    const go = find(filters.byCode("transitionToGuild - Transitioning to"));
    if (typeof go === "function") go(guildId, channelId);
}

function openProfile(userId: string, guildId: string) {
    const mod = find(filters.byProps("openUserProfileModal"));
    mod?.openUserProfileModal?.({ userId, guildId });
}

/** What Discord's stores know, for names the audit log response leaves out */
const lookup = (guildId: string) => ({
    user(id: string): Person | undefined {
        const u = store("UserStore")?.getUser?.(id);
        return u ? { id, name: u.globalName || u.username || id, avatar: u.avatar, bot: !!u.bot } : undefined;
    },
    channel: (id: string): string | undefined => store("ChannelStore")?.getChannel?.(id)?.name,
    role(id: string) {
        const rs = store("GuildRoleStore");
        let r: any;
        try {
            r = rs?.getRole?.(guildId, id) ?? rs?.getRolesSnapshot?.(guildId)?.[id];
        } catch { /* older Discord keeps roles on the guild */ }
        r ??= store("GuildStore")?.getGuild?.(guildId)?.roles?.[id];
        return r ? { name: r.name, color: r.color } : undefined;
    },
    emoji: (id: string): string | undefined => store("EmojiStore")?.getCustomEmojiById?.(id)?.name,
    sticker: (id: string): string | undefined => store("StickersStore")?.getStickerById?.(id)?.name,
});

function avatarUrl(p: Person | undefined, size = 64): string {
    if (p?.avatar) return `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.webp?size=${size}`;
    let index = 0;
    try {
        index = Number((BigInt(p?.id ?? "0") >> 22n) % 6n);
    } catch { /* not a snowflake */ }
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => context?.toast(t("toast.copied"), { type: "success" }));
}

const label = (d: Pick<Described, "info" | "entry">) => {
    const { info } = d;
    if (info.kind && info.op) return t(`op.${info.op}`, { kind: t(`kind.${info.kind}`) });
    return t(`action.${info.key ?? "unknown"}` as "action.unknown", { type: d.entry.action_type });
};

const KNOWN_KEYS = new Set(["name", "topic", "nsfw", "rate_limit_per_user", "permissions", "allow", "deny", "color", "colors", "hoist", "mentionable", "nick", "deaf", "mute", "communication_disabled_until", "max_uses", "max_age", "temporary", "code", "bitrate", "user_limit", "position", "type", "avatar_hash", "icon_hash", "description", "$add", "$remove", "archived", "locked", "auto_archive_duration", "status", "channel_id", "reason"]);
const keyLabel = (key: string) => KNOWN_KEYS.has(key) ? t(`key.${key.replace("$", "")}` as any) : humanize(key);

function duration(seconds: number | undefined, key: string): string {
    if (seconds === undefined) return t("value.none");
    if (seconds === 0) return key === "max_age" ? t("value.never") : t("value.off");
    const [n, unit] = durationParts(seconds);
    try {
        return new Intl.NumberFormat(I18n.discordLocale, { style: "unit", unit, unitDisplay: "long" }).format(n);
    } catch {
        return `${n} ${unit}`;
    }
}

const exactTime = (ms: number) => new Date(ms).toLocaleString(I18n.discordLocale, { dateStyle: "medium", timeStyle: "short" });

function relativeTime(ms: number, now = Date.now()) {
    const rtf = new Intl.RelativeTimeFormat(I18n.discordLocale, { numeric: "auto" });
    const s = Math.round((ms - now) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
    for (const [unit, size] of units) if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
    return rtf.format(0, "second");
}

const yesNo = (v: boolean | undefined) => v === undefined ? t("value.none") : v ? t("value.yes") : t("value.no");

/** A change as one line of plain text, for search and export */
function changeText(c: ChangeView): string {
    const k = keyLabel(c.key);
    switch (c.type) {
        case "perms": return `${k}: ${[...c.added.map(p => `+${humanize(p)}`), ...c.removed.map(p => `-${humanize(p)}`)].join(", ")}`;
        case "roles": return `${k}: ${c.roles.map(r => r.name).join(", ")}`;
        case "color": return `${k}: ${c.old ?? t("value.none")} → ${c.new ?? t("value.none")}`;
        case "seconds": return `${k}: ${duration(c.old, c.key)} → ${duration(c.new, c.key)}`;
        case "date": return `${k}: ${c.old ? exactTime(c.old) : t("value.none")} → ${c.new ? exactTime(c.new) : t("value.none")}`;
        case "bool": return `${k}: ${yesNo(c.old)} → ${yesNo(c.new)}`;
        case "text": return `${k}: ${c.old ?? t("value.none")} → ${c.new ?? t("value.none")}`;
    }
}

/** The extra facts Discord puts in an entry's options, as short lines */
function optionLines(entry: RawEntry, dir: Directory, guildId: string): string[] {
    const o = entry.options ?? {};
    const out: string[] = [];
    const channel = (id: string) => `#${lookup(guildId).channel(id) ?? dir.named.get(id) ?? id}`;
    const count = Number(o.count);
    switch (entry.action_type) {
        case 21: out.push(t("detail.prune", { count: Number(o.members_removed) || 0, days: Number(o.delete_member_days) || 0 })); break;
        case 72: case 26: case 27: case 73:
            if (count) out.push(t(entry.action_type === 72 || entry.action_type === 73 ? "detail.messages" : "detail.members", { count }));
            if (o.channel_id) out.push(t("detail.channel", { channel: channel(o.channel_id) }));
            break;
        case 74: case 75:
            if (o.channel_id) out.push(t("detail.channel", { channel: channel(o.channel_id) }));
            break;
        case 13: case 14: case 15:
            if (o.id) {
                const isRole = String(o.type) === "0" || o.type === "role";
                const name = isRole ? `@${o.role_name ?? lookup(guildId).role(o.id)?.name ?? o.id}` : (dir.person(o.id)?.name ?? o.id);
                out.push(t("detail.overwrite", { name }));
            }
            break;
        case 143: case 144: case 145: case 146: case 180:
            if (o.auto_moderation_rule_name) out.push(t("detail.rule", { rule: o.auto_moderation_rule_name }));
            if (o.channel_id) out.push(t("detail.channel", { channel: channel(o.channel_id) }));
            break;
        case 192:
            if (typeof o.status === "string" && o.status) out.push(t("detail.status", { status: o.status }));
            break;
    }
    return out;
}

interface Row extends Described {
    label: string;
    options: string[];
}

function toRow(entry: RawEntry, dir: Directory, guildId: string): Row {
    const d = describe(entry, dir);
    const options = optionLines(entry, dir, guildId);
    const lbl = label(d);
    const text = [lbl, d.actor?.name, d.actor?.id, d.target.name, d.target.id, entry.reason, ...options, ...d.changes.map(changeText)]
        .filter(Boolean).join(" ").toLowerCase();
    return { ...d, label: lbl, options, count: 1, text };
}

function exportRows(rows: Row[]): ExportRow[] {
    return rows.map(r => ({
        time: new Date(r.time).toISOString(),
        action: r.label,
        actionType: r.entry.action_type,
        actorId: r.entry.user_id ?? "",
        actor: r.actor?.name ?? t("actor.system"),
        targetId: r.target.id ?? "",
        target: r.target.name,
        reason: r.entry.reason ?? "",
        changes: [...r.options, ...r.changes.map(changeText)].join("; "),
        count: r.count,
    }));
}

function download(name: string, body: string, type: string) {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const PAGE = 100;
/** Pages are at least this far apart; Discord's audit log endpoint is rate limited */
const PAGE_GAP = 700;
/** Pages loaded in a row by scrolling while nothing new matches the filters, before asking */
const AUTO_PAGES = 8;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPage(guildId: string, before: string | undefined, actorId: string | undefined, onWait: (seconds: number) => void): Promise<RawLog> {
    const client = http();
    if (!client) throw new Error(t("error.client"));
    const query: Record<string, string | number> = { limit: PAGE };
    if (before) query.before = before;
    if (actorId) query.user_id = actorId;
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await client.get({ url: `/guilds/${guildId}/audit-logs`, query, oldFormErrors: true });
            return (res?.body ?? {}) as RawLog;
        } catch (err: any) {
            const retry = Number(err?.body?.retry_after ?? err?.retryAfter);
            if (err?.status === 429 && attempt < 3 && retry > 0 && retry < 60) {
                onWait(Math.ceil(retry));
                await sleep(retry * 1000 + 250);
                continue;
            }
            throw new Error(err?.body?.message ?? err?.message ?? String(err?.status ?? err));
        }
    }
}

const Icon = ({ d, size = 16 }: { d: string; size?: number; }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);
const ICON_CLOSE = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";
const ICON_CHEVRON = "M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z";
const ICON_SEARCH = "M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z";
const ICON_DOWNLOAD = "M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1ZM3 20a1 1 0 1 0 0 2h18a1 1 0 1 0 0-2H3Z";

function Tip({ text, children }: { text: string; children: React.ReactElement; }) {
    const Tooltip = Components.Tooltip;
    return Tooltip ? <Tooltip text={text} position="top">{children}</Tooltip> : children;
}

function TargetChip({ target, guildId, onNavigate }: { target: Target; guildId: string; onNavigate(): void; }) {
    if (!target.name) return null;
    const color = target.color ? hexColor(target.color) : undefined;
    const prefix = target.type === "channel" || target.type === "thread" ? "#" : target.type === "role" ? "@" : "";
    let action: (() => void) | undefined;
    let tip = target.id ? t("target.copyId") : "";
    if (target.id && (target.type === "channel" || target.type === "thread")) {
        action = () => {
            openChannel(guildId, target.id!);
            onNavigate();
        };
        tip = t("target.openChannel");
    } else if (target.id && target.type === "user") {
        action = () => openProfile(target.id!, guildId);
        tip = t("target.openProfile");
    } else if (target.id) action = () => copy(target.id!);
    const chip = (
        <button type="button" className="evi-alp-chip" data-type={target.type} disabled={!action} onClick={action} style={color ? { ["--alp-role" as any]: color } : undefined}>
            {color && <span className="evi-alp-dot" aria-hidden="true" />}
            {prefix}{target.name}
        </button>
    );
    return action ? <Tip text={tip}>{chip}</Tip> : chip;
}

function ChangeLine({ c }: { c: ChangeView; }) {
    const k = keyLabel(c.key);
    const none = <span className="evi-alp-none">{t("value.none")}</span>;
    const arrow = <span className="evi-alp-arrow" aria-label={t("change.to")}>→</span>;
    switch (c.type) {
        case "perms":
            return (
                <div className="evi-alp-change">
                    <span className="evi-alp-key">{k}</span>
                    <span className="evi-alp-perms">
                        {c.added.map(p => <span key={`+${p}`} className="evi-alp-perm" data-sign="+">+ {humanize(p)}</span>)}
                        {c.removed.map(p => <span key={`-${p}`} className="evi-alp-perm" data-sign="-">− {humanize(p)}</span>)}
                        {!c.added.length && !c.removed.length && none}
                    </span>
                </div>
            );
        case "roles":
            return (
                <div className="evi-alp-change">
                    <span className="evi-alp-key">{c.added ? t("change.rolesAdded") : t("change.rolesRemoved")}</span>
                    <span className="evi-alp-perms">{c.roles.map(r => <span key={r.id} className="evi-alp-perm" data-sign={c.added ? "+" : "-"}>@{r.name}</span>)}</span>
                </div>
            );
        case "color": {
            const sw = (v?: string) => v ? <span className="evi-alp-swatch"><span style={{ background: v }} aria-hidden="true" />{v.slice(1).toUpperCase()}</span> : none;
            return <div className="evi-alp-change"><span className="evi-alp-key">{k}</span><span>{sw(c.old)}{arrow}{sw(c.new)}</span></div>;
        }
        default: {
            const plain = changeText(c).slice(k.length + 2);
            const [before, after] = plain.split(" → ");
            return (
                <div className="evi-alp-change">
                    <span className="evi-alp-key">{k}</span>
                    <span className="evi-alp-values"><span className="evi-alp-old">{before}</span>{arrow}<span className="evi-alp-new">{after}</span></span>
                </div>
            );
        }
    }
}

function EntryRowView({ row, guildId, onNavigate }: { row: Row; guildId: string; onNavigate(): void; }) {
    const [open, setOpen] = React.useState(false);
    const hasDetails = row.changes.length > 0 || row.options.length > 0;
    const actor = row.actor;
    return (
        <li className="evi-alp-row" data-open={open || undefined}>
            <img className="evi-alp-avatar" src={avatarUrl(actor)} alt="" loading="lazy" draggable={false} />
            <div className="evi-alp-main">
                <div className="evi-alp-line">
                    {actor
                        ? <button type="button" className="evi-alp-actor" onClick={() => !actor.webhook && openProfile(actor.id, guildId)}>{actor.name}</button>
                        : <span className="evi-alp-actor">{t("actor.system")}</span>}
                    {actor?.bot && <span className="evi-alp-tag">{t("tag.app")}</span>}
                    {actor?.webhook && <span className="evi-alp-tag">{t("tag.webhook")}</span>}
                    <span className="evi-alp-label" data-group={row.info.group}>{row.label}</span>
                    <TargetChip target={row.target} guildId={guildId} onNavigate={onNavigate} />
                    {row.count > 1 && <span className="evi-alp-count">{t("row.times", { count: row.count })}</span>}
                </div>
                <div className="evi-alp-meta">
                    <Tip text={exactTime(row.time)}><span className="evi-alp-time">{relativeTime(row.time)}</span></Tip>
                    {row.options.map((o, i) => <span key={i} className="evi-alp-option">{o}</span>)}
                </div>
                {row.entry.reason && <div className="evi-alp-reason"><span>{t("row.reason")}</span> {row.entry.reason}</div>}
                {hasDetails && open && (
                    <div className="evi-alp-changes">
                        {row.changes.map((c, i) => <ChangeLine key={`${c.key}-${i}`} c={c} />)}
                        {!row.changes.length && <span className="evi-alp-none">{t("row.noChanges")}</span>}
                    </div>
                )}
            </div>
            {row.changes.length > 0 && (
                <button type="button" className="evi-alp-expand" aria-expanded={open} aria-label={open ? t("row.hide") : t("row.show")} onClick={() => setOpen(o => !o)}>
                    <span>{t("row.changes", { count: row.changes.length })}</span>
                    <Icon d={ICON_CHEVRON} size={14} />
                </button>
            )}
        </li>
    );
}

/**
 * Memoized: typing in the search or loading another page only renders the rows that changed. Made on
 * first render: React isn't there yet when the plugin's code first runs
 */
let memoRow: React.ComponentType<Parameters<typeof EntryRowView>[0]> | undefined;
const EntryRow = (props: Parameters<typeof EntryRowView>[0]) => React.createElement(memoRow ??= React.memo(EntryRowView), props);

const dayStart = (v: string) => v ? new Date(`${v}T00:00:00`).getTime() : undefined;
const dayEnd = (v: string) => v ? new Date(`${v}T23:59:59.999`).getTime() : undefined;

function AuditLog({ guild, onClose }: { guild: { id: string; name: string; }; onClose(): void; }) {
    useLocale();
    const [raw, setRaw] = React.useState<RawEntry[]>([]);
    const dir = React.useRef(new Directory(lookup(guild.id)));
    const [loading, setLoading] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [waiting, setWaiting] = React.useState<number>();
    const [query, setQuery] = React.useState("");
    const [actorId, setActorId] = React.useState("");
    const [groups, setGroups] = React.useState<Set<Group>>(new Set());
    const [from, setFrom] = React.useState("");
    const [to, setTo] = React.useState("");
    const [grouped, setGrouped] = React.useState(true);
    const [actors, setActors] = React.useState<Person[]>([]);
    const [stalled, setStalled] = React.useState(false);
    const busy = React.useRef(false);
    const lastFetch = React.useRef(0);
    const emptyPages = React.useRef(0);
    const generation = React.useRef(0);
    const sentinel = React.useRef<HTMLLIElement>(null);
    const list = React.useRef<HTMLUListElement>(null);

    // Escape closes; Discord's own Escape handling stays out of it
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, []);

    const rows = React.useMemo(() => raw.map(e => toRow(e, dir.current, guild.id)), [raw, I18n.discordLocale]);
    const filters: Filters = { actorId: actorId || undefined, groups, from: dayStart(from), to: dayEnd(to), query };
    const shown = React.useMemo(() => {
        const hits = rows.filter(r => matches(r, filters));
        return grouped ? groupRuns(hits) : hits;
    }, [rows, actorId, groups, from, to, query, grouped]);

    const oldest = raw.length ? raw[raw.length - 1] : undefined;
    // Past the "from" date nothing older can match: no need to load further
    const pastFrom = !!(oldest && filters.from && rows[rows.length - 1]?.time < filters.from);

    const load = React.useCallback(async (reset = false) => {
        if (busy.current) return;
        busy.current = true;
        const gen = reset ? ++generation.current : generation.current;
        setLoading(true);
        setError(undefined);
        try {
            const gap = PAGE_GAP - (Date.now() - lastFetch.current);
            if (gap > 0) await sleep(gap);
            lastFetch.current = Date.now();
            const before = reset ? undefined : raw[raw.length - 1]?.id;
            const page = await fetchPage(guild.id, before, actorId || undefined, s => setWaiting(s));
            if (gen !== generation.current) return;
            setWaiting(undefined);
            dir.current.add(page);
            const entries = (page.audit_log_entries ?? []).filter(e => e?.id);
            setRaw(prev => {
                const base = reset ? [] : prev;
                const seen = new Set(base.map(e => e.id));
                return [...base, ...entries.filter(e => !seen.has(e.id))];
            });
            setActors(prev => {
                const map = new Map(prev.map(p => [p.id, p]));
                for (const e of entries) {
                    const p = e.user_id ? dir.current.person(e.user_id) : undefined;
                    if (p) map.set(p.id, p);
                }
                return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
            });
            setDone(entries.length < PAGE);
        } catch (err: any) {
            if (gen === generation.current) setError(String(err?.message ?? err));
        } finally {
            // A load from before the person filter changed: busy is the newer load's now
            if (gen === generation.current) {
                busy.current = false;
                setLoading(false);
            }
        }
    }, [raw, guild.id, actorId]);

    // First page, and again from the top when the person filter changes: Discord filters by person
    // itself, so their whole history is reachable instead of only what's loaded
    React.useEffect(() => {
        setRaw([]);
        setDone(false);
        setStalled(false);
        emptyPages.current = 0;
        busy.current = false;
        void load(true);
    }, [actorId]);

    // More while the end of the list is in view, unless pages keep bringing nothing that matches
    const shownCount = shown.length;
    const previousShown = React.useRef(0);
    React.useEffect(() => {
        if (shownCount > previousShown.current) {
            emptyPages.current = 0;
            setStalled(false);
        }
        previousShown.current = shownCount;
    }, [shownCount]);

    React.useEffect(() => {
        const el = sentinel.current;
        if (!el || done || pastFrom || stalled || error) return;
        const io = new IntersectionObserver(([e]) => {
            if (!e.isIntersecting || busy.current) return;
            if (++emptyPages.current > AUTO_PAGES) {
                setStalled(true);
                return;
            }
            void load();
        }, { root: list.current, rootMargin: "400px" });
        io.observe(el);
        return () => io.disconnect();
    }, [load, done, pastFrom, stalled, error, raw.length]);

    const toggleGroup = (g: Group) => setGroups(prev => {
        const next = new Set(prev);
        next.has(g) ? next.delete(g) : next.add(g);
        return next;
    });
    const filtered = !!(query || actorId || groups.size || from || to);
    const clear = () => {
        setQuery("");
        setActorId("");
        setGroups(new Set());
        setFrom("");
        setTo("");
    };

    const exportAs = (ext: "csv" | "json") => {
        const data = exportRows(shown);
        const body = ext === "csv" ? toCsv(data) : JSON.stringify({ server: { id: guild.id, name: guild.name }, exportedAt: new Date().toISOString(), entries: data }, null, 2);
        download(exportName(guild.name, ext), body, ext === "csv" ? "text/csv;charset=utf-8" : "application/json");
        context?.toast(t("toast.exported", { count: data.length }), { type: "success" });
    };

    return (
        <div className="evi-alp-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="evi-alp-modal evi-modal" role="dialog" aria-modal="true" aria-labelledby="evi-alp-title">
                <header className="evi-alp-head">
                    <div className="evi-alp-titles">
                        <h2 id="evi-alp-title">{t("dialog.title")}</h2>
                        <span>{guild.name}</span>
                    </div>
                    <button type="button" className="evi-alp-close" aria-label={t("dialog.close")} onClick={onClose}><Icon d={ICON_CLOSE} size={20} /></button>
                </header>

                <div className="evi-alp-filters">
                    <div className="evi-alp-toolbar">
                        <label className="evi-alp-search">
                            <Icon d={ICON_SEARCH} />
                            <input type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder={t("filter.search")} aria-label={t("filter.search")} autoFocus />
                        </label>
                        <Dropdown
                            className="evi-alp-select"
                            label={t("filter.actor")}
                            value={actorId}
                            onChange={setActorId}
                            options={[
                                { value: "", label: t("filter.anyone") },
                                ...actorId && !actors.some(a => a.id === actorId) ? [{ value: actorId, label: dir.current.person(actorId)?.name ?? actorId }] : [],
                                ...actors.map(a => ({ value: a.id, label: a.name })),
                            ]}
                        />
                        <label className="evi-alp-date">
                            <span>{t("filter.from")}</span>
                            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.currentTarget.value)} />
                        </label>
                        <label className="evi-alp-date">
                            <span>{t("filter.to")}</span>
                            <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.currentTarget.value)} />
                        </label>
                    </div>
                    <div className="evi-alp-groups" role="group" aria-label={t("filter.groups")}>
                        {GROUPS.map(g => (
                            <button key={g} type="button" className="evi-alp-group" data-group={g} aria-pressed={groups.has(g)} onClick={() => toggleGroup(g)}>{t(`group.${g}`)}</button>
                        ))}
                        {filtered && <button type="button" className="evi-alp-clear" onClick={clear}>{t("filter.clear")}</button>}
                    </div>
                </div>

                <ul className="evi-alp-list" ref={list} aria-busy={loading}>
                    {shown.map(r => <EntryRow key={r.entry.id} row={r} guildId={guild.id} onNavigate={onClose} />)}
                    <li ref={sentinel} className="evi-alp-sentinel" aria-hidden="true" />
                    <li className="evi-alp-state" aria-live="polite">
                        {error
                            ? <><span className="evi-alp-error">{t("state.error", { error })}</span><button type="button" className="evi-alp-button" onClick={() => void load(!raw.length)}>{t("state.retry")}</button></>
                            : waiting
                                ? <span>{t("state.waiting", { seconds: waiting })}</span>
                                : loading
                                    ? <span className="evi-alp-loading">{t("state.loading")}</span>
                                    : stalled && !done && !pastFrom
                                        ? <><span>{t("state.stalled")}</span><button type="button" className="evi-alp-button" onClick={() => { emptyPages.current = 0; setStalled(false); void load(); }}>{t("state.more")}</button></>
                                        : (done || pastFrom) && !shown.length
                                            ? <span>{filtered ? t("state.noMatch") : t("state.empty")}</span>
                                            : done || pastFrom ? <span className="evi-alp-end">{t("state.end")}</span> : null}
                    </li>
                </ul>

                <footer className="evi-alp-foot">
                    <span className="evi-alp-total">{t("foot.shown", { shown: shown.length, loaded: raw.length })}</span>
                    <label className="evi-alp-toggle">
                        <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.currentTarget.checked)} />
                        <span>{t("foot.group")}</span>
                    </label>
                    <button type="button" className="evi-alp-button" disabled={!shown.length} onClick={() => exportAs("csv")}><Icon d={ICON_DOWNLOAD} />CSV</button>
                    <button type="button" className="evi-alp-button" disabled={!shown.length} onClick={() => exportAs("json")}><Icon d={ICON_DOWNLOAD} />JSON</button>
                </footer>
            </div>
        </div>
    );
}

let closeOpen: CloseLayer | undefined;

function openAuditLog(guild: { id: string; name: string; }) {
    closeOpen?.({ instant: true });
    const close = openLayer(close => <AuditLog guild={guild} onClose={() => close()} />, {
        onClosed: () => void (closeOpen === close && (closeOpen = undefined)),
    });
    closeOpen = close;
}

export default definePlugin({
    start(ctx) {
        context = ctx;
        ctx.onDispose(() => {
            closeOpen?.({ instant: true });
            context = undefined;
        });

        ctx.contextMenu("guild-context", (children, props) => {
            const guild = props.guild;
            if (!guild?.id || !canViewAuditLog(guild)) return;
            children.push(
                <Menu.Group key="evi-alp-group">
                    <Menu.Item id="evi-alp-open" label={t("menu.open")} action={() => openAuditLog({ id: guild.id, name: guild.name ?? guild.id })} />
                </Menu.Group>,
            );
        });
    },

    stop() {
        closeOpen?.({ instant: true });
    },

    css: `
.evi-alp-scrim { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 32px; background: var(--opacity-black-70, rgb(0 0 0 / 0.7)); }
.evi-alp-modal {
    display: flex; flex-direction: column;
    inline-size: min(980px, 100%); block-size: min(860px, 100%);
    border-radius: 12px; overflow: hidden;
    background: var(--modal-background, var(--background-base-low, #2b2d31));
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.06));
    box-shadow: var(--shadow-high, 0 12px 32px rgb(0 0 0 / 0.4));
    color: var(--text-default, var(--text-normal, #dbdee1));
}
.evi-alp-head { display: flex; align-items: flex-start; gap: 12px; padding: 20px 20px 12px; }
.evi-alp-titles { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 2px; }
.evi-alp-titles h2 { margin: 0; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-alp-titles span { font-size: 14px; color: var(--text-muted, #949ba4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-alp-close { display: grid; place-items: center; inline-size: 32px; block-size: 32px; border: 0; border-radius: 8px; background: none; color: var(--interactive-normal, #b5bac1); cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.evi-alp-close:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }

.evi-alp-filters { display: flex; flex-direction: column; gap: 10px; padding: 0 20px 12px; border-block-end: 1px solid var(--border-subtle, rgb(255 255 255 / 0.06)); }
.evi-alp-toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
.evi-alp-search { flex: 1 1 240px; display: flex; align-items: center; gap: 8px; padding: 0 10px; min-block-size: 36px; border-radius: 8px; background: var(--input-background, var(--background-base-lowest, #1e1f22)); color: var(--text-muted, #949ba4); border: 1px solid var(--input-border, transparent); }
.evi-alp-search:focus-within { border-color: var(--text-link, #00a8fc); }
.evi-alp-search input { flex: 1; min-inline-size: 0; border: 0; outline: 0; background: none; color: var(--text-default, #dbdee1); font: inherit; font-size: 14px; }
.evi-alp-select, .evi-alp-date input {
    min-block-size: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--input-border, transparent);
    background: var(--input-background, var(--background-base-lowest, #1e1f22)); color: var(--text-default, #dbdee1); font: inherit; font-size: 14px; color-scheme: dark;
}
.evi-alp-select { inline-size: 220px; max-inline-size: 220px; flex: none; cursor: pointer; }
.evi-alp-date { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; color: var(--text-muted, #949ba4); }
.evi-alp-groups { display: flex; flex-wrap: wrap; gap: 6px; }
.evi-alp-group, .evi-alp-clear {
    min-block-size: 28px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.08));
    background: none; color: var(--text-muted, #b5bac1); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: background-color 0.15s, color 0.15s, border-color 0.15s;
}
.evi-alp-group:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }
.evi-alp-group[aria-pressed="true"] { background: var(--brand-500, #5865f2); border-color: transparent; color: #fff; }
.evi-alp-clear { border-style: dashed; }

.evi-alp-list { flex: 1; min-block-size: 0; margin: 0; padding: 8px 12px; list-style: none; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; }
.evi-alp-list::-webkit-scrollbar { display: none; }
.evi-alp-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 8px; border-radius: 8px; transition: background-color 0.15s; }
.evi-alp-row:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.03)); }
.evi-alp-avatar { flex: none; inline-size: 32px; block-size: 32px; border-radius: 50%; background: var(--background-base-lowest, #1e1f22); }
.evi-alp-main { flex: 1; min-inline-size: 0; display: flex; flex-direction: column; gap: 4px; }
.evi-alp-line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 15px; line-height: 20px; }
.evi-alp-actor { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); cursor: pointer; }
.evi-alp-actor:hover { text-decoration: underline; }
span.evi-alp-actor { cursor: default; }
span.evi-alp-actor:hover { text-decoration: none; }
.evi-alp-tag { padding: 0 4px; border-radius: 4px; background: var(--brand-500, #5865f2); color: #fff; font-size: 10px; font-weight: 700; line-height: 15px; text-transform: uppercase; }
.evi-alp-label { color: var(--text-default, #dbdee1); }
.evi-alp-chip {
    display: inline-flex; align-items: center; gap: 4px; max-inline-size: 320px; padding: 0 6px; border: 0; border-radius: 4px;
    background: var(--background-modifier-accent, rgb(255 255 255 / 0.06)); color: var(--text-strong, #f2f3f5);
    font: inherit; font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
    transition: background-color 0.15s;
}
.evi-alp-chip:hover:not(:disabled) { background: var(--background-modifier-selected, rgb(255 255 255 / 0.12)); }
.evi-alp-chip:disabled { cursor: default; }
.evi-alp-chip[data-type="channel"], .evi-alp-chip[data-type="thread"], .evi-alp-chip[data-type="user"] { color: var(--mention-foreground, #c9cdfb); background: var(--mention-background, rgb(88 101 242 / 0.3)); }
.evi-alp-dot { inline-size: 10px; block-size: 10px; border-radius: 50%; background: var(--alp-role); }
.evi-alp-count { padding: 0 6px; border-radius: 999px; background: var(--background-modifier-accent, rgb(255 255 255 / 0.08)); font-size: 12px; font-weight: 600; color: var(--text-muted, #b5bac1); }
.evi-alp-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; line-height: 16px; color: var(--text-muted, #949ba4); }
.evi-alp-time { cursor: default; }
.evi-alp-reason { font-size: 14px; line-height: 18px; color: var(--text-default, #dbdee1); overflow-wrap: anywhere; }
.evi-alp-reason > span { font-weight: 600; color: var(--text-muted, #949ba4); }
.evi-alp-expand {
    flex: none; display: inline-flex; align-items: center; gap: 4px; min-block-size: 28px; padding: 0 8px; border: 0; border-radius: 6px;
    background: none; color: var(--interactive-normal, #b5bac1); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-alp-expand:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }
.evi-alp-expand svg { transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1); }
.evi-alp-expand[aria-expanded="true"] svg { transform: rotate(90deg); }
.evi-alp-changes {
    display: flex; flex-direction: column; gap: 6px; margin-block-start: 4px; padding: 10px 12px; border-radius: 8px;
    background: var(--background-base-lowest, rgb(0 0 0 / 0.2)); font-size: 13px; line-height: 18px;
    animation: evi-alp-in 0.2s cubic-bezier(0.2, 0, 0, 1);
}
@keyframes evi-alp-in { from { opacity: 0; transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) { .evi-alp-changes { animation: none; } .evi-alp-expand svg { transition: none; } }
.evi-alp-change { display: grid; grid-template-columns: minmax(110px, 180px) 1fr; gap: 12px; align-items: baseline; }
.evi-alp-key { font-weight: 600; color: var(--text-muted, #949ba4); }
.evi-alp-values { overflow-wrap: anywhere; }
.evi-alp-old { color: var(--text-muted, #949ba4); text-decoration: line-through; text-decoration-color: rgb(242 63 67 / 0.6); }
.evi-alp-new { color: var(--text-strong, #f2f3f5); }
.evi-alp-arrow { margin-inline: 6px; color: var(--text-muted, #949ba4); }
.evi-alp-none { color: var(--text-muted, #949ba4); font-style: italic; }
.evi-alp-perms { display: flex; flex-wrap: wrap; gap: 4px; }
.evi-alp-perm { padding: 0 6px; border-radius: 4px; font-size: 12px; font-weight: 500; line-height: 18px; }
.evi-alp-perm[data-sign="+"] { background: rgb(35 165 90 / 0.18); color: var(--text-feedback-positive, #2dc770); }
.evi-alp-perm[data-sign="-"] { background: rgb(242 63 67 / 0.16); color: var(--text-feedback-critical, #f57976); }
.evi-alp-swatch { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-code, monospace); font-size: 12px; }
.evi-alp-swatch > span { inline-size: 14px; block-size: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15); }

.evi-alp-sentinel { block-size: 1px; }
.evi-alp-state { display: flex; align-items: center; justify-content: center; gap: 12px; min-block-size: 56px; padding: 8px; font-size: 14px; color: var(--text-muted, #949ba4); text-align: center; }
.evi-alp-error { color: var(--text-feedback-critical, #f23f43); }
.evi-alp-loading { animation: evi-alp-pulse 1.2s ease-in-out infinite; }
@keyframes evi-alp-pulse { 50% { opacity: 0.5; } }

.evi-alp-foot { display: flex; align-items: center; gap: 8px; padding: 12px 20px; border-block-start: 1px solid var(--border-subtle, rgb(255 255 255 / 0.06)); }
.evi-alp-total { flex: 1; font-size: 13px; color: var(--text-muted, #949ba4); }
.evi-alp-toggle { display: inline-flex; align-items: center; gap: 6px; margin-inline-end: 8px; font-size: 13px; color: var(--text-default, #dbdee1); cursor: pointer; }
.evi-alp-toggle input { accent-color: var(--brand-500, #5865f2); }
.evi-alp-button {
    display: inline-flex; align-items: center; gap: 6px; min-block-size: 32px; padding: 0 12px; border: 0; border-radius: 8px;
    background: var(--button-secondary-background, rgb(255 255 255 / 0.08)); color: var(--text-default, #dbdee1);
    font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.15s, opacity 0.15s;
}
.evi-alp-button:hover:not(:disabled) { background: var(--button-secondary-background-hover, rgb(255 255 255 / 0.12)); }
.evi-alp-button:disabled { opacity: 0.5; cursor: default; }
`,
});
