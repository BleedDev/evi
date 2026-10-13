/**
 * Sparks, Evi's own currency for collectibles (shared/sparks.ts), as Evi's Shop page and the
 * Collectibles settings page show it: an amount with its spark, your balance as a pill, what a part
 * offers you (a price, owned, or only with a code), and redeeming a code, with a small reveal of what
 * it gave. Shared by ui/CollectiblesShop.tsx and ui/CollectiblesTab.tsx; it imports neither.
 */
import { Bundle, CollectibleKind, Palette } from "@shared/collectibles";
import { Granted, PartOffer, Refusal, typedCode } from "@shared/sparks";

import { Collectibles, useWallet } from "../collectibles";
import { I18n, t, useLocale } from "../i18n";
import { createStyle } from "../styles";
import { openLayer } from "../toolkit/layer";
import { React } from "../webpack/common";
import { AccountCard, useAccountLink } from "./AccountTab";
import { Button, FocusLayer, Icon, IconButton, Notice, Text, TextField, useExit, useModal } from "./components";
import css from "./collectiblesShop.css" with { type: "text" };
import { SettingsUI } from "./index";
import { ensureStyles } from "./stylesheet";

let styled = false;
/** The Shop page's and the Sparks pieces' styles (collectiblesShop.css), once */
export function installShopStyles() {
    if (styled) return;
    styled = true;
    ensureStyles();
    createStyle(css, "evi-collectibles-shop");
}

/** Discord's nameplate palettes (its own colours, as it draws a nameplate's row) */
export const PALETTE_COLORS: Record<Palette, { dark: string; light: string; }> = {
    crimson: { dark: "#900007", light: "#E7040F" },
    berry: { dark: "#893A99", light: "#B11FCF" },
    sky: { dark: "#0080B7", light: "#56CCFF" },
    teal: { dark: "#086460", light: "#7DEED7" },
    forest: { dark: "#2D5401", light: "#6AA624" },
    bubble_gum: { dark: "#DC3E97", light: "#F957B3" },
    violet: { dark: "#730BC8", light: "#972FED" },
    cobalt: { dark: "#0131C2", light: "#4278FF" },
    clover: { dark: "#047B20", light: "#63CD5A" },
    lemon: { dark: "#F6CD12", light: "#FED400" },
    white: { dark: "#FFFFFF", light: "#FFFFFF" },
};

export const KIND_LABEL: Record<CollectibleKind, () => string> = {
    nameplate: () => t("collectibles.kind.nameplate"),
    decoration: () => t("collectibles.kind.decoration"),
    effect: () => t("collectibles.kind.effect"),
    frame: () => t("collectibles.kind.frame"),
};

/** The palette's colour behind a bundle's art, like Discord's shop tints a product's tile */
export function tint(bundle: Bundle) {
    const color = bundle.nameplate ? PALETTE_COLORS[bundle.nameplate.palette].dark : "#5865f2";
    return { "--evi-tint": color } as React.CSSProperties;
}

/** The small still that stands for one part */
export function partStill(bundle: Bundle, kind: CollectibleKind) {
    if (kind === "nameplate") return bundle.nameplate?.static;
    if (kind === "decoration") return bundle.decoration?.static;
    if (kind === "frame") return bundle.frame?.static;
    return bundle.effect?.thumbnail;
}

/** Small art for one part, in lists */
export function PartThumb({ bundle, kind, size }: { bundle: Bundle; kind: CollectibleKind; size?: number; }) {
    const src = Collectibles.file(partStill(bundle, kind));
    return (
        <span className="evi-shop-thumb" data-kind={kind} style={{ ...tint(bundle), ...size && { width: size, height: size } }}>
            {src && <img src={src} alt="" draggable={false} />}
        </span>
    );
}

export const formatSparks = (n: number) => n.toLocaleString(I18n.discordLocale);

/** Evi's spark: a four-pointed glint, in the Sparks colour */
export function SparkIcon({ size = 16, className }: { size?: number; className?: string; }) {
    return (
        <svg className={className ?? "evi-spark-icon"} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M12 1.5c.5 0 .9.33 1.03.8l1.3 4.66a4 4 0 0 0 2.71 2.71l4.66 1.3a1.07 1.07 0 0 1 0 2.06l-4.66 1.3a4 4 0 0 0-2.71 2.71l-1.3 4.66a1.07 1.07 0 0 1-2.06 0l-1.3-4.66a4 4 0 0 0-2.71-2.71l-4.66-1.3a1.07 1.07 0 0 1 0-2.06l4.66-1.3a4 4 0 0 0 2.71-2.71l1.3-4.66c.13-.47.54-.8 1.03-.8Z" />
        </svg>
    );
}

/** An amount of Sparks: the spark and the number, read out as "1,200 Sparks" */
export function SparksAmount({ amount, size = "md", sign }: { amount: number; size?: "sm" | "md" | "lg"; sign?: boolean; }) {
    const text = `${sign && amount > 0 ? "+" : ""}${formatSparks(amount)}`;
    return (
        <span className="evi-sparks" data-size={size}>
            <SparkIcon size={size === "lg" ? 22 : size === "sm" ? 14 : 16} />
            <span className="evi-sparks-amount" aria-hidden="true">{text}</span>
            <span className="dl-sr-only">{t("sparks.amount", { count: amount, amount: text })}</span>
        </span>
    );
}

/** What a part or a bundle offers you, on a card or a row: the price, owned, or codes only */
export function OfferLabel({ offer }: { offer: PartOffer; }) {
    if (offer.state === "owned") return <span className="evi-shop-owned"><Icon name="circleCheck" size={14} />{t("sparks.owned")}</span>;
    if (offer.state === "buy") return <SparksAmount amount={offer.price} />;
    return <Text tag="span" variant="text-sm/medium" color="text-subtle" className="evi-shop-code-only">{t("sparks.withCode")}</Text>;
}

/**
 * Your wallet for a page with Sparks: asked for again once this Evi is linked, if it isn't here (until
 * then it can't have one; after that, main hears of changes from evi.rest). Returns the wallet and
 * whether the page can buy at all.
 */
export function useSparks(link: ReturnType<typeof useAccountLink>) {
    const wallet = useWallet();
    const linked = link.state.kind === "linked";
    React.useEffect(() => {
        if (linked && !Collectibles.wallet()) void Collectibles.refreshWallet();
    }, [linked]);
    return { wallet, linked };
}

/** Your balance: a pill with the spark and the amount, and "Redeem a code" beside it */
export function BalancePill({ onImage }: { onImage?: boolean; }) {
    useLocale();
    const wallet = useWallet();
    return (
        <div className="evi-balance" data-on-image={onImage ? "" : undefined}>
            {wallet && (
                <span className="evi-balance-pill" role="status" aria-label={t("sparks.balanceLabel", { count: wallet.sparks, amount: formatSparks(wallet.sparks) })}>
                    <SparkIcon size={16} />
                    <span className="evi-sparks-amount" aria-hidden="true">{formatSparks(wallet.sparks)}</span>
                </span>
            )}
            <Button size="sm" onClick={() => openRedeem()}>{t("sparks.redeem")}</Button>
        </div>
    );
}

// ---- redeeming a code ----

export function openRedeem() {
    installShopStyles();
    openLayer(close => <RedeemDialog onClosed={() => close({ instant: true })} />);
}

/** What a refusal means, in Evi's words */
export function refusalText(why: Refusal): string {
    if (why.unlinked) return t("collectibles.needsLink");
    switch (why.code) {
        case "invalid_code": return t("sparks.redeem.invalid");
        case "expired": return t("sparks.redeem.expired");
        case "used_up": return t("sparks.redeem.usedUp");
        case "rate_limited": return t("sparks.tooMany");
        case "insufficient": return t("sparks.notEnough", { amount: formatSparks(Math.max(0, (why.need ?? 0) - (why.have ?? 0))) });
        case "owned": return t("sparks.alreadyOwned");
        case "not_for_sale": return t("sparks.notForSale");
        case "not_owned": return t("collectibles.notOwned");
        case "supporter": return t("collectibles.supportersHint");
        default: return t("collectibles.failed", { error: why.error });
    }
}

function RedeemDialog({ onClosed }: { onClosed(): void; }) {
    useLocale();
    const exit = useExit(onClosed);
    const { ref, onKeyDown } = useModal(exit.close);
    const link = useAccountLink();
    const linked = link.state.kind === "linked";
    const [code, setCode] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const [granted, setGranted] = React.useState<Granted>();
    const titleId = "evi-redeem-title";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        if (code.replace(/-/g, "").length < 4) {
            setError(t("sparks.redeem.invalid"));
            return;
        }
        setBusy(true);
        setError(undefined);
        const result = await Collectibles.redeem(code);
        setBusy(false);
        if (result.ok) setGranted(result.granted);
        else {
            if (result.unlinked) void link.check();
            setError(refusalText(result));
        }
    };

    return (
        <div className="dl-root" {...exit.closingProps}>
            <div className="dl-scrim dl-dialog-scrim evi-scrim" onMouseDown={e => e.target === e.currentTarget && exit.close()}>
                <div className="evi-modal evi-redeem" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
                    <FocusLayer containerRef={ref}>
                        <div className="evi-redeem-close"><IconButton icon="close" label={t("common.close")} onClick={exit.close} /></div>
                        {granted ? <Reveal granted={granted} titleId={titleId} onDone={exit.close} /> : (
                            <form className="evi-redeem-form" onSubmit={submit} noValidate>
                                <span className="evi-redeem-mark" aria-hidden="true"><SparkIcon size={28} /></span>
                                <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId}>{t("sparks.redeem.title")}</Text>
                                <Text tag="p" variant="text-md/normal" color="text-subtle" className="evi-redeem-text">{t("sparks.redeem.text")}</Text>
                                {!linked && link.state.kind !== "loading" ? (
                                    <div className="evi-shop-dialog-link">
                                        <Text tag="p" variant="text-sm/medium" color="text-strong">{t("sparks.linkFirst")}</Text>
                                        <AccountCard link={link} />
                                    </div>
                                ) : (
                                    <>
                                        <div className="evi-redeem-field" data-invalid={error ? "" : undefined}>
                                            <TextField
                                                id="evi-redeem-code"
                                                label={t("sparks.redeem.label")}
                                                value={code}
                                                onChange={v => {
                                                    setCode(typedCode(v));
                                                    if (error) setError(undefined);
                                                }}
                                                placeholder="EVI-XXXX-XXXX"
                                                inputMode="text"
                                                spellCheck={false}
                                            />
                                        </div>
                                        {error && <div role="alert" id="evi-redeem-error"><Notice tone="danger">{error}</Notice></div>}
                                        <Button type="submit" variant="accent" size="md" disabled={busy || !linked}>{busy ? t("sparks.redeem.busy") : t("sparks.redeem.submit")}</Button>
                                    </>
                                )}
                            </form>
                        )}
                    </FocusLayer>
                </div>
            </div>
        </div>
    );
}

/** What a code gave: the Sparks, then each item's art, revealed one after another */
function Reveal({ granted, titleId, onDone }: { granted: Granted; titleId: string; onDone(): void; }) {
    const items = granted.items.flatMap(item => {
        const bundle = Collectibles.bundle(item.bundle);
        if (!bundle) return [];
        const kinds = item.kinds.length ? item.kinds : (["nameplate", "decoration", "effect", "frame"] as CollectibleKind[]).filter(k => bundle[k]);
        return kinds.filter(k => bundle[k]).map(kind => ({ bundle, kind }));
    });
    const doneRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => doneRef.current?.querySelector("button")?.focus(), []);
    let i = 0;
    return (
        <div className="evi-reveal" role="status">
            <Text tag="h2" variant="heading-xl/bold" color="text-strong" id={titleId} className="evi-reveal-title">{t("sparks.redeem.gotTitle")}</Text>
            {granted.sparks > 0 && (
                <div className="evi-reveal-sparks evi-reveal-item" style={{ "--evi-i": i++ } as React.CSSProperties}>
                    <SparksAmount amount={granted.sparks} size="lg" sign />
                </div>
            )}
            {items.length > 0 && (
                <ul className="evi-reveal-items" aria-label={t("sparks.redeem.items")}>
                    {items.map(({ bundle, kind }) => (
                        <li key={`${bundle.id}:${kind}`} className="evi-reveal-item" style={{ "--evi-i": i++ } as React.CSSProperties}>
                            <PartThumb bundle={bundle} kind={kind} size={72} />
                            <span className="evi-reveal-label">
                                <Text tag="span" variant="text-md/semibold" color="text-strong">{bundle.name}</Text>
                                <Text tag="span" variant="text-sm/normal" color="text-subtle">{KIND_LABEL[kind]()}</Text>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {granted.sparks === 0 && items.length === 0 && <Text tag="p" variant="text-md/normal" color="text-subtle">{t("sparks.redeem.nothingNew")}</Text>}
            <div className="evi-reveal-actions" ref={doneRef}>
                {items.length > 0 && (
                    <Button variant="accent" size="md" onClick={() => { onDone(); SettingsUI.open("collectibles"); }}>{t("sparks.redeem.wearThem")}</Button>
                )}
                <Button size="md" onClick={onDone}>{t("sparks.redeem.done")}</Button>
            </div>
        </div>
    );
}
