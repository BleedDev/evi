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

// plugins/read-all/index.tsx
var exports_read_all = {};
__export(exports_read_all, {
  default: () => read_all_default
});
module.exports = __toCommonJS(exports_read_all);
var import_api2 = require("@evi/api");

// plugins/read-all/collect.ts
var CHANNEL_READ_STATE = 0;
var BULK_ACK_LIMIT = 100;
function guildMaybeUnread(store, guildId) {
  const unread = store?.getGuildHasUnreadIgnoreMuted?.(guildId) ?? store?.hasUnread?.(guildId);
  if (typeof unread !== "boolean")
    return true;
  return unread || (store?.getMentionCount?.(guildId) ?? 0) > 0;
}
function guildIds(store) {
  const ids = store.getGuildIds?.();
  if (Array.isArray(ids))
    return ids;
  const guilds = store.getGuilds();
  if (Array.isArray(guilds))
    return guilds.map((g) => g?.id).filter((id) => typeof id === "string");
  return Object.keys(guilds ?? {});
}
function channelOf(value) {
  const channel = value?.channel ?? value;
  return typeof channel?.id === "string" ? channel : undefined;
}
function collectUnread(stores, options = {}) {
  const steps = collectUnreadSteps(stores, options);
  for (;; ) {
    const step = steps.next();
    if (step.done)
      return step.value;
  }
}
function* collectUnreadSteps(stores, options = {}) {
  const { ReadStateStore: rs } = stores;
  const seen = new Set;
  const out = [];
  const consider = (channel, guildId) => {
    if (!channel || seen.has(channel.id))
      return;
    seen.add(channel.id);
    if (!rs.hasUnread(channel.id) && !(rs.getMentionCount(channel.id) > 0))
      return;
    out.push({ guildId, channelId: channel.id, messageId: rs.lastMessageId(channel.id) ?? null, readStateType: CHANNEL_READ_STATE });
  };
  const skip = options.skipReadGuilds && stores.GuildReadStateStore;
  for (const guildId of guildIds(stores.GuildStore)) {
    if (skip && !guildMaybeUnread(skip, guildId))
      continue;
    const groups = stores.GuildChannelStore.getChannels(guildId) ?? {};
    for (const group of Object.values(groups)) {
      if (Array.isArray(group))
        group.forEach((item) => consider(channelOf(item), guildId));
    }
    const threads = stores.ActiveJoinedThreadsStore?.getActiveJoinedThreadsForGuild(guildId) ?? {};
    for (const byId of Object.values(threads)) {
      for (const thread of Object.values(byId ?? {}))
        consider(channelOf(thread), guildId);
    }
    yield;
  }
  if (options.includeDms)
    stores.ChannelStore?.getSortedPrivateChannels?.()?.forEach((channel) => consider(channel, null));
  return out;
}
function chunk(items, size = BULK_ACK_LIMIT) {
  if (!(size >= 1))
    throw new RangeError("chunk size must be at least 1");
  const out = [];
  for (let i = 0;i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}
var toAck = ({ channelId, messageId, readStateType }) => ({ channelId, messageId, readStateType });
var countGuilds = (entries) => new Set(entries.map((e) => e.guildId).filter((id) => id != null)).size;
function summary(count, guilds, t) {
  if (count === 0)
    return t("summary.none");
  const channels = t("summary.channels", { count });
  return guilds > 0 ? t("summary.doneInServers", { channels, servers: t("summary.servers", { count: guilds }) }) : t("summary.done", { channels });
}

// plugins/read-all/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.includeDms": "Include DMs",
    "settings.includeDms.description": "Also mark direct messages and group DMs as read.",
    "settings.showButton": "Server list button",
    "settings.showButton.description": "A button above your servers, shown while anything is unread.",
    "settings.contextMenu": "Server menu item",
    "settings.contextMenu.description": '"Mark All Servers as Read" when you right-click a server.',
    "error.stores": "Couldn't find Discord's read state stores",
    "error.failed": "Couldn't mark everything as read",
    "summary.none": "Nothing to mark: everything is already read",
    "summary.channels": { one: "{count} channel", other: "{count} channels" },
    "summary.servers": { one: "{count} server", other: "{count} servers" },
    "summary.done": "Marked {channels} as read",
    "summary.doneInServers": "Marked {channels} in {servers} as read",
    "button.label": { one: "Mark {count} channel as read", other: "Mark {count} channels as read" },
    "command.description": "Mark every server as read",
    "menu.markAll": "Mark All Servers as Read"
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.includeDms": "Direktnachrichten einbeziehen",
      "settings.includeDms.description": "Markiert auch Direktnachrichten und Gruppenchats als gelesen.",
      "settings.showButton": "Button in der Serverliste",
      "settings.showButton.description": "Ein Button über deinen Servern, der erscheint, solange etwas ungelesen ist.",
      "settings.contextMenu": "Eintrag im Servermenü",
      "settings.contextMenu.description": "„Alle Server als gelesen markieren“, wenn du einen Server mit der rechten Maustaste anklickst.",
      "error.stores": "Discords Lesestatus-Speicher wurden nicht gefunden",
      "error.failed": "Es konnte nicht alles als gelesen markiert werden",
      "summary.none": "Nichts zu markieren: Alles ist bereits gelesen",
      "summary.channels": { one: "{count} Kanal", other: "{count} Kanäle" },
      "summary.servers": { one: "{count} Server", other: "{count} Servern" },
      "summary.done": "{channels} als gelesen markiert",
      "summary.doneInServers": "{channels} auf {servers} als gelesen markiert",
      "button.label": { one: "{count} Kanal als gelesen markieren", other: "{count} Kanäle als gelesen markieren" },
      "command.description": "Alle Server als gelesen markieren",
      "menu.markAll": "Alle Server als gelesen markieren"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.includeDms": "Incluir MD",
      "settings.includeDms.description": "También marca como leídos los mensajes directos y los grupos de MD.",
      "settings.showButton": "Botón en la lista de servidores",
      "settings.showButton.description": "Un botón sobre tus servidores, visible mientras haya algo sin leer.",
      "settings.contextMenu": "Opción en el menú del servidor",
      "settings.contextMenu.description": "«Marcar todos los servidores como leídos» al hacer clic derecho en un servidor.",
      "error.stores": "No se encontraron los almacenes de estado de lectura de Discord",
      "error.failed": "No se pudo marcar todo como leído",
      "summary.none": "Nada que marcar: todo ya está leído",
      "summary.channels": { one: "{count} canal", other: "{count} canales" },
      "summary.servers": { one: "{count} servidor", other: "{count} servidores" },
      "summary.done": "Se marcaron como leídos {channels}",
      "summary.doneInServers": "Se marcaron como leídos {channels} en {servers}",
      "button.label": { one: "Marcar {count} canal como leído", other: "Marcar {count} canales como leídos" },
      "command.description": "Marcar todos los servidores como leídos",
      "menu.markAll": "Marcar todos los servidores como leídos"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.includeDms": "Inclure les MP",
      "settings.includeDms.description": "Marque aussi comme lus les messages privés et les groupes privés.",
      "settings.showButton": "Bouton dans la liste des serveurs",
      "settings.showButton.description": "Un bouton au-dessus de tes serveurs, affiché tant qu'il reste des messages non lus.",
      "settings.contextMenu": "Option du menu du serveur",
      "settings.contextMenu.description": "« Marquer tous les serveurs comme lus » quand tu fais un clic droit sur un serveur.",
      "error.stores": "Impossible de trouver les stores d'état de lecture de Discord",
      "error.failed": "Impossible de tout marquer comme lu",
      "summary.none": "Rien à marquer : tout est déjà lu",
      "summary.channels": { one: "{count} salon", other: "{count} salons" },
      "summary.servers": { one: "{count} serveur", other: "{count} serveurs" },
      "summary.done": "Marquage terminé : {channels}",
      "summary.doneInServers": "Marquage terminé : {channels} sur {servers}",
      "button.label": { one: "Marquer {count} salon comme lu", other: "Marquer {count} salons comme lus" },
      "command.description": "Marquer tous les serveurs comme lus",
      "menu.markAll": "Marquer tous les serveurs comme lus"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.includeDms": "DM も含める",
      "settings.includeDms.description": "ダイレクトメッセージとグループ DM も既読にします。",
      "settings.showButton": "サーバーリストのボタン",
      "settings.showButton.description": "未読があるあいだ、サーバーの上にボタンを表示します。",
      "settings.contextMenu": "サーバーメニューの項目",
      "settings.contextMenu.description": "サーバーを右クリックしたときに「すべてのサーバーを既読にする」を表示します。",
      "error.stores": "Discord の既読状態ストアが見つかりませんでした",
      "error.failed": "すべてを既読にできませんでした",
      "summary.none": "既読にするものはありません。すべて既読です",
      "summary.channels": { other: "{count} 件のチャンネル" },
      "summary.servers": { other: "{count} 個のサーバー" },
      "summary.done": "{channels}を既読にしました",
      "summary.doneInServers": "{servers}の{channels}を既読にしました",
      "button.label": { other: "{count} 件のチャンネルを既読にする" },
      "command.description": "すべてのサーバーを既読にする",
      "menu.markAll": "すべてのサーバーを既読にする"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.includeDms": "Uwzględnij wiadomości prywatne",
      "settings.includeDms.description": "Oznacza jako przeczytane także wiadomości prywatne i grupy prywatne.",
      "settings.showButton": "Przycisk na liście serwerów",
      "settings.showButton.description": "Przycisk nad serwerami, widoczny, dopóki coś jest nieprzeczytane.",
      "settings.contextMenu": "Pozycja w menu serwera",
      "settings.contextMenu.description": "„Oznacz wszystkie serwery jako przeczytane” po kliknięciu serwera prawym przyciskiem myszy.",
      "error.stores": "Nie znaleziono magazynów stanu odczytu Discorda",
      "error.failed": "Nie udało się oznaczyć wszystkiego jako przeczytane",
      "summary.none": "Nie ma czego oznaczać: wszystko jest już przeczytane",
      "summary.channels": { one: "{count} kanał", few: "{count} kanały", many: "{count} kanałów", other: "{count} kanału" },
      "summary.servers": { one: "{count} serwer", few: "{count} serwery", many: "{count} serwerów", other: "{count} serwera" },
      "summary.done": "Oznaczono jako przeczytane: {channels}",
      "summary.doneInServers": "Oznaczono jako przeczytane: {channels} ({servers})",
      "button.label": { one: "Oznacz {count} kanał jako przeczytany", few: "Oznacz {count} kanały jako przeczytane", many: "Oznacz {count} kanałów jako przeczytane", other: "Oznacz {count} kanału jako przeczytane" },
      "command.description": "Oznacz wszystkie serwery jako przeczytane",
      "menu.markAll": "Oznacz wszystkie serwery jako przeczytane"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.includeDms": "Incluir DMs",
      "settings.includeDms.description": "Também marca como lidas as mensagens diretas e os grupos de DM.",
      "settings.showButton": "Botão na lista de servidores",
      "settings.showButton.description": "Um botão acima dos seus servidores, exibido enquanto houver algo não lido.",
      "settings.contextMenu": "Item no menu do servidor",
      "settings.contextMenu.description": "“Marcar todos os servidores como lidos” ao clicar com o botão direito em um servidor.",
      "error.stores": "Não foi possível encontrar os armazenamentos de leitura do Discord",
      "error.failed": "Não foi possível marcar tudo como lido",
      "summary.none": "Nada para marcar: tudo já foi lido",
      "summary.channels": { one: "{count} canal", other: "{count} canais" },
      "summary.servers": { one: "{count} servidor", other: "{count} servidores" },
      "summary.done": "Marcados como lidos: {channels}",
      "summary.doneInServers": "Marcados como lidos: {channels} em {servers}",
      "button.label": { one: "Marcar {count} canal como lido", other: "Marcar {count} canais como lidos" },
      "command.description": "Marcar todos os servidores como lidos",
      "menu.markAll": "Marcar todos os servidores como lidos"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.includeDms": "Включить личные сообщения",
      "settings.includeDms.description": "Также отмечать прочитанными личные сообщения и групповые чаты.",
      "settings.showButton": "Кнопка в списке серверов",
      "settings.showButton.description": "Кнопка над серверами, которая появляется, пока есть непрочитанное.",
      "settings.contextMenu": "Пункт в меню сервера",
      "settings.contextMenu.description": "«Отметить все серверы прочитанными» при щелчке правой кнопкой мыши по серверу.",
      "error.stores": "Не удалось найти хранилища состояния прочтения Discord",
      "error.failed": "Не удалось отметить всё прочитанным",
      "summary.none": "Отмечать нечего: всё уже прочитано",
      "summary.channels": { one: "{count} канал", few: "{count} канала", many: "{count} каналов", other: "{count} канала" },
      "summary.servers": { one: "{count} сервер", few: "{count} сервера", many: "{count} серверов", other: "{count} сервера" },
      "summary.done": "Отмечено прочитанным: {channels}",
      "summary.doneInServers": "Отмечено прочитанным: {channels} ({servers})",
      "button.label": { one: "Отметить {count} канал прочитанным", few: "Отметить {count} канала прочитанными", many: "Отметить {count} каналов прочитанными", other: "Отметить {count} канала прочитанными" },
      "command.description": "Отметить все серверы прочитанными",
      "menu.markAll": "Отметить все серверы прочитанными"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.includeDms": "DM'leri de dahil et",
      "settings.includeDms.description": "Direkt mesajları ve grup DM'lerini de okundu olarak işaretler.",
      "settings.showButton": "Sunucu listesi düğmesi",
      "settings.showButton.description": "Okunmamış bir şey olduğu sürece sunucularının üstünde görünen bir düğme.",
      "settings.contextMenu": "Sunucu menüsü öğesi",
      "settings.contextMenu.description": 'Bir sunucuya sağ tıkladığında "Tüm Sunucuları Okundu Olarak İşaretle".',
      "error.stores": "Discord'un okuma durumu depoları bulunamadı",
      "error.failed": "Her şey okundu olarak işaretlenemedi",
      "summary.none": "İşaretlenecek bir şey yok: her şey zaten okundu",
      "summary.channels": { one: "{count} kanal", other: "{count} kanal" },
      "summary.servers": { one: "{count} sunucu", other: "{count} sunucu" },
      "summary.done": "{channels} okundu olarak işaretlendi",
      "summary.doneInServers": "{servers} içindeki {channels} okundu olarak işaretlendi",
      "button.label": { one: "{count} kanalı okundu olarak işaretle", other: "{count} kanalı okundu olarak işaretle" },
      "command.description": "Tüm sunucuları okundu olarak işaretle",
      "menu.markAll": "Tüm Sunucuları Okundu Olarak İşaretle"
    } })["tr"];
  }
});

// plugins/read-all/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var settings = {
  includeDms: {
    type: "boolean",
    get label() {
      return t("settings.includeDms");
    },
    get description() {
      return t("settings.includeDms.description");
    },
    default: false
  },
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
  contextMenu: {
    type: "boolean",
    get label() {
      return t("settings.contextMenu");
    },
    get description() {
      return t("settings.contextMenu.description");
    },
    default: true
  }
};
var context;
var cachedStores;
function stores() {
  if (cachedStores)
    return cachedStores;
  const GuildStore = import_api2.findStore("GuildStore");
  const GuildChannelStore = import_api2.findStore("GuildChannelStore");
  const ReadStateStore = import_api2.findStore("ReadStateStore");
  if (!GuildStore || !GuildChannelStore || !ReadStateStore)
    return;
  const found = {
    GuildStore,
    GuildChannelStore,
    ReadStateStore,
    ActiveJoinedThreadsStore: import_api2.findStore("ActiveJoinedThreadsStore"),
    ChannelStore: import_api2.findStore("ChannelStore"),
    GuildReadStateStore: import_api2.findStore("GuildReadStateStore")
  };
  if (found.ActiveJoinedThreadsStore && found.ChannelStore && found.GuildReadStateStore)
    cachedStores = found;
  return found;
}
async function readAll() {
  const s = stores();
  if (!s)
    return { message: t("error.stores"), ok: false };
  const unread = collectUnread(s, { includeDms: context?.settings.get("includeDms") ?? false });
  for (const batch of chunk(unread.map(toAck))) {
    await import_api2.Dispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels: batch });
  }
  return { message: summary(unread.length, countGuilds(unread), t), ok: true };
}
var busy = false;
async function readAllWithToast() {
  if (busy)
    return;
  busy = true;
  try {
    const { message, ok } = await readAll();
    context?.toast(message, { type: ok ? "success" : "failure" });
  } catch (err) {
    context?.logger.error("Marking all as read failed", err);
    context?.toast(t("error.failed"), { type: "failure" });
  } finally {
    busy = false;
  }
}
var unreadCount = 0;
var showButton = true;
var listeners = new Set;
var recountTimer;
var cancelIdle;
var counting;
var countAgain = false;
var SLICE_MS = 5;
var notify = () => listeners.forEach((l) => l());
function setUnreadCount(next) {
  if (next === unreadCount)
    return;
  unreadCount = next;
  notify();
}
function recount(deadline) {
  cancelIdle = undefined;
  const s = stores();
  if (!s || !context) {
    counting = undefined;
    return setUnreadCount(0);
  }
  counting ??= collectUnreadSteps(s, { includeDms: context.settings.get("includeDms"), skipReadGuilds: true });
  const until = performance.now() + Math.min(SLICE_MS, Math.max(1, deadline?.timeRemaining?.() ?? SLICE_MS));
  for (;; ) {
    const step = counting.next();
    if (step.done) {
      counting = undefined;
      setUnreadCount(step.value.length);
      if (countAgain) {
        countAgain = false;
        cancelIdle = whenIdle(recount);
      }
      return;
    }
    if (performance.now() >= until)
      break;
  }
  cancelIdle = whenIdle(recount);
}
var RECOUNT_AFTER = 1500;
var RECOUNT_WITHIN = 5000;
var firstChange = 0;
function whenIdle(fn) {
  if (typeof requestIdleCallback === "function") {
    const handle2 = requestIdleCallback(fn, { timeout: 1000 });
    return () => cancelIdleCallback(handle2);
  }
  const handle = setTimeout(() => fn(), 0);
  return () => clearTimeout(handle);
}
function scheduleRecount() {
  const now = performance.now();
  if (recountTimer === undefined)
    firstChange = now;
  else if (now - firstChange >= RECOUNT_WITHIN)
    return;
  clearTimeout(recountTimer);
  recountTimer = setTimeout(() => {
    recountTimer = undefined;
    if (counting)
      countAgain = true;
    cancelIdle ??= whenIdle(recount);
  }, RECOUNT_AFTER);
}
var subscribe = (cb) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
function useButtonCount() {
  return import_api2.React.useSyncExternalStore(subscribe, () => showButton ? unreadCount : 0);
}
var CheckIcon = () => /* @__PURE__ */ jsx_runtime.jsx("svg", {
  width: "20",
  height: "20",
  viewBox: "0 0 24 24",
  fill: "none",
  "aria-hidden": "true",
  children: /* @__PURE__ */ jsx_runtime.jsx("path", {
    d: "M2 12.5l4.5 4.5L15 8.5M11.5 16l1 1L22 7.5",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })
});
function ReadAllButton() {
  const count = useButtonCount();
  if (count === 0)
    return null;
  const label = t("button.label", { count });
  const button = /* @__PURE__ */ jsx_runtime.jsx("button", {
    type: "button",
    className: "dl-read-all-button",
    onClick: readAllWithToast,
    "aria-label": label,
    children: /* @__PURE__ */ jsx_runtime.jsx(CheckIcon, {})
  });
  const Tooltip = import_api2.Components.Tooltip;
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: "dl-read-all",
    children: Tooltip ? /* @__PURE__ */ jsx_runtime.jsx(Tooltip, {
      text: label,
      position: "right",
      children: button
    }) : import_api2.React.cloneElement(button, { title: label })
  });
}
var read_all_default = import_api2.definePlugin({
  settings,
  patches: [{
    find: '"guildsnav"',
    replace: {
      match: /(?<=lurkingGuildIds:\i(?:,\i:\i)*\}\),\(0,\i\.jsx\)\(\i,\{\}\),)(?=\(0,\i\.jsx\)\(\i,\{guildDiscoveryButton:)/,
      with: "$self.renderButton(),"
    }
  }],
  renderButton() {
    return /* @__PURE__ */ jsx_runtime.jsx(ReadAllButton, {}, "evi-read-all");
  },
  readAll,
  css: `
        .dl-read-all { display: flex; justify-content: center; width: 100%; margin-bottom: 8px;
            animation: dl-read-all-in 0.2s ease-out; }
        .dl-read-all-button { display: flex; align-items: center; justify-content: center;
            width: var(--guildbar-avatar-size, 40px); height: var(--guildbar-avatar-size, 40px);
            padding: 0; border: 0; border-radius: 50%; cursor: pointer;
            color: var(--status-positive, #23a55a); background: var(--background-surface-high, var(--background-secondary));
            transition: border-radius 0.15s ease-out, background-color 0.15s ease-out, color 0.15s ease-out; }
        .dl-read-all-button:hover { border-radius: 30%; color: var(--white, #fff); background: var(--status-positive, #23a55a); }
        .dl-read-all-button:active { transform: translateY(1px); }
        .dl-read-all-button:focus-visible { outline: 2px solid var(--focus-primary, #5865f2); outline-offset: 2px; }
        @keyframes dl-read-all-in { from { opacity: 0; transform: scale(0.8); } }
        @media (prefers-reduced-motion: reduce) { .dl-read-all, .dl-read-all-button { animation: none; transition: none; } }
    `,
  start(ctx) {
    context = ctx;
    ctx.onDispose(() => {
      context = undefined;
      clearTimeout(recountTimer);
      recountTimer = undefined;
      cancelIdle?.();
      cancelIdle = undefined;
      counting = undefined;
      countAgain = false;
      cachedStores = undefined;
      unreadCount = 0;
      notify();
    });
    const watched = [];
    for (const name of ["ReadStateStore", "GuildStore"]) {
      const listen = (store2) => {
        store2.addChangeListener?.(scheduleRecount);
        watched.push(store2);
        scheduleRecount();
      };
      const store = import_api2.findStore(name);
      if (store)
        listen(store);
      else
        ctx.waitFor(import_api2.filters.byStoreName(name), listen);
    }
    ctx.onDispose(() => watched.forEach((store) => store.removeChangeListener?.(scheduleRecount)));
    showButton = ctx.settings.get("showButton");
    ctx.settings.onChange((values) => {
      if (values.showButton !== showButton) {
        showButton = values.showButton;
        notify();
      }
      scheduleRecount();
    });
    cancelIdle = whenIdle(recount);
    ctx.command({
      name: "readall",
      get description() {
        return t("command.description");
      },
      async execute() {
        const { message } = await readAll();
        return { ephemeral: message };
      }
    });
    ctx.contextMenu("guild-context", (children, props) => {
      if (!ctx.settings.get("contextMenu") || !props.guild?.id || unreadCount === 0)
        return;
      children.push(/* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Group, {
        children: /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
          id: "dl-read-all",
          label: t("menu.markAll"),
          action: readAllWithToast
        })
      }, "dl-read-all"));
    });
  }
});
