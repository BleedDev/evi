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

// plugins/snippets/index.tsx
var exports_snippets = {};
__export(exports_snippets, {
  default: () => snippets_default
});
module.exports = __toCommonJS(exports_snippets);
var import_api2 = require("@evi/api");

// plugins/snippets/snippets.ts
var ENGLISH = {
  "err.nameEmpty": "Give it a name.",
  "err.nameLong": "Names can be up to {max} characters.",
  "err.nameTaken": `There's already a snippet called "{name}".`,
  "err.textEmpty": "Write the text to insert.",
  "err.textLong": "Snippets can be up to {max} characters (this one is {length}).",
  "err.none": "You have no snippets yet. Add one from the snippets button in the chat bar, or right-click a message and pick Save as Snippet.",
  "err.which": "Which snippet? You have: {list}",
  "err.more": ", and {n} more",
  "err.noneCalledClose": 'No snippet is called "{value}". Did you mean: {list}?',
  "err.noneCalled": 'No snippet is called "{value}". You have: {list}'
};
var english = (key, vars) => ENGLISH[key].replace(/\{(\w+)\}/g, (whole, name) => vars && (name in vars) ? String(vars[name]) : whole);
var EMPTY = { snippets: [] };
var MAX_NAME_LENGTH = 32;
var MAX_TEXT_LENGTH = 4000;
var MAX_SNIPPETS = 500;
var MAX_CHOICES = 25;
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function cleanName(name) {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
}
function cleanText(text) {
  return typeof text === "string" ? text.replace(/\r\n?/g, `
`).replace(/^\s*\n/, "").trimEnd() : "";
}
var key = (name) => cleanName(name).toLocaleLowerCase();
function nameError(state, name, exceptId, say = english) {
  if (typeof name !== "string" || !cleanName(name))
    return say("err.nameEmpty");
  if (name.replace(/\s+/g, " ").trim().length > MAX_NAME_LENGTH)
    return say("err.nameLong", { max: MAX_NAME_LENGTH });
  const k = key(name);
  const taken = state.snippets.find((s) => s.id !== exceptId && key(s.name) === k);
  return taken ? say("err.nameTaken", { name: taken.name }) : null;
}
function textError(text, say = english) {
  const clean = cleanText(text);
  if (!clean.trim())
    return say("err.textEmpty");
  if (clean.length > MAX_TEXT_LENGTH)
    return say("err.textLong", { max: MAX_TEXT_LENGTH, length: clean.length });
  return null;
}
function inputError(state, input, exceptId) {
  return nameError(state, input.name, exceptId) ?? textError(input.text);
}
var count = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
function parseState(raw) {
  const list = raw?.snippets;
  if (!Array.isArray(list))
    return EMPTY;
  const ids = new Set;
  const names = new Set;
  const snippets = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id))
      continue;
    const name = cleanName(item.name);
    const text = cleanText(item.text);
    if (!name || !text.trim() || names.has(key(name)))
      continue;
    ids.add(item.id);
    names.add(key(name));
    snippets.push({
      id: item.id,
      name,
      text: text.slice(0, MAX_TEXT_LENGTH),
      createdAt: count(item.createdAt),
      uses: count(item.uses),
      lastUsed: count(item.lastUsed)
    });
    if (snippets.length >= MAX_SNIPPETS)
      break;
  }
  return { snippets };
}
function getSnippet(state, id) {
  return id ? state.snippets.find((s) => s.id === id) : undefined;
}
function findByName(state, name) {
  if (typeof name !== "string")
    return;
  const k = key(name);
  return k ? state.snippets.find((s) => key(s.name) === k) : undefined;
}
function addSnippet(state, input, now = Date.now(), id = makeId()) {
  if (state.snippets.length >= MAX_SNIPPETS)
    return { state, error: `You can keep up to ${MAX_SNIPPETS} snippets.` };
  const error = inputError(state, input);
  if (error)
    return { state, error };
  const snippet = { id, name: cleanName(input.name), text: cleanText(input.text), createdAt: now, uses: 0, lastUsed: 0 };
  return { state: { snippets: [...state.snippets, snippet] }, snippet };
}
function updateSnippet(state, id, input) {
  const current = getSnippet(state, id);
  if (!current)
    return { state, error: "That snippet no longer exists." };
  const next = { name: input.name ?? current.name, text: input.text ?? current.text };
  const error = inputError(state, next, id);
  if (error)
    return { state, error };
  const name = cleanName(next.name);
  const text = cleanText(next.text);
  if (name === current.name && text === current.text)
    return { state, snippet: current };
  const snippet = { ...current, name, text };
  return { state: { snippets: state.snippets.map((s) => s.id === id ? snippet : s) }, snippet };
}
function deleteSnippet(state, id) {
  return getSnippet(state, id) ? { snippets: state.snippets.filter((s) => s.id !== id) } : state;
}
function recordUse(state, id, now = Date.now()) {
  if (!getSnippet(state, id))
    return state;
  return { snippets: state.snippets.map((s) => s.id === id ? { ...s, uses: s.uses + 1, lastUsed: now } : s) };
}
function uniqueName(state, base) {
  const clean = cleanName(base) || "Snippet";
  if (!nameError(state, clean))
    return clean;
  for (let n = 2;; n++) {
    const suffix = ` ${n}`;
    const name = clean.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd() + suffix;
    if (!nameError(state, name))
      return name;
  }
}
function suggestName(state, text) {
  const words = cleanText(text).replace(/<a?:(\w+):\d+>/g, "$1").replace(/<[@#][!&]?\d+>/g, "").replace(/https?:\/\/\S+/g, "").replace(/[*_~`|>]/g, "").split(/\s+/).filter(Boolean);
  let name = "";
  for (const word of words) {
    const next = name ? `${name} ${word}` : word;
    if (next.length > 24)
      break;
    name = next;
    if (name.split(" ").length >= 4)
      break;
  }
  return uniqueName(state, name || words[0]?.slice(0, 24) || "Snippet");
}
var PLACEHOLDERS = [
  { key: "user", description: "The person you're replying to, or the other person in a DM" },
  { key: "me", description: "Your own display name" },
  { key: "channel", description: "The channel's name" },
  { key: "server", description: "The server's name" },
  { key: "date", description: "Today's date" },
  { key: "time", description: "The current time" },
  { key: "clipboard", description: "Whatever text you have copied" }
];
var KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));
var PLACEHOLDER = /(\\?)\{([a-z]+)\}/gi;
function usedPlaceholders(text) {
  const used = new Set;
  for (const [, escape, name] of text.matchAll(PLACEHOLDER)) {
    const k = name.toLowerCase();
    if (!escape && KNOWN.has(k))
      used.add(k);
  }
  return used;
}
function expandPlaceholders(text, values) {
  return text.replace(PLACEHOLDER, (whole, escape, name) => {
    if (escape)
      return whole.slice(1);
    const k = name.toLowerCase();
    if (!KNOWN.has(k))
      return whole;
    return values[k] ?? "";
  });
}
function escapePlaceholders(text) {
  return text.replace(/\{[a-z]+\}/gi, "\\$&");
}
function readsClipboard(text) {
  return usedPlaceholders(text).has("clipboard");
}
function dateValues(now, locale) {
  return {
    date: now.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }),
    time: now.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  };
}
var fold = (s) => s.toLocaleLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
function isSubsequence(query, text) {
  let i = 0;
  for (const ch of text)
    if (ch === query[i] && ++i === query.length)
      return true;
  return query.length === 0;
}
function scoreSnippet(snippet, query) {
  const q = fold(query.replace(/\s+/g, " ").trim());
  if (!q)
    return 1;
  const name = fold(snippet.name);
  const text = fold(snippet.text);
  if (name === q)
    return 1000;
  if (name.startsWith(q))
    return 800;
  if (name.split(/[\s\-_.]+/).some((w) => w.startsWith(q)))
    return 600;
  if (name.includes(q))
    return 400;
  const tokens = q.split(" ");
  if (tokens.length > 1 && tokens.every((t) => name.includes(t)))
    return 300;
  if (!q.includes(" ") && q.length > 1 && isSubsequence(q, name))
    return 200;
  if (text.includes(q))
    return 150;
  if (tokens.every((t) => name.includes(t) || text.includes(t)))
    return 100;
  return 0;
}
function compareByUse(a, b) {
  return b.lastUsed - a.lastUsed || b.uses - a.uses || a.name.localeCompare(b.name);
}
function compareByName(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
function searchSnippets(state, query) {
  return state.snippets.map((snippet) => ({ snippet, score: scoreSnippet(snippet, query) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || compareByUse(a.snippet, b.snippet)).map((r) => r.snippet);
}
function resolveSnippet(state, input, say = english) {
  if (!state.snippets.length)
    return { error: say("err.none") };
  const value = typeof input === "string" ? input.trim() : "";
  const list = (items) => items.slice(0, 10).map((s) => `\`${s.name}\``).join(", ") + (items.length > 10 ? say("err.more", { n: items.length - 10 }) : "");
  const listAll = () => list([...state.snippets].sort(compareByName));
  if (!value)
    return { error: say("err.which", { list: listAll() }) };
  const exact = getSnippet(state, value) ?? findByName(state, value);
  if (exact)
    return { snippet: exact };
  const matches = state.snippets.map((snippet) => ({ snippet, score: scoreSnippet(snippet, value) })).filter((r) => r.score >= 400).sort((a, b) => b.score - a.score || compareByUse(a.snippet, b.snippet));
  if (matches.length === 1 || matches.length > 1 && matches[0].score >= 800 && matches[1].score < 800)
    return { snippet: matches[0].snippet };
  const close = matches.length ? matches.map((m) => m.snippet) : searchSnippets(state, value);
  if (close.length)
    return { error: say("err.noneCalledClose", { value, list: list(close) }) };
  return { error: say("err.noneCalled", { value, list: listAll() }) };
}
function commandChoices(state) {
  if (!state.snippets.length || state.snippets.length > MAX_CHOICES)
    return;
  return [...state.snippets].sort(compareByName).map((s) => ({ name: s.name, value: s.id }));
}
var BUTTON_PATCH = {
  find: '"ChannelTextAreaButtons"',
  replace: {
    match: /(\i)&&(\i)\.push\(\(0,\i\.jsxs?\)\(\i,\{onClick:\i,disabled:[^{}]+\},"submit"\)\)/,
    with: "$self?.injectButton?.($2,arguments[0]),$&"
  }
};

// plugins/snippets/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.showButton": "Chat bar button",
    "settings.showButton.description": "A button in the chat bar that opens your snippets.",
    "settings.commandAction": "/snip does",
    "settings.commandAction.description": "What /snip does with the snippet when you don't pick the send option.",
    "settings.commandAction.send": "Send it right away",
    "settings.commandAction.insert": "Put it in the message box to edit first",
    "toast.noBox": "Couldn't find the message box to put the snippet in",
    "toast.checkClipboard": "This snippet uses what you copied, so it's in your message box for you to check before you send it.",
    "toast.saved": 'Saved "{name}". Use it with /snip or the snippets button.',
    "command.description": "Send one of your snippets, or put it in the message box",
    "command.name.choices": "The snippet",
    "command.name.free": "The snippet's name",
    "command.send": "On: send it right away. Off: put it in the message box to edit first.",
    "editor.name": "Name",
    "editor.text": "Text",
    "editor.namePlaceholder": "e.g. welcome",
    "editor.textPlaceholder": "Hi {user}, thanks for reaching out!",
    "editor.placeholders": "Placeholders",
    "editor.cancel": "Cancel",
    "editor.save": "Save",
    "editor.add": "Add snippet",
    "row.edit": "Edit",
    "row.delete": "Delete",
    "row.editLabel": "Edit {name}",
    "row.deleteLabel": "Delete {name}",
    "picker.editTitle": "Edit snippet",
    "picker.newTitle": "New snippet",
    "picker.search": "Search snippets",
    "picker.nameFirst": "Name your first snippet",
    "picker.new": "New",
    "picker.list": "Snippets",
    "picker.noMatch": 'No snippet matches "{query}". Press Enter to create it.',
    "picker.empty": "Save replies you type often, then put them in the message box from here or with /snip.",
    "picker.hintChoose": "choose",
    "picker.hintInsert": "insert",
    "picker.hintClose": "close",
    "dialog.snippet": "Snippet",
    "dialog.saveTitle": "Save as snippet",
    "button.label": "Snippets",
    "panel.title": "Your snippets · {count}",
    "panel.new": "New snippet",
    "panel.empty": "No snippets yet. Add one here, from the chat bar button, or right-click a message and pick Save as Snippet.",
    "panel.placeholders": "Placeholders: {list}.",
    "panel.escape": "Type {code} to keep one as written.",
    "menu.save": "Save as Snippet",
    "ph.user": "The person you're replying to, or the other person in a DM",
    "ph.me": "Your own display name",
    "ph.channel": "The channel's name",
    "ph.server": "The server's name",
    "ph.date": "Today's date",
    "ph.time": "The current time",
    "ph.clipboard": "Whatever text you have copied",
    "err.nameEmpty": "Give it a name.",
    "err.nameLong": "Names can be up to {max} characters.",
    "err.nameTaken": `There's already a snippet called "{name}".`,
    "err.textEmpty": "Write the text to insert.",
    "err.textLong": "Snippets can be up to {max} characters (this one is {length}).",
    "err.none": "You have no snippets yet. Add one from the snippets button in the chat bar, or right-click a message and pick Save as Snippet.",
    "err.which": "Which snippet? You have: {list}",
    "err.more": ", and {n} more",
    "err.noneCalledClose": 'No snippet is called "{value}". Did you mean: {list}?',
    "err.noneCalled": 'No snippet is called "{value}". You have: {list}'
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.showButton": "Button in der Chatleiste",
      "settings.showButton.description": "Ein Button in der Chatleiste, der deine Textbausteine öffnet.",
      "settings.commandAction": "/snip macht",
      "settings.commandAction.description": "Was /snip mit dem Textbaustein macht, wenn du nicht die Sende-Option wählst.",
      "settings.commandAction.send": "Sofort senden",
      "settings.commandAction.insert": "Ins Nachrichtenfeld einfügen, um ihn vorher zu bearbeiten",
      "toast.noBox": "Das Nachrichtenfeld für den Textbaustein wurde nicht gefunden",
      "toast.checkClipboard": "Dieser Textbaustein enthält, was du kopiert hast, darum steht er im Nachrichtenfeld, damit du ihn vor dem Senden prüfen kannst.",
      "toast.saved": "„{name}“ gespeichert. Nutze ihn mit /snip oder dem Textbaustein-Button.",
      "command.description": "Einen deiner Textbausteine senden oder ins Nachrichtenfeld einfügen",
      "command.name.choices": "Der Textbaustein",
      "command.name.free": "Der Name des Textbausteins",
      "command.send": "An: sofort senden. Aus: ins Nachrichtenfeld einfügen, um ihn vorher zu bearbeiten.",
      "editor.name": "Name",
      "editor.text": "Text",
      "editor.namePlaceholder": "z. B. Begrüßung",
      "editor.textPlaceholder": "Hallo {user}, danke für deine Nachricht!",
      "editor.placeholders": "Platzhalter",
      "editor.cancel": "Abbrechen",
      "editor.save": "Speichern",
      "editor.add": "Textbaustein hinzufügen",
      "row.edit": "Bearbeiten",
      "row.delete": "Löschen",
      "row.editLabel": "{name} bearbeiten",
      "row.deleteLabel": "{name} löschen",
      "picker.editTitle": "Textbaustein bearbeiten",
      "picker.newTitle": "Neuer Textbaustein",
      "picker.search": "Textbausteine durchsuchen",
      "picker.nameFirst": "Gib deinem ersten Textbaustein einen Namen",
      "picker.new": "Neu",
      "picker.list": "Textbausteine",
      "picker.noMatch": "Kein Textbaustein passt zu „{query}“. Drücke die Eingabetaste, um ihn zu erstellen.",
      "picker.empty": "Speichere Antworten, die du oft schreibst, und füge sie von hier oder mit /snip ins Nachrichtenfeld ein.",
      "picker.hintChoose": "auswählen",
      "picker.hintInsert": "einfügen",
      "picker.hintClose": "schließen",
      "dialog.snippet": "Textbaustein",
      "dialog.saveTitle": "Als Textbaustein speichern",
      "button.label": "Textbausteine",
      "panel.title": "Deine Textbausteine · {count}",
      "panel.new": "Neuer Textbaustein",
      "panel.empty": "Noch keine Textbausteine. Füge hier einen hinzu, über den Button in der Chatleiste oder per Rechtsklick auf eine Nachricht und „Als Textbaustein speichern“.",
      "panel.placeholders": "Platzhalter: {list}.",
      "panel.escape": "Schreibe {code}, um einen so stehen zu lassen.",
      "menu.save": "Als Textbaustein speichern",
      "ph.user": "Die Person, der du antwortest, oder die andere Person in einer DM",
      "ph.me": "Dein eigener Anzeigename",
      "ph.channel": "Der Name des Kanals",
      "ph.server": "Der Name des Servers",
      "ph.date": "Das heutige Datum",
      "ph.time": "Die aktuelle Uhrzeit",
      "ph.clipboard": "Der Text, den du kopiert hast",
      "err.nameEmpty": "Gib ihm einen Namen.",
      "err.nameLong": "Namen dürfen bis zu {max} Zeichen lang sein.",
      "err.nameTaken": "Es gibt bereits einen Textbaustein namens „{name}“.",
      "err.textEmpty": "Schreibe den Text, der eingefügt werden soll.",
      "err.textLong": "Textbausteine dürfen bis zu {max} Zeichen lang sein (dieser hat {length}).",
      "err.none": "Du hast noch keine Textbausteine. Füge einen über den Button in der Chatleiste hinzu oder klicke mit rechts auf eine Nachricht und wähle „Als Textbaustein speichern“.",
      "err.which": "Welcher Textbaustein? Du hast: {list}",
      "err.more": " und {n} weitere",
      "err.noneCalledClose": "Es gibt keinen Textbaustein namens „{value}“. Meintest du: {list}?",
      "err.noneCalled": "Es gibt keinen Textbaustein namens „{value}“. Du hast: {list}"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.showButton": "Botón en la barra de chat",
      "settings.showButton.description": "Un botón en la barra de chat que abre tus respuestas rápidas.",
      "settings.commandAction": "Qué hace /snip",
      "settings.commandAction.description": "Lo que hace /snip con la respuesta rápida cuando no eliges la opción de enviar.",
      "settings.commandAction.send": "Enviarla de inmediato",
      "settings.commandAction.insert": "Ponerla en el cuadro de mensaje para editarla antes",
      "toast.noBox": "No se encontró el cuadro de mensaje donde poner la respuesta rápida",
      "toast.checkClipboard": "Esta respuesta rápida usa lo que copiaste, así que está en el cuadro de mensaje para que la revises antes de enviarla.",
      "toast.saved": "Se guardó «{name}». Úsala con /snip o con el botón de respuestas rápidas.",
      "command.description": "Envía una de tus respuestas rápidas o ponla en el cuadro de mensaje",
      "command.name.choices": "La respuesta rápida",
      "command.name.free": "El nombre de la respuesta rápida",
      "command.send": "Sí: enviarla de inmediato. No: ponerla en el cuadro de mensaje para editarla antes.",
      "editor.name": "Nombre",
      "editor.text": "Texto",
      "editor.namePlaceholder": "p. ej., bienvenida",
      "editor.textPlaceholder": "¡Hola {user}, gracias por escribirnos!",
      "editor.placeholders": "Marcadores",
      "editor.cancel": "Cancelar",
      "editor.save": "Guardar",
      "editor.add": "Añadir respuesta rápida",
      "row.edit": "Editar",
      "row.delete": "Eliminar",
      "row.editLabel": "Editar {name}",
      "row.deleteLabel": "Eliminar {name}",
      "picker.editTitle": "Editar respuesta rápida",
      "picker.newTitle": "Nueva respuesta rápida",
      "picker.search": "Buscar respuestas rápidas",
      "picker.nameFirst": "Ponle nombre a tu primera respuesta rápida",
      "picker.new": "Nueva",
      "picker.list": "Respuestas rápidas",
      "picker.noMatch": "Ninguna respuesta rápida coincide con «{query}». Pulsa Intro para crearla.",
      "picker.empty": "Guarda las respuestas que escribes a menudo y ponlas en el cuadro de mensaje desde aquí o con /snip.",
      "picker.hintChoose": "elegir",
      "picker.hintInsert": "insertar",
      "picker.hintClose": "cerrar",
      "dialog.snippet": "Respuesta rápida",
      "dialog.saveTitle": "Guardar como respuesta rápida",
      "button.label": "Respuestas rápidas",
      "panel.title": "Tus respuestas rápidas · {count}",
      "panel.new": "Nueva respuesta rápida",
      "panel.empty": "Aún no hay respuestas rápidas. Añade una aquí, desde el botón de la barra de chat, o haz clic derecho en un mensaje y elige Guardar como respuesta rápida.",
      "panel.placeholders": "Marcadores: {list}.",
      "panel.escape": "Escribe {code} para dejar uno tal cual.",
      "menu.save": "Guardar como respuesta rápida",
      "ph.user": "La persona a la que respondes, o la otra persona en un MD",
      "ph.me": "Tu propio nombre para mostrar",
      "ph.channel": "El nombre del canal",
      "ph.server": "El nombre del servidor",
      "ph.date": "La fecha de hoy",
      "ph.time": "La hora actual",
      "ph.clipboard": "El texto que tengas copiado",
      "err.nameEmpty": "Ponle un nombre.",
      "err.nameLong": "Los nombres pueden tener hasta {max} caracteres.",
      "err.nameTaken": "Ya hay una respuesta rápida llamada «{name}».",
      "err.textEmpty": "Escribe el texto que se va a insertar.",
      "err.textLong": "Las respuestas rápidas pueden tener hasta {max} caracteres (esta tiene {length}).",
      "err.none": "Todavía no tienes respuestas rápidas. Añade una desde el botón de la barra de chat, o haz clic derecho en un mensaje y elige Guardar como respuesta rápida.",
      "err.which": "¿Qué respuesta rápida? Tienes: {list}",
      "err.more": " y {n} más",
      "err.noneCalledClose": "Ninguna respuesta rápida se llama «{value}». ¿Querías decir: {list}?",
      "err.noneCalled": "Ninguna respuesta rápida se llama «{value}». Tienes: {list}"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.showButton": "Bouton dans la barre de discussion",
      "settings.showButton.description": "Un bouton dans la barre de discussion qui ouvre tes réponses rapides.",
      "settings.commandAction": "Effet de /snip",
      "settings.commandAction.description": "Ce que /snip fait de la réponse rapide quand tu ne choisis pas l'option d'envoi.",
      "settings.commandAction.send": "L'envoyer tout de suite",
      "settings.commandAction.insert": "La mettre dans la zone de message pour la modifier d'abord",
      "toast.noBox": "Impossible de trouver la zone de message où placer la réponse rapide",
      "toast.checkClipboard": "Cette réponse rapide utilise ce que tu as copié, elle est donc dans la zone de message pour que tu la vérifies avant de l'envoyer.",
      "toast.saved": "« {name} » enregistrée. Utilise-la avec /snip ou le bouton des réponses rapides.",
      "command.description": "Envoie l'une de tes réponses rapides ou place-la dans la zone de message",
      "command.name.choices": "La réponse rapide",
      "command.name.free": "Le nom de la réponse rapide",
      "command.send": "Activé : l'envoyer tout de suite. Désactivé : la mettre dans la zone de message pour la modifier d'abord.",
      "editor.name": "Nom",
      "editor.text": "Texte",
      "editor.namePlaceholder": "p. ex. bienvenue",
      "editor.textPlaceholder": "Salut {user}, merci de nous avoir écrit !",
      "editor.placeholders": "Variables",
      "editor.cancel": "Annuler",
      "editor.save": "Enregistrer",
      "editor.add": "Ajouter la réponse rapide",
      "row.edit": "Modifier",
      "row.delete": "Supprimer",
      "row.editLabel": "Modifier {name}",
      "row.deleteLabel": "Supprimer {name}",
      "picker.editTitle": "Modifier la réponse rapide",
      "picker.newTitle": "Nouvelle réponse rapide",
      "picker.search": "Rechercher des réponses rapides",
      "picker.nameFirst": "Donne un nom à ta première réponse rapide",
      "picker.new": "Nouvelle",
      "picker.list": "Réponses rapides",
      "picker.noMatch": "Aucune réponse rapide ne correspond à « {query} ». Appuie sur Entrée pour la créer.",
      "picker.empty": "Enregistre les réponses que tu tapes souvent, puis place-les dans la zone de message depuis ici ou avec /snip.",
      "picker.hintChoose": "choisir",
      "picker.hintInsert": "insérer",
      "picker.hintClose": "fermer",
      "dialog.snippet": "Réponse rapide",
      "dialog.saveTitle": "Enregistrer comme réponse rapide",
      "button.label": "Réponses rapides",
      "panel.title": "Tes réponses rapides · {count}",
      "panel.new": "Nouvelle réponse rapide",
      "panel.empty": "Aucune réponse rapide pour l'instant. Ajoutes-en une ici, depuis le bouton de la barre de discussion, ou fais un clic droit sur un message et choisis Enregistrer comme réponse rapide.",
      "panel.placeholders": "Variables : {list}.",
      "panel.escape": "Tape {code} pour en garder une telle quelle.",
      "menu.save": "Enregistrer comme réponse rapide",
      "ph.user": "La personne à qui tu réponds, ou l'autre personne dans un MP",
      "ph.me": "Ton propre nom d'affichage",
      "ph.channel": "Le nom du salon",
      "ph.server": "Le nom du serveur",
      "ph.date": "La date du jour",
      "ph.time": "L'heure actuelle",
      "ph.clipboard": "Le texte que tu as copié",
      "err.nameEmpty": "Donne-lui un nom.",
      "err.nameLong": "Les noms peuvent contenir jusqu'à {max} caractères.",
      "err.nameTaken": "Il existe déjà une réponse rapide nommée « {name} ».",
      "err.textEmpty": "Écris le texte à insérer.",
      "err.textLong": "Les réponses rapides peuvent contenir jusqu'à {max} caractères (celle-ci en fait {length}).",
      "err.none": "Tu n'as pas encore de réponse rapide. Ajoutes-en une depuis le bouton de la barre de discussion, ou fais un clic droit sur un message et choisis Enregistrer comme réponse rapide.",
      "err.which": "Quelle réponse rapide ? Tu as : {list}",
      "err.more": " et {n} de plus",
      "err.noneCalledClose": "Aucune réponse rapide ne s'appelle « {value} ». Voulais-tu dire : {list} ?",
      "err.noneCalled": "Aucune réponse rapide ne s'appelle « {value} ». Tu as : {list}"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.showButton": "チャットバーのボタン",
      "settings.showButton.description": "スニペットを開くボタンをチャットバーに表示します。",
      "settings.commandAction": "/snipの動作",
      "settings.commandAction.description": "送信オプションを選ばなかったときに、/snipがスニペットをどうするかを指定します。",
      "settings.commandAction.send": "すぐに送信する",
      "settings.commandAction.insert": "メッセージ欄に入れて先に編集する",
      "toast.noBox": "スニペットを入れるメッセージ欄が見つかりませんでした",
      "toast.checkClipboard": "このスニペットはコピーした内容を使うため、送信前に確認できるようメッセージ欄に入れました。",
      "toast.saved": "「{name}」を保存しました。/snipまたはスニペットボタンから使えます。",
      "command.description": "保存したスニペットを送信するか、メッセージ欄に入れます",
      "command.name.choices": "スニペット",
      "command.name.free": "スニペットの名前",
      "command.send": "オン: すぐに送信します。オフ: メッセージ欄に入れて先に編集します。",
      "editor.name": "名前",
      "editor.text": "テキスト",
      "editor.namePlaceholder": "例: あいさつ",
      "editor.textPlaceholder": "{user}さん、ご連絡ありがとうございます!",
      "editor.placeholders": "プレースホルダー",
      "editor.cancel": "キャンセル",
      "editor.save": "保存",
      "editor.add": "スニペットを追加",
      "row.edit": "編集",
      "row.delete": "削除",
      "row.editLabel": "{name}を編集",
      "row.deleteLabel": "{name}を削除",
      "picker.editTitle": "スニペットを編集",
      "picker.newTitle": "新しいスニペット",
      "picker.search": "スニペットを検索",
      "picker.nameFirst": "最初のスニペットに名前を付けましょう",
      "picker.new": "新規",
      "picker.list": "スニペット",
      "picker.noMatch": "「{query}」に一致するスニペットはありません。Enterキーで作成できます。",
      "picker.empty": "よく入力する返信を保存して、ここから、または/snipでメッセージ欄に入れられます。",
      "picker.hintChoose": "選択",
      "picker.hintInsert": "挿入",
      "picker.hintClose": "閉じる",
      "dialog.snippet": "スニペット",
      "dialog.saveTitle": "スニペットとして保存",
      "button.label": "スニペット",
      "panel.title": "あなたのスニペット · {count}",
      "panel.new": "新しいスニペット",
      "panel.empty": "スニペットはまだありません。ここから、チャットバーのボタンから、またはメッセージを右クリックして「スニペットとして保存」を選んで追加できます。",
      "panel.placeholders": "プレースホルダー: {list}。",
      "panel.escape": "そのまま残したいときは {code} と入力します。",
      "menu.save": "スニペットとして保存",
      "ph.user": "返信先のユーザー、またはDMの相手",
      "ph.me": "あなた自身の表示名",
      "ph.channel": "チャンネル名",
      "ph.server": "サーバー名",
      "ph.date": "今日の日付",
      "ph.time": "現在の時刻",
      "ph.clipboard": "コピーしているテキスト",
      "err.nameEmpty": "名前を付けてください。",
      "err.nameLong": "名前は{max}文字までです。",
      "err.nameTaken": "「{name}」という名前のスニペットはすでにあります。",
      "err.textEmpty": "挿入するテキストを入力してください。",
      "err.textLong": "スニペットは{max}文字までです(このスニペットは{length}文字)。",
      "err.none": "スニペットはまだありません。チャットバーのスニペットボタンから追加するか、メッセージを右クリックして「スニペットとして保存」を選んでください。",
      "err.which": "どのスニペットですか? 保存済み: {list}",
      "err.more": "、ほか{n}件",
      "err.noneCalledClose": "「{value}」という名前のスニペットはありません。もしかして: {list}?",
      "err.noneCalled": "「{value}」という名前のスニペットはありません。保存済み: {list}"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.showButton": "Przycisk na pasku czatu",
      "settings.showButton.description": "Przycisk na pasku czatu, który otwiera Twoje szybkie odpowiedzi.",
      "settings.commandAction": "Działanie /snip",
      "settings.commandAction.description": "Co /snip robi z szybką odpowiedzią, gdy nie wybierzesz opcji wysyłania.",
      "settings.commandAction.send": "Wyślij od razu",
      "settings.commandAction.insert": "Wstaw do pola wiadomości, aby najpierw ją edytować",
      "toast.noBox": "Nie znaleziono pola wiadomości, do którego można wstawić szybką odpowiedź",
      "toast.checkClipboard": "Ta szybka odpowiedź używa tego, co skopiowano, więc trafiła do pola wiadomości, żeby można ją było sprawdzić przed wysłaniem.",
      "toast.saved": "Zapisano „{name}”. Użyj jej poleceniem /snip lub przyciskiem szybkich odpowiedzi.",
      "command.description": "Wyślij jedną ze swoich szybkich odpowiedzi lub wstaw ją do pola wiadomości",
      "command.name.choices": "Szybka odpowiedź",
      "command.name.free": "Nazwa szybkiej odpowiedzi",
      "command.send": "Włączone: wyślij od razu. Wyłączone: wstaw do pola wiadomości, aby najpierw ją edytować.",
      "editor.name": "Nazwa",
      "editor.text": "Tekst",
      "editor.namePlaceholder": "np. powitanie",
      "editor.textPlaceholder": "Cześć {user}, dzięki za wiadomość!",
      "editor.placeholders": "Symbole zastępcze",
      "editor.cancel": "Anuluj",
      "editor.save": "Zapisz",
      "editor.add": "Dodaj szybką odpowiedź",
      "row.edit": "Edytuj",
      "row.delete": "Usuń",
      "row.editLabel": "Edytuj: {name}",
      "row.deleteLabel": "Usuń: {name}",
      "picker.editTitle": "Edytuj szybką odpowiedź",
      "picker.newTitle": "Nowa szybka odpowiedź",
      "picker.search": "Szukaj szybkich odpowiedzi",
      "picker.nameFirst": "Nazwij swoją pierwszą szybką odpowiedź",
      "picker.new": "Nowa",
      "picker.list": "Szybkie odpowiedzi",
      "picker.noMatch": "Żadna szybka odpowiedź nie pasuje do „{query}”. Naciśnij Enter, aby ją utworzyć.",
      "picker.empty": "Zapisz odpowiedzi, które często wpisujesz, a potem wstawiaj je do pola wiadomości stąd lub poleceniem /snip.",
      "picker.hintChoose": "wybierz",
      "picker.hintInsert": "wstaw",
      "picker.hintClose": "zamknij",
      "dialog.snippet": "Szybka odpowiedź",
      "dialog.saveTitle": "Zapisz jako szybką odpowiedź",
      "button.label": "Szybkie odpowiedzi",
      "panel.title": "Twoje szybkie odpowiedzi · {count}",
      "panel.new": "Nowa szybka odpowiedź",
      "panel.empty": "Nie ma jeszcze szybkich odpowiedzi. Dodaj jedną tutaj, przyciskiem na pasku czatu albo kliknij wiadomość prawym przyciskiem myszy i wybierz Zapisz jako szybką odpowiedź.",
      "panel.placeholders": "Symbole zastępcze: {list}.",
      "panel.escape": "Wpisz {code}, aby zostawić jeden w takiej postaci.",
      "menu.save": "Zapisz jako szybką odpowiedź",
      "ph.user": "Osoba, której odpowiadasz, lub druga osoba w wiadomości prywatnej",
      "ph.me": "Twoja własna wyświetlana nazwa",
      "ph.channel": "Nazwa kanału",
      "ph.server": "Nazwa serwera",
      "ph.date": "Dzisiejsza data",
      "ph.time": "Aktualna godzina",
      "ph.clipboard": "Tekst, który masz skopiowany",
      "err.nameEmpty": "Nadaj jej nazwę.",
      "err.nameLong": "Nazwy mogą mieć do {max} znaków.",
      "err.nameTaken": "Szybka odpowiedź o nazwie „{name}” już istnieje.",
      "err.textEmpty": "Wpisz tekst do wstawienia.",
      "err.textLong": "Szybkie odpowiedzi mogą mieć do {max} znaków (ta ma {length}).",
      "err.none": "Nie masz jeszcze szybkich odpowiedzi. Dodaj jedną przyciskiem na pasku czatu albo kliknij wiadomość prawym przyciskiem myszy i wybierz Zapisz jako szybką odpowiedź.",
      "err.which": "Która szybka odpowiedź? Masz: {list}",
      "err.more": " i {n} więcej",
      "err.noneCalledClose": "Żadna szybka odpowiedź nie nazywa się „{value}”. Chodziło o: {list}?",
      "err.noneCalled": "Żadna szybka odpowiedź nie nazywa się „{value}”. Masz: {list}"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.showButton": "Botão na barra de chat",
      "settings.showButton.description": "Um botão na barra de chat que abre suas respostas rápidas.",
      "settings.commandAction": "O que o /snip faz",
      "settings.commandAction.description": "O que o /snip faz com a resposta rápida quando você não escolhe a opção de enviar.",
      "settings.commandAction.send": "Enviar na hora",
      "settings.commandAction.insert": "Colocar na caixa de mensagem para editar antes",
      "toast.noBox": "Não foi possível encontrar a caixa de mensagem para colocar a resposta rápida",
      "toast.checkClipboard": "Esta resposta rápida usa o que você copiou, então ela está na caixa de mensagem para você conferir antes de enviar.",
      "toast.saved": '"{name}" salva. Use com /snip ou com o botão de respostas rápidas.',
      "command.description": "Envie uma das suas respostas rápidas ou coloque-a na caixa de mensagem",
      "command.name.choices": "A resposta rápida",
      "command.name.free": "O nome da resposta rápida",
      "command.send": "Ligado: enviar na hora. Desligado: colocar na caixa de mensagem para editar antes.",
      "editor.name": "Nome",
      "editor.text": "Texto",
      "editor.namePlaceholder": "ex.: boas-vindas",
      "editor.textPlaceholder": "Oi {user}, obrigado por entrar em contato!",
      "editor.placeholders": "Marcadores",
      "editor.cancel": "Cancelar",
      "editor.save": "Salvar",
      "editor.add": "Adicionar resposta rápida",
      "row.edit": "Editar",
      "row.delete": "Excluir",
      "row.editLabel": "Editar {name}",
      "row.deleteLabel": "Excluir {name}",
      "picker.editTitle": "Editar resposta rápida",
      "picker.newTitle": "Nova resposta rápida",
      "picker.search": "Buscar respostas rápidas",
      "picker.nameFirst": "Dê um nome à sua primeira resposta rápida",
      "picker.new": "Nova",
      "picker.list": "Respostas rápidas",
      "picker.noMatch": 'Nenhuma resposta rápida corresponde a "{query}". Pressione Enter para criá-la.',
      "picker.empty": "Salve as respostas que você digita com frequência e coloque-as na caixa de mensagem daqui ou com /snip.",
      "picker.hintChoose": "escolher",
      "picker.hintInsert": "inserir",
      "picker.hintClose": "fechar",
      "dialog.snippet": "Resposta rápida",
      "dialog.saveTitle": "Salvar como resposta rápida",
      "button.label": "Respostas rápidas",
      "panel.title": "Suas respostas rápidas · {count}",
      "panel.new": "Nova resposta rápida",
      "panel.empty": "Ainda não há respostas rápidas. Adicione uma aqui, pelo botão da barra de chat, ou clique com o botão direito em uma mensagem e escolha Salvar como resposta rápida.",
      "panel.placeholders": "Marcadores: {list}.",
      "panel.escape": "Digite {code} para manter um como está escrito.",
      "menu.save": "Salvar como resposta rápida",
      "ph.user": "A pessoa a quem você está respondendo, ou a outra pessoa em uma DM",
      "ph.me": "Seu próprio nome de exibição",
      "ph.channel": "O nome do canal",
      "ph.server": "O nome do servidor",
      "ph.date": "A data de hoje",
      "ph.time": "A hora atual",
      "ph.clipboard": "O texto que você copiou",
      "err.nameEmpty": "Dê um nome a ela.",
      "err.nameLong": "Os nomes podem ter até {max} caracteres.",
      "err.nameTaken": 'Já existe uma resposta rápida chamada "{name}".',
      "err.textEmpty": "Escreva o texto a ser inserido.",
      "err.textLong": "As respostas rápidas podem ter até {max} caracteres (esta tem {length}).",
      "err.none": "Você ainda não tem respostas rápidas. Adicione uma pelo botão da barra de chat, ou clique com o botão direito em uma mensagem e escolha Salvar como resposta rápida.",
      "err.which": "Qual resposta rápida? Você tem: {list}",
      "err.more": " e mais {n}",
      "err.noneCalledClose": 'Nenhuma resposta rápida se chama "{value}". Você quis dizer: {list}?',
      "err.noneCalled": 'Nenhuma resposta rápida se chama "{value}". Você tem: {list}'
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.showButton": "Кнопка в панели чата",
      "settings.showButton.description": "Кнопка в панели чата, которая открывает ваши шаблоны.",
      "settings.commandAction": "Что делает /snip",
      "settings.commandAction.description": "Что /snip делает с шаблоном, если вы не выбрали вариант отправки.",
      "settings.commandAction.send": "Сразу отправить",
      "settings.commandAction.insert": "Вставить в поле сообщения, чтобы сначала отредактировать",
      "toast.noBox": "Не удалось найти поле сообщения, чтобы вставить шаблон",
      "toast.checkClipboard": "Этот шаблон использует скопированный вами текст, поэтому он вставлен в поле сообщения, чтобы вы проверили его перед отправкой.",
      "toast.saved": "Шаблон «{name}» сохранён. Используйте его командой /snip или кнопкой шаблонов.",
      "command.description": "Отправить один из ваших шаблонов или вставить его в поле сообщения",
      "command.name.choices": "Шаблон",
      "command.name.free": "Название шаблона",
      "command.send": "Вкл.: сразу отправить. Выкл.: вставить в поле сообщения, чтобы сначала отредактировать.",
      "editor.name": "Название",
      "editor.text": "Текст",
      "editor.namePlaceholder": "например, приветствие",
      "editor.textPlaceholder": "Привет, {user}! Спасибо, что написал(а)!",
      "editor.placeholders": "Подстановки",
      "editor.cancel": "Отмена",
      "editor.save": "Сохранить",
      "editor.add": "Добавить шаблон",
      "row.edit": "Изменить",
      "row.delete": "Удалить",
      "row.editLabel": "Изменить: {name}",
      "row.deleteLabel": "Удалить: {name}",
      "picker.editTitle": "Изменить шаблон",
      "picker.newTitle": "Новый шаблон",
      "picker.search": "Поиск шаблонов",
      "picker.nameFirst": "Назовите свой первый шаблон",
      "picker.new": "Новый",
      "picker.list": "Шаблоны",
      "picker.noMatch": "Нет шаблонов, подходящих под «{query}». Нажмите Enter, чтобы создать его.",
      "picker.empty": "Сохраняйте ответы, которые часто набираете, и вставляйте их в поле сообщения отсюда или командой /snip.",
      "picker.hintChoose": "выбрать",
      "picker.hintInsert": "вставить",
      "picker.hintClose": "закрыть",
      "dialog.snippet": "Шаблон",
      "dialog.saveTitle": "Сохранить как шаблон",
      "button.label": "Шаблоны",
      "panel.title": "Ваши шаблоны · {count}",
      "panel.new": "Новый шаблон",
      "panel.empty": "Шаблонов пока нет. Добавьте его здесь, кнопкой в панели чата или нажмите на сообщение правой кнопкой мыши и выберите «Сохранить как шаблон».",
      "panel.placeholders": "Подстановки: {list}.",
      "panel.escape": "Введите {code}, чтобы оставить подстановку как есть.",
      "menu.save": "Сохранить как шаблон",
      "ph.user": "Человек, которому вы отвечаете, или собеседник в личных сообщениях",
      "ph.me": "Ваше отображаемое имя",
      "ph.channel": "Название канала",
      "ph.server": "Название сервера",
      "ph.date": "Сегодняшняя дата",
      "ph.time": "Текущее время",
      "ph.clipboard": "Скопированный вами текст",
      "err.nameEmpty": "Дайте ему название.",
      "err.nameLong": "Название может содержать до {max} символов.",
      "err.nameTaken": "Шаблон с названием «{name}» уже есть.",
      "err.textEmpty": "Введите текст для вставки.",
      "err.textLong": "Шаблон может содержать до {max} символов (в этом {length}).",
      "err.none": "У вас пока нет шаблонов. Добавьте его кнопкой в панели чата или нажмите на сообщение правой кнопкой мыши и выберите «Сохранить как шаблон».",
      "err.which": "Какой шаблон? Доступны: {list}",
      "err.more": " и ещё {n}",
      "err.noneCalledClose": "Шаблона с названием «{value}» нет. Возможно, вы имели в виду: {list}?",
      "err.noneCalled": "Шаблона с названием «{value}» нет. Доступны: {list}"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.showButton": "Sohbet çubuğu düğmesi",
      "settings.showButton.description": "Sohbet çubuğunda hazır yanıtlarını açan bir düğme.",
      "settings.commandAction": "/snip ne yapar",
      "settings.commandAction.description": "Gönderme seçeneğini seçmediğinde /snip'in hazır yanıtla ne yapacağı.",
      "settings.commandAction.send": "Hemen gönder",
      "settings.commandAction.insert": "Önce düzenlemek için mesaj kutusuna koy",
      "toast.noBox": "Hazır yanıtı koyacak mesaj kutusu bulunamadı",
      "toast.checkClipboard": "Bu hazır yanıt kopyaladığın metni kullanıyor, bu yüzden göndermeden önce kontrol edebilmen için mesaj kutusuna kondu.",
      "toast.saved": '"{name}" kaydedildi. /snip ile veya hazır yanıtlar düğmesiyle kullan.',
      "command.description": "Hazır yanıtlarından birini gönder ya da mesaj kutusuna koy",
      "command.name.choices": "Hazır yanıt",
      "command.name.free": "Hazır yanıtın adı",
      "command.send": "Açık: hemen gönder. Kapalı: önce düzenlemek için mesaj kutusuna koy.",
      "editor.name": "Ad",
      "editor.text": "Metin",
      "editor.namePlaceholder": "örn. hoş geldin",
      "editor.textPlaceholder": "Merhaba {user}, yazdığın için teşekkürler!",
      "editor.placeholders": "Yer tutucular",
      "editor.cancel": "İptal",
      "editor.save": "Kaydet",
      "editor.add": "Hazır yanıt ekle",
      "row.edit": "Düzenle",
      "row.delete": "Sil",
      "row.editLabel": "{name} adlı yanıtı düzenle",
      "row.deleteLabel": "{name} adlı yanıtı sil",
      "picker.editTitle": "Hazır yanıtı düzenle",
      "picker.newTitle": "Yeni hazır yanıt",
      "picker.search": "Hazır yanıtlarda ara",
      "picker.nameFirst": "İlk hazır yanıtına bir ad ver",
      "picker.new": "Yeni",
      "picker.list": "Hazır yanıtlar",
      "picker.noMatch": `"{query}" ile eşleşen hazır yanıt yok. Oluşturmak için Enter'a bas.`,
      "picker.empty": "Sık yazdığın yanıtları kaydet, sonra buradan veya /snip ile mesaj kutusuna koy.",
      "picker.hintChoose": "seç",
      "picker.hintInsert": "ekle",
      "picker.hintClose": "kapat",
      "dialog.snippet": "Hazır yanıt",
      "dialog.saveTitle": "Hazır yanıt olarak kaydet",
      "button.label": "Hazır yanıtlar",
      "panel.title": "Hazır yanıtların · {count}",
      "panel.new": "Yeni hazır yanıt",
      "panel.empty": "Henüz hazır yanıt yok. Buradan, sohbet çubuğu düğmesinden ekleyebilir ya da bir mesaja sağ tıklayıp Hazır yanıt olarak kaydet'i seçebilirsin.",
      "panel.placeholders": "Yer tutucular: {list}.",
      "panel.escape": "Birini yazıldığı gibi bırakmak için {code} yaz.",
      "menu.save": "Hazır yanıt olarak kaydet",
      "ph.user": "Yanıt verdiğin kişi ya da bir DM'deki diğer kişi",
      "ph.me": "Kendi görünen adın",
      "ph.channel": "Kanalın adı",
      "ph.server": "Sunucunun adı",
      "ph.date": "Bugünün tarihi",
      "ph.time": "Şu anki saat",
      "ph.clipboard": "Kopyaladığın metin",
      "err.nameEmpty": "Ona bir ad ver.",
      "err.nameLong": "Adlar en fazla {max} karakter olabilir.",
      "err.nameTaken": '"{name}" adında bir hazır yanıt zaten var.',
      "err.textEmpty": "Eklenecek metni yaz.",
      "err.textLong": "Hazır yanıtlar en fazla {max} karakter olabilir (bu {length} karakter).",
      "err.none": "Henüz hazır yanıtın yok. Sohbet çubuğundaki düğmeden ekle ya da bir mesaja sağ tıklayıp Hazır yanıt olarak kaydet'i seç.",
      "err.which": "Hangi hazır yanıt? Şunlar var: {list}",
      "err.more": " ve {n} tane daha",
      "err.noneCalledClose": '"{value}" adında hazır yanıt yok. Şunu mu demek istedin: {list}?',
      "err.noneCalled": '"{value}" adında hazır yanıt yok. Şunlar var: {list}'
    } })["tr"];
  }
});

// plugins/snippets/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var STORAGE_KEY = "snippets";
var settings = {
  showButton: {
    type: "boolean",
    get label() {
      return t("settings.showButton");
    },
    get description() {
      return t("settings.showButton.description");
    },
    default: true
  },
  commandAction: {
    type: "select",
    get label() {
      return t("settings.commandAction");
    },
    get description() {
      return t("settings.commandAction.description");
    },
    default: "send",
    options: [
      { get label() {
        return t("settings.commandAction.send");
      }, value: "send" },
      { get label() {
        return t("settings.commandAction.insert");
      }, value: "insert" }
    ]
  }
};
var ctx;
var panelCtx;
var state = EMPTY;
var storage = () => (ctx ?? panelCtx)?.settings;
var listeners = new Set;
var subscribe = (fn) => (listeners.add(fn), () => void listeners.delete(fn));
var useSnippets = () => import_api2.React.useSyncExternalStore(subscribe, () => state);
function notify() {
  for (const fn of [...listeners])
    fn();
}
function commit(next) {
  if (next === state)
    return;
  state = next;
  storage()?.set(STORAGE_KEY, state);
  notify();
  syncCommand();
}
function load() {
  state = parseState(storage()?.get(STORAGE_KEY));
  notify();
}
var store = (name) => {
  try {
    return import_api2.getStore(name);
  } catch {
    return;
  }
};
var dispatcher;
function componentDispatch() {
  const listening = (d) => {
    try {
      return d?.emitter?.listeners?.("INSERT_TEXT")?.length > 0;
    } catch {
      return false;
    }
  };
  if (listening(dispatcher))
    return dispatcher;
  const all = import_api2.findAllExports(import_api2.filters.byProps("dispatchToLastSubscribed", "emitter")).map((f) => f.value);
  dispatcher = all.find(listening);
  return dispatcher;
}
function insertText(text) {
  const d = componentDispatch();
  if (!d)
    return false;
  d.dispatchToLastSubscribed("INSERT_TEXT", { plainText: text, rawText: text });
  return true;
}
function displayName(user, guildId) {
  if (!user)
    return;
  const nick = guildId ? store("GuildMemberStore")?.getMember?.(guildId, user.id)?.nick : undefined;
  return nick || user.globalName || user.global_name || user.username;
}
async function readClipboard() {
  try {
    const native = window.DiscordNative?.clipboard;
    if (typeof native?.read === "function")
      return String(await native.read() ?? "");
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}
async function placeholderValues(text, channel) {
  const used = usedPlaceholders(text);
  if (!used.size)
    return {};
  channel ??= store("ChannelStore")?.getChannel?.(store("SelectedChannelStore")?.getChannelId?.());
  const guildId = channel?.guild_id ?? undefined;
  const users = store("UserStore");
  const values = { ...dateValues(new Date) };
  if (used.has("user") && channel) {
    const reply = store("PendingReplyStore")?.getPendingReply?.(channel.id);
    let user = reply?.message?.author;
    if (!user && channel.isDM?.()) {
      const id = channel.getRecipientId?.() ?? channel.recipients?.[0];
      user = id ? users?.getUser?.(id) : undefined;
    }
    values.user = displayName(user, guildId);
  }
  if (used.has("me"))
    values.me = displayName(users?.getCurrentUser?.(), guildId);
  if (used.has("channel") && channel?.name)
    values.channel = channel.name;
  if (used.has("server") && guildId)
    values.server = store("GuildStore")?.getGuild?.(guildId)?.name;
  if (used.has("clipboard"))
    values.clipboard = await readClipboard();
  return values;
}
async function expand(snippet, channel) {
  return expandPlaceholders(snippet.text, await placeholderValues(snippet.text, channel));
}
var say = (key2, vars) => t(key2, vars);
async function insertSnippet(snippet, channel) {
  const text = await expand(snippet, channel);
  if (!insertText(text)) {
    ctx?.toast(t("toast.noBox"), { type: "failure" });
    return false;
  }
  commit(recordUse(state, snippet.id));
  return true;
}
var unregisterCommand;
var registeredChoices = "";
function syncCommand() {
  if (!ctx)
    return;
  const choices = commandChoices(state);
  const key2 = JSON.stringify([choices ?? null, import_api2.I18n.locale]);
  if (unregisterCommand && key2 === registeredChoices)
    return;
  unregisterCommand?.();
  registeredChoices = key2;
  const plugin = ctx;
  unregisterCommand = import_api2.registerCommand({
    name: "snip",
    description: t("command.description"),
    options: [
      {
        name: "name",
        description: choices ? t("command.name.choices") : t("command.name.free"),
        type: "string",
        required: true,
        choices
      },
      {
        name: "send",
        description: t("command.send"),
        type: "boolean",
        required: false
      }
    ],
    async execute(args, command) {
      const found = resolveSnippet(state, args.name, say);
      if ("error" in found)
        return { ephemeral: found.error };
      const text = await expand(found.snippet, command.channel);
      commit(recordUse(state, found.snippet.id));
      const wantsSend = typeof args.send === "boolean" ? args.send : plugin.settings.get("commandAction") === "send";
      const send = wantsSend && !readsClipboard(found.snippet.text);
      if (send)
        return { content: text };
      if (wantsSend)
        plugin.toast(t("toast.checkClipboard"), { type: "info" });
      setTimeout(() => {
        if (!insertText(text))
          plugin.toast(t("toast.noBox"), { type: "failure" });
      }, 50);
    }
  }, plugin.id);
}
function Editor({ snippet, initial, onDone, autoFocusText }) {
  import_api2.useLocale();
  const current = useSnippets();
  const [name, setName] = import_api2.React.useState(snippet?.name ?? initial?.name ?? "");
  const [text, setText] = import_api2.React.useState(snippet?.text ?? initial?.text ?? "");
  const [tried, setTried] = import_api2.React.useState(false);
  const textRef = import_api2.React.useRef(null);
  const nameProblem = nameError(current, name, snippet?.id, say);
  const textProblem = textError(text, say);
  const error = nameProblem ?? textProblem;
  const save = () => {
    setTried(true);
    if (error)
      return;
    const result = snippet ? updateSnippet(state, snippet.id, { name, text }) : addSnippet(state, { name, text });
    if (result.error || !result.snippet)
      return;
    commit(result.state);
    onDone(result.snippet);
  };
  const insertPlaceholder = (key2) => {
    const el = textRef.current;
    const token = `{${key2}}`;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone(null);
    }
  };
  return /* @__PURE__ */ jsx_runtime.jsxs("form", {
    className: "evi-snip-editor",
    onSubmit: (e) => (e.preventDefault(), save()),
    onKeyDown,
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("label", {
        className: "evi-snip-label",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            children: t("editor.name")
          }),
          /* @__PURE__ */ jsx_runtime.jsx("input", {
            className: "evi-snip-input",
            value: name,
            maxLength: MAX_NAME_LENGTH,
            placeholder: t("editor.namePlaceholder"),
            "aria-invalid": tried && !!nameProblem,
            autoFocus: !autoFocusText,
            onChange: (e) => setName(e.currentTarget.value)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("label", {
        className: "evi-snip-label",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            children: t("editor.text")
          }),
          /* @__PURE__ */ jsx_runtime.jsx("textarea", {
            ref: textRef,
            className: "evi-snip-input evi-snip-textarea",
            value: text,
            maxLength: MAX_TEXT_LENGTH,
            rows: 5,
            placeholder: t("editor.textPlaceholder"),
            "aria-invalid": tried && !nameProblem && !!textProblem,
            autoFocus: autoFocusText,
            onChange: (e) => setText(e.currentTarget.value)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-snip-placeholders",
        "aria-label": t("editor.placeholders"),
        children: PLACEHOLDERS.map((p) => /* @__PURE__ */ jsx_runtime.jsx("button", {
          type: "button",
          className: "evi-snip-chip",
          title: t(`ph.${p.key}`),
          onClick: () => insertPlaceholder(p.key),
          children: `{${p.key}}`
        }, p.key))
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        className: "evi-snip-editor-foot",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            className: "evi-snip-error",
            role: "alert",
            children: tried && error ? error : ""
          }),
          /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "button",
            className: "evi-snip-button",
            onClick: () => onDone(null),
            children: t("editor.cancel")
          }),
          /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "submit",
            className: "evi-snip-button evi-snip-primary",
            children: snippet ? t("editor.save") : t("editor.add")
          })
        ]
      })
    ]
  });
}
function Row({ snippet, active, id, onPick, onEdit, onDelete, onHover }) {
  const [confirming, setConfirming] = import_api2.React.useState(false);
  import_api2.React.useEffect(() => {
    if (!confirming)
      return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);
  const preview = snippet.text.replace(/\s+/g, " ").slice(0, 140);
  return /* @__PURE__ */ jsx_runtime.jsxs("li", {
    id,
    className: "evi-snip-row",
    role: onPick ? "option" : undefined,
    "aria-selected": onPick ? !!active : undefined,
    "data-active": active || undefined,
    onMouseMove: onHover,
    onClick: onPick,
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        className: "evi-snip-row-text",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            className: "evi-snip-name",
            children: snippet.name
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            className: "evi-snip-preview",
            children: preview
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-snip-actions",
        onClick: (e) => e.stopPropagation(),
        children: confirming ? /* @__PURE__ */ jsx_runtime.jsx("button", {
          type: "button",
          className: "evi-snip-button evi-snip-danger",
          tabIndex: -1,
          onClick: onDelete,
          children: t("row.delete")
        }) : /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              type: "button",
              className: "evi-snip-icon",
              tabIndex: -1,
              "aria-label": t("row.editLabel", { name: snippet.name }),
              title: t("row.edit"),
              onClick: onEdit,
              children: /* @__PURE__ */ jsx_runtime.jsx("svg", {
                viewBox: "0 0 24 24",
                width: "16",
                height: "16",
                "aria-hidden": "true",
                children: /* @__PURE__ */ jsx_runtime.jsx("path", {
                  fill: "currentColor",
                  d: "m13.96 5.46 4.58 4.58L8.58 20H4v-4.58l9.96-9.96Zm1.41-1.41 1.84-1.84a2 2 0 0 1 2.83 0l1.75 1.75a2 2 0 0 1 0 2.83l-1.84 1.84-4.58-4.58Z"
                })
              })
            }),
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              type: "button",
              className: "evi-snip-icon",
              tabIndex: -1,
              "aria-label": t("row.deleteLabel", { name: snippet.name }),
              title: t("row.delete"),
              onClick: () => setConfirming(true),
              children: /* @__PURE__ */ jsx_runtime.jsx("svg", {
                viewBox: "0 0 24 24",
                width: "16",
                height: "16",
                "aria-hidden": "true",
                children: /* @__PURE__ */ jsx_runtime.jsx("path", {
                  fill: "currentColor",
                  d: "M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z"
                })
              })
            })
          ]
        })
      })
    ]
  });
}
function Picker({ channel, onClose }) {
  import_api2.useLocale();
  const current = useSnippets();
  const [query, setQuery] = import_api2.React.useState("");
  const [index, setIndex] = import_api2.React.useState(0);
  const [view, setView] = import_api2.React.useState({ kind: "list" });
  const listRef = import_api2.React.useRef(null);
  const searchRef = import_api2.React.useRef(null);
  const results = import_api2.React.useMemo(() => searchSnippets(current, query), [current, query]);
  const active = Math.min(index, Math.max(0, results.length - 1));
  import_api2.React.useEffect(() => setIndex(0), [query]);
  import_api2.React.useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active, results]);
  const pick = async (snippet) => {
    if (!snippet)
      return;
    onClose();
    await insertSnippet(snippet, channel);
  };
  const backToList = () => {
    setView({ kind: "list" });
    requestAnimationFrame(() => searchRef.current?.focus());
  };
  if (view.kind === "edit") {
    return /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-snip-picker",
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("header", {
          className: "evi-snip-head",
          children: /* @__PURE__ */ jsx_runtime.jsx("h2", {
            className: "evi-snip-title",
            children: view.snippet ? t("picker.editTitle") : t("picker.newTitle")
          })
        }),
        /* @__PURE__ */ jsx_runtime.jsx(Editor, {
          snippet: view.snippet,
          initial: view.initial,
          autoFocusText: !!view.snippet,
          onDone: (saved) => {
            if (saved)
              setQuery("");
            backToList();
          }
        })
      ]
    });
  }
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length)
        return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setIndex((active + step + results.length) % results.length);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      setIndex(Math.max(0, Math.min(results.length - 1, active + (e.key === "PageDown" ? 5 : -5))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active])
        pick(results[active]);
      else if (query.trim())
        setView({ kind: "edit", initial: { name: query.trim() } });
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "evi-snip-picker",
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("header", {
        className: "evi-snip-head",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("input", {
            ref: searchRef,
            className: "evi-snip-input evi-snip-search",
            placeholder: current.snippets.length ? t("picker.search") : t("picker.nameFirst"),
            "aria-label": t("picker.search"),
            role: "combobox",
            "aria-expanded": "true",
            "aria-controls": "evi-snip-list",
            "aria-activedescendant": results[active] ? `evi-snip-${results[active].id}` : undefined,
            value: query,
            autoFocus: true,
            onChange: (e) => setQuery(e.currentTarget.value),
            onKeyDown
          }),
          /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "button",
            className: "evi-snip-button evi-snip-primary",
            onClick: () => setView({ kind: "edit", initial: { name: results.length ? "" : query.trim() } }),
            children: t("picker.new")
          })
        ]
      }),
      results.length ? /* @__PURE__ */ jsx_runtime.jsx("ul", {
        id: "evi-snip-list",
        className: "evi-snip-list",
        role: "listbox",
        "aria-label": t("picker.list"),
        ref: listRef,
        children: results.map((s, i) => /* @__PURE__ */ jsx_runtime.jsx(Row, {
          id: `evi-snip-${s.id}`,
          snippet: s,
          active: i === active,
          onHover: () => i !== active && setIndex(i),
          onPick: () => void pick(s),
          onEdit: () => setView({ kind: "edit", snippet: s }),
          onDelete: () => commit(deleteSnippet(state, s.id))
        }, s.id))
      }) : /* @__PURE__ */ jsx_runtime.jsx("p", {
        className: "evi-snip-empty",
        children: current.snippets.length ? t("picker.noMatch", { query }) : t("picker.empty")
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("footer", {
        className: "evi-snip-foot",
        children: [
          /* @__PURE__ */ jsx_runtime.jsxs("span", {
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("kbd", {
                children: "↑"
              }),
              /* @__PURE__ */ jsx_runtime.jsx("kbd", {
                children: "↓"
              }),
              " ",
              t("picker.hintChoose")
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("span", {
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("kbd", {
                children: "Enter"
              }),
              " ",
              t("picker.hintInsert")
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("span", {
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("kbd", {
                children: "Esc"
              }),
              " ",
              t("picker.hintClose")
            ]
          })
        ]
      })
    ]
  });
}
var closeOpen;
var openAnchor = null;
var openListeners = new Set;
var useOpenAnchor = () => import_api2.React.useSyncExternalStore((fn) => (openListeners.add(fn), () => void openListeners.delete(fn)), () => openAnchor);
var setOpenAnchor = (el) => {
  openAnchor = el;
  for (const fn of [...openListeners])
    fn();
};
function showLayer(render, anchor) {
  closeOpen?.();
  const previous = document.activeElement;
  let host = null;
  const setHost = (el) => void (host = el);
  const onPointer = (e) => {
    const target = e.target;
    if (host?.contains(target) || anchor?.contains(target))
      return;
    close();
  };
  const onKey = (e) => {
    if (e.key !== "Escape" || host?.contains(e.target))
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const onInnerKey = (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && !e.nativeEvent.defaultPrevented)
      close();
  };
  const close = (options) => {
    if (closeOpen === close) {
      closeOpen = undefined;
      setOpenAnchor(null);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      if (!anchor && previous?.isConnected)
        previous.focus?.();
    }
    closeLayer(options);
  };
  let content;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right - 8);
    const bottom = Math.max(8, window.innerHeight - rect.top + 8);
    content = /* @__PURE__ */ jsx_runtime.jsx("div", {
      className: "evi-snip-popover evi-popout",
      "data-side": "top",
      role: "dialog",
      "aria-label": t("picker.list"),
      style: { right, bottom, maxHeight: Math.max(240, rect.top - 24) },
      ref: setHost,
      onKeyDown: onInnerKey,
      children: render(close)
    });
  } else {
    content = /* @__PURE__ */ jsx_runtime.jsx("div", {
      className: "evi-snip-scrim evi-scrim",
      ref: setHost,
      onKeyDown: onInnerKey,
      onMouseDown: (e) => e.target === e.currentTarget && close(),
      children: /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-snip-dialog evi-modal",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("dialog.snippet"),
        children: render(close)
      })
    });
  }
  const closeLayer = import_api2.openLayer(() => content, { className: "evi-snip-layer" });
  closeOpen = close;
  window.addEventListener("mousedown", onPointer, true);
  window.addEventListener("keydown", onKey, true);
  setOpenAnchor(anchor ?? null);
  return close;
}
function openPicker(anchor, channel) {
  if (closeOpen && openAnchor === anchor)
    return closeOpen();
  showLayer((close) => /* @__PURE__ */ jsx_runtime.jsx(Picker, {
    channel,
    onClose: close
  }), anchor);
}
function openEditorDialog(initial) {
  showLayer((close) => /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "evi-snip-picker",
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("header", {
        className: "evi-snip-head",
        children: /* @__PURE__ */ jsx_runtime.jsx("h2", {
          className: "evi-snip-title",
          children: t("dialog.saveTitle")
        })
      }),
      /* @__PURE__ */ jsx_runtime.jsx(Editor, {
        initial,
        autoFocusText: false,
        onDone: (saved) => {
          close();
          if (saved)
            ctx?.toast(t("toast.saved", { name: saved.name }), { type: "success" });
        }
      })
    ]
  }));
}
function lookup(search) {
  let value;
  let missedAt = -Infinity;
  return () => {
    if (value !== undefined || performance.now() - missedAt < 1e4)
      return value;
    value = search();
    if (value === undefined)
      missedAt = performance.now();
    return value;
  };
}
var getContainerClass = lookup(() => Object.values(import_api2.find((v) => typeof v === "object" && Object.values(v).some((c) => typeof c === "string" && c.startsWith("channelAppLauncherButtonPopoutIconAnimation_"))) ?? {}).find((c) => typeof c === "string" && c.startsWith("buttonContainer_")));
var chatButtonFilter = import_api2.filters.componentByCode("CHAT_INPUT_BUTTON_NOTIFICATION", "sparkle");
var getChatButton = lookup(() => import_api2.find(chatButtonFilter));
function SnippetIcon() {
  return /* @__PURE__ */ jsx_runtime.jsx("svg", {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": "true",
    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
      d: "M5 3a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2v3.5a.5.5 0 0 0 .85.35L11.7 18H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5Zm2 4h10v2H7V7Zm0 4h7v2H7v-2Z"
    })
  });
}
var noSettings = () => {
  return;
};
var noSubscribe = () => () => {};
var useSettings = () => ctx ? ctx.settings.use() : import_api2.React.useSyncExternalStore(noSubscribe, noSettings);
function SnippetsButton({ channel }) {
  import_api2.useLocale();
  const showButton = useSettings()?.showButton;
  const ref = import_api2.React.useRef(null);
  const anchor = useOpenAnchor();
  if (!showButton)
    return null;
  const open = !!anchor && anchor === ref.current;
  const onClick = () => ref.current && openPicker(ref.current, channel);
  const label = t("button.label");
  const ChatButton = getChatButton();
  const button = ChatButton ? /* @__PURE__ */ jsx_runtime.jsx(ChatButton, {
    onClick,
    isActive: open,
    "aria-label": label,
    "aria-expanded": open,
    sparkle: false,
    children: /* @__PURE__ */ jsx_runtime.jsx(SnippetIcon, {})
  }) : /* @__PURE__ */ jsx_runtime.jsx("button", {
    type: "button",
    className: "evi-snip-fallback",
    onClick,
    "aria-label": label,
    "aria-expanded": open,
    children: /* @__PURE__ */ jsx_runtime.jsx(SnippetIcon, {})
  });
  const Tooltip = import_api2.Components.Tooltip;
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    ref,
    className: getContainerClass(),
    "data-evi-snippets": "",
    children: Tooltip && !open ? /* @__PURE__ */ jsx_runtime.jsx(Tooltip, {
      text: label,
      position: "top",
      children: /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-snip-tip",
        children: button
      })
    }) : button
  });
}
function escapeHint() {
  const [before, after = ""] = t("panel.escape").split("{code}");
  return /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
    children: [
      before,
      /* @__PURE__ */ jsx_runtime.jsx("code", {
        children: "\\{user}"
      }),
      after
    ]
  });
}
function ManagePanel() {
  import_api2.useLocale();
  const current = useSnippets();
  const [editing, setEditing] = import_api2.React.useState(null);
  const sorted = [...current.snippets].sort(compareByName);
  const editingSnippet = editing && editing !== "new" ? getSnippet(current, editing) : undefined;
  return /* @__PURE__ */ jsx_runtime.jsxs("section", {
    className: "evi-snip-panel",
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        className: "evi-snip-panel-head",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("h3", {
            className: "evi-snip-title",
            children: t("panel.title", { count: current.snippets.length })
          }),
          editing === null && /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "button",
            className: "evi-snip-button evi-snip-primary",
            onClick: () => setEditing("new"),
            children: t("panel.new")
          })
        ]
      }),
      editing !== null && (editing === "new" || editingSnippet) && /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-snip-panel-editor",
        children: /* @__PURE__ */ jsx_runtime.jsx(Editor, {
          snippet: editingSnippet,
          onDone: () => setEditing(null)
        }, editing)
      }),
      sorted.length ? /* @__PURE__ */ jsx_runtime.jsx("ul", {
        className: "evi-snip-list",
        children: sorted.map((s) => /* @__PURE__ */ jsx_runtime.jsx(Row, {
          snippet: s,
          onEdit: () => setEditing(s.id),
          onDelete: () => commit(deleteSnippet(state, s.id))
        }, s.id))
      }) : editing === null && /* @__PURE__ */ jsx_runtime.jsx("p", {
        className: "evi-snip-empty",
        children: t("panel.empty")
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("p", {
        className: "evi-snip-hint",
        children: [
          t("panel.placeholders", { list: PLACEHOLDERS.map((p) => `{${p.key}}`).join(" ") }),
          " ",
          escapeHint()
        ]
      })
    ]
  });
}
var snippets_default = import_api2.definePlugin({
  settings,
  patches: [BUTTON_PATCH],
  injectButton(buttons, props) {
    try {
      if (!ctx?.settings.get("showButton") || !Array.isArray(buttons) || props?.channel?.id == null)
        return;
      buttons.push(/* @__PURE__ */ jsx_runtime.jsx(SnippetsButton, {
        channel: props.channel
      }, "evi-snippets"));
    } catch (err) {
      ctx?.logger.error("Couldn't add the chat bar button", err);
    }
  },
  settingsPanel(context) {
    if (!ctx && panelCtx !== context) {
      panelCtx = context;
      load();
    }
    return /* @__PURE__ */ jsx_runtime.jsx(ManagePanel, {});
  },
  getState: () => state,
  insertText,
  css: `
.evi-snip-layer { position: fixed; inset: 0; z-index: 1002; pointer-events: none; }
.evi-snip-layer > * { pointer-events: auto; }
.evi-snip-popover, .evi-snip-dialog {
    --evi-snip-text: var(--text-default, var(--text-normal, #dbdee1));
    --evi-snip-muted: var(--text-muted, #949ba4);
    --evi-snip-bg: var(--background-surface-high, var(--background-floating, #2b2d31));
    --evi-snip-input: var(--input-background, var(--background-tertiary, #1e1f22));
    --evi-snip-hover: var(--background-mod-normal, rgba(78, 80, 88, 0.48));
    --evi-snip-border: var(--border-subtle, rgba(255, 255, 255, 0.08));
    --evi-snip-brand: var(--brand-500, #5865f2);
    color: var(--evi-snip-text);
    background: var(--evi-snip-bg);
    border: 1px solid var(--evi-snip-border);
    border-radius: 12px;
    box-shadow: var(--shadow-high, 0 8px 24px rgba(0, 0, 0, 0.35));
    font-size: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.evi-snip-popover { position: fixed; width: min(420px, calc(100vw - 16px)); }
.evi-snip-scrim { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.6); }
.evi-snip-dialog { width: min(480px, calc(100vw - 32px)); max-height: calc(100vh - 64px); }
.evi-snip-picker { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.evi-snip-head { display: flex; gap: 8px; align-items: center; padding: 12px 12px 8px; }
.evi-snip-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--header-primary, var(--evi-snip-text)); }
.evi-snip-input {
    box-sizing: border-box; width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid transparent;
    background: var(--evi-snip-input, var(--input-background, #1e1f22)); color: inherit; font: inherit; outline: none;
}
.evi-snip-input:focus { border-color: var(--evi-snip-brand, #5865f2); }
.evi-snip-input[aria-invalid="true"] { border-color: var(--status-danger, #da373c); }
.evi-snip-input::placeholder { color: var(--evi-snip-muted, #949ba4); }
.evi-snip-search { flex: 1; }
.evi-snip-textarea { resize: vertical; min-height: 96px; max-height: 320px; line-height: 1.4; }
.evi-snip-list { list-style: none; margin: 0; padding: 0 6px 6px; overflow-y: auto; min-height: 0; flex: 1; }
.evi-snip-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 8px; cursor: pointer; }
.evi-snip-panel .evi-snip-row { cursor: default; }
.evi-snip-row[data-active], .evi-snip-panel .evi-snip-row:hover { background: var(--evi-snip-hover, var(--background-mod-normal, rgba(78, 80, 88, 0.48))); }
.evi-snip-row-text { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.evi-snip-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-snip-preview { color: var(--evi-snip-muted, #949ba4); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evi-snip-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 120ms ease; }
.evi-snip-row:hover .evi-snip-actions, .evi-snip-row[data-active] .evi-snip-actions, .evi-snip-actions:focus-within { opacity: 1; }
.evi-snip-icon {
    display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: none;
    color: var(--interactive-normal, #b5bac1); cursor: pointer;
}
.evi-snip-icon:hover { color: var(--interactive-active, #fff); background: var(--background-mod-strong, rgba(78, 80, 88, 0.6)); }
.evi-snip-button {
    flex-shrink: 0; height: 32px; padding: 0 14px; border: 0; border-radius: 8px; font: inherit; font-weight: 500; cursor: pointer;
    background: var(--button-secondary-background, #4e5058); color: #fff; transition: filter 120ms ease;
}
.evi-snip-button:hover { filter: brightness(1.1); }
.evi-snip-button:focus-visible, .evi-snip-icon:focus-visible, .evi-snip-chip:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 1px; }
.evi-snip-primary { background: var(--brand-500, #5865f2); }
.evi-snip-danger { background: var(--status-danger, #da373c); height: 28px; padding: 0 10px; }
.evi-snip-empty { margin: 0; padding: 16px 16px 20px; color: var(--evi-snip-muted, #949ba4); text-align: center; line-height: 1.4; }
.evi-snip-foot { display: flex; gap: 14px; padding: 8px 12px; border-top: 1px solid var(--evi-snip-border); color: var(--evi-snip-muted); font-size: 12px; }
.evi-snip-foot kbd {
    display: inline-block; min-width: 14px; margin-right: 3px; padding: 0 4px; border-radius: 4px; text-align: center;
    background: var(--evi-snip-input); font: inherit; font-size: 11px;
}
.evi-snip-editor { display: flex; flex-direction: column; gap: 10px; padding: 4px 12px 12px; overflow-y: auto; }
.evi-snip-label { display: flex; flex-direction: column; gap: 6px; }
.evi-snip-label > span { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .02em; color: var(--header-secondary, #b5bac1); }
.evi-snip-placeholders { display: flex; flex-wrap: wrap; gap: 6px; }
.evi-snip-chip {
    height: 24px; padding: 0 8px; border-radius: 12px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    background: var(--background-mod-subtle, rgba(78, 80, 88, 0.3)); color: var(--interactive-normal, #b5bac1);
    font-family: var(--font-code, monospace); font-size: 12px; cursor: pointer;
}
.evi-snip-chip:hover { color: var(--interactive-active, #fff); }
.evi-snip-editor-foot { display: flex; align-items: center; gap: 8px; }
.evi-snip-error { flex: 1; color: var(--text-danger, #f23f43); font-size: 13px; }
.evi-snip-fallback {
    display: flex; align-items: center; justify-content: center; height: 100%; padding: 4px; background: none; border: 0; cursor: pointer;
    color: var(--interactive-normal, #b5bac1);
}
.evi-snip-fallback:hover, .evi-snip-fallback[aria-expanded="true"] { color: var(--interactive-active, #fff); }
.evi-snip-tip { display: flex; align-items: center; height: 100%; }
.evi-snip-panel { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.evi-snip-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.evi-snip-panel .evi-snip-list { padding: 0; }
.evi-snip-panel-editor {
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); border-radius: 12px; padding-top: 10px;
    --evi-snip-input: var(--input-background, var(--background-tertiary, #1e1f22));
    --evi-snip-brand: var(--brand-500, #5865f2);
}
.evi-snip-hint { margin: 0; color: var(--text-muted, #949ba4); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .evi-snip-actions, .evi-snip-button { transition: none; } }
`,
  start(context) {
    ctx = context;
    panelCtx = undefined;
    load();
    syncCommand();
    context.contextMenu("message", (children, props) => {
      const content = typeof props?.message?.content === "string" ? props.message.content : "";
      if (!content.trim())
        return;
      children.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Group, {
        children: /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
          id: "evi-snippets-save",
          label: t("menu.save"),
          action: () => openEditorDialog({ name: suggestName(state, content), text: escapePlaceholders(content) })
        })
      }, "evi-snippets"));
    });
    context.flux.subscribe("CHANNEL_SELECT", () => {
      if (openAnchor)
        closeOpen?.();
    });
    context.onDispose(() => {
      closeOpen?.({ instant: true });
      unregisterCommand?.();
      unregisterCommand = undefined;
      registeredChoices = "";
      ctx = undefined;
      panelCtx = context;
    });
  }
});
