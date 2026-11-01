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

// plugins/hide-personal-info/index.ts
var exports_hide_personal_info = {};
__export(exports_hide_personal_info, {
  default: () => hide_personal_info_default
});
module.exports = __toCommonJS(exports_hide_personal_info);
var import_api2 = require("@evi/api");

// plugins/hide-personal-info/detect.ts
var emptyKnown = () => ({ substrings: [], exact: [], phones: [] });
var EMAIL = /[\p{L}\p{N}._%+\-*•]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}/u;
var MASK = /(?:[*•●∙]{2,}[\s-]?){1,4}\d{2,4}\b/;
var ENDING_IN = /\bend(?:ing|s) in \d{4}\b/i;
var IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]|\.\d)/;
var IPV6_CANDIDATE = /(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
var PHONE_CANDIDATE = /(?<![\w.:/\-+])(?:\+|\b00)?\(?\d[\d\s().\-]{5,}\d(?![\w:/]|\.\d)/g;
var DATE_LIKE = /^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4})$/;
function isIpv6(candidate) {
  const doubles = candidate.split("::").length - 1;
  if (doubles > 1)
    return false;
  const groups = candidate.split(":").filter((g) => g !== "");
  if (groups.length === 0 || groups.some((g) => g.length > 4))
    return false;
  if (doubles === 0 && groups.length !== 8)
    return false;
  if (doubles === 1 && groups.length > 7)
    return false;
  return groups.some((g) => g.length >= 3 || /[a-f]/i.test(g));
}
function isPhone(raw) {
  const candidate = raw.trim();
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15)
    return false;
  if (DATE_LIKE.test(candidate))
    return false;
  const international = /^(?:\+|00)/.test(candidate);
  if (international)
    return digits.length >= 8;
  const groups = candidate.replace(/[()]/g, " ").split(/[\s.\-]+/).filter(Boolean);
  if (groups.length < 2)
    return false;
  const separators = new Set(candidate.replace(/[\d()]/g, "").replace(/\s+/g, " ").split(""));
  if (separators.size === 1 && separators.has(".") && groups.every((g) => g.length <= 3))
    return false;
  const areaCode = /^\(\d{2,5}\)/.test(candidate);
  if (areaCode)
    return digits.length >= 7;
  return digits.length >= 10 && groups.length <= 5 && groups.every((g) => g.length >= 2 && g.length <= 5);
}
var escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var wordPatterns = new Map;
function wordPattern(value) {
  let pattern = wordPatterns.get(value);
  if (pattern !== undefined)
    return pattern;
  const v = value.trim();
  pattern = v.length < 3 ? null : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(v)}(?![\\p{L}\\p{N}_])`, "iu");
  if (wordPatterns.size >= 500)
    wordPatterns.clear();
  wordPatterns.set(value, pattern);
  return pattern;
}
function containsWord(text, value) {
  return wordPattern(value)?.test(text) ?? false;
}
function matchesKnown(text, known) {
  if (known.substrings.some((v) => containsWord(text, v)))
    return true;
  const trimmed = text.trim().toLowerCase();
  if (trimmed && known.exact.some((v) => v.trim().length >= 2 && v.trim().toLowerCase() === trimmed))
    return true;
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 7) {
    for (const phone of known.phones) {
      const p = phone.replace(/\D/g, "");
      if (p.length >= 7 && (digits.includes(p) || digits.includes(p.slice(-7))))
        return true;
    }
  }
  return false;
}
function detectSensitive(text, known = emptyKnown()) {
  if (!text || !text.trim())
    return null;
  if (matchesKnown(text, known))
    return "known";
  if (EMAIL.test(text))
    return "email";
  if (MASK.test(text) || ENDING_IN.test(text))
    return "card";
  if (IPV4.test(text))
    return "ip";
  for (const m of text.matchAll(IPV6_CANDIDATE))
    if (isIpv6(m[0]))
      return "ip";
  for (const m of text.matchAll(PHONE_CANDIDATE))
    if (isPhone(m[0]))
      return "phone";
  return null;
}
var FIELD_TYPES = new Set(["text", "email", "tel", "search", "url"]);
function isTextField(tagName, type) {
  const tag = tagName.toUpperCase();
  return tag === "TEXTAREA" || tag === "INPUT" && FIELD_TYPES.has((type || "text").toLowerCase());
}
function collectKnown(src) {
  const known = emptyKnown();
  const add = (list, v) => {
    if (typeof v === "string" && v.trim() && !list.includes(v.trim()))
      list.push(v.trim());
  };
  const { user } = src;
  if (user) {
    add(known.substrings, user.email);
    add(known.phones, user.phone);
    add(known.substrings, user.username);
    if (user.username && user.discriminator && user.discriminator !== "0")
      add(known.substrings, `${user.username}#${user.discriminator}`);
  }
  for (const a of src.connectedAccounts ?? [])
    add(known.substrings, a?.name);
  for (const t of src.authorizedApps ?? [])
    add(known.exact, t?.application?.name);
  for (const s of src.sessions ?? []) {
    add(known.substrings, s?.client_info?.location);
    add(known.substrings, s?.client_info?.ip);
  }
  for (const p of Object.values(src.paymentSources ?? {})) {
    add(known.substrings, p?.email);
    for (const [key, value] of Object.entries(p?.billingAddress ?? {})) {
      if (key !== "country")
        add(known.substrings, value);
    }
  }
  return known;
}

// plugins/hide-personal-info/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.enabled": "Enabled",
    "settings.enabled.description": "Blur personal info in User Settings. /hidepersonal toggles this.",
    "settings.onlyStreamerMode": "Only in Streamer Mode",
    "settings.onlyStreamerMode.description": "Only blur while Discord's Streamer Mode is on, instead of always.",
    "settings.reveal": "Reveal",
    "settings.reveal.description": "How to see a blurred value.",
    "reveal.hover": "Hover to reveal",
    "reveal.click": "Click to reveal",
    "reveal.never": "Never",
    "toggle.on": "Personal info in User Settings is now blurred.",
    "toggle.off": "Personal info is no longer blurred.",
    "command.description": "Toggle blurring your personal info in User Settings"
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.enabled": "Aktiviert",
      "settings.enabled.description": "Verwischt persönliche Infos in den Nutzereinstellungen. Mit /hidepersonal schaltest du das um.",
      "settings.onlyStreamerMode": "Nur im Streamer-Modus",
      "settings.onlyStreamerMode.description": "Nur verwischen, solange der Streamer-Modus von Discord an ist, statt immer.",
      "settings.reveal": "Aufdecken",
      "settings.reveal.description": "Wie ein verwischter Wert sichtbar wird.",
      "reveal.hover": "Zum Aufdecken darüberfahren",
      "reveal.click": "Zum Aufdecken klicken",
      "reveal.never": "Nie",
      "toggle.on": "Persönliche Infos in den Nutzereinstellungen sind jetzt verwischt.",
      "toggle.off": "Persönliche Infos werden nicht mehr verwischt.",
      "command.description": "Verwischen deiner persönlichen Infos in den Nutzereinstellungen ein- oder ausschalten"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.enabled": "Activado",
      "settings.enabled.description": "Difumina tu información personal en Ajustes de usuario. /hidepersonal lo activa o desactiva.",
      "settings.onlyStreamerMode": "Solo en modo streamer",
      "settings.onlyStreamerMode.description": "Difuminar solo mientras el modo streamer de Discord esté activado, en lugar de siempre.",
      "settings.reveal": "Mostrar",
      "settings.reveal.description": "Cómo ver un valor difuminado.",
      "reveal.hover": "Pasar el ratón para mostrar",
      "reveal.click": "Hacer clic para mostrar",
      "reveal.never": "Nunca",
      "toggle.on": "Tu información personal en Ajustes de usuario ahora está difuminada.",
      "toggle.off": "Tu información personal ya no se difumina.",
      "command.description": "Activa o desactiva el difuminado de tu información personal en Ajustes de usuario"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.enabled": "Activé",
      "settings.enabled.description": "Floute tes informations personnelles dans les paramètres utilisateur. /hidepersonal l'active ou le désactive.",
      "settings.onlyStreamerMode": "Uniquement en mode streamer",
      "settings.onlyStreamerMode.description": "Ne flouter que lorsque le mode streamer de Discord est activé, au lieu de toujours.",
      "settings.reveal": "Affichage",
      "settings.reveal.description": "Comment voir une valeur floutée.",
      "reveal.hover": "Survoler pour afficher",
      "reveal.click": "Cliquer pour afficher",
      "reveal.never": "Jamais",
      "toggle.on": "Tes informations personnelles dans les paramètres utilisateur sont maintenant floutées.",
      "toggle.off": "Tes informations personnelles ne sont plus floutées.",
      "command.description": "Active ou désactive le floutage de tes informations personnelles dans les paramètres utilisateur"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.enabled": "有効",
      "settings.enabled.description": "ユーザー設定内の個人情報をぼかします。/hidepersonal で切り替えられます。",
      "settings.onlyStreamerMode": "配信者モードのときだけ",
      "settings.onlyStreamerMode.description": "常にではなく、Discord の配信者モードがオンのときだけぼかします。",
      "settings.reveal": "表示方法",
      "settings.reveal.description": "ぼかした内容を見る方法です。",
      "reveal.hover": "カーソルを合わせて表示",
      "reveal.click": "クリックして表示",
      "reveal.never": "表示しない",
      "toggle.on": "ユーザー設定内の個人情報をぼかしました。",
      "toggle.off": "個人情報のぼかしをオフにしました。",
      "command.description": "ユーザー設定内の個人情報のぼかしを切り替える"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.enabled": "Włączone",
      "settings.enabled.description": "Rozmywa dane osobowe w Ustawieniach użytkownika. Przełączysz to poleceniem /hidepersonal.",
      "settings.onlyStreamerMode": "Tylko w trybie streamera",
      "settings.onlyStreamerMode.description": "Rozmywaj tylko wtedy, gdy włączony jest tryb streamera Discorda, zamiast zawsze.",
      "settings.reveal": "Odsłanianie",
      "settings.reveal.description": "Jak zobaczyć rozmytą wartość.",
      "reveal.hover": "Najedź, aby odsłonić",
      "reveal.click": "Kliknij, aby odsłonić",
      "reveal.never": "Nigdy",
      "toggle.on": "Dane osobowe w Ustawieniach użytkownika są teraz rozmyte.",
      "toggle.off": "Dane osobowe nie są już rozmywane.",
      "command.description": "Włącz lub wyłącz rozmywanie danych osobowych w Ustawieniach użytkownika"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.enabled": "Ativado",
      "settings.enabled.description": "Desfoca suas informações pessoais nas Configurações de usuário. /hidepersonal ativa ou desativa.",
      "settings.onlyStreamerMode": "Só no modo streamer",
      "settings.onlyStreamerMode.description": "Desfocar só enquanto o modo streamer do Discord estiver ativado, em vez de sempre.",
      "settings.reveal": "Revelar",
      "settings.reveal.description": "Como ver um valor desfocado.",
      "reveal.hover": "Passe o mouse para revelar",
      "reveal.click": "Clique para revelar",
      "reveal.never": "Nunca",
      "toggle.on": "Suas informações pessoais nas Configurações de usuário agora estão desfocadas.",
      "toggle.off": "Suas informações pessoais não são mais desfocadas.",
      "command.description": "Ativa ou desativa o desfoque das suas informações pessoais nas Configurações de usuário"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.enabled": "Включено",
      "settings.enabled.description": "Размывает личные данные в настройках пользователя. Команда /hidepersonal включает и выключает это.",
      "settings.onlyStreamerMode": "Только в режиме стримера",
      "settings.onlyStreamerMode.description": "Размывать только при включённом режиме стримера Discord, а не всегда.",
      "settings.reveal": "Показ",
      "settings.reveal.description": "Как увидеть размытое значение.",
      "reveal.hover": "Показывать при наведении",
      "reveal.click": "Показывать по клику",
      "reveal.never": "Никогда",
      "toggle.on": "Личные данные в настройках пользователя теперь размыты.",
      "toggle.off": "Личные данные больше не размываются.",
      "command.description": "Включить или выключить размытие личных данных в настройках пользователя"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.enabled": "Etkin",
      "settings.enabled.description": "Kullanıcı Ayarları'ndaki kişisel bilgileri bulanıklaştırır. /hidepersonal ile açıp kapatabilirsin.",
      "settings.onlyStreamerMode": "Yalnızca Yayıncı Modu'nda",
      "settings.onlyStreamerMode.description": "Her zaman yerine yalnızca Discord'un Yayıncı Modu açıkken bulanıklaştır.",
      "settings.reveal": "Gösterme",
      "settings.reveal.description": "Bulanık bir değerin nasıl görüleceği.",
      "reveal.hover": "Göstermek için üzerine gel",
      "reveal.click": "Göstermek için tıkla",
      "reveal.never": "Asla",
      "toggle.on": "Kullanıcı Ayarları'ndaki kişisel bilgiler artık bulanık.",
      "toggle.off": "Kişisel bilgiler artık bulanıklaştırılmıyor.",
      "command.description": "Kullanıcı Ayarları'ndaki kişisel bilgilerin bulanıklaştırılmasını aç veya kapat"
    } })["tr"];
  }
});

// plugins/hide-personal-info/index.ts
var BLUR = "evi-hpi-blur";
var REVEALED = "evi-hpi-revealed";
var MODE_ATTR = "data-evi-hpi";
var CLASSIC_ROOT = '[class*="standardSidebarView_"]';
var DIALOG_ROOT = '[role="dialog"], [aria-modal="true"]';
var SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SVG", "CODE"]);
var settings = {
  enabled: {
    type: "boolean",
    get label() {
      return t("settings.enabled");
    },
    get description() {
      return t("settings.enabled.description");
    },
    default: true
  },
  onlyStreamerMode: {
    type: "boolean",
    get label() {
      return t("settings.onlyStreamerMode");
    },
    get description() {
      return t("settings.onlyStreamerMode.description");
    },
    default: false
  },
  reveal: {
    type: "select",
    get label() {
      return t("settings.reveal");
    },
    get description() {
      return t("settings.reveal.description");
    },
    default: "hover",
    options: [
      { get label() {
        return t("reveal.hover");
      }, value: "hover" },
      { get label() {
        return t("reveal.click");
      }, value: "click" },
      { get label() {
        return t("reveal.never");
      }, value: "never" }
    ]
  }
};
var context;
var modalOpen = false;
var observer;
var watcher;
var observedRoots = [];
var tagged = new Set;
function isActive() {
  if (!context?.settings.get("enabled"))
    return false;
  if (!context.settings.get("onlyStreamerMode"))
    return true;
  return !!import_api2.findStore("StreamerModeStore")?.enabled;
}
function rootSelector() {
  return modalOpen ? `${CLASSIC_ROOT}, ${DIALOG_ROOT}` : CLASSIC_ROOT;
}
function findRoots() {
  const roots = [...document.querySelectorAll(CLASSIC_ROOT)];
  if (modalOpen)
    roots.push(...document.querySelectorAll(DIALOG_ROOT));
  return roots.filter((r) => !roots.some((o) => o !== r && o.contains(r)));
}
function known() {
  const call = (fn) => {
    try {
      return fn();
    } catch {
      return;
    }
  };
  return collectKnown({
    user: call(() => import_api2.findStore("UserStore")?.getCurrentUser?.()),
    connectedAccounts: call(() => import_api2.findStore("ConnectedAccountsStore")?.getAccounts?.()),
    authorizedApps: call(() => import_api2.findStore("AuthorizedAppsStore")?.getNewestTokens?.()),
    sessions: call(() => import_api2.findStore("AuthSessionsStore")?.getSessions?.()),
    paymentSources: call(() => import_api2.findStore("PaymentSourceStore")?.paymentSources)
  });
}
function tag(el) {
  if (el.classList.contains(BLUR))
    return;
  el.classList.add(BLUR);
  tagged.add(el);
}
function untag(el) {
  el.classList.remove(BLUR, REVEALED);
  tagged.delete(el);
}
function isField(el) {
  return isTextField(el.tagName, el.type);
}
function checkField(el, values) {
  if (detectSensitive(el.value, values))
    tag(el);
  else if (tagged.has(el))
    untag(el);
}
function checkText(node, values) {
  const el = node.parentElement;
  if (!el || SKIP.has(el.tagName.toUpperCase()) || el.closest('[contenteditable="true"]'))
    return;
  if (detectSensitive(node.data, values))
    tag(el);
}
function scan(node, values) {
  if (node.nodeType === Node.TEXT_NODE)
    return checkText(node, values);
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE)
    return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode();text; text = walker.nextNode())
    checkText(text, values);
  if (node.nodeType === Node.ELEMENT_NODE && isField(node))
    checkField(node, values);
  for (const field of node.querySelectorAll("input, textarea")) {
    if (isField(field))
      checkField(field, values);
  }
}
function recheck(el, values) {
  if (!el.isConnected)
    return void tagged.delete(el);
  if (isField(el))
    return checkField(el, values);
  if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && detectSensitive(n.data, values)))
    untag(el);
}
function onMutations(records) {
  let read;
  const values = () => read ??= known();
  for (const r of records) {
    if (r.type === "characterData") {
      const el = r.target.parentElement;
      if (el && tagged.has(el))
        recheck(el, values());
      else
        checkText(r.target, values());
    } else if (r.type === "attributes") {
      const el = r.target;
      if (tagged.has(el) && !el.classList.contains(BLUR))
        el.classList.add(BLUR);
    } else {
      r.addedNodes.forEach((n) => n.isConnected && scan(n, values()));
      if (r.removedNodes.length && tagged.has(r.target))
        recheck(r.target, values());
    }
  }
  if (tagged.size > 50) {
    for (const el of tagged)
      if (!el.isConnected)
        tagged.delete(el);
  }
}
function onPageMutations(records) {
  if (observedRoots.length && !observedRoots.some((r) => r.isConnected))
    return refresh();
  const selector = rootSelector();
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType !== Node.ELEMENT_NODE || !n.isConnected)
        continue;
      const el = n;
      if (observedRoots.some((root) => root.contains(el)))
        continue;
      if (el.matches(selector) || el.firstElementChild && el.querySelector(selector))
        return refresh();
    }
  }
}
function onInput(e) {
  const el = e.target;
  if (!observer || !el || !isField(el) || !observedRoots.some((r) => r.contains(el)))
    return;
  checkField(el, known());
}
function disconnect() {
  observer?.disconnect();
  observer = undefined;
  watcher?.disconnect();
  watcher = undefined;
  observedRoots = [];
}
function cleanAll() {
  for (const el of document.querySelectorAll(`.${BLUR}, .${REVEALED}`))
    el.classList.remove(BLUR, REVEALED);
  tagged.clear();
}
function refresh() {
  disconnect();
  if (!context || !isActive()) {
    cleanAll();
    return;
  }
  const roots = findRoots();
  if (modalOpen || roots.length) {
    watcher = new MutationObserver(onPageMutations);
    watcher.observe(document.body, { childList: true, subtree: true });
  }
  if (!roots.length)
    return;
  const current = known();
  for (const el of tagged)
    recheck(el, current);
  observer = new MutationObserver(onMutations);
  for (const root of roots) {
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    scan(root, current);
  }
  observedRoots = roots;
}
function applyMode() {
  const mode = context?.settings.get("reveal") ?? "hover";
  document.documentElement.setAttribute(MODE_ATTR, mode);
  if (mode !== "click")
    for (const el of document.querySelectorAll(`.${REVEALED}`))
      el.classList.remove(REVEALED);
}
function onClick(e) {
  if (context?.settings.get("reveal") !== "click")
    return;
  const el = e.target?.closest?.(`.${BLUR}`);
  if (el)
    el.classList.toggle(REVEALED);
}
function toggle() {
  if (!context)
    return "";
  const enabled = !context.settings.get("enabled");
  context.settings.set("enabled", enabled);
  return enabled ? t("toggle.on") : t("toggle.off");
}
var hide_personal_info_default = import_api2.definePlugin({
  settings,
  toggle,
  detectSensitive,
  css: `
        .${BLUR} { filter: blur(6px); transition: filter 0.15s ease-out; }
        html[${MODE_ATTR}="hover"] .${BLUR}:hover,
        html[${MODE_ATTR}="click"] .${BLUR}.${REVEALED} { filter: none; }
        html[${MODE_ATTR}="click"] .${BLUR} { cursor: pointer; }
        html[${MODE_ATTR}="never"] .${BLUR}:not(input, textarea) { user-select: none; }
        @media (prefers-reduced-motion: reduce) { .${BLUR} { transition: none; } }
    `,
  start(ctx) {
    context = ctx;
    modalOpen = false;
    applyMode();
    document.addEventListener("click", onClick, true);
    document.addEventListener("input", onInput, true);
    ctx.onDispose(() => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("input", onInput, true);
      disconnect();
      cleanAll();
      document.documentElement.removeAttribute(MODE_ATTR);
      context = undefined;
      modalOpen = false;
    });
    ctx.flux.subscribe("USER_SETTINGS_MODAL_OPEN", () => {
      modalOpen = true;
      refresh();
    });
    for (const type of ["USER_SETTINGS_MODAL_CLOSE", "LOGOUT"]) {
      ctx.flux.subscribe(type, () => {
        modalOpen = false;
        refresh();
      });
    }
    ctx.setInterval(() => {
      if (observer || !isActive() || import_api2.findStore("LayerStore")?.hasLayers?.() === false)
        return;
      if (document.querySelector(CLASSIC_ROOT))
        refresh();
    }, 1500);
    ctx.settings.onChange(() => {
      applyMode();
      refresh();
    });
    const streamerMode = import_api2.findStore("StreamerModeStore");
    if (streamerMode?.addChangeListener) {
      let last = !!streamerMode.enabled;
      const onStreamerMode = () => {
        if (!!streamerMode.enabled === last)
          return;
        last = !!streamerMode.enabled;
        refresh();
      };
      streamerMode.addChangeListener(onStreamerMode);
      ctx.onDispose(() => streamerMode.removeChangeListener?.(onStreamerMode));
    }
    ctx.command({
      name: "hidepersonal",
      description: t("command.description"),
      execute: () => ({ ephemeral: toggle() })
    });
    refresh();
  }
});
