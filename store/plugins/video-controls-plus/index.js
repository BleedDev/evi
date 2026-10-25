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

// plugins/video-controls-plus/index.ts
var exports_video_controls_plus = {};
__export(exports_video_controls_plus, {
  default: () => video_controls_plus_default
});
module.exports = __toCommonJS(exports_video_controls_plus);
var import_api2 = require("@evi/api");

// plugins/video-controls-plus/controls.ts
var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
var MIN_SPEED = SPEEDS[0];
var MAX_SPEED = SPEEDS[SPEEDS.length - 1];
var DEFAULT_FPS = 30;
var MIN_FPS = 1;
var MAX_FPS = 240;
var COMMON_FPS = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240];
function clampSpeed(value) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0)
    return 1;
  return Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, n)) * 100) / 100;
}
function stepSpeed(current, direction) {
  const speed = clampSpeed(current);
  const eps = 0.000001;
  if (direction > 0)
    return SPEEDS.find((s) => s > speed + eps) ?? MAX_SPEED;
  for (let i = SPEEDS.length - 1;i >= 0; i--)
    if (SPEEDS[i] < speed - eps)
      return SPEEDS[i];
  return MIN_SPEED;
}
function formatSpeed(speed) {
  return `${Number(clampSpeed(speed).toFixed(2))}×`;
}
var KEY_ACTIONS = {
  " ": "togglePlay",
  k: "togglePlay",
  j: "seekBack",
  l: "seekForward",
  arrowleft: "seekBack",
  arrowright: "seekForward",
  m: "mute",
  f: "fullscreen",
  "[": "speedDown",
  "]": "speedUp",
  p: "pip",
  ",": "frameBack",
  ".": "frameForward"
};
function actionForKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)
    return null;
  if (!e.key)
    return null;
  return KEY_ACTIONS[e.key.toLowerCase()] ?? null;
}
function isArrowAction(e) {
  return e.key === "ArrowLeft" || e.key === "ArrowRight";
}
function clampFps(fps) {
  const n = typeof fps === "number" ? fps : NaN;
  if (!Number.isFinite(n) || n <= 0)
    return DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, n));
}
function frameDuration(fps) {
  return 1 / clampFps(fps);
}
function estimateFps(deltas) {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 1 / (MAX_FPS * 2) && d < 1).sort((a, b) => a - b);
  if (valid.length < 5)
    return;
  const mid = valid.length >> 1;
  const median = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  const raw = 1 / median;
  let snapped, best = 0.03;
  for (const f of COMMON_FPS) {
    const error = Math.abs(f - raw) / f;
    if (error < best)
      [snapped, best] = [f, error];
  }
  return clampFps(snapped ?? Math.round(raw));
}
function finiteDuration(duration) {
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : Infinity;
}
function seekTime(current, delta, duration) {
  const now = Number.isFinite(current) ? current : 0;
  return Math.min(finiteDuration(duration), Math.max(0, now + delta));
}
function frameStepTime(current, direction, fps, duration) {
  return seekTime(current, direction * frameDuration(fps), duration);
}
function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
function formatPosition(current, duration) {
  const d = finiteDuration(duration);
  return d === Infinity ? formatTime(current) : `${formatTime(current)} / ${formatTime(d)}`;
}
function clampSeekSeconds(value) {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n))
    return 5;
  return Math.min(60, Math.max(1, Math.round(n)));
}
function withShortcut(label, shortcut) {
  return shortcut ? `${label} (${shortcut})` : label;
}

// plugins/video-controls-plus/sticky.ts
var STICK_BELOW = 0.25;
var UNSTICK_AT = 0.6;
var STICKY_THRESHOLDS = [0, STICK_BELOW, UNSTICK_AT];
function nextSticky(sticky, ratio) {
  const r = Number.isFinite(ratio) ? ratio : 0;
  return sticky ? r < UNSTICK_AT : r < STICK_BELOW;
}
var MINI_WIDTH = 320;
var MINI_MAX_HEIGHT = 240;
var MINI_MIN_WIDTH = 160;
var MINI_MARGIN = 16;
function miniSize(width, height, areaWidth = Infinity) {
  const ratio = width > 0 && height > 0 && Number.isFinite(width / height) ? width / height : 16 / 9;
  const room = Number.isFinite(areaWidth) && areaWidth > 0 ? areaWidth - 2 * MINI_MARGIN : Infinity;
  let w = Math.max(MINI_MIN_WIDTH, Math.min(MINI_WIDTH, room));
  let h = w / ratio;
  if (h > MINI_MAX_HEIGHT) {
    h = MINI_MAX_HEIGHT;
    w = h * ratio;
  }
  return { width: Math.round(w), height: Math.round(h) };
}
function miniPosition(size, viewport, area) {
  const right = Math.min(viewport.width, area && area.width > 0 ? area.left + area.width : viewport.width);
  const bottom = Math.min(viewport.height, area && area.height > 0 ? area.top + area.height : viewport.height);
  const left = Math.max(0, right - MINI_MARGIN - size.width);
  const top = Math.max(0, bottom - MINI_MARGIN - size.height);
  return { left: Math.round(left), top: Math.round(top), width: size.width, height: size.height };
}
var isNone = (value) => !value || value === "none" || value === "normal" || value === "auto" || value === "visible";
function isIdentityTransform(transform) {
  if (isNone(transform))
    return true;
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!m)
    return false;
  const values = m[2].split(",").map(Number);
  const identity = m[1] ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : [1, 0, 0, 1, 0, 0];
  return values.length === identity.length && values.every((v, i) => Math.abs(v - identity[i]) < 0.000001);
}
function containingBlockLift(style) {
  const lift = [];
  let hard = false;
  if (!isNone(style.transform)) {
    if (isIdentityTransform(style.transform))
      lift.push("transform");
    else
      hard = true;
  }
  for (const value of [style.translate, style.rotate, style.scale, style.perspective, style.filter, style.backdropFilter, style.clipPath, style.maskImage]) {
    if (!isNone(value))
      hard = true;
  }
  if (!isNone(style.containerType))
    hard = true;
  if (/\b(layout|paint|strict|content)\b/.test(style.contain ?? ""))
    lift.push("contain");
  if (style.contentVisibility === "auto" || style.contentVisibility === "hidden")
    lift.push("content-visibility");
  if (/\b(transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain)\b/.test(style.willChange ?? ""))
    lift.push("will-change");
  return { lift, hard };
}
function stoppedEmbedUrl(src) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  for (const [key, value] of [...url.searchParams]) {
    const name = key.toLowerCase();
    if (name !== "autoplay" && name !== "auto_play")
      continue;
    if (value === "1")
      url.searchParams.set(key, "0");
    else if (value.toLowerCase() === "true")
      url.searchParams.set(key, "false");
  }
  return url.toString();
}
var HOVER_DELAY_MS = 300;
function canHoverPlay(s) {
  return s.paused && !s.played && !s.reducedMotion && !s.fullscreen && !(s.currentTime > 0.05);
}

// plugins/video-controls-plus/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.rememberSpeed": "Remember playback speed",
    "settings.rememberSpeed.description": "Videos start at the speed you last picked, instead of 1x.",
    "settings.showStrip": "Show the control strip",
    "settings.showStrip.description": "Speed, loop, frame step and picture-in-picture buttons at the top right of a video you hover.",
    "settings.stickyVideo": "Sticky video",
    "settings.stickyVideo.description": "A video you're playing in chat follows you to a corner when you scroll away from it, and goes back when you scroll back. YouTube and other embeds too.",
    "settings.hoverPlay": "Play videos on hover",
    "settings.hoverPlay.description": "Videos in chat play muted while you hover them, so you can see what they are without clicking. Off while Discord's Reduced Motion is on.",
    "settings.shortcuts": "Keyboard shortcuts",
    "settings.shortcuts.description": "While hovering a video: Space/K play, J/L and arrow keys seek, M mute, F fullscreen, [ ] speed, P picture-in-picture, , and . step one frame.",
    "settings.seekSeconds": "Seek step (seconds)",
    "settings.seekSeconds.description": "How far J, L and the arrow keys jump.",
    "flash.muted": "Muted",
    "flash.unmuted": "Unmuted",
    "flash.loopOn": "Loop on",
    "flash.loopOff": "Loop off",
    "flash.pipUnavailable": "Picture-in-picture isn't available",
    "flash.playFirst": "Play the video first",
    "flash.pipFailed": "Couldn't open picture-in-picture",
    "flash.nextFrame": "Next frame · {position}",
    "flash.previousFrame": "Previous frame · {position}",
    "label.controls": "Video controls",
    "label.speed": "Playback speed ([ and ])",
    "label.speedMenu": "Playback speed",
    "label.loop": "Loop",
    "label.loopOn": "Loop: on",
    "label.loopOff": "Loop: off",
    "label.pip": "Picture-in-picture",
    "label.previousFrame": "Previous frame",
    "label.nextFrame": "Next frame",
    "label.stickyPlayer": "Video player",
    "label.backToMessage": "Back to the message",
    "label.closePlayer": "Close player"
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.rememberSpeed": "Wiedergabegeschwindigkeit merken",
      "settings.rememberSpeed.description": "Videos starten mit der zuletzt gewählten Geschwindigkeit statt mit 1x.",
      "settings.showStrip": "Steuerleiste anzeigen",
      "settings.showStrip.description": "Schaltflächen für Geschwindigkeit, Wiederholen, Einzelbild und Bild-in-Bild oben rechts an einem Video, über dem du schwebst.",
      "settings.stickyVideo": "Mitlaufendes Video",
      "settings.stickyVideo.description": "Ein Video, das du im Chat abspielst, folgt dir in eine Ecke, wenn du davon wegscrollst, und kehrt an seinen Platz zurück, wenn du zurückscrollst. Auch bei YouTube und anderen Einbettungen.",
      "settings.hoverPlay": "Videos beim Darüberfahren abspielen",
      "settings.hoverPlay.description": "Videos im Chat spielen stumm, solange du mit der Maus darüber bist, damit du ohne Klick siehst, was sie zeigen. Aus, solange in Discord reduzierte Bewegung an ist.",
      "settings.shortcuts": "Tastenkürzel",
      "settings.shortcuts.description": "Beim Darüberfahren mit der Maus: Leertaste/K Wiedergabe, J/L und Pfeiltasten Spulen, M Stummschalten, F Vollbild, [ ] Geschwindigkeit, P Bild-in-Bild, , und . ein Einzelbild weiter.",
      "settings.seekSeconds": "Spulschritt (Sekunden)",
      "settings.seekSeconds.description": "Wie weit J, L und die Pfeiltasten springen.",
      "flash.muted": "Stummgeschaltet",
      "flash.unmuted": "Ton an",
      "flash.loopOn": "Wiederholen an",
      "flash.loopOff": "Wiederholen aus",
      "flash.pipUnavailable": "Bild-in-Bild ist nicht verfügbar",
      "flash.playFirst": "Starte zuerst das Video",
      "flash.pipFailed": "Bild-in-Bild konnte nicht geöffnet werden",
      "flash.nextFrame": "Nächstes Bild · {position}",
      "flash.previousFrame": "Vorheriges Bild · {position}",
      "label.controls": "Videosteuerung",
      "label.speed": "Wiedergabegeschwindigkeit ([ und ])",
      "label.speedMenu": "Wiedergabegeschwindigkeit",
      "label.loop": "Wiederholen",
      "label.loopOn": "Wiederholen: an",
      "label.loopOff": "Wiederholen: aus",
      "label.pip": "Bild-in-Bild",
      "label.previousFrame": "Vorheriges Bild",
      "label.nextFrame": "Nächstes Bild",
      "label.stickyPlayer": "Videoplayer",
      "label.backToMessage": "Zurück zur Nachricht",
      "label.closePlayer": "Player schließen"
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.rememberSpeed": "Recordar la velocidad de reproducción",
      "settings.rememberSpeed.description": "Los vídeos empiezan a la última velocidad que elegiste, en lugar de a 1x.",
      "settings.showStrip": "Mostrar la barra de controles",
      "settings.showStrip.description": "Botones de velocidad, repetición, avance por fotogramas e imagen en imagen en la esquina superior derecha de un vídeo al pasar el ratón.",
      "settings.stickyVideo": "Vídeo fijo",
      "settings.stickyVideo.description": "Un vídeo que reproduces en el chat te sigue a una esquina cuando te desplazas lejos de él, y vuelve a su sitio cuando regresas. También YouTube y otros vídeos insertados.",
      "settings.hoverPlay": "Reproducir vídeos al pasar el ratón",
      "settings.hoverPlay.description": "Los vídeos del chat se reproducen sin sonido mientras pasas el ratón por encima, para ver qué son sin hacer clic. Desactivado mientras Discord tenga activado el movimiento reducido.",
      "settings.shortcuts": "Atajos de teclado",
      "settings.shortcuts.description": "Al pasar el ratón por un vídeo: Espacio/K reproducir, J/L y flechas para avanzar o retroceder, M silenciar, F pantalla completa, [ ] velocidad, P imagen en imagen, , y . avanzar un fotograma.",
      "settings.seekSeconds": "Salto al avanzar o retroceder (segundos)",
      "settings.seekSeconds.description": "Cuánto saltan J, L y las flechas.",
      "flash.muted": "Silenciado",
      "flash.unmuted": "Sonido activado",
      "flash.loopOn": "Repetición activada",
      "flash.loopOff": "Repetición desactivada",
      "flash.pipUnavailable": "La imagen en imagen no está disponible",
      "flash.playFirst": "Reproduce primero el vídeo",
      "flash.pipFailed": "No se pudo abrir la imagen en imagen",
      "flash.nextFrame": "Fotograma siguiente · {position}",
      "flash.previousFrame": "Fotograma anterior · {position}",
      "label.controls": "Controles del vídeo",
      "label.speed": "Velocidad de reproducción ([ y ])",
      "label.speedMenu": "Velocidad de reproducción",
      "label.loop": "Repetir",
      "label.loopOn": "Repetir: activado",
      "label.loopOff": "Repetir: desactivado",
      "label.pip": "Imagen en imagen",
      "label.previousFrame": "Fotograma anterior",
      "label.nextFrame": "Fotograma siguiente",
      "label.stickyPlayer": "Reproductor de vídeo",
      "label.backToMessage": "Volver al mensaje",
      "label.closePlayer": "Cerrar el reproductor"
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.rememberSpeed": "Mémoriser la vitesse de lecture",
      "settings.rememberSpeed.description": "Les vidéos démarrent à la dernière vitesse choisie, au lieu de 1x.",
      "settings.showStrip": "Afficher la barre de contrôle",
      "settings.showStrip.description": "Boutons de vitesse, de lecture en boucle, d'avance image par image et d'image dans l'image en haut à droite d'une vidéo survolée.",
      "settings.stickyVideo": "Vidéo épinglée",
      "settings.stickyVideo.description": "Une vidéo que vous lisez dans le chat vous suit dans un coin quand vous faites défiler loin d'elle, et reprend sa place quand vous revenez. Aussi pour YouTube et les autres intégrations.",
      "settings.hoverPlay": "Lire les vidéos au survol",
      "settings.hoverPlay.description": "Les vidéos du chat se lisent sans le son pendant que vous les survolez, pour voir ce qu'elles montrent sans cliquer. Désactivé tant que les animations réduites sont activées dans Discord.",
      "settings.shortcuts": "Raccourcis clavier",
      "settings.shortcuts.description": "Au survol d'une vidéo : Espace/K lecture, J/L et flèches pour avancer ou reculer, M muet, F plein écran, [ ] vitesse, P image dans l'image, , et . avancer d'une image.",
      "settings.seekSeconds": "Pas de déplacement (secondes)",
      "settings.seekSeconds.description": "De combien J, L et les flèches font sauter la lecture.",
      "flash.muted": "Son coupé",
      "flash.unmuted": "Son activé",
      "flash.loopOn": "Boucle activée",
      "flash.loopOff": "Boucle désactivée",
      "flash.pipUnavailable": "L'image dans l'image n'est pas disponible",
      "flash.playFirst": "Lancez d'abord la vidéo",
      "flash.pipFailed": "Impossible d'ouvrir l'image dans l'image",
      "flash.nextFrame": "Image suivante · {position}",
      "flash.previousFrame": "Image précédente · {position}",
      "label.controls": "Commandes de la vidéo",
      "label.speed": "Vitesse de lecture ([ et ])",
      "label.speedMenu": "Vitesse de lecture",
      "label.loop": "Boucle",
      "label.loopOn": "Boucle : activée",
      "label.loopOff": "Boucle : désactivée",
      "label.pip": "Image dans l'image",
      "label.previousFrame": "Image précédente",
      "label.nextFrame": "Image suivante",
      "label.stickyPlayer": "Lecteur vidéo",
      "label.backToMessage": "Revenir au message",
      "label.closePlayer": "Fermer le lecteur"
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.rememberSpeed": "再生速度を記憶",
      "settings.rememberSpeed.description": "動画を1xではなく、前回選んだ速度で再生し始めます。",
      "settings.showStrip": "コントロールバーを表示",
      "settings.showStrip.description": "カーソルを合わせた動画の右上に、速度、ループ、コマ送り、ピクチャーインピクチャーのボタンを表示します。",
      "settings.stickyVideo": "動画を追従表示",
      "settings.stickyVideo.description": "チャットで再生中の動画からスクロールして離れると、動画が画面の隅に小さく表示されてついてきます。スクロールして戻ると元の場所に戻ります。YouTubeなどの埋め込みにも対応します。",
      "settings.hoverPlay": "カーソルを合わせて動画を再生",
      "settings.hoverPlay.description": "チャット内の動画にカーソルを合わせている間、ミュートで再生されるので、クリックしなくても内容がわかります。Discordで動きを減らす設定がオンのときは無効です。",
      "settings.shortcuts": "キーボードショートカット",
      "settings.shortcuts.description": "動画にカーソルを合わせているとき: Space/K で再生、J/L と矢印キーでシーク、M でミュート、F で全画面、[ ] で速度、P でピクチャーインピクチャー、, と . で1コマ送り。",
      "settings.seekSeconds": "シークの間隔(秒)",
      "settings.seekSeconds.description": "J、L、矢印キーで移動する秒数です。",
      "flash.muted": "ミュート中",
      "flash.unmuted": "ミュート解除",
      "flash.loopOn": "ループ オン",
      "flash.loopOff": "ループ オフ",
      "flash.pipUnavailable": "ピクチャーインピクチャーは利用できません",
      "flash.playFirst": "先に動画を再生してください",
      "flash.pipFailed": "ピクチャーインピクチャーを開けませんでした",
      "flash.nextFrame": "次のコマ · {position}",
      "flash.previousFrame": "前のコマ · {position}",
      "label.controls": "動画コントロール",
      "label.speed": "再生速度([ と ])",
      "label.speedMenu": "再生速度",
      "label.loop": "ループ",
      "label.loopOn": "ループ: オン",
      "label.loopOff": "ループ: オフ",
      "label.pip": "ピクチャーインピクチャー",
      "label.previousFrame": "前のコマ",
      "label.nextFrame": "次のコマ",
      "label.stickyPlayer": "動画プレーヤー",
      "label.backToMessage": "メッセージに戻る",
      "label.closePlayer": "プレーヤーを閉じる"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.rememberSpeed": "Zapamiętaj prędkość odtwarzania",
      "settings.rememberSpeed.description": "Filmy zaczynają się z ostatnio wybraną prędkością zamiast 1x.",
      "settings.showStrip": "Pokaż pasek sterowania",
      "settings.showStrip.description": "Przyciski prędkości, zapętlenia, przechodzenia klatka po klatce i obrazu w obrazie w prawym górnym rogu filmu, nad którym jest kursor.",
      "settings.stickyVideo": "Przyklejony film",
      "settings.stickyVideo.description": "Film odtwarzany na czacie podąża za tobą do rogu, gdy przewiniesz od niego, i wraca na miejsce, gdy przewiniesz z powrotem. Działa też z YouTube i innymi osadzonymi filmami.",
      "settings.hoverPlay": "Odtwarzaj filmy po najechaniu",
      "settings.hoverPlay.description": "Filmy na czacie odtwarzają się bez dźwięku, gdy kursor jest nad nimi, więc widać, co to jest, bez klikania. Wyłączone, gdy w Discordzie włączone jest ograniczenie ruchu.",
      "settings.shortcuts": "Skróty klawiszowe",
      "settings.shortcuts.description": "Gdy kursor jest nad filmem: Spacja/K odtwarzanie, J/L i strzałki przewijanie, M wyciszenie, F pełny ekran, [ ] prędkość, P obraz w obrazie, , i . jedna klatka do przodu lub do tyłu.",
      "settings.seekSeconds": "Krok przewijania (sekundy)",
      "settings.seekSeconds.description": "O ile przeskakują J, L i strzałki.",
      "flash.muted": "Wyciszono",
      "flash.unmuted": "Włączono dźwięk",
      "flash.loopOn": "Zapętlenie włączone",
      "flash.loopOff": "Zapętlenie wyłączone",
      "flash.pipUnavailable": "Obraz w obrazie jest niedostępny",
      "flash.playFirst": "Najpierw odtwórz film",
      "flash.pipFailed": "Nie udało się otworzyć obrazu w obrazie",
      "flash.nextFrame": "Następna klatka · {position}",
      "flash.previousFrame": "Poprzednia klatka · {position}",
      "label.controls": "Sterowanie filmem",
      "label.speed": "Prędkość odtwarzania ([ i ])",
      "label.speedMenu": "Prędkość odtwarzania",
      "label.loop": "Zapętlenie",
      "label.loopOn": "Zapętlenie: włączone",
      "label.loopOff": "Zapętlenie: wyłączone",
      "label.pip": "Obraz w obrazie",
      "label.previousFrame": "Poprzednia klatka",
      "label.nextFrame": "Następna klatka",
      "label.stickyPlayer": "Odtwarzacz wideo",
      "label.backToMessage": "Wróć do wiadomości",
      "label.closePlayer": "Zamknij odtwarzacz"
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.rememberSpeed": "Lembrar a velocidade de reprodução",
      "settings.rememberSpeed.description": "Os vídeos começam na última velocidade escolhida, em vez de 1x.",
      "settings.showStrip": "Mostrar a barra de controles",
      "settings.showStrip.description": "Botões de velocidade, repetição, avanço quadro a quadro e picture-in-picture no canto superior direito do vídeo sobre o qual você passa o mouse.",
      "settings.stickyVideo": "Vídeo fixo",
      "settings.stickyVideo.description": "Um vídeo que você está reproduzindo no chat te acompanha num canto quando você rola para longe dele, e volta ao lugar quando você rola de volta. Também para YouTube e outros vídeos incorporados.",
      "settings.hoverPlay": "Reproduzir vídeos ao passar o mouse",
      "settings.hoverPlay.description": "Os vídeos do chat são reproduzidos sem som enquanto você passa o mouse sobre eles, para ver o que são sem clicar. Desligado enquanto o movimento reduzido do Discord estiver ativado.",
      "settings.shortcuts": "Atalhos de teclado",
      "settings.shortcuts.description": "Com o mouse sobre um vídeo: Espaço/K reproduz, J/L e setas avançam ou voltam, M silencia, F tela cheia, [ ] velocidade, P picture-in-picture, , e . avançam um quadro.",
      "settings.seekSeconds": "Salto ao avançar ou voltar (segundos)",
      "settings.seekSeconds.description": "Quanto J, L e as setas pulam.",
      "flash.muted": "Silenciado",
      "flash.unmuted": "Som ativado",
      "flash.loopOn": "Repetição ligada",
      "flash.loopOff": "Repetição desligada",
      "flash.pipUnavailable": "Picture-in-picture não está disponível",
      "flash.playFirst": "Reproduza o vídeo primeiro",
      "flash.pipFailed": "Não foi possível abrir o picture-in-picture",
      "flash.nextFrame": "Próximo quadro · {position}",
      "flash.previousFrame": "Quadro anterior · {position}",
      "label.controls": "Controles do vídeo",
      "label.speed": "Velocidade de reprodução ([ e ])",
      "label.speedMenu": "Velocidade de reprodução",
      "label.loop": "Repetir",
      "label.loopOn": "Repetir: ligado",
      "label.loopOff": "Repetir: desligado",
      "label.pip": "Picture-in-picture",
      "label.previousFrame": "Quadro anterior",
      "label.nextFrame": "Próximo quadro",
      "label.stickyPlayer": "Player de vídeo",
      "label.backToMessage": "Voltar para a mensagem",
      "label.closePlayer": "Fechar o player"
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.rememberSpeed": "Запоминать скорость воспроизведения",
      "settings.rememberSpeed.description": "Видео начинаются с последней выбранной скорости, а не с 1x.",
      "settings.showStrip": "Показывать панель управления",
      "settings.showStrip.description": "Кнопки скорости, повтора, покадрового просмотра и «картинка в картинке» в правом верхнем углу видео, на которое наведён курсор.",
      "settings.stickyVideo": "Закреплённое видео",
      "settings.stickyVideo.description": "Видео, которое вы смотрите в чате, следует за вами в угол, когда вы прокручиваете чат дальше, и возвращается на место, когда вы прокручиваете обратно. Работает и с YouTube, и с другими встроенными видео.",
      "settings.hoverPlay": "Воспроизводить видео при наведении",
      "settings.hoverPlay.description": "Видео в чате воспроизводятся без звука, пока на них наведён курсор, чтобы понять, что это, не нажимая. Отключено, пока в Discord включено уменьшение движения.",
      "settings.shortcuts": "Горячие клавиши",
      "settings.shortcuts.description": "При наведении на видео: пробел/K — воспроизведение, J/L и стрелки — перемотка, M — без звука, F — полный экран, [ ] — скорость, P — «картинка в картинке», , и . — на один кадр.",
      "settings.seekSeconds": "Шаг перемотки (секунды)",
      "settings.seekSeconds.description": "На сколько перематывают J, L и стрелки.",
      "flash.muted": "Звук выключен",
      "flash.unmuted": "Звук включён",
      "flash.loopOn": "Повтор включён",
      "flash.loopOff": "Повтор выключен",
      "flash.pipUnavailable": "«Картинка в картинке» недоступна",
      "flash.playFirst": "Сначала запустите видео",
      "flash.pipFailed": "Не удалось открыть «картинку в картинке»",
      "flash.nextFrame": "Следующий кадр · {position}",
      "flash.previousFrame": "Предыдущий кадр · {position}",
      "label.controls": "Управление видео",
      "label.speed": "Скорость воспроизведения ([ и ])",
      "label.speedMenu": "Скорость воспроизведения",
      "label.loop": "Повтор",
      "label.loopOn": "Повтор: включён",
      "label.loopOff": "Повтор: выключен",
      "label.pip": "Картинка в картинке",
      "label.previousFrame": "Предыдущий кадр",
      "label.nextFrame": "Следующий кадр",
      "label.stickyPlayer": "Видеоплеер",
      "label.backToMessage": "Вернуться к сообщению",
      "label.closePlayer": "Закрыть плеер"
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.rememberSpeed": "Oynatma hızını hatırla",
      "settings.rememberSpeed.description": "Videolar 1x yerine en son seçtiğin hızda başlar.",
      "settings.showStrip": "Denetim çubuğunu göster",
      "settings.showStrip.description": "Üzerine geldiğin videonun sağ üst köşesinde hız, döngü, kare kare ilerleme ve pencere içinde pencere düğmeleri.",
      "settings.stickyVideo": "Yapışkan video",
      "settings.stickyVideo.description": "Sohbette oynattığın bir video, ondan uzağa kaydırdığında seni bir köşede takip eder ve geri kaydırdığında yerine döner. YouTube ve diğer gömülü videolarda da çalışır.",
      "settings.hoverPlay": "Üzerine gelince videoları oynat",
      "settings.hoverPlay.description": "Sohbetteki videolar üzerlerine geldiğinde sessiz oynar, böylece tıklamadan ne olduklarını görürsün. Discord'da hareketi azaltma açıkken kapalıdır.",
      "settings.shortcuts": "Klavye kısayolları",
      "settings.shortcuts.description": "Bir videonun üzerindeyken: Boşluk/K oynat, J/L ve ok tuşları ileri geri sar, M sessize al, F tam ekran, [ ] hız, P pencere içinde pencere, , ve . bir kare ilerle.",
      "settings.seekSeconds": "Sarma adımı (saniye)",
      "settings.seekSeconds.description": "J, L ve ok tuşlarının ne kadar atlayacağı.",
      "flash.muted": "Sessize alındı",
      "flash.unmuted": "Ses açıldı",
      "flash.loopOn": "Döngü açık",
      "flash.loopOff": "Döngü kapalı",
      "flash.pipUnavailable": "Pencere içinde pencere kullanılamıyor",
      "flash.playFirst": "Önce videoyu oynat",
      "flash.pipFailed": "Pencere içinde pencere açılamadı",
      "flash.nextFrame": "Sonraki kare · {position}",
      "flash.previousFrame": "Önceki kare · {position}",
      "label.controls": "Video denetimleri",
      "label.speed": "Oynatma hızı ([ ve ])",
      "label.speedMenu": "Oynatma hızı",
      "label.loop": "Döngü",
      "label.loopOn": "Döngü: açık",
      "label.loopOff": "Döngü: kapalı",
      "label.pip": "Pencere içinde pencere",
      "label.previousFrame": "Önceki kare",
      "label.nextFrame": "Sonraki kare",
      "label.stickyPlayer": "Video oynatıcı",
      "label.backToMessage": "Mesaja dön",
      "label.closePlayer": "Oynatıcıyı kapat"
    } })["tr"];
  }
});

// plugins/video-controls-plus/index.ts
var settings = {
  rememberSpeed: {
    type: "boolean",
    get label() {
      return t("settings.rememberSpeed");
    },
    get description() {
      return t("settings.rememberSpeed.description");
    },
    default: true
  },
  showStrip: {
    type: "boolean",
    get label() {
      return t("settings.showStrip");
    },
    get description() {
      return t("settings.showStrip.description");
    },
    default: true
  },
  stickyVideo: {
    type: "boolean",
    get label() {
      return t("settings.stickyVideo");
    },
    get description() {
      return t("settings.stickyVideo.description");
    },
    default: true
  },
  hoverPlay: {
    type: "boolean",
    get label() {
      return t("settings.hoverPlay");
    },
    get description() {
      return t("settings.hoverPlay.description");
    },
    default: true
  },
  shortcuts: {
    type: "boolean",
    get label() {
      return t("settings.shortcuts");
    },
    get description() {
      return t("settings.shortcuts.description");
    },
    default: true
  },
  seekSeconds: {
    type: "number",
    get label() {
      return t("settings.seekSeconds");
    },
    get description() {
      return t("settings.seekSeconds.description");
    },
    default: 5,
    min: 1,
    max: 60,
    step: 1
  }
};
var PLAYER = '[data-testid="discord-web-video-player-container"]';
var PLAYER_BUTTON = (name) => `[data-testid="discord-web-video-player-${name}-btn"]`;
var MESSAGE_SCOPE = '[id^="chat-messages-"], [id^="message-accessories-"]';
var MESSAGE_ACCESSORIES = '[id^="message-accessories-"]';
var DIALOG = '[role="dialog"]';
var EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]';
var LAST_SPEED_KEY = "lastSpeed";
var IDLE_MS = 2500;
var FLASH_MS = 900;
var MIN_STRIP_WIDTH = 180;
var ctx;
var events;
var attached = new WeakSet;
var sped = new WeakSet;
var touched = new Map;
var fps = new WeakMap;
var scrollers = new WeakMap;
var hovered = null;
var current = null;
var idle = false;
var idleTimer;
var flashTimer;
var flashing = false;
var menuOpen = false;
var frame = 0;
var storage = () => ctx?.settings;
function touch(video, change) {
  for (const v of touched.keys())
    if (!v.isConnected)
      touched.delete(v);
  touched.set(video, { ...touched.get(video), ...change });
}
function isEligible(video) {
  if (!video.isConnected || video.srcObject || video.classList.contains("media-engine-video"))
    return false;
  if (!(video.currentSrc || video.src || video.querySelector("source")))
    return false;
  if (video.closest(PLAYER))
    return true;
  if (!video.closest(MESSAGE_SCOPE))
    return false;
  return attached.has(video) || !(video.autoplay && video.loop);
}
function videoFor(target) {
  if (!(target instanceof Element))
    return null;
  if (root?.contains(target))
    return current;
  if (target instanceof HTMLVideoElement)
    return isEligible(target) ? target : null;
  const video = target.closest(PLAYER)?.querySelector("video");
  return video && isEligible(video) ? video : null;
}
var playerOf = (video) => video.closest(PLAYER);
var playerButton = (video, name) => playerOf(video)?.querySelector(PLAYER_BUTTON(name)) ?? null;
function rememberedSpeed() {
  return clampSpeed(storage()?.get(LAST_SPEED_KEY) ?? 1);
}
function setSpeed(video, speed) {
  const s = clampSpeed(speed);
  video.defaultPlaybackRate = s;
  video.playbackRate = s;
  touch(video, { rate: true });
}
function applyRememberedSpeed(video) {
  if (sped.has(video))
    return;
  sped.add(video);
  if (!ctx?.settings.get("rememberSpeed"))
    return;
  const speed = rememberedSpeed();
  if (speed !== 1 && video.playbackRate === 1)
    setSpeed(video, speed);
}
function sampleFps(video) {
  if (fps.has(video) || typeof video.requestVideoFrameCallback !== "function")
    return;
  const signal = events?.signal;
  const deltas = [];
  let last;
  const onFrame = (_now, meta) => {
    if (signal?.aborted || fps.has(video))
      return;
    if (video.playbackRate <= 1 && last !== undefined)
      deltas.push(meta.mediaTime - last);
    last = meta.mediaTime;
    if (deltas.length >= 24) {
      const estimate = estimateFps(deltas);
      if (estimate)
        return void fps.set(video, estimate);
    }
    if (deltas.length < 120 && !video.paused)
      video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}
function attach(video) {
  if (attached.has(video) || !events)
    return;
  attached.add(video);
  const { signal } = events;
  video.addEventListener("ratechange", () => {
    if (ctx?.settings.get("rememberSpeed")) {
      const speed = clampSpeed(video.playbackRate);
      if (speed !== rememberedSpeed())
        storage()?.set(LAST_SPEED_KEY, speed);
    }
    if (video === current)
      sync();
  }, { signal });
  for (const type of ["play", "pause", "enterpictureinpicture", "leavepictureinpicture"]) {
    video.addEventListener(type, () => {
      if (type === "play")
        sampleFps(video);
      if (video === current) {
        sync();
        if (type === "pause")
          setIdle(false);
        else
          armIdle();
      }
    }, { signal });
  }
  if (!video.paused)
    sampleFps(video);
}
function togglePlay(video) {
  const button = playerButton(video, "play-pause");
  if (button)
    return button.click();
  if (playerOf(video))
    return video.click();
  if (video.paused)
    video.play().catch(() => {});
  else
    video.pause();
}
function pause(video) {
  if (video.paused)
    return;
  const button = playerButton(video, "play-pause");
  if (button)
    button.click();
  if (!video.paused)
    video.pause();
}
function toggleMute(video) {
  const button = playerButton(video, "volume");
  if (button)
    button.click();
  else
    video.muted = !video.muted;
  flash(t(video.muted || video.volume === 0 ? "flash.muted" : "flash.unmuted"));
}
function toggleFullscreen(video) {
  const button = playerButton(video, "fullscreen");
  if (button)
    return button.click();
  if (document.fullscreenElement)
    document.exitFullscreen().catch(() => {});
  else
    (playerOf(video) ?? video).requestFullscreen().catch(() => {});
}
function toggleLoop(video) {
  video.loop = !video.loop;
  touch(video, { loop: true });
  flash(t(video.loop ? "flash.loopOn" : "flash.loopOff"));
  sync();
}
async function togglePip(video) {
  if (!document.pictureInPictureEnabled)
    return flash(t("flash.pipUnavailable"));
  try {
    if (document.pictureInPictureElement === video)
      return void await document.exitPictureInPicture();
    if (video.readyState < HTMLMediaElement.HAVE_METADATA)
      return flash(t("flash.playFirst"));
    if (video.disablePictureInPicture) {
      video.disablePictureInPicture = false;
      touch(video, { pip: true });
    }
    await video.requestPictureInPicture();
  } catch (err) {
    ctx?.logger.warn("Picture-in-picture failed", err);
    flash(t("flash.pipFailed"));
  }
}
function seek(video, delta) {
  video.currentTime = seekTime(video.currentTime, delta, video.duration);
  flash(formatPosition(video.currentTime, video.duration));
}
function stepFrame(video, direction) {
  pause(video);
  video.currentTime = frameStepTime(video.currentTime, direction, fps.get(video), video.duration);
  flash(t(direction > 0 ? "flash.nextFrame" : "flash.previousFrame", { position: formatPosition(video.currentTime, video.duration) }));
}
function changeSpeed(video, speed) {
  setSpeed(video, speed);
  flash(formatSpeed(video.playbackRate));
  sync();
}
function perform(action, video) {
  const step = clampSeekSeconds(ctx?.settings.get("seekSeconds"));
  switch (action) {
    case "togglePlay":
      return togglePlay(video);
    case "seekBack":
      return seek(video, -step);
    case "seekForward":
      return seek(video, step);
    case "mute":
      return toggleMute(video);
    case "fullscreen":
      return toggleFullscreen(video);
    case "speedDown":
      return changeSpeed(video, stepSpeed(video.playbackRate, -1));
    case "speedUp":
      return changeSpeed(video, stepSpeed(video.playbackRate, 1));
    case "pip":
      return void togglePip(video);
    case "frameBack":
      return stepFrame(video, -1);
    case "frameForward":
      return stepFrame(video, 1);
  }
}
var NO_REPEAT = new Set(["togglePlay", "mute", "fullscreen", "pip"]);
var root;
var strip;
var menu;
var flashEl;
var speedButton;
var loopButton;
var pipButton;
var svg = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
var ICONS = {
  frameBack: "M18 6l-7 6 7 6M7 6v12",
  frameForward: "M6 6l7 6-7 6M17 6v12",
  loop: "M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4",
  pip: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM12 12h6v5h-6z"
};
function button(act, label, content) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "evi-vcp-btn";
  el.dataset.act = act;
  el.title = label;
  el.setAttribute("aria-label", label);
  el.innerHTML = content;
  return el;
}
function buildOverlay() {
  root = document.createElement("div");
  root.className = "evi-vcp";
  root.dataset.visible = "false";
  strip = document.createElement("div");
  strip.className = "evi-vcp-strip";
  strip.setAttribute("role", "toolbar");
  speedButton = button("speed", "", "1×");
  speedButton.classList.add("evi-vcp-speed");
  speedButton.setAttribute("aria-haspopup", "menu");
  speedButton.setAttribute("aria-expanded", "false");
  loopButton = button("loop", "", svg(ICONS.loop));
  loopButton.setAttribute("aria-pressed", "false");
  pipButton = button("pip", "", svg(ICONS.pip));
  pipButton.hidden = !document.pictureInPictureEnabled;
  const sep = document.createElement("span");
  sep.className = "evi-vcp-sep";
  strip.append(button("frameBack", "", svg(ICONS.frameBack)), speedButton, button("frameForward", "", svg(ICONS.frameForward)), sep, loopButton, pipButton);
  menu = document.createElement("div");
  menu.className = "evi-vcp-menu evi-popout";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  for (const speed of SPEEDS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "evi-vcp-item";
    item.setAttribute("role", "menuitemradio");
    item.dataset.speed = String(speed);
    item.textContent = formatSpeed(speed);
    menu.append(item);
  }
  flashEl = document.createElement("div");
  flashEl.className = "evi-vcp-flash";
  flashEl.setAttribute("role", "status");
  flashEl.setAttribute("aria-live", "polite");
  root.append(strip, menu, flashEl);
  root.addEventListener("click", onOverlayClick);
  root.addEventListener("keydown", onOverlayKey);
  labelOverlay();
  document.body.append(root);
}
function onOverlayClick(e) {
  const video = current;
  const target = e.target instanceof Element ? e.target : null;
  if (!video || !target)
    return;
  const item = target.closest(".evi-vcp-item");
  if (item) {
    changeSpeed(video, Number(item.dataset.speed));
    setMenu(false, true);
    return;
  }
  switch (target.closest(".evi-vcp-btn")?.dataset.act) {
    case "speed":
      return setMenu(!menuOpen, false);
    case "loop":
      return toggleLoop(video);
    case "pip":
      return void togglePip(video);
    case "frameBack":
      return stepFrame(video, -1);
    case "frameForward":
      return stepFrame(video, 1);
  }
}
function onOverlayKey(e) {
  if (!menuOpen || !menu)
    return;
  const items = [...menu.querySelectorAll(".evi-vcp-item")];
  const index = items.indexOf(document.activeElement);
  const move = (to) => items[(to + items.length) % items.length]?.focus();
  switch (e.key) {
    case "Escape":
      setMenu(false, true);
      break;
    case "ArrowRight":
    case "ArrowDown":
      move(index + 1);
      break;
    case "ArrowLeft":
    case "ArrowUp":
      move(index - 1);
      break;
    case "Home":
      move(0);
      break;
    case "End":
      move(items.length - 1);
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
}
function setMenu(open, refocus) {
  if (!menu || !speedButton)
    return;
  menuOpen = open;
  if (open) {
    menu.removeAttribute("data-closing");
    menu.hidden = false;
  } else if (!menu.hidden) {
    const el = menu;
    el.setAttribute("data-closing", "");
    import_api2.exitDone(el).then(() => {
      if (menuOpen || !el.hasAttribute("data-closing"))
        return;
      el.removeAttribute("data-closing");
      el.hidden = true;
    });
  }
  speedButton.setAttribute("aria-expanded", String(open));
  if (open) {
    sync();
    setIdle(false);
    const active = menu.querySelector('[aria-checked="true"]') ?? menu.querySelector(".evi-vcp-item");
    active?.focus({ preventScroll: true });
  } else if (refocus) {
    speedButton.focus({ preventScroll: true });
  }
  update();
}
function labelOverlay() {
  if (!strip || !menu)
    return;
  const name = (el, label) => {
    if (!el)
      return;
    el.title = label;
    el.setAttribute("aria-label", label);
  };
  strip.setAttribute("aria-label", t("label.controls"));
  menu.setAttribute("aria-label", t("label.speedMenu"));
  name(speedButton, t("label.speed"));
  name(pipButton, withShortcut(t("label.pip"), "P"));
  name(strip.querySelector('[data-act="frameBack"]'), withShortcut(t("label.previousFrame"), ","));
  name(strip.querySelector('[data-act="frameForward"]'), withShortcut(t("label.nextFrame"), "."));
  name(loopButton, t("label.loop"));
}
function sync() {
  const video = current;
  if (!video || !speedButton || !loopButton || !pipButton || !menu)
    return;
  labelOverlay();
  const speed = clampSpeed(video.playbackRate);
  speedButton.textContent = formatSpeed(speed);
  speedButton.dataset.changed = String(speed !== 1);
  loopButton.setAttribute("aria-pressed", String(video.loop));
  loopButton.title = t(video.loop ? "label.loopOn" : "label.loopOff");
  pipButton.setAttribute("aria-pressed", String(document.pictureInPictureElement === video));
  for (const item of menu.querySelectorAll(".evi-vcp-item")) {
    item.setAttribute("aria-checked", String(Math.abs(Number(item.dataset.speed) - speed) < 0.000001));
  }
}
function flash(text) {
  if (!flashEl)
    return;
  flashEl.textContent = text;
  flashEl.dataset.shown = "true";
  flashing = true;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashing = false;
    if (flashEl)
      flashEl.dataset.shown = "false";
    update();
  }, FLASH_MS);
  update();
}
function setIdle(value) {
  clearTimeout(idleTimer);
  if (idle !== value) {
    idle = value;
    update();
  }
}
function armIdle() {
  setIdle(false);
  idleTimer = setTimeout(() => {
    const focusInside = !!root?.contains(document.activeElement);
    if (current && !current.paused && !menuOpen && !focusInside)
      setIdle(true);
  }, IDLE_MS);
}
function stripVisible() {
  if (sticky && sticky.state !== "watching" && sticky.media === current)
    return false;
  return !!current && (menuOpen || hovered === current && !idle) && ctx?.settings.get("showStrip") !== false;
}
function visibleRect(video) {
  const box = (playerOf(video) ?? video).getBoundingClientRect();
  let top = Math.max(box.top, 0), left = Math.max(box.left, 0);
  let bottom = Math.min(box.bottom, window.innerHeight), right = Math.min(box.right, window.innerWidth);
  if (!document.fullscreenElement) {
    let el = scrollers.get(video);
    if (el === undefined || el && !el.isConnected)
      scrollers.set(video, el = video.closest('[class*="scroller"]'));
    const scroller = el?.getBoundingClientRect();
    if (scroller) {
      top = Math.max(top, scroller.top);
      bottom = Math.min(bottom, scroller.bottom);
    }
  }
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function setData(el, key, value) {
  if (el.dataset[key] !== value)
    el.dataset[key] = value;
}
var placed = "";
function update() {
  if (!root || !strip)
    return;
  const video = current;
  const showStrip = stripVisible();
  const active = !!video?.isConnected && (showStrip || flashing);
  setData(root, "visible", String(active));
  setData(strip, "visible", String(showStrip));
  if (!active || !video) {
    if (menuOpen && !video?.isConnected)
      setMenu(false, false);
    cancelAnimationFrame(frame);
    frame = 0;
    return;
  }
  const host = document.fullscreenElement?.contains(video) ? document.fullscreenElement : document.body;
  if (root.parentElement !== host)
    host.append(root);
  const rect = visibleRect(video);
  const place = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  if (place !== placed) {
    placed = place;
    root.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    root.style.width = `${rect.width}px`;
    root.style.height = `${rect.height}px`;
    setData(root, "compact", String(rect.width < MIN_STRIP_WIDTH || rect.height < 64));
  }
  if (!frame) {
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }
}
function show(video) {
  if (current !== video) {
    if (menuOpen)
      setMenu(false, false);
    current = video;
  }
  sync();
  armIdle();
  update();
}
function setHovered(video) {
  if (video === hovered)
    return;
  hovered = video;
  armHoverPlay(video);
  if (video) {
    attach(video);
    show(video);
  } else {
    update();
  }
}
function onPointerOver(e) {
  if (root?.contains(e.target))
    return;
  setHovered(videoFor(e.target));
}
var lastMove = 0;
function onPointerMove(e) {
  if (!current || hovered !== current && !root?.contains(e.target))
    return;
  if (!idle && e.timeStamp - lastMove < 200)
    return;
  lastMove = e.timeStamp;
  armIdle();
}
function onPointerDown(e) {
  if (menuOpen && !menu?.contains(e.target) && !speedButton?.contains(e.target))
    setMenu(false, false);
}
function onMouseOut(e) {
  if (!e.relatedTarget)
    setHovered(null);
}
function onPlay(e) {
  const video = e.target;
  if (!(video instanceof HTMLVideoElement) || !isEligible(video))
    return;
  attach(video);
  if (previewPlays.delete(video))
    return;
  played.add(video);
  applyRememberedSpeed(video);
  watch(video);
}
function isEditable(el) {
  return !!el?.closest(EDITABLE);
}
function keyTarget(e) {
  const active = document.activeElement;
  const focused = active && active !== document.body ? videoFor(active) : null;
  if (focused)
    return focused;
  if (!hovered?.isConnected || isEditable(active))
    return null;
  if (isArrowAction(e) && hovered.closest('[role="dialog"]'))
    return null;
  return hovered;
}
function onKeyDown(e) {
  if (e.key === "f" || e.key === "F")
    beforeFullscreen(e.target);
  if (!ctx?.settings.get("shortcuts") || e.defaultPrevented)
    return;
  const action = actionForKey(e);
  if (!action)
    return;
  if (root?.contains(document.activeElement) && (e.key === " " || menuOpen))
    return;
  const video = keyTarget(e);
  if (!video)
    return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat && NO_REPEAT.has(action))
    return;
  attach(video);
  show(video);
  try {
    if (action === "fullscreen")
      beforeFullscreen(video);
    if (preview?.video === video && (action === "togglePlay" || action === "mute")) {
      endPreview("handover");
      return togglePlay(video);
    }
    perform(action, video);
  } catch (err) {
    ctx.logger.error(`Couldn't ${action}`, err);
  }
}
function restore() {
  for (const [video, change] of touched) {
    if (!video.isConnected)
      continue;
    try {
      if (change.rate) {
        video.defaultPlaybackRate = 1;
        video.playbackRate = 1;
      }
      if (change.loop)
        video.loop = false;
      if (change.pip) {
        if (document.pictureInPictureElement === video)
          document.exitPictureInPicture().catch(() => {});
        video.disablePictureInPicture = true;
      }
    } catch {}
  }
  touched.clear();
}
var reducedMotion = () => document.documentElement.classList.contains("reduce-motion");
var preview;
var hoverTimer;
var played = new WeakSet;
var previewPlays = new WeakSet;
function hoverPlayable(video) {
  if (!ctx?.settings.get("hoverPlay") || !video.isConnected || !video.closest(MESSAGE_SCOPE) || video.closest(DIALOG))
    return false;
  return canHoverPlay({
    paused: video.paused,
    currentTime: video.currentTime,
    played: played.has(video),
    reducedMotion: reducedMotion(),
    fullscreen: !!document.fullscreenElement || !!document.pictureInPictureElement
  });
}
function armHoverPlay(video) {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
  if (preview && preview.video !== video)
    endPreview("reset");
  if (!video || preview || !hoverPlayable(video))
    return;
  hoverTimer = setTimeout(() => {
    hoverTimer = undefined;
    if (hovered === video && !preview && hoverPlayable(video))
      startPreview(video);
  }, HOVER_DELAY_MS);
}
function startPreview(video) {
  preview = { video, muted: video.muted, loop: video.loop };
  video.muted = true;
  video.loop = true;
  previewPlays.add(video);
  video.play().catch(() => {
    previewPlays.delete(video);
    if (preview?.video === video)
      endPreview("reset");
  });
}
function endPreview(how) {
  const p = preview;
  if (!p)
    return;
  preview = undefined;
  const { video } = p;
  try {
    video.pause();
    video.muted = p.muted;
    video.loop = p.loop;
    if (how === "reset")
      video.currentTime = 0;
  } catch {}
}
function handOver(video) {
  endPreview("handover");
  setTimeout(() => {
    if (ctx && video.paused && !played.has(video)) {
      try {
        video.currentTime = 0;
      } catch {}
    }
  }, 0);
}
var STICKY_ATTR = "data-evi-vcp-sticky";
var CLOSING_ATTR = "data-evi-vcp-closing";
var RETURN_ATTR = "data-evi-vcp-return";
var LIFT_ATTR = "data-evi-vcp-lift";
var PLACE_VARS = ["--evi-vcp-left", "--evi-vcp-top", "--evi-vcp-width", "--evi-vcp-height"];
var sticky;
var leaving = new Set;
var stickyObserver;
var mini;
var embedTimer;
var recheckTimer;
function anchorFor(media) {
  if (media instanceof HTMLIFrameElement)
    return media;
  const scope = media.closest(MESSAGE_SCOPE);
  const player = media.closest(PLAYER) ?? media.closest("[data-fullscreen]");
  return player && scope?.contains(player) ? player : media;
}
function watch(media) {
  if (!ctx?.settings.get("stickyVideo") || sticky?.media === media)
    return;
  if (!media.isConnected || !media.closest(MESSAGE_SCOPE) || media.closest(DIALOG))
    return;
  const anchor = anchorFor(media);
  const holder = anchor.parentElement;
  if (!holder)
    return;
  drop({ stop: true });
  sticky = { media, anchor, holder, state: "watching", ratio: 1, natural: { width: 0, height: 0 }, area: null, lifted: [], token: 0 };
  stickyObserver ??= new IntersectionObserver(onIntersect, { threshold: STICKY_THRESHOLDS });
  stickyObserver.observe(holder);
}
function drop({ stop = false, instant = false } = {}) {
  const s = sticky;
  if (!s)
    return;
  sticky = undefined;
  stickyObserver?.unobserve(s.holder);
  if (s.state === "watching")
    return;
  if (stop && s.media instanceof HTMLVideoElement)
    pause(s.media);
  const stopEmbed = () => {
    if (stop && s.media instanceof HTMLIFrameElement && s.media.isConnected)
      s.media.src = stoppedEmbedUrl(s.media.src);
  };
  if (instant) {
    release(s);
    stopEmbed();
  } else {
    unpin(s, "close", stopEmbed);
  }
}
function onIntersect(entries) {
  const s = sticky;
  if (!s)
    return;
  let entry;
  for (const e of entries)
    if (e.target === s.holder)
      entry = e;
  if (!entry)
    return;
  if (!s.anchor.isConnected) {
    if (s.state === "watching")
      drop();
    return;
  }
  s.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
  evaluate();
}
function canPin(s) {
  if (!ctx?.settings.get("stickyVideo") || !s.anchor.isConnected)
    return false;
  if (!(s.media instanceof HTMLVideoElement))
    return true;
  if (document.pictureInPictureElement === s.media)
    return false;
  return !s.media.paused || s.state !== "watching";
}
function evaluate() {
  const s = sticky;
  if (!s)
    return;
  if (document.fullscreenElement) {
    if (s.state !== "watching")
      release(s);
    return;
  }
  const want = nextSticky(s.state === "pinned", s.ratio) && canPin(s);
  if (want && s.state !== "pinned") {
    pin(s);
  } else if (!want && s.state === "pinned") {
    unpin(s, "return", () => {
      if (sticky === s && s.media instanceof HTMLVideoElement && s.media.paused)
        drop();
    });
  }
}
function inspectAncestors(anchor) {
  const lifts = [];
  let hard = false;
  let area = null;
  for (let el = anchor.parentElement;el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    const v = (name) => cs.getPropertyValue(name);
    const r = containingBlockLift({
      transform: v("transform"),
      translate: v("translate"),
      rotate: v("rotate"),
      scale: v("scale"),
      perspective: v("perspective"),
      filter: v("filter"),
      backdropFilter: v("backdrop-filter"),
      clipPath: v("clip-path"),
      maskImage: v("mask-image"),
      contain: v("contain"),
      containerType: v("container-type"),
      contentVisibility: v("content-visibility"),
      willChange: v("will-change")
    });
    if (r.hard)
      hard = true;
    if (r.lift.length)
      lifts.push([el, r.lift]);
    const overflow = v("overflow-y");
    if (!area && (overflow === "auto" || overflow === "scroll") && el.clientHeight > 0)
      area = el;
  }
  return { lifts, hard, area };
}
function place(s) {
  const box = s.area?.getBoundingClientRect();
  const size = miniSize(s.natural.width, s.natural.height, box?.width);
  const rect = miniPosition(size, { width: window.innerWidth, height: window.innerHeight }, box);
  const values = [rect.left, rect.top, rect.width, rect.height];
  for (const el of [s.anchor, mini]) {
    PLACE_VARS.forEach((name, i) => el?.style.setProperty(name, `${values[i]}px`));
  }
}
function pin(s) {
  if (s.state === "unpinning") {
    s.token++;
    s.state = "pinned";
    s.anchor.removeAttribute(CLOSING_ATTR);
    leaving.delete(s);
    showMini(s);
    return;
  }
  const { lifts, hard, area } = inspectAncestors(s.anchor);
  if (hard && (s.media instanceof HTMLIFrameElement || typeof s.anchor.showPopover !== "function"))
    return;
  const box = s.anchor.getBoundingClientRect();
  const holderBox = s.holder.getBoundingClientRect();
  s.natural = { width: box.width, height: box.height };
  s.area = area;
  s.token++;
  s.holderStyle = [s.holder.style.minWidth, s.holder.style.minHeight];
  s.holder.style.minWidth = `${holderBox.width}px`;
  s.holder.style.minHeight = `${holderBox.height}px`;
  s.mode = hard ? "popover" : "fixed";
  if (!hard) {
    for (const [el, lift] of lifts) {
      el.setAttribute(LIFT_ATTR, lift.join(" "));
      s.lifted.push(el);
    }
  }
  showMini(s);
  place(s);
  s.anchor.setAttribute(STICKY_ATTR, "");
  s.state = "pinned";
  if (hard) {
    try {
      s.anchor.setAttribute("popover", "manual");
      s.anchor.showPopover();
      mini?.setAttribute("popover", "manual");
      mini?.showPopover();
    } catch (err) {
      ctx?.logger.warn("Couldn't pin the video", err);
      release(s);
      return;
    }
  }
  s.unmount = new MutationObserver(() => {
    if (!s.anchor.isConnected)
      unmounted(s);
  });
  for (let el = s.holder;el; el = el.parentElement)
    s.unmount.observe(el, { childList: true });
  if (area) {
    s.resize = new ResizeObserver(() => {
      if (s.state === "pinned")
        place(s);
    });
    s.resize.observe(area);
  }
  update();
}
function unpin(s, how, done) {
  if (s.state !== "pinned")
    return;
  s.state = "unpinning";
  const token = ++s.token;
  leaving.add(s);
  s.anchor.setAttribute(CLOSING_ATTR, "");
  const buttons = mini;
  buttons?.setAttribute("data-closing", "");
  Promise.all([import_api2.exitDone(s.anchor), import_api2.exitDone(buttons)]).then(() => {
    if (s.token !== token || s.state !== "unpinning")
      return;
    release(s);
    if (how === "return" && !s.orphan && s.anchor.isConnected) {
      s.anchor.setAttribute(RETURN_ATTR, "");
      import_api2.exitDone(s.anchor).then(() => s.anchor.removeAttribute(RETURN_ATTR));
    }
    done?.();
  });
}
function release(s) {
  s.token++;
  leaving.delete(s);
  s.unmount?.disconnect();
  s.unmount = undefined;
  s.resize?.disconnect();
  s.resize = undefined;
  if (s.mode === "popover" && s.anchor.hasAttribute("popover")) {
    try {
      s.anchor.hidePopover();
    } catch {}
    s.anchor.removeAttribute("popover");
  }
  s.anchor.removeAttribute(STICKY_ATTR);
  s.anchor.removeAttribute(CLOSING_ATTR);
  for (const name of PLACE_VARS)
    s.anchor.style.removeProperty(name);
  for (const el of s.lifted)
    el.removeAttribute(LIFT_ATTR);
  s.lifted = [];
  if (s.holderStyle) {
    [s.holder.style.minWidth, s.holder.style.minHeight] = s.holderStyle;
    s.holderStyle = undefined;
  }
  s.mode = undefined;
  s.state = "watching";
  if (s.orphan && s.media instanceof HTMLVideoElement)
    s.anchor.remove();
  if (!sticky || sticky === s || sticky.state === "watching")
    hideMini();
  update();
}
function unmounted(s) {
  s.unmount?.disconnect();
  s.unmount = undefined;
  s.resize?.disconnect();
  s.resize = undefined;
  if (sticky === s) {
    sticky = undefined;
    stickyObserver?.unobserve(s.holder);
  }
  s.orphan = true;
  if (s.media instanceof HTMLVideoElement) {
    if (s.mode === "popover")
      s.anchor.removeAttribute("popover");
    s.mode = "fixed";
    document.body.append(s.anchor);
  }
  if (s.state === "pinned")
    unpin(s, "close");
}
var MINI_ICONS = {
  back: "M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7",
  close: "M6 6l12 12M18 6L6 18"
};
function buildMini() {
  mini = document.createElement("div");
  mini.className = "evi-vcp-mini";
  mini.setAttribute("role", "group");
  mini.hidden = true;
  mini.append(button("back", "", svg(MINI_ICONS.back)), button("close", "", svg(MINI_ICONS.close)));
  for (const el of mini.querySelectorAll(".evi-vcp-btn"))
    el.className = "evi-vcp-mini-btn";
  mini.addEventListener("click", (e) => {
    const s = sticky;
    const act = e.target?.closest(".evi-vcp-mini-btn")?.dataset.act;
    if (!s || s.state !== "pinned" || !act)
      return;
    if (act === "back")
      s.holder.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    else
      drop({ stop: true });
  });
  document.body.append(mini);
}
function showMini(s) {
  if (!mini)
    buildMini();
  if (!mini)
    return;
  mini.setAttribute("aria-label", t("label.stickyPlayer"));
  const name = (act, label) => {
    const el = mini?.querySelector(`[data-act="${act}"]`);
    if (!el)
      return;
    el.title = label;
    el.setAttribute("aria-label", label);
  };
  name("back", t("label.backToMessage"));
  name("close", t("label.closePlayer"));
  mini.removeAttribute("data-closing");
  mini.hidden = false;
  if (s.mode !== "popover" && mini.hasAttribute("popover")) {
    try {
      mini.hidePopover();
    } catch {}
    mini.removeAttribute("popover");
  }
}
function hideMini() {
  if (!mini)
    return;
  if (mini.hasAttribute("popover")) {
    try {
      mini.hidePopover();
    } catch {}
    mini.removeAttribute("popover");
  }
  mini.removeAttribute("data-closing");
  mini.hidden = true;
}
function beforeFullscreen(target) {
  const s = sticky;
  if (s?.mode !== "popover" || s.state === "watching" || !(target instanceof Node) || !s.anchor.contains(target))
    return;
  release(s);
  clearTimeout(recheckTimer);
  recheckTimer = setTimeout(evaluate, 500);
}
function watchOpenedEmbed(e, target) {
  const scope = target.closest(MESSAGE_ACCESSORIES);
  if (!scope || !ctx?.settings.get("stickyVideo"))
    return;
  const before = new Set(scope.querySelectorAll("iframe"));
  const { clientX: x, clientY: y } = e;
  clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    embedTimer = undefined;
    if (!ctx || !scope.isConnected)
      return;
    for (const frame2 of scope.querySelectorAll("iframe")) {
      if (before.has(frame2))
        continue;
      const r = frame2.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return watch(frame2);
    }
  }, 250);
}
function onClickCapture(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target || root?.contains(target) || mini?.contains(target))
    return;
  if (preview && anchorFor(preview.video).contains(target))
    handOver(preview.video);
  if (sticky?.mode === "popover" && (e.type === "dblclick" || target.closest(PLAYER_BUTTON("fullscreen"))))
    beforeFullscreen(target);
  if (e.type === "click")
    watchOpenedEmbed(e, target);
}
function onPause(e) {
  const video = e.target;
  if (sticky?.media === video && sticky.state === "watching" && video.isConnected)
    drop();
}
var video_controls_plus_default = import_api2.definePlugin({
  settings,
  css: `
        .evi-vcp { position: fixed; left: 0; top: 0; z-index: 10000; pointer-events: none; overflow: visible;
            font-family: var(--font-primary, inherit); color: var(--white, #fff); }
        .evi-vcp[data-visible="false"] { visibility: hidden; transition: visibility 0s linear 0.15s; }
        .evi-vcp-strip { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 2px; padding: 2px;
            border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.6); backdrop-filter: blur(6px);
            box-shadow: var(--shadow-low, 0 1px 3px rgb(0 0 0 / 0.3)); pointer-events: auto;
            opacity: 1; transition: opacity 0.15s ease-out; }
        .evi-vcp-strip[data-visible="false"] { opacity: 0; pointer-events: none; }
        .evi-vcp[data-compact="true"] .evi-vcp-strip { display: none; }
        .evi-vcp-btn, .evi-vcp-item { display: flex; align-items: center; justify-content: center; border: 0; padding: 0;
            color: inherit; background: transparent; border-radius: calc(var(--radius-sm, 8px) - 2px); cursor: pointer;
            font: inherit; transition: background-color 0.12s ease-out; }
        .evi-vcp-btn { width: 30px; height: 30px; }
        .evi-vcp-btn[hidden] { display: none; }
        .evi-vcp-speed { width: auto; min-width: 44px; padding: 0 6px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .evi-vcp-speed[data-changed="true"] { color: var(--text-brand, var(--brand-360, #949cf7)); }
        .evi-vcp-btn:hover, .evi-vcp-item:hover { background: rgb(255 255 255 / 0.16); }
        .evi-vcp-btn[aria-pressed="true"] { color: var(--text-brand, var(--brand-360, #949cf7)); background: rgb(255 255 255 / 0.12); }
        .evi-vcp button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
        .evi-vcp-sep { width: 1px; height: 18px; margin: 0 3px; background: rgb(255 255 255 / 0.25); }
        .evi-vcp-menu { position: absolute; top: 46px; right: 8px; display: grid; grid-template-columns: repeat(5, auto); gap: 2px;
            padding: 4px; border-radius: var(--radius-sm, 8px); pointer-events: auto;
            background: var(--background-floating, var(--background-surface-highest, #111214)); color: var(--text-default, var(--text-normal, #dbdee1));
            border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.08)); box-shadow: var(--shadow-high, 0 8px 16px rgb(0 0 0 / 0.24)); }
        .evi-vcp-menu[hidden] { display: none; }
        .evi-vcp-item { min-width: 48px; height: 28px; padding: 0 6px; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }
        .evi-vcp-item:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.08)); }
        .evi-vcp-item[aria-checked="true"] { background: var(--brand-500, #5865f2); color: var(--white, #fff); }
        .evi-vcp-flash { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 6px 12px; max-width: calc(100% - 16px);
            border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.7); font-size: 14px; font-weight: 600;
            font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            opacity: 0; transition: opacity 0.15s ease-out; }
        .evi-vcp-flash[data-shown="true"] { opacity: 1; transition-duration: 0.05s; }
        @media (prefers-reduced-motion: reduce) {
            .evi-vcp, .evi-vcp[data-visible="false"], .evi-vcp-strip, .evi-vcp-btn, .evi-vcp-item, .evi-vcp-flash { transition: none; }
        }

        [data-evi-vcp-sticky] { position: fixed !important; inset: auto !important;
            left: var(--evi-vcp-left) !important; top: var(--evi-vcp-top) !important;
            width: var(--evi-vcp-width) !important; height: var(--evi-vcp-height) !important;
            min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important;
            margin: 0 !important; padding: 0 !important; border: 0 !important; z-index: 100;
            overflow: hidden !important; border-radius: var(--radius-md, 12px) !important; background-color: #000;
            box-shadow: var(--shadow-high, 0 8px 16px rgb(0 0 0 / 0.24)); }
        [data-evi-vcp-sticky][popover] { color: inherit; }
        [data-evi-vcp-sticky] video, [data-evi-vcp-sticky] [data-testid="discord-web-video-player-frame"] {
            width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; }
        [data-evi-vcp-sticky] video { object-fit: contain; }
        [data-evi-vcp-sticky]:fullscreen { border-radius: 0 !important; box-shadow: none !important; }
        [data-evi-vcp-sticky][data-evi-vcp-closing] { pointer-events: none; }
        [data-evi-vcp-lift~="transform"] { transform: none !important; }
        [data-evi-vcp-lift~="contain"] { contain: none !important; }
        [data-evi-vcp-lift~="content-visibility"] { content-visibility: visible !important; }
        [data-evi-vcp-lift~="will-change"] { will-change: auto !important; }

        .evi-vcp-mini { position: fixed; z-index: 1000; left: var(--evi-vcp-left); top: var(--evi-vcp-top); right: auto; bottom: auto;
            width: var(--evi-vcp-width); height: var(--evi-vcp-height); box-sizing: border-box; margin: 0; padding: 8px;
            display: flex; align-items: flex-start; gap: 4px; pointer-events: none; color: var(--white, #fff); }
        .evi-vcp-mini[hidden] { display: none; }
        .evi-vcp-mini[popover] { border: 0; background: transparent; overflow: visible; }
        .evi-vcp-mini-btn { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
            border: 0; padding: 0; border-radius: var(--radius-sm, 8px); background: rgb(0 0 0 / 0.6); color: inherit;
            backdrop-filter: blur(6px); cursor: pointer; pointer-events: auto; transition: background-color 0.12s ease-out; }
        .evi-vcp-mini-btn:hover { background: rgb(0 0 0 / 0.8); }
        .evi-vcp-mini-btn:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 1px; }
        .evi-vcp-mini[data-closing] .evi-vcp-mini-btn { pointer-events: none; }

        /* Discord's modal motion (Evi's layer variables): springs in from 90%, shrinks back out */
        @media (prefers-reduced-motion: no-preference) {
            :root:not(.reduce-motion) :is([data-evi-vcp-sticky], .evi-vcp-mini) {
                animation: evi-vcp-pin-in var(--evi-modal-in, 230ms) var(--evi-spring-in, ease-out); }
            :root:not(.reduce-motion) :is([data-evi-vcp-sticky][data-evi-vcp-closing], .evi-vcp-mini[data-closing]) {
                animation: evi-vcp-pin-out var(--evi-modal-out, 200ms) var(--evi-spring-out, ease-in) forwards; }
            :root:not(.reduce-motion) [data-evi-vcp-return] { animation: evi-vcp-return 200ms ease-out; }
        }
        @keyframes evi-vcp-pin-in { from { opacity: 0; scale: 0.9; } }
        @keyframes evi-vcp-pin-out { to { opacity: 0; scale: 0.9; } }
        @keyframes evi-vcp-return { from { opacity: 0; } }
    `,
  start(context) {
    ctx = context;
    events = new AbortController;
    const { signal } = events;
    buildOverlay();
    const capture = { capture: true, signal };
    document.addEventListener("pointerover", onPointerOver, capture);
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: true, signal });
    document.addEventListener("pointerdown", onPointerDown, capture);
    document.addEventListener("mouseout", onMouseOut, capture);
    document.addEventListener("play", onPlay, capture);
    document.addEventListener("pause", onPause, capture);
    document.addEventListener("enterpictureinpicture", () => evaluate(), capture);
    document.addEventListener("leavepictureinpicture", () => evaluate(), capture);
    window.addEventListener("click", onClickCapture, capture);
    window.addEventListener("dblclick", onClickCapture, capture);
    window.addEventListener("keydown", onKeyDown, capture);
    document.addEventListener("fullscreenchange", () => {
      evaluate();
      update();
    }, { signal });
    document.addEventListener("fullscreenerror", (e) => beforeFullscreen(e.target), capture);
    window.addEventListener("resize", () => {
      if (sticky?.state === "pinned")
        place(sticky);
      update();
    }, { signal });
    context.settings.onChange((values) => {
      if (!values.stickyVideo)
        drop();
      if (!values.hoverPlay)
        armHoverPlay(null);
      sync();
      update();
    });
    context.onDispose(() => {
      events?.abort();
      events = undefined;
      clearTimeout(hoverTimer);
      clearTimeout(embedTimer);
      clearTimeout(recheckTimer);
      hoverTimer = embedTimer = recheckTimer = undefined;
      endPreview("reset");
      drop({ instant: true });
      for (const s of [...leaving])
        release(s);
      stickyObserver?.disconnect();
      stickyObserver = undefined;
      mini?.remove();
      mini = undefined;
      attached = new WeakSet;
      cancelAnimationFrame(frame);
      frame = 0;
      clearTimeout(idleTimer);
      clearTimeout(flashTimer);
      idleTimer = flashTimer = undefined;
      root?.remove();
      placed = "";
      root = strip = menu = flashEl = speedButton = loopButton = pipButton = undefined;
      restore();
      hovered = current = null;
      idle = flashing = menuOpen = false;
      ctx = undefined;
    });
  }
});
