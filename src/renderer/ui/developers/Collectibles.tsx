/**
 * The Developers page's Collectibles tab: what Evi's collectibles cost in Sparks, the codes that hand
 * out Sparks and items, someone's wallet (adjust their Sparks, grant or take back parts, read their
 * history), and the Sparks supporters get each month per level. Every call goes through main's
 * admin bridge (shared/devAdmin.ts); answers are read by shared/collectiblesAdmin.ts.
 */
import { CollectibleKind, KINDS, PriceKey } from "@shared/collectibles";
import {
    AdminCode, AdminWallet, AllowanceLevel, codeBody, CodeForm, CodeItem, parseAdminWallet, parseAllowance, parseCode, parseCodes, parseDelta,
    parsePriceList, PricedBundle, pricesBody,
} from "@shared/collectiblesAdmin";
import { AdminUser, parsePeople } from "@shared/devAdmin";
import { generateCode, typedCode } from "@shared/sparks";
import { SUPPORTER_TIERS } from "@shared/supporter";

import { Collectibles } from "../../collectibles";
import { I18n, t, timeAgo } from "../../i18n";
import { showToast } from "../../toolkit/toasts";
import { React } from "../../webpack/common";
import { Badge, Button, Dialog, discordAvatarUrl, Dropdown, EmptyState, FilterChips, IconButton, Notice, SearchField, Section, Status, SwitchRow, Text, TextField } from "../components";
import { formatSparks, installShopStyles, KIND_LABEL, PartThumb, SparksAmount } from "../Sparks";
import { LoadError } from "./common";
import { admin, useAdmin } from "./data";

type Panel = "prices" | "codes" | "accounts" | "allowance";

export function CollectiblesAdminTab() {
    installShopStyles();
    const [panel, setPanel] = React.useState<Panel>("prices");
    // The bundles' art, for the pickers and the parts lists
    React.useEffect(() => Collectibles.use(), []);
    return (
        <div className="dl-dev">
            <div className="evi-dev-coll-chips">
                <FilterChips<Panel>
                    label={t("dev.coll.panels")}
                    value={panel}
                    onChange={setPanel}
                    options={[
                        { id: "prices", label: t("dev.coll.prices") },
                        { id: "codes", label: t("dev.coll.codes") },
                        { id: "accounts", label: t("dev.coll.accounts") },
                        { id: "allowance", label: t("dev.coll.allowance") },
                    ]}
                />
            </div>
            {panel === "prices" && <PricesPanel />}
            {panel === "codes" && <CodesPanel />}
            {panel === "accounts" && <AccountsPanel />}
            {panel === "allowance" && <AllowancePanel />}
        </div>
    );
}

const partLabel = (key: PriceKey) => key === "bundle" ? t("dev.coll.wholeBundle") : KIND_LABEL[key]();

/** A field for a whole number of Sparks */
function SparksField({ id, label, value, onChange, placeholder, description }: { id: string; label: string; value: string; onChange(v: string): void; placeholder?: string; description?: string; }) {
    return <TextField id={id} label={label} value={value} onChange={v => onChange(v.replace(/[^\d]/g, "").slice(0, 7))} placeholder={placeholder} inputMode="numeric" description={description} spellCheck={false} />;
}

// ---- prices ----

function PricesPanel() {
    const list = useAdmin("/admin/collectibles/prices", parsePriceList);
    return (
        <Section title={t("dev.coll.prices")} description={t("dev.coll.pricesHint")} id="dl-dev-coll-prices">
            {list.error && <LoadError error={list.error} onRetry={list.reload} />}
            {!list.value && !list.error && <EmptyState icon="clock" title={t("dev.loading")} />}
            {list.value && !list.value.length && <EmptyState icon="collectibles" title={t("dev.coll.noBundles")}>{t("dev.coll.noBundlesBody")}</EmptyState>}
            {!!list.value?.length && (
                <ul className="evi-dev-coll-prices">
                    {list.value.map(b => <li key={b.id}><PriceRow bundle={b} onSaved={list.reload} /></li>)}
                </ul>
            )}
        </Section>
    );
}

function PriceRow({ bundle, onSaved }: { bundle: PricedBundle; onSaved(): void; }) {
    // Its parts, and any part priced ahead of its art (a PUT replaces the whole list, so none is lost)
    const keys: PriceKey[] = ["bundle", ...KINDS.filter(k => bundle.parts.includes(k) || bundle.prices[k] !== undefined)];
    const initial = () => Object.fromEntries(keys.map(k => [k, bundle.prices[k]?.toString() ?? ""])) as Partial<Record<PriceKey, string>>;
    const [fields, setFields] = React.useState(initial);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const art = Collectibles.bundle(bundle.id);
    const changed = keys.some(k => (fields[k] ?? "") !== (bundle.prices[k]?.toString() ?? ""));
    const sum = bundle.parts.every(k => fields[k]) ? bundle.parts.reduce((n, k) => n + Number(fields[k]), 0) : undefined;
    const whole = fields.bundle ? Number(fields.bundle) : undefined;

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        const body = pricesBody(fields, keys);
        if ("error" in body) return setError(t("dev.coll.badPrice", { part: partLabel(body.error as PriceKey) }));
        setBusy(true);
        setError(undefined);
        const res = await admin("PUT", `/admin/collectibles/prices/${bundle.id}`, body);
        setBusy(false);
        if (!res.ok) return setError(res.error);
        showToast(t("dev.coll.pricesSaved", { name: bundle.name }), { type: "success" });
        onSaved();
    };

    return (
        <form className="evi-dev-coll-card" onSubmit={save} aria-labelledby={`dl-dev-price-${bundle.id}`}>
            <div className="evi-dev-coll-card-head">
                {art && <PartThumb bundle={art} kind={bundle.parts.includes("nameplate") ? "nameplate" : bundle.parts[0] ?? "decoration"} size={40} />}
                <span className="evi-dev-coll-card-title">
                    <Text tag="h3" variant="text-md/semibold" color="text-strong" id={`dl-dev-price-${bundle.id}`}>{bundle.name}</Text>
                    <Text tag="span" variant="text-xs/normal" color="text-muted">
                        {[bundle.id, t("dev.coll.owners", { count: bundle.owners }), bundle.tier === "supporter" ? t("community.supportersOnly") : undefined].filter(Boolean).join(" · ")}
                    </Text>
                </span>
            </div>
            <div className="evi-dev-coll-price-fields">
                {keys.map(k => (
                    <SparksField
                        key={k}
                        id={`dl-dev-price-${bundle.id}-${k}`}
                        label={partLabel(k)}
                        value={fields[k] ?? ""}
                        placeholder={t("dev.coll.notSold")}
                        onChange={v => setFields(f => ({ ...f, [k]: v }))}
                    />
                ))}
            </div>
            <Text tag="p" variant="text-xs/normal" color="text-muted" className="dl-tabular">
                {sum !== undefined && whole !== undefined
                    ? whole < sum ? t("dev.coll.bundleSaves", { sum: formatSparks(sum), save: formatSparks(sum - whole) }) : t("dev.coll.bundleNotCheaper", { sum: formatSparks(sum) })
                    : t("dev.coll.blankHint")}
            </Text>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="dl-toolbar">
                <Button type="submit" variant="accent" disabled={busy || !changed}>{t("dev.coll.savePrices")}</Button>
                {changed && <Button onClick={() => { setFields(initial()); setError(undefined); }}>{t("dev.coll.reset")}</Button>}
            </div>
        </form>
    );
}

// ---- codes ----

const CODE_STATE: Record<AdminCode["state"], () => string> = {
    active: () => t("dev.coll.code.active"),
    disabled: () => t("dev.coll.code.disabled"),
    expired: () => t("dev.coll.code.expired"),
    used_up: () => t("dev.coll.code.usedUp"),
};

/** "500 Sparks · Sakura River (all) · Neon Rain nameplate" */
function givesText(code: { sparks: number; items: CodeItem[]; }) {
    const parts: string[] = [];
    if (code.sparks) parts.push(t("sparks.amount", { count: code.sparks, amount: formatSparks(code.sparks) }));
    for (const item of code.items) {
        const name = Collectibles.bundle(item.bundle)?.name ?? item.bundle;
        parts.push(item.kinds?.length ? `${name}: ${item.kinds.map(k => KIND_LABEL[k]()).join(", ")}` : t("dev.coll.wholeOf", { name }));
    }
    return parts.join(" · ");
}

const copy = (code: string) => void navigator.clipboard.writeText(code).then(
    () => showToast(t("dev.coll.copied", { code }), { type: "success" }),
    () => showToast(t("dev.coll.copyFailed"), { type: "failure" }),
);

function CodesPanel() {
    const codes = useAdmin("/admin/collectibles/codes", parseCodes);
    const [creating, setCreating] = React.useState(false);
    const [busy, setBusy] = React.useState<string>();

    const toggle = async (code: AdminCode) => {
        setBusy(code.code);
        const res = await admin("PATCH", `/admin/collectibles/codes/${code.code}`, { disabled: !code.disabled });
        setBusy(undefined);
        if (!res.ok) showToast(t("dev.error", { error: res.error }), { type: "failure" });
        codes.reload();
    };

    return (
        <Section
            title={t("dev.coll.codes")}
            description={t("dev.coll.codesHint")}
            id="dl-dev-coll-codes"
            action={<Button variant="accent" icon="link" onClick={() => setCreating(true)}>{t("dev.coll.newCode")}</Button>}
        >
            {codes.error && <LoadError error={codes.error} onRetry={codes.reload} />}
            {!codes.value && !codes.error && <EmptyState icon="clock" title={t("dev.loading")} />}
            {codes.value && !codes.value.length && (
                <EmptyState icon="link" title={t("dev.coll.noCodes")} action={<Button onClick={() => setCreating(true)}>{t("dev.coll.newCode")}</Button>}>{t("dev.coll.noCodesBody")}</EmptyState>
            )}
            {!!codes.value?.length && (
                <ul className="dl-list" aria-busy={codes.loading}>
                    {codes.value.map(code => (
                        <li key={code.code} className="dl-row evi-dev-coll-code">
                            <div className="evi-dev-coll-code-text">
                                <span className="evi-dev-coll-code-line">
                                    <code className="dl-dev-mono evi-dev-coll-code-value">{code.code}</code>
                                    <Badge tone={code.state === "active" ? undefined : "warning"}>{CODE_STATE[code.state]()}</Badge>
                                </span>
                                <Text tag="span" variant="text-sm/medium" color="text-strong">{givesText(code)}</Text>
                                <Text tag="span" variant="text-xs/normal" color="text-muted" className="dl-tabular">
                                    {[
                                        code.maxUses ? t("dev.coll.usesOf", { uses: formatSparks(code.uses), max: formatSparks(code.maxUses) }) : t("dev.coll.uses", { count: code.uses }),
                                        code.perUserOnce ? t("dev.coll.oncePerPerson") : undefined,
                                        code.expiresAt ? t("dev.coll.expires", { date: new Date(code.expiresAt).toLocaleDateString(I18n.discordLocale) }) : undefined,
                                        code.createdAt ? timeAgo(code.createdAt) : undefined,
                                        code.note || undefined,
                                    ].filter(Boolean).join(" · ")}
                                </Text>
                            </div>
                            <div className="dl-toolbar">
                                <IconButton icon="copy" label={t("dev.coll.copy", { code: code.code })} onClick={() => copy(code.code)} />
                                {code.state !== "expired" && (
                                    <Button size="sm" disabled={busy === code.code} onClick={() => void toggle(code)}>{code.disabled ? t("dev.coll.enable") : t("dev.coll.disable")}</Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            {creating && <NewCodeDialog onClose={() => setCreating(false)} onCreated={codes.reload} />}
        </Section>
    );
}

/** Picks bundles and parts: for a code's items */
function ItemPicker({ items, onChange }: { items: CodeItem[]; onChange(items: CodeItem[]): void; }) {
    const bundles = Collectibles.bundles();
    const [bundle, setBundle] = React.useState(bundles[0]?.id ?? "");
    const [kinds, setKinds] = React.useState<CollectibleKind[]>([]);
    const b = Collectibles.bundle(bundle);
    const parts = b ? KINDS.filter(k => b[k]) : [];

    const add = () => {
        if (!b) return;
        const item: CodeItem = kinds.length && kinds.length < parts.length ? { bundle, kinds: [...kinds] } : { bundle };
        onChange([...items.filter(i => i.bundle !== bundle), item]);
        setKinds([]);
    };

    if (!bundles.length) return <Text tag="p" variant="text-sm/normal" color="text-muted">{t("dev.coll.noBundlesBody")}</Text>;
    return (
        <fieldset className="evi-dev-coll-picker">
            <legend className="dl-label">{t("dev.coll.items")}</legend>
            <div className="evi-dev-coll-picker-row">
                <Dropdown id="dl-dev-code-bundle" label={t("dev.coll.bundle")} value={bundle} onChange={v => { setBundle(v); setKinds([]); }} options={bundles.map(x => ({ value: x.id, label: x.name }))} />
                <div className="evi-dev-coll-checks" role="group" aria-label={t("dev.coll.parts")}>
                    {parts.map(k => (
                        <label key={k} className="evi-dev-check">
                            <input type="checkbox" checked={kinds.includes(k)} onChange={e => setKinds(e.currentTarget.checked ? [...kinds, k] : kinds.filter(x => x !== k))} />
                            {KIND_LABEL[k]()}
                        </label>
                    ))}
                </div>
                <Button onClick={add}>{kinds.length && kinds.length < parts.length ? t("dev.coll.addParts") : t("dev.coll.addBundle")}</Button>
            </div>
            {items.length > 0 && (
                <ul className="evi-dev-coll-items">
                    {items.map(item => (
                        <li key={item.bundle}>
                            <Text tag="span" variant="text-sm/medium" color="text-strong">{givesText({ sparks: 0, items: [item] })}</Text>
                            <IconButton icon="close" label={t("dev.coll.remove", { name: Collectibles.bundle(item.bundle)?.name ?? item.bundle })} onClick={() => onChange(items.filter(i => i !== item))} />
                        </li>
                    ))}
                </ul>
            )}
        </fieldset>
    );
}

function NewCodeDialog({ onClose, onCreated }: { onClose(): void; onCreated(): void; }) {
    const [form, setForm] = React.useState<CodeForm>({ code: "", sparks: "", items: [], maxUses: "", perUserOnce: true, expires: "", note: "" });
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [created, setCreated] = React.useState<AdminCode>();
    const set = <K extends keyof CodeForm>(key: K, value: CodeForm[K]) => setForm(f => ({ ...f, [key]: value }));

    const ERRORS = {
        code: () => t("dev.coll.badCode"),
        sparks: () => t("dev.coll.badSparks"),
        maxUses: () => t("dev.coll.badUses"),
        expires: () => t("dev.coll.badExpiry"),
        empty: () => t("dev.coll.emptyCode"),
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        const body = codeBody(form);
        if ("error" in body) return setError(ERRORS[body.error as keyof typeof ERRORS]());
        setBusy(true);
        setError(undefined);
        const res = await admin("POST", "/admin/collectibles/codes", body);
        setBusy(false);
        if (!res.ok) return setError(res.error);
        const code = parseCode((res.value as any)?.code);
        onCreated();
        if (code) setCreated(code);
    };

    return (
        <Dialog id="dl-dev-new-code" title={created ? t("dev.coll.codeCreated") : t("dev.coll.newCode")} onClose={onClose}>
            {close => created ? (
                <div className="dl-stack-loose">
                    <div className="evi-dev-coll-created">
                        <code className="dl-dev-mono evi-dev-coll-code-value" aria-label={created.code}>{created.code}</code>
                        <Button variant="accent" icon="copy" onClick={() => copy(created.code)}>{t("dev.coll.copyCode")}</Button>
                    </div>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{givesText(created)}</Text>
                    <div className="dl-toolbar"><Button onClick={close}>{t("dev.coll.done")}</Button></div>
                </div>
            ) : (
                <form className="dl-stack-loose" onSubmit={submit} noValidate>
                    <div className="evi-dev-coll-code-row">
                        <TextField id="dl-dev-code-code" label={t("dev.coll.code")} description={t("dev.coll.codeHint")} value={form.code} onChange={v => set("code", typedCode(v))} placeholder="EVI-XXXX-XXXX" spellCheck={false} />
                        <Button onClick={() => set("code", generateCode())}>{t("dev.coll.generate")}</Button>
                    </div>
                    <SparksField id="dl-dev-code-sparks" label={t("dev.coll.sparks")} value={form.sparks} onChange={v => set("sparks", v)} placeholder="0" />
                    <ItemPicker items={form.items} onChange={items => set("items", items)} />
                    <SparksField id="dl-dev-code-uses" label={t("dev.coll.maxUses")} description={t("dev.coll.maxUsesHint")} value={form.maxUses} onChange={v => set("maxUses", v)} placeholder={t("dev.coll.unlimited")} />
                    <SwitchRow id="dl-dev-code-once" label={t("dev.coll.oncePerPerson")} description={t("dev.coll.oncePerPersonHint")} checked={form.perUserOnce} onChange={v => set("perUserOnce", v)} />
                    <div className="dl-field">
                        <label className="dl-label" htmlFor="dl-dev-code-expires">{t("dev.coll.expiry")}</label>
                        <p className="dl-hint" id="dl-dev-code-expires-hint">{t("dev.coll.expiryHint")}</p>
                        <input id="dl-dev-code-expires" className="dl-input" type="date" aria-describedby="dl-dev-code-expires-hint" value={form.expires} onChange={e => set("expires", e.currentTarget.value)} />
                    </div>
                    <TextField id="dl-dev-code-note" label={t("dev.coll.note")} description={t("dev.coll.noteHint")} value={form.note} onChange={v => set("note", v.slice(0, 200))} />
                    {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
                    <div className="dl-toolbar">
                        <Button type="submit" variant="accent" disabled={busy}>{t("dev.coll.createCode")}</Button>
                        <Button onClick={close}>{t("common.cancel")}</Button>
                    </div>
                </form>
            )}
        </Dialog>
    );
}

// ---- accounts ----

function AccountsPanel() {
    const [query, setQuery] = React.useState("");
    const [debounced, setDebounced] = React.useState("");
    const [picked, setPicked] = React.useState<AdminUser>();
    React.useEffect(() => {
        const timer = setTimeout(() => setDebounced(query.trim()), 250);
        return () => clearTimeout(timer);
    }, [query]);
    const people = useAdmin(debounced ? `/admin/people?page=1&size=8&q=${encodeURIComponent(debounced)}` : undefined, parsePeople);

    return (
        <Section title={t("dev.coll.accounts")} description={t("dev.coll.accountsHint")} id="dl-dev-coll-accounts">
            <div className="dl-dev-search"><SearchField id="dl-dev-coll-search" label={t("dev.searchPeople")} placeholder={t("dev.searchPeople")} value={query} onChange={setQuery} /></div>
            {people.error && <LoadError error={people.error} onRetry={people.reload} />}
            {debounced && people.value && !people.value.people.length && <EmptyState icon="search" title={t("dev.noMatch")}>{t("dev.noPeopleBody")}</EmptyState>}
            {debounced && !!people.value?.people.length && (
                <ul className="dl-list" aria-busy={people.loading} aria-label={t("dev.coll.results")}>
                    {people.value.people.map(p => (
                        <li key={p.user.id} className="dl-row dl-dev-person-row">
                            <button type="button" className="dl-dev-person" aria-pressed={picked?.id === p.user.id} onClick={() => setPicked(p.user)}>
                                <img className="dl-dev-avatar" src={discordAvatarUrl(p.user.id, p.user.avatar, 64, "auto")} alt="" width={36} height={36} loading="lazy" />
                                <span className="dl-dev-person-text">
                                    <Text tag="span" variant="text-md/semibold" color="text-strong" className="dl-dev-name">{p.user.name}</Text>
                                    <Text tag="span" variant="text-xs/normal" color="text-muted">{p.user.username ? `@${p.user.username} · ${p.user.id}` : p.user.id}</Text>
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {picked ? <AccountView key={picked.id} user={picked} /> : !debounced && <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("dev.coll.pickSomeone")}</Text>}
        </Section>
    );
}

/** The ledger's reasons, as server/src/sparks.ts writes them */
const REASONS: Record<string, () => string> = {
    purchase: () => t("dev.coll.reason.buy"),
    code: () => t("dev.coll.reason.redeem"),
    admin: () => t("dev.coll.reason.admin"),
    "admin-grant": () => t("dev.coll.reason.grant"),
    "admin-revoke": () => t("dev.coll.reason.revoke"),
    allowance: () => t("dev.coll.reason.allowance"),
};

function AccountView({ user }: { user: AdminUser; }) {
    const data = useAdmin(`/admin/users/${user.id}/wallet`, parseAdminWallet);
    const [amount, setAmount] = React.useState("");
    const [note, setNote] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const value = data.value;

    const adjust = async (sign: 1 | -1) => {
        const delta = parseDelta(amount);
        if (delta === undefined) return setError(t("dev.coll.badSparks"));
        setBusy(true);
        setError(undefined);
        const res = await admin("POST", `/admin/users/${user.id}/sparks`, { delta: sign * Math.abs(delta), note: note.trim() });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        setAmount("");
        setNote("");
        showToast(t(sign > 0 ? "dev.coll.gave" : "dev.coll.took", { amount: formatSparks(Math.abs(delta)), name: user.name }), { type: "success" });
        data.reload();
    };

    const setOwned = async (grant: boolean, bundle: string, kinds?: CollectibleKind[]) => {
        setBusy(true);
        setError(undefined);
        const res = await admin(grant ? "PUT" : "DELETE", `/admin/users/${user.id}/collectibles`, kinds ? { bundle, kinds } : { bundle });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        data.reload();
    };

    return (
        <section className="evi-dev-coll-account" aria-labelledby="dl-dev-coll-account-name" aria-busy={data.loading}>
            <div className="evi-dev-coll-account-head">
                <img className="dl-dev-avatar" src={discordAvatarUrl(user.id, user.avatar, 64, "auto")} alt="" width={40} height={40} />
                <span className="evi-dev-coll-card-title">
                    <Text tag="h3" variant="heading-md/semibold" color="text-strong" id="dl-dev-coll-account-name">{user.name}</Text>
                    <Text tag="span" variant="text-xs/normal" color="text-muted">{user.id}</Text>
                </span>
                {value && <SparksAmount amount={value.wallet.sparks} size="lg" />}
            </div>
            {data.error && <LoadError error={data.error} onRetry={data.reload} />}
            {value && (
                <>
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">
                        {value.allowance.level
                            ? t("dev.coll.allowanceOf", { amount: formatSparks(value.allowance.perMonth), level: SUPPORTER_TIERS.find(tier => tier.badge === value.allowance.level)?.name ?? value.allowance.level, month: value.allowance.lastMonth ?? "–" })
                            : t("dev.coll.noAllowance")}
                    </Text>
                    <form className="evi-dev-coll-adjust" onSubmit={e => { e.preventDefault(); void adjust(1); }}>
                        <SparksField id="dl-dev-coll-amount" label={t("dev.coll.amount")} value={amount} onChange={setAmount} placeholder="100" />
                        <TextField id="dl-dev-coll-note" label={t("dev.coll.note")} value={note} onChange={v => setNote(v.slice(0, 200))} placeholder={t("dev.coll.adjustNote")} />
                        <div className="dl-toolbar">
                            <Button type="submit" variant="accent" disabled={busy}>{t("dev.coll.give")}</Button>
                            <Button variant="danger" disabled={busy} onClick={() => void adjust(-1)}>{t("dev.coll.take")}</Button>
                        </div>
                    </form>
                    {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
                    <OwnedParts value={value} busy={busy} onSet={setOwned} />
                    <Ledger rows={value.ledger} />
                </>
            )}
        </section>
    );
}

function OwnedParts({ value, busy, onSet }: { value: AdminWallet; busy: boolean; onSet(grant: boolean, bundle: string, kinds?: CollectibleKind[]): void; }) {
    const bundles = Collectibles.bundles();
    const source = (bundle: string, kind: CollectibleKind) => value.parts.find(p => p.bundle === bundle && p.kind === kind)?.source;
    return (
        <div className="dl-stack">
            <Text tag="h4" variant="text-md/semibold" color="text-strong">{t("dev.coll.theirParts")}</Text>
            <ul className="evi-dev-coll-owned">
                {bundles.map(b => {
                    const owned = value.wallet.owned[b.id] ?? [];
                    const parts = KINDS.filter(k => b[k]);
                    return (
                        <li key={b.id} className="evi-dev-coll-owned-bundle">
                            <div className="evi-dev-coll-owned-head">
                                <Text tag="span" variant="text-sm/semibold" color="text-strong">{b.name}</Text>
                                <div className="dl-toolbar">
                                    {owned.length < parts.length && <Button size="sm" disabled={busy} onClick={() => onSet(true, b.id)}>{t("dev.coll.grantAll")}</Button>}
                                    {owned.length > 0 && <Button size="sm" variant="danger" disabled={busy} onClick={() => onSet(false, b.id)}>{t("dev.coll.revokeAll")}</Button>}
                                </div>
                            </div>
                            <ul className="evi-dev-coll-owned-parts">
                                {parts.map(k => {
                                    const has = owned.includes(k);
                                    return (
                                        <li key={k} data-owned={has ? "" : undefined}>
                                            <PartThumb bundle={b} kind={k} size={32} />
                                            <span className="evi-dev-coll-card-title">
                                                <Text tag="span" variant="text-sm/medium" color={has ? "text-strong" : "text-muted"}>{KIND_LABEL[k]()}</Text>
                                                {has ? <Status tone="success" quiet>{source(b.id, k) ? t("dev.coll.ownedFrom", { source: source(b.id, k)! }) : t("sparks.owned")}</Status> : <Text tag="span" variant="text-xs/normal" color="text-muted">{t("dev.coll.notOwned")}</Text>}
                                            </span>
                                            <Button size="sm" variant={has ? "danger" : "secondary"} disabled={busy} aria-label={t(has ? "dev.coll.revokePart" : "dev.coll.grantPart", { part: KIND_LABEL[k](), name: b.name })} onClick={() => onSet(!has, b.id, [k])}>
                                                {has ? t("dev.coll.revoke") : t("dev.coll.grant")}
                                            </Button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function Ledger({ rows }: { rows: AdminWallet["ledger"]; }) {
    return (
        <div className="dl-stack">
            <Text tag="h4" variant="text-md/semibold" color="text-strong">{t("dev.coll.ledger")}</Text>
            {!rows.length ? <Text tag="p" variant="text-sm/normal" color="text-muted">{t("dev.coll.noLedger")}</Text> : (
                <div className="evi-dev-coll-ledger-wrap">
                    <table className="evi-dev-coll-ledger">
                        <thead>
                            <tr>
                                <th scope="col">{t("dev.coll.when")}</th>
                                <th scope="col">{t("dev.coll.what")}</th>
                                <th scope="col" className="evi-num">{t("dev.coll.change")}</th>
                                <th scope="col" className="evi-num">{t("dev.coll.balance")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.id}>
                                    <td title={new Date(r.at).toLocaleString(I18n.discordLocale)}>{timeAgo(r.at)}</td>
                                    <td>
                                        <span className="evi-dev-coll-ledger-what">{REASONS[r.reason]?.() ?? r.reason}</span>
                                        {r.ref && <span className="evi-dev-coll-ledger-ref">{r.ref}</span>}
                                    </td>
                                    <td className="evi-num" data-sign={r.delta > 0 ? "plus" : r.delta < 0 ? "minus" : undefined}>{r.delta > 0 ? "+" : ""}{formatSparks(r.delta)}</td>
                                    <td className="evi-num">{formatSparks(r.balance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ---- the supporters' monthly Sparks ----

function AllowancePanel() {
    const levels = useAdmin("/admin/collectibles/allowance", parseAllowance);
    return (
        <Section title={t("dev.coll.allowance")} description={t("dev.coll.allowanceHint")} id="dl-dev-coll-allowance">
            {levels.error && <LoadError error={levels.error} onRetry={levels.reload} />}
            {!levels.value && !levels.error && <EmptyState icon="clock" title={t("dev.loading")} />}
            {levels.value && <AllowanceForm key={levels.value.map(l => `${l.id}:${l.sparks}`).join()} levels={levels.value} onSaved={levels.reload} />}
        </Section>
    );
}

function AllowanceForm({ levels, onSaved }: { levels: AllowanceLevel[]; onSaved(): void; }) {
    const [fields, setFields] = React.useState(() => Object.fromEntries(levels.map(l => [l.id, String(l.sparks)])));
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const changed = levels.some(l => (fields[l.id] || "0") !== String(l.sparks));

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        const res = await admin("PUT", "/admin/collectibles/allowance", { perLevel: Object.fromEntries(levels.map(l => [l.id, Number(fields[l.id] || 0)])) });
        setBusy(false);
        if (!res.ok) return setError(res.error);
        showToast(t("dev.coll.allowanceSaved"), { type: "success" });
        onSaved();
    };

    return (
        <form className="dl-stack-loose" onSubmit={save}>
            <div className="evi-dev-coll-price-fields">
                {levels.map(l => (
                    <SparksField
                        key={l.id}
                        id={`dl-dev-allowance-${l.id}`}
                        label={l.name}
                        description={l.days ? t("dev.coll.levelDays", { count: l.days }) : undefined}
                        value={fields[l.id] ?? ""}
                        placeholder="0"
                        onChange={v => setFields(f => ({ ...f, [l.id]: v }))}
                    />
                ))}
            </div>
            {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
            <div className="dl-toolbar"><Button type="submit" variant="accent" disabled={busy || !changed}>{t("dev.coll.saveAllowance")}</Button></div>
        </form>
    );
}
