var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// plugins/side-browser/index.tsx
var exports_side_browser = {};
__export(exports_side_browser, {
  default: () => side_browser_default
});
module.exports = __toCommonJS(exports_side_browser);
var import_api2 = require("@evi/api");

// plugins/side-browser/links.ts
var MODES = ["all", "modifier", "sites"];
var DISCORD_HOSTS = [
  "discord.com",
  "discordapp.com",
  "discord.gg",
  "discord.gift",
  "discord.new",
  "discord.co",
  "discordapp.net",
  "discord.media",
  "discord.dev",
  "dis.gd"
];
var MAX_URL = 8192;
function hostMatches(host, rule) {
  host = host.toLowerCase().replace(/\.$/, "");
  rule = rule.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return !!rule && (host === rule || host.endsWith("." + rule));
}
function isDiscordHost(host) {
  return DISCORD_HOSTS.some((rule) => hostMatches(host, rule));
}
function classifyUrl(raw) {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL)
    return { kind: "refused" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "refused" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { kind: "refused" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host)
    return { kind: "refused" };
  return { kind: isDiscordHost(host) ? "discord" : "web", href: url.href, host };
}
function ruleHost(line) {
  const text = line.trim().toLowerCase().replace(/^\*\./, "");
  if (!text || /\s/.test(text))
    return null;
  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : "http://" + text).hostname.replace(/\.$/, "");
  } catch {
    return null;
  }
  return host.includes(".") || host === "localhost" ? host : null;
}
function parseSiteRules(text) {
  const rules = { open: [], never: [] };
  if (typeof text !== "string")
    return rules;
  for (const raw of text.split(/[\n,]/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const never = line.startsWith("!");
    const host = ruleHost(never ? line.slice(1) : line);
    if (!host)
      continue;
    const list = never ? rules.never : rules.open;
    if (!list.includes(host))
      list.push(host);
  }
  return rules;
}
function opensInPanel(url, options) {
  const link = classifyUrl(url);
  if (link.kind !== "web" || !link.host)
    return false;
  const host = link.host;
  if (options.rules.never.some((rule) => hostMatches(host, rule)))
    return false;
  const modified = options.gesture === "modified" || options.gesture === "middle";
  if (options.mode === "modifier")
    return modified;
  const listed = options.mode === "all" || options.rules.open.some((rule) => hostMatches(host, rule));
  return modified ? !listed : listed;
}
function displayHost(url) {
  const link = classifyUrl(url);
  return link.host?.replace(/^www\./, "") ?? "";
}
var MIN_WIDTH = 320;
var DEFAULT_WIDTH = 480;
var MIN_CHAT = 360;
function clampWidth(width, available) {
  const wanted = typeof width === "number" && Number.isFinite(width) ? width : DEFAULT_WIDTH;
  const max = Math.max(MIN_WIDTH, Math.floor(available) - MIN_CHAT);
  return Math.round(Math.min(max, Math.max(MIN_WIDTH, wanted)));
}
function sameRect(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
function intersects(a, b) {
  return a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function samplePoints(rect, cols = 5, rows = 7, inset = 2) {
  const points = [];
  const w = rect.width - inset * 2, h = rect.height - inset * 2;
  if (w <= 0 || h <= 0)
    return points;
  for (let r = 0;r < rows; r++) {
    for (let c = 0;c < cols; c++) {
      points.push([
        rect.x + inset + (cols > 1 ? w * c / (cols - 1) : w / 2),
        rect.y + inset + (rows > 1 ? h * r / (rows - 1) : h / 2)
      ]);
    }
  }
  return points;
}

// plugins/side-browser/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.mode": "Links that open here",
    "settings.mode.description": "Ctrl+click or a middle click does the other thing: opens it in your browser, or here when it wouldn't. Discord's own links, like invites and messages, always open in Discord.",
    "settings.mode.all": "Every link",
    "settings.mode.modifier": "Only links I Ctrl+click or middle-click",
    "settings.mode.sites": "Only the sites in the list below",
    "settings.sites": "Sites",
    "settings.sites.description": 'One per line. With "Only the sites in the list below" these open here. A line starting with ! (like !github.com) always opens in your browser, whatever the setting above.',
    "settings.sites.placeholder": `youtube.com
!github.com`,
    "panel.label": "Side Browser",
    "panel.resize": "Resize the Side Browser",
    "panel.loading": "Loading…",
    "panel.crashed": "This page stopped working.",
    "panel.reload": "Reload",
    "panel.failed": "This page couldn't be opened.",
    "button.back": "Back",
    "button.forward": "Forward",
    "button.reload": "Reload",
    "button.stop": "Stop",
    "button.copy": "Copy Link",
    "button.external": "Open in Browser",
    "button.close": "Close",
    "toast.copied": "Link copied",
    "toast.download": "Downloads open in your browser",
    "menu.cut": "Cut",
    "menu.copy": "Copy",
    "menu.paste": "Paste",
    "menu.copyLink": "Copy Link",
    "menu.openLink": "Open Link in Browser",
    "menu.openPage": "Open Page in Browser"
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.mode": "Links, die sich hier öffnen",
      "settings.mode.description": "Strg+Klick oder ein Mittelklick macht das Gegenteil: öffnet den Link in deinem Browser oder hier, wenn er sich sonst nicht hier öffnen würde. Discords eigene Links wie Einladungen und Nachrichten öffnen sich immer in Discord.",
      "settings.mode.all": "Jeder Link",
      "settings.mode.modifier": "Nur Links, die ich mit Strg oder der mittleren Maustaste anklicke",
      "settings.mode.sites": "Nur die Seiten in der Liste unten",
      "settings.sites": "Seiten",
      "settings.sites.description": "Eine pro Zeile. Mit „Nur die Seiten in der Liste unten“ öffnen sich diese hier. Eine Zeile mit ! am Anfang (wie !github.com) öffnet sich immer in deinem Browser, egal was oben eingestellt ist.",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Seitenbrowser",
      "panel.resize": "Größe des Seitenbrowsers ändern",
      "panel.loading": "Wird geladen …",
      "panel.crashed": "Diese Seite funktioniert nicht mehr.",
      "panel.reload": "Neu laden",
      "panel.failed": "Diese Seite ließ sich nicht öffnen.",
      "button.back": "Zurück",
      "button.forward": "Vorwärts",
      "button.reload": "Neu laden",
      "button.stop": "Stopp",
      "button.copy": "Link kopieren",
      "button.external": "Im Browser öffnen",
      "button.close": "Schließen",
      "toast.copied": "Link kopiert",
      "toast.download": "Downloads öffnen sich in deinem Browser",
      "menu.cut": "Ausschneiden",
      "menu.copy": "Kopieren",
      "menu.paste": "Einfügen",
      "menu.copyLink": "Link kopieren",
      "menu.openLink": "Link im Browser öffnen",
      "menu.openPage": "Seite im Browser öffnen"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.mode": "Enlaces que se abren aquí",
      "settings.mode.description": "Ctrl+clic o un clic central hace lo contrario: lo abre en tu navegador, o aquí cuando no se abriría aquí. Los enlaces propios de Discord, como invitaciones y mensajes, siempre se abren en Discord.",
      "settings.mode.all": "Todos los enlaces",
      "settings.mode.modifier": "Solo los enlaces en los que hago Ctrl+clic o clic central",
      "settings.mode.sites": "Solo los sitios de la lista de abajo",
      "settings.sites": "Sitios",
      "settings.sites.description": "Uno por línea. Con «Solo los sitios de la lista de abajo» estos se abren aquí. Una línea que empieza con ! (como !github.com) siempre se abre en tu navegador, sea cual sea el ajuste de arriba.",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Navegador lateral",
      "panel.resize": "Cambiar el tamaño del navegador lateral",
      "panel.loading": "Cargando…",
      "panel.crashed": "Esta página ha dejado de funcionar.",
      "panel.reload": "Recargar",
      "panel.failed": "No se pudo abrir esta página.",
      "button.back": "Atrás",
      "button.forward": "Adelante",
      "button.reload": "Recargar",
      "button.stop": "Detener",
      "button.copy": "Copiar enlace",
      "button.external": "Abrir en el navegador",
      "button.close": "Cerrar",
      "toast.copied": "Enlace copiado",
      "toast.download": "Las descargas se abren en tu navegador",
      "menu.cut": "Cortar",
      "menu.copy": "Copiar",
      "menu.paste": "Pegar",
      "menu.copyLink": "Copiar enlace",
      "menu.openLink": "Abrir enlace en el navegador",
      "menu.openPage": "Abrir página en el navegador"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.mode": "Liens qui s'ouvrent ici",
      "settings.mode.description": "Ctrl+clic ou un clic du milieu fait l'inverse : ouvre le lien dans votre navigateur, ou ici s'il ne s'y serait pas ouvert. Les liens de Discord lui-même, comme les invitations et les messages, s'ouvrent toujours dans Discord.",
      "settings.mode.all": "Tous les liens",
      "settings.mode.modifier": "Seulement les liens sur lesquels je fais Ctrl+clic ou un clic du milieu",
      "settings.mode.sites": "Seulement les sites de la liste ci-dessous",
      "settings.sites": "Sites",
      "settings.sites.description": "Un par ligne. Avec « Seulement les sites de la liste ci-dessous », ceux-ci s'ouvrent ici. Une ligne qui commence par ! (comme !github.com) s'ouvre toujours dans votre navigateur, quel que soit le réglage ci-dessus.",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Navigateur latéral",
      "panel.resize": "Redimensionner le navigateur latéral",
      "panel.loading": "Chargement…",
      "panel.crashed": "Cette page a cessé de fonctionner.",
      "panel.reload": "Recharger",
      "panel.failed": "Impossible d'ouvrir cette page.",
      "button.back": "Précédent",
      "button.forward": "Suivant",
      "button.reload": "Recharger",
      "button.stop": "Arrêter",
      "button.copy": "Copier le lien",
      "button.external": "Ouvrir dans le navigateur",
      "button.close": "Fermer",
      "toast.copied": "Lien copié",
      "toast.download": "Les téléchargements s'ouvrent dans votre navigateur",
      "menu.cut": "Couper",
      "menu.copy": "Copier",
      "menu.paste": "Coller",
      "menu.copyLink": "Copier le lien",
      "menu.openLink": "Ouvrir le lien dans le navigateur",
      "menu.openPage": "Ouvrir la page dans le navigateur"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.mode": "ここで開くリンク",
      "settings.mode.description": "Ctrl+クリックまたは中クリックで逆の動作になります。ブラウザで開くか、通常ここで開かないリンクをここで開きます。招待やメッセージなどDiscord自身のリンクは、常にDiscordで開きます。",
      "settings.mode.all": "すべてのリンク",
      "settings.mode.modifier": "Ctrl+クリックまたは中クリックしたリンクだけ",
      "settings.mode.sites": "下のリストのサイトだけ",
      "settings.sites": "サイト",
      "settings.sites.description": "1行に1つ。「下のリストのサイトだけ」のとき、これらがここで開きます。!で始まる行(例: !github.com)は、上の設定にかかわらず常にブラウザで開きます。",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "サイドブラウザ",
      "panel.resize": "サイドブラウザのサイズを変更",
      "panel.loading": "読み込み中…",
      "panel.crashed": "このページは動作を停止しました。",
      "panel.reload": "再読み込み",
      "panel.failed": "このページを開けませんでした。",
      "button.back": "戻る",
      "button.forward": "進む",
      "button.reload": "再読み込み",
      "button.stop": "中止",
      "button.copy": "リンクをコピー",
      "button.external": "ブラウザで開く",
      "button.close": "閉じる",
      "toast.copied": "リンクをコピーしました",
      "toast.download": "ダウンロードはブラウザで開きます",
      "menu.cut": "切り取り",
      "menu.copy": "コピー",
      "menu.paste": "貼り付け",
      "menu.copyLink": "リンクをコピー",
      "menu.openLink": "リンクをブラウザで開く",
      "menu.openPage": "ページをブラウザで開く"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.mode": "Linki, które otwierają się tutaj",
      "settings.mode.description": "Ctrl+klik lub kliknięcie środkowym przyciskiem robi odwrotnie: otwiera link w przeglądarce albo tutaj, gdy normalnie by się tu nie otworzył. Własne linki Discorda, jak zaproszenia i wiadomości, zawsze otwierają się w Discordzie.",
      "settings.mode.all": "Każdy link",
      "settings.mode.modifier": "Tylko linki klikane z Ctrl lub środkowym przyciskiem",
      "settings.mode.sites": "Tylko strony z listy poniżej",
      "settings.sites": "Strony",
      "settings.sites.description": "Jedna w wierszu. Przy „Tylko strony z listy poniżej” te otwierają się tutaj. Wiersz zaczynający się od ! (np. !github.com) zawsze otwiera się w przeglądarce, niezależnie od ustawienia powyżej.",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Boczna przeglądarka",
      "panel.resize": "Zmień rozmiar bocznej przeglądarki",
      "panel.loading": "Wczytywanie…",
      "panel.crashed": "Ta strona przestała działać.",
      "panel.reload": "Odśwież",
      "panel.failed": "Nie udało się otworzyć tej strony.",
      "button.back": "Wstecz",
      "button.forward": "Dalej",
      "button.reload": "Odśwież",
      "button.stop": "Zatrzymaj",
      "button.copy": "Kopiuj link",
      "button.external": "Otwórz w przeglądarce",
      "button.close": "Zamknij",
      "toast.copied": "Skopiowano link",
      "toast.download": "Pobieranie otwiera się w przeglądarce",
      "menu.cut": "Wytnij",
      "menu.copy": "Kopiuj",
      "menu.paste": "Wklej",
      "menu.copyLink": "Kopiuj link",
      "menu.openLink": "Otwórz link w przeglądarce",
      "menu.openPage": "Otwórz stronę w przeglądarce"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.mode": "Links que abrem aqui",
      "settings.mode.description": "Ctrl+clique ou um clique do meio faz o contrário: abre no seu navegador, ou aqui quando não abriria aqui. Os links do próprio Discord, como convites e mensagens, sempre abrem no Discord.",
      "settings.mode.all": "Todos os links",
      "settings.mode.modifier": "Só os links em que eu der Ctrl+clique ou clique do meio",
      "settings.mode.sites": "Só os sites da lista abaixo",
      "settings.sites": "Sites",
      "settings.sites.description": 'Um por linha. Com "Só os sites da lista abaixo", estes abrem aqui. Uma linha que começa com ! (como !github.com) sempre abre no seu navegador, seja qual for a configuração acima.',
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Navegador lateral",
      "panel.resize": "Redimensionar o navegador lateral",
      "panel.loading": "Carregando…",
      "panel.crashed": "Esta página parou de funcionar.",
      "panel.reload": "Recarregar",
      "panel.failed": "Não foi possível abrir esta página.",
      "button.back": "Voltar",
      "button.forward": "Avançar",
      "button.reload": "Recarregar",
      "button.stop": "Parar",
      "button.copy": "Copiar link",
      "button.external": "Abrir no navegador",
      "button.close": "Fechar",
      "toast.copied": "Link copiado",
      "toast.download": "Downloads abrem no seu navegador",
      "menu.cut": "Recortar",
      "menu.copy": "Copiar",
      "menu.paste": "Colar",
      "menu.copyLink": "Copiar link",
      "menu.openLink": "Abrir link no navegador",
      "menu.openPage": "Abrir página no navegador"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.mode": "Какие ссылки открываются здесь",
      "settings.mode.description": "Ctrl+клик или нажатие средней кнопкой делает наоборот: открывает ссылку в браузере или здесь, если обычно она бы здесь не открылась. Ссылки самого Discord, например приглашения и сообщения, всегда открываются в Discord.",
      "settings.mode.all": "Все ссылки",
      "settings.mode.modifier": "Только ссылки, по которым я жму с Ctrl или средней кнопкой",
      "settings.mode.sites": "Только сайты из списка ниже",
      "settings.sites": "Сайты",
      "settings.sites.description": "По одному в строке. В режиме «Только сайты из списка ниже» они открываются здесь. Строка, начинающаяся с ! (например, !github.com), всегда открывается в браузере, независимо от настройки выше.",
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Боковой браузер",
      "panel.resize": "Изменить размер бокового браузера",
      "panel.loading": "Загрузка…",
      "panel.crashed": "Эта страница перестала работать.",
      "panel.reload": "Перезагрузить",
      "panel.failed": "Не удалось открыть эту страницу.",
      "button.back": "Назад",
      "button.forward": "Вперёд",
      "button.reload": "Перезагрузить",
      "button.stop": "Остановить",
      "button.copy": "Копировать ссылку",
      "button.external": "Открыть в браузере",
      "button.close": "Закрыть",
      "toast.copied": "Ссылка скопирована",
      "toast.download": "Загрузки открываются в браузере",
      "menu.cut": "Вырезать",
      "menu.copy": "Копировать",
      "menu.paste": "Вставить",
      "menu.copyLink": "Копировать ссылку",
      "menu.openLink": "Открыть ссылку в браузере",
      "menu.openPage": "Открыть страницу в браузере"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.mode": "Burada açılan bağlantılar",
      "settings.mode.description": "Ctrl+tıklama veya orta tıklama tersini yapar: bağlantıyı tarayıcında açar ya da normalde burada açılmayacaksa burada açar. Davetler ve mesajlar gibi Discord'un kendi bağlantıları her zaman Discord'da açılır.",
      "settings.mode.all": "Her bağlantı",
      "settings.mode.modifier": "Yalnızca Ctrl ile ya da orta tuşla tıkladığım bağlantılar",
      "settings.mode.sites": "Yalnızca aşağıdaki listedeki siteler",
      "settings.sites": "Siteler",
      "settings.sites.description": 'Her satıra bir tane. "Yalnızca aşağıdaki listedeki siteler" seçiliyken bunlar burada açılır. ! ile başlayan bir satır (örneğin !github.com), yukarıdaki ayar ne olursa olsun her zaman tarayıcında açılır.',
      "settings.sites.placeholder": `youtube.com
!github.com`,
      "panel.label": "Yan Tarayıcı",
      "panel.resize": "Yan Tarayıcıyı yeniden boyutlandır",
      "panel.loading": "Yükleniyor…",
      "panel.crashed": "Bu sayfa çalışmayı durdurdu.",
      "panel.reload": "Yenile",
      "panel.failed": "Bu sayfa açılamadı.",
      "button.back": "Geri",
      "button.forward": "İleri",
      "button.reload": "Yenile",
      "button.stop": "Durdur",
      "button.copy": "Bağlantıyı Kopyala",
      "button.external": "Tarayıcıda Aç",
      "button.close": "Kapat",
      "toast.copied": "Bağlantı kopyalandı",
      "toast.download": "İndirmeler tarayıcında açılır",
      "menu.cut": "Kes",
      "menu.copy": "Kopyala",
      "menu.paste": "Yapıştır",
      "menu.copyLink": "Bağlantıyı Kopyala",
      "menu.openLink": "Bağlantıyı Tarayıcıda Aç",
      "menu.openPage": "Sayfayı Tarayıcıda Aç"
    } })["tr"];
  }
});

// plugins/side-browser/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var settings = {
  mode: {
    type: "select",
    get label() {
      return t("settings.mode");
    },
    get description() {
      return t("settings.mode.description");
    },
    default: "all",
    options: [
      { get label() {
        return t("settings.mode.all");
      }, value: "all" },
      { get label() {
        return t("settings.mode.modifier");
      }, value: "modifier" },
      { get label() {
        return t("settings.mode.sites");
      }, value: "sites" }
    ]
  },
  sites: {
    type: "string",
    get label() {
      return t("settings.sites");
    },
    get description() {
      return t("settings.sites.description");
    },
    get placeholder() {
      return t("settings.sites.placeholder");
    },
    default: "",
    multiline: true
  }
};
var WIDTH_KEY = "width";
var CHECK_MS = 250;
var LAYER_CONTAINERS = '[class^="layerContainer_"], [class*=" layerContainer_"]';
var LAYERS = '[class^="layers_"], [class*=" layers_"]';
var context;
var mode = "all";
var rules = { open: [], never: [] };
var generation = 0;
var hosts = 0;
var middleClicks = new WeakSet;
var CLOSED = { phase: "closed", url: "", title: "", canGoBack: false, canGoForward: false, loading: false, crashed: false };
var state = CLOSED;
var listeners = new Set;
var subscribe = (fn) => (listeners.add(fn), () => void listeners.delete(fn));
var usePanel = () => import_api2.React.useSyncExternalStore(subscribe, () => state);
function setState(patch) {
  state = { ...state, ...patch };
  for (const fn of [...listeners])
    fn();
}
var holds = new Set;
var resync = null;
async function hold(reason) {
  holds.add(reason);
  await resync?.();
}
function release(reason) {
  if (holds.delete(reason))
    resync?.();
}
var storage = () => context?.settings;
function call(method, ...args) {
  const ctx = context;
  if (!ctx)
    return Promise.resolve(null);
  return ctx.native.call(method, ...args).catch((err) => {
    ctx.logger.warn(`${method} failed`, err);
    return null;
  });
}
function nativeLabels() {
  return {
    back: t("button.back"),
    forward: t("button.forward"),
    reload: t("button.reload"),
    cut: t("menu.cut"),
    copy: t("menu.copy"),
    paste: t("menu.paste"),
    copyLink: t("menu.copyLink"),
    openLink: t("menu.openLink"),
    openPage: t("menu.openPage"),
    failed: t("panel.failed")
  };
}
function panelBackground() {
  const probe = document.createElement("div");
  probe.className = "evi-sbrowser-probe";
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return /^rgba?\(/.test(color) && !/^rgba\(\d+, \d+, \d+, 0\)$/.test(color) ? color : undefined;
}
function gestureOf(event) {
  const native = event?.nativeEvent ?? event;
  if (!native || typeof native !== "object")
    return "none";
  if (native.view && native.view !== window)
    return null;
  if (middleClicks.has(native))
    return "middle";
  if (native.ctrlKey || native.metaKey)
    return "modified";
  return "click";
}
function wants(url, event, props) {
  if (!context || !hosts || typeof url !== "string")
    return false;
  if (typeof props?.onConfirm === "function")
    return false;
  const gesture = gestureOf(event);
  return !!gesture && opensInPanel(url, { mode, rules, gesture });
}
var closeRun = 0;
function openInPanel(url) {
  const link = classifyUrl(url);
  if (!context || !hosts || link.kind !== "web")
    return false;
  closeRun++;
  release("close");
  const href = link.href;
  const opening = state.phase !== "open";
  call("open", href, { labels: nativeLabels(), background: panelBackground() }).then(async (ok) => {
    if (ok === true)
      return;
    closePanel();
    if (await call("openExternal", href) !== true)
      window.open(href, "_blank", "noopener");
  });
  setState(opening ? { ...CLOSED, phase: "open", url: href, loading: true } : { url: href, title: "", loading: true, crashed: false });
  return true;
}
async function closePanel() {
  if (state.phase !== "open")
    return;
  const run = ++closeRun;
  await hold("close");
  if (run !== closeRun || state.phase !== "open")
    return;
  setState({ phase: "closing" });
}
function finishClose() {
  if (state.phase !== "closing")
    return;
  holds.delete("close");
  call("close");
  setState(CLOSED);
}
var discordLinkFilter = import_api2.filters.byCode("skipExtensionCheck", "APP_DIRECTORY_PROFILE");
var discordLinks;
function openDiscordLink(url) {
  try {
    discordLinks ??= import_api2.find(discordLinkFilter);
    const handler = discordLinks?.(url, { analyticsLocations: [] });
    if (typeof handler === "function" && handler(null))
      return;
  } catch (err) {
    context?.logger.warn("Discord's link handler failed", err);
  }
  call("openExternal", url);
}
function handle(ctx, event) {
  switch (event.type) {
    case "state":
      if (state.phase !== "open")
        return;
      setState({ url: event.url || state.url, title: event.title, canGoBack: event.canGoBack, canGoForward: event.canGoForward, loading: event.loading });
      break;
    case "discord":
      openDiscordLink(event.url);
      break;
    case "download":
      ctx.toast(t("toast.download"));
      break;
    case "gone":
      if (state.phase === "open")
        setState({ crashed: true, loading: false, canGoBack: false, canGoForward: false, url: event.url || state.url });
      break;
  }
}
async function listen(ctx, gen) {
  while (gen === generation) {
    let event;
    try {
      event = await ctx.native.call("nextEvent");
    } catch {
      if (gen !== generation)
        return;
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!event || gen !== generation)
      return;
    try {
      handle(ctx, event);
    } catch (err) {
      ctx.logger.error("Couldn't handle a page event", err);
    }
  }
}
function onAuxClick(event) {
  if (event.button !== 1 || !context || !hosts)
    return;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.target !== "_blank" || anchor.closest(".evi-sbrowser"))
    return;
  if (!opensInPanel(anchor.href, { mode, rules, gesture: "middle" }))
    return;
  event.preventDefault();
  event.stopPropagation();
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 });
  middleClicks.add(click);
  anchor.dispatchEvent(click);
}
function layerOver(el, rect, depth = 2) {
  if (el.checkVisibility?.({ visibilityProperty: true }) === false)
    return false;
  if (intersects(el.getBoundingClientRect(), rect))
    return true;
  if (depth > 1) {
    for (const child of el.children)
      if (layerOver(child, rect, depth - 1))
        return true;
  }
  return false;
}
function coverOf(body, rect) {
  for (const [x, y] of samplePoints(rect, 5, 7, 8)) {
    const hit = document.elementFromPoint(x, y);
    if (hit && !body.contains(hit))
      return hit;
  }
  for (const container of document.querySelectorAll(LAYER_CONTAINERS)) {
    for (const layer of container.children)
      if (layerOver(layer, rect))
        return layer;
  }
  for (const child of document.body.children) {
    if (child.hasAttribute("data-closing") && [...child.children].some((layer) => layerOver(layer, rect)))
      return child;
  }
  return null;
}
function describe(el) {
  const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (classes ? "." + classes : "");
}
function useNativeView(root, body, shot, active) {
  import_api2.React.useEffect(() => {
    const panel = root.current, el = body.current;
    if (!active || !context || !panel || !el)
      return;
    let disposed = false;
    let started = false;
    let visible = false;
    let want = false;
    let lastBounds = null;
    let running = null;
    let frame = 0;
    let lastCover = null;
    let coveredSince = 0;
    let reported = false;
    const showShot = async (src) => {
      const img = shot.current;
      if (!img)
        return;
      if (!src) {
        img.hidden = true;
        img.removeAttribute("src");
        return;
      }
      img.src = src;
      await img.decode().catch(() => {});
      img.hidden = false;
    };
    const settle = async () => {
      while (!disposed && visible !== want) {
        if (want) {
          await call("setVisible", true);
          visible = true;
          if (want)
            showShot(null);
        } else {
          const src = document.visibilityState === "visible" ? await call("snapshot") : null;
          if (src && !disposed)
            await showShot(src);
          await call("setVisible", false);
          visible = false;
        }
      }
    };
    const kick = () => {
      running ??= settle().finally(() => {
        running = null;
        if (!disposed && visible !== want)
          kick();
      });
      return running;
    };
    const sync = () => {
      if (disposed || !started)
        return Promise.resolve();
      const r = el.getBoundingClientRect();
      const bounds = { x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: window.innerWidth };
      if (!sameRect(bounds, lastBounds) || bounds.viewportWidth !== lastBounds?.viewportWidth) {
        lastBounds = bounds;
        call("setBounds", bounds);
      }
      const onScreen = !holds.size && document.visibilityState === "visible" && bounds.width > 0 && bounds.height > 0;
      const cover = onScreen ? coverOf(el, bounds) : null;
      want = onScreen && !cover;
      if (cover !== lastCover) {
        lastCover = cover;
        coveredSince = performance.now();
      } else if (cover && !reported && performance.now() - coveredSince > 15000) {
        reported = true;
        context?.logger.info("The page has been hidden for a while, behind", describe(cover));
      }
      return kick();
    };
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          sync();
        });
    };
    const observed = new WeakSet;
    const mutations = new MutationObserver(schedule);
    const watch = () => {
      for (const target of [document.body, ...document.querySelectorAll(LAYER_CONTAINERS), ...document.querySelectorAll(LAYERS)]) {
        if (observed.has(target))
          continue;
        observed.add(target);
        mutations.observe(target, { childList: true });
      }
    };
    watch();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    const timer = setInterval(() => {
      watch();
      sync();
    }, CHECK_MS);
    import_api2.exitDone(panel).then(() => {
      if (disposed)
        return;
      started = true;
      resync = sync;
      sync();
    });
    return () => {
      disposed = true;
      if (resync === sync)
        resync = null;
      cancelAnimationFrame(frame);
      clearInterval(timer);
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      if (visible || running)
        call("setVisible", false);
    };
  }, [active]);
}
var ICONS = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  forward: "M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4v-2z",
  reload: "M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  link: "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z",
  external: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"
};
function Icon({ path, size = 20 }) {
  return /* @__PURE__ */ jsx_runtime.jsx("svg", {
    "aria-hidden": "true",
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
      fill: "currentColor",
      d: path
    })
  });
}
function HeaderButton({ label, icon, onClick, disabled }) {
  const button = /* @__PURE__ */ jsx_runtime.jsx("button", {
    type: "button",
    className: "evi-sbrowser-button",
    "aria-label": label,
    disabled,
    onClick,
    children: /* @__PURE__ */ jsx_runtime.jsx(Icon, {
      path: icon
    })
  });
  const Tooltip = import_api2.Components.Tooltip;
  return Tooltip && !disabled ? /* @__PURE__ */ jsx_runtime.jsx(Tooltip, {
    text: label,
    position: "top",
    children: button
  }) : button;
}
function storedWidth() {
  const width = storage()?.get(WIDTH_KEY);
  return typeof width === "number" && Number.isFinite(width) ? width : DEFAULT_WIDTH;
}
function SidePanel({ s }) {
  import_api2.useLocale();
  const rootRef = import_api2.React.useRef(null);
  const bodyRef = import_api2.React.useRef(null);
  const shotRef = import_api2.React.useRef(null);
  const [width, setWidth] = import_api2.React.useState(storedWidth);
  const [available, setAvailable] = import_api2.React.useState(Infinity);
  const [resizing, setResizing] = import_api2.React.useState(false);
  const closing = s.phase === "closing";
  const shown = clampWidth(width, available);
  const shownRef = import_api2.React.useRef(shown);
  shownRef.current = shown;
  useNativeView(rootRef, bodyRef, shotRef, !closing && !s.crashed);
  import_api2.React.useEffect(() => {
    if (!closing)
      return;
    let live = true;
    import_api2.exitDone(rootRef.current).then(() => live && finishClose());
    return () => void (live = false);
  }, [closing]);
  import_api2.React.useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent)
      return;
    const measure = () => setAvailable(parent.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const resizeTo = (next) => setWidth(clampWidth(next, available));
  const save = () => storage()?.set(WIDTH_KEY, shownRef.current);
  const onPointerDown = (e) => {
    if (e.button !== 0)
      return;
    e.preventDefault();
    const handle2 = e.currentTarget;
    const startX = e.clientX, startWidth = shown;
    handle2.setPointerCapture(e.pointerId);
    setResizing(true);
    hold("resize");
    const move = (ev) => resizeTo(startWidth + startX - ev.clientX);
    const up = () => {
      handle2.removeEventListener("pointermove", move);
      handle2.removeEventListener("pointerup", up);
      handle2.removeEventListener("pointercancel", up);
      setResizing(false);
      save();
      release("resize");
    };
    handle2.addEventListener("pointermove", move);
    handle2.addEventListener("pointerup", up);
    handle2.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight")
      return;
    e.preventDefault();
    resizeTo(shown + (e.key === "ArrowLeft" ? step : -step));
  };
  const onKeyUp = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight")
      save();
  };
  const host = displayHost(s.url);
  const secure = s.url.startsWith("https:");
  const copy = () => {
    navigator.clipboard.writeText(s.url).then(() => context?.toast(t("toast.copied"), { type: "success" }), () => {});
  };
  let placeholder = null;
  if (s.crashed) {
    placeholder = /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-sbrowser-placeholder",
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("panel.crashed")
        }),
        /* @__PURE__ */ jsx_runtime.jsx("button", {
          type: "button",
          className: "evi-sbrowser-retry",
          onClick: () => openInPanel(s.url),
          children: t("panel.reload")
        })
      ]
    });
  } else if (s.loading) {
    placeholder = /* @__PURE__ */ jsx_runtime.jsx("div", {
      className: "evi-sbrowser-placeholder",
      children: /* @__PURE__ */ jsx_runtime.jsx("p", {
        children: t("panel.loading")
      })
    });
  }
  return /* @__PURE__ */ jsx_runtime.jsxs("aside", {
    ref: rootRef,
    className: "evi-sbrowser",
    "aria-label": t("panel.label"),
    style: { width: shown },
    "data-closing": closing ? "" : undefined,
    "data-resizing": resizing ? "" : undefined,
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-sbrowser-resize",
        role: "separator",
        "aria-orientation": "vertical",
        "aria-label": t("panel.resize"),
        "aria-valuenow": shown,
        tabIndex: 0,
        onPointerDown,
        onKeyDown,
        onKeyUp
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("header", {
        className: "evi-sbrowser-header",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.back"),
            icon: ICONS.back,
            disabled: !s.canGoBack,
            onClick: () => void call("go", "back")
          }),
          /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.forward"),
            icon: ICONS.forward,
            disabled: !s.canGoForward,
            onClick: () => void call("go", "forward")
          }),
          s.loading && !s.crashed ? /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.stop"),
            icon: ICONS.close,
            onClick: () => void call("go", "stop")
          }) : /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.reload"),
            icon: ICONS.reload,
            onClick: () => s.crashed ? openInPanel(s.url) : void call("go", "reload")
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            className: "evi-sbrowser-titles",
            title: s.url,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("div", {
                className: "evi-sbrowser-title",
                children: s.title || host
              }),
              /* @__PURE__ */ jsx_runtime.jsxs("div", {
                className: "evi-sbrowser-host",
                children: [
                  secure && /* @__PURE__ */ jsx_runtime.jsx(Icon, {
                    path: ICONS.lock,
                    size: 12
                  }),
                  /* @__PURE__ */ jsx_runtime.jsx("span", {
                    children: host
                  })
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.copy"),
            icon: ICONS.link,
            disabled: !s.url,
            onClick: copy
          }),
          /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.external"),
            icon: ICONS.external,
            disabled: !s.url,
            onClick: () => void call("openExternal", s.url)
          }),
          /* @__PURE__ */ jsx_runtime.jsx(HeaderButton, {
            label: t("button.close"),
            icon: ICONS.close,
            onClick: () => void closePanel()
          }),
          s.loading && !s.crashed && /* @__PURE__ */ jsx_runtime.jsx("div", {
            className: "evi-sbrowser-progress",
            "aria-hidden": "true"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        ref: bodyRef,
        className: "evi-sbrowser-body",
        children: [
          placeholder,
          /* @__PURE__ */ jsx_runtime.jsx("img", {
            ref: shotRef,
            className: "evi-sbrowser-snapshot",
            alt: "",
            hidden: true
          })
        ]
      })
    ]
  });
}
function PanelHost() {
  const s = usePanel();
  const markerRef = import_api2.React.useRef(null);
  const [usable, setUsable] = import_api2.React.useState(false);
  import_api2.React.useEffect(() => {
    const parent = markerRef.current?.parentElement;
    const style = parent && getComputedStyle(parent);
    if (!style || !style.display.endsWith("flex") || style.flexDirection !== "row" || parent.ownerDocument !== document) {
      context?.logger.warn("The chat isn't laid out as expected, links open in the browser", style?.display, style?.flexDirection);
      return;
    }
    hosts++;
    setUsable(true);
    return () => void hosts--;
  }, []);
  return /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("i", {
        ref: markerRef,
        className: "evi-sbrowser-marker",
        hidden: true
      }),
      usable && s.phase !== "closed" && /* @__PURE__ */ jsx_runtime.jsx(SidePanel, {
        s
      })
    ]
  });
}
var css = `
.evi-sbrowser { position: relative; flex: 0 0 auto; align-self: stretch; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; box-sizing: border-box;
  background: var(--background-base-lower, var(--background-secondary, #2b2d31)); border-left: 1px solid var(--border-subtle, var(--background-modifier-accent, transparent));
  color: var(--text-default, var(--text-normal, #dbdee1)); font-family: var(--font-primary); }
.evi-sbrowser-marker { display: none !important; }
.evi-sbrowser-probe { position: fixed; width: 0; height: 0; background: var(--background-base-lower, var(--background-secondary, #2b2d31)); }
.evi-sbrowser[data-closing] { pointer-events: none; }
@media (prefers-reduced-motion: no-preference) {
  :root:not(.reduce-motion) .evi-sbrowser { animation: evi-sbrowser-in var(--evi-modal-in, 230ms) var(--evi-spring-in, ease-out); }
  :root:not(.reduce-motion) .evi-sbrowser[data-closing] { animation: evi-sbrowser-out var(--evi-modal-out, 200ms) var(--evi-spring-out, ease-in) forwards; }
}
@keyframes evi-sbrowser-in { from { opacity: 0; translate: 24px 0; } }
@keyframes evi-sbrowser-out { to { opacity: 0; translate: 24px 0; } }
.evi-sbrowser-resize { position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: 6px; cursor: ew-resize; touch-action: none; outline: none; }
.evi-sbrowser-resize:focus-visible { box-shadow: inset 2px 0 0 var(--focus-primary, #00b0f4); }
.evi-sbrowser[data-resizing] { user-select: none; }
.evi-sbrowser-header { position: relative; flex: none; display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 8px 0 10px; box-sizing: border-box;
  border-bottom: 1px solid var(--border-subtle, var(--background-modifier-accent, transparent)); }
.evi-sbrowser-button { flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer;
  color: var(--interactive-icon-default, var(--interactive-normal, #b5bac1)); }
.evi-sbrowser-button:hover:not(:disabled) { color: var(--interactive-icon-hover, var(--interactive-hover, #dbdee1)); }
.evi-sbrowser-button:active:not(:disabled) { color: var(--interactive-icon-active, var(--interactive-active, #fff)); }
.evi-sbrowser-button:disabled { opacity: .3; cursor: default; }
.evi-sbrowser-button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: -2px; }
.evi-sbrowser-titles { flex: 1 1 auto; min-width: 0; padding: 0 6px; display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.evi-sbrowser-title, .evi-sbrowser-host { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.evi-sbrowser-title { font-size: 14px; line-height: 18px; font-weight: 600; color: var(--header-primary, var(--text-strong, #f2f3f5)); }
.evi-sbrowser-host { display: flex; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: var(--text-muted, #949ba4); }
.evi-sbrowser-host svg { flex: none; }
.evi-sbrowser-host span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.evi-sbrowser-progress { position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; overflow: hidden; pointer-events: none; }
.evi-sbrowser-progress::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%; background: var(--brand-500, #5865f2); animation: evi-sbrowser-progress 1.2s ease-in-out infinite; }
@keyframes evi-sbrowser-progress { from { translate: -100% 0; } to { translate: 250% 0; } }
.evi-sbrowser-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
.evi-sbrowser-snapshot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: left top; pointer-events: none; }
.evi-sbrowser-snapshot[hidden] { display: none; }
.evi-sbrowser-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px;
  text-align: center; font-size: 14px; line-height: 20px; color: var(--text-muted, #949ba4); }
.evi-sbrowser-placeholder p { margin: 0; }
.evi-sbrowser-retry { min-height: 32px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer;
  background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); }
.evi-sbrowser-retry:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
.evi-sbrowser-retry:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
`;
var side_browser_default = import_api2.definePlugin({
  settings,
  patches: [
    {
      find: "isProtocol:!0,contextKey:",
      replace: [
        {
          match: /(\.isTrustedProtocol\((\i)\)\))return void\((?=null==\i\|\|)/,
          with: "$1return void($self?.openTrusted?.($2,arguments[1],arguments[0])?0:"
        },
        {
          match: /(?<=let \i=\(0,\i\.\i\)\((\i)\),\i=null!=\i\?\i\.displayTarget:\i;\i\.show\(\{url:\i,trustUrl:\i,onConfirm:)(\i)(?=,onCancel:\i,isProtocol:!1)/,
          with: "$self?.confirmed?.($2,$1,arguments[1],arguments[0])??$2"
        }
      ]
    },
    {
      find: "this.renderThreadSidebar()]",
      replace: {
        match: /this\.renderThreadSidebar\(\)(?=\])/,
        with: "this.renderThreadSidebar(),$self?.renderPanel?.()"
      }
    }
  ],
  openTrusted(url, event, props) {
    try {
      if (!wants(url, event, props))
        return false;
      if (!openInPanel(url))
        return false;
      event?.preventDefault?.();
      return true;
    } catch (err) {
      context?.logger.error("Couldn't open the link here", err);
      return false;
    }
  },
  confirmed(open, url, event, props) {
    try {
      if (typeof open !== "function" || !wants(url, event, props))
        return;
      return () => {
        try {
          if (openInPanel(url))
            return;
        } catch (err) {
          context?.logger.error("Couldn't open the link here", err);
        }
        open();
      };
    } catch {
      return;
    }
  },
  renderPanel() {
    return context ? /* @__PURE__ */ jsx_runtime.jsx(PanelHost, {}, "evi-side-browser") : null;
  },
  start(ctx) {
    context = ctx;
    const apply = (values) => {
      mode = MODES.includes(values.mode) ? values.mode : "all";
      rules = parseSiteRules(values.sites);
    };
    apply({ mode: ctx.settings.get("mode"), sites: ctx.settings.get("sites") });
    ctx.settings.onChange(apply);
    ctx.addStyle(css);
    document.addEventListener("auxclick", onAuxClick, true);
    const gen = ++generation;
    listen(ctx, gen);
    ctx.native.call("close").catch(() => {});
    ctx.onDispose(() => {
      document.removeEventListener("auxclick", onAuxClick, true);
      holds.clear();
      resync = null;
      closeRun++;
      setState(CLOSED);
      context = undefined;
    });
  },
  stop(ctx) {
    generation++;
    ctx.native.call("close").catch(() => {});
    ctx.native.call("cancelWait").catch(() => {});
  }
});
