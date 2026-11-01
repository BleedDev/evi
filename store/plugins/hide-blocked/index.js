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

// plugins/hide-blocked/index.ts
var exports_hide_blocked = {};
__export(exports_hide_blocked, {
  default: () => hide_blocked_default
});
module.exports = __toCommonJS(exports_hide_blocked);
var import_api2 = require("@evi/api");

// plugins/hide-blocked/filter.ts
var BLOCKED_GROUP = "MESSAGE_GROUP_BLOCKED";
var IGNORED_GROUP = "MESSAGE_GROUP_IGNORED";
var REPLY_TYPE = 19;
function safe(fn) {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}
function hiddenKind(message, rel, options) {
  if (!message)
    return null;
  const authorId = message.author?.id;
  if (message.blocked || safe(() => rel?.isBlockedForMessage?.(message)) || authorId != null && safe(() => rel?.isBlocked?.(authorId)))
    return "blocked";
  if (!options.ignored)
    return null;
  if (message.ignored || safe(() => rel?.isIgnoredForMessage?.(message)) || authorId != null && safe(() => rel?.isIgnored?.(authorId)))
    return "ignored";
  return null;
}
function isHiddenUser(userId, rel, options) {
  if (!options.active || userId == null)
    return false;
  return safe(() => rel?.isBlocked?.(userId)) || options.ignored && safe(() => rel?.isIgnored?.(userId));
}
function repliesToHidden(message, lookups, options) {
  const ref = message.messageReference;
  if (message.type !== REPLY_TYPE || ref?.message_id == null || !lookups.referenced)
    return false;
  let target;
  try {
    target = lookups.referenced(ref)?.message;
  } catch {
    return false;
  }
  return hiddenKind(target, lookups.relationships, options) != null;
}
function shouldHideMessage(message, collapse, lookups, options) {
  if (!options.active || !message)
    return false;
  if (collapse === BLOCKED_GROUP)
    return true;
  if (collapse === IGNORED_GROUP && options.ignored)
    return true;
  return options.replies && repliesToHidden(message, lookups, options);
}
function createReplyTracker(read, max = 5000) {
  const asked = new Map;
  const targetOf = (ref) => {
    try {
      return read(ref)?.message;
    } catch {
      return;
    }
  };
  return {
    referenced(ref) {
      const result = read(ref);
      if (asked.size >= max)
        asked.clear();
      asked.set(`${ref.channel_id}:${ref.message_id}`, { ref, message: result?.message });
      return result;
    },
    changed() {
      let changed = false;
      for (const entry of asked.values()) {
        const now = targetOf(entry.ref);
        if (now === entry.message)
          continue;
        entry.message = now;
        changed = true;
      }
      return changed;
    },
    clear: () => asked.clear(),
    get size() {
      return asked.size;
    }
  };
}
function shouldHideMemberRow(row, rel, options) {
  if (row == null || typeof row !== "object")
    return false;
  const { type, user } = row;
  return type === "MEMBER" && isHiddenUser(user?.id, rel, options);
}
function filterVoiceStates(states, rel, options, mine) {
  if (!options.active || !Array.isArray(states) || states.length === 0)
    return states;
  const kept = states.filter((s) => !isHiddenUser(s?.user?.id, rel, options) || mine?.(s?.voiceState?.channelId) === true);
  return kept.length === states.length ? states : kept;
}
var PATCHES = {
  stream: {
    find: '"416cc9_1"',
    replace: [
      {
        match: /(\.forEach\((\i)=>\{var \i,\i;let \i,\i,\i;)(if\(\i&&\2\.isFirstMessageInForumPost\((\i)\)\)return;[^]{0,1500}?let \i=(\i)\(\4,\2,\i&&\i\);)/,
        with: "$1if($self?.hide?.($2,$5($4,$2,!1)))return;$3"
      },
      {
        match: /(\[(?:\i,)*\i)(\]\);return\{messages:\i,channelStream:\i,)/,
        with: "$1,$self?.useVersion?.()$2"
      }
    ]
  },
  memberList: {
    find: "getFirstApplicationIdOccurrences",
    replace: {
      match: /(renderRow=(\i)=>\{let\{section:\i,row:\i,rowIndex:\i\}=\2,\{channel:\i\}=this\.props,(\i)=this\.getRowProps\(\2\);)/,
      with: "$1if($self?.hideMember?.($3))return null;"
    }
  },
  voiceUsers: {
    find: '"ConnectedVoiceUser"',
    replace: {
      match: /(collapsedMax:\i=6,[^]{0,200}?=\(0,\i\.\i\)\(\i\.id,)(\i\?\?\i)\)/,
      with: "$1($self?.useVoiceStates?.($2)??$2))"
    }
  }
};
var VOICE_FIELDS = [
  "channelId",
  "deaf",
  "mute",
  "requestToSpeakTimestamp",
  "selfDeaf",
  "selfMute",
  "selfStream",
  "selfVideo",
  "sessionId",
  "suppress",
  "userId",
  "discoverable",
  "connectedAt"
];
var reactionKey = (a) => `${a.messageId}:${a.emoji?.id ?? a.emoji?.name}:${a.reactionType ?? (a.burst ? 1 : 0)}:${a.userId}`;
var MAX_DROPPED_REACTIONS = 2000;
function filterAction(action, hidden, options, voice, droppedReactions) {
  if (!options.active || action == null || typeof action !== "object")
    return action;
  switch (action.type) {
    case "MESSAGE_REACTION_ADD":
      if (!hidden(action.userId))
        return action;
      if (droppedReactions) {
        if (droppedReactions.size >= MAX_DROPPED_REACTIONS)
          droppedReactions.delete(droppedReactions.values().next().value);
        droppedReactions.add(reactionKey(action));
      }
      return null;
    case "MESSAGE_REACTION_REMOVE":
      return droppedReactions?.delete(reactionKey(action)) ? null : action;
    case "LOAD_RECENT_MENTIONS_SUCCESS": {
      if (!Array.isArray(action.messages))
        return action;
      const kept = action.messages.filter((m) => !hidden(m?.author?.id));
      return kept.length === action.messages.length ? action : { ...action, messages: kept };
    }
    case "VOICE_STATE_UPDATES":
    case "PASSIVE_UPDATE_V2": {
      const states = action.voiceStates;
      if (!options.voice || !Array.isArray(states))
        return action;
      let kept = null;
      states.forEach((s, i) => {
        let next = s;
        if (s?.userId != null && hidden(s.userId)) {
          if (voice?.mine?.(s.channelId)) {
            voice.onShown?.(s.userId);
          } else {
            voice?.onHidden?.(s, action.guildId ?? s.guildId ?? null);
            next = voice?.shown?.(s.userId) ? s.channelId == null ? s : { ...s, channelId: null } : null;
          }
        }
        if (next === s)
          return void kept?.push(s);
        kept ??= states.slice(0, i);
        if (next)
          kept.push(next);
      });
      return kept == null ? action : { ...action, voiceStates: kept };
    }
    case "VOICE_CHANNEL_EFFECT_SEND":
      return options.voice && hidden(action.userId) ? null : action;
    default:
      return action;
  }
}
function withHiddenIn(found, channelId, hiddenStates, is) {
  let out;
  for (const [userId, state] of hiddenStates) {
    if (state?.channelId !== channelId || found?.has(userId) || !safe(() => is(userId)))
      continue;
    (out ??= new Set(found ?? [])).add(userId);
  }
  return out ?? found;
}
function filterDmIds(ids, recipientOf, hidden) {
  const out = ids.filter((id) => !hidden(recipientOf(id)));
  return out.length === ids.length ? ids : out;
}

// plugins/hide-blocked/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.active": "Hide blocked messages",
    "settings.active.description": `Turn off to get Discord's collapsed "blocked messages" rows back. /hideblocked flips this.`,
    "settings.ignored": "Ignored users too",
    "settings.ignored.description": "Treat users you ignored like users you blocked.",
    "settings.replies": "Hide replies to them",
    "settings.replies.description": 'Also hide messages replying to a hidden user. When off, the reply stays and its quote reads "Blocked message".',
    "settings.memberList": "Hide from the member list",
    "settings.memberList.description": "Leave them out of a server's member list. Takes effect as the list updates.",
    "settings.voice": "Hide from voice channels you're not in",
    "settings.voice.description": "Leaves them out of voice channels you're not in (the list under each channel, and anywhere else Discord shows who's in voice), and drops their soundboard sounds. In a call you're in or joining they always show, and Discord still warns you that someone you blocked is there, since they can hear you.",
    "command.description": "Toggle hiding blocked users' messages",
    "command.on": "Blocked users' messages are hidden.",
    "command.off": "Blocked users' messages show as Discord's collapsed rows again.",
    "settings.mute": "Mute their audio",
    "settings.mute.description": "Locally mutes their voice and stream audio, so you never hear them. Undone when they're unblocked or this is turned off.",
    "settings.dms": "Hide your DMs with them",
    "settings.dms.description": "Drop DMs with them from your direct messages list."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.active": "Blockierte Nachrichten ausblenden",
      "settings.active.description": "Ausschalten, um Discords eingeklappte Zeilen „blockierte Nachrichten“ zurückzubekommen. /hideblocked schaltet das um.",
      "settings.ignored": "Auch ignorierte Nutzer",
      "settings.ignored.description": "Ignorierte Nutzer wie blockierte Nutzer behandeln.",
      "settings.replies": "Antworten auf sie ausblenden",
      "settings.replies.description": "Blendet auch Nachrichten aus, die auf einen ausgeblendeten Nutzer antworten. Wenn aus, bleibt die Antwort stehen und ihr Zitat lautet „Blockierte Nachricht“.",
      "settings.memberList": "In der Mitgliederliste ausblenden",
      "settings.memberList.description": "Lässt sie in der Mitgliederliste eines Servers weg. Wirkt, sobald sich die Liste aktualisiert.",
      "settings.voice": "In Sprachkanälen ausblenden, in denen du nicht bist",
      "settings.voice.description": "Lässt sie in Sprachkanälen weg, in denen du nicht bist (in der Liste unter jedem Kanal und überall sonst, wo Discord zeigt, wer im Sprachkanal ist), und unterdrückt ihre Soundboard-Sounds. In einem Anruf, in dem du bist oder dem du beitrittst, siehst du sie immer, und Discord warnt dich weiterhin, dass jemand, den du blockiert hast, dort ist, denn dort können sie dich hören.",
      "command.description": "Ausblenden der Nachrichten blockierter Nutzer ein- oder ausschalten",
      "command.on": "Nachrichten blockierter Nutzer werden ausgeblendet.",
      "command.off": "Nachrichten blockierter Nutzer erscheinen wieder als Discords eingeklappte Zeilen.",
      "settings.mute": "Ihren Ton stummschalten",
      "settings.mute.description": "Schaltet ihre Stimme und ihren Stream-Ton lokal stumm, damit du sie nie hörst. Wird aufgehoben, wenn du sie entblockst oder das ausschaltest.",
      "settings.dms": "Deine DMs mit ihnen ausblenden",
      "settings.dms.description": "Entfernt DMs mit ihnen aus deiner Liste der Direktnachrichten."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.active": "Ocultar mensajes bloqueados",
      "settings.active.description": "Desactívalo para recuperar las filas plegadas de «mensajes bloqueados» de Discord. /hideblocked lo activa o desactiva.",
      "settings.ignored": "También usuarios ignorados",
      "settings.ignored.description": "Trata a los usuarios que ignoraste como a los que bloqueaste.",
      "settings.replies": "Ocultar respuestas a ellos",
      "settings.replies.description": "También oculta los mensajes que responden a un usuario oculto. Si está desactivado, la respuesta se queda y su cita dice «Mensaje bloqueado».",
      "settings.memberList": "Ocultar de la lista de miembros",
      "settings.memberList.description": "Los deja fuera de la lista de miembros de un servidor. Surte efecto cuando se actualiza la lista.",
      "settings.voice": "Ocultar de los canales de voz en los que no estás",
      "settings.voice.description": "Los deja fuera de los canales de voz en los que no estás (la lista bajo cada canal y cualquier otro sitio donde Discord muestra quién está en voz) y quita los sonidos de su caja de sonidos. En una llamada en la que estás o a la que te unes siempre aparecen, y Discord te sigue avisando de que hay alguien que bloqueaste, porque ahí pueden oírte.",
      "command.description": "Activa o desactiva la ocultación de mensajes de usuarios bloqueados",
      "command.on": "Los mensajes de usuarios bloqueados están ocultos.",
      "command.off": "Los mensajes de usuarios bloqueados vuelven a mostrarse como las filas plegadas de Discord.",
      "settings.mute": "Silenciar su audio",
      "settings.mute.description": "Silencia localmente su voz y el audio de su transmisión, para que nunca los oigas. Se deshace al desbloquearlos o al desactivar esto.",
      "settings.dms": "Ocultar tus MD con ellos",
      "settings.dms.description": "Quita los MD con ellos de tu lista de mensajes directos."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.active": "Masquer les messages bloqués",
      "settings.active.description": "Désactive pour retrouver les lignes repliées « messages bloqués » de Discord. /hideblocked l'active ou le désactive.",
      "settings.ignored": "Aussi les utilisateurs ignorés",
      "settings.ignored.description": "Traite les utilisateurs que tu as ignorés comme ceux que tu as bloqués.",
      "settings.replies": "Masquer les réponses à ces utilisateurs",
      "settings.replies.description": "Masque aussi les messages qui répondent à un utilisateur masqué. Désactivé, la réponse reste et sa citation affiche « Message bloqué ».",
      "settings.memberList": "Masquer de la liste des membres",
      "settings.memberList.description": "Les retire de la liste des membres d'un serveur. Prend effet à la mise à jour de la liste.",
      "settings.voice": "Masquer des salons vocaux où tu n'es pas",
      "settings.voice.description": "Les retire des salons vocaux où tu n'es pas (la liste sous chaque salon et partout où Discord montre qui est en vocal) et coupe les sons de leur soundboard. Dans un appel où tu es ou que tu rejoins, ils restent toujours visibles, et Discord te prévient toujours qu'une personne que tu as bloquée est là, car elle peut t'y entendre.",
      "command.description": "Active ou désactive le masquage des messages des utilisateurs bloqués",
      "command.on": "Les messages des utilisateurs bloqués sont masqués.",
      "command.off": "Les messages des utilisateurs bloqués s'affichent de nouveau en lignes repliées de Discord.",
      "settings.mute": "Couper leur son",
      "settings.mute.description": "Coupe localement leur voix et le son de leur stream, pour que tu ne les entendes jamais. Annulé quand tu les débloques ou désactives ceci.",
      "settings.dms": "Masquer tes MP avec eux",
      "settings.dms.description": "Retire les MP avec eux de ta liste de messages privés."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.active": "ブロックしたメッセージを非表示",
      "settings.active.description": "オフにすると、Discord の折りたたまれた「ブロックしたメッセージ」の行が戻ります。/hideblocked で切り替えられます。",
      "settings.ignored": "無視したユーザーも対象にする",
      "settings.ignored.description": "無視したユーザーを、ブロックしたユーザーと同じように扱います。",
      "settings.replies": "そのユーザーへの返信を非表示",
      "settings.replies.description": "非表示のユーザーへの返信メッセージも隠します。オフの場合、返信は残り、引用部分は「ブロックしたメッセージ」と表示されます。",
      "settings.memberList": "メンバーリストから非表示",
      "settings.memberList.description": "サーバーのメンバーリストに表示しません。リストが更新されると反映されます。",
      "settings.voice": "参加していないボイスチャンネルで非表示",
      "settings.voice.description": "参加していないボイスチャンネルから除外し(各チャンネル下の一覧や、Discordがボイスにいる人を表示するほかの場所)、サウンドボードの音も流しません。参加中または参加しようとしている通話では常に表示され、ブロックした人がいることをDiscordがこれまでどおり警告します。そこではあなたの声が聞こえるためです。",
      "command.description": "ブロックしたユーザーのメッセージの非表示を切り替える",
      "command.on": "ブロックしたユーザーのメッセージを非表示にしました。",
      "command.off": "ブロックしたユーザーのメッセージが、Discord の折りたたみ行として表示されるようになりました。",
      "settings.mute": "音声をミュート",
      "settings.mute.description": "相手の声と配信の音声をローカルでミュートし、聞こえないようにします。ブロック解除するか、これをオフにすると元に戻ります。",
      "settings.dms": "相手とのDMを非表示",
      "settings.dms.description": "相手とのDMをダイレクトメッセージ一覧から外します。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.active": "Ukrywaj zablokowane wiadomości",
      "settings.active.description": "Wyłącz, aby wróciły zwinięte wiersze „zablokowanych wiadomości” z Discorda. Przełączysz to poleceniem /hideblocked.",
      "settings.ignored": "Także ignorowani użytkownicy",
      "settings.ignored.description": "Traktuj zignorowanych użytkowników tak jak zablokowanych.",
      "settings.replies": "Ukrywaj odpowiedzi do nich",
      "settings.replies.description": "Ukrywa też wiadomości odpowiadające ukrytemu użytkownikowi. Gdy wyłączone, odpowiedź zostaje, a jej cytat brzmi „Zablokowana wiadomość”.",
      "settings.memberList": "Ukrywaj na liście członków",
      "settings.memberList.description": "Pomija ich na liście członków serwera. Działa po odświeżeniu listy.",
      "settings.voice": "Ukrywaj na kanałach głosowych, na których cię nie ma",
      "settings.voice.description": "Pomija ich na kanałach głosowych, na których cię nie ma (na liście pod każdym kanałem i wszędzie indziej, gdzie Discord pokazuje, kto jest na głosowym), i wycisza dźwięki z ich soundboardu. W rozmowie, w której jesteś lub do której dołączasz, zawsze są widoczni, a Discord nadal ostrzega, że jest tam ktoś, kogo zablokowałeś, bo tam mogą cię słyszeć.",
      "command.description": "Włącz lub wyłącz ukrywanie wiadomości zablokowanych użytkowników",
      "command.on": "Wiadomości zablokowanych użytkowników są ukryte.",
      "command.off": "Wiadomości zablokowanych użytkowników znów pojawiają się jako zwinięte wiersze Discorda.",
      "settings.mute": "Wycisz ich dźwięk",
      "settings.mute.description": "Lokalnie wycisza ich głos i dźwięk transmisji, więc nigdy ich nie słyszysz. Cofnięte, gdy ich odblokujesz lub to wyłączysz.",
      "settings.dms": "Ukryj DM z nimi",
      "settings.dms.description": "Usuwa DM z nimi z listy wiadomości prywatnych."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.active": "Ocultar mensagens bloqueadas",
      "settings.active.description": "Desative para voltar às linhas recolhidas de “mensagens bloqueadas” do Discord. /hideblocked ativa ou desativa.",
      "settings.ignored": "Usuários ignorados também",
      "settings.ignored.description": "Trata os usuários que você ignorou como os que você bloqueou.",
      "settings.replies": "Ocultar respostas a eles",
      "settings.replies.description": "Também oculta mensagens que respondem a um usuário oculto. Desativado, a resposta continua e a citação mostra “Mensagem bloqueada”.",
      "settings.memberList": "Ocultar da lista de membros",
      "settings.memberList.description": "Deixa eles de fora da lista de membros de um servidor. Vale quando a lista for atualizada.",
      "settings.voice": "Ocultar dos canais de voz em que você não está",
      "settings.voice.description": "Deixa eles de fora dos canais de voz em que você não está (a lista sob cada canal e qualquer outro lugar onde o Discord mostra quem está em voz) e corta os sons do soundboard deles. Numa chamada em que você está ou em que vai entrar, eles sempre aparecem, e o Discord continua avisando que alguém que você bloqueou está lá, porque lá eles podem ouvir você.",
      "command.description": "Ativa ou desativa a ocultação das mensagens de usuários bloqueados",
      "command.on": "As mensagens de usuários bloqueados estão ocultas.",
      "command.off": "As mensagens de usuários bloqueados voltam a aparecer como as linhas recolhidas do Discord.",
      "settings.mute": "Silenciar o áudio deles",
      "settings.mute.description": "Silencia localmente a voz e o áudio da transmissão deles, para você nunca ouvi-los. Desfeito ao desbloqueá-los ou desativar isso.",
      "settings.dms": "Ocultar suas DMs com eles",
      "settings.dms.description": "Tira as DMs com eles da sua lista de mensagens diretas."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.active": "Скрывать сообщения заблокированных",
      "settings.active.description": "Выключите, чтобы вернуть свёрнутые строки Discord «заблокированные сообщения». Команда /hideblocked переключает это.",
      "settings.ignored": "И игнорируемых пользователей",
      "settings.ignored.description": "Относиться к игнорируемым пользователям так же, как к заблокированным.",
      "settings.replies": "Скрывать ответы им",
      "settings.replies.description": "Также скрывает сообщения-ответы скрытому пользователю. Если выключено, ответ остаётся, а в его цитате написано «Заблокированное сообщение».",
      "settings.memberList": "Скрывать в списке участников",
      "settings.memberList.description": "Не показывать их в списке участников сервера. Вступает в силу при обновлении списка.",
      "settings.voice": "Скрывать в голосовых каналах, где вас нет",
      "settings.voice.description": "Убирает их из голосовых каналов, где вас нет (из списка под каждым каналом и отовсюду, где Discord показывает, кто в голосовом), и отключает звуки их звуковой панели. В звонке, где вы есть или к которому подключаетесь, они видны всегда, и Discord по-прежнему предупреждает, что там тот, кого вы заблокировали: там они могут вас слышать.",
      "command.description": "Включить или выключить скрытие сообщений заблокированных пользователей",
      "command.on": "Сообщения заблокированных пользователей скрыты.",
      "command.off": "Сообщения заблокированных пользователей снова показываются свёрнутыми строками Discord.",
      "settings.mute": "Заглушить их звук",
      "settings.mute.description": "Локально заглушает их голос и звук трансляции, чтобы вы их не слышали. Отменяется, когда вы их разблокируете или выключите это.",
      "settings.dms": "Скрыть ваши ЛС с ними",
      "settings.dms.description": "Убирает ЛС с ними из списка личных сообщений."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.active": "Engellenen mesajları gizle",
      "settings.active.description": `Kapatırsan Discord'un daralmış "engellenen mesajlar" satırları geri gelir. /hideblocked bunu açıp kapatır.`,
      "settings.ignored": "Yok sayılan kullanıcılar da",
      "settings.ignored.description": "Yok saydığın kullanıcılara engellediğin kullanıcılar gibi davran.",
      "settings.replies": "Onlara verilen yanıtları gizle",
      "settings.replies.description": 'Gizlenen bir kullanıcıya yanıt veren mesajları da gizler. Kapalıyken yanıt kalır ve alıntısında "Engellenen mesaj" yazar.',
      "settings.memberList": "Üye listesinde gizle",
      "settings.memberList.description": "Bir sunucunun üye listesinde görünmezler. Liste güncellenince geçerli olur.",
      "settings.voice": "Bulunmadığın ses kanallarında gizle",
      "settings.voice.description": "Onları bulunmadığın ses kanallarında göstermez (her kanalın altındaki liste ve Discord'un seste kimin olduğunu gösterdiği diğer yerler) ve ses paneli seslerini kapatır. Bulunduğun ya da katıldığın bir aramada her zaman görünürler ve Discord engellediğin birinin orada olduğu konusunda seni yine uyarır, çünkü orada seni duyabilirler.",
      "command.description": "Engellenen kullanıcıların mesajlarını gizlemeyi aç veya kapat",
      "command.on": "Engellenen kullanıcıların mesajları gizlendi.",
      "command.off": "Engellenen kullanıcıların mesajları yine Discord'un daralmış satırları olarak görünüyor.",
      "settings.mute": "Seslerini kapat",
      "settings.mute.description": "Seslerini ve yayın seslerini yerel olarak kapatır, böylece onları hiç duymazsın. Engeli kaldırınca ya da bunu kapatınca geri alınır.",
      "settings.dms": "Onlarla DM'lerini gizle",
      "settings.dms.description": "Onlarla olan DM'leri direkt mesaj listenden çıkarır."
    } })["tr"];
  }
});

// plugins/hide-blocked/index.ts
var settings = {
  active: {
    type: "boolean",
    get label() {
      return t("settings.active");
    },
    get description() {
      return t("settings.active.description");
    },
    default: true
  },
  ignored: {
    type: "boolean",
    get label() {
      return t("settings.ignored");
    },
    get description() {
      return t("settings.ignored.description");
    },
    default: true
  },
  replies: {
    type: "boolean",
    get label() {
      return t("settings.replies");
    },
    get description() {
      return t("settings.replies.description");
    },
    default: false
  },
  memberList: {
    type: "boolean",
    get label() {
      return t("settings.memberList");
    },
    get description() {
      return t("settings.memberList.description");
    },
    default: true
  },
  voice: {
    type: "boolean",
    get label() {
      return t("settings.voice");
    },
    get description() {
      return t("settings.voice.description");
    },
    default: false
  },
  mute: {
    type: "boolean",
    get label() {
      return t("settings.mute");
    },
    get description() {
      return t("settings.mute.description");
    },
    default: true
  },
  dms: {
    type: "boolean",
    get label() {
      return t("settings.dms");
    },
    get description() {
      return t("settings.dms.description");
    },
    default: true
  }
};
var options;
var relationships;
var referencedStore;
var replies = createReplyTracker((ref) => referencedStore?.getMessageByReference?.(ref));
var lookups = {
  get relationships() {
    return relationships;
  },
  referenced: replies.referenced
};
var version = 0;
var listeners = new Set;
function bump() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(cb) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
function useVersion() {
  return import_api2.React.useSyncExternalStore(subscribe, () => version);
}
var hidden = (userId) => !!options && isHiddenUser(userId, relationships, options);
var OWN = Symbol("hide-blocked");
var AUDIO_CONTEXTS = ["default", "stream"];
var DM = 1;
var hiddenVoice = new Map;
function dispatchOwn(action) {
  try {
    Promise.resolve(import_api2.Dispatcher.dispatch({ ...action, [OWN]: true })).catch(() => {});
  } catch {}
}
var voiceStore;
var channelStore;
var mediaEngine;
var audioActions;
var dmSort;
var selectedChannels;
var rtcStore;
var userStore;
var joining;
function mine(channelId) {
  if (channelId == null)
    return false;
  if (channelId === joining)
    return true;
  try {
    if (selectedChannels?.getVoiceChannelId?.() === channelId || rtcStore?.getChannelId?.() === channelId)
      return true;
    const me = userStore?.getCurrentUser?.()?.id;
    return me != null && voiceStore?.getVoiceStateForUser?.(me)?.channelId === channelId;
  } catch {
    return false;
  }
}
var voiceHooks = {
  mine,
  shown: (userId) => {
    try {
      return voiceStore?.getVoiceStateForUser?.(userId)?.channelId != null;
    } catch {
      return false;
    }
  },
  onHidden(s, guildId) {
    if (s.userId == null)
      return;
    if (s.channelId == null)
      hiddenVoice.delete(s.userId);
    else
      hiddenVoice.set(s.userId, { ...s, guildId });
  },
  onShown: (userId) => void hiddenVoice.delete(userId)
};
var saveMuted;
var mutedByUs = () => [];
function reconcileVoice() {
  if (voiceStore == null)
    return;
  const on = !!options?.active && !!options.voice;
  const leaves = [];
  if (on) {
    for (const users of Object.values(voiceStore.getAllVoiceStates?.() ?? {})) {
      for (const [userId, s] of Object.entries(users ?? {})) {
        if (!hidden(userId) || s?.channelId == null || mine(s.channelId))
          continue;
        const state = { guildId: channelStore?.getChannel?.(s.channelId)?.guild_id ?? null };
        for (const k of VOICE_FIELDS)
          state[k] = s[k];
        state.userId = userId;
        hiddenVoice.set(userId, state);
        leaves.push({ ...state, channelId: null });
      }
    }
  }
  const returns = [];
  for (const [userId, state] of hiddenVoice) {
    if (on && hidden(userId) && !mine(state.channelId))
      continue;
    returns.push(state);
    hiddenVoice.delete(userId);
  }
  if (leaves.length)
    dispatchOwn({ type: "VOICE_STATE_UPDATES", voiceStates: leaves });
  if (returns.length)
    dispatchOwn({ type: "VOICE_STATE_UPDATES", voiceStates: returns });
}
function reconcileAudio(off = false) {
  if (audioActions?.toggleLocalMute == null || mediaEngine?.isLocalMute == null)
    return;
  const ids = [];
  try {
    ids.push(...relationships && relationships.getBlockedIDs ? relationships.getBlockedIDs() : []);
    if (options?.ignored)
      ids.push(...relationships?.getIgnoredIDs?.() ?? []);
  } catch {}
  const want = new Set(!off && options?.active && options.mute ? ids : []);
  const ours = new Set(mutedByUs());
  const before = [...ours].join();
  for (const id of want) {
    for (const c of AUDIO_CONTEXTS) {
      if (mediaEngine.isLocalMute(id, c))
        continue;
      audioActions.toggleLocalMute(id, c);
      ours.add(`${id}:${c}`);
    }
  }
  for (const key of [...ours]) {
    const [id, c] = key.split(":");
    if (want.has(id))
      continue;
    if (mediaEngine.isLocalMute(id, c))
      audioActions.toggleLocalMute(id, c);
    ours.delete(key);
  }
  if ([...ours].join() !== before)
    saveMuted?.([...ours]);
}
function refreshDms() {
  try {
    dmSort?.emitChange?.();
  } catch {}
}
var lastDmIn;
var lastDmVersion = -1;
var lastDmOut;
var voiceCache = new WeakMap;
var hide_blocked_default = import_api2.definePlugin({
  settings,
  patches: [PATCHES.stream, PATCHES.memberList, PATCHES.voiceUsers],
  hide(message, collapse) {
    return !!options && shouldHideMessage(message, collapse, lookups, options);
  },
  useVersion,
  hideMember(row) {
    return !!options?.memberList && shouldHideMemberRow(row, relationships, options);
  },
  useVoiceStates(states) {
    const v = useVersion();
    if (!options?.voice || !Array.isArray(states))
      return states;
    const cached = voiceCache.get(states);
    if (cached?.version === v)
      return cached.out;
    const out = filterVoiceStates(states, relationships, options, mine);
    voiceCache.set(states, { version: v, out });
    return out;
  },
  start(ctx) {
    relationships = import_api2.findStore("RelationshipStore");
    referencedStore = import_api2.findStore("ReferencedMessageStore");
    voiceStore = import_api2.findStore("VoiceStateStore");
    channelStore = import_api2.findStore("ChannelStore");
    mediaEngine = import_api2.findStore("MediaEngineStore");
    dmSort = import_api2.findStore("PrivateChannelSortStore");
    selectedChannels = import_api2.findStore("SelectedChannelStore");
    rtcStore = import_api2.findStore("RTCConnectionStore");
    userStore = import_api2.findStore("UserStore");
    audioActions = import_api2.findByProps("setLocalVolume", "toggleLocalMute", "toggleSelfDeaf");
    const store = ctx.settings;
    mutedByUs = () => {
      const v = store.get("mutedByUs");
      return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
    };
    saveMuted = (ids) => store.set("mutedByUs", ids);
    options = { ...ctx.settings.all };
    let pending;
    const reconcile = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        joining = undefined;
        reconcileVoice();
        reconcileAudio();
        refreshDms();
      }, 0);
    };
    const droppedReactions = new Set;
    ctx.hook.instead(import_api2.Dispatcher, "dispatch", (call) => {
      const action = call.args[0];
      if (!options?.active || action == null || action[OWN])
        return call.callOriginal(...call.args);
      let next = action;
      try {
        if (options.voice && action.type === "VOICE_CHANNEL_SELECT") {
          joining = action.channelId ?? null;
          reconcileVoice();
          reconcile();
        } else if (options.voice && action.type === "VOICE_STATE_UPDATES" && Array.isArray(action.voiceStates)) {
          const me = userStore?.getCurrentUser?.()?.id;
          if (me != null && action.voiceStates.some((s) => s?.userId === me))
            reconcile();
        }
        next = filterAction(action, hidden, options, voiceHooks, droppedReactions);
      } catch (e) {
        ctx.logger.error("Filter failed for", action.type, e);
      }
      return next == null ? Promise.resolve() : call.callOriginal(next, ...call.args.slice(1));
    });
    ctx.waitFor(import_api2.filters.byProps("getBlockedUsersForVoiceChannel", "getIgnoredUsersForVoiceChannel"), (blockedVoice) => {
      const add = (is) => ({ args, result }) => {
        if (!options?.active || !options.voice || typeof args[0] !== "string" || hiddenVoice.size === 0)
          return;
        const out = withHiddenIn(result, args[0], hiddenVoice, is);
        return out === result ? undefined : out;
      };
      ctx.hook.after(blockedVoice, "getBlockedUsersForVoiceChannel", add((id) => relationships?.isBlocked?.(id) === true));
      ctx.hook.after(blockedVoice, "getIgnoredUsersForVoiceChannel", add((id) => relationships?.isIgnored?.(id) === true));
    });
    if (dmSort) {
      ctx.hook.after(dmSort, "getPrivateChannelIds", ({ result }) => {
        if (!options?.active || !options.dms || !Array.isArray(result))
          return;
        if (result === lastDmIn && version === lastDmVersion)
          return lastDmOut === result ? undefined : lastDmOut;
        try {
          const out = filterDmIds(result, (id) => {
            const ch = channelStore?.getChannel?.(id);
            return ch?.type === DM ? ch.getRecipientId?.() ?? ch.recipients?.[0] : undefined;
          }, hidden);
          lastDmIn = result;
          lastDmVersion = version;
          if (out === result) {
            lastDmOut = result;
            return;
          }
          if (lastDmOut?.length === out.length && out.every((id, i) => lastDmOut[i] === id))
            return lastDmOut;
          lastDmOut = out;
          return out;
        } catch (e) {
          ctx.logger.error("DM filter failed", e);
        }
      });
    }
    if (!relationships)
      ctx.logger.warn("RelationshipStore not found, only Discord's own blocked flags are used");
    const onRelationships = () => {
      if (options?.active)
        bump();
      reconcile();
    };
    const onReferenced = () => void (options?.active && options.replies && replies.changed() && bump());
    relationships?.addChangeListener?.(onRelationships);
    referencedStore?.addChangeListener?.(onReferenced);
    ctx.settings.onChange((values) => {
      options = { ...values };
      bump();
      reconcile();
    });
    ctx.command({
      name: "hideblocked",
      get description() {
        return t("command.description");
      },
      execute() {
        const next = !ctx.settings.get("active");
        ctx.settings.set("active", next);
        return { ephemeral: next ? t("command.on") : t("command.off") };
      }
    });
    ctx.onDispose(() => {
      clearTimeout(pending);
      const was = options;
      options = was && { ...was, active: false };
      reconcileVoice();
      reconcileAudio(true);
      refreshDms();
      hiddenVoice.clear();
      joining = undefined;
      lastDmIn = lastDmOut = undefined;
      lastDmVersion = -1;
      voiceStore = channelStore = mediaEngine = audioActions = dmSort = undefined;
      selectedChannels = rtcStore = userStore = undefined;
      saveMuted = undefined;
      relationships?.removeChangeListener?.(onRelationships);
      referencedStore?.removeChangeListener?.(onReferenced);
      options = undefined;
      relationships = undefined;
      referencedStore = undefined;
      replies.clear();
      bump();
    });
    bump();
    reconcile();
  }
});
