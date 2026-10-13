/**
 * Evi collectibles in Discord's own Shop: an "Evi" tab beside Discord's, and while it's selected,
 * Evi's page in the Shop's content area, drawn the way Discord draws its shop (a painted hero, then
 * product cards that lift and show their buttons on hover). A card opens the bundle in a dialog
 * with a large preview on your profile, where you buy its parts with Sparks (or the whole bundle,
 * for less), then wear them or take them off. Nothing is free: wearing a part needs owning it.
 *
 * Discord's patched Shop code (collectibles/shopPatches.ts) asks `CollectiblesShopApi`, at
 * window.Evi.collectiblesShop. Evi's page isn't one of Discord's tabs: Discord's own tab, address
 * and analytics stay as they were underneath, so nothing about Evi ever reaches Discord.
 */
import type { ReactElement } from "react";

import { Bundle, CollectibleKind, KINDS, Wallet } from "@shared/collectibles";
import type { CollectiblesChanges } from "@shared/ipc";
import { afterBuying, bundleOffer, cardOffer, ownedOf, partOffer, partsOf } from "@shared/sparks";

import { Badges } from "../badges";
import { Collectibles } from "../collectibles";
import { EVI_TAB, NavOption, ShopState, withEviTab } from "../collectibles/shopState";
import { t, useLocale } from "../i18n";
import { Logger } from "../logger";
import { openLayer } from "../toolkit/layer";
import { showToast } from "../toolkit/toasts";
import { React } from "../webpack/common";
import { AccountCard, useAccountLink } from "./AccountTab";
import { DecorationPreview, EffectPreview, FramePreview, Me, NameplatePreview, reducedMotion, useMe } from "./CollectiblesTab";
import { Badge, Button, EmptyState, ErrorBoundary, FocusLayer, Icon, IconButton, Notice, Text, useExit, useModal, useStore } from "./components";
import { SupportersPill } from "./Store";
import { SettingsUI } from "./index";
import { BalancePill, formatSparks, installShopStyles, KIND_LABEL, OfferLabel, openRedeem, PartThumb, refusalText, SparkIcon, SparksAmount, tint, useSparks } from "./Sparks";

const logger = new Logger("CollectiblesShop", "#c27aff");

const { showing: isOpen, subscribe } = ShopState;
const setOpen = ShopState.set;

/** Evi's mark, the "e" with a puzzle piece's knob in its eye, in Discord's icon sizes */
export function EviMark({ size, color = "currentColor", className }: { size?: number | string; color?: string; className?: string; }) {
    const px = typeof size === "number" ? size : ({ xxs: 12, xs: 16, sm: 18, md: 24, lg: 32 } as Record<string, number>)[size ?? "md"] ?? 24;
    return (
        <svg className={className} width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill={color}
                fillRule="evenodd"
                d="M21.89 13.4A10 9.4 0 1 0 19.66 18.04A2 2 0 0 0 17.2 15.4C15.6 16.9 13.9 17.5 12.4 17.4C10 17.3 8.4 15.8 8 13.4ZM8.8 8.4H11.1A1.8 1.8 0 1 1 12.9 8.4H15.2A1.4 1.4 0 0 1 16.6 9.8A1.4 1.4 0 0 1 15.2 11.2H8.8A1.4 1.4 0 0 1 7.4 9.8A1.4 1.4 0 0 1 8.8 8.4Z"
            />
        </svg>
    );
}

/** What Discord's patched Shop asks (shopPatches.ts) */
export const CollectiblesShopApi = {
    /** Discord's tabs with Evi's after the first (Featured), when Evi's page can show */
    tabs(options: NavOption[]): NavOption[] | undefined {
        try {
            return withEviTab(options, { text: t("collectiblesShop.tab"), icon: EviMark });
        } catch (err) {
            logger.error("Couldn't add Evi's tab", err);
            return undefined;
        }
    },
    /** The tab bar's selected tab: Evi's while its page shows. A hook, so the bar redraws. */
    useSelectedKey(key: string) {
        return React.useSyncExternalStore(subscribe, isOpen) ? EVI_TAB : key;
    },
    /** The Shop's content: Evi's page while its tab is selected, Discord's otherwise */
    content(discord: ReactElement, tab: string) {
        return React.createElement(ShopContent, { discord, tab });
    },
    /** Discord moves to one of its own tabs */
    leave() {
        setOpen(false);
    },
    /** Whether Evi's page shows */
    showing: isOpen,
    /** Opens an Evi bundle's dialog at one part, to buy it (Discord's pickers, for Evi items you don't own) */
    openProduct(bundleId: string, kind: CollectibleKind) {
        const bundle = Collectibles.bundle(bundleId);
        if (!bundle) return;
        openProduct(bundle, KINDS.includes(kind) && bundle[kind] ? kind : "bundle");
    },
};

function ShopContent({ discord, tab }: { discord: ReactElement; tab: string; }) {
    const showing = React.useSyncExternalStore(subscribe, isOpen);

    // Opened at /shop?tab=evi (the tab's own link): Evi's page. Closed with the Shop.
    React.useLayoutEffect(() => {
        if (new URLSearchParams(location.search).get("tab") === EVI_TAB) setOpen(true);
        return () => setOpen(false);
    }, []);

    // Discord went to another of its tabs some other way (a link into the Shop)
    const lastTab = React.useRef(tab);
    React.useEffect(() => {
        if (lastTab.current !== tab) setOpen(false);
        lastTab.current = tab;
    }, [tab]);

    if (!showing) return discord;
    return <ErrorBoundary><EviShopPage /></ErrorBoundary>;
}

// ---- the page ----

type CardKind = CollectibleKind | "bundle";

/** What a card or the dialog wears or takes off: a whole bundle, or one part of it */
function changesFor(bundle: Bundle, kind: CardKind, wearing: boolean, wallet?: Wallet): CollectiblesChanges {
    // Putting a bundle on puts on the parts you own of it
    const kinds = kind === "bundle" ? KINDS.filter(k => bundle[k] && (wearing || !wallet || ownedOf(wallet, bundle.id).includes(k))) : [kind];
    return Object.fromEntries(kinds.map(k => [k, wearing ? null : bundle.id]));
}

function wears(bundle: Bundle, kind: CardKind, worn: Partial<Record<CollectibleKind, string>>) {
    const kinds = kind === "bundle" ? KINDS.filter(k => bundle[k]) : [kind];
    return kinds.length > 0 && kinds.every(k => worn[k] === bundle.id);
}

/** Wearing and taking off, with the same answers as Evi's Collectibles page */
function useEquip(onUnlinked: () => void) {
    const [busy, setBusy] = React.useState<string | undefined>();
    const change = async (key: string, changes: CollectiblesChanges) => {
        setBusy(key);
        const result = await Collectibles.equip(changes);
        setBusy(undefined);
        if (result.ok) return;
        if (result.unlinked) onUnlinked();
        showToast(refusalText(result), { type: "failure", duration: 5000 });
    };
    return { busy, change };
}

/** The parts of a card you own: what Wear puts on */
function ownedKinds(bundle: Bundle, kind: CardKind, wallet: Wallet | undefined): CollectibleKind[] {
    const owned = ownedOf(wallet, bundle.id);
    return (kind === "bundle" ? partsOf(bundle) : [kind]).filter(k => owned.includes(k));
}

function useSupporter(me: Me | undefined) {
    useStore(Badges.subscribe, Badges.getVersion);
    // Badges know who supports Evi; they may not have been asked for yet
    React.useEffect(() => Badges.use(), []);
    return !!me && Badges.supporterSince(me.id) !== undefined;
}

/** Opens a bundle (or one part of it) in the dialog; `buy` opens it at buying it */
export function openProduct(bundle: Bundle, kind: CardKind, buy = false) {
    installShopStyles();
    openLayer(close => <ProductDialog bundleId={bundle.id} kind={kind} buy={buy} onClosed={() => close({ instant: true })} />);
}

function EviShopPage() {
    useLocale();
    installShopStyles();
    useStore(Collectibles.subscribe, Collectibles.getVersion);
    const me = useMe();
    const link = useAccountLink();
    const linked = link.state.kind === "linked";
    const supporter = useSupporter(me);
    const { busy, change } = useEquip(() => void link.check());
    const { wallet } = useSparks(link);
    const bundles = Collectibles.bundles();
    const worn = Collectibles.mine();

    const sections: { kind: CardKind; title: string; }[] = [
        { kind: "bundle", title: t("collectiblesShop.bundles") },
        { kind: "nameplate", title: t("collectiblesShop.nameplates") },
        { kind: "decoration", title: t("collectiblesShop.decorations") },
        { kind: "effect", title: t("collectiblesShop.effects") },
        { kind: "frame", title: t("collectiblesShop.frames") },
    ];

    /** A card's button: wear what you own of it, or buy it (in the dialog, which asks first) */
    const act = (bundle: Bundle, kind: CardKind) => {
        // Linking and supporting happen in the dialog, which says what's missing
        if (!linked || (bundle.tier === "supporter" && !supporter)) return openProduct(bundle, kind);
        const wearing = wears(bundle, kind, worn);
        if (!wearing && !ownedKinds(bundle, kind, wallet).length) return openProduct(bundle, kind, cardOffer(bundle, kind, wallet).state === "buy");
        void change(`${bundle.id}:${kind}`, changesFor(bundle, kind, wearing, wallet));
    };

    return (
        <div className="dl-root evi-shop">
            <div className="evi-shop-scroller">
                <Hero bundles={bundles} linked={linked} />
                {!me || !bundles.length ? (
                    <div className="evi-shop-block">
                        <EmptyState
                            icon="collectibles"
                            title={t("collectibles.empty.title")}
                            action={<Button icon="refresh" onClick={() => void Collectibles.refresh()}>{t("common.tryAgain")}</Button>}
                        >
                            {t("collectibles.empty.text")}
                        </EmptyState>
                    </div>
                ) : sections.map(({ kind, title }) => {
                    const items = kind === "bundle" ? bundles : bundles.filter(b => b[kind]);
                    if (!items.length) return null;
                    return (
                        <section key={kind} className="evi-shop-block" aria-labelledby={`evi-shop-${kind}`}>
                            <Text tag="h2" variant="heading-lg/semibold" color="text-strong" id={`evi-shop-${kind}`} className="evi-shop-block-title">{title}</Text>
                            <ul className="evi-shop-grid">
                                {items.map(bundle => (
                                    <li key={bundle.id}>
                                        <ShopCard
                                            bundle={bundle}
                                            kind={kind}
                                            me={me}
                                            wallet={wallet}
                                            wearing={wears(bundle, kind, worn)}
                                            locked={bundle.tier === "supporter" && !supporter}
                                            busy={busy === `${bundle.id}:${kind}`}
                                            onAct={() => act(bundle, kind)}
                                            onOpen={() => openProduct(bundle, kind)}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

/** The top of the page, like Discord's shop hero: the bundles' painted nameplates as one wall of art */
function Hero({ bundles, linked }: { bundles: readonly Bundle[]; linked: boolean; }) {
    const art = bundles.map(b => b.nameplate?.static).filter((u): u is string => !!u);
    const rows = art.length ? [0, 1, 2].map(row => Array.from({ length: 4 }, (_, i) => art[(row * 3 + i) % art.length])) : [];
    return (
        <section className="evi-shop-hero" aria-labelledby="evi-shop-title">
            <div className="evi-shop-hero-art" aria-hidden="true">
                {rows.map((row, r) => (
                    <div className="evi-shop-hero-row" key={r} style={{ "--evi-row": r } as React.CSSProperties}>
                        {row.map((url, i) => {
                            const src = Collectibles.file(url);
                            return src ? <img key={i} src={src} alt="" draggable={false} /> : <span key={i} className="evi-shop-hero-gap" />;
                        })}
                    </div>
                ))}
            </div>
            <div className="evi-shop-hero-content">
                <span className="evi-shop-hero-eyebrow"><EviMark size={18} />{t("collectiblesShop.tab")}</span>
                <Text tag="h1" variant="heading-xxl/bold" color="always-white" id="evi-shop-title" className="evi-shop-hero-title">{t("collectiblesShop.title")}</Text>
                <Text tag="p" variant="text-md/normal" color="always-white" className="evi-shop-hero-pitch">{t("collectiblesShop.pitch")}</Text>
                <div className="evi-shop-hero-actions">
                    {linked ? <BalancePill onImage /> : <Button onClick={() => openRedeem()}>{t("sparks.redeem")}</Button>}
                    <Button onClick={() => SettingsUI.open("collectibles")}>{t("collectiblesShop.settings")}</Button>
                </div>
            </div>
        </section>
    );
}

/** The art of a card: a bundle on you, or one part of it */
function CardArt({ bundle, kind, me, playing }: { bundle: Bundle; kind: CardKind; me: Me; playing: boolean; }) {
    if (kind === "nameplate") {
        return <div className="evi-shop-art evi-shop-art-nameplate"><NameplatePreview bundle={bundle} me={me} playing={playing} /></div>;
    }
    if (kind === "decoration") {
        return <div className="evi-shop-art evi-shop-art-decoration"><DecorationPreview bundle={bundle} me={me} playing={playing} /></div>;
    }
    if (kind === "effect" || kind === "frame") {
        return (
            <div className="evi-shop-art evi-shop-art-effect">
                <MiniProfile bundle={bundle} me={me} playing={playing} parts={[kind]} />
            </div>
        );
    }
    return (
        <div className="evi-shop-art evi-shop-art-bundle">
            {bundle.effect && <EffectPreview bundle={bundle} playing={playing} />}
            <DecorationPreview bundle={bundle} me={me} playing={playing} />
            <NameplatePreview bundle={bundle} me={me} playing={playing} />
        </div>
    );
}

/** A profile card with the bundle's parts on it, for the effect cards and the dialog */
function MiniProfile({ bundle, me, playing, parts }: { bundle: Bundle; me: Me; playing: boolean; parts: CollectibleKind[]; }) {
    const shown = (kind: CollectibleKind) => parts.includes(kind) && !!bundle[kind];
    return (
        <div className="evi-shop-profile" style={tint(bundle)}>
            <div className="evi-shop-profile-banner" />
            <div className="evi-shop-profile-avatar">
                {shown("decoration") ? <DecorationPreview bundle={bundle} me={me} playing={playing} /> : <img className="dl-coll-avatar-img" src={me.avatar} alt="" draggable={false} />}
            </div>
            <span className="evi-shop-profile-name">{me.name}</span>
            <span className="evi-shop-profile-line" />
            <span className="evi-shop-profile-line evi-shop-profile-line-short" />
            {shown("nameplate") && <div className="evi-shop-profile-nameplate"><NameplatePreview bundle={bundle} me={me} playing={playing} /></div>}
            {shown("effect") && <EffectPreview bundle={bundle} playing={playing} />}
            {shown("frame") && <FramePreview bundle={bundle} playing={playing} />}
        </div>
    );
}

/** A card's price line: the Sparks it costs (or owned, or codes only), marked when it's for supporters */
function Price({ bundle, kind, wallet }: { bundle: Bundle; kind: CardKind; wallet: Wallet | undefined; }) {
    const offer = cardOffer(bundle, kind, wallet);
    return (
        <span className="evi-shop-price">
            {bundle.tier === "supporter" && offer.state !== "owned" && <SupportersPill />}
            <OfferLabel offer={offer} />
        </span>
    );
}

function cardLabel(bundle: Bundle, kind: CardKind) {
    return kind === "bundle" ? t("collectiblesShop.bundleKind") : KIND_LABEL[kind]();
}

function ShopCard({ bundle, kind, me, wallet, wearing, locked, busy, onAct, onOpen }: {
    bundle: Bundle;
    kind: CardKind;
    me: Me;
    wallet: Wallet | undefined;
    wearing: boolean;
    locked: boolean;
    busy: boolean;
    onAct(): void;
    onOpen(): void;
}) {
    const [pointing, setPointing] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const active = pointing || focused;
    const playing = active && !reducedMotion();
    const titleId = `evi-shop-${kind}-${bundle.id}`;
    const owns = ownedKinds(bundle, kind, wallet).length > 0;
    const offer = cardOffer(bundle, kind, wallet);
    const action = locked ? t("collectiblesShop.details")
        : !owns && !wearing ? offer.state === "buy" ? t("sparks.buyFor", { price: formatSparks(offer.price) }) : t("collectiblesShop.details")
            : kind === "bundle" ? t(wearing ? "collectibles.takeOffBundle" : "collectibles.wearBundle")
                : t(wearing ? "collectibles.takeOff" : "collectibles.wear");
    const wearLabel = kind !== "bundle" && !locked && (owns || wearing);

    return (
        <article
            className="evi-shop-card"
            data-active={active ? "" : undefined}
            data-kind={kind}
            style={tint(bundle)}
            aria-labelledby={titleId}
            aria-busy={busy || undefined}
            // A mouse only: after a tap, a card would stay lifted
            onPointerEnter={e => e.pointerType === "mouse" && setPointing(true)}
            onPointerLeave={() => setPointing(false)}
            onFocus={() => setFocused(true)}
            onBlur={e => !e.currentTarget.contains(e.relatedTarget as Node) && setFocused(false)}
        >
            {/* The whole card opens the bundle; the buttons on it sit above */}
            <button type="button" className="evi-shop-card-open" aria-labelledby={titleId} aria-describedby={`${titleId}-kind`} onClick={onOpen} />
            <div className="evi-shop-card-preview" aria-hidden="true">
                <CardArt bundle={bundle} kind={kind} me={me} playing={playing} />
            </div>
            <div className="evi-shop-card-gradient" aria-hidden="true" />
            <div className="evi-shop-card-footer">
                <div className="evi-shop-card-info">
                    <Text tag="h3" variant="text-md/semibold" color="text-strong" id={titleId} className="evi-shop-card-name">{bundle.name}</Text>
                    <div className="evi-shop-card-collapse">
                        <div className="evi-shop-card-meta">
                            <Text tag="span" variant="text-xs/medium" color="text-subtle" id={`${titleId}-kind`}>{cardLabel(bundle, kind)}</Text>
                            {wearing ? (
                                <span className="evi-shop-wearing"><Icon name="circleCheck" size={14} />{t("collectibles.wearing")}</span>
                            ) : <Price bundle={bundle} kind={kind} wallet={wallet} />}
                        </div>
                    </div>
                </div>
                <div className="evi-shop-card-buttons">
                    <div className="evi-shop-card-buttons-inner">
                        <Button
                            variant={wearing && !locked ? "secondary" : "accent"}
                            size="md"
                            disabled={busy}
                            aria-label={wearLabel ? t(wearing ? "collectibles.takeOffPart" : "collectibles.wearPart", { part: KIND_LABEL[kind as CollectibleKind](), name: bundle.name }) : undefined}
                            onClick={locked ? onOpen : onAct}
                        >
                            {action}
                        </Button>
                    </div>
                </div>
            </div>
        </article>
    );
}

// ---- the dialog ----

/** Where the dialog is: the bundle and its parts, asking before a purchase, short of Sparks, or just bought */
type Step =
    | { at: "parts"; }
    | { at: "confirm"; target: CardKind; price: number; save: number; }
    | { at: "short"; target: CardKind; need: number; have: number; }
    | { at: "bought"; target: CardKind; };

/** What buying `target` costs you now: a part's price, or the rest of the bundle's */
function priceOf(bundle: Bundle, target: CardKind, wallet: Wallet | undefined): { price: number; save: number; } | undefined {
    if (target === "bundle") {
        const offer = bundleOffer(bundle, wallet);
        return offer.state === "buy" ? { price: offer.price, save: offer.save } : undefined;
    }
    const offer = partOffer(bundle, target, wallet);
    return offer.state === "buy" ? { price: offer.price, save: 0 } : undefined;
}

/** "Sakura River", or "the Nameplate from Sakura River" */
function targetName(bundle: Bundle, target: CardKind) {
    return target === "bundle" ? bundle.name : t("sparks.partOf", { part: KIND_LABEL[target](), name: bundle.name });
}

function ProductDialog({ bundleId, kind, buy, onClosed }: { bundleId: string; kind: CardKind; buy: boolean; onClosed(): void; }) {
    useLocale();
    useStore(Collectibles.subscribe, Collectibles.getVersion);
    const exit = useExit(onClosed);
    const { ref, onKeyDown } = useModal(exit.close);
    const me = useMe();
    const link = useAccountLink();
    const supporter = useSupporter(me);
    const { busy, change } = useEquip(() => void link.check());
    const { wallet, linked } = useSparks(link);
    const bundle = Collectibles.bundle(bundleId);
    const playing = !reducedMotion();
    const [step, setStep] = React.useState<Step>({ at: "parts" });
    const [buying, setBuying] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const stepRef = React.useRef<HTMLDivElement>(null);
    const firstStep = React.useRef(true);

    // The list changed underneath and this bundle is gone
    React.useEffect(() => {
        if (!bundle) exit.close();
    }, [bundle, exit.close]);

    // Opened from a card's Buy: straight to asking, once the wallet is here
    const askedFirst = React.useRef(!buy);
    React.useEffect(() => {
        if (askedFirst.current || !bundle || !wallet) return;
        askedFirst.current = true;
        startBuying(kind);
    }, [wallet, bundle]);

    // A new step: its heading takes focus, so a screen reader hears where it is
    React.useEffect(() => {
        if (firstStep.current) return void (firstStep.current = false);
        const title = stepRef.current?.querySelector<HTMLElement>(".evi-shop-step-title");
        if (!title) return;
        title.tabIndex = -1;
        title.focus();
    }, [step]);

    if (!bundle || !me) return null;

    const worn = Collectibles.mine();
    const kinds = partsOf(bundle);
    const locked = bundle.tier === "supporter" && !supporter;
    const wearingMain = wears(bundle, kind, worn);
    const shownParts = kind === "bundle" ? kinds : [kind];
    const titleId = "evi-shop-dialog-title";
    const owned = ownedKinds(bundle, kind, wallet);
    const ownsMain = kind === "bundle" ? owned.length === kinds.length : owned.length > 0;
    const cost = priceOf(bundle, kind, wallet);

    const wear = (k: CardKind, on: boolean) => void change(`${bundle.id}:${k}`, changesFor(bundle, k, on, wallet));

    function startBuying(target: CardKind) {
        setError(undefined);
        const cost = priceOf(bundle!, target, Collectibles.wallet());
        if (!cost) return;
        const { enough, short } = afterBuying(Collectibles.wallet(), cost.price);
        setStep(enough ? { at: "confirm", target, ...cost } : { at: "short", target, need: cost.price, have: cost.price - short });
    }

    async function confirmBuy(target: CardKind, price: number) {
        if (buying) return;
        setBuying(true);
        setError(undefined);
        const result = await Collectibles.buy(bundle!.id, target === "bundle" ? undefined : target);
        setBuying(false);
        if (result.ok) return setStep({ at: "bought", target });
        if (result.unlinked) void link.check();
        if (result.code === "insufficient") return setStep({ at: "short", target, need: result.need ?? price, have: result.have ?? Collectibles.wallet()?.sparks ?? 0 });
        if (result.code === "owned") return setStep({ at: "bought", target });
        setError(refusalText(result));
    }

    const headPrice = () => {
        if (kind === "bundle") {
            const offer = bundleOffer(bundle, wallet);
            return (
                <>
                    {offer.state === "buy" ? <SparksAmount amount={offer.price} /> : <OfferLabel offer={offer.state === "owned" ? { state: "owned" } : { state: "code" }} />}
                    {offer.state === "buy" && offer.save > 0 && <Badge>{t("sparks.save", { amount: formatSparks(offer.save) })}</Badge>}
                </>
            );
        }
        return <OfferLabel offer={partOffer(bundle, kind, wallet)} />;
    };

    const parts = (
        <>
            <div className="evi-shop-dialog-head">
                <span className="evi-shop-hero-eyebrow evi-shop-dialog-eyebrow"><EviMark size={16} />{cardLabel(bundle, kind)}</span>
                <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId} className="evi-shop-step-title">{bundle.name}</Text>
                {bundle.description && <Text tag="p" variant="text-md/normal" color="text-subtle" id="evi-shop-dialog-text" className="evi-shop-dialog-text">{bundle.description}</Text>}
                <div className="evi-shop-dialog-price">
                    {bundle.tier === "supporter" && <SupportersPill />}
                    {headPrice()}
                </div>
            </div>

            <div className="evi-shop-dialog-parts">
                <Text tag="h3" variant="text-sm/semibold" color="text-subtle">{kinds.length > 1 ? t("collectiblesShop.inBundle") : t("sparks.thePart")}</Text>
                <ul aria-label={t("collectibles.parts", { name: bundle.name })}>
                    {kinds.map(k => {
                        const on = worn[k] === bundle.id;
                        const offer = partOffer(bundle, k, wallet);
                        return (
                            <li key={k} className="evi-shop-dialog-part" data-on={on ? "" : undefined}>
                                <PartThumb bundle={bundle} kind={k} />
                                <span className="evi-shop-dialog-part-label">
                                    <Text tag="span" variant="text-md/medium" color="text-strong">{KIND_LABEL[k]()}</Text>
                                    {on ? <span className="evi-shop-wearing"><Icon name="circleCheck" size={14} />{t("collectibles.wearing")}</span> : <OfferLabel offer={offer} />}
                                </span>
                                {linked && !locked && offer.state === "owned" && (
                                    <Button
                                        size="sm"
                                        disabled={!!busy}
                                        aria-label={t(on ? "collectibles.takeOffPart" : "collectibles.wearPart", { part: KIND_LABEL[k](), name: bundle.name })}
                                        onClick={() => wear(k, on)}
                                    >
                                        {t(on ? "collectibles.takeOff" : "collectibles.wear")}
                                    </Button>
                                )}
                                {linked && !locked && offer.state === "buy" && wallet && (
                                    <Button
                                        size="sm"
                                        aria-label={t("sparks.buyPart", { part: KIND_LABEL[k](), name: bundle.name, price: formatSparks(offer.price) })}
                                        onClick={() => startBuying(k)}
                                    >
                                        {t("sparks.buy")}
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div className="evi-shop-dialog-actions">
                {locked ? (
                    <Button variant="accent" size="md" icon="heart" onClick={() => { exit.close(); SettingsUI.open("general"); }}>{t("supporters.become")}</Button>
                ) : !linked ? (
                    link.state.kind !== "loading" && (
                        <div className="evi-shop-dialog-link">
                            <Text tag="p" variant="text-sm/medium" color="text-strong">{t("sparks.linkFirst")}</Text>
                            <AccountCard link={link} />
                        </div>
                    )
                ) : (
                    <>
                        {!ownsMain && cost && (
                            <Button variant="accent" size="md" disabled={!wallet} onClick={() => startBuying(kind)}>
                                {kind === "bundle"
                                    ? t(owned.length ? "sparks.buyRestFor" : "sparks.buyBundleFor", { price: formatSparks(cost.price) })
                                    : t("sparks.buyFor", { price: formatSparks(cost.price) })}
                            </Button>
                        )}
                        {!ownsMain && !cost && wallet && (
                            <>
                                <Text tag="p" variant="text-sm/normal" color="text-subtle">{t("sparks.codeOnlyHint")}</Text>
                                <Button variant="accent" size="md" onClick={() => openRedeem()}>{t("sparks.redeem")}</Button>
                            </>
                        )}
                        {(ownsMain || wearingMain) && (
                            <Button variant={wearingMain ? "secondary" : "accent"} size="md" disabled={!!busy} onClick={() => wear(kind, wearingMain)}>
                                {kind === "bundle" ? t(wearingMain ? "collectibles.takeOffBundle" : "collectibles.wearBundle") : t(wearingMain ? "collectibles.takeOff" : "collectibles.wear")}
                            </Button>
                        )}
                    </>
                )}
            </div>
        </>
    );

    const back = <Button size="md" onClick={() => { setError(undefined); setStep({ at: "parts" }); }}>{t("sparks.back")}</Button>;
    let content: React.ReactNode = parts;

    if (step.at === "confirm") {
        const have = wallet?.sparks ?? 0;
        content = (
            <div className="evi-shop-step">
                <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId} className="evi-shop-step-title">
                    {t("sparks.confirm.title", { name: targetName(bundle, step.target), price: formatSparks(step.price) })}
                </Text>
                <dl className="evi-shop-receipt">
                    <div><dt>{t("sparks.confirm.balance")}</dt><dd><SparksAmount amount={have} /></dd></div>
                    <div><dt>{t("sparks.confirm.price")}</dt><dd><SparksAmount amount={-step.price} /></dd></div>
                    <div className="evi-shop-receipt-total"><dt>{t("sparks.confirm.after")}</dt><dd><SparksAmount amount={Math.max(0, have - step.price)} /></dd></div>
                </dl>
                {step.save > 0 && <Text tag="p" variant="text-sm/medium" color="text-subtle">{t("sparks.confirm.saves", { amount: formatSparks(step.save) })}</Text>}
                {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}
                <div className="evi-shop-dialog-actions">
                    <Button variant="accent" size="md" disabled={buying} onClick={() => void confirmBuy(step.target, step.price)}>
                        {buying ? t("sparks.buying") : t("sparks.confirm.buy", { price: formatSparks(step.price) })}
                    </Button>
                    {back}
                </div>
            </div>
        );
    } else if (step.at === "short") {
        content = (
            <div className="evi-shop-step">
                <span className="evi-redeem-mark" aria-hidden="true"><SparkIcon size={28} /></span>
                <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId} className="evi-shop-step-title">
                    {t("sparks.short.title", { amount: formatSparks(Math.max(0, step.need - step.have)) })}
                </Text>
                <Text tag="p" variant="text-md/normal" color="text-subtle" className="evi-shop-dialog-text">
                    {t("sparks.short.text", { name: targetName(bundle, step.target), price: formatSparks(step.need), have: formatSparks(step.have) })}
                </Text>
                <ul className="evi-shop-ways">
                    <li><Icon name="link" size={16} /><Text tag="span" variant="text-sm/normal" color="text-default">{t("sparks.short.codes")}</Text></li>
                    <li><Icon name="heart" size={16} /><Text tag="span" variant="text-sm/normal" color="text-default">{t("sparks.short.supporters")}</Text></li>
                </ul>
                <div className="evi-shop-dialog-actions">
                    <Button variant="accent" size="md" onClick={() => openRedeem()}>{t("sparks.redeem")}</Button>
                    {!supporter && <Button size="md" icon="heart" onClick={() => { exit.close(); SettingsUI.open("general"); }}>{t("supporters.become")}</Button>}
                    {back}
                </div>
            </div>
        );
    } else if (step.at === "bought") {
        const target = step.target;
        const on = wears(bundle, target, worn);
        content = (
            <div className="evi-shop-step">
                <span className="evi-shop-bought-mark" aria-hidden="true"><Icon name="circleCheck" size={28} /></span>
                <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId} className="evi-shop-step-title">
                    {t("sparks.bought.title", { name: targetName(bundle, target) })}
                </Text>
                <Text tag="p" variant="text-md/normal" color="text-subtle" className="evi-shop-dialog-text">{t("sparks.bought.text")}</Text>
                <div className="evi-shop-dialog-actions">
                    {!on && (
                        <Button variant="accent" size="md" disabled={!!busy} onClick={() => { wear(target, false); setStep({ at: "parts" }); }}>
                            {target === "bundle" ? t("collectibles.wearBundle") : t("sparks.bought.wear")}
                        </Button>
                    )}
                    <Button size="md" onClick={() => setStep({ at: "parts" })}>{t("sparks.bought.done")}</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="dl-root" {...exit.closingProps}>
            <div className="dl-scrim dl-dialog-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && exit.close()}>
                <div className="evi-modal evi-shop-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={step.at === "parts" && bundle.description ? "evi-shop-dialog-text" : undefined} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
                    <FocusLayer containerRef={ref}>
                        <div className="evi-shop-dialog-preview" style={tint(bundle)} aria-hidden="true">
                            <MiniProfile bundle={bundle} me={me} playing={playing} parts={step.at === "parts" ? shownParts : step.target === "bundle" ? kinds : [step.target]} />
                        </div>
                        <div className="evi-shop-dialog-info">
                            <div className="evi-shop-dialog-close">
                                <IconButton icon="close" label={t("common.close")} onClick={exit.close} />
                            </div>
                            {linked && wallet && step.at === "parts" && (
                                <div className="evi-shop-dialog-balance">
                                    <span className="evi-balance-pill" aria-label={t("sparks.balanceLabel", { count: wallet.sparks, amount: formatSparks(wallet.sparks) })}>
                                        <SparkIcon size={14} />
                                        <span className="evi-sparks-amount" aria-hidden="true">{formatSparks(wallet.sparks)}</span>
                                    </span>
                                </div>
                            )}
                            <div className="evi-shop-step-wrap" key={step.at} ref={stepRef}>{content}</div>
                        </div>
                    </FocusLayer>
                </div>
            </div>
        </div>
    );
}
