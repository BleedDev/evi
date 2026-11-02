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

// plugins/pop-out-chat/index.tsx
var exports_pop_out_chat = {};
__export(exports_pop_out_chat, {
  default: () => pop_out_chat_default
});
module.exports = __toCommonJS(exports_pop_out_chat);
var import_api2 = require("@evi/api");

// plugins/pop-out-chat/chat.ts
var CHAT_TYPES = new Set([
  0,
  1,
  2,
  3,
  5,
  10,
  11,
  12,
  13
]);
var DM = 1;
var GROUP_DM = 3;
function canPopOut(channel) {
  return typeof channel?.id === "string" && channel.id !== "" && typeof channel.type === "number" && CHAT_TYPES.has(channel.type);
}
var KEY_PREFIX = "DISCORD_EVI_CHAT_";
var windowKey = (channelId) => KEY_PREFIX + channelId;
function channelOfKey(key) {
  if (!key.startsWith(KEY_PREFIX))
    return;
  const id = key.slice(KEY_PREFIX.length);
  return /^\d+$/.test(id) ? id : undefined;
}
var nameOf = (user) => user?.globalName || user?.username || "";
function chatTitle(channel, getUser) {
  if (channel.type === DM)
    return nameOf(getUser(channel.recipients?.[0] ?? ""));
  if (channel.type === GROUP_DM) {
    if (channel.name)
      return channel.name;
    return (channel.recipients ?? []).map((id) => nameOf(getUser(id))).filter(Boolean).join(", ");
  }
  if (!channel.name)
    return "";
  return channel.type === 0 || channel.type === 5 ? `#${channel.name}` : channel.name;
}
var mainWindowOnly = (id) => id === "evi-wallpaper-style";
var CALL_CHAT_PATCH = {
  find: "CALL_CHAT_BUTTON_TEXT_IN_VOICE_COACH_MARK,{dismissAction",
  replace: {
    match: /(let\{channel:(\i),guild:\i,maxWidth:\i\}=\i.{0,900}?CallChatSidebar.{0,400}?toolbar:)(\i)(?=,"aria-label")/,
    with: "$1$self.callChatToolbar($2,$3)"
  }
};

// plugins/pop-out-chat/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "menu.popOut": "Pop Out Chat",
    "button.popOut": "Pop out chat",
    "button.show": "Show popped-out chat",
    "settings.headerButton": "Button in the chat header",
    "settings.headerButton.description": "A pop-out button with the chat's other header buttons, and in a call's chat.",
    "settings.shortcut": "Shortcut",
    "settings.shortcut.description": "Pops out the chat you have open.",
    "toast.noChat": "There's no chat to pop out here.",
    "toast.unavailable": "Couldn't open the window: Discord changed its pop-out windows."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "menu.popOut": "Chat auslagern",
      "button.popOut": "Chat auslagern",
      "button.show": "Ausgelagerten Chat zeigen",
      "settings.headerButton": "Button in der Chat-Kopfzeile",
      "settings.headerButton.description": "Ein Auslagern-Button bei den anderen Buttons der Chat-Kopfzeile und im Chat eines Anrufs.",
      "settings.shortcut": "Tastenkürzel",
      "settings.shortcut.description": "Lagert den geöffneten Chat aus.",
      "toast.noChat": "Hier gibt es keinen Chat zum Auslagern.",
      "toast.unavailable": "Das Fenster ließ sich nicht öffnen: Discord hat seine Pop-out-Fenster geändert."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "menu.popOut": "Abrir chat en ventana",
      "button.popOut": "Abrir chat en ventana",
      "button.show": "Mostrar la ventana del chat",
      "settings.headerButton": "Botón en la cabecera del chat",
      "settings.headerButton.description": "Un botón para abrir el chat en una ventana, junto a los demás botones de la cabecera y en el chat de una llamada.",
      "settings.shortcut": "Atajo",
      "settings.shortcut.description": "Abre en una ventana el chat que tienes abierto.",
      "toast.noChat": "Aquí no hay ningún chat que abrir en una ventana.",
      "toast.unavailable": "No se pudo abrir la ventana: Discord cambió sus ventanas emergentes."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "menu.popOut": "Ouvrir le chat dans une fenêtre",
      "button.popOut": "Ouvrir le chat dans une fenêtre",
      "button.show": "Afficher la fenêtre du chat",
      "settings.headerButton": "Bouton dans l'en-tête du chat",
      "settings.headerButton.description": "Un bouton pour ouvrir le chat dans une fenêtre, avec les autres boutons de l'en-tête et dans le chat d'un appel.",
      "settings.shortcut": "Raccourci",
      "settings.shortcut.description": "Ouvre le chat affiché dans une fenêtre.",
      "toast.noChat": "Il n'y a pas de chat à ouvrir dans une fenêtre ici.",
      "toast.unavailable": "Impossible d'ouvrir la fenêtre : Discord a modifié ses fenêtres détachées."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "menu.popOut": "チャットをポップアウト",
      "button.popOut": "チャットをポップアウト",
      "button.show": "ポップアウトしたチャットを表示",
      "settings.headerButton": "チャットのヘッダーのボタン",
      "settings.headerButton.description": "チャットのヘッダーの他のボタンの横と、通話のチャットにポップアウトボタンを表示します。",
      "settings.shortcut": "ショートカット",
      "settings.shortcut.description": "開いているチャットをポップアウトします。",
      "toast.noChat": "ここにはポップアウトできるチャットがありません。",
      "toast.unavailable": "ウィンドウを開けませんでした。Discordがポップアウトウィンドウを変更しました。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "menu.popOut": "Otwórz czat w oknie",
      "button.popOut": "Otwórz czat w oknie",
      "button.show": "Pokaż okno czatu",
      "settings.headerButton": "Przycisk w nagłówku czatu",
      "settings.headerButton.description": "Przycisk otwierający czat w oknie, obok innych przycisków nagłówka i w czacie rozmowy.",
      "settings.shortcut": "Skrót",
      "settings.shortcut.description": "Otwiera w oknie czat, który masz otwarty.",
      "toast.noChat": "Tu nie ma czatu do otwarcia w oknie.",
      "toast.unavailable": "Nie udało się otworzyć okna: Discord zmienił swoje wyskakujące okna."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "menu.popOut": "Abrir chat em janela",
      "button.popOut": "Abrir chat em janela",
      "button.show": "Mostrar a janela do chat",
      "settings.headerButton": "Botão no cabeçalho do chat",
      "settings.headerButton.description": "Um botão para abrir o chat em uma janela, junto aos outros botões do cabeçalho e no chat de uma chamada.",
      "settings.shortcut": "Atalho",
      "settings.shortcut.description": "Abre em uma janela o chat que você está vendo.",
      "toast.noChat": "Não há chat para abrir em janela aqui.",
      "toast.unavailable": "Não foi possível abrir a janela: o Discord mudou suas janelas pop-out."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "menu.popOut": "Открыть чат в окне",
      "button.popOut": "Открыть чат в окне",
      "button.show": "Показать окно чата",
      "settings.headerButton": "Кнопка в шапке чата",
      "settings.headerButton.description": "Кнопка, открывающая чат в отдельном окне, рядом с другими кнопками шапки и в чате звонка.",
      "settings.shortcut": "Сочетание клавиш",
      "settings.shortcut.description": "Открывает текущий чат в отдельном окне.",
      "toast.noChat": "Здесь нет чата, который можно открыть в окне.",
      "toast.unavailable": "Не удалось открыть окно: Discord изменил свои всплывающие окна."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "menu.popOut": "Sohbeti Pencerede Aç",
      "button.popOut": "Sohbeti pencerede aç",
      "button.show": "Sohbet penceresini göster",
      "settings.headerButton": "Sohbet başlığında düğme",
      "settings.headerButton.description": "Sohbet başlığındaki diğer düğmelerin yanında ve aramanın sohbetinde, sohbeti pencerede açan bir düğme.",
      "settings.shortcut": "Kısayol",
      "settings.shortcut.description": "Açık olan sohbeti pencerede açar.",
      "toast.noChat": "Burada pencerede açılacak bir sohbet yok.",
      "toast.unavailable": "Pencere açılamadı: Discord açılır pencerelerini değiştirdi."
    } })["tr"];
  }
});

// plugins/pop-out-chat/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var popoutWindowFilter = import_api2.filters.componentByCode("Missing guestWindow reference");
var channelChatFilter = import_api2.filters.componentByCode('location:"ChannelChat"');
var inputTypesFilter = import_api2.filters.byProps("SIDEBAR", "OVERLAY_INLINE_REPLY");
var uploadAreaFilter = import_api2.filters.componentByCode(/\{className:[\w$]+,style:[\w$]+,channel:[\w$]+,draftType:[\w$]+\}=/, "ATTACH_FILES");
var headerFilter = import_api2.filters.componentByCode("isAuthenticated", "HEADER_BAR");
var WINDOW_SIZE = { defaultWidth: 440, defaultHeight: 720 };
var CHANNEL_MESSAGE_DRAFT = 0;
var settings = {
  headerButton: {
    type: "boolean",
    get label() {
      return t("settings.headerButton");
    },
    get description() {
      return t("settings.headerButton.description");
    },
    default: true
  },
  shortcut: {
    type: "keybind",
    get label() {
      return t("settings.shortcut");
    },
    get description() {
      return t("settings.shortcut.description");
    },
    default: ""
  }
};
var context;
var header;
function lookup(filter) {
  let value;
  let missedAt = -Infinity;
  return () => {
    if (value !== undefined || performance.now() - missedAt < 1e4)
      return value;
    value = import_api2.find(filter);
    if (value === undefined)
      missedAt = performance.now();
    return value;
  };
}
var getPopoutWindow = lookup(popoutWindowFilter);
var getChannelChat = lookup(channelChatFilter);
var getInputTypes = lookup(inputTypesFilter);
var getUploadArea = lookup(uploadAreaFilter);
function svgIcon(paths) {
  return function Icon({ width = 24, height = 24, color, className, colorClass }) {
    const fill = typeof color === "string" ? color : color?.css ?? "currentColor";
    return /* @__PURE__ */ jsx_runtime.jsx("svg", {
      width,
      height,
      viewBox: "0 0 24 24",
      fill: "none",
      className,
      "aria-hidden": "true",
      children: paths.map((d) => /* @__PURE__ */ jsx_runtime.jsx("path", {
        d,
        fill,
        className: colorClass
      }, d))
    });
  };
}
var PopOutIcon = svgIcon([
  "M15 2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V4.41l-4.3 4.3a1 1 0 1 1-1.4-1.42L19.58 3H16a1 1 0 0 1-1-1Z",
  "M5 2a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-6a1 1 0 1 0-2 0v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a1 1 0 1 0 0-2H5Z"
]);
var ChatIcon = svgIcon(["M12 22a10 10 0 1 0-8.45-4.64c.13.19.11.44-.04.61l-2.06 2.37A1 1 0 0 0 2.2 22H12Z"]);
function useStore(name, read) {
  const subscribe = import_api2.React.useCallback((onChange) => {
    const store = import_api2.getStore(name);
    store?.addChangeListener?.(onChange);
    return () => store?.removeChangeListener?.(onChange);
  }, [name]);
  return import_api2.React.useSyncExternalStore(subscribe, () => read(import_api2.getStore(name)));
}
var getChannel = (id) => import_api2.getStore("ChannelStore")?.getChannel?.(id);
var titleOf = (channel) => chatTitle(channel, (id) => import_api2.getStore("UserStore")?.getUser?.(id));
function closeWindow(key) {
  context?.flux.dispatch({ type: "POPOUT_WINDOW_CLOSE", key });
}
function popOut(channel) {
  if (!context)
    return;
  if (!getPopoutWindow() || !getChannelChat() || !getInputTypes()) {
    context.toast(t("toast.unavailable"), { type: "failure" });
    return;
  }
  const channelId = channel.id;
  context.flux.dispatch({
    type: "POPOUT_WINDOW_OPEN",
    key: windowKey(channelId),
    features: { menubar: false, toolbar: false, location: false, directories: false, ...WINDOW_SIZE },
    render: (key) => /* @__PURE__ */ jsx_runtime.jsx(ChatWindow, {
      windowKey: key,
      channelId
    })
  });
}
function popOutSelected() {
  const channel = getChannel(import_api2.getStore("SelectedChannelStore")?.getChannelId?.() ?? "");
  if (canPopOut(channel))
    popOut(channel);
  else
    context?.toast(t("toast.noChat"));
}
function mirrorStyles(win) {
  const copies = new Map;
  let order = [];
  const sync = () => {
    const head = win.document?.head;
    if (!head)
      return;
    const next = Array.from(document.head.querySelectorAll("style")).filter((style) => !mainWindowOnly(style.id)).map((style) => {
      let copy = copies.get(style);
      if (!copy)
        copies.set(style, copy = win.document.createElement("style"));
      if (copy.textContent !== style.textContent)
        copy.textContent = style.textContent;
      if (copy.media !== style.media)
        copy.media = style.media;
      return copy;
    });
    const kept = new Set(next);
    for (const [style, copy] of copies) {
      if (kept.has(copy))
        continue;
      copy.remove();
      copies.delete(style);
    }
    if (next.length !== order.length || next.some((copy, i) => copy !== order[i] || !copy.isConnected))
      head.append(...next);
    order = next;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    for (const copy of copies.values())
      copy.remove();
    copies.clear();
  };
}
function ChatWindow({ windowKey: key, channelId }) {
  import_api2.useLocale();
  const channel = useStore("ChannelStore", (store) => store?.getChannel?.(channelId));
  const guild = useStore("GuildStore", (store) => channel?.guild_id ? store?.getGuild?.(channel.guild_id) ?? null : null);
  import_api2.React.useLayoutEffect(() => {
    const win = import_api2.getStore("PopoutWindowStore")?.getWindow?.(key);
    return win ? mirrorStyles(win) : undefined;
  }, [key]);
  const gone = !canPopOut(channel);
  import_api2.React.useEffect(() => void (gone && closeWindow(key)), [gone, key]);
  const PopoutWindow = getPopoutWindow();
  const ChannelChat = getChannelChat();
  const UploadArea = getUploadArea();
  const Header = header;
  if (gone || !PopoutWindow || !ChannelChat)
    return null;
  const title = titleOf(channel);
  return /* @__PURE__ */ jsx_runtime.jsx(PopoutWindow, {
    windowKey: key,
    title,
    channelId: channel.id,
    withTitleBar: true,
    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-pop-out-chat",
      children: [
        UploadArea && /* @__PURE__ */ jsx_runtime.jsx(UploadArea, {
          channel,
          draftType: CHANNEL_MESSAGE_DRAFT
        }),
        Header && /* @__PURE__ */ jsx_runtime.jsxs(Header, {
          "aria-label": title,
          children: [
            /* @__PURE__ */ jsx_runtime.jsx(Header.ChannelIcon, {
              icon: ChatIcon,
              "aria-hidden": true
            }),
            /* @__PURE__ */ jsx_runtime.jsx(Header.Title, {
              children: title
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsx("div", {
          className: "evi-pop-out-chat-body",
          children: /* @__PURE__ */ jsx_runtime.jsx(ChannelChat, {
            channel,
            guild,
            chatInputType: getInputTypes()?.SIDEBAR
          }, channel.id)
        })
      ]
    })
  });
}
function PopOutButton({ channel }) {
  import_api2.useLocale();
  const key = windowKey(channel.id);
  const open = useStore("PopoutWindowStore", (store) => !!store?.getWindowOpen?.(key));
  const Icon = header?.Icon;
  if (!Icon)
    return null;
  const label = t(open ? "button.show" : "button.popOut");
  return /* @__PURE__ */ jsx_runtime.jsx(Icon, {
    icon: PopOutIcon,
    tooltip: label,
    "aria-label": label,
    selected: open,
    onClick: () => popOut(channel)
  });
}
function menuItem(channel) {
  return /* @__PURE__ */ jsx_runtime.jsx(import_api2.Menu.Item, {
    id: "evi-pop-out-chat",
    label: t("menu.popOut"),
    action: () => popOut(channel)
  });
}
function addMenuItem(children, channel) {
  const group = ["mark-channel-read", "mark-read", "pin-dm", "pin-channel", "pin-thread", "close-dm"].map((id) => import_api2.findMenuGroup(children, id)).find(Boolean);
  (group ?? children).push(menuItem(channel));
}
var pop_out_chat_default = import_api2.definePlugin({
  settings,
  patches: [CALL_CHAT_PATCH],
  callChatToolbar(channel, toolbar) {
    if (!context?.settings.get("headerButton") || !canPopOut(channel))
      return toolbar;
    return /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime.jsx(PopOutButton, {
          channel
        }),
        toolbar
      ]
    });
  },
  css: `
        .evi-pop-out-chat { display: flex; flex: 1 1 auto; flex-direction: column; align-self: stretch; width: 100%; height: 100%; min-height: 0; min-width: 0; position: relative;
            background: var(--background-gradient-chat, var(--background-base-lowest)); }
        .evi-pop-out-chat-body { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; min-width: 0; position: relative; }
    `,
  start(ctx) {
    context = ctx;
    ctx.onDispose(() => {
      for (const key of import_api2.getStore("PopoutWindowStore")?.getWindowKeys?.() ?? []) {
        if (channelOfKey(key))
          closeWindow(key);
      }
      context = undefined;
      header = undefined;
    });
    ctx.waitFor(headerFilter, (value) => void (header = value));
    ctx.hookExport("before", headerFilter, (call) => {
      const props = call.args[0];
      if (!props?.channelId || props.toolbar == null || !ctx.settings.get("headerButton"))
        return;
      const channel = getChannel(props.channelId);
      if (!canPopOut(channel))
        return;
      call.args[0] = { ...props, toolbar: /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          props.toolbar,
          /* @__PURE__ */ jsx_runtime.jsx(PopOutButton, {
            channel
          })
        ]
      }) };
    });
    ctx.contextMenu(["channel-context", "thread-context", "gdm-context"], (children, props) => {
      if (canPopOut(props.channel))
        addMenuItem(children, props.channel);
    });
    ctx.contextMenu("user-context", (children, props) => {
      if (props.channel?.type === DM && canPopOut(props.channel))
        addMenuItem(children, props.channel);
    });
    ctx.keybind("shortcut", popOutSelected);
  },
  popOut
});
