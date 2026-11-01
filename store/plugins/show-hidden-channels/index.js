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

// plugins/show-hidden-channels/index.tsx
var exports_show_hidden_channels = {};
__export(exports_show_hidden_channels, {
  default: () => show_hidden_channels_default
});
module.exports = __toCommonJS(exports_show_hidden_channels);
var import_api4 = require("@evi/api");

// plugins/show-hidden-channels/LockScreen.tsx
var import_api3 = require("@evi/api");

// plugins/show-hidden-channels/shared.ts
var import_api = require("@evi/api");
var ID = "show-hidden-channels";
var defaults = { showMode: "lock", hideUnreads: true, showAllowedByDefault: true };
var context;
var setContext = (ctx) => void (context = ctx);
var getContext = () => context;
function setting(key) {
  if (context)
    return context.settings.get(key);
  const stored = window.Evi?.settings?.plugin?.(ID)?.settings;
  return stored && key in stored ? stored[key] : defaults[key];
}
var Permissions = {
  VIEW_CHANNEL: 1n << 10n,
  CONNECT: 1n << 20n
};
var stores = new Map;
function store(name) {
  let found = stores.get(name);
  if (found)
    return found;
  try {
    found = import_api.getStore(name);
  } catch {
    return;
  }
  stores.set(name, found);
  return found;
}
function findCached(search) {
  let value;
  let retryAt = -Infinity;
  let wait = 5000;
  return () => {
    if (value !== undefined)
      return value;
    if (performance.now() < retryAt)
      return;
    value = search();
    if (value === undefined) {
      retryAt = performance.now() + wait;
      wait = Math.min(wait * 2, 60000);
    }
    return value;
  };
}
var permissionStamp = 0;
var watching = false;
var permissionChanges = () => permissionStamp;
function watchPermissions() {
  const permissions = store("PermissionStore");
  if (typeof permissions?.addChangeListener !== "function")
    return () => {};
  const changed = () => void permissionStamp++;
  permissions.addChangeListener(changed);
  watching = true;
  return () => {
    watching = false;
    permissionStamp++;
    permissions.removeChangeListener?.(changed);
  };
}
var verdicts = new WeakMap;
function verdictFor(permissions, channel) {
  const guildVersion = typeof permissions.getGuildVersion === "function" ? permissions.getGuildVersion(channel.guild_id) : undefined;
  const channelsVersion = typeof permissions.getChannelsVersion === "function" ? permissions.getChannelsVersion() : undefined;
  let verdict = watching ? verdicts.get(channel) : undefined;
  if (verdict && verdict.stamp === permissionStamp && verdict.guildVersion === guildVersion && verdict.channelsVersion === channelsVersion)
    return verdict;
  verdict = { stamp: permissionStamp, guildVersion, channelsVersion, canView: !!permissions.can(Permissions.VIEW_CHANNEL, channel) };
  if (watching)
    verdicts.set(channel, verdict);
  return verdict;
}
function canConnect(channel) {
  const permissions = store("PermissionStore");
  if (!permissions || channel == null || typeof channel !== "object")
    return false;
  const verdict = verdictFor(permissions, channel);
  return verdict.canConnect ??= !!permissions.can(Permissions.CONNECT, channel);
}
var PSEUDO_CHANNELS = new Set(["browse", "customize", "guide"]);
function isHiddenChannel(channel, checkConnect = false) {
  try {
    if (channel == null || Object.hasOwn(channel, "channelId") && channel.channelId == null)
      return false;
    if (channel.channelId != null)
      channel = store("ChannelStore")?.getChannel(channel.channelId);
    if (channel == null || channel.isDM?.() || channel.isGroupDM?.() || channel.isMultiUserDM?.())
      return false;
    if (PSEUDO_CHANNELS.has(channel.id))
      return false;
    const permissions = store("PermissionStore");
    if (!permissions)
      return false;
    if (typeof channel !== "object")
      return !permissions.can(Permissions.VIEW_CHANNEL, channel) || checkConnect && !permissions.can(Permissions.CONNECT, channel);
    const verdict = verdictFor(permissions, channel);
    if (!verdict.canView)
      return true;
    return checkConnect && !(verdict.canConnect ??= !!permissions.can(Permissions.CONNECT, channel));
  } catch (err) {
    context?.logger.error("isHiddenChannel threw", err);
    return false;
  }
}
function cssClasses(...names) {
  const patterns = names.map((n) => [n, new RegExp(`^${n}_+[\\da-f]+(?: |$)`)]);
  const matches = (value, pattern) => typeof value === "string" && pattern.test(value);
  const lookup = findCached(() => {
    const module2 = import_api.find((v) => !!v && typeof v === "object" && !Array.isArray(v) && patterns.every(([, p]) => Object.values(v).some((c) => matches(c, p))));
    if (!module2)
      return;
    const classes = {};
    for (const [n, p] of patterns)
      classes[n] = Object.values(module2).find((c) => matches(c, p));
    return classes;
  });
  return () => lookup() ?? {};
}

// plugins/show-hidden-channels/strings.ts
var import_api2 = require("@evi/api");
var t = import_api2.defineStrings({
  en: {
    "title.hidden.text": "This is a hidden text channel",
    "title.locked.text": "This is a locked text channel",
    "title.hidden.voice": "This is a hidden voice channel",
    "title.locked.voice": "This is a locked voice channel",
    "title.hidden.announcement": "This is a hidden announcement channel",
    "title.locked.announcement": "This is a locked announcement channel",
    "title.hidden.stage": "This is a hidden stage channel",
    "title.locked.stage": "This is a locked stage channel",
    "title.hidden.forum": "This is a hidden forum channel",
    "title.locked.forum": "This is a locked forum channel",
    "title.hidden.media": "This is a hidden media channel",
    "title.locked.media": "This is a locked media channel",
    "title.hidden.other": "This is a hidden channel",
    "title.locked.other": "This is a locked channel",
    "lead.messages": "You can't see the messages in this channel.",
    "lead.posts": "You can't see the posts in this channel.",
    "lead.guidelines": " Its guidelines are below.",
    "last.message": "Last message: {date}",
    "last.post": "Last post: {date}",
    "last.pin": "Last pin: {date}",
    slowmode: "Slowmode: {duration}",
    "slowmode.thread": "Default thread slowmode: {duration}",
    bitrate: "Bitrate: {kbps} kbps",
    region: "Region: {region}",
    automatic: "Automatic",
    "video.quality": "Video quality: {quality}",
    "archive.threads": "Threads archive after {duration} of inactivity",
    "archive.posts": "Posts archive after {duration} of inactivity",
    layout: "Default layout: {layout}",
    "layout.0": "Not set",
    "layout.1": "List view",
    "layout.2": "Gallery view",
    sort: "Default sort order: {order}",
    "sort.0": "Latest activity",
    "sort.1": "Creation date",
    reaction: "Default reaction:",
    "tag.required": "Posts in this forum need a tag.",
    tags: "Available tags",
    allowed: "Allowed users and roles",
    "allowed.hide": "Hide allowed users and roles",
    "allowed.show": "Show allowed users and roles",
    nsfw: "NSFW",
    emoji: "emoji",
    "hidden.channel": "Hidden channel",
    crashed: "Couldn't show this hidden channel.",
    "duration.day": { one: "{count} day", other: "{count} days" },
    "duration.hour": { one: "{count} hour", other: "{count} hours" },
    "duration.minute": { one: "{count} minute", other: "{count} minutes" },
    "duration.second": { one: "{count} second", other: "{count} seconds" },
    "settings.showMode": "How hidden channels look",
    "settings.showMode.description": "Takes effect after a reload for voice channels.",
    "settings.showMode.lock": "A lock instead of the channel icon",
    "settings.showMode.muted": "Muted, with a crossed-out eye after the name",
    "settings.hideUnreads": "Hide unreads",
    "settings.hideUnreads.description": "Hidden channels never show as unread.",
    "settings.showAllowed": "Show who can see it",
    "settings.showAllowed.description": "Open the allowed users and roles list on a hidden channel's page by default."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "title.hidden.text": "Dies ist ein versteckter Textkanal",
      "title.locked.text": "Dies ist ein gesperrter Textkanal",
      "title.hidden.voice": "Dies ist ein versteckter Sprachkanal",
      "title.locked.voice": "Dies ist ein gesperrter Sprachkanal",
      "title.hidden.announcement": "Dies ist ein versteckter Ankündigungskanal",
      "title.locked.announcement": "Dies ist ein gesperrter Ankündigungskanal",
      "title.hidden.stage": "Dies ist ein versteckter Bühnenkanal",
      "title.locked.stage": "Dies ist ein gesperrter Bühnenkanal",
      "title.hidden.forum": "Dies ist ein verstecktes Forum",
      "title.locked.forum": "Dies ist ein gesperrtes Forum",
      "title.hidden.media": "Dies ist ein versteckter Medienkanal",
      "title.locked.media": "Dies ist ein gesperrter Medienkanal",
      "title.hidden.other": "Dies ist ein versteckter Kanal",
      "title.locked.other": "Dies ist ein gesperrter Kanal",
      "lead.messages": "Du kannst die Nachrichten in diesem Kanal nicht sehen.",
      "lead.posts": "Du kannst die Beiträge in diesem Kanal nicht sehen.",
      "lead.guidelines": " Die Richtlinien stehen unten.",
      "last.message": "Letzte Nachricht: {date}",
      "last.post": "Letzter Beitrag: {date}",
      "last.pin": "Zuletzt angeheftet: {date}",
      slowmode: "Langsammodus: {duration}",
      "slowmode.thread": "Standard-Langsammodus für Threads: {duration}",
      bitrate: "Bitrate: {kbps} kbps",
      region: "Region: {region}",
      automatic: "Automatisch",
      "video.quality": "Videoqualität: {quality}",
      "archive.threads": "Threads werden nach {duration} Inaktivität archiviert",
      "archive.posts": "Beiträge werden nach {duration} Inaktivität archiviert",
      layout: "Standardlayout: {layout}",
      "layout.0": "Nicht festgelegt",
      "layout.1": "Listenansicht",
      "layout.2": "Galerieansicht",
      sort: "Standardsortierung: {order}",
      "sort.0": "Letzte Aktivität",
      "sort.1": "Erstellungsdatum",
      reaction: "Standardreaktion:",
      "tag.required": "Beiträge in diesem Forum brauchen einen Tag.",
      tags: "Verfügbare Tags",
      allowed: "Erlaubte Nutzer und Rollen",
      "allowed.hide": "Erlaubte Nutzer und Rollen ausblenden",
      "allowed.show": "Erlaubte Nutzer und Rollen anzeigen",
      nsfw: "NSFW",
      emoji: "Emoji",
      "hidden.channel": "Versteckter Kanal",
      crashed: "Dieser versteckte Kanal konnte nicht angezeigt werden.",
      "duration.day": { one: "{count} Tag", other: "{count} Tage" },
      "duration.hour": { one: "{count} Stunde", other: "{count} Stunden" },
      "duration.minute": { one: "{count} Minute", other: "{count} Minuten" },
      "duration.second": { one: "{count} Sekunde", other: "{count} Sekunden" },
      "settings.showMode": "Aussehen versteckter Kanäle",
      "settings.showMode.description": "Wirkt bei Sprachkanälen erst nach einem Neuladen.",
      "settings.showMode.lock": "Ein Schloss statt des Kanalsymbols",
      "settings.showMode.muted": "Stummgeschaltet, mit durchgestrichenem Auge hinter dem Namen",
      "settings.hideUnreads": "Ungelesenes ausblenden",
      "settings.hideUnreads.description": "Versteckte Kanäle werden nie als ungelesen angezeigt.",
      "settings.showAllowed": "Anzeigen, wer ihn sehen kann",
      "settings.showAllowed.description": "Die Liste der erlaubten Nutzer und Rollen auf der Seite eines versteckten Kanals standardmäßig öffnen."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "title.hidden.text": "Este es un canal de texto oculto",
      "title.locked.text": "Este es un canal de texto bloqueado",
      "title.hidden.voice": "Este es un canal de voz oculto",
      "title.locked.voice": "Este es un canal de voz bloqueado",
      "title.hidden.announcement": "Este es un canal de anuncios oculto",
      "title.locked.announcement": "Este es un canal de anuncios bloqueado",
      "title.hidden.stage": "Este es un canal de escenario oculto",
      "title.locked.stage": "Este es un canal de escenario bloqueado",
      "title.hidden.forum": "Este es un canal de foro oculto",
      "title.locked.forum": "Este es un canal de foro bloqueado",
      "title.hidden.media": "Este es un canal multimedia oculto",
      "title.locked.media": "Este es un canal multimedia bloqueado",
      "title.hidden.other": "Este es un canal oculto",
      "title.locked.other": "Este es un canal bloqueado",
      "lead.messages": "No puedes ver los mensajes de este canal.",
      "lead.posts": "No puedes ver las publicaciones de este canal.",
      "lead.guidelines": " Sus normas están debajo.",
      "last.message": "Último mensaje: {date}",
      "last.post": "Última publicación: {date}",
      "last.pin": "Último mensaje fijado: {date}",
      slowmode: "Modo pausado: {duration}",
      "slowmode.thread": "Modo pausado predeterminado de los hilos: {duration}",
      bitrate: "Tasa de bits: {kbps} kbps",
      region: "Región: {region}",
      automatic: "Automática",
      "video.quality": "Calidad de vídeo: {quality}",
      "archive.threads": "Los hilos se archivan tras {duration} de inactividad",
      "archive.posts": "Las publicaciones se archivan tras {duration} de inactividad",
      layout: "Diseño predeterminado: {layout}",
      "layout.0": "Sin definir",
      "layout.1": "Vista de lista",
      "layout.2": "Vista de galería",
      sort: "Orden predeterminado: {order}",
      "sort.0": "Actividad más reciente",
      "sort.1": "Fecha de creación",
      reaction: "Reacción predeterminada:",
      "tag.required": "Las publicaciones de este foro necesitan una etiqueta.",
      tags: "Etiquetas disponibles",
      allowed: "Usuarios y roles con acceso",
      "allowed.hide": "Ocultar usuarios y roles con acceso",
      "allowed.show": "Mostrar usuarios y roles con acceso",
      nsfw: "NSFW",
      emoji: "emoji",
      "hidden.channel": "Canal oculto",
      crashed: "No se pudo mostrar este canal oculto.",
      "duration.day": { one: "{count} día", other: "{count} días" },
      "duration.hour": { one: "{count} hora", other: "{count} horas" },
      "duration.minute": { one: "{count} minuto", other: "{count} minutos" },
      "duration.second": { one: "{count} segundo", other: "{count} segundos" },
      "settings.showMode": "Aspecto de los canales ocultos",
      "settings.showMode.description": "En los canales de voz se aplica tras recargar.",
      "settings.showMode.lock": "Un candado en lugar del icono del canal",
      "settings.showMode.muted": "Silenciado, con un ojo tachado tras el nombre",
      "settings.hideUnreads": "Ocultar no leídos",
      "settings.hideUnreads.description": "Los canales ocultos nunca aparecen como no leídos.",
      "settings.showAllowed": "Mostrar quién puede verlo",
      "settings.showAllowed.description": "Abre por defecto la lista de usuarios y roles con acceso en la página de un canal oculto."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "title.hidden.text": "Ceci est un salon textuel masqué",
      "title.locked.text": "Ceci est un salon textuel verrouillé",
      "title.hidden.voice": "Ceci est un salon vocal masqué",
      "title.locked.voice": "Ceci est un salon vocal verrouillé",
      "title.hidden.announcement": "Ceci est un salon d'annonces masqué",
      "title.locked.announcement": "Ceci est un salon d'annonces verrouillé",
      "title.hidden.stage": "Ceci est un salon de conférence masqué",
      "title.locked.stage": "Ceci est un salon de conférence verrouillé",
      "title.hidden.forum": "Ceci est un forum masqué",
      "title.locked.forum": "Ceci est un forum verrouillé",
      "title.hidden.media": "Ceci est un salon média masqué",
      "title.locked.media": "Ceci est un salon média verrouillé",
      "title.hidden.other": "Ceci est un salon masqué",
      "title.locked.other": "Ceci est un salon verrouillé",
      "lead.messages": "Tu ne peux pas voir les messages de ce salon.",
      "lead.posts": "Tu ne peux pas voir les posts de ce salon.",
      "lead.guidelines": " Ses règles se trouvent ci-dessous.",
      "last.message": "Dernier message : {date}",
      "last.post": "Dernier post : {date}",
      "last.pin": "Dernier épinglage : {date}",
      slowmode: "Mode lent : {duration}",
      "slowmode.thread": "Mode lent par défaut des fils : {duration}",
      bitrate: "Débit : {kbps} kbit/s",
      region: "Région : {region}",
      automatic: "Automatique",
      "video.quality": "Qualité vidéo : {quality}",
      "archive.threads": "Les fils sont archivés après {duration} d'inactivité",
      "archive.posts": "Les posts sont archivés après {duration} d'inactivité",
      layout: "Disposition par défaut : {layout}",
      "layout.0": "Non défini",
      "layout.1": "Vue en liste",
      "layout.2": "Vue en galerie",
      sort: "Tri par défaut : {order}",
      "sort.0": "Activité la plus récente",
      "sort.1": "Date de création",
      reaction: "Réaction par défaut :",
      "tag.required": "Les posts de ce forum doivent avoir un tag.",
      tags: "Tags disponibles",
      allowed: "Utilisateurs et rôles autorisés",
      "allowed.hide": "Masquer les utilisateurs et rôles autorisés",
      "allowed.show": "Afficher les utilisateurs et rôles autorisés",
      nsfw: "NSFW",
      emoji: "émoji",
      "hidden.channel": "Salon masqué",
      crashed: "Impossible d'afficher ce salon masqué.",
      "duration.day": { one: "{count} jour", other: "{count} jours" },
      "duration.hour": { one: "{count} heure", other: "{count} heures" },
      "duration.minute": { one: "{count} minute", other: "{count} minutes" },
      "duration.second": { one: "{count} seconde", other: "{count} secondes" },
      "settings.showMode": "Apparence des salons masqués",
      "settings.showMode.description": "Pour les salons vocaux, prend effet après un rechargement.",
      "settings.showMode.lock": "Un cadenas à la place de l'icône du salon",
      "settings.showMode.muted": "En sourdine, avec un œil barré après le nom",
      "settings.hideUnreads": "Masquer les non lus",
      "settings.hideUnreads.description": "Les salons masqués n'apparaissent jamais comme non lus.",
      "settings.showAllowed": "Afficher qui peut le voir",
      "settings.showAllowed.description": "Ouvre par défaut la liste des utilisateurs et rôles autorisés sur la page d'un salon masqué."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "title.hidden.text": "これは非表示のテキストチャンネルです",
      "title.locked.text": "これはロックされたテキストチャンネルです",
      "title.hidden.voice": "これは非表示のボイスチャンネルです",
      "title.locked.voice": "これはロックされたボイスチャンネルです",
      "title.hidden.announcement": "これは非表示のアナウンスチャンネルです",
      "title.locked.announcement": "これはロックされたアナウンスチャンネルです",
      "title.hidden.stage": "これは非表示のステージチャンネルです",
      "title.locked.stage": "これはロックされたステージチャンネルです",
      "title.hidden.forum": "これは非表示のフォーラムチャンネルです",
      "title.locked.forum": "これはロックされたフォーラムチャンネルです",
      "title.hidden.media": "これは非表示のメディアチャンネルです",
      "title.locked.media": "これはロックされたメディアチャンネルです",
      "title.hidden.other": "これは非表示のチャンネルです",
      "title.locked.other": "これはロックされたチャンネルです",
      "lead.messages": "このチャンネルのメッセージは表示できません。",
      "lead.posts": "このチャンネルの投稿は表示できません。",
      "lead.guidelines": " ガイドラインは下にあります。",
      "last.message": "最後のメッセージ: {date}",
      "last.post": "最後の投稿: {date}",
      "last.pin": "最後のピン留め: {date}",
      slowmode: "スローモード: {duration}",
      "slowmode.thread": "スレッドのデフォルトのスローモード: {duration}",
      bitrate: "ビットレート: {kbps} kbps",
      region: "リージョン: {region}",
      automatic: "自動",
      "video.quality": "ビデオ品質: {quality}",
      "archive.threads": "スレッドは {duration} 操作がないとアーカイブされます",
      "archive.posts": "投稿は {duration} 操作がないとアーカイブされます",
      layout: "デフォルトのレイアウト: {layout}",
      "layout.0": "未設定",
      "layout.1": "リスト表示",
      "layout.2": "ギャラリー表示",
      sort: "デフォルトの並べ替え: {order}",
      "sort.0": "最新のアクティビティ",
      "sort.1": "作成日",
      reaction: "デフォルトのリアクション:",
      "tag.required": "このフォーラムの投稿にはタグが必要です。",
      tags: "利用可能なタグ",
      allowed: "許可されたユーザーとロール",
      "allowed.hide": "許可されたユーザーとロールを隠す",
      "allowed.show": "許可されたユーザーとロールを表示",
      nsfw: "NSFW",
      emoji: "絵文字",
      "hidden.channel": "非表示のチャンネル",
      crashed: "この非表示のチャンネルを表示できませんでした。",
      "duration.day": "{count}日",
      "duration.hour": "{count}時間",
      "duration.minute": "{count}分",
      "duration.second": "{count}秒",
      "settings.showMode": "非表示チャンネルの見た目",
      "settings.showMode.description": "ボイスチャンネルには再読み込み後に反映されます。",
      "settings.showMode.lock": "チャンネルアイコンの代わりに鍵を表示",
      "settings.showMode.muted": "ミュート表示にして、名前の後ろに斜線入りの目を表示",
      "settings.hideUnreads": "未読を非表示",
      "settings.hideUnreads.description": "非表示チャンネルは未読として表示されません。",
      "settings.showAllowed": "閲覧できる人を表示",
      "settings.showAllowed.description": "非表示チャンネルのページで、許可されたユーザーとロールの一覧を最初から開いておきます。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "title.hidden.text": "To jest ukryty kanał tekstowy",
      "title.locked.text": "To jest zablokowany kanał tekstowy",
      "title.hidden.voice": "To jest ukryty kanał głosowy",
      "title.locked.voice": "To jest zablokowany kanał głosowy",
      "title.hidden.announcement": "To jest ukryty kanał ogłoszeń",
      "title.locked.announcement": "To jest zablokowany kanał ogłoszeń",
      "title.hidden.stage": "To jest ukryty kanał sceny",
      "title.locked.stage": "To jest zablokowany kanał sceny",
      "title.hidden.forum": "To jest ukryte forum",
      "title.locked.forum": "To jest zablokowane forum",
      "title.hidden.media": "To jest ukryty kanał multimediów",
      "title.locked.media": "To jest zablokowany kanał multimediów",
      "title.hidden.other": "To jest ukryty kanał",
      "title.locked.other": "To jest zablokowany kanał",
      "lead.messages": "Nie możesz zobaczyć wiadomości na tym kanale.",
      "lead.posts": "Nie możesz zobaczyć postów na tym kanale.",
      "lead.guidelines": " Jego zasady znajdziesz poniżej.",
      "last.message": "Ostatnia wiadomość: {date}",
      "last.post": "Ostatni post: {date}",
      "last.pin": "Ostatnie przypięcie: {date}",
      slowmode: "Tryb powolny: {duration}",
      "slowmode.thread": "Domyślny tryb powolny wątków: {duration}",
      bitrate: "Bitrate: {kbps} kb/s",
      region: "Region: {region}",
      automatic: "Automatyczna",
      "video.quality": "Jakość wideo: {quality}",
      "archive.threads": "Wątki są archiwizowane po {duration} bezczynności",
      "archive.posts": "Posty są archiwizowane po {duration} bezczynności",
      layout: "Domyślny układ: {layout}",
      "layout.0": "Nie ustawiono",
      "layout.1": "Widok listy",
      "layout.2": "Widok galerii",
      sort: "Domyślne sortowanie: {order}",
      "sort.0": "Ostatnia aktywność",
      "sort.1": "Data utworzenia",
      reaction: "Domyślna reakcja:",
      "tag.required": "Posty na tym forum wymagają tagu.",
      tags: "Dostępne tagi",
      allowed: "Dozwoleni użytkownicy i role",
      "allowed.hide": "Ukryj dozwolonych użytkowników i role",
      "allowed.show": "Pokaż dozwolonych użytkowników i role",
      nsfw: "NSFW",
      emoji: "emoji",
      "hidden.channel": "Ukryty kanał",
      crashed: "Nie udało się wyświetlić tego ukrytego kanału.",
      "duration.day": { one: "{count} dzień", few: "{count} dni", many: "{count} dni", other: "{count} dnia" },
      "duration.hour": { one: "{count} godzina", few: "{count} godziny", many: "{count} godzin", other: "{count} godziny" },
      "duration.minute": { one: "{count} minuta", few: "{count} minuty", many: "{count} minut", other: "{count} minuty" },
      "duration.second": { one: "{count} sekunda", few: "{count} sekundy", many: "{count} sekund", other: "{count} sekundy" },
      "settings.showMode": "Wygląd ukrytych kanałów",
      "settings.showMode.description": "W przypadku kanałów głosowych działa po ponownym załadowaniu.",
      "settings.showMode.lock": "Kłódka zamiast ikony kanału",
      "settings.showMode.muted": "Wyciszony, z przekreślonym okiem po nazwie",
      "settings.hideUnreads": "Ukryj nieprzeczytane",
      "settings.hideUnreads.description": "Ukryte kanały nigdy nie pokazują się jako nieprzeczytane.",
      "settings.showAllowed": "Pokaż, kto go widzi",
      "settings.showAllowed.description": "Domyślnie rozwija listę dozwolonych użytkowników i ról na stronie ukrytego kanału."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "title.hidden.text": "Este é um canal de texto oculto",
      "title.locked.text": "Este é um canal de texto bloqueado",
      "title.hidden.voice": "Este é um canal de voz oculto",
      "title.locked.voice": "Este é um canal de voz bloqueado",
      "title.hidden.announcement": "Este é um canal de anúncios oculto",
      "title.locked.announcement": "Este é um canal de anúncios bloqueado",
      "title.hidden.stage": "Este é um canal de palco oculto",
      "title.locked.stage": "Este é um canal de palco bloqueado",
      "title.hidden.forum": "Este é um canal de fórum oculto",
      "title.locked.forum": "Este é um canal de fórum bloqueado",
      "title.hidden.media": "Este é um canal de mídia oculto",
      "title.locked.media": "Este é um canal de mídia bloqueado",
      "title.hidden.other": "Este é um canal oculto",
      "title.locked.other": "Este é um canal bloqueado",
      "lead.messages": "Você não pode ver as mensagens deste canal.",
      "lead.posts": "Você não pode ver as postagens deste canal.",
      "lead.guidelines": " As diretrizes estão abaixo.",
      "last.message": "Última mensagem: {date}",
      "last.post": "Última postagem: {date}",
      "last.pin": "Última fixação: {date}",
      slowmode: "Modo lento: {duration}",
      "slowmode.thread": "Modo lento padrão dos tópicos: {duration}",
      bitrate: "Taxa de bits: {kbps} kbps",
      region: "Região: {region}",
      automatic: "Automática",
      "video.quality": "Qualidade de vídeo: {quality}",
      "archive.threads": "Os tópicos são arquivados após {duration} de inatividade",
      "archive.posts": "As postagens são arquivadas após {duration} de inatividade",
      layout: "Layout padrão: {layout}",
      "layout.0": "Não definido",
      "layout.1": "Visualização em lista",
      "layout.2": "Visualização em galeria",
      sort: "Ordem padrão: {order}",
      "sort.0": "Atividade mais recente",
      "sort.1": "Data de criação",
      reaction: "Reação padrão:",
      "tag.required": "As postagens deste fórum precisam de uma tag.",
      tags: "Tags disponíveis",
      allowed: "Usuários e cargos com acesso",
      "allowed.hide": "Ocultar usuários e cargos com acesso",
      "allowed.show": "Mostrar usuários e cargos com acesso",
      nsfw: "NSFW",
      emoji: "emoji",
      "hidden.channel": "Canal oculto",
      crashed: "Não foi possível mostrar este canal oculto.",
      "duration.day": { one: "{count} dia", other: "{count} dias" },
      "duration.hour": { one: "{count} hora", other: "{count} horas" },
      "duration.minute": { one: "{count} minuto", other: "{count} minutos" },
      "duration.second": { one: "{count} segundo", other: "{count} segundos" },
      "settings.showMode": "Aparência dos canais ocultos",
      "settings.showMode.description": "Nos canais de voz, só vale depois de recarregar.",
      "settings.showMode.lock": "Um cadeado no lugar do ícone do canal",
      "settings.showMode.muted": "Silenciado, com um olho riscado após o nome",
      "settings.hideUnreads": "Ocultar não lidas",
      "settings.hideUnreads.description": "Canais ocultos nunca aparecem como não lidos.",
      "settings.showAllowed": "Mostrar quem pode ver",
      "settings.showAllowed.description": "Abre por padrão a lista de usuários e cargos com acesso na página de um canal oculto."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "title.hidden.text": "Это скрытый текстовый канал",
      "title.locked.text": "Это закрытый текстовый канал",
      "title.hidden.voice": "Это скрытый голосовой канал",
      "title.locked.voice": "Это закрытый голосовой канал",
      "title.hidden.announcement": "Это скрытый канал объявлений",
      "title.locked.announcement": "Это закрытый канал объявлений",
      "title.hidden.stage": "Это скрытая трибуна",
      "title.locked.stage": "Это закрытая трибуна",
      "title.hidden.forum": "Это скрытый форум",
      "title.locked.forum": "Это закрытый форум",
      "title.hidden.media": "Это скрытый медиаканал",
      "title.locked.media": "Это закрытый медиаканал",
      "title.hidden.other": "Это скрытый канал",
      "title.locked.other": "Это закрытый канал",
      "lead.messages": "Вы не можете видеть сообщения в этом канале.",
      "lead.posts": "Вы не можете видеть публикации в этом канале.",
      "lead.guidelines": " Правила канала приведены ниже.",
      "last.message": "Последнее сообщение: {date}",
      "last.post": "Последняя публикация: {date}",
      "last.pin": "Последнее закрепление: {date}",
      slowmode: "Медленный режим: {duration}",
      "slowmode.thread": "Медленный режим по умолчанию для веток: {duration}",
      bitrate: "Битрейт: {kbps} кбит/с",
      region: "Регион: {region}",
      automatic: "Автоматически",
      "video.quality": "Качество видео: {quality}",
      "archive.threads": "Ветки архивируются после {duration} неактивности",
      "archive.posts": "Публикации архивируются после {duration} неактивности",
      layout: "Вид по умолчанию: {layout}",
      "layout.0": "Не задан",
      "layout.1": "Список",
      "layout.2": "Галерея",
      sort: "Сортировка по умолчанию: {order}",
      "sort.0": "Последняя активность",
      "sort.1": "Дата создания",
      reaction: "Реакция по умолчанию:",
      "tag.required": "Публикациям в этом форуме нужен тег.",
      tags: "Доступные теги",
      allowed: "Пользователи и роли с доступом",
      "allowed.hide": "Скрыть пользователей и роли с доступом",
      "allowed.show": "Показать пользователей и роли с доступом",
      nsfw: "NSFW",
      emoji: "эмодзи",
      "hidden.channel": "Скрытый канал",
      crashed: "Не удалось показать этот скрытый канал.",
      "duration.day": { one: "{count} день", few: "{count} дня", many: "{count} дней", other: "{count} дня" },
      "duration.hour": { one: "{count} час", few: "{count} часа", many: "{count} часов", other: "{count} часа" },
      "duration.minute": { one: "{count} минута", few: "{count} минуты", many: "{count} минут", other: "{count} минуты" },
      "duration.second": { one: "{count} секунда", few: "{count} секунды", many: "{count} секунд", other: "{count} секунды" },
      "settings.showMode": "Как выглядят скрытые каналы",
      "settings.showMode.description": "Для голосовых каналов вступает в силу после перезагрузки.",
      "settings.showMode.lock": "Замок вместо значка канала",
      "settings.showMode.muted": "Как с отключёнными уведомлениями, с перечёркнутым глазом после названия",
      "settings.hideUnreads": "Скрыть непрочитанное",
      "settings.hideUnreads.description": "Скрытые каналы никогда не отображаются как непрочитанные.",
      "settings.showAllowed": "Показывать, кто может его видеть",
      "settings.showAllowed.description": "По умолчанию раскрывать список пользователей и ролей с доступом на странице скрытого канала."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "title.hidden.text": "Bu, gizli bir metin kanalı",
      "title.locked.text": "Bu, kilitli bir metin kanalı",
      "title.hidden.voice": "Bu, gizli bir ses kanalı",
      "title.locked.voice": "Bu, kilitli bir ses kanalı",
      "title.hidden.announcement": "Bu, gizli bir duyuru kanalı",
      "title.locked.announcement": "Bu, kilitli bir duyuru kanalı",
      "title.hidden.stage": "Bu, gizli bir sahne kanalı",
      "title.locked.stage": "Bu, kilitli bir sahne kanalı",
      "title.hidden.forum": "Bu, gizli bir forum kanalı",
      "title.locked.forum": "Bu, kilitli bir forum kanalı",
      "title.hidden.media": "Bu, gizli bir medya kanalı",
      "title.locked.media": "Bu, kilitli bir medya kanalı",
      "title.hidden.other": "Bu, gizli bir kanal",
      "title.locked.other": "Bu, kilitli bir kanal",
      "lead.messages": "Bu kanaldaki mesajları göremezsin.",
      "lead.posts": "Bu kanaldaki gönderileri göremezsin.",
      "lead.guidelines": " Yönergeleri aşağıda.",
      "last.message": "Son mesaj: {date}",
      "last.post": "Son gönderi: {date}",
      "last.pin": "Son sabitleme: {date}",
      slowmode: "Yavaş mod: {duration}",
      "slowmode.thread": "Varsayılan alt kanal yavaş modu: {duration}",
      bitrate: "Bit hızı: {kbps} kbps",
      region: "Bölge: {region}",
      automatic: "Otomatik",
      "video.quality": "Video kalitesi: {quality}",
      "archive.threads": "Alt kanallar {duration} etkinlik olmazsa arşivlenir",
      "archive.posts": "Gönderiler {duration} etkinlik olmazsa arşivlenir",
      layout: "Varsayılan düzen: {layout}",
      "layout.0": "Ayarlanmadı",
      "layout.1": "Liste görünümü",
      "layout.2": "Galeri görünümü",
      sort: "Varsayılan sıralama: {order}",
      "sort.0": "En son etkinlik",
      "sort.1": "Oluşturulma tarihi",
      reaction: "Varsayılan tepki:",
      "tag.required": "Bu forumdaki gönderiler için etiket gerekir.",
      tags: "Kullanılabilir etiketler",
      allowed: "İzin verilen kullanıcılar ve roller",
      "allowed.hide": "İzin verilen kullanıcıları ve rolleri gizle",
      "allowed.show": "İzin verilen kullanıcıları ve rolleri göster",
      nsfw: "NSFW",
      emoji: "emoji",
      "hidden.channel": "Gizli kanal",
      crashed: "Bu gizli kanal gösterilemedi.",
      "duration.day": "{count} gün",
      "duration.hour": "{count} saat",
      "duration.minute": "{count} dakika",
      "duration.second": "{count} saniye",
      "settings.showMode": "Gizli kanalların görünümü",
      "settings.showMode.description": "Ses kanallarında yeniden yüklemeden sonra geçerli olur.",
      "settings.showMode.lock": "Kanal simgesi yerine kilit",
      "settings.showMode.muted": "Sessize alınmış görünüm, adın sonunda üstü çizili göz",
      "settings.hideUnreads": "Okunmamışları gizle",
      "settings.hideUnreads.description": "Gizli kanallar hiçbir zaman okunmamış olarak görünmez.",
      "settings.showAllowed": "Kimlerin görebildiğini göster",
      "settings.showAllowed.description": "Gizli kanalın sayfasında izin verilen kullanıcılar ve roller listesini varsayılan olarak açar."
    } })["tr"];
  }
});

// plugins/show-hidden-channels/LockScreen.tsx
var jsx_runtime = require("react/jsx-runtime");
var TYPE_NAMES = { 0: "text", 2: "voice", 5: "announcement", 13: "stage", 15: "forum", 16: "media" };
var LOGO = "/assets/433e3ec4319a9d11b0cbe39342614982.svg";
var DISCORD_EPOCH = 1420070400000;
var scrollerClasses = cssClasses("auto", "customTheme", "managedReactiveScroller");
var topicParser = findCached(() => import_api3.find(import_api3.filters.byProps("parseTopic")));
var ChannelBeginHeader = () => null;
var setChannelBeginHeader = (component) => void (ChannelBeginHeader = component);
var snowflakeDate = (id) => new Date(Number(BigInt(id) >> 22n) + DISCORD_EPOCH);
var formatDate = (date) => date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function formatDuration(amount, unit) {
  let seconds = unit === "minutes" ? amount * 60 : amount;
  const parts = [];
  for (const [name, size] of [["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]]) {
    const n = Math.floor(seconds / size);
    if (!n)
      continue;
    seconds -= n * size;
    parts.push(t(`duration.${name}`, { count: n }));
  }
  return parts.join(" ") || t("duration.second", { count: 0 });
}
function Emoji({ id, name }) {
  if (name)
    return /* @__PURE__ */ jsx_runtime.jsx("span", {
      className: "evi-shc-emoji",
      children: name
    });
  if (!id)
    return null;
  const alt = store("EmojiStore")?.getCustomEmojiById?.(id)?.name ?? t("emoji");
  return /* @__PURE__ */ jsx_runtime.jsx("img", {
    className: "evi-shc-emoji",
    src: `https://cdn.discordapp.com/emojis/${id}.webp?size=48`,
    alt: `:${alt}:`
  });
}
function Topic({ channel }) {
  const parser = topicParser();
  try {
    if (parser)
      return /* @__PURE__ */ jsx_runtime.jsx(jsx_runtime.Fragment, {
        children: parser.parseTopic(channel.topic, false, { channelId: channel.id })
      });
  } catch {}
  return /* @__PURE__ */ jsx_runtime.jsx(jsx_runtime.Fragment, {
    children: channel.topic
  });
}
function WithTooltip({ text, children }) {
  const Tooltip = import_api3.Components.Tooltip;
  return Tooltip ? /* @__PURE__ */ jsx_runtime.jsx(Tooltip, {
    text,
    children
  }) : /* @__PURE__ */ jsx_runtime.jsx("span", {
    title: text,
    children: children({})
  });
}
function LockScreen({ channel }) {
  const ctx = getContext();
  const [, rerender] = import_api3.React.useReducer((n) => n + 1, 0);
  import_api3.React.useEffect(() => ctx?.settings.onChange(rerender), [ctx]);
  const showAllowed = setting("showAllowedByDefault");
  const {
    type,
    topic,
    lastMessageId,
    lastPinTimestamp,
    rateLimitPerUser,
    defaultThreadRateLimitPerUser,
    bitrate,
    rtcRegion,
    videoQualityMode,
    defaultAutoArchiveDuration,
    defaultForumLayout,
    defaultSortOrder,
    defaultReactionEmoji,
    availableTags,
    permissionOverwrites,
    guild_id: guildId
  } = channel;
  import_api3.React.useEffect(() => {
    const members = store("GuildMemberStore");
    const ownerId = store("GuildStore")?.getGuild(guildId)?.ownerId;
    const missing = new Set;
    if (ownerId && !members?.getMember(guildId, ownerId))
      missing.add(ownerId);
    for (const { type: type2, id } of Object.values(permissionOverwrites ?? {})) {
      if (type2 === 1 && !members?.getMember(guildId, id))
        missing.add(id);
    }
    if (missing.size)
      import_api3.Dispatcher.dispatch({ type: "GUILD_MEMBERS_REQUEST", guildIds: [guildId], userIds: [...missing] });
  }, [channel.id]);
  const isVoice = channel.isGuildVoice?.() || channel.isGuildStageVoice?.();
  const isForum = channel.isForumChannel?.();
  const hidden = !store("PermissionStore")?.can(Permissions.VIEW_CHANNEL, channel);
  const scroller = scrollerClasses();
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: [scroller.auto, scroller.customTheme, scroller.managedReactiveScroller].filter(Boolean).join(" "),
    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-shc-container",
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("img", {
          className: "evi-shc-logo",
          src: LOGO,
          alt: ""
        }),
        /* @__PURE__ */ jsx_runtime.jsxs("div", {
          className: "evi-shc-heading",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("h2", {
              children: t(`title.${hidden ? "hidden" : "locked"}.${TYPE_NAMES[type] ?? "other"}`)
            }),
            channel.isNSFW?.() && /* @__PURE__ */ jsx_runtime.jsx(WithTooltip, {
              text: t("nsfw"),
              children: (props) => /* @__PURE__ */ jsx_runtime.jsx("svg", {
                ...props,
                className: "evi-shc-nsfw",
                width: "32",
                height: "32",
                viewBox: "0 0 48 48",
                "aria-hidden": true,
                role: "img",
                children: /* @__PURE__ */ jsx_runtime.jsx("path", {
                  fill: "currentColor",
                  d: "M.7 43.05 24 2.85l23.3 40.2Zm23.55-6.25q.75 0 1.275-.525.525-.525.525-1.275 0-.75-.525-1.3t-1.275-.55q-.8 0-1.325.55-.525.55-.525 1.3t.55 1.275q.55.525 1.3.525Zm-1.85-6.1h3.65V19.4H22.4Z"
                })
              })
            })
          ]
        }),
        !isVoice && /* @__PURE__ */ jsx_runtime.jsxs("p", {
          className: "evi-shc-lead",
          children: [
            t(isForum ? "lead.posts" : "lead.messages"),
            isForum && topic && t("lead.guidelines")
          ]
        }),
        isForum && topic && /* @__PURE__ */ jsx_runtime.jsx("div", {
          className: "evi-shc-box evi-shc-topic",
          children: /* @__PURE__ */ jsx_runtime.jsx(Topic, {
            channel
          })
        }),
        lastMessageId && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t(isForum ? "last.post" : "last.message", { date: formatDate(snowflakeDate(lastMessageId)) })
        }),
        lastPinTimestamp && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("last.pin", { date: formatDate(new Date(lastPinTimestamp)) })
        }),
        rateLimitPerUser > 0 && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("slowmode", { duration: formatDuration(rateLimitPerUser, "seconds") })
        }),
        defaultThreadRateLimitPerUser > 0 && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("slowmode.thread", { duration: formatDuration(defaultThreadRateLimitPerUser, "seconds") })
        }),
        isVoice && bitrate != null && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("bitrate", { kbps: Math.round(bitrate / 1000) })
        }),
        rtcRegion !== undefined && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("region", { region: rtcRegion ?? t("automatic") })
        }),
        isVoice && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("video.quality", { quality: (videoQualityMode ?? 1) === 2 ? "720p" : t("automatic") })
        }),
        defaultAutoArchiveDuration > 0 && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t(isForum ? "archive.posts" : "archive.threads", { duration: formatDuration(defaultAutoArchiveDuration, "minutes") })
        }),
        defaultForumLayout != null && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("layout", { layout: t(`layout.${defaultForumLayout}`) })
        }),
        defaultSortOrder != null && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("sort", { order: t(`sort.${defaultSortOrder}`) })
        }),
        defaultReactionEmoji != null && /* @__PURE__ */ jsx_runtime.jsxs("div", {
          className: "evi-shc-box evi-shc-row",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("p", {
              children: t("reaction")
            }),
            /* @__PURE__ */ jsx_runtime.jsx(Emoji, {
              id: defaultReactionEmoji.emojiId,
              name: defaultReactionEmoji.emojiName
            })
          ]
        }),
        channel.hasFlag?.(16 /* REQUIRE_TAG */) && /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("tag.required")
        }),
        availableTags?.length > 0 && /* @__PURE__ */ jsx_runtime.jsxs("div", {
          className: "evi-shc-box",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("h3", {
              children: t("tags")
            }),
            /* @__PURE__ */ jsx_runtime.jsx("div", {
              className: "evi-shc-tags",
              children: availableTags.map((tag) => /* @__PURE__ */ jsx_runtime.jsxs("span", {
                className: "evi-shc-tag",
                children: [
                  /* @__PURE__ */ jsx_runtime.jsx(Emoji, {
                    id: tag.emojiId,
                    name: tag.emojiName
                  }),
                  tag.name
                ]
              }, tag.id))
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsxs("div", {
          className: "evi-shc-box evi-shc-allowed",
          children: [
            /* @__PURE__ */ jsx_runtime.jsxs("div", {
              className: "evi-shc-row",
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("h3", {
                  children: t("allowed")
                }),
                /* @__PURE__ */ jsx_runtime.jsx(WithTooltip, {
                  text: t(showAllowed ? "allowed.hide" : "allowed.show"),
                  children: (props) => /* @__PURE__ */ jsx_runtime.jsx("button", {
                    ...props,
                    className: "evi-shc-toggle",
                    "aria-expanded": showAllowed,
                    onClick: () => ctx?.settings.set("showAllowedByDefault", !showAllowed),
                    children: /* @__PURE__ */ jsx_runtime.jsx("svg", {
                      width: "24",
                      height: "24",
                      viewBox: "0 0 24 24",
                      style: { transform: showAllowed ? "scaleY(-1)" : undefined },
                      children: /* @__PURE__ */ jsx_runtime.jsx("path", {
                        fill: "currentColor",
                        d: "M16.59 8.59003L12 13.17L7.41 8.59003L6 10L12 16L18 10L16.59 8.59003Z"
                      })
                    })
                  })
                })
              ]
            }),
            showAllowed && /* @__PURE__ */ jsx_runtime.jsx(ChannelBeginHeader, {
              channel
            })
          ]
        })
      ]
    })
  });
}
var Boundary;
function getBoundary() {
  return Boundary ??= class extends import_api3.React.Component {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(err) {
      getContext()?.logger.error("The hidden channel page crashed", err);
    }
    render() {
      return this.state.failed ? /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-shc-container",
        children: /* @__PURE__ */ jsx_runtime.jsx("p", {
          children: t("crashed")
        })
      }) : this.props.children;
    }
  };
}
function renderLockScreen(channel) {
  if (!channel)
    return null;
  const ErrorBoundary = getBoundary();
  return /* @__PURE__ */ jsx_runtime.jsx(ErrorBoundary, {
    children: /* @__PURE__ */ jsx_runtime.jsx(LockScreen, {
      channel
    })
  }, channel.id);
}
var lockScreenCss = `
.evi-shc-container { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 0.65em; margin: 0.5em 0; min-height: 100%; color: var(--text-default); font-size: 16px; line-height: 1.375; }
.evi-shc-container p { margin: 0; }
.evi-shc-container h2 { margin: 0; font-size: 32px; font-weight: 700; line-height: 1.25; color: var(--text-strong, var(--header-primary)); }
.evi-shc-container h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-strong, var(--header-primary)); }
.evi-shc-lead { font-size: 18px; }
.evi-shc-logo { width: 12em; height: 12em; }
.evi-shc-heading { display: flex; align-items: center; gap: 0.5em; }
.evi-shc-nsfw { color: var(--text-default); }
.evi-shc-box { display: flex; flex-direction: column; align-items: center; gap: 0.75em; padding: 0.75em; max-width: 70vw; border-radius: 8px; background: var(--background-base-lower); }
.evi-shc-row { display: flex; flex-direction: row; align-items: center; gap: 0.5em; }
.evi-shc-topic { display: block; text-align: start; }
.evi-shc-tags { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.35em; }
.evi-shc-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 14px; background: var(--background-mod-normal, var(--background-base-low)); }
.evi-shc-emoji { font-size: 20px; line-height: 1; }
img.evi-shc-emoji { width: 20px; height: 20px; object-fit: contain; }
.evi-shc-tag .evi-shc-emoji { font-size: 14px; }
.evi-shc-tag img.evi-shc-emoji { width: 14px; height: 14px; }
.evi-shc-toggle { all: unset; display: flex; align-items: center; cursor: pointer; color: var(--text-default); border-radius: 4px; }
.evi-shc-toggle:focus-visible { outline: 2px solid var(--focus-primary, #00a8fc); }
.evi-shc-allowed > [class*="members"] { margin-left: 12px; flex-wrap: wrap; justify-content: center; }
`;

// plugins/show-hidden-channels/settings.ts
var settings = {
  showMode: {
    type: "select",
    get label() {
      return t("settings.showMode");
    },
    get description() {
      return t("settings.showMode.description");
    },
    default: "lock",
    options: [
      { get label() {
        return t("settings.showMode.lock");
      }, value: "lock" },
      { get label() {
        return t("settings.showMode.muted");
      }, value: "muted" }
    ]
  },
  hideUnreads: {
    type: "boolean",
    get label() {
      return t("settings.hideUnreads");
    },
    get description() {
      return t("settings.hideUnreads.description");
    },
    default: true
  },
  showAllowedByDefault: {
    type: "boolean",
    get label() {
      return t("settings.showAllowed");
    },
    get description() {
      return t("settings.showAllowed.description");
    },
    default: true
  }
};

// plugins/show-hidden-channels/index.tsx
var jsx_runtime2 = require("react/jsx-runtime");
var channelListClasses = cssClasses("modeSelected", "modeMuted", "unread", "icon");
var mutedStyle = (channel) => setting("showMode") === "muted" && isHiddenChannel(channel);
function LockIcon() {
  return /* @__PURE__ */ jsx_runtime2.jsx("svg", {
    className: channelListClasses().icon,
    height: "18",
    width: "20",
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    role: "img",
    children: /* @__PURE__ */ jsx_runtime2.jsx("path", {
      fill: "currentColor",
      fillRule: "evenodd",
      d: "M17 11V7C17 4.243 14.756 2 12 2C9.242 2 7 4.243 7 7V11C5.897 11 5 11.896 5 13V20C5 21.103 5.897 22 7 22H17C18.103 22 19 21.103 19 20V13C19 11.896 18.103 11 17 11ZM12 18C11.172 18 10.5 17.328 10.5 16.5C10.5 15.672 11.172 15 12 15C12.828 15 13.5 15.672 13.5 16.5C13.5 17.328 12.828 18 12 18ZM15 11H9V7C9 5.346 10.346 4 12 4C13.654 4 15 5.346 15 7V11Z"
    })
  });
}
function HiddenIcon() {
  const icon = (props) => /* @__PURE__ */ jsx_runtime2.jsx("svg", {
    ...props,
    className: [channelListClasses().icon, "evi-shc-hidden-icon"].filter(Boolean).join(" "),
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    "aria-label": t("hidden.channel"),
    role: "img",
    children: /* @__PURE__ */ jsx_runtime2.jsx("path", {
      fill: "currentColor",
      fillRule: "evenodd",
      d: "m19.8 22.6-4.2-4.15q-.875.275-1.762.413Q12.95 19 12 19q-3.775 0-6.725-2.087Q2.325 14.825 1 11.5q.525-1.325 1.325-2.463Q3.125 7.9 4.15 7L1.4 4.2l1.4-1.4 18.4 18.4ZM12 16q.275 0 .512-.025.238-.025.513-.1l-5.4-5.4q-.075.275-.1.513-.025.237-.025.512 0 1.875 1.312 3.188Q10.125 16 12 16Zm7.3.45-3.175-3.15q.175-.425.275-.862.1-.438.1-.938 0-1.875-1.312-3.188Q13.875 7 12 7q-.5 0-.938.1-.437.1-.862.3L7.65 4.85q1.025-.425 2.1-.638Q10.825 4 12 4q3.775 0 6.725 2.087Q21.675 8.175 23 11.5q-.575 1.475-1.512 2.738Q20.55 15.5 19.3 16.45Zm-4.625-4.6-3-3q.7-.125 1.288.112.587.238 1.012.688.425.45.613 1.038.187.587.087 1.162Z"
    })
  });
  const Tooltip = import_api4.Components.Tooltip;
  return Tooltip ? /* @__PURE__ */ jsx_runtime2.jsx(Tooltip, {
    text: t("hidden.channel"),
    children: icon
  }) : icon({});
}
var isUncategorized = (entry) => entry.channel.id === "null" && entry.channel.name === "Uncategorized" && entry.comparator === -1;
var filteredChannels = new WeakMap;
function guildOf(channels) {
  if (typeof channels.id === "string")
    return channels.id;
  for (const entries of Object.values(channels)) {
    if (!Array.isArray(entries))
      continue;
    for (const entry of entries) {
      const id = entry?.channel?.guild_id;
      if (typeof id === "string")
        return id;
    }
  }
}
function permissionKey(guildId) {
  const permissions = store("PermissionStore");
  if (!guildId || typeof permissions?.getGuildVersion !== "function" || typeof permissions?.getChannelsVersion !== "function")
    return;
  return `${permissions.getGuildVersion(guildId)}:${permissions.getChannelsVersion()}`;
}
function filterChannels(channels) {
  const result = {};
  for (const [key, entries] of Object.entries(channels)) {
    if (!Array.isArray(entries)) {
      result[key] = entries;
      continue;
    }
    result[key] = entries.filter((entry) => isUncategorized(entry) || entry.channel.id === null || !isHiddenChannel(entry.channel));
  }
  return result;
}
function sameChannels(a, b) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length)
    return false;
  for (const key of keys) {
    const x = a[key], y = b[key];
    if (x === y)
      continue;
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length)
      return false;
    for (let i = 0;i < x.length; i++)
      if (x[i] !== y[i])
        return false;
  }
  return true;
}
var css = `
.evi-shc-hidden-icon { cursor: not-allowed; margin-left: 6px; z-index: 0; }
${lockScreenCss}
`;
var show_hidden_channels_default = import_api4.definePlugin({
  settings,
  css,
  patches: [
    {
      find: '"placeholder-channel-id"',
      replace: [
        {
          match: /if\(!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL.+?{if\(this\.id===\i\).+?threadIds:\[\]}}/,
          with: ""
        },
        {
          match: /(?<=&&)(?=!\i\.\i\.hasUnread\(this\.record\.id\))/,
          with: "$self.isHiddenChannel(this.record)||"
        },
        {
          match: /(this\.record\)\?{renderLevel:(.+?),threadIds.+?renderLevel:).+?(?=,threadIds)/g,
          with: (_, rest, defaultRenderLevel) => `${rest}${defaultRenderLevel}`
        },
        {
          match: /(getRenderLevel\(\i\){.+?return)!\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,this\.record\)\|\|/,
          with: (_, rest) => `${rest} `
        }
      ]
    },
    {
      find: "VoiceChannel, transitionTo: Channel does not have a guildId",
      replace: [
        {
          match: /(?<=getIgnoredUsersForVoiceChannel\((\i)\.id\)[^;]{0,300}?;return\()/,
          with: (_, channel) => `!$self.isHiddenChannel(${channel})&&`
        },
        {
          match: /(?=\|\|\i\.\i\.selectVoiceChannel\((\i)\.id\))/,
          with: (_, channel) => `||$self.isHiddenChannel(${channel})`
        },
        {
          match: /!__OVERLAY__&&\((?<=selectVoiceChannel\((\i)\.id\).+?)/,
          with: (m, channel) => `${m}$self.isHiddenChannel(${channel},true)||`
        }
      ]
    },
    {
      find: ".AUDIENCE),{isSubscriptionGated",
      replace: {
        match: /(\i)\.isRoleSubscriptionTemplatePreviewChannel\(\)/,
        with: (m, channel) => `${m}||$self.isHiddenChannel(${channel})`
      }
    },
    {
      find: 'tutorialId:"instant-invite"',
      replace: ["renderEditButton", "renderInviteButton"].map((fn) => ({
        match: new RegExp(`(?<=${fn}\\(\\){)`, "g"),
        with: "if($self.isHiddenChannel(this?.props?.channel))return null;"
      }))
    },
    {
      find: "VoiceChannel.renderPopout: There must always be something to render",
      all: true,
      replace: {
        match: /(?<=renderOpenChatButton(?:",|=)\(\)=>{)/,
        with: "if($self.isHiddenChannel(this?.props?.channel))return null;"
      }
    },
    {
      find: ".t.IzZTIe",
      replace: {
        match: /(?<=(\i)\.isNSFW\(\);)switch\(\i\.type\).{0,15}\.GUILD_ANNOUNCEMENT/,
        with: (m, channel) => `if($self.showLockIcon(${channel}))return $self.LockIcon;${m}`
      }
    },
    {
      find: "UNREAD_IMPORTANT:",
      replace: [
        {
          match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,muted:(\i).+?;)/,
          with: (m, channel, muted) => `${m}${muted}=$self.mutedStyle(${channel})?true:${muted};`
        },
        {
          match: /\.Children\.count.+?:null(?<=,channel:(\i).+?)/,
          with: (m, channel) => `${m},$self.mutedStyle(${channel})?$self.HiddenChannelIcon():null`
        }
      ]
    },
    {
      find: "UNREAD_IMPORTANT:",
      predicate: () => setting("showMode") === "muted",
      replace: {
        match: /(?<=\?\i\.\i:\i\.\i,)(.{0,150}?)if\((\i)(?:\)return |\?)(\i\.MUTED)/,
        with: (_, otherClasses, isMuted, mutedClass) => `${isMuted}?${mutedClass}:"",${otherClasses}if(${isMuted})return ""`
      }
    },
    {
      find: "UNREAD_IMPORTANT:",
      replace: [
        {
          match: /(?<=\.LOCKED;if\()(?<={channel:(\i).+?)/,
          with: (_, channel) => `!$self.showUnreadWhileMuted(${channel})&&`
        },
        {
          match: /Children\.count.+?;(?=return\(0,\i\.jsxs?\)\(\i\.\i,{focusTarget:)(?<={channel:(\i),name:\i,.+?unread:(\i).+?)/,
          with: (m, channel, unread) => `${m}${unread}=$self.hideUnread(${channel})?false:${unread};`
        }
      ]
    },
    {
      find: '"ChannelListUnreadsStore"',
      replace: {
        match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/,
        with: (_, channel) => `&&!$self.isHiddenChannel(${channel})`
      }
    },
    {
      find: "renderBottomUnread(){",
      replace: {
        match: /(?<=!0\))(?=&&\(0,\i\.\i\)\((\i\.record)\))/,
        with: "&&!$self.isHiddenChannel($1)"
      }
    },
    {
      find: "GUILD_EVENT)}),[",
      replace: {
        match: /(?<=\.id\)\))(?=&&\(0,\i\.\i\)\((\i)\))/,
        with: "&&!$self.isHiddenChannel($1)"
      }
    },
    {
      find: "Missing channel in Channel.renderHeaderToolbar",
      replace: [
        {
          match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_TEXT:(?=.+?(\i\.push.{0,50}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/,
          with: (m, pushNotifications, channel, isLurking) => `${m}if(!${isLurking}&&$self.isHiddenChannel(${channel})){${pushNotifications};break;}`
        },
        {
          match: /renderHeaderToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_MEDIA:(?=.+?(\i\.push.{0,40}channel:(\i)},"notifications"\)\)))(?<=isLurking:(\i).+?)/,
          with: (m, pushNotifications, channel, isLurking) => `${m}if(!${isLurking}&&$self.isHiddenChannel(${channel})){${pushNotifications};break;}`
        },
        {
          match: /renderMobileToolbar(?:",|=)\(\)=>{.+?case \i\.\i\.GUILD_DIRECTORY:(?<=let{channel:(\i).+?)/,
          with: (m, channel) => `${m}if($self.isHiddenChannel(${channel}))break;`
        },
        {
          match: /(?<=renderHeaderBar(?:",|=)\(\)=>{.+?hideSearch:(\i)\.isDirectory\(\))/,
          with: (_, channel) => `||$self.isHiddenChannel(${channel})`
        },
        {
          match: /(?<=renderSidebar\(\){)/,
          with: "if($self.isHiddenChannel(this?.props?.channel))return null;"
        },
        {
          match: /(?<=renderChat\(\){)/,
          with: "if($self.isHiddenChannel(this?.props?.channel))return $self.HiddenChannelLockScreen(this?.props?.channel);"
        }
      ]
    },
    {
      find: '"MessageManager"',
      replace: {
        match: /forceFetch:\i,isPreload:.+?}=\i;(?=.+?getChannel\((\i)\))/,
        with: (m, channelId) => `${m}if($self.isHiddenChannel({channelId:${channelId}}))return;`
      }
    },
    {
      find: '"alt+shift+down"',
      replace: {
        match: /(?<=getChannel\(\i\);return null!=(\i))(?=.{0,200}?>0\)&&\(0,\i\.\i\)\(\i\))/,
        with: (_, channel) => `&&!$self.isHiddenChannel(${channel})`
      }
    },
    {
      find: ".APPLICATION_STORE&&null!=",
      replace: {
        match: /getState\(\)\.channelId.+?(?=\.map\(\i=>\i\.id)/,
        with: "$&.filter(e=>!$self.isHiddenChannel(e))"
      }
    },
    {
      find: ".t.rt0ERW",
      replace: [
        {
          match: /(forceRoles:.+?)(\i\.\i\(\i\.\i\.ADMINISTRATOR,\i\.\i\.VIEW_CHANNEL\))(?<=context:(\i)}.+?)/,
          with: (_, rest, mergedPermissions, channel) => `${rest}$self.swapViewChannelWithConnectPermission(${mergedPermissions},${channel})`
        },
        {
          match: /permissionOverwrites\[.+?\i=(?<=context:(\i)}.+?)(?=(.+?)VIEW_CHANNEL)/,
          with: (m, channel, permCheck) => `${m}!$self.canConnect(${channel})?${permCheck}CONNECT):`
        },
        {
          match: /getSortedRoles.+?\.filter\(\i=>(?=!)/,
          with: (m) => `${m}$self.isHiddenChannel(arguments[0]?.channel)?true:`
        },
        {
          match: /forceRoles:.+?.value\(\)(?<=channel:(\i).+?)/,
          with: (m, channel) => `${m}.reduce(...$self.makeAllowedRolesReduce(${channel}.guild_id))`
        },
        {
          match: /return\(0,\i\.jsxs?\)\(\i\.\i,{channelId:(\i)\.id,children:\[(?=.{0,1000}?(\(0,\i\.jsxs?\)\("div",{className:\i\.\i,children:\[.{0,100}\i\.length>0.+?\]}\)),)/,
          with: (m, channel, allowedUsersAndRoles) => `if($self.isHiddenChannel(${channel},true)){return${allowedUsersAndRoles};}${m}`
        },
        {
          match: /maxUsers:\d+?,users:\i(?<=channel:(\i).+?)/,
          with: (m, channel) => `${m},shcChannel:${channel}`
        },
        {
          match: /1!==\i\.length(?=\|\|)/,
          with: "true"
        }
      ]
    },
    {
      find: '="interactive-text-default",overflowCountClassName:',
      replace: [
        {
          match: /let{users:\i,maxUsers:\i,/,
          with: "let{shcChannel}=arguments[0];$&"
        },
        {
          match: /\i>0(?=&&!\i&&!\i)/,
          with: (m) => `($self.isHiddenChannel(typeof shcChannel!=="undefined"?shcChannel:void 0,true)?true:${m})`
        },
        {
          match: /(?<=`\+\$\{)\i(?=\})/,
          with: (overflow) => `$self.isHiddenChannel(typeof shcChannel!=="undefined"?shcChannel:void 0,true)&&(${overflow}-1)<=0?"":${overflow}`
        }
      ]
    },
    {
      find: ".t.JjdizN",
      replace: {
        match: /(?<=&&)\i\.push\(.{0,120}"chat-spacer"/,
        with: "(arguments[0]?.inCall||!$self.isHiddenChannel(arguments[0]?.channel,true))&&$&"
      }
    },
    {
      find: '.t["AlJyI+"]',
      replace: [
        {
          match: /renderContent\(\i\){.+?this\.renderVoiceChannelEffects.+?children:/,
          with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?$self.HiddenChannelLockScreen(this?.props?.channel):"
        },
        {
          match: /renderContent\(\i\){.+?disableGradients:/,
          with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)||"
        },
        {
          match: /(?:{|,)render(?!Header|ExternalHeader).{0,30}?:/g,
          with: "$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?()=>null:"
        },
        {
          match: /(?=\i\|\|\i!==\i\.\i\.FULL_SCREEN.{0,100}?this\._callContainerRef)/,
          with: '$&!this?.props?.inCall&&$self.isHiddenChannel(this?.props?.channel,true)?"":'
        }
      ]
    },
    {
      find: ".STAGE_CHANNEL_CALL)",
      replace: [
        {
          match: /screenMessage:(\i)\?.+?children:(?=!\1)(?<=let \i,{channel:(\i).+?)/,
          with: (m, _isPopoutOpen, channel) => `${m}$self.isHiddenChannel(${channel})?$self.HiddenChannelLockScreen(${channel}):`
        },
        {
          match: /render(?:BottomLeft|BottomCenter|BottomRight|ChatToasts):(?:\(\)=>|function\(\){return)(?<=let \i,{channel:(\i).+?)/g,
          with: (m, channel) => `${m} $self.isHiddenChannel(${channel})?null:`
        },
        {
          match: /"124px".+?disableGradients:(?<=let \i,{channel:(\i).+?)/,
          with: (m, channel) => `${m}$self.isHiddenChannel(${channel})||`
        },
        {
          match: /"124px".+?style:(?<=let \i,{channel:(\i).+?)/,
          with: (m, channel) => `${m}$self.isHiddenChannel(${channel})?void 0:`
        }
      ]
    },
    {
      find: "numRequestToSpeak:",
      replace: [
        {
          match: /(?<={channel:(\i),toggleRequestToSpeakSidebar:.+?)\(0,\i\.jsx\)\(\i\.\i\.Divider.+?}\)]}\)/,
          with: (m, channel) => `...$self.isHiddenChannel(${channel})?[]:[${m}]`
        },
        {
          match: /(?<=numRequestToSpeak:\i\}\)\}\):null,!\i&&)\(0,\i\.jsxs?\).{0,280}?iconClassName:/,
          with: "!$self.isHiddenChannel(arguments[0]?.channel,true)&&$&"
        }
      ]
    },
    {
      find: ",queryStaticRouteChannels(",
      replace: [
        {
          match: /(?<=queryChannels\(\i\){.+?getChannels\(\i)(?=\))/,
          with: ",true"
        },
        {
          match: /(?<=queryChannels\(\i\){.+?\)\((\i)\.type\))(?=&&!\i\.\i\.can\()/,
          with: "&&!$self.isHiddenChannel($1)"
        }
      ]
    },
    {
      find: '"^/guild-stages/(\\\\d+)(?:/)?(\\\\d+)?"',
      replace: {
        match: /\i\.\i\.can\(\i\.\i\.VIEW_CHANNEL,\i\)/,
        with: "true"
      }
    },
    {
      find: 'getConfig({location:"channel_mention"})',
      replace: {
        match: /(?<=getChannel\(\i\);if\(null!=(\i)).{0,200}?return void (?=\i\.default\.selectVoiceChannel)/,
        with: (m, channel) => `${m}!$self.isHiddenChannel(${channel})&&`
      }
    },
    {
      find: '"GuildChannelStore"',
      replace: [
        {
          match: /isChannelGated\(.+?\)(?=&&)/,
          with: (m) => `${m}&&false`
        },
        {
          match: /(?<=getChannels\(\i)(\){.*?)return (.+?)}/,
          with: (_, rest, channels) => `,shouldIncludeHidden${rest}return $self.resolveGuildChannels(${channels},shouldIncludeHidden??arguments[0]==="@favorites");}`
        }
      ]
    },
    {
      find: "GuildTooltip - ",
      replace: {
        match: /(?<=getChannels\(\i)(?=\))/,
        with: ",true"
      }
    },
    {
      find: '"NowPlayingViewStore"',
      replace: {
        match: /(getVoiceStateForUser.{0,150}?)&&\i\.\i\.canWithPartialContext.{0,20}VIEW_CHANNEL.+?}\)(?=\?)/,
        with: "$1"
      }
    },
    {
      find: ".t.rt0ERW",
      replace: {
        match: /(?=function (\i)\(\i\){let{channel:.{0,200}?getSortedRoles\()/,
        with: "$self.ChannelBeginHeader=$1;"
      }
    },
    {
      find: "2026-02-private-channel-hiding",
      replace: {
        match: /(?<=enableObfuscation):!0/g,
        with: ":false"
      }
    }
  ],
  set ChannelBeginHeader(component) {
    setChannelBeginHeader(component);
  },
  isHiddenChannel,
  mutedStyle,
  showLockIcon: (channel) => setting("showMode") === "lock" && isHiddenChannel(channel),
  hideUnread: (channel) => setting("hideUnreads") && isHiddenChannel(channel),
  showUnreadWhileMuted: (channel) => !setting("hideUnreads") && mutedStyle(channel),
  canConnect,
  swapViewChannelWithConnectPermission(mergedPermissions, channel) {
    if (!canConnect(channel)) {
      mergedPermissions &= ~Permissions.VIEW_CHANNEL;
      mergedPermissions |= Permissions.CONNECT;
    }
    return mergedPermissions;
  },
  resolveGuildChannels(channels, includeHidden) {
    if (includeHidden || !channels || typeof channels !== "object")
      return channels;
    const cached = filteredChannels.get(channels);
    const stamp = permissionChanges();
    if (cached?.stamp === stamp)
      return cached.result;
    const key = permissionKey(guildOf(channels));
    if (cached && key !== undefined && cached.key === key) {
      cached.stamp = stamp;
      return cached.result;
    }
    const fresh = filterChannels(channels);
    const result = cached && sameChannels(cached.result, fresh) ? cached.result : fresh;
    filteredChannels.set(channels, { stamp, key, result });
    return result;
  },
  makeAllowedRolesReduce(guildId) {
    return [
      (prev, _role, index, roles) => {
        if (index !== 0)
          return prev;
        const everyone = roles.find((role) => role.id === guildId);
        return everyone ? [everyone] : roles;
      },
      []
    ];
  },
  HiddenChannelLockScreen: renderLockScreen,
  LockIcon,
  HiddenChannelIcon: () => /* @__PURE__ */ jsx_runtime2.jsx(HiddenIcon, {}),
  start(ctx) {
    setContext(ctx);
    ctx.onDispose(watchPermissions());
  },
  stop() {
    setContext(undefined);
  }
});
