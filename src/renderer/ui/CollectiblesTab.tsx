/**
 * The Collectibles page: Evi's bundles of a nameplate, an avatar decoration, a profile effect and a
 * profile frame, each previewed on your own name, avatar and profile. What you own comes first: wear
 * a whole bundle or one part of it, and what you wear shows on you for everyone running Evi. The rest
 * of the shop follows, bought with Sparks (ui/Sparks.tsx) in the Shop's dialog.
 *
 * Previews show stills until you point at a card (or tab into it), like Discord's shop: then they
 * play, loading the animated files the first time. With reduced motion they stay still.
 */
import { Bundle, CollectibleKind, Wallet } from "@shared/collectibles";
import type { CollectiblesChanges } from "@shared/ipc";
import { bundleOffer, ownedOf, partOffer, partsOf } from "@shared/sparks";

import { Badges } from "../badges";
import { Collectibles } from "../collectibles";
import { layerPlay } from "../collectibles/timeline";
import { t } from "../i18n";
import { Settings } from "../settings";
import { showToast } from "../toolkit/toasts";
import { React } from "../webpack/common";
import { findStore } from "../webpack/find";
import { AccountCard, useAccountLink } from "./AccountTab";
import { openProduct } from "./CollectiblesShop";
import { Badge, Button, cx, EmptyState, Icon, Notice, Section, Status, SwitchRow, Text, useStore } from "./components";
import { showTab } from "./nav";
import { SupportersPill } from "./Store";
import { SettingsUI } from "./index";
import { BalancePill, formatSparks, installShopStyles, KIND_LABEL, OfferLabel, PALETTE_COLORS, refusalText, SparksAmount, useSparks } from "./Sparks";

export { KIND_LABEL, PALETTE_COLORS } from "./Sparks";

export interface Me {
    id: string;
    name: string;
    avatar: string;
}

export function useMe(): Me | undefined {
    const user = findStore<any>("UserStore")?.getCurrentUser?.();
    if (!user) return undefined;
    return {
        id: user.id,
        name: user.globalName || user.username,
        avatar: user.getAvatarURL?.(undefined, 128, false) ?? "",
    };
}

export const reducedMotion = () =>
    document.documentElement.classList.contains("reduce-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
export const lightTheme = () => document.documentElement.classList.contains("theme-light");

/** A blob: URL of its own for one play, so an animated image starts from its first frame */
function FreshImg({ blob, className, style }: { blob: Blob; className?: string; style?: React.CSSProperties; }) {
    const url = React.useMemo(() => URL.createObjectURL(blob), [blob]);
    React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
    return <img src={url} className={className} style={style} alt="" draggable={false} />;
}

/** Effects are drawn for a 450 by 880 profile: placed in percent, they fit the preview at any width */
const pct = (value: number, of: number) => `${(value / of) * 100}%`;

/** A profile effect over the preview: its still, or its layers playing from the start while `playing` */
export function EffectPreview({ bundle, playing }: { bundle: Bundle; playing: boolean; }) {
    const fx = bundle.effect!;
    const blobs = fx.layers.map(l => Collectibles.blob(l.src));
    const ready = playing && blobs.every(Boolean);
    const [time, setTime] = React.useState(0);

    React.useEffect(() => {
        if (playing) Collectibles.loadAnimated(bundle.id, "effect");
    }, [playing, bundle.id]);

    React.useEffect(() => {
        if (!ready) return;
        const started = performance.now();
        setTime(0);
        const timer = setInterval(() => setTime(performance.now() - started), 50);
        return () => clearInterval(timer);
    }, [ready]);

    if (!ready) {
        const still = Collectibles.file(fx.static);
        return still ? <img className="dl-coll-effect" src={still} alt="" draggable={false} /> : null;
    }
    return (
        <div className="dl-coll-effect" aria-hidden="true">
            {fx.layers.map((layer, i) => {
                const play = layerPlay(layer, time);
                if (play === undefined) return null;
                return (
                    <FreshImg
                        // A layer that loops back to back stays put (a still one never blinks); one with a
                        // pause between plays starts its animation over each time, like Discord's player
                        key={`${i}-${layer.loopDelay > 0 ? play : 0}`}
                        blob={blobs[i]!}
                        className="dl-coll-effect-layer"
                        style={{ left: pct(layer.x, 450), top: pct(layer.y, 880), width: pct(layer.width, 450), height: pct(layer.height, 880), zIndex: layer.zIndex }}
                    />
                );
            })}
        </div>
    );
}

/** Your avatar with the bundle's decoration around it */
export function DecorationPreview({ bundle, me, playing }: { bundle: Bundle; me: Me; playing: boolean; }) {
    const deco = bundle.decoration;
    React.useEffect(() => {
        if (playing && deco) Collectibles.loadAnimated(bundle.id, "decoration");
    }, [playing, bundle.id, deco]);
    const src = deco && ((playing && Collectibles.file(deco.animated)) || Collectibles.file(deco.static));
    return (
        <div className="dl-coll-avatar">
            <img className="dl-coll-avatar-img" src={me.avatar} alt="" draggable={false} />
            {src && <img className="dl-coll-decoration" src={src} alt="" draggable={false} />}
        </div>
    );
}

/**
 * A profile frame around the card it's drawn over (it fills its parent): the still, or the animation
 * while `playing`. A bundle without a frame draws nothing.
 */
export function FramePreview({ bundle, playing }: { bundle: Bundle; playing: boolean; }) {
    const frame = bundle.frame;
    React.useEffect(() => {
        if (playing && frame) Collectibles.loadAnimated(bundle.id, "frame");
    }, [playing, bundle.id, frame]);
    if (!frame) return null;
    const src = (playing && Collectibles.file(frame.animated)) || Collectibles.file(frame.static);
    return src ? <img className="evi-coll-frame" src={src} alt="" draggable={false} /> : null;
}

/** A member list row with your name, over the bundle's nameplate */
export function NameplatePreview({ bundle, me, playing }: { bundle: Bundle; me: Me; playing: boolean; }) {
    const np = bundle.nameplate;
    React.useEffect(() => {
        if (playing && np) Collectibles.loadAnimated(bundle.id, "nameplate");
    }, [playing, bundle.id, np]);
    if (!np) return null;
    const color = PALETTE_COLORS[np.palette][lightTheme() ? "light" : "dark"];
    const still = Collectibles.file(np.static);
    const video = playing ? Collectibles.file(np.animated) : undefined;
    return (
        <div className="dl-coll-nameplate" style={{ background: `linear-gradient(90deg, transparent 0%, ${color}14 20%, ${color}14 50%, ${color}4D 100%)` }}>
            {video ? <video className="dl-coll-nameplate-art" src={video} poster={still} autoPlay loop muted playsInline aria-hidden="true" />
                : still && <img className="dl-coll-nameplate-art" src={still} alt="" draggable={false} />}
            <img className="dl-coll-nameplate-avatar" src={me.avatar} alt="" draggable={false} />
            <span className="dl-coll-nameplate-name">{me.name}</span>
        </div>
    );
}

function BundleCard({ bundle, me, worn, wallet, locked, busy, onChange }: {
    bundle: Bundle;
    me: Me;
    worn: Partial<Record<CollectibleKind, string>>;
    wallet: Wallet | undefined;
    locked: boolean;
    busy: boolean;
    onChange(changes: CollectiblesChanges): void;
}) {
    const [pointing, setPointing] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const playing = (pointing || focused) && !reducedMotion();
    const kinds = partsOf(bundle);
    const owned = ownedOf(wallet, bundle.id);
    const ownedKinds = kinds.filter(kind => owned.includes(kind));
    const wearing = kinds.filter(kind => worn[kind] === bundle.id);
    const all = wearing.length === kinds.length;
    const ownsAll = ownedKinds.length === kinds.length;
    const offer = bundleOffer(bundle, wallet);
    const titleId = `dl-coll-${bundle.id}-title`;

    // Wears what you own of it, or takes off all of it
    const wearAll = () => onChange(Object.fromEntries((all || wearing.length && !ownedKinds.length ? kinds : ownedKinds).map(kind => [kind, all ? null : bundle.id])));

    return (
        <article
            className="dl-coll-card"
            data-worn={wearing.length ? "" : undefined}
            data-supporter={bundle.tier === "supporter" ? "" : undefined}
            aria-labelledby={titleId}
            aria-busy={busy || undefined}
            onPointerEnter={() => setPointing(true)}
            onPointerLeave={() => setPointing(false)}
            onFocus={() => setFocused(true)}
            onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}
        >
            <div className="dl-coll-preview" aria-hidden="true">
                <div className="dl-coll-profile">
                    <div className="dl-coll-banner" style={{ background: bundle.nameplate ? PALETTE_COLORS[bundle.nameplate.palette].dark : undefined }} />
                    <DecorationPreview bundle={bundle} me={me} playing={playing} />
                    <span className="dl-coll-profile-name">{me.name}</span>
                    <NameplatePreview bundle={bundle} me={me} playing={playing} />
                    {bundle.effect && <EffectPreview bundle={bundle} playing={playing} />}
                    <FramePreview bundle={bundle} playing={playing} />
                </div>
            </div>
            <div className="dl-coll-body">
                <div className="dl-coll-title">
                    <Text tag="h3" variant="text-md/semibold" color="text-strong" id={titleId}>{bundle.name}</Text>
                    {bundle.tier === "supporter" && <SupportersPill />}
                </div>
                {bundle.description && <Text tag="p" variant="text-sm/normal" color="text-subtle" className="dl-coll-description">{bundle.description}</Text>}
                <div className="evi-coll-offer">
                    {offer.state === "buy" ? (
                        <>
                            <SparksAmount amount={offer.price} />
                            {ownedKinds.length > 0 ? <Text tag="span" variant="text-xs/medium" color="text-subtle">{t("sparks.forTheRest")}</Text>
                                : offer.save > 0 && <Badge>{t("sparks.save", { amount: formatSparks(offer.save) })}</Badge>}
                        </>
                    ) : <OfferLabel offer={offer.state === "owned" ? { state: "owned" } : { state: "code" }} />}
                </div>
                {wearing.length > 0 && <Status tone="success" quiet>{all ? t("collectibles.wearingAll") : t("collectibles.wearingSome", { count: wearing.length })}</Status>}
            </div>
            {locked ? (
                <div className="dl-coll-locked">
                    <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("collectibles.supportersHint")}</Text>
                    <Button variant="accent" icon="heart" onClick={() => { showTab("general", "account"); SettingsUI.open("general"); }}>{t("supporters.become")}</Button>
                </div>
            ) : (
                <div className="dl-coll-actions">
                    {ownsAll || wearing.length ? (
                        <Button variant={all ? "secondary" : "accent"} onClick={wearAll} disabled={busy}>
                            {all ? t("collectibles.takeOffBundle") : t("collectibles.wearBundle")}
                        </Button>
                    ) : null}
                    {offer.state === "buy" && (
                        <Button variant={ownsAll || wearing.length ? "secondary" : "accent"} onClick={() => openProduct(bundle, "bundle", true)}>
                            {t(ownedKinds.length ? "sparks.buyRestFor" : "sparks.buyBundleFor", { price: formatSparks(offer.price) })}
                        </Button>
                    )}
                    {offer.state === "code" && !ownedKinds.length && (
                        <Button onClick={() => openProduct(bundle, "bundle")}>{t("collectiblesShop.details")}</Button>
                    )}
                    <ul className="dl-coll-parts" aria-label={t("collectibles.parts", { name: bundle.name })}>
                        {kinds.map(kind => {
                            const on = worn[kind] === bundle.id;
                            const part = partOffer(bundle, kind, wallet);
                            return (
                                <li key={kind} className="dl-coll-part" data-on={on ? "" : undefined}>
                                    <span className="dl-coll-part-label">
                                        {on && <Icon name="circleCheck" size={14} />}
                                        <Text variant="text-sm/medium" color={on ? "text-strong" : "text-default"}>{KIND_LABEL[kind]()}</Text>
                                        {on && <span className="dl-sr-only">{t("collectibles.wearing")}</span>}
                                        {!on && part.state !== "owned" && <OfferLabel offer={part} />}
                                    </span>
                                    {part.state === "owned" || on ? (
                                        <Button
                                            size="sm"
                                            disabled={busy}
                                            aria-label={t(on ? "collectibles.takeOffPart" : "collectibles.wearPart", { part: KIND_LABEL[kind](), name: bundle.name })}
                                            onClick={() => onChange({ [kind]: on ? null : bundle.id })}
                                        >
                                            {on ? t("collectibles.takeOff") : t("collectibles.wear")}
                                        </Button>
                                    ) : part.state === "buy" ? (
                                        <Button
                                            size="sm"
                                            aria-label={t("sparks.buyPart", { part: KIND_LABEL[kind](), name: bundle.name, price: formatSparks(part.price) })}
                                            onClick={() => openProduct(bundle, kind, true)}
                                        >
                                            {t("sparks.buy")}
                                        </Button>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </article>
    );
}

export function CollectiblesTab() {
    installShopStyles();
    useStore(Collectibles.subscribe, Collectibles.getVersion);
    useStore(Badges.subscribe, Badges.getVersion);
    const settings = useStore(Settings.subscribe, () => Settings.data);
    const link = useAccountLink();
    const me = useMe();
    const [busy, setBusy] = React.useState<string | undefined>();
    const { wallet, linked } = useSparks(link);

    // Badges know who supports Evi; collectibles load with Evi, badges may not be asked for yet here
    React.useEffect(() => Badges.use(), []);

    const bundles = Collectibles.bundles();
    const worn = Collectibles.mine();
    const supporter = !!me && Badges.supporterSince(me.id) !== undefined;
    // Looks through Discord's modules: once per visit to the page
    const [broken] = React.useState(() => Collectibles.brokenKinds());
    // What you own (or still wear) first, the rest of the shop after
    const yours = bundles.filter(b => ownedOf(wallet, b.id).length > 0 || partsOf(b).some(k => worn[k] === b.id));
    const rest = bundles.filter(b => !yours.includes(b));

    const change = async (bundle: Bundle, changes: CollectiblesChanges) => {
        setBusy(bundle.id);
        const result = await Collectibles.equip(changes);
        setBusy(undefined);
        if (result.ok) return;
        if (result.unlinked) void link.check();
        showToast(refusalText(result), { type: "failure", duration: 5000 });
    };

    const card = (bundle: Bundle) => (
        <BundleCard
            key={bundle.id}
            bundle={bundle}
            me={me!}
            worn={worn}
            wallet={wallet}
            locked={bundle.tier === "supporter" && !supporter}
            busy={busy === bundle.id}
            onChange={changes => void change(bundle, changes)}
        />
    );

    return (
        <div className="dl-tab">
            <Section title={t("collectibles.title")} description={t("collectibles.description")} action={linked ? <BalancePill /> : undefined}>
                {!linked && link.state.kind !== "loading" && (
                    <div className="dl-coll-link">
                        <Text tag="p" variant="text-sm/medium" color="text-strong">{t("sparks.linkFirst")}</Text>
                        <AccountCard link={link} />
                    </div>
                )}
                {broken.length > 0 && bundles.length > 0 && <Notice tone="warning">{t("collectibles.notShowing")}</Notice>}
                {(!me || !bundles.length) && (
                    <EmptyState
                        icon="collectibles"
                        title={t("collectibles.empty.title")}
                        action={<Button icon="refresh" onClick={() => void Collectibles.refresh()}>{t("common.tryAgain")}</Button>}
                    >
                        {t("collectibles.empty.text")}
                    </EmptyState>
                )}
            </Section>
            {me && bundles.length > 0 && (
                <>
                    <Section title={t("collectibles.yours.title")} id="dl-coll-yours">
                        {yours.length ? <div className={cx("dl-coll-grid")}>{yours.map(card)}</div> : (
                            <Text tag="p" variant="text-sm/normal" color="text-subtle" className="evi-coll-none">
                                {linked ? t("collectibles.yours.empty") : t("collectibles.yours.unlinked")}
                            </Text>
                        )}
                    </Section>
                    {rest.length > 0 && (
                        <Section title={t("collectibles.shop.title")} description={t("collectibles.shop.description")} id="dl-coll-shop">
                            <div className={cx("dl-coll-grid")}>{rest.map(card)}</div>
                        </Section>
                    )}
                </>
            )}
            <Section title={t("collectibles.seeing.title")}>
                <SwitchRow
                    id="dl-coll-others"
                    label={t("collectibles.others")}
                    description={t("collectibles.othersHint")}
                    checked={settings.collectiblesOnOthers !== false}
                    onChange={on => Settings.update(d => void (d.collectiblesOnOthers = on))}
                />
            </Section>
        </div>
    );
}
