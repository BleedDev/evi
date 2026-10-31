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

// plugins/message-logger/index.tsx
var exports_message_logger = {};
__export(exports_message_logger, {
  default: () => message_logger_default
});
module.exports = __toCommonJS(exports_message_logger);
var import_api2 = require("@evi/api");

// plugins/message-logger/log.ts
var MAX_SAVED_BYTES = 25 * 1024 * 1024;
var attachmentKey = (a) => a.id ?? a.url ?? a.proxy_url ?? "";
function mediaKind(a) {
  const type = a.content_type ?? "";
  const name = (a.filename ?? a.url ?? "").toLowerCase().split("?")[0];
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/.test(name))
    return "image";
  if (type.startsWith("video/") || /\.(mp4|webm|mov)$/.test(name))
    return "video";
  if (type.startsWith("audio/") || /\.(mp3|ogg|wav|m4a|flac|opus)$/.test(name))
    return "audio";
  return "file";
}
var PREFETCH_FILE_BYTES = 5 * 1024 * 1024;
var ANIMATABLE_TYPE = /^image\/(gif|webp|avif)$/;
var ANIMATABLE_NAME = /\.(gif|webp|avif)$/;
function savedImageUrl(a, maxW = 800, maxH = 600) {
  if (!a.proxy_url || !a.width || !a.height)
    return;
  try {
    const scale = Math.min(1, maxW / a.width, maxH / a.height);
    const u = new URL(a.proxy_url);
    u.searchParams.set("width", String(Math.max(1, Math.round(a.width * scale))));
    u.searchParams.set("height", String(Math.max(1, Math.round(a.height * scale))));
    const name = (a.filename ?? u.pathname).toLowerCase();
    if (!ANIMATABLE_TYPE.test(a.content_type ?? "") && !ANIMATABLE_NAME.test(name))
      u.searchParams.set("format", "webp");
    return u.href;
  } catch {}
}
var shouldPrefetch = (a) => mediaKind(a) === "image" || (a.size ?? Infinity) <= PREFETCH_FILE_BYTES;
function attachmentsToSave(attachments, maxBytes = MAX_SAVED_BYTES) {
  return (attachments ?? []).filter((a) => !!(a.url || a.proxy_url) && (a.size ?? 0) <= maxBytes);
}
function removedAttachments(before, after) {
  if (!after)
    return [];
  const kept = new Set(after.map(attachmentKey));
  return (before ?? []).filter((a) => !kept.has(attachmentKey(a)));
}

class MediaCache {
  maxBytes;
  onEvict;
  items = new Map;
  bytes = 0;
  constructor(maxBytes, onEvict = () => {}) {
    this.maxBytes = maxBytes;
    this.onEvict = onEvict;
  }
  get size() {
    return this.bytes;
  }
  has(key) {
    return this.items.has(key);
  }
  set(key, item) {
    if (item.size > this.maxBytes)
      return this.onEvict(item);
    const old = this.items.get(key);
    if (old) {
      this.items.delete(key);
      this.bytes -= old.size;
      if (old !== item)
        this.onEvict(old);
    }
    this.items.set(key, item);
    this.bytes += item.size;
    for (const [k, v] of this.items) {
      if (this.bytes <= this.maxBytes)
        break;
      this.items.delete(k);
      this.bytes -= v.size;
      this.onEvict(v);
    }
  }
  take(key) {
    const item = this.items.get(key);
    if (!item)
      return;
    this.items.delete(key);
    this.bytes -= item.size;
    return item;
  }
  clear() {
    for (const item of this.items.values())
      this.onEvict(item);
    this.items.clear();
    this.bytes = 0;
  }
}
var DEFAULT_LIMITS = { perChannel: 50, channels: 100, edits: 10 };
var EPHEMERAL = 1 << 6;
function shouldLog(message, filters) {
  if ((message.flags ?? 0) & EPHEMERAL)
    return false;
  if (message.state === "SENDING" || message.state === "SEND_FAILED")
    return false;
  if (filters.ignoreSelf && !!filters.currentUserId && message.author?.id === filters.currentUserId)
    return false;
  if (filters.ignoreBots && message.author?.bot)
    return false;
  return true;
}

class MessageLog {
  onForget;
  channels = new Map;
  listeners = new Set;
  limits;
  version = 0;
  constructor(limits = {}, onForget = () => {}) {
    this.onForget = onForget;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }
  get(channelId, id) {
    return this.channels.get(channelId)?.get(id);
  }
  isDeleted(channelId, id) {
    return this.get(channelId, id)?.deletedAt !== undefined;
  }
  markDeleted(channelId, id, at = Date.now()) {
    const previous = this.get(channelId, id);
    if (previous?.deletedAt !== undefined)
      return [];
    return this.put({ ...previous, channelId, id, edits: previous?.edits ?? [], deletedAt: at });
  }
  addMedia(channelId, id, media) {
    const entry = this.get(channelId, id);
    if (!entry || !media.length)
      return false;
    const have = new Set(entry.media?.map((m) => m.key));
    const added = media.filter((m) => !have.has(m.key) && !!have.add(m.key));
    if (!added.length)
      return true;
    this.channels.get(channelId).set(id, { ...entry, media: [...entry.media ?? [], ...added] });
    this.changed();
    return true;
  }
  addEditMedia(channelId, id, timestamp, media) {
    const entry = this.get(channelId, id);
    const at = entry?.edits.findIndex((e) => e.timestamp === timestamp) ?? -1;
    if (!entry || at < 0 || !media.length)
      return false;
    const edits = entry.edits.map((e, i) => i === at ? { ...e, media: [...e.media ?? [], ...media] } : e);
    this.channels.get(channelId).set(id, { ...entry, edits });
    this.changed();
    return true;
  }
  mediaOf(channelId, id) {
    const entry = this.get(channelId, id);
    return entry ? [...entry.media ?? [], ...entry.edits.flatMap((e) => e.media ?? [])] : [];
  }
  addEdit(channelId, id, version) {
    const previous = this.get(channelId, id);
    const edits = this.trimEdits([...previous?.edits ?? [], version]);
    return this.put({ ...previous, channelId, id, deletedAt: previous?.deletedAt, edits });
  }
  remove(channelId, id) {
    const channel = this.channels.get(channelId);
    const entry = channel?.get(id);
    if (!channel || !entry)
      return;
    channel.delete(id);
    this.onForget(entry);
    if (!channel.size)
      this.channels.delete(channelId);
    this.changed();
  }
  setLimits(limits) {
    this.limits = { ...this.limits, ...limits };
    const evicted = [];
    for (const [channelId, channel] of this.channels) {
      for (const [id, entry] of channel) {
        if (entry.edits.length > Math.max(1, this.limits.edits))
          channel.set(id, { ...entry, edits: this.trimEdits([...entry.edits]) });
      }
      evicted.push(...this.trimChannel(channelId, channel));
    }
    evicted.push(...this.trimChannels());
    this.changed();
    return evicted;
  }
  deleted() {
    const out = new Map;
    for (const [channelId, channel] of this.channels) {
      const ids = [...channel.values()].filter((e) => e.deletedAt !== undefined).map((e) => e.id);
      if (ids.length)
        out.set(channelId, ids);
    }
    return out;
  }
  clear() {
    const deleted = [...this.deleted()].flatMap(([channelId, ids]) => ids.map((id) => ({ channelId, id })));
    const had = this.channels.size > 0;
    for (const channel of this.channels.values())
      for (const entry of channel.values())
        this.onForget(entry);
    this.channels.clear();
    if (had)
      this.changed();
    return deleted;
  }
  clearChannels(channelIds) {
    const deleted = [];
    let had = false;
    for (const channelId of channelIds) {
      const channel = this.channels.get(channelId);
      if (!channel)
        continue;
      had = true;
      this.channels.delete(channelId);
      for (const entry of channel.values()) {
        this.onForget(entry);
        if (entry.deletedAt !== undefined)
          deleted.push({ channelId, id: entry.id });
      }
    }
    if (had)
      this.changed();
    return deleted;
  }
  channelIds() {
    return [...this.channels.keys()];
  }
  counts(channelIds) {
    let deleted = 0;
    let edited = 0;
    const channels = channelIds ? [...channelIds].flatMap((id) => this.channels.get(id) ?? []) : [...this.channels.values()];
    for (const channel of channels) {
      for (const entry of channel.values()) {
        if (entry.deletedAt !== undefined)
          deleted++;
        if (entry.edits.length)
          edited++;
      }
    }
    return { deleted, edited, channels: channels.length };
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  put(entry) {
    let channel = this.channels.get(entry.channelId);
    if (channel) {
      this.channels.delete(entry.channelId);
      channel.delete(entry.id);
    } else {
      channel = new Map;
    }
    this.channels.set(entry.channelId, channel);
    channel.set(entry.id, entry);
    const evicted = [...this.trimChannel(entry.channelId, channel), ...this.trimChannels()];
    this.changed();
    return evicted;
  }
  trimEdits(edits) {
    while (edits.length > Math.max(1, this.limits.edits))
      edits.splice(1, 1);
    return edits;
  }
  trimChannel(channelId, channel) {
    const evicted = [];
    for (const [id, entry] of channel) {
      if (channel.size <= Math.max(1, this.limits.perChannel))
        break;
      channel.delete(id);
      this.onForget(entry);
      if (entry.deletedAt !== undefined)
        evicted.push({ channelId, id });
    }
    return evicted;
  }
  trimChannels() {
    const evicted = [];
    for (const [channelId, channel] of this.channels) {
      if (this.channels.size <= Math.max(1, this.limits.channels))
        break;
      this.channels.delete(channelId);
      for (const entry of channel.values()) {
        this.onForget(entry);
        if (entry.deletedAt !== undefined)
          evicted.push({ channelId, id: entry.id });
      }
    }
    return evicted;
  }
  changed() {
    this.version++;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {}
    }
  }
}

// plugins/message-logger/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "spoiler.show": "Show spoiler",
    spoiler: "Spoiler",
    versions: "Previous versions",
    "edited.from": "Edited from",
    deleted: "Deleted",
    "summary.title": "Logged right now",
    "summary.text": "{deleted} deleted, {edited} edited. Kept in memory only.",
    clear: "Clear logged messages",
    "clear.menu": "Clear Logged Messages",
    "count.deleted": "{count} deleted",
    "count.edited": "{count} edited",
    "count.sep": ", ",
    cleared: "Cleared {counts}",
    "settings.keepDeleted": "Keep deleted messages",
    "settings.keepDeleted.description": "Deleted messages stay in the chat, tinted red and marked Deleted.",
    "settings.logEdits": "Keep edit history",
    "settings.logEdits.description": "Edited messages show what they said before, under the message.",
    "settings.ignoreOwnDeletes": "Ignore my own deletes",
    "settings.ignoreOwnDeletes.description": "Messages you delete yourself disappear as usual.",
    "settings.ignoreSelf": "Ignore my own messages",
    "settings.ignoreSelf.description": "Never log your messages, whoever deletes or edits them.",
    "settings.ignoreBots": "Ignore bots",
    "settings.ignoreBots.description": "Don't log messages from bots and apps.",
    "settings.saveMedia": "Keep deleted pictures, videos and files",
    "settings.saveMedia.description": "Saves the attachments in the channel you're looking at as they load (pictures as a smaller copy, other files up to 5 MB, in memory), so a deleted message still shows them.",
    "settings.limit": "Messages logged per channel",
    "settings.limit.description": "Past this, the oldest are forgotten, and deleted ones among them disappear for real."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "spoiler.show": "Spoiler anzeigen",
      spoiler: "Spoiler",
      versions: "Frühere Versionen",
      "edited.from": "Bearbeitet von",
      deleted: "Gelöscht",
      "summary.title": "Aktuell protokolliert",
      "summary.text": "{deleted} gelöscht, {edited} bearbeitet. Nur im Arbeitsspeicher gehalten.",
      clear: "Protokollierte Nachrichten löschen",
      "clear.menu": "Protokollierte Nachrichten löschen",
      "count.deleted": "{count} gelöscht",
      "count.edited": "{count} bearbeitet",
      "count.sep": ", ",
      cleared: "Gelöscht: {counts}",
      "settings.keepDeleted": "Gelöschte Nachrichten behalten",
      "settings.keepDeleted.description": "Gelöschte Nachrichten bleiben im Chat, rot eingefärbt und als gelöscht markiert.",
      "settings.logEdits": "Bearbeitungsverlauf behalten",
      "settings.logEdits.description": "Bearbeitete Nachrichten zeigen unter der Nachricht, was vorher dort stand.",
      "settings.ignoreOwnDeletes": "Eigene Löschungen ignorieren",
      "settings.ignoreOwnDeletes.description": "Nachrichten, die du selbst löschst, verschwinden wie gewohnt.",
      "settings.ignoreSelf": "Eigene Nachrichten ignorieren",
      "settings.ignoreSelf.description": "Deine Nachrichten werden nie protokolliert, egal wer sie löscht oder bearbeitet.",
      "settings.ignoreBots": "Bots ignorieren",
      "settings.ignoreBots.description": "Nachrichten von Bots und Apps nicht protokollieren.",
      "settings.saveMedia": "Gelöschte Bilder, Videos und Dateien behalten",
      "settings.saveMedia.description": "Speichert die Anhänge im Kanal, den du gerade ansiehst, beim Laden (Bilder als kleinere Kopie, andere Dateien bis zu 5 MB, im Arbeitsspeicher), damit eine gelöschte Nachricht sie weiterhin zeigt.",
      "settings.limit": "Protokollierte Nachrichten pro Kanal",
      "settings.limit.description": "Darüber hinaus werden die ältesten vergessen, und gelöschte darunter verschwinden endgültig."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "spoiler.show": "Mostrar spoiler",
      spoiler: "Spoiler",
      versions: "Versiones anteriores",
      "edited.from": "Editado desde",
      deleted: "Eliminado",
      "summary.title": "Registrado ahora mismo",
      "summary.text": "{deleted} eliminados, {edited} editados. Solo se guardan en la memoria.",
      clear: "Borrar mensajes registrados",
      "clear.menu": "Borrar mensajes registrados",
      "count.deleted": "{count} eliminados",
      "count.edited": "{count} editados",
      "count.sep": ", ",
      cleared: "Borrados: {counts}",
      "settings.keepDeleted": "Conservar mensajes eliminados",
      "settings.keepDeleted.description": "Los mensajes eliminados se quedan en el chat, teñidos de rojo y marcados como eliminados.",
      "settings.logEdits": "Conservar historial de ediciones",
      "settings.logEdits.description": "Los mensajes editados muestran debajo lo que decían antes.",
      "settings.ignoreOwnDeletes": "Ignorar mis propios borrados",
      "settings.ignoreOwnDeletes.description": "Los mensajes que eliminas tú desaparecen como siempre.",
      "settings.ignoreSelf": "Ignorar mis propios mensajes",
      "settings.ignoreSelf.description": "Nunca registra tus mensajes, sin importar quién los elimine o edite.",
      "settings.ignoreBots": "Ignorar bots",
      "settings.ignoreBots.description": "No registra mensajes de bots ni de aplicaciones.",
      "settings.saveMedia": "Conservar imágenes, vídeos y archivos eliminados",
      "settings.saveMedia.description": "Guarda los archivos adjuntos del canal que estás viendo a medida que cargan (las imágenes como una copia más pequeña, otros archivos de hasta 5 MB, en memoria), para que un mensaje eliminado los siga mostrando.",
      "settings.limit": "Mensajes registrados por canal",
      "settings.limit.description": "Pasado este número, se olvidan los más antiguos, y los eliminados entre ellos desaparecen de verdad."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "spoiler.show": "Afficher le spoiler",
      spoiler: "Spoiler",
      versions: "Versions précédentes",
      "edited.from": "Modifié depuis",
      deleted: "Supprimé",
      "summary.title": "Actuellement enregistré",
      "summary.text": "{deleted} supprimés, {edited} modifiés. Conservés en mémoire uniquement.",
      clear: "Effacer les messages enregistrés",
      "clear.menu": "Effacer les messages enregistrés",
      "count.deleted": "{count} supprimés",
      "count.edited": "{count} modifiés",
      "count.sep": ", ",
      cleared: "Effacés : {counts}",
      "settings.keepDeleted": "Garder les messages supprimés",
      "settings.keepDeleted.description": "Les messages supprimés restent dans la discussion, teintés de rouge et marqués comme supprimés.",
      "settings.logEdits": "Garder l'historique des modifications",
      "settings.logEdits.description": "Les messages modifiés affichent sous le message ce qu'ils disaient avant.",
      "settings.ignoreOwnDeletes": "Ignorer mes propres suppressions",
      "settings.ignoreOwnDeletes.description": "Les messages que tu supprimes toi-même disparaissent comme d'habitude.",
      "settings.ignoreSelf": "Ignorer mes propres messages",
      "settings.ignoreSelf.description": "N'enregistre jamais tes messages, peu importe qui les supprime ou les modifie.",
      "settings.ignoreBots": "Ignorer les bots",
      "settings.ignoreBots.description": "N'enregistre pas les messages des bots et des applications.",
      "settings.saveMedia": "Garder les images, vidéos et fichiers supprimés",
      "settings.saveMedia.description": "Enregistre les pièces jointes du salon que tu regardes au fur et à mesure de leur chargement (les images en copie réduite, les autres fichiers jusqu'à 5 Mo, en mémoire), pour qu'un message supprimé les affiche toujours.",
      "settings.limit": "Messages enregistrés par salon",
      "settings.limit.description": "Au-delà, les plus anciens sont oubliés, et ceux qui ont été supprimés disparaissent pour de bon."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "spoiler.show": "ネタバレを表示",
      spoiler: "ネタバレ",
      versions: "以前のバージョン",
      "edited.from": "編集前",
      deleted: "削除済み",
      "summary.title": "現在の記録",
      "summary.text": "削除 {deleted} 件、編集 {edited} 件。メモリ上にのみ保持されます。",
      clear: "記録したメッセージを消去",
      "clear.menu": "記録したメッセージを消去",
      "count.deleted": "削除 {count} 件",
      "count.edited": "編集 {count} 件",
      "count.sep": "、",
      cleared: "消去しました: {counts}",
      "settings.keepDeleted": "削除されたメッセージを残す",
      "settings.keepDeleted.description": "削除されたメッセージはチャットに残り、赤く表示されて「削除済み」と表示されます。",
      "settings.logEdits": "編集履歴を残す",
      "settings.logEdits.description": "編集されたメッセージの下に、編集前の内容を表示します。",
      "settings.ignoreOwnDeletes": "自分で削除したものは無視",
      "settings.ignoreOwnDeletes.description": "自分で削除したメッセージは通常どおり消えます。",
      "settings.ignoreSelf": "自分のメッセージは無視",
      "settings.ignoreSelf.description": "誰が削除や編集をしても、自分のメッセージは記録しません。",
      "settings.ignoreBots": "ボットを無視",
      "settings.ignoreBots.description": "ボットやアプリのメッセージを記録しません。",
      "settings.saveMedia": "削除された画像、動画、ファイルを残す",
      "settings.saveMedia.description": "表示中のチャンネルの添付ファイルを読み込み時に保存し (画像は縮小コピー、その他のファイルは最大 5 MB、メモリ上)、削除されたメッセージでも表示できるようにします。",
      "settings.limit": "チャンネルごとの記録メッセージ数",
      "settings.limit.description": "この数を超えると古いものから忘れられ、その中の削除済みメッセージは完全に消えます。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "spoiler.show": "Pokaż spoiler",
      spoiler: "Spoiler",
      versions: "Poprzednie wersje",
      "edited.from": "Edytowano z",
      deleted: "Usunięto",
      "summary.title": "Aktualnie zapisane",
      "summary.text": "Usunięte: {deleted}, edytowane: {edited}. Trzymane tylko w pamięci.",
      clear: "Wyczyść zapisane wiadomości",
      "clear.menu": "Wyczyść zapisane wiadomości",
      "count.deleted": "usunięte: {count}",
      "count.edited": "edytowane: {count}",
      "count.sep": ", ",
      cleared: "Wyczyszczono ({counts})",
      "settings.keepDeleted": "Zachowuj usunięte wiadomości",
      "settings.keepDeleted.description": "Usunięte wiadomości zostają na czacie, zabarwione na czerwono i oznaczone jako usunięte.",
      "settings.logEdits": "Zachowuj historię edycji",
      "settings.logEdits.description": "Edytowane wiadomości pokazują pod spodem, co było w nich wcześniej.",
      "settings.ignoreOwnDeletes": "Ignoruj moje usunięcia",
      "settings.ignoreOwnDeletes.description": "Wiadomości, które sam usuwasz, znikają jak zwykle.",
      "settings.ignoreSelf": "Ignoruj moje wiadomości",
      "settings.ignoreSelf.description": "Nigdy nie zapisuje Twoich wiadomości, niezależnie od tego, kto je usuwa lub edytuje.",
      "settings.ignoreBots": "Ignoruj boty",
      "settings.ignoreBots.description": "Nie zapisuj wiadomości od botów i aplikacji.",
      "settings.saveMedia": "Zachowuj usunięte zdjęcia, filmy i pliki",
      "settings.saveMedia.description": "Zapisuje załączniki z oglądanego kanału w trakcie ich ładowania (zdjęcia jako mniejsza kopia, inne pliki do 5 MB, w pamięci), dzięki czemu usunięta wiadomość nadal je pokazuje.",
      "settings.limit": "Zapisane wiadomości na kanał",
      "settings.limit.description": "Po przekroczeniu tej liczby najstarsze są zapominane, a usunięte wśród nich znikają naprawdę."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "spoiler.show": "Mostrar spoiler",
      spoiler: "Spoiler",
      versions: "Versões anteriores",
      "edited.from": "Editada de",
      deleted: "Excluída",
      "summary.title": "Registrado agora",
      "summary.text": "{deleted} excluídas, {edited} editadas. Mantidas apenas na memória.",
      clear: "Limpar mensagens registradas",
      "clear.menu": "Limpar mensagens registradas",
      "count.deleted": "{count} excluídas",
      "count.edited": "{count} editadas",
      "count.sep": ", ",
      cleared: "Limpo: {counts}",
      "settings.keepDeleted": "Manter mensagens excluídas",
      "settings.keepDeleted.description": "As mensagens excluídas continuam no chat, em tom avermelhado e marcadas como excluídas.",
      "settings.logEdits": "Manter histórico de edições",
      "settings.logEdits.description": "As mensagens editadas mostram, abaixo delas, o que diziam antes.",
      "settings.ignoreOwnDeletes": "Ignorar minhas próprias exclusões",
      "settings.ignoreOwnDeletes.description": "As mensagens que você mesmo exclui somem normalmente.",
      "settings.ignoreSelf": "Ignorar minhas próprias mensagens",
      "settings.ignoreSelf.description": "Nunca registra suas mensagens, não importa quem as exclua ou edite.",
      "settings.ignoreBots": "Ignorar bots",
      "settings.ignoreBots.description": "Não registra mensagens de bots e apps.",
      "settings.saveMedia": "Manter imagens, vídeos e arquivos excluídos",
      "settings.saveMedia.description": "Salva os anexos do canal que você está vendo conforme carregam (imagens como uma cópia menor, outros arquivos até 5 MB, na memória), para que uma mensagem excluída ainda os mostre.",
      "settings.limit": "Mensagens registradas por canal",
      "settings.limit.description": "Depois disso, as mais antigas são esquecidas, e as excluídas entre elas somem de verdade."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "spoiler.show": "Показать спойлер",
      spoiler: "Спойлер",
      versions: "Предыдущие версии",
      "edited.from": "Изменено с",
      deleted: "Удалено",
      "summary.title": "Сейчас записано",
      "summary.text": "Удалено: {deleted}, изменено: {edited}. Хранится только в памяти.",
      clear: "Очистить записанные сообщения",
      "clear.menu": "Очистить записанные сообщения",
      "count.deleted": "удалено: {count}",
      "count.edited": "изменено: {count}",
      "count.sep": ", ",
      cleared: "Очищено ({counts})",
      "settings.keepDeleted": "Сохранять удалённые сообщения",
      "settings.keepDeleted.description": "Удалённые сообщения остаются в чате, подсвечены красным и помечены как удалённые.",
      "settings.logEdits": "Сохранять историю изменений",
      "settings.logEdits.description": "Под изменёнными сообщениями показано, что в них было раньше.",
      "settings.ignoreOwnDeletes": "Игнорировать мои удаления",
      "settings.ignoreOwnDeletes.description": "Сообщения, которые вы удаляете сами, исчезают как обычно.",
      "settings.ignoreSelf": "Игнорировать мои сообщения",
      "settings.ignoreSelf.description": "Ваши сообщения не записываются, кто бы их ни удалял и ни изменял.",
      "settings.ignoreBots": "Игнорировать ботов",
      "settings.ignoreBots.description": "Не записывать сообщения от ботов и приложений.",
      "settings.saveMedia": "Сохранять удалённые картинки, видео и файлы",
      "settings.saveMedia.description": "Сохраняет вложения в открытом канале по мере загрузки (картинки — уменьшенной копией, остальные файлы до 5 МБ, в памяти), чтобы удалённое сообщение по-прежнему их показывало.",
      "settings.limit": "Записанных сообщений на канал",
      "settings.limit.description": "Сверх этого самые старые забываются, а удалённые среди них исчезают по-настоящему."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "spoiler.show": "Spoiler'ı göster",
      spoiler: "Spoiler",
      versions: "Önceki sürümler",
      "edited.from": "Şundan düzenlendi",
      deleted: "Silindi",
      "summary.title": "Şu an kaydedilenler",
      "summary.text": "{deleted} silindi, {edited} düzenlendi. Yalnızca bellekte tutulur.",
      clear: "Kaydedilen mesajları temizle",
      "clear.menu": "Kaydedilen Mesajları Temizle",
      "count.deleted": "{count} silindi",
      "count.edited": "{count} düzenlendi",
      "count.sep": ", ",
      cleared: "Temizlendi: {counts}",
      "settings.keepDeleted": "Silinen mesajları koru",
      "settings.keepDeleted.description": "Silinen mesajlar sohbette kalır, kırmızıya boyanır ve silindi olarak işaretlenir.",
      "settings.logEdits": "Düzenleme geçmişini koru",
      "settings.logEdits.description": "Düzenlenen mesajlar, altında önceden ne yazdığını gösterir.",
      "settings.ignoreOwnDeletes": "Kendi sildiklerimi yok say",
      "settings.ignoreOwnDeletes.description": "Kendi sildiğin mesajlar her zamanki gibi kaybolur.",
      "settings.ignoreSelf": "Kendi mesajlarımı yok say",
      "settings.ignoreSelf.description": "Kim silerse ya da düzenlerse düzenlesin, mesajların hiç kaydedilmez.",
      "settings.ignoreBots": "Botları yok say",
      "settings.ignoreBots.description": "Botların ve uygulamaların mesajlarını kaydetme.",
      "settings.saveMedia": "Silinen resim, video ve dosyaları koru",
      "settings.saveMedia.description": "Baktığın kanaldaki ekleri yüklenirken kaydeder (resimler küçültülmüş bir kopya olarak, diğer dosyalar en fazla 5 MB, bellekte), böylece silinen bir mesaj bunları göstermeye devam eder.",
      "settings.limit": "Kanal başına kaydedilen mesaj",
      "settings.limit.description": "Bu sayıdan sonra en eskiler unutulur, aralarındaki silinenler de gerçekten kaybolur."
    } })["tr"];
  }
});

// plugins/message-logger/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var PURGE_ACTION = "EVI_MESSAGE_LOGGER_PURGE";
var SELF_DELETE_WINDOW = 60000;
var CACHE_BYTES = 25 * 1024 * 1024;
var SAVE_FROM_LOADED = 50;
var accessoriesFilter = import_api2.filters.byCode("channelMessageProps:{message:", "isAutomodBlockedMessage:");
var renderedContentFilter = import_api2.filters.byCode('"useMessageRenderedContent"', "hasBailedAst:");
var MARKUP_CLASS = /^markup_+[\da-f]+$/;
var markupFilter = Object.assign((v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((c) => typeof c === "string" && MARKUP_CLASS.test(c)) && Object.values(v).some((c) => typeof c === "string" && /^codeContainer_+[\da-f]+$/.test(c)), { $code: ['"markup_', '"codeContainer_'] });
var messageActionsFilter = Object.assign(import_api2.filters.byProps("deleteMessage", "editMessage", "sendMessage"), { $code: ["deleteMessage", "editMessage", "sendMessage"] });
function withStore(ctx, name, callback) {
  const found = import_api2.findStore(name);
  if (found)
    callback(found);
  else
    ctx.waitFor(import_api2.filters.byStoreName(name), callback);
}
var useRenderedContent;
var markupClass = "";
var css = `
[data-list-item-id^="chat-messages___"]:has(.dl-ml-deleted) {
    background: color-mix(in srgb, var(--status-danger, #f23f43) 8%, transparent);
    box-shadow: inset 2px 0 0 var(--status-danger, #f23f43);
}
.dl-ml {
    text-indent: 0;
    padding: 0.125rem 0;
    font-family: var(--font-primary);
}
.dl-ml-history {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0.125rem 0;
    padding-inline-start: 0.5rem;
    border-inline-start: 2px solid var(--border-subtle, rgba(151, 151, 159, 0.12));
}
.dl-ml-caption, .dl-ml-time, .dl-ml-deleted {
    font-size: 0.75rem;
    line-height: 1rem;
}
.dl-ml-caption {
    color: var(--text-muted, #949ba4);
    font-weight: 500;
}
.dl-ml-version {
    color: var(--text-muted, #949ba4);
    font-size: 0.875rem;
    line-height: 1.25rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.dl-ml-time {
    color: var(--text-muted, #949ba4);
    margin-inline-end: 0.375rem;
    font-variant-numeric: tabular-nums;
}
.dl-ml-content {
    display: inline;
}
.dl-ml-deleted {
    display: inline-block;
    color: var(--text-feedback-critical, var(--status-danger, #f23f43));
    font-weight: 500;
}
/* Discord's own attachments of a deleted message are gone from its CDN: our saved copies stand in */
[data-list-item-id^="chat-messages___"]:has(.dl-ml-saved) :is([class*="visualMediaItemContainer_"], [class*="nonVisualMediaItemContainer_"]) {
    display: none;
}
.dl-ml-media {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0.25rem 0;
}
.dl-ml-media img, .dl-ml-media video {
    display: block;
    max-width: min(400px, 100%);
    max-height: 300px;
    border-radius: 8px;
    outline: 1px solid rgb(255 255 255 / 0.08);
    outline-offset: -1px;
    background: var(--background-secondary, #2b2d31);
}
.dl-ml-history .dl-ml-media img, .dl-ml-history .dl-ml-media video {
    max-width: 200px;
    max-height: 150px;
}
.dl-ml-spoiler {
    all: unset;
    position: relative;
    display: block;
    cursor: pointer;
    border-radius: 8px;
    overflow: hidden;
}
.dl-ml-spoiler > img { filter: blur(44px); }
.dl-ml-spoiler > span {
    position: absolute;
    inset: 50% auto auto 50%;
    translate: -50% -50%;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 600;
}
.dl-ml-spoiler:focus-visible { outline: 2px solid var(--focus-primary, #00a8fc); }
.dl-ml-file {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border-subtle, rgba(151, 151, 159, 0.12));
    background: var(--background-secondary, #2b2d31);
    color: var(--text-link, #00a8fc);
    font-size: 0.875rem;
}
.dl-ml-file small { color: var(--text-muted, #949ba4); }
`;
function formatTime(ms) {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
function Time({ ms }) {
  return /* @__PURE__ */ jsx_runtime.jsx("time", {
    className: "dl-ml-time",
    dateTime: new Date(ms).toISOString(),
    children: formatTime(ms)
  });
}
function RichContent({ message, content, render }) {
  const record = import_api2.React.useMemo(() => message.set?.("content", content) ?? { ...message, content }, [message, content]);
  const rendered = render(record, {
    hideSimpleEmbedContent: false,
    formatInline: false,
    allowLinks: true,
    allowList: true,
    allowHeading: true
  });
  return /* @__PURE__ */ jsx_runtime.jsx(jsx_runtime.Fragment, {
    children: rendered?.content ?? content
  });
}
var revokeAll = (media) => {
  for (const m of media)
    URL.revokeObjectURL(m.url);
};
var formatSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
function Spoiler({ children }) {
  const [shown, setShown] = import_api2.React.useState(false);
  if (shown)
    return children;
  return /* @__PURE__ */ jsx_runtime.jsxs("button", {
    type: "button",
    className: "dl-ml-spoiler",
    "aria-label": t("spoiler.show"),
    onClick: () => setShown(true),
    children: [
      children,
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        children: t("spoiler")
      })
    ]
  });
}
function SavedMediaList({ media }) {
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: "dl-ml-media",
    children: media.map((m) => {
      if (m.kind === "image") {
        const img = /* @__PURE__ */ jsx_runtime.jsx("img", {
          src: m.url,
          alt: m.name,
          width: m.width,
          height: m.height,
          loading: "lazy"
        });
        return /* @__PURE__ */ jsx_runtime.jsx(import_api2.React.Fragment, {
          children: m.spoiler ? /* @__PURE__ */ jsx_runtime.jsx(Spoiler, {
            children: img
          }) : img
        }, m.key);
      }
      if (m.kind === "video")
        return /* @__PURE__ */ jsx_runtime.jsx("video", {
          src: m.url,
          controls: true,
          preload: "metadata",
          "aria-label": m.name
        }, m.key);
      if (m.kind === "audio")
        return /* @__PURE__ */ jsx_runtime.jsx("audio", {
          src: m.url,
          controls: true,
          preload: "metadata",
          "aria-label": m.name
        }, m.key);
      return /* @__PURE__ */ jsx_runtime.jsxs("a", {
        className: "dl-ml-file",
        href: m.url,
        download: m.name,
        children: [
          m.name,
          " ",
          /* @__PURE__ */ jsx_runtime.jsx("small", {
            children: formatSize(m.size)
          })
        ]
      }, m.key);
    })
  });
}
function Version({ message, version }) {
  const render = useRenderedContent;
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "dl-ml-version",
    children: [
      /* @__PURE__ */ jsx_runtime.jsx(Time, {
        ms: version.timestamp
      }),
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: `dl-ml-content ${markupClass}`,
        children: render ? /* @__PURE__ */ jsx_runtime.jsx(RichContent, {
          message,
          content: version.content,
          render
        }) : version.content
      }),
      !!version.media?.length && /* @__PURE__ */ jsx_runtime.jsx(SavedMediaList, {
        media: version.media
      })
    ]
  });
}
function Logged({ log, message }) {
  const entry = import_api2.React.useSyncExternalStore(log.subscribe, () => log.get(message.channel_id, message.id));
  if (!entry)
    return null;
  const saved = entry.deletedAt !== undefined && !!entry.media?.length;
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: saved ? "dl-ml dl-ml-saved" : "dl-ml",
    children: [
      saved && /* @__PURE__ */ jsx_runtime.jsx(SavedMediaList, {
        media: entry.media
      }),
      entry.edits.length > 0 && /* @__PURE__ */ jsx_runtime.jsxs("div", {
        className: "dl-ml-history",
        role: "group",
        "aria-label": t("versions"),
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            className: "dl-ml-caption",
            children: t("edited.from")
          }),
          entry.edits.map((version, i) => /* @__PURE__ */ jsx_runtime.jsx(Version, {
            message,
            version
          }, i))
        ]
      }),
      entry.deletedAt !== undefined && /* @__PURE__ */ jsx_runtime.jsxs("span", {
        className: "dl-ml-deleted",
        children: [
          t("deleted"),
          " ",
          /* @__PURE__ */ jsx_runtime.jsx("time", {
            dateTime: new Date(entry.deletedAt).toISOString(),
            children: formatTime(entry.deletedAt)
          })
        ]
      })
    ]
  });
}
var active;
function Summary({ runtime }) {
  import_api2.React.useSyncExternalStore(runtime.log.subscribe, () => runtime.log.version);
  const { deleted, edited } = runtime.log.counts();
  const Button = import_api2.Components.Button;
  const empty = deleted + edited === 0;
  const label = t("clear");
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "dl-field-row",
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        className: "dl-field-text",
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            className: "dl-label",
            children: t("summary.title")
          }),
          /* @__PURE__ */ jsx_runtime.jsx("p", {
            className: "dl-hint",
            role: "status",
            style: { fontVariantNumeric: "tabular-nums" },
            children: t("summary.text", { deleted, edited })
          })
        ]
      }),
      Button ? /* @__PURE__ */ jsx_runtime.jsx(Button, {
        color: Button.Colors?.RED,
        size: Button.Sizes?.SMALL,
        disabled: empty,
        onClick: runtime.clear,
        children: label
      }) : /* @__PURE__ */ jsx_runtime.jsx("button", {
        type: "button",
        className: "dl-button",
        disabled: empty,
        onClick: runtime.clear,
        children: label
      })
    ]
  });
}
var settings = {
  keepDeleted: { type: "boolean", get label() {
    return t("settings.keepDeleted");
  }, get description() {
    return t("settings.keepDeleted.description");
  }, default: true },
  logEdits: { type: "boolean", get label() {
    return t("settings.logEdits");
  }, get description() {
    return t("settings.logEdits.description");
  }, default: true },
  ignoreOwnDeletes: { type: "boolean", get label() {
    return t("settings.ignoreOwnDeletes");
  }, get description() {
    return t("settings.ignoreOwnDeletes.description");
  }, default: true },
  ignoreSelf: { type: "boolean", get label() {
    return t("settings.ignoreSelf");
  }, get description() {
    return t("settings.ignoreSelf.description");
  }, default: false },
  ignoreBots: { type: "boolean", get label() {
    return t("settings.ignoreBots");
  }, get description() {
    return t("settings.ignoreBots.description");
  }, default: false },
  saveMedia: {
    type: "boolean",
    get label() {
      return t("settings.saveMedia");
    },
    get description() {
      return t("settings.saveMedia.description");
    },
    default: true
  },
  limit: {
    type: "number",
    get label() {
      return t("settings.limit");
    },
    get description() {
      return t("settings.limit.description");
    },
    default: 50,
    min: 10,
    max: 200,
    step: 10
  }
};
function mediaSaver(ctx, cache) {
  const pending = new Map;
  const queue = [];
  let running = 0;
  const pump = () => {
    while (running < 2 && queue.length) {
      running++;
      queue.shift()().finally(() => {
        running--;
        pump();
      });
    }
  };
  async function download(a) {
    const name = a.filename ?? "attachment";
    const urls = mediaKind(a) === "image" ? [savedImageUrl(a), a.proxy_url, (a.size ?? 0) <= PREFETCH_FILE_BYTES ? a.url : undefined] : [a.url, a.proxy_url];
    for (const url of urls) {
      if (!url)
        continue;
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok)
          continue;
        const blob = await res.blob();
        if (blob.size > MAX_SAVED_BYTES)
          return;
        return {
          key: attachmentKey(a),
          name,
          kind: mediaKind(a),
          url: URL.createObjectURL(blob),
          size: blob.size,
          ...a.width && { width: a.width },
          ...a.height && { height: a.height },
          spoiler: name.startsWith("SPOILER_")
        };
      } catch {}
    }
  }
  const fetchOnce = (a) => {
    const key = attachmentKey(a);
    let job = pending.get(key);
    if (!job) {
      job = new Promise((resolve) => {
        queue.push(() => download(a).then(resolve, () => resolve(undefined)));
        pump();
      });
      pending.set(key, job);
      job.finally(() => pending.delete(key));
    }
    return job;
  };
  return {
    prefetch(attachments) {
      if (!ctx.settings.get("saveMedia"))
        return;
      for (const a of attachmentsToSave(attachments).filter(shouldPrefetch)) {
        const key = attachmentKey(a);
        if (cache.has(key) || pending.has(key))
          continue;
        fetchOnce(a).then((m) => m && cache.set(key, m));
      }
    },
    keep(attachments, later) {
      if (!ctx.settings.get("saveMedia"))
        return [];
      const now = [];
      const missing = [];
      for (const a of attachmentsToSave(attachments)) {
        const saved = cache.take(attachmentKey(a));
        if (saved)
          now.push(saved);
        else
          missing.push(a);
      }
      if (missing.length) {
        Promise.all(missing.map((a) => fetchOnce(a).then((m) => m && (cache.take(m.key) ?? m)))).then((list) => {
          const got = list.filter((m) => !!m);
          if (got.length)
            later(got);
        });
      }
      return now;
    }
  };
}
function install(ctx, log, store, saver) {
  const registry = import_api2.Dispatcher._actionHandlers;
  const token = store.getDispatchToken?.();
  const handlers = registry?._nodes?.get?.(token)?.actionHandler ?? registry?._dependencyGraph?.getNodeData?.(token)?.actionHandler;
  if (!handlers || !["MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "MESSAGE_UPDATE"].every((t2) => typeof handlers[t2] === "function")) {
    ctx.logger.error("Couldn't find MessageStore's action handlers, Discord changed how Flux stores register");
    return;
  }
  const invalidate = () => registry._invalidateCaches?.();
  ctx.onDispose(invalidate);
  let users;
  withStore(ctx, "UserStore", (s) => void (users = s));
  const logFilters = () => ({
    currentUserId: users?.getCurrentUser?.()?.id,
    ignoreSelf: ctx.settings.get("ignoreSelf"),
    ignoreBots: ctx.settings.get("ignoreBots")
  });
  const selfDeletes = new Map;
  ctx.hookExport("before", messageActionsFilter, "deleteMessage", ({ args }) => {
    const now = Date.now();
    for (const [key, at] of selfDeletes)
      if (now - at > SELF_DELETE_WINDOW)
        selfDeletes.delete(key);
    selfDeletes.set(`${args[0]}:${args[1]}`, now);
  });
  const purge = (refs) => {
    const byChannel = new Map;
    for (const { channelId, id } of refs)
      byChannel.set(channelId, [...byChannel.get(channelId) ?? [], id]);
    return Promise.all([...byChannel].map(([channelId, ids]) => import_api2.Dispatcher.dispatch({ type: PURGE_ACTION, channelId, ids })));
  };
  const purgeHandler = (action) => handlers.MESSAGE_DELETE_BULK({ type: "MESSAGE_DELETE_BULK", channelId: action.channelId, ids: action.ids, eviPurge: true });
  handlers[PURGE_ACTION] = purgeHandler;
  const byType = registry._tokensByActionType;
  if (byType && !byType[PURGE_ACTION]?.includes(token))
    (byType[PURGE_ACTION] ??= []).push(token);
  const shouldKeep = (action, channelId, id) => {
    if (log.isDeleted(channelId, id))
      return true;
    const key = `${channelId}:${id}`;
    const self = selfDeletes.delete(key);
    if (action.local || !ctx.settings.get("keepDeleted"))
      return false;
    if (self && ctx.settings.get("ignoreOwnDeletes"))
      return false;
    const message = store.getMessage(channelId, id);
    return !!message && shouldLog(message, logFilters());
  };
  const keepMedia = (channelId, id) => {
    const attachments = store.getMessage(channelId, id)?.attachments;
    if (!attachments?.length || log.get(channelId, id)?.media?.length)
      return;
    const now = saver.keep(attachments, (later) => {
      if (!log.addMedia(channelId, id, later))
        revokeAll(later);
    });
    if (!log.addMedia(channelId, id, now))
      revokeAll(now);
  };
  ctx.hook.instead(handlers, "MESSAGE_DELETE", (call) => {
    const action = call.args[0];
    if (action.eviPurge || !shouldKeep(action, action.channelId, action.id))
      return call.callOriginal(...call.args);
    purge(log.markDeleted(action.channelId, action.id));
    keepMedia(action.channelId, action.id);
    return false;
  });
  ctx.hook.instead(handlers, "MESSAGE_DELETE_BULK", (call) => {
    const action = call.args[0];
    if (action.eviPurge)
      return call.callOriginal(...call.args);
    const keep = [];
    const drop = [];
    for (const id of action.ids ?? [])
      (shouldKeep(action, action.channelId, id) ? keep : drop).push(id);
    purge(keep.flatMap((id) => log.markDeleted(action.channelId, id)));
    for (const id of keep)
      keepMedia(action.channelId, id);
    return drop.length ? call.callOriginal({ ...action, ids: drop }) : false;
  });
  ctx.hook.before(handlers, "MESSAGE_UPDATE", ({ args }) => {
    const next = args[0]?.message;
    if (!ctx.settings.get("logEdits") || !next?.id)
      return;
    const channelId = next.channel_id;
    const old = store.getMessage(channelId, next.id);
    if (!old || typeof old.content !== "string" || !shouldLog(old, logFilters()))
      return;
    const changedText = typeof next.content === "string" && old.content !== next.content;
    const removed = removedAttachments(old.attachments, next.attachments);
    if (!changedText && !removed.length)
      return;
    const timestamp = Number(old.editedTimestamp ?? old.timestamp) || Date.now();
    const media = saver.keep(removed, (later) => {
      if (!log.addEditMedia(channelId, next.id, timestamp, later))
        revokeAll(later);
    });
    purge(log.addEdit(channelId, next.id, { content: old.content, timestamp, ...media.length && { media } }));
  });
  invalidate();
  const runtime = {
    log,
    clear: () => void purge(log.clear()),
    clearChannels: (ids) => void purge(log.clearChannels(ids))
  };
  active = runtime;
  ctx.settings.onChange((values) => {
    purge(log.setLimits({ perChannel: values.limit }));
    if (!values.keepDeleted) {
      const kept = [...log.deleted()].flatMap(([channelId, ids]) => ids.map((id) => ({ channelId, id })));
      for (const { channelId, id } of kept)
        log.remove(channelId, id);
      purge(kept);
    }
  });
  ctx.onDispose(() => {
    if (active === runtime)
      active = undefined;
    purge(log.clear()).finally(() => {
      if (handlers[PURGE_ACTION] !== purgeHandler)
        return;
      delete handlers[PURGE_ACTION];
      if (byType)
        delete byType[PURGE_ACTION];
      invalidate();
    });
  });
}
function markDeleted(ctx, log) {
  const style = document.createElement("style");
  style.id = "evi-message-logger-deleted";
  document.head.append(style);
  ctx.onDispose(() => style.remove());
  const update = () => {
    const label = JSON.stringify(` (${t("deleted").toLowerCase()})`);
    const rules = [];
    for (const [channelId, ids] of log.deleted()) {
      for (const id of ids) {
        const row = `#chat-messages-${channelId}-${id}`;
        const text = `${row} #message-content-${id}`;
        rules.push(`${row} { background: color-mix(in srgb, var(--status-danger, #f23f43) 8%, transparent); box-shadow: inset 2px 0 0 var(--status-danger, #f23f43); opacity: 1 !important; }`, `${text} { color: var(--text-feedback-critical, var(--status-danger, #f23f43)) !important; opacity: 1 !important; }`, `${row}:not(:has(.dl-ml-deleted)) #message-content-${id}::after { content: ${label}; font-size: 0.75rem; font-weight: 500; }`);
      }
    }
    const css2 = rules.join(`
`);
    if (style.textContent !== css2)
      style.textContent = css2;
  };
  update();
  ctx.onDispose(log.subscribe(update));
}
function countLabel({ deleted, edited }) {
  return [deleted && t("count.deleted", { count: deleted }), edited && t("count.edited", { count: edited })].filter(Boolean).join(t("count.sep"));
}
function clearItem(ctx, id, label, channelIds) {
  const runtime = active;
  if (!runtime || !channelIds.length)
    return;
  const counts = runtime.log.counts(channelIds);
  if (counts.deleted + counts.edited === 0)
    return;
  return /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Group, {
    children: /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
      id,
      label,
      subtext: countLabel(counts),
      color: "danger",
      action: () => {
        runtime.clearChannels(channelIds);
        ctx.toast(t("cleared", { counts: countLabel(counts) }), { type: "success" });
      }
    })
  }, `${id}-group`);
}
function guildChannelIds(guildId) {
  const channels = import_api2.findStore("ChannelStore");
  return active?.log.channelIds().filter((id) => channels?.getChannel?.(id)?.guild_id === guildId) ?? [];
}
var message_logger_default = import_api2.definePlugin({
  settings,
  start(ctx) {
    const log = new MessageLog({ perChannel: ctx.settings.get("limit") }, (entry) => {
      revokeAll(entry.media ?? []);
      for (const e of entry.edits)
        revokeAll(e.media ?? []);
    });
    const cache = new MediaCache(CACHE_BYTES, (m) => URL.revokeObjectURL(m.url));
    const saver = mediaSaver(ctx, cache);
    ctx.onDispose(() => cache.clear());
    ctx.addStyle(css);
    withStore(ctx, "MessageStore", (store) => install(ctx, log, store, saver));
    markDeleted(ctx, log);
    let selected;
    withStore(ctx, "SelectedChannelStore", (s) => void (selected = s));
    const inView = (channelId) => !!channelId && channelId === selected?.getChannelId?.();
    ctx.flux.subscribe("MESSAGE_CREATE", (action) => {
      if (inView(action.channelId) && !action.optimistic)
        saver.prefetch(action.message?.attachments);
    });
    ctx.flux.subscribe("LOAD_MESSAGES_SUCCESS", (action) => {
      if (!inView(action.channelId) || !Array.isArray(action.messages))
        return;
      for (const m of action.messages.slice(0, SAVE_FROM_LOADED))
        saver.prefetch(m?.attachments);
    });
    ctx.settings.onChange((values) => void (!values.saveMedia && cache.clear()));
    if (!useRenderedContent)
      ctx.waitFor(renderedContentFilter, (fn) => void (useRenderedContent = fn));
    if (!markupClass)
      ctx.waitFor(markupFilter, (classes) => {
        markupClass = Object.values(classes).find((c) => typeof c === "string" && MARKUP_CLASS.test(c)) ?? "";
      });
    ctx.contextMenu(["channel-context", "thread-context", "gdm-context"], (children, props) => {
      const item = props.channel?.id && clearItem(ctx, "evi-ml-clear-channel", t("clear.menu"), [props.channel.id]);
      if (item)
        children.push(item);
    });
    ctx.contextMenu("user-context", (children, props) => {
      const channel = props.channel;
      if (!channel?.id || channel.guild_id || channel.type !== 1)
        return;
      const item = clearItem(ctx, "evi-ml-clear-dm", t("clear.menu"), [channel.id]);
      if (item)
        children.push(item);
    });
    ctx.contextMenu("guild-context", (children, props) => {
      const item = props.guild?.id && clearItem(ctx, "evi-ml-clear-guild", t("clear.menu"), guildChannelIds(props.guild.id));
      if (item)
        children.push(item);
    });
    ctx.hookExport("after", accessoriesFilter, ({ args, result }) => {
      const props = args[0];
      const message = props?.channelMessageProps?.message;
      if (result == null || props.isMessageSnapshot || !message?.id)
        return;
      return /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          result,
          /* @__PURE__ */ jsx_runtime.jsx(Logged, {
            log,
            message
          })
        ]
      });
    });
  },
  settingsPanel: () => active && /* @__PURE__ */ jsx_runtime.jsx(Summary, {
    runtime: active
  }),
  getLog: () => active?.log
});
