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

// plugins/typing-tweaks/index.tsx
var exports_typing_tweaks = {};
__export(exports_typing_tweaks, {
  default: () => typing_tweaks_default
});
module.exports = __toCommonJS(exports_typing_tweaks);
var import_api2 = require("@evi/api");

// plugins/typing-tweaks/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.avatars": "Avatars in the typing line",
    "settings.avatars.description": "A small avatar before each name in “is typing” above the chat box.",
    "settings.roleColors": "Names in role colours",
    "settings.roleColors.description": "Names in “is typing” in the colour of their top role, like in chat.",
    "settings.channels": "Dots on channels",
    "settings.channels.description": "Three dots on a channel or thread in the channel list while someone types in it.",
    "settings.dms": "Dots on DMs",
    "settings.dms.description": "Three dots on a DM in the DM list while someone types in it, next to the ones Discord puts on the avatar.",
    someone: "Someone",
    "typing.one": "{a} is typing",
    "typing.two": "{a} and {b} are typing",
    "typing.three": "{a}, {b} and {c} are typing",
    "typing.many": { one: "{a}, {b} and {count} other are typing", other: "{a}, {b} and {count} others are typing" }
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.avatars": "Avatare in der Tippzeile",
      "settings.avatars.description": "Ein kleiner Avatar vor jedem Namen in „schreibt gerade“ über dem Chatfeld.",
      "settings.roleColors": "Namen in Rollenfarben",
      "settings.roleColors.description": "Namen in „schreibt gerade“ in der Farbe ihrer höchsten Rolle, wie im Chat.",
      "settings.channels": "Punkte bei Kanälen",
      "settings.channels.description": "Drei Punkte bei einem Kanal oder Thread in der Kanalliste, solange dort jemand schreibt.",
      "settings.dms": "Punkte bei DMs",
      "settings.dms.description": "Drei Punkte bei einer DM in der DM-Liste, solange dort jemand schreibt, neben denen, die Discord am Avatar anzeigt.",
      someone: "Jemand",
      "typing.one": "{a} schreibt gerade",
      "typing.two": "{a} und {b} schreiben gerade",
      "typing.three": "{a}, {b} und {c} schreiben gerade",
      "typing.many": "{a}, {b} und {count} weitere schreiben gerade"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.avatars": "Avatares en la línea de escritura",
      "settings.avatars.description": "Un pequeño avatar antes de cada nombre en «está escribiendo» sobre el cuadro de chat.",
      "settings.roleColors": "Nombres con el color del rol",
      "settings.roleColors.description": "Los nombres en «está escribiendo» con el color de su rol más alto, como en el chat.",
      "settings.channels": "Puntos en los canales",
      "settings.channels.description": "Tres puntos en un canal o hilo de la lista de canales mientras alguien escribe en él.",
      "settings.dms": "Puntos en los MD",
      "settings.dms.description": "Tres puntos en un MD de la lista de MD mientras alguien escribe en él, junto a los que Discord pone en el avatar.",
      someone: "Alguien",
      "typing.one": "{a} está escribiendo",
      "typing.two": "{a} y {b} están escribiendo",
      "typing.three": "{a}, {b} y {c} están escribiendo",
      "typing.many": "{a}, {b} y {count} más están escribiendo"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.avatars": "Avatars dans la ligne d'écriture",
      "settings.avatars.description": "Un petit avatar devant chaque nom dans « est en train d'écrire » au-dessus de la zone de chat.",
      "settings.roleColors": "Noms aux couleurs des rôles",
      "settings.roleColors.description": "Les noms dans « est en train d'écrire » à la couleur de leur rôle principal, comme dans le chat.",
      "settings.channels": "Points sur les salons",
      "settings.channels.description": "Trois points sur un salon ou un fil de la liste des salons pendant que quelqu'un y écrit.",
      "settings.dms": "Points sur les MP",
      "settings.dms.description": "Trois points sur un MP de la liste des MP pendant que quelqu'un y écrit, en plus de ceux que Discord met sur l'avatar.",
      someone: "Quelqu'un",
      "typing.one": "{a} est en train d'écrire",
      "typing.two": "{a} et {b} sont en train d'écrire",
      "typing.three": "{a}, {b} et {c} sont en train d'écrire",
      "typing.many": { one: "{a}, {b} et {count} autre sont en train d'écrire", other: "{a}, {b} et {count} autres sont en train d'écrire" }
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.avatars": "入力中の表示にアバターを追加",
      "settings.avatars.description": "チャットボックスの上の「入力中」に表示される各名前の前に、小さなアバターを表示します。",
      "settings.roleColors": "名前をロールの色にする",
      "settings.roleColors.description": "「入力中」の名前を、チャットと同じく最上位ロールの色で表示します。",
      "settings.channels": "チャンネルにドットを表示",
      "settings.channels.description": "誰かが入力している間、チャンネルリストのチャンネルやスレッドに3つのドットを表示します。",
      "settings.dms": "DMにドットを表示",
      "settings.dms.description": "誰かが入力している間、DMリストのDMに3つのドットを表示します。Discordがアバターに表示するものとは別に表示されます。",
      someone: "誰か",
      "typing.one": "{a}さんが入力中",
      "typing.two": "{a}さんと{b}さんが入力中",
      "typing.three": "{a}さん、{b}さん、{c}さんが入力中",
      "typing.many": "{a}さん、{b}さん、他{count}人が入力中"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.avatars": "Awatary w linii pisania",
      "settings.avatars.description": "Mały awatar przed każdą nazwą w „pisze” nad polem czatu.",
      "settings.roleColors": "Nazwy w kolorach ról",
      "settings.roleColors.description": "Nazwy w „pisze” w kolorze najwyższej roli, tak jak na czacie.",
      "settings.channels": "Kropki przy kanałach",
      "settings.channels.description": "Trzy kropki przy kanale lub wątku na liście kanałów, gdy ktoś w nim pisze.",
      "settings.dms": "Kropki przy DM-ach",
      "settings.dms.description": "Trzy kropki przy DM-ie na liście wiadomości prywatnych, gdy ktoś w nim pisze, obok tych, które Discord pokazuje przy awatarze.",
      someone: "Ktoś",
      "typing.one": "{a} pisze",
      "typing.two": "{a} i {b} piszą",
      "typing.three": "{a}, {b} i {c} piszą",
      "typing.many": {
        few: "{a}, {b} i {count} inne osoby piszą",
        many: "{a}, {b} i {count} innych osób pisze",
        other: "{a}, {b} i {count} innych osób pisze"
      }
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.avatars": "Avatares na linha de digitação",
      "settings.avatars.description": "Um avatar pequeno antes de cada nome em “está digitando” acima da caixa de chat.",
      "settings.roleColors": "Nomes nas cores dos cargos",
      "settings.roleColors.description": "Os nomes em “está digitando” na cor do cargo mais alto, como no chat.",
      "settings.channels": "Pontinhos nos canais",
      "settings.channels.description": "Três pontinhos em um canal ou tópico na lista de canais enquanto alguém digita nele.",
      "settings.dms": "Pontinhos nas DMs",
      "settings.dms.description": "Três pontinhos em uma DM na lista de DMs enquanto alguém digita nela, ao lado dos que o Discord coloca no avatar.",
      someone: "Alguém",
      "typing.one": "{a} está digitando",
      "typing.two": "{a} e {b} estão digitando",
      "typing.three": "{a}, {b} e {c} estão digitando",
      "typing.many": "{a}, {b} e mais {count} pessoas estão digitando"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.avatars": "Аватары в строке набора",
      "settings.avatars.description": "Маленький аватар перед каждым именем в строке «печатает» над полем ввода.",
      "settings.roleColors": "Имена в цветах ролей",
      "settings.roleColors.description": "Имена в строке «печатает» цветом высшей роли, как в чате.",
      "settings.channels": "Точки у каналов",
      "settings.channels.description": "Три точки у канала или ветки в списке каналов, пока в нём кто-то печатает.",
      "settings.dms": "Точки у ЛС",
      "settings.dms.description": "Три точки у личного чата в списке ЛС, пока в нём кто-то печатает, в дополнение к тем, что Discord показывает на аватаре.",
      someone: "Кто-то",
      "typing.one": "{a} печатает",
      "typing.two": "{a} и {b} печатают",
      "typing.three": "{a}, {b} и {c} печатают",
      "typing.many": {
        one: "{a}, {b} и ещё {count} человек печатают",
        few: "{a}, {b} и ещё {count} человека печатают",
        many: "{a}, {b} и ещё {count} человек печатают",
        other: "{a}, {b} и ещё {count} человека печатают"
      }
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.avatars": "Yazıyor satırında avatarlar",
      "settings.avatars.description": "Sohbet kutusunun üstündeki “yazıyor” satırında her adın önünde küçük bir avatar.",
      "settings.roleColors": "Adlar rol renginde",
      "settings.roleColors.description": "“Yazıyor” satırındaki adlar, sohbetteki gibi en üst rolün renginde görünür.",
      "settings.channels": "Kanallarda noktalar",
      "settings.channels.description": "Kanal listesinde, birisi yazarken o kanalda veya konuda üç nokta görünür.",
      "settings.dms": "DM'lerde noktalar",
      "settings.dms.description": "DM listesinde, birisi yazarken o DM'de, Discord'un avatarın üzerine koyduklarının yanında üç nokta görünür.",
      someone: "Biri",
      "typing.one": "{a} yazıyor",
      "typing.two": "{a} ve {b} yazıyor",
      "typing.three": "{a}, {b} ve {c} yazıyor",
      "typing.many": "{a}, {b} ve {count} kişi daha yazıyor"
    } })["tr"];
  }
});

// plugins/typing-tweaks/typing.ts
function typerIds(typing, selfId, hidden, known = () => true) {
  return Object.keys(typing ?? {}).filter((id) => id !== selfId && !hidden(id) && known(id));
}
var MAX_NAMED = 3;
function nameSlots(parts) {
  const slots = [];
  parts.forEach((part, i) => {
    if (part !== null && typeof part === "object")
      slots.push(i);
  });
  return slots;
}
var PATCHES = {
  typingLine: {
    find: "Q8lUnE,{})",
    replace: {
      match: /(?<="aria-hidden":!0,children:)(\i)(?=\}\),\(0,\i\.jsx\)\("span",\{className:\i\.\i,style:\{position:"absolute",visibility:"hidden"\},"aria-hidden":!0,ref:\i,children:(\i)\}\))/,
      with: "$self?.renderTypingText?.($1,$1===$2,arguments[0])??$1"
    }
  },
  channel: {
    find: /textVariant:(?:"text-md\/medium"|[\w$]+),channel:[\w$]+,name:null!=/,
    replace: {
      match: /(?<=\(\i,\{textVariant:(?:"text-md\/medium"|\i),channel:(\i),name:null!=\i\?\i:\i\}\)\}\),)(?=\i\.Children\.count\()/,
      with: '$self?.renderIndicator?.($1,"channel"),'
    }
  },
  thread: {
    find: "__invalid_threadMainContent",
    replace: {
      match: /(?<=children:\[)(?=\(0,\i\.jsx\)\(\i,\{thread:(\i),countInVoice:)/,
      with: '$self?.renderIndicator?.($1,"channel"),'
    }
  },
  dm: {
    find: "PrivateChannel.renderAvatar",
    replace: {
      match: /(?<=\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i\.\i,\{\[\i\.\i\]:\i\}\),children:\[)(?=(?:null!=\i&&\(0,\i\.jsx\)\(\i,\{callMessageId:[^;]{0,300}?\}\),)?\i\?\(0,\i\.jsx\)\(\i,\{\}\):\i\?\(0,\i\.jsx\)\(\i,\{\}\):\i\?\(0,\i\.jsx\)\(\i,\{\}\):null,)/,
      with: '$self?.renderIndicator?.(arguments[0]?.channel,"dm"),'
    }
  }
};

// plugins/typing-tweaks/index.tsx
var jsx_runtime = require("react/jsx-runtime");
var settings = {
  avatars: { type: "boolean", get label() {
    return t("settings.avatars");
  }, get description() {
    return t("settings.avatars.description");
  }, default: true },
  roleColors: { type: "boolean", get label() {
    return t("settings.roleColors");
  }, get description() {
    return t("settings.roleColors.description");
  }, default: true },
  channels: { type: "boolean", get label() {
    return t("settings.channels");
  }, get description() {
    return t("settings.channels.description");
  }, default: true },
  dms: { type: "boolean", get label() {
    return t("settings.dms");
  }, get description() {
    return t("settings.dms.description");
  }, default: true }
};
var context;
function store(name) {
  try {
    return import_api2.findStore(name);
  } catch {
    return;
  }
}
var selfId = () => store("UserStore")?.getCurrentUser?.()?.id;
function isHidden(id) {
  const relationships = store("RelationshipStore");
  return !!(relationships?.isBlockedOrIgnored?.(id) ?? relationships?.isBlocked?.(id));
}
function typersIn(channelId) {
  const users = store("UserStore");
  return typerIds(store("TypingStore")?.getTypingUsers?.(channelId), selfId(), isHidden, (id) => !!users?.getUser?.(id));
}
function subscribeTyping(onChange) {
  const typing = store("TypingStore");
  typing?.addChangeListener?.(onChange);
  return () => typing?.removeChangeListener?.(onChange);
}
function displayName(id, guildId) {
  const user = store("UserStore")?.getUser?.(id);
  const nick = guildId ? store("GuildMemberStore")?.getNick?.(guildId, id) : undefined;
  return nick ?? user?.globalName ?? user?.username ?? t("someone");
}
function TypingName({ userId, guildId, children }) {
  const { avatars, roleColors } = context.settings.use();
  const color = roleColors && guildId ? store("GuildMemberStore")?.getMember?.(guildId, userId)?.colorString : undefined;
  const avatar = avatars ? store("UserStore")?.getUser?.(userId)?.getAvatarURL?.(guildId, 32) : undefined;
  return /* @__PURE__ */ jsx_runtime.jsxs("span", {
    className: "evi-typing-name",
    style: color ? { color } : undefined,
    children: [
      avatar && /* @__PURE__ */ jsx_runtime.jsx("img", {
        className: "evi-typing-avatar",
        src: avatar,
        alt: "",
        draggable: false
      }),
      children
    ]
  });
}
function typingText(names) {
  const [a, b, c] = names;
  if (names.length === 1)
    return t("typing.one", { a });
  if (names.length === 2)
    return t("typing.two", { a, b });
  if (names.length === 3)
    return t("typing.three", { a, b, c });
  return t("typing.many", { a, b, count: names.length - 2 });
}
function TypingIndicator({ channelId, guildId }) {
  const ids = import_api2.React.useSyncExternalStore(subscribeTyping, () => typersIn(channelId).join(","));
  if (!ids)
    return null;
  const label = typingText(ids.split(",").map((id) => displayName(id, guildId)));
  const dots = /* @__PURE__ */ jsx_runtime.jsxs("span", {
    className: "evi-typing-dots",
    role: "img",
    "aria-label": label,
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("span", {}),
      /* @__PURE__ */ jsx_runtime.jsx("span", {}),
      /* @__PURE__ */ jsx_runtime.jsx("span", {})
    ]
  });
  const Tooltip = import_api2.Components.Tooltip;
  return Tooltip ? /* @__PURE__ */ jsx_runtime.jsx(Tooltip, {
    text: label,
    position: "top",
    children: dots
  }) : dots;
}
var typing_tweaks_default = import_api2.definePlugin({
  settings,
  patches: [PATCHES.typingLine, PATCHES.channel, PATCHES.thread, PATCHES.dm],
  renderTypingText(text, named, props) {
    try {
      if (!context || !named || !Array.isArray(text) || !props?.channel?.id)
        return;
      const { avatars, roleColors } = context.settings.all;
      if (!avatars && !roleColors)
        return;
      const count = props.typingUsers?.length ?? 0;
      if (!count || count > MAX_NAMED)
        return;
      const ids = typersIn(props.channel.id);
      const slots = nameSlots(text);
      if (slots.length !== ids.length || ids.length !== count)
        return;
      const guildId = props.guildId ?? props.channel.guild_id ?? undefined;
      return text.map((part, i) => {
        const slot = slots.indexOf(i);
        return slot === -1 ? /* @__PURE__ */ jsx_runtime.jsx(import_api2.React.Fragment, {
          children: part
        }, i) : /* @__PURE__ */ jsx_runtime.jsx(TypingName, {
          userId: ids[slot],
          guildId,
          children: part
        }, i);
      });
    } catch (err) {
      context?.logger.error("Couldn't draw the typing line", err);
    }
  },
  renderIndicator(channel, kind) {
    try {
      if (!context || !channel?.id)
        return null;
      if (!context.settings.get(kind === "dm" ? "dms" : "channels"))
        return null;
      return /* @__PURE__ */ jsx_runtime.jsx(TypingIndicator, {
        channelId: channel.id,
        guildId: channel.guild_id ?? undefined
      }, "evi-typing");
    } catch (err) {
      context?.logger.error("Couldn't draw the typing dots", err);
      return null;
    }
  },
  css: `
        .evi-typing-name { display: inline-flex; align-items: baseline; gap: 4px; }
        .evi-typing-name > strong, .evi-typing-name > b { color: inherit; }
        .evi-typing-avatar { align-self: center; inline-size: 16px; block-size: 16px; border-radius: 50%; object-fit: cover; }
        .evi-typing-dots { display: inline-flex; flex: none; align-items: center; gap: 2px; margin-inline: 4px;
            color: var(--interactive-normal, var(--interactive-text-default, #b5bac1)); }
        .evi-typing-dots > span { inline-size: 4px; block-size: 4px; border-radius: 50%; background: currentColor; opacity: 0.4; }
        @media (prefers-reduced-motion: no-preference) {
            .evi-typing-dots > span { animation: evi-typing-dot 1.2s ease-in-out infinite; }
            .evi-typing-dots > span:nth-child(2) { animation-delay: 0.15s; }
            .evi-typing-dots > span:nth-child(3) { animation-delay: 0.3s; }
        }
        @keyframes evi-typing-dot { 0%, 60%, 100% { opacity: 0.4; transform: none; } 30% { opacity: 1; transform: translateY(-2px); } }
    `,
  start(ctx) {
    context = ctx;
    ctx.onDispose(() => void (context = undefined));
  }
});
