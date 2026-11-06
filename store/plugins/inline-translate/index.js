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

// plugins/inline-translate/index.tsx
var exports_inline_translate = {};
__export(exports_inline_translate, {
  default: () => inline_translate_default
});
module.exports = __toCommonJS(exports_inline_translate);
var import_api2 = require("@evi/api");

// plugins/inline-translate/translate.ts
var ALIASES = { iw: "he", jw: "jv", in: "id", ji: "yi", fil: "tl", nb: "no" };
function normalizeLanguage(code) {
  if (!code)
    return;
  const m = /^([a-z]{2,3})(?:[-_]([a-z]{2,4}))?$/i.exec(code.trim());
  if (!m)
    return;
  const base = m[1].toLowerCase();
  if (base === "zh") {
    const region = m[2]?.toUpperCase();
    return region === "TW" || region === "HK" || region === "MO" || region === "HANT" ? "zh-TW" : "zh-CN";
  }
  return ALIASES[base] ?? base;
}
function googleLanguage(locale) {
  return normalizeLanguage(locale) ?? "en";
}
function sameLanguage(a, b) {
  const x = normalizeLanguage(a);
  const y = normalizeLanguage(b);
  return !!x && x === y;
}
function parseLanguageList(input) {
  const out = [];
  for (const part of (input ?? "").split(/[\s,;|/]+/)) {
    const code = normalizeLanguage(part);
    if (code && !out.includes(code))
      out.push(code);
  }
  return out;
}
function languageName(code, uiLocale) {
  try {
    const name = new Intl.DisplayNames(uiLocale ? [uiLocale] : undefined, { type: "language" }).of(normalizeLanguage(code) ?? code);
    if (name && name !== code)
      return name;
  } catch {}
  return code;
}
var PROTECTED = new RegExp([
  "```[\\s\\S]*?```",
  "`[^`\\n]+`",
  "<https?:\\/\\/[^\\s>]+>",
  "https?:\\/\\/[^\\s<>]+",
  "<(?:@[!&]?|#)\\d+>",
  "<a?:\\w+:\\d+>",
  "<t:-?\\d+(?::[tTdDfFR])?>",
  "<\\/[\\w -]+:\\d+>",
  "<id:\\w+>",
  ":[\\w+-]+:",
  "@(?:everyone|here)\\b"
].join("|"), "g");
var EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200D\uFE0F\u20E3]/gu;
var PLACEHOLDER = (i) => `⟦${i}⟧`;
var PLACEHOLDER_RE = /⟦\s*(\d+)\s*⟧/g;
function protect(text) {
  const tokens = [];
  const out = text.replace(PROTECTED, (token) => {
    tokens.push(token);
    return PLACEHOLDER(tokens.length - 1);
  });
  return { text: out, tokens };
}
function restore(translated, tokens) {
  const used = new Set;
  let out = translated.replace(PLACEHOLDER_RE, (whole, n) => {
    const i = Number(n);
    if (!(i in tokens))
      return whole;
    used.add(i);
    return tokens[i];
  });
  const missing = tokens.filter((_, i) => !used.has(i));
  if (missing.length)
    out = [out.trimEnd(), ...missing].join(missing.some((t) => t.startsWith("```")) ? `
` : " ");
  return out;
}
function translatableText(text) {
  return text.replace(PROTECTED, " ").replace(EMOJI, " ").replace(/[^\p{L}\p{M}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
var translatable = new Map;
var TRANSLATABLE_CACHE_SIZE = 1000;
function isTranslatable(text) {
  if (!text)
    return false;
  let answer = translatable.get(text);
  if (answer !== undefined)
    return answer;
  answer = /\p{L}[^]*\p{L}/u.test(translatableText(text));
  if (translatable.size >= TRANSLATABLE_CACHE_SIZE)
    translatable.delete(translatable.keys().next().value);
  translatable.set(text, answer);
  return answer;
}
var SCRIPT_TESTS = [
  ["japanese", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["cjk", /\p{Script=Han}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["thai", /\p{Script=Thai}/u],
  ["devanagari", /\p{Script=Devanagari}/u]
];
var LANGUAGE_SCRIPTS = {
  ja: ["japanese", "cjk"],
  "zh-CN": ["cjk"],
  "zh-TW": ["cjk"],
  ko: ["hangul", "cjk"],
  ru: ["cyrillic"],
  uk: ["cyrillic"],
  bg: ["cyrillic"],
  be: ["cyrillic"],
  mk: ["cyrillic"],
  kk: ["cyrillic"],
  ky: ["cyrillic"],
  mn: ["cyrillic"],
  sr: ["cyrillic", "latin"],
  tg: ["cyrillic"],
  el: ["greek"],
  ar: ["arabic"],
  fa: ["arabic"],
  ur: ["arabic"],
  ps: ["arabic"],
  he: ["hebrew"],
  yi: ["hebrew"],
  th: ["thai"],
  hi: ["devanagari"],
  mr: ["devanagari"],
  ne: ["devanagari"]
};
function scriptsIn(text) {
  const found = new Set;
  for (const ch of translatableText(text)) {
    if (!/\p{L}/u.test(ch))
      continue;
    if (/\p{Script=Latin}/u.test(ch))
      found.add("latin");
    else
      found.add(SCRIPT_TESTS.find(([, re]) => re.test(ch))?.[0] ?? "other");
  }
  return found;
}
function mightBeIn(text, languages) {
  const present = scriptsIn(text);
  if (!present.size)
    return false;
  return languages.some((lang) => {
    const scripts = LANGUAGE_SCRIPTS[lang];
    if (!scripts)
      return present.has("latin") || present.has("other");
    return scripts.some((s) => present.has(s));
  });
}
function mightBeForeign(text, target) {
  const present = scriptsIn(text);
  if (!present.size)
    return false;
  const unique = { ko: "hangul", el: "greek", th: "thai", he: "hebrew" };
  const own = unique[normalizeLanguage(target) ?? ""];
  return !(own && present.size === 1 && present.has(own));
}
var TRANSLATABLE_TYPES = new Set([0, 19, 20, 21, 23]);
function shouldAutoTranslate(message, options) {
  if (options.mode === "off" || !message?.id)
    return false;
  if (options.mode === "list" && !options.languages.length)
    return false;
  if (typeof message.content !== "string" || !isTranslatable(message.content))
    return false;
  if (message.type != null && !TRANSLATABLE_TYPES.has(message.type))
    return false;
  const author = message.author;
  if (!author?.id || author.id === options.currentUserId)
    return false;
  if (options.ignoreBots && author.bot)
    return false;
  return options.mode === "list" ? mightBeIn(message.content, options.languages) : mightBeForeign(message.content, options.target);
}
function shouldShowAuto(result, original, options) {
  if (options.mode === "off")
    return false;
  if (sameLanguage(result.source, options.target))
    return false;
  if (options.mode === "list" && !options.languages.some((l) => sameLanguage(l, result.source)))
    return false;
  return normalizeForCompare(result.text) !== normalizeForCompare(original);
}
var normalizeForCompare = (s) => s.toLocaleLowerCase().replace(/[\s\p{P}]+/gu, "");

class LRU {
  capacity;
  map = new Map;
  constructor(capacity) {
    this.capacity = capacity;
  }
  get size() {
    return this.map.size;
  }
  get(key) {
    if (!this.map.has(key))
      return;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  peek(key) {
    return this.map.get(key);
  }
  has(key) {
    return this.map.has(key);
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity)
      this.map.delete(this.map.keys().next().value);
    return this;
  }
  delete(key) {
    return this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  keys() {
    return this.map.keys();
  }
}
var cacheKey = (messageId, target) => `${messageId}:${target}`;

class RateQueue {
  interval;
  maxPending;
  onDrop;
  now;
  pending = [];
  running = false;
  lastStart = -Infinity;
  pausedUntil = 0;
  timer;
  stopped = false;
  constructor(interval, maxPending, onDrop = () => {}, now = Date.now) {
    this.interval = interval;
    this.maxPending = maxPending;
    this.onDrop = onDrop;
    this.now = now;
  }
  get size() {
    return this.pending.length;
  }
  has(key) {
    return this.pending.some((j) => j.key === key);
  }
  add(key, run, urgent = false) {
    if (this.stopped)
      return;
    const existing = this.pending.findIndex((j) => j.key === key);
    if (existing !== -1) {
      if (!urgent || this.pending[existing].urgent)
        return;
      this.pending.splice(existing, 1);
    }
    const job = { key, run, urgent };
    if (urgent) {
      const firstNormal = this.pending.findIndex((j) => !j.urgent);
      this.pending.splice(firstNormal === -1 ? this.pending.length : firstNormal, 0, job);
    } else {
      this.pending.push(job);
      while (this.pending.filter((j) => !j.urgent).length > this.maxPending) {
        const oldest = this.pending.findIndex((j) => !j.urgent);
        const [dropped] = this.pending.splice(oldest, 1);
        this.onDrop(dropped.key);
      }
    }
    this.schedule();
  }
  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    this.schedule();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const job of this.pending.splice(0))
      this.onDrop(job.key);
  }
  schedule() {
    if (this.stopped || this.running || !this.pending.length)
      return;
    clearTimeout(this.timer);
    const wait = Math.max(this.lastStart + this.interval, this.pausedUntil) - this.now();
    if (wait > 0) {
      this.timer = setTimeout(() => this.schedule(), wait);
      return;
    }
    const job = this.pending.shift();
    this.running = true;
    this.lastStart = this.now();
    job.run().catch(() => {}).finally(() => {
      this.running = false;
      this.schedule();
    });
  }
}

// plugins/inline-translate/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    translate: "Translate",
    "translate.hide": "Hide Translation",
    translating: "Translating…",
    error: "Couldn't translate this message",
    retry: "Retry",
    dismiss: "Dismiss",
    from: "Translated from {language}",
    "original.show": "Show original",
    "translation.show": "Show translation",
    "settings.target": "Translate to",
    "settings.target.description": "A language code like en, de or zh-TW. Empty uses Discord's language.",
    "settings.autoMode": "Translate automatically",
    "settings.autoMode.description": "Messages from others are translated as they appear. Uses a request per message.",
    "settings.autoMode.off": "Off",
    "settings.autoMode.list": "Only the languages I list",
    "settings.autoMode.foreign": "Any language that isn't mine",
    "settings.autoLanguages": "Languages to translate automatically",
    "settings.autoLanguages.description": 'Language codes separated by commas, like es, ja, de. Used by "Only the languages I list".',
    "settings.ignoreBots": "Skip bots automatically",
    "settings.ignoreBots.description": "Don't translate messages from bots and apps on your behalf.",
    "settings.hoverButton": "Button in the message toolbar",
    "settings.hoverButton.description": "A translate button next to Reply when you hover a message."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      translate: "Übersetzen",
      "translate.hide": "Übersetzung ausblenden",
      translating: "Wird übersetzt…",
      error: "Diese Nachricht konnte nicht übersetzt werden",
      retry: "Erneut versuchen",
      dismiss: "Schließen",
      from: "Übersetzt aus: {language}",
      "original.show": "Original anzeigen",
      "translation.show": "Übersetzung anzeigen",
      "settings.target": "Übersetzen nach",
      "settings.target.description": "Ein Sprachcode wie en, de oder zh-TW. Leer verwendet die Sprache von Discord.",
      "settings.autoMode": "Automatisch übersetzen",
      "settings.autoMode.description": "Nachrichten anderer werden beim Erscheinen übersetzt. Pro Nachricht wird eine Anfrage gesendet.",
      "settings.autoMode.off": "Aus",
      "settings.autoMode.list": "Nur die Sprachen aus meiner Liste",
      "settings.autoMode.foreign": "Jede Sprache, die nicht meine ist",
      "settings.autoLanguages": "Automatisch zu übersetzende Sprachen",
      "settings.autoLanguages.description": "Sprachcodes, durch Kommas getrennt, z. B. es, ja, de. Wird von „Nur die Sprachen aus meiner Liste“ verwendet.",
      "settings.ignoreBots": "Bots automatisch überspringen",
      "settings.ignoreBots.description": "Nachrichten von Bots und Apps nicht in deinem Namen übersetzen.",
      "settings.hoverButton": "Schaltfläche in der Nachrichten-Leiste",
      "settings.hoverButton.description": "Eine Übersetzen-Schaltfläche neben „Antworten“, wenn du mit der Maus über eine Nachricht fährst."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      translate: "Traducir",
      "translate.hide": "Ocultar traducción",
      translating: "Traduciendo…",
      error: "No se pudo traducir este mensaje",
      retry: "Reintentar",
      dismiss: "Descartar",
      from: "Traducido de: {language}",
      "original.show": "Mostrar original",
      "translation.show": "Mostrar traducción",
      "settings.target": "Traducir a",
      "settings.target.description": "Un código de idioma como en, de o zh-TW. Si está vacío, usa el idioma de Discord.",
      "settings.autoMode": "Traducir automáticamente",
      "settings.autoMode.description": "Los mensajes de otros se traducen al aparecer. Usa una solicitud por mensaje.",
      "settings.autoMode.off": "Desactivado",
      "settings.autoMode.list": "Solo los idiomas de mi lista",
      "settings.autoMode.foreign": "Cualquier idioma que no sea el mío",
      "settings.autoLanguages": "Idiomas para traducir automáticamente",
      "settings.autoLanguages.description": "Códigos de idioma separados por comas, como es, ja, de. Los usa «Solo los idiomas de mi lista».",
      "settings.ignoreBots": "Omitir bots automáticamente",
      "settings.ignoreBots.description": "No traducir en tu nombre los mensajes de bots y aplicaciones.",
      "settings.hoverButton": "Botón en la barra del mensaje",
      "settings.hoverButton.description": "Un botón de traducir junto a Responder al pasar el ratón sobre un mensaje."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      translate: "Traduire",
      "translate.hide": "Masquer la traduction",
      translating: "Traduction en cours…",
      error: "Impossible de traduire ce message",
      retry: "Réessayer",
      dismiss: "Ignorer",
      from: "Traduit depuis : {language}",
      "original.show": "Afficher l'original",
      "translation.show": "Afficher la traduction",
      "settings.target": "Traduire en",
      "settings.target.description": "Un code de langue comme en, de ou zh-TW. Vide, la langue de Discord est utilisée.",
      "settings.autoMode": "Traduire automatiquement",
      "settings.autoMode.description": "Les messages des autres sont traduits dès leur apparition. Utilise une requête par message.",
      "settings.autoMode.off": "Désactivé",
      "settings.autoMode.list": "Uniquement les langues de ma liste",
      "settings.autoMode.foreign": "Toute langue qui n'est pas la mienne",
      "settings.autoLanguages": "Langues à traduire automatiquement",
      "settings.autoLanguages.description": "Des codes de langue séparés par des virgules, comme es, ja, de. Utilisé par « Uniquement les langues de ma liste ».",
      "settings.ignoreBots": "Ignorer les bots automatiquement",
      "settings.ignoreBots.description": "Ne pas traduire à ta place les messages des bots et des applications.",
      "settings.hoverButton": "Bouton dans la barre du message",
      "settings.hoverButton.description": "Un bouton de traduction à côté de Répondre quand tu survoles un message."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      translate: "翻訳",
      "translate.hide": "翻訳を非表示",
      translating: "翻訳中…",
      error: "このメッセージを翻訳できませんでした",
      retry: "再試行",
      dismiss: "閉じる",
      from: "{language}から翻訳",
      "original.show": "原文を表示",
      "translation.show": "翻訳を表示",
      "settings.target": "翻訳先の言語",
      "settings.target.description": "en、de、zh-TW のような言語コード。空欄の場合は Discord の言語を使います。",
      "settings.autoMode": "自動で翻訳",
      "settings.autoMode.description": "他の人のメッセージを表示されたときに翻訳します。メッセージごとに 1 回リクエストを送ります。",
      "settings.autoMode.off": "オフ",
      "settings.autoMode.list": "リストにある言語のみ",
      "settings.autoMode.foreign": "自分の言語以外のすべて",
      "settings.autoLanguages": "自動で翻訳する言語",
      "settings.autoLanguages.description": "es, ja, de のように、言語コードをカンマで区切ります。「リストにある言語のみ」で使われます。",
      "settings.ignoreBots": "ボットは自動翻訳しない",
      "settings.ignoreBots.description": "ボットやアプリのメッセージは自動では翻訳しません。",
      "settings.hoverButton": "メッセージのツールバーにボタンを表示",
      "settings.hoverButton.description": "メッセージにカーソルを合わせたとき、返信の横に翻訳ボタンを表示します。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      translate: "Przetłumacz",
      "translate.hide": "Ukryj tłumaczenie",
      translating: "Tłumaczenie…",
      error: "Nie udało się przetłumaczyć tej wiadomości",
      retry: "Spróbuj ponownie",
      dismiss: "Odrzuć",
      from: "Przetłumaczono z języka: {language}",
      "original.show": "Pokaż oryginał",
      "translation.show": "Pokaż tłumaczenie",
      "settings.target": "Tłumacz na",
      "settings.target.description": "Kod języka, np. en, de lub zh-TW. Puste pole oznacza język Discorda.",
      "settings.autoMode": "Tłumacz automatycznie",
      "settings.autoMode.description": "Wiadomości od innych są tłumaczone, gdy się pojawiają. Wysyła jedno żądanie na wiadomość.",
      "settings.autoMode.off": "Wyłączone",
      "settings.autoMode.list": "Tylko języki z mojej listy",
      "settings.autoMode.foreign": "Każdy język poza moim",
      "settings.autoLanguages": "Języki do automatycznego tłumaczenia",
      "settings.autoLanguages.description": "Kody języków oddzielone przecinkami, np. es, ja, de. Używane przez „Tylko języki z mojej listy”.",
      "settings.ignoreBots": "Automatycznie pomijaj boty",
      "settings.ignoreBots.description": "Nie tłumacz w Twoim imieniu wiadomości od botów i aplikacji.",
      "settings.hoverButton": "Przycisk na pasku wiadomości",
      "settings.hoverButton.description": "Przycisk tłumaczenia obok Odpowiedz po najechaniu na wiadomość."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      translate: "Traduzir",
      "translate.hide": "Ocultar tradução",
      translating: "Traduzindo…",
      error: "Não foi possível traduzir esta mensagem",
      retry: "Tentar novamente",
      dismiss: "Dispensar",
      from: "Traduzido de: {language}",
      "original.show": "Mostrar original",
      "translation.show": "Mostrar tradução",
      "settings.target": "Traduzir para",
      "settings.target.description": "Um código de idioma como en, de ou zh-TW. Vazio usa o idioma do Discord.",
      "settings.autoMode": "Traduzir automaticamente",
      "settings.autoMode.description": "As mensagens de outras pessoas são traduzidas assim que aparecem. Usa uma solicitação por mensagem.",
      "settings.autoMode.off": "Desativado",
      "settings.autoMode.list": "Somente os idiomas da minha lista",
      "settings.autoMode.foreign": "Qualquer idioma que não seja o meu",
      "settings.autoLanguages": "Idiomas para traduzir automaticamente",
      "settings.autoLanguages.description": "Códigos de idioma separados por vírgulas, como es, ja, de. Usados por “Somente os idiomas da minha lista”.",
      "settings.ignoreBots": "Ignorar bots automaticamente",
      "settings.ignoreBots.description": "Não traduzir por você as mensagens de bots e apps.",
      "settings.hoverButton": "Botão na barra da mensagem",
      "settings.hoverButton.description": "Um botão de traduzir ao lado de Responder quando você passa o mouse sobre uma mensagem."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      translate: "Перевести",
      "translate.hide": "Скрыть перевод",
      translating: "Перевод…",
      error: "Не удалось перевести это сообщение",
      retry: "Повторить",
      dismiss: "Закрыть",
      from: "Переведено: {language}",
      "original.show": "Показать оригинал",
      "translation.show": "Показать перевод",
      "settings.target": "Переводить на",
      "settings.target.description": "Код языка, например en, de или zh-TW. Если пусто, используется язык Discord.",
      "settings.autoMode": "Переводить автоматически",
      "settings.autoMode.description": "Сообщения других людей переводятся сразу, как появляются. На каждое сообщение отправляется один запрос.",
      "settings.autoMode.off": "Выкл.",
      "settings.autoMode.list": "Только языки из моего списка",
      "settings.autoMode.foreign": "Любой язык, кроме моего",
      "settings.autoLanguages": "Языки для автоматического перевода",
      "settings.autoLanguages.description": "Коды языков через запятую, например es, ja, de. Используются режимом «Только языки из моего списка».",
      "settings.ignoreBots": "Пропускать ботов автоматически",
      "settings.ignoreBots.description": "Не переводить за вас сообщения от ботов и приложений.",
      "settings.hoverButton": "Кнопка на панели сообщения",
      "settings.hoverButton.description": "Кнопка перевода рядом с «Ответить» при наведении на сообщение."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      translate: "Çevir",
      "translate.hide": "Çeviriyi Gizle",
      translating: "Çevriliyor…",
      error: "Bu mesaj çevrilemedi",
      retry: "Yeniden dene",
      dismiss: "Kapat",
      from: "Şu dilden çevrildi: {language}",
      "original.show": "Orijinali göster",
      "translation.show": "Çeviriyi göster",
      "settings.target": "Şu dile çevir",
      "settings.target.description": "en, de veya zh-TW gibi bir dil kodu. Boş bırakırsan Discord'un dili kullanılır.",
      "settings.autoMode": "Otomatik çevir",
      "settings.autoMode.description": "Başkalarının mesajları göründükleri anda çevrilir. Mesaj başına bir istek kullanır.",
      "settings.autoMode.off": "Kapalı",
      "settings.autoMode.list": "Yalnızca listelediğim diller",
      "settings.autoMode.foreign": "Benim dilim olmayan her dil",
      "settings.autoLanguages": "Otomatik çevrilecek diller",
      "settings.autoLanguages.description": 'es, ja, de gibi virgülle ayrılmış dil kodları. "Yalnızca listelediğim diller" seçeneği tarafından kullanılır.',
      "settings.ignoreBots": "Botları otomatik olarak atla",
      "settings.ignoreBots.description": "Botların ve uygulamaların mesajlarını senin adına çevirme.",
      "settings.hoverButton": "Mesaj araç çubuğunda düğme",
      "settings.hoverButton.description": "Bir mesajın üzerine geldiğinde Yanıtla'nın yanında bir çeviri düğmesi gösterir."
    } })["tr"];
  }
});

// plugins/inline-translate/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var settings = {
  target: {
    type: "string",
    get label() {
      return t("settings.target");
    },
    get description() {
      return t("settings.target.description");
    },
    placeholder: "en",
    default: ""
  },
  autoMode: {
    type: "select",
    get label() {
      return t("settings.autoMode");
    },
    get description() {
      return t("settings.autoMode.description");
    },
    default: "off",
    options: [
      { get label() {
        return t("settings.autoMode.off");
      }, value: "off" },
      { get label() {
        return t("settings.autoMode.list");
      }, value: "list" },
      { get label() {
        return t("settings.autoMode.foreign");
      }, value: "foreign" }
    ]
  },
  autoLanguages: {
    type: "string",
    get label() {
      return t("settings.autoLanguages");
    },
    get description() {
      return t("settings.autoLanguages.description");
    },
    placeholder: "es, ja, de",
    default: ""
  },
  ignoreBots: { type: "boolean", get label() {
    return t("settings.ignoreBots");
  }, get description() {
    return t("settings.ignoreBots.description");
  }, default: true },
  hoverButton: { type: "boolean", get label() {
    return t("settings.hoverButton");
  }, get description() {
    return t("settings.hoverButton.description");
  }, default: true }
};
var INTERVAL = 1200;
var BACKOFF = 60000;
var MAX_QUEUED = 25;
var CACHE_SIZE = 500;
var accessoriesFilter = import_api2.filters.byCode("channelMessageProps:{message:", "isAutomodBlockedMessage:");
var renderedContentFilter = import_api2.filters.byCode('"useMessageRenderedContent"', "hasBailedAst:");
var MARKUP_CLASS = /^markup_+[\w-]+$/;
var markupFilter = Object.assign((v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((c) => typeof c === "string" && MARKUP_CLASS.test(c)) && Object.values(v).some((c) => typeof c === "string" && /^codeContainer_+[\w-]+$/.test(c)), { $code: ['"markup_', '"codeContainer_'] });
var useRenderedContent;
var markupClass = "";
var css = `
.dl-it {
    text-indent: 0;
    margin: 0.125rem 0 0.25rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--brand-500, var(--brand-experiment, #5865f2));
    font-family: var(--font-primary);
    max-width: 100%;
}
.dl-it-text {
    color: var(--text-normal, #dbdee1);
    font-size: 1rem;
    line-height: 1.375rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.dl-it-caption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    color: var(--text-muted, #949ba4);
    font-size: 0.75rem;
    line-height: 1rem;
    font-weight: 500;
}
.dl-it-error { color: var(--text-feedback-critical, var(--status-danger, #f23f43)); }
.dl-it-link {
    all: unset;
    cursor: pointer;
    color: var(--text-link, #00a8fc);
    border-radius: 3px;
}
.dl-it-link:hover { text-decoration: underline; }
.dl-it-link:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
`;
var stores = new Map;
function store(name) {
  let found = stores.get(name);
  if (found)
    return found;
  try {
    found = import_api2.getStore(name);
  } catch {
    return;
  }
  stores.set(name, found);
  return found;
}
function discordLocale() {
  return store("LocaleStore")?.locale || document.documentElement.lang || navigator.language || "en";
}
var me;
var currentUserId = () => me ??= store("UserStore")?.getCurrentUser?.()?.id;
function isOwn(message) {
  const id = currentUserId();
  return !!id && message?.author?.id === id;
}

class Runtime {
  ctx;
  cache = new LRU(CACHE_SIZE);
  views = new LRU(CACHE_SIZE);
  listeners = new Map;
  epoch = 0;
  queue;
  cachedTarget;
  cachedOptions;
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = new RateQueue(INTERVAL, MAX_QUEUED, (key) => {
      if (this.cache.peek(key)?.state === "loading") {
        this.cache.delete(key);
        this.emit(key);
      }
    });
  }
  subscribe(key, fn) {
    let set = this.listeners.get(key);
    if (!set)
      this.listeners.set(key, set = new Set);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size && this.listeners.get(key) === set)
        this.listeners.delete(key);
    };
  }
  emit(key) {
    if (key === undefined) {
      this.epoch++;
      for (const set2 of [...this.listeners.values()])
        for (const fn of [...set2])
          fn();
      return;
    }
    const set = this.listeners.get(key);
    if (set)
      for (const fn of [...set])
        fn();
  }
  invalidate() {
    this.cachedTarget = undefined;
    this.cachedOptions = undefined;
    this.emit();
  }
  target() {
    return this.cachedTarget ??= normalizeLanguage(this.ctx.settings.get("target")) ?? googleLanguage(discordLocale());
  }
  autoMode() {
    return this.ctx.settings.get("autoMode");
  }
  autoOptions() {
    const id = currentUserId();
    if (this.cachedOptions && this.cachedOptions.currentUserId === id)
      return this.cachedOptions;
    return this.cachedOptions = {
      mode: this.autoMode(),
      languages: parseLanguageList(this.ctx.settings.get("autoLanguages")),
      target: this.target(),
      currentUserId: id,
      ignoreBots: this.ctx.settings.get("ignoreBots")
    };
  }
  setView(key, view) {
    if (view)
      this.views.set(key, view);
    else
      this.views.delete(key);
    this.emit(key);
  }
  request(message, urgent) {
    const content = message.content;
    const target = this.target();
    const key = cacheKey(message.id, target);
    const cached = this.cache.get(key);
    if (cached && cached.content === content) {
      if (cached.state === "done")
        return;
      if (cached.state === "error" && !urgent)
        return;
      if (cached.state === "loading" && (!urgent || !this.queue.has(key)))
        return;
    }
    this.cache.set(key, { state: "loading", content });
    this.emit(key);
    this.queue.add(key, async () => {
      const auto = !urgent;
      try {
        const { text, tokens } = protect(content);
        const result = await this.ctx.native.call("translate", text, target);
        const translation = { source: result.source, text: restore(result.text, tokens) };
        if (this.cache.peek(key)?.content !== content)
          return;
        this.cache.set(key, { state: "done", content, result: translation });
        if (auto && !this.views.has(key) && shouldShowAuto(translation, content, this.autoOptions()))
          this.views.set(key, "shown");
      } catch (err) {
        const error = String(err?.message ?? err).replace(/^Error invoking remote method[^:]*:\s*(?:Error:\s*)?/, "");
        if (/\b429\b/.test(error))
          this.queue.pause(BACKOFF);
        if (this.cache.peek(key)?.content === content)
          this.cache.set(key, { state: "error", content, error });
        if (!auto)
          this.ctx.logger.warn("Translation failed", error);
      } finally {
        this.emit(key);
      }
    }, urgent);
  }
  toggle(message) {
    const key = cacheKey(message.id, this.target());
    if (this.views.peek(key) === "shown")
      return this.setView(key, "dismissed");
    this.views.set(key, "shown");
    this.request(message, true);
    this.emit(key);
  }
  isShown(message) {
    return this.views.peek(cacheKey(message.id, this.target())) === "shown";
  }
  snapshot(key) {
    return `${this.epoch}|${this.views.peek(key) ?? ""}|${this.cache.peek(key)?.state ?? ""}`;
  }
  dispose() {
    this.queue.stop();
    this.cache.clear();
    this.views.clear();
    this.emit();
  }
}
var active;
function RichText({ message, text }) {
  const render = useRenderedContent;
  const record = import_api2.React.useMemo(() => message.set?.("content", text) ?? { ...message, content: text }, [message, text]);
  const rendered = render(record, { hideSimpleEmbedContent: false, formatInline: false, allowLinks: true, allowList: true, allowHeading: true });
  return /* @__PURE__ */ jsx_runtime.jsx(jsx_runtime.Fragment, {
    children: rendered?.content ?? text
  });
}
function Caption({ children }) {
  const items = import_api2.React.Children.toArray(children);
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: "dl-it-caption",
    children: items.map((item, i) => /* @__PURE__ */ jsx_runtime.jsxs(import_api2.React.Fragment, {
      children: [
        i > 0 && /* @__PURE__ */ jsx_runtime.jsx("span", {
          "aria-hidden": "true",
          children: "·"
        }),
        item
      ]
    }, i))
  });
}
function LinkButton({ onClick, children }) {
  return /* @__PURE__ */ jsx_runtime.jsx("button", {
    type: "button",
    className: "dl-it-link",
    onClick,
    children
  });
}
function useMessageState(runtime, key) {
  const subscribe = import_api2.React.useCallback((fn) => runtime.subscribe(key, fn), [runtime, key]);
  return import_api2.React.useSyncExternalStore(subscribe, () => runtime.snapshot(key));
}
function Inline({ runtime, message }) {
  const target = runtime.target();
  const key = cacheKey(message.id, target);
  useMessageState(runtime, key);
  const entry = runtime.cache.peek(key);
  const view = runtime.views.peek(key);
  const content = typeof message.content === "string" ? message.content : "";
  import_api2.React.useEffect(() => {
    if (!content)
      return;
    const shown = runtime.views.peek(key) === "shown";
    if (!shown && runtime.autoMode() === "off")
      return;
    const cached = runtime.cache.peek(key);
    if (cached && cached.content === content)
      return;
    if (shown)
      return runtime.request(message, true);
    if (runtime.views.peek(key) !== "dismissed" && shouldAutoTranslate(message, runtime.autoOptions()))
      runtime.request(message, false);
  }, [key, content, runtime.epoch]);
  if (!view || view === "dismissed" || !entry || entry.content !== content)
    return null;
  const dismiss = () => runtime.setView(key, "dismissed");
  const uiLocale = discordLocale();
  if (entry.state === "loading") {
    return /* @__PURE__ */ jsx_runtime.jsx("div", {
      className: "dl-it",
      role: "status",
      children: /* @__PURE__ */ jsx_runtime.jsx(Caption, {
        children: /* @__PURE__ */ jsx_runtime.jsx("span", {
          children: t("translating")
        })
      })
    });
  }
  if (entry.state === "error") {
    return /* @__PURE__ */ jsx_runtime.jsx("div", {
      className: "dl-it",
      role: "alert",
      children: /* @__PURE__ */ jsx_runtime.jsxs(Caption, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            className: "dl-it-error",
            children: t("error")
          }),
          /* @__PURE__ */ jsx_runtime.jsx(LinkButton, {
            onClick: () => {
              runtime.setView(key, "shown");
              runtime.request(message, true);
            },
            children: t("retry")
          }),
          /* @__PURE__ */ jsx_runtime.jsx(LinkButton, {
            onClick: dismiss,
            children: t("dismiss")
          })
        ]
      })
    });
  }
  const from = languageName(entry.result.source, uiLocale);
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "dl-it",
    lang: target,
    children: [
      view === "shown" && /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: `dl-it-text ${markupClass}`,
        children: useRenderedContent ? /* @__PURE__ */ jsx_runtime.jsx(RichText, {
          message,
          text: entry.result.text
        }) : entry.result.text
      }),
      /* @__PURE__ */ jsx_runtime.jsxs(Caption, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            children: t("from", { language: from })
          }),
          view === "shown" ? /* @__PURE__ */ jsx_runtime.jsx(LinkButton, {
            onClick: () => runtime.setView(key, "collapsed"),
            children: t("original.show")
          }) : /* @__PURE__ */ jsx_runtime.jsx(LinkButton, {
            onClick: () => runtime.setView(key, "shown"),
            children: t("translation.show")
          }),
          /* @__PURE__ */ jsx_runtime.jsx(LinkButton, {
            onClick: dismiss,
            children: t("dismiss")
          })
        ]
      })
    ]
  });
}
function TranslateIcon(props) {
  return /* @__PURE__ */ jsx_runtime.jsx("svg", {
    className: props.className,
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    fill: props.color ?? "currentColor",
    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
      d: "M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"
    })
  });
}
function HoverButton({ runtime, Button, message }) {
  useMessageState(runtime, cacheKey(message.id, runtime.target()));
  const shown = runtime.isShown(message);
  return /* @__PURE__ */ jsx_runtime.jsx(Button, {
    label: t(shown ? "translate.hide" : "translate"),
    icon: TranslateIcon,
    onClick: () => runtime.toggle(message)
  });
}
var canTranslate = (message) => !!message?.id && typeof message.content === "string" && isTranslatable(message.content) && !isOwn(message);
var inline_translate_default = import_api2.definePlugin({
  settings,
  patches: [{
    find: '},"reply-other")',
    replace: {
      match: /(\(0,\i\.jsx\)\((\i(?:\.\i)?),\{label:[^{}]*?onClick:\i=>\(0,\i\.\i\)\((\i),(\i),\i\)\},"reply-other"\):null,)/,
      with: "$1$self.hoverButton($2,$3,$4),"
    }
  }],
  hoverButton(Button, _channel, message) {
    try {
      const runtime = active;
      if (!runtime || !Button || !runtime.ctx.settings.get("hoverButton") || !canTranslate(message))
        return null;
      return /* @__PURE__ */ jsx_runtime.jsx(HoverButton, {
        runtime,
        Button,
        message
      }, "evi-translate");
    } catch {
      return null;
    }
  },
  start(ctx) {
    const runtime = new Runtime(ctx);
    active = runtime;
    ctx.onDispose(() => {
      if (active === runtime)
        active = undefined;
      runtime.dispose();
    });
    ctx.addStyle(css);
    if (!useRenderedContent)
      ctx.waitFor(renderedContentFilter, (fn) => void (useRenderedContent = fn));
    if (!markupClass)
      ctx.waitFor(markupFilter, (classes) => {
        markupClass = Object.values(classes).find((c) => typeof c === "string" && MARKUP_CLASS.test(c)) ?? "";
      });
    ctx.hookExport("after", accessoriesFilter, ({ args, result }) => {
      const props = args[0];
      const message = props?.channelMessageProps?.message;
      if (result == null || props.isMessageSnapshot || !message?.id || typeof message.content !== "string" || !message.content)
        return;
      return /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsx(Inline, {
            runtime,
            message
          }, "evi-translate"),
          result
        ]
      });
    });
    ctx.contextMenu("message", (children, { message }) => {
      if (!canTranslate(message))
        return;
      (import_api2.findMenuGroup(children, "copy-text") ?? children).push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
        id: "evi-inline-translate",
        label: t(runtime.isShown(message) ? "translate.hide" : "translate"),
        action: () => runtime.toggle(message)
      }));
    });
    ctx.settings.onChange(() => runtime.invalidate());
    const locale = store("LocaleStore");
    let lastLocale = locale?.locale;
    const onLocale = () => {
      if (locale.locale === lastLocale)
        return;
      lastLocale = locale.locale;
      runtime.invalidate();
    };
    locale?.addChangeListener?.(onLocale);
    ctx.onDispose(() => locale?.removeChangeListener?.(onLocale));
    ctx.flux.subscribe("CONNECTION_OPEN", (action) => {
      const previous = me;
      me = typeof action.user?.id === "string" ? action.user.id : undefined;
      if (me !== undefined && me === previous)
        return;
      runtime.invalidate();
    });
    ctx.onDispose(() => void (me = undefined));
  }
});
