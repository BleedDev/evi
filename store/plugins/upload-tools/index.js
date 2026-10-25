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

// plugins/upload-tools/index.tsx
var exports_upload_tools = {};
__export(exports_upload_tools, {
  default: () => upload_tools_default
});
module.exports = __toCommonJS(exports_upload_tools);
var import_api6 = require("@evi/api");

// plugins/upload-tools/details.tsx
var import_api3 = require("@evi/api");

// plugins/upload-tools/progress.ts
var WINDOW_MS = 3000;
var SHOW_EVERY_MS = 1000;
var MIN_SPAN_MS = 500;

class SpeedMeter {
  samples = [];
  shown;
  shownAt = -Infinity;
  sample(loaded, total, now) {
    const last = this.samples[this.samples.length - 1];
    if (last && loaded < last.loaded)
      this.reset();
    if (!last || now > last.at || loaded !== last.loaded)
      this.samples.push({ at: now, loaded });
    while (this.samples.length > 2 && now - this.samples[1].at >= WINDOW_MS)
      this.samples.shift();
    if (this.shown && now - this.shownAt < SHOW_EVERY_MS)
      return this.shown;
    const first = this.samples[0];
    const span = now - first.at;
    if (span < MIN_SPAN_MS)
      return this.shown;
    const rate = Math.max(0, (loaded - first.loaded) / (span / 1000));
    this.shown = { rate, secondsLeft: secondsLeft(total - loaded, rate) };
    this.shownAt = now;
    return this.shown;
  }
  reset() {
    this.samples = [];
    this.shown = undefined;
    this.shownAt = -Infinity;
  }
}
function secondsLeft(remaining, rate) {
  if (!(rate > 0) || !Number.isFinite(remaining))
    return;
  return Math.max(0, remaining) / rate;
}
function timeLeft(seconds) {
  if (seconds < 10)
    return { unit: "seconds", count: Math.max(1, Math.ceil(seconds)) };
  if (seconds < 60)
    return { unit: "seconds", count: Math.min(55, Math.ceil(seconds / 5) * 5) };
  if (seconds < 3600)
    return { unit: "minutes", count: Math.round(seconds / 60) };
  return { unit: "hours", count: Math.round(seconds / 360) / 10 };
}
function size(bytes) {
  const units = ["b", "kb", "mb", "gb"];
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const value10 = i === 0 ? Math.round(value) : value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return { unit: units[i], value: value10 };
}
function fraction(loaded, total) {
  if (!(total > 0))
    return 0;
  return Math.min(1, Math.max(0, loaded / total));
}
function overall(transfers) {
  let loaded = 0, total = 0, any = false;
  for (const t of transfers) {
    any = true;
    loaded += Math.max(0, Math.min(t.loaded, t.total));
    total += Math.max(0, t.total);
  }
  if (!any)
    return -1;
  return total > 0 ? loaded / total : 0;
}

// plugins/upload-tools/state.ts
var import_api2 = require("@evi/api");

// plugins/upload-tools/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.details": "Upload speed and time left",
    "settings.details.description": "While files are sending: how fast, how long is left, and a cancel button for each file when a message has several.",
    "settings.taskbar": "Progress on the taskbar",
    "settings.taskbar.description": "Discord's taskbar icon fills up while your files are sending.",
    "settings.previewTools": "Reorder and spoiler all",
    "settings.previewTools.description": "Drag the files waiting to be sent into any order (or press Alt and an arrow key on a selected file), and mark them all as spoilers at once.",
    "settings.editFiles": "Add files while editing",
    "settings.editFiles.description": "Add files to your own message while you edit it. They're added when you save. Discord already lets you remove attachments from your messages.",
    "size.b": "{value} B",
    "size.kb": "{value} KB",
    "size.mb": "{value} MB",
    "size.gb": "{value} GB",
    "details.speed": "{size}/s",
    "details.progress": "{done} of {total}",
    "details.starting": "Starting…",
    "details.files": "Files being sent",
    "details.uploaded": "Uploaded",
    "details.cancel": "Cancel {name}",
    "left.seconds": { one: "{count} second left", other: "{count} seconds left" },
    "left.minutes": { one: "{count} minute left", other: "{count} minutes left" },
    "left.hours": { one: "{count} hour left", other: "{count} hours left" },
    "tools.label": "All files",
    "tools.spoilerAll": "Mark all as spoilers",
    "tools.unspoilerAll": "Remove all spoilers",
    "edit.add": "Add files",
    "edit.full": "A message can have up to {max} files",
    "edit.pending": { one: "{count} file is added when you save", other: "{count} files are added when you save" },
    "edit.remove": "Remove {name}",
    "edit.percent": "{percent}%",
    "edit.tooBig": "Too big",
    "edit.failed": "Couldn't upload",
    "edit.saveFailed": "Couldn't add the files: {reason}",
    "edit.unavailable": "Files can't be added right now: Discord changed how uploads work."
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.details": "Upload-Geschwindigkeit und Restzeit",
      "settings.details.description": "Während Dateien gesendet werden: wie schnell, wie lange es noch dauert, und ein Abbrechen-Knopf für jede Datei, wenn eine Nachricht mehrere hat.",
      "settings.taskbar": "Fortschritt in der Taskleiste",
      "settings.taskbar.description": "Discords Symbol in der Taskleiste füllt sich, während deine Dateien gesendet werden.",
      "settings.previewTools": "Umsortieren und alles als Spoiler",
      "settings.previewTools.description": "Ziehe die Dateien, die auf das Senden warten, in jede beliebige Reihenfolge (oder drücke Alt und eine Pfeiltaste auf einer ausgewählten Datei) und markiere alle auf einmal als Spoiler.",
      "settings.editFiles": "Dateien beim Bearbeiten hinzufügen",
      "settings.editFiles.description": "Füge deiner eigenen Nachricht beim Bearbeiten Dateien hinzu. Sie werden beim Speichern hinzugefügt. Anhänge entfernen kannst du in Discord schon jetzt.",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/s",
      "details.progress": "{done} von {total}",
      "details.starting": "Wird gestartet…",
      "details.files": "Dateien, die gesendet werden",
      "details.uploaded": "Hochgeladen",
      "details.cancel": "{name} abbrechen",
      "left.seconds": { one: "Noch {count} Sekunde", other: "Noch {count} Sekunden" },
      "left.minutes": { one: "Noch {count} Minute", other: "Noch {count} Minuten" },
      "left.hours": { one: "Noch {count} Stunde", other: "Noch {count} Stunden" },
      "tools.label": "Alle Dateien",
      "tools.spoilerAll": "Alle als Spoiler markieren",
      "tools.unspoilerAll": "Alle Spoiler entfernen",
      "edit.add": "Dateien hinzufügen",
      "edit.full": "Eine Nachricht kann bis zu {max} Dateien haben",
      "edit.pending": { one: "{count} Datei wird beim Speichern hinzugefügt", other: "{count} Dateien werden beim Speichern hinzugefügt" },
      "edit.remove": "{name} entfernen",
      "edit.percent": "{percent} %",
      "edit.tooBig": "Zu groß",
      "edit.failed": "Hochladen fehlgeschlagen",
      "edit.saveFailed": "Die Dateien konnten nicht hinzugefügt werden: {reason}",
      "edit.unavailable": "Dateien können gerade nicht hinzugefügt werden: Discord hat geändert, wie Uploads funktionieren."
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.details": "Velocidad de subida y tiempo restante",
      "settings.details.description": "Mientras se envían archivos: a qué velocidad, cuánto falta y un botón para cancelar cada archivo cuando un mensaje tiene varios.",
      "settings.taskbar": "Progreso en la barra de tareas",
      "settings.taskbar.description": "El icono de Discord en la barra de tareas se va llenando mientras se envían tus archivos.",
      "settings.previewTools": "Reordenar y marcar todo como spoiler",
      "settings.previewTools.description": "Arrastra los archivos que esperan para enviarse al orden que quieras (o pulsa Alt y una flecha sobre un archivo seleccionado) y márcalos todos como spoiler de una vez.",
      "settings.editFiles": "Añadir archivos al editar",
      "settings.editFiles.description": "Añade archivos a tu propio mensaje mientras lo editas. Se añaden al guardar. Discord ya te deja quitar archivos adjuntos de tus mensajes.",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/s",
      "details.progress": "{done} de {total}",
      "details.starting": "Empezando…",
      "details.files": "Archivos que se están enviando",
      "details.uploaded": "Subido",
      "details.cancel": "Cancelar {name}",
      "left.seconds": { one: "Falta {count} segundo", other: "Faltan {count} segundos" },
      "left.minutes": { one: "Falta {count} minuto", other: "Faltan {count} minutos" },
      "left.hours": { one: "Falta {count} hora", other: "Faltan {count} horas" },
      "tools.label": "Todos los archivos",
      "tools.spoilerAll": "Marcar todo como spoiler",
      "tools.unspoilerAll": "Quitar todos los spoilers",
      "edit.add": "Añadir archivos",
      "edit.full": "Un mensaje puede tener hasta {max} archivos",
      "edit.pending": { one: "{count} archivo se añade al guardar", other: "{count} archivos se añaden al guardar" },
      "edit.remove": "Quitar {name}",
      "edit.percent": "{percent} %",
      "edit.tooBig": "Demasiado grande",
      "edit.failed": "No se pudo subir",
      "edit.saveFailed": "No se pudieron añadir los archivos: {reason}",
      "edit.unavailable": "Ahora no se pueden añadir archivos: Discord cambió cómo funcionan las subidas."
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.details": "Vitesse d'envoi et temps restant",
      "settings.details.description": "Pendant l'envoi de fichiers : la vitesse, le temps restant, et un bouton pour annuler chaque fichier quand un message en contient plusieurs.",
      "settings.taskbar": "Progression dans la barre des tâches",
      "settings.taskbar.description": "L'icône de Discord dans la barre des tâches se remplit pendant l'envoi de tes fichiers.",
      "settings.previewTools": "Réordonner et tout en spoiler",
      "settings.previewTools.description": "Fais glisser les fichiers en attente d'envoi dans l'ordre que tu veux (ou appuie sur Alt et une flèche sur un fichier sélectionné), et marque-les tous comme spoilers d'un coup.",
      "settings.editFiles": "Ajouter des fichiers en modifiant",
      "settings.editFiles.description": "Ajoute des fichiers à ton propre message pendant que tu le modifies. Ils sont ajoutés quand tu enregistres. Discord permet déjà de retirer des pièces jointes de tes messages.",
      "size.b": "{value} o",
      "size.kb": "{value} Ko",
      "size.mb": "{value} Mo",
      "size.gb": "{value} Go",
      "details.speed": "{size}/s",
      "details.progress": "{done} sur {total}",
      "details.starting": "Démarrage…",
      "details.files": "Fichiers en cours d'envoi",
      "details.uploaded": "Envoyé",
      "details.cancel": "Annuler {name}",
      "left.seconds": { one: "{count} seconde restante", other: "{count} secondes restantes" },
      "left.minutes": { one: "{count} minute restante", other: "{count} minutes restantes" },
      "left.hours": { one: "{count} heure restante", other: "{count} heures restantes" },
      "tools.label": "Tous les fichiers",
      "tools.spoilerAll": "Tout marquer comme spoiler",
      "tools.unspoilerAll": "Retirer tous les spoilers",
      "edit.add": "Ajouter des fichiers",
      "edit.full": "Un message peut contenir jusqu'à {max} fichiers",
      "edit.pending": { one: "{count} fichier sera ajouté à l'enregistrement", other: "{count} fichiers seront ajoutés à l'enregistrement" },
      "edit.remove": "Retirer {name}",
      "edit.percent": "{percent} %",
      "edit.tooBig": "Trop volumineux",
      "edit.failed": "Échec de l'envoi",
      "edit.saveFailed": "Impossible d'ajouter les fichiers : {reason}",
      "edit.unavailable": "Impossible d'ajouter des fichiers pour le moment : Discord a changé le fonctionnement des envois."
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.details": "アップロード速度と残り時間",
      "settings.details.description": "ファイルの送信中に、速度と残り時間を表示します。複数のファイルがあるメッセージでは、ファイルごとにキャンセルボタンも表示します。",
      "settings.taskbar": "タスクバーに進行状況",
      "settings.taskbar.description": "ファイルの送信中、タスクバーのDiscordアイコンに進行状況が表示されます。",
      "settings.previewTools": "並べ替えとまとめてスポイラー",
      "settings.previewTools.description": "送信待ちのファイルをドラッグして好きな順番に並べ替え(選択したファイルでAltと矢印キーでも可)、まとめてスポイラーにできます。",
      "settings.editFiles": "編集中にファイルを追加",
      "settings.editFiles.description": "自分のメッセージを編集中にファイルを追加できます。保存すると追加されます。添付ファイルの削除はDiscordですでにできます。",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/秒",
      "details.progress": "{done} / {total}",
      "details.starting": "開始しています…",
      "details.files": "送信中のファイル",
      "details.uploaded": "アップロード済み",
      "details.cancel": "{name}をキャンセル",
      "left.seconds": { other: "残り{count}秒" },
      "left.minutes": { other: "残り{count}分" },
      "left.hours": { other: "残り{count}時間" },
      "tools.label": "すべてのファイル",
      "tools.spoilerAll": "すべてスポイラーにする",
      "tools.unspoilerAll": "すべてのスポイラーを外す",
      "edit.add": "ファイルを追加",
      "edit.full": "1つのメッセージに添付できるファイルは{max}個までです",
      "edit.pending": { other: "保存すると{count}個のファイルが追加されます" },
      "edit.remove": "{name}を削除",
      "edit.percent": "{percent}%",
      "edit.tooBig": "大きすぎます",
      "edit.failed": "アップロードできませんでした",
      "edit.saveFailed": "ファイルを追加できませんでした:{reason}",
      "edit.unavailable": "Discordのアップロードの仕組みが変わったため、今はファイルを追加できません。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.details": "Prędkość wysyłania i pozostały czas",
      "settings.details.description": "Podczas wysyłania plików: jak szybko, ile czasu zostało i przycisk anulowania każdego pliku, gdy wiadomość ma ich kilka.",
      "settings.taskbar": "Postęp na pasku zadań",
      "settings.taskbar.description": "Ikona Discorda na pasku zadań wypełnia się podczas wysyłania twoich plików.",
      "settings.previewTools": "Zmiana kolejności i wszystko jako spoiler",
      "settings.previewTools.description": "Przeciągnij pliki czekające na wysłanie w dowolnej kolejności (albo naciśnij Alt i strzałkę na zaznaczonym pliku) i oznacz je wszystkie naraz jako spoilery.",
      "settings.editFiles": "Dodawanie plików podczas edycji",
      "settings.editFiles.description": "Dodawaj pliki do swojej wiadomości podczas jej edycji. Zostaną dodane po zapisaniu. Usuwać załączniki z wiadomości Discord pozwala już sam.",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/s",
      "details.progress": "{done} z {total}",
      "details.starting": "Rozpoczynanie…",
      "details.files": "Wysyłane pliki",
      "details.uploaded": "Przesłano",
      "details.cancel": "Anuluj {name}",
      "left.seconds": { one: "Została {count} sekunda", few: "Zostały {count} sekundy", many: "Zostało {count} sekund", other: "Zostało {count} sekundy" },
      "left.minutes": { one: "Została {count} minuta", few: "Zostały {count} minuty", many: "Zostało {count} minut", other: "Zostało {count} minuty" },
      "left.hours": { one: "Została {count} godzina", few: "Zostały {count} godziny", many: "Zostało {count} godzin", other: "Zostało {count} godziny" },
      "tools.label": "Wszystkie pliki",
      "tools.spoilerAll": "Oznacz wszystkie jako spoilery",
      "tools.unspoilerAll": "Usuń wszystkie spoilery",
      "edit.add": "Dodaj pliki",
      "edit.full": "Wiadomość może mieć maksymalnie {max} plików",
      "edit.pending": { one: "{count} plik zostanie dodany po zapisaniu", few: "{count} pliki zostaną dodane po zapisaniu", many: "{count} plików zostanie dodanych po zapisaniu", other: "{count} pliku zostanie dodane po zapisaniu" },
      "edit.remove": "Usuń {name}",
      "edit.percent": "{percent}%",
      "edit.tooBig": "Za duży",
      "edit.failed": "Nie udało się przesłać",
      "edit.saveFailed": "Nie udało się dodać plików: {reason}",
      "edit.unavailable": "Nie można teraz dodawać plików: Discord zmienił sposób przesyłania."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.details": "Velocidade de envio e tempo restante",
      "settings.details.description": "Enquanto arquivos são enviados: a velocidade, quanto tempo falta e um botão para cancelar cada arquivo quando a mensagem tem vários.",
      "settings.taskbar": "Progresso na barra de tarefas",
      "settings.taskbar.description": "O ícone do Discord na barra de tarefas vai enchendo enquanto seus arquivos são enviados.",
      "settings.previewTools": "Reordenar e marcar tudo como spoiler",
      "settings.previewTools.description": "Arraste os arquivos que aguardam envio para a ordem que quiser (ou pressione Alt e uma seta em um arquivo selecionado) e marque todos como spoiler de uma vez.",
      "settings.editFiles": "Adicionar arquivos ao editar",
      "settings.editFiles.description": "Adicione arquivos à sua própria mensagem enquanto a edita. Eles são adicionados ao salvar. O Discord já permite remover anexos das suas mensagens.",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/s",
      "details.progress": "{done} de {total}",
      "details.starting": "Iniciando…",
      "details.files": "Arquivos sendo enviados",
      "details.uploaded": "Enviado",
      "details.cancel": "Cancelar {name}",
      "left.seconds": { one: "Falta {count} segundo", other: "Faltam {count} segundos" },
      "left.minutes": { one: "Falta {count} minuto", other: "Faltam {count} minutos" },
      "left.hours": { one: "Falta {count} hora", other: "Faltam {count} horas" },
      "tools.label": "Todos os arquivos",
      "tools.spoilerAll": "Marcar tudo como spoiler",
      "tools.unspoilerAll": "Remover todos os spoilers",
      "edit.add": "Adicionar arquivos",
      "edit.full": "Uma mensagem pode ter até {max} arquivos",
      "edit.pending": { one: "{count} arquivo será adicionado ao salvar", other: "{count} arquivos serão adicionados ao salvar" },
      "edit.remove": "Remover {name}",
      "edit.percent": "{percent}%",
      "edit.tooBig": "Grande demais",
      "edit.failed": "Não foi possível enviar",
      "edit.saveFailed": "Não foi possível adicionar os arquivos: {reason}",
      "edit.unavailable": "Não é possível adicionar arquivos agora: o Discord mudou como os envios funcionam."
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.details": "Скорость загрузки и оставшееся время",
      "settings.details.description": "Пока отправляются файлы: скорость, сколько осталось и кнопка отмены для каждого файла, если в сообщении их несколько.",
      "settings.taskbar": "Прогресс на панели задач",
      "settings.taskbar.description": "Значок Discord на панели задач заполняется, пока отправляются ваши файлы.",
      "settings.previewTools": "Порядок и спойлер для всех",
      "settings.previewTools.description": "Перетаскивайте файлы, ожидающие отправки, в нужном порядке (или нажмите Alt и стрелку на выбранном файле) и отмечайте их все как спойлеры сразу.",
      "settings.editFiles": "Добавление файлов при редактировании",
      "settings.editFiles.description": "Добавляйте файлы в своё сообщение, пока редактируете его. Они добавятся при сохранении. Удалять вложения из сообщений Discord уже позволяет сам.",
      "size.b": "{value} Б",
      "size.kb": "{value} КБ",
      "size.mb": "{value} МБ",
      "size.gb": "{value} ГБ",
      "details.speed": "{size}/с",
      "details.progress": "{done} из {total}",
      "details.starting": "Начинаем…",
      "details.files": "Отправляемые файлы",
      "details.uploaded": "Загружено",
      "details.cancel": "Отменить {name}",
      "left.seconds": { one: "Осталась {count} секунда", few: "Осталось {count} секунды", many: "Осталось {count} секунд", other: "Осталось {count} секунды" },
      "left.minutes": { one: "Осталась {count} минута", few: "Осталось {count} минуты", many: "Осталось {count} минут", other: "Осталось {count} минуты" },
      "left.hours": { one: "Остался {count} час", few: "Осталось {count} часа", many: "Осталось {count} часов", other: "Осталось {count} часа" },
      "tools.label": "Все файлы",
      "tools.spoilerAll": "Отметить все как спойлеры",
      "tools.unspoilerAll": "Убрать все спойлеры",
      "edit.add": "Добавить файлы",
      "edit.full": "В сообщении может быть не больше {max} файлов",
      "edit.pending": { one: "{count} файл добавится при сохранении", few: "{count} файла добавятся при сохранении", many: "{count} файлов добавятся при сохранении", other: "{count} файла добавятся при сохранении" },
      "edit.remove": "Убрать {name}",
      "edit.percent": "{percent}%",
      "edit.tooBig": "Слишком большой",
      "edit.failed": "Не удалось загрузить",
      "edit.saveFailed": "Не удалось добавить файлы: {reason}",
      "edit.unavailable": "Сейчас нельзя добавить файлы: Discord изменил работу загрузок."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.details": "Yükleme hızı ve kalan süre",
      "settings.details.description": "Dosyalar gönderilirken: ne kadar hızlı, ne kadar kaldığı ve bir mesajda birden fazla dosya varsa her dosya için bir iptal düğmesi.",
      "settings.taskbar": "Görev çubuğunda ilerleme",
      "settings.taskbar.description": "Dosyaların gönderilirken Discord'un görev çubuğu simgesi dolar.",
      "settings.previewTools": "Yeniden sırala ve hepsini spoiler yap",
      "settings.previewTools.description": "Gönderilmeyi bekleyen dosyaları istediğin sıraya sürükle (ya da seçili bir dosyada Alt ve bir ok tuşuna bas) ve hepsini tek seferde spoiler olarak işaretle.",
      "settings.editFiles": "Düzenlerken dosya ekle",
      "settings.editFiles.description": "Kendi mesajını düzenlerken ona dosya ekle. Kaydettiğinde eklenirler. Mesajlarından ek kaldırmaya Discord zaten izin veriyor.",
      "size.b": "{value} B",
      "size.kb": "{value} KB",
      "size.mb": "{value} MB",
      "size.gb": "{value} GB",
      "details.speed": "{size}/sn",
      "details.progress": "{done} / {total}",
      "details.starting": "Başlıyor…",
      "details.files": "Gönderilen dosyalar",
      "details.uploaded": "Yüklendi",
      "details.cancel": "{name} dosyasını iptal et",
      "left.seconds": { one: "{count} saniye kaldı", other: "{count} saniye kaldı" },
      "left.minutes": { one: "{count} dakika kaldı", other: "{count} dakika kaldı" },
      "left.hours": { one: "{count} saat kaldı", other: "{count} saat kaldı" },
      "tools.label": "Tüm dosyalar",
      "tools.spoilerAll": "Hepsini spoiler olarak işaretle",
      "tools.unspoilerAll": "Tüm spoiler'ları kaldır",
      "edit.add": "Dosya ekle",
      "edit.full": "Bir mesajda en fazla {max} dosya olabilir",
      "edit.pending": { one: "Kaydettiğinde {count} dosya eklenecek", other: "Kaydettiğinde {count} dosya eklenecek" },
      "edit.remove": "{name} dosyasını kaldır",
      "edit.percent": "%{percent}",
      "edit.tooBig": "Çok büyük",
      "edit.failed": "Yüklenemedi",
      "edit.saveFailed": "Dosyalar eklenemedi: {reason}",
      "edit.unavailable": "Şu anda dosya eklenemiyor: Discord yüklemelerin çalışma şeklini değiştirdi."
    } })["tr"];
  }
});

// plugins/upload-tools/state.ts
var settings = {
  details: {
    type: "boolean",
    get label() {
      return t("settings.details");
    },
    get description() {
      return t("settings.details.description");
    },
    default: true
  },
  taskbar: {
    type: "boolean",
    get label() {
      return t("settings.taskbar");
    },
    get description() {
      return t("settings.taskbar.description");
    },
    default: true
  },
  previewTools: {
    type: "boolean",
    get label() {
      return t("settings.previewTools");
    },
    get description() {
      return t("settings.previewTools.description");
    },
    default: true
  },
  editFiles: {
    type: "boolean",
    get label() {
      return t("settings.editFiles");
    },
    get description() {
      return t("settings.editFiles.description");
    },
    default: true
  }
};
var state = {};
var isOn = (key) => !!state.ctx?.settings.get(key);
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
var uploadActions = import_api2.filters.byProps("addFiles", "setFile", "setUploads");
var messageActions = import_api2.filters.byProps("patchMessageAttachments", "editMessage", "endEditMessage");
var getCloudUpload = lookup(() => import_api2.find((v) => typeof v === "function" && typeof v.prototype?.uploadFileToCloud === "function" && typeof v.prototype?.upload === "function"));
var numbers = new Map;
function number(n) {
  const locale = import_api2.I18n.discordLocale;
  let format = numbers.get(locale);
  if (!format) {
    try {
      format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    } catch {
      format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
    }
    numbers.set(locale, format);
  }
  return format.format(n);
}
function formatSize(bytes) {
  const { unit, value } = size(bytes);
  return t(`size.${unit}`, { value: number(value) });
}
function formatLeft(seconds) {
  const { unit, count } = timeLeft(seconds);
  return t(`left.${unit}`, { count });
}
function formatPercent(fraction2) {
  return t("edit.percent", { percent: Math.floor(fraction2 * 100) });
}

// plugins/upload-tools/details.tsx
var jsx_runtime = require("react/jsx-runtime");
var CLOSE = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";
function CloseGlyph({ size: size2 = 16 }) {
  return /* @__PURE__ */ jsx_runtime.jsx("svg", {
    width: size2,
    height: size2,
    viewBox: "0 0 24 24",
    "aria-hidden": "true",
    children: /* @__PURE__ */ jsx_runtime.jsx("path", {
      fill: "currentColor",
      d: CLOSE
    })
  });
}
var itemTotal = (item) => Math.max(0, item.currentSize ?? 0);
var itemLoaded = (item) => item.status === "COMPLETED" ? itemTotal(item) : Math.min(itemTotal(item), Math.max(0, item.loaded ?? 0));
function UploadDetails({ channelId, file }) {
  import_api3.useLocale();
  const [meter] = import_api3.React.useState(() => new SpeedMeter);
  const [cancelled, setCancelled] = import_api3.React.useState(() => new Set);
  const [, tick] = import_api3.React.useState(0);
  const done = file.progress >= 100;
  import_api3.React.useEffect(() => {
    if (done)
      return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [done]);
  if (done)
    return null;
  const items = (file.items ?? []).filter((item) => item && !cancelled.has(item.id));
  const total = items.length ? items.reduce((sum, item) => sum + itemTotal(item), 0) : Math.max(0, file.currentSize);
  const loaded = items.length ? items.reduce((sum, item) => sum + itemLoaded(item), 0) : total * file.progress / 100;
  const speed = total > 0 ? meter.sample(loaded, total, performance.now()) : undefined;
  const stats = [
    speed && speed.rate > 0 ? t("details.speed", { size: formatSize(speed.rate) }) : t("details.starting"),
    speed?.secondsLeft !== undefined && speed.rate > 0 ? formatLeft(speed.secondsLeft) : undefined,
    total > 0 ? t("details.progress", { done: formatSize(loaded), total: formatSize(total) }) : undefined
  ].filter(Boolean).join(" · ");
  const cancel = (item) => {
    try {
      import_api3.Dispatcher.dispatch({ type: "UPLOAD_ITEM_CANCEL_REQUEST", channelId, file, itemId: item.id });
      setCancelled((prev) => new Set(prev).add(item.id));
    } catch (err) {
      state.ctx?.logger.error("Couldn't cancel", item.filename, err);
    }
  };
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    className: "evi-ut-details",
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        className: "evi-ut-stats",
        children: stats
      }),
      items.length > 1 && /* @__PURE__ */ jsx_runtime.jsx("ul", {
        className: "evi-ut-files",
        "aria-label": t("details.files"),
        children: items.map((item) => {
          const part = fraction(itemLoaded(item), itemTotal(item));
          const name = item.filename ?? "";
          const uploaded = item.status === "COMPLETED";
          return /* @__PURE__ */ jsx_runtime.jsxs("li", {
            className: "evi-ut-file",
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                className: "evi-ut-file-name",
                title: name,
                children: name
              }),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                className: "evi-ut-file-bar",
                "aria-hidden": "true",
                children: /* @__PURE__ */ jsx_runtime.jsx("span", {
                  style: { transform: `scaleX(${part})` }
                })
              }),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                className: "evi-ut-file-state",
                children: uploaded ? t("details.uploaded") : formatPercent(part)
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                className: "evi-ut-icon-button",
                "aria-label": t("details.cancel", { name }),
                title: t("details.cancel", { name }),
                onClick: () => cancel(item),
                children: /* @__PURE__ */ jsx_runtime.jsx(CloseGlyph, {})
              })
            ]
          }, item.id);
        })
      })
    ]
  });
}

// plugins/upload-tools/edit.tsx
var import_api4 = require("@evi/api");

// plugins/upload-tools/order.ts
function move(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length)
    return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
  return out;
}
function reorderShown(all, shown) {
  const ids = new Set(shown.map((u) => u.id));
  const queue = shown.filter((u) => all.some((a) => a.id === u.id));
  if (queue.length !== all.filter((a) => ids.has(a.id)).length)
    return [...all];
  let next = 0;
  return all.map((u) => ids.has(u.id) ? queue[next++] : u);
}
function nearestSlot(slots, x, y) {
  let best = -1, bestDistance = Infinity;
  slots.forEach((s, i) => {
    const d = (s.left + s.width / 2 - x) ** 2 + (s.top + s.height / 2 - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}
function shiftedIndex(index, from, to) {
  if (index === from)
    return to;
  if (from < to && index > from && index <= to)
    return index - 1;
  if (from > to && index >= to && index < from)
    return index + 1;
  return index;
}
var MAX_ATTACHMENTS = 10;
function roomFor(existing, pending, max = MAX_ATTACHMENTS) {
  return Math.max(0, max - existing - pending);
}
function editAttachments(existing, added) {
  return [
    ...existing.map((a) => ({ id: a.id })),
    ...added.map((u, i) => ({
      id: String(i),
      filename: u.filename,
      uploaded_filename: u.uploadedFilename,
      ...u.spoiler ? { is_spoiler: true } : {},
      ...u.description ? { description: u.description } : {}
    }))
  ];
}

// plugins/upload-tools/edit.tsx
var jsx_runtime2 = require("react/jsx-runtime");
var WEB = 1;
var ENTITY_TOO_LARGE = 40005;
var ATTACH_FILES = 1n << 15n;
var pending = new Map;
var saving = new Set;
var listeners = new Set;
var EMPTY = [];
var emitQueued = false;
function emit(now = false) {
  if (now) {
    emitQueued = false;
    for (const l of [...listeners])
      l();
    return;
  }
  if (emitQueued)
    return;
  emitQueued = true;
  setTimeout(() => emitQueued && emit(true), 100);
}
function cancelUpload(file) {
  try {
    file.upload?.cancel?.();
  } catch {}
}
function discard(messageId) {
  const entry = pending.get(messageId);
  if (!entry)
    return;
  pending.delete(messageId);
  entry.files.forEach(cancelUpload);
  emit(true);
}
function discardAll() {
  for (const id of [...pending.keys()])
    discard(id);
  saving.clear();
}
function onEditEnded(channelId, exceptMessageId) {
  for (const [id, entry] of pending) {
    if (entry.channelId === channelId && id !== exceptMessageId && !saving.has(id))
      discard(id);
  }
}
function addFiles(channelId, messageId, files) {
  const CloudUpload = getCloudUpload();
  if (!CloudUpload) {
    state.ctx?.toast(t("edit.unavailable"), { type: "failure" });
    return;
  }
  const entry = pending.get(messageId) ?? { channelId, files: [] };
  pending.set(messageId, entry);
  for (const file of files) {
    let upload;
    try {
      upload = new CloudUpload({ file, platform: WEB }, channelId);
    } catch (err) {
      state.ctx?.logger.error("Couldn't start uploading", file.name, err);
      continue;
    }
    const item = {
      key: String(upload.id ?? `${file.name}-${performance.now()}`),
      name: file.name,
      size: file.size,
      upload,
      loaded: 0,
      total: file.size,
      status: "uploading",
      done: Promise.resolve(false)
    };
    item.done = new Promise((resolve) => {
      upload.on("progress", (loaded, total) => {
        item.loaded = loaded;
        if (total > 0)
          item.total = total;
        emit();
      });
      upload.on("error", (code) => {
        item.status = "error";
        item.error = code === ENTITY_TOO_LARGE ? "tooBig" : "failed";
        emit(true);
        resolve(false);
      });
      upload.on("complete", () => {
        const ok = upload.status === "COMPLETED" && !!upload.uploadedFilename;
        if (ok)
          item.status = "uploaded";
        emit(true);
        resolve(ok);
      });
    });
    entry.files.push(item);
    try {
      Promise.resolve(upload.upload()).catch(() => {});
    } catch (err) {
      state.ctx?.logger.error("Couldn't upload", file.name, err);
    }
  }
  emit(true);
}
function removeFile(messageId, file) {
  const entry = pending.get(messageId);
  if (!entry)
    return;
  entry.files = entry.files.filter((f) => f !== file);
  cancelUpload(file);
  if (!entry.files.length)
    pending.delete(messageId);
  emit(true);
}
function take(messageId) {
  const files = pending.get(messageId)?.files ?? [];
  pending.delete(messageId);
  emit(true);
  return files;
}
async function commit(channelId, messageId, files, content) {
  const ctx = state.ctx;
  const results = await Promise.all(files.map((f) => f.done));
  const uploaded = files.filter((_, i) => results[i]);
  if (!uploaded.length)
    return;
  const actions = import_api4.find(messageActions);
  const message = import_api4.getStore("MessageStore")?.getMessage?.(channelId, messageId);
  if (typeof actions?.patchMessageAttachments !== "function" || !message) {
    ctx?.toast(t("edit.unavailable"), { type: "failure" });
    uploaded.forEach(cancelUpload);
    return;
  }
  const attachments = editAttachments(message.attachments ?? [], uploaded.map((f) => ({
    filename: f.upload.filename ?? f.name,
    uploadedFilename: f.upload.uploadedFilename,
    spoiler: !!f.upload.spoiler,
    description: f.upload.description
  })));
  try {
    await actions.patchMessageAttachments(channelId, messageId, attachments);
    if (content !== undefined)
      await actions.editMessage(channelId, messageId, { content });
  } catch (err) {
    ctx?.logger.error("Couldn't add the files", err);
    (state.ctx ?? ctx)?.toast(t("edit.saveFailed", { reason: err?.body?.message ?? err?.message ?? t("edit.failed") }), { type: "failure" });
    uploaded.forEach(cancelUpload);
  }
}
var ORIGINAL = Symbol.for("evi.uploadTools.onSubmit");
var wrappers = new WeakMap;
function wrapSubmit(editor) {
  if (!editor || typeof editor.onSubmit !== "function" || wrappers.get(editor) === editor.onSubmit)
    return;
  const original = editor[ORIGINAL] ?? editor.onSubmit;
  editor[ORIGINAL] = original;
  const wrapper = (value) => submit(editor, value, original);
  wrappers.set(editor, wrapper);
  editor.onSubmit = wrapper;
}
function submit(editor, value, original) {
  const { channel, message, onCancel } = editor.props ?? {};
  const files = state.ctx && message?.id ? pending.get(message.id)?.files ?? EMPTY : EMPTY;
  if (!files.length)
    return original.call(editor, value);
  try {
    const nothingElse = !message.attachments?.length && !message.components?.length && !message.stickerItems?.length && !message.stickers?.length;
    if (typeof value === "string" && value.length === 0 && nothingElse) {
      const taken = take(message.id);
      onCancel?.(channel.id);
      commit(channel.id, message.id, taken, "");
      return Promise.resolve({ shouldClear: true, shouldRefocus: true });
    }
  } catch (err) {
    state.ctx?.logger.error("Couldn't save with files", err);
  }
  saving.add(message.id);
  const done = () => void saving.delete(message.id);
  return Promise.resolve(original.call(editor, value)).then((result) => {
    done();
    if (result?.shouldClear)
      commit(channel.id, message.id, take(message.id));
    return result;
  }, (err) => {
    done();
    throw err;
  });
}
function usePending(messageId) {
  const [, rerender] = import_api4.React.useReducer((n) => n + 1, 0);
  import_api4.React.useEffect(() => {
    const listener = () => rerender();
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return pending.get(messageId)?.files ?? EMPTY;
}
function canAttach(channel) {
  if (!channel)
    return false;
  const isPrivate = typeof channel.isPrivate === "function" ? channel.isPrivate() : !channel.guild_id;
  if (isPrivate)
    return true;
  const can = import_api4.getStore("PermissionStore")?.can;
  return typeof can === "function" ? !!can.call(import_api4.getStore("PermissionStore"), ATTACH_FILES, channel) : true;
}
var PLUS = "M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z";
function stateText(file) {
  if (file.status === "error")
    return file.error === "tooBig" ? t("edit.tooBig") : t("edit.failed");
  if (file.status === "uploaded")
    return formatSize(file.size);
  return formatPercent(fraction(file.loaded, file.total));
}
function EditFiles({ channel, message }) {
  import_api4.useLocale();
  const files = usePending(message.id);
  const root = import_api4.React.useRef(null);
  const input = import_api4.React.useRef(null);
  const editing = import_api4.getStore("EditMessageStore")?.isEditing?.(channel?.id, message.id);
  if (!isOn("editFiles") || !editing || !canAttach(channel))
    return null;
  const room = roomFor(message.attachments?.length ?? 0, files.length);
  const focusEditor = () => requestAnimationFrame(() => root.current?.parentElement?.querySelector('[role="textbox"], textarea')?.focus());
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    ref: root,
    className: "evi-ut-edit",
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("button", {
        type: "button",
        className: "evi-ut-add",
        disabled: !room,
        title: room ? undefined : t("edit.full", { max: MAX_ATTACHMENTS }),
        onClick: () => input.current?.click(),
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("svg", {
            width: 16,
            height: 16,
            viewBox: "0 0 24 24",
            "aria-hidden": "true",
            children: /* @__PURE__ */ jsx_runtime2.jsx("path", {
              fill: "currentColor",
              d: PLUS
            })
          }),
          t("edit.add")
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("input", {
        ref: input,
        type: "file",
        multiple: true,
        hidden: true,
        onChange: (e) => {
          const picked = [...e.currentTarget.files ?? []].slice(0, room);
          e.currentTarget.value = "";
          if (picked.length)
            addFiles(channel.id, message.id, picked);
          focusEditor();
        }
      }),
      files.length > 0 && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        className: "evi-ut-edit-note",
        children: t("edit.pending", { count: files.length })
      }),
      files.length > 0 && /* @__PURE__ */ jsx_runtime2.jsx("ul", {
        className: "evi-ut-chips",
        children: files.map((file) => /* @__PURE__ */ jsx_runtime2.jsxs("li", {
          className: "evi-ut-chip",
          "data-state": file.status,
          children: [
            file.status === "uploading" && /* @__PURE__ */ jsx_runtime2.jsx("span", {
              className: "evi-ut-chip-fill",
              "aria-hidden": "true",
              style: { transform: `scaleX(${fraction(file.loaded, file.total)})` }
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
              className: "evi-ut-chip-name",
              title: file.name,
              children: file.name
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
              className: "evi-ut-chip-state",
              children: stateText(file)
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              className: "evi-ut-icon-button",
              "aria-label": t("edit.remove", { name: file.name }),
              title: t("edit.remove", { name: file.name }),
              onClick: () => {
                removeFile(message.id, file);
                focusEditor();
              },
              children: /* @__PURE__ */ jsx_runtime2.jsx(CloseGlyph, {
                size: 14
              })
            })
          ]
        }, file.key))
      })
    ]
  });
}
function subscribeEdits() {
  const ctx = state.ctx;
  if (!ctx)
    return;
  ctx.flux.subscribe("MESSAGE_END_EDIT", (action) => action?.channelId && onEditEnded(action.channelId));
  ctx.flux.subscribe("MESSAGE_START_EDIT", (action) => action?.channelId && onEditEnded(action.channelId, action.messageId));
  ctx.onDispose(discardAll);
}

// plugins/upload-tools/preview.tsx
var import_api5 = require("@evi/api");
var jsx_runtime3 = require("react/jsx-runtime");
var EYE = "M12 5C6.5 5 2.73 9.11 1.5 12c1.23 2.89 5 7 10.5 7s9.27-4.11 10.5-7C21.27 9.11 17.5 5 12 5Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z";
var EYE_OFF = "M2.3 3.7a1 1 0 0 1 1.4-1.4l18 18a1 1 0 0 1-1.4 1.4l-3.04-3.03A11.6 11.6 0 0 1 12 19c-5.5 0-9.27-4.11-10.5-7a12.9 12.9 0 0 1 3.75-4.84L2.3 3.7Zm6.3 6.3a4 4 0 0 0 5.4 5.4l-1.53-1.53a2 2 0 0 1-2.34-2.34L8.6 10ZM12 5c5.5 0 9.27 4.11 10.5 7a13.3 13.3 0 0 1-2.86 4.03L15.9 12.3a4 4 0 0 0-4.2-4.2L9.33 5.73A11.6 11.6 0 0 1 12 5Z";
var DRAG_FROM_PX = 5;
var SETTLE_MS = 160;
var EDGE_PX = 48;
function setUploads(channelId, draftType, shown) {
  const actions = import_api5.find(uploadActions);
  if (typeof actions?.setUploads !== "function")
    return false;
  const store = import_api5.getStore("UploadAttachmentStore");
  const all = store?.getUploads?.(channelId, draftType) ?? shown;
  actions.setUploads({ channelId, draftType, uploads: reorderShown(all, shown) });
  return true;
}
function clearShift(list) {
  list.classList.remove("evi-ut-sorting");
  for (const el of list.children) {
    if (!(el instanceof HTMLElement))
      continue;
    el.classList.remove("evi-ut-dragged", "evi-ut-settling");
    el.style.removeProperty("transform");
  }
}
function scrollerOf(el) {
  for (let node = el;node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth || /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
      return node;
  }
  return document.documentElement;
}
function attachSorting(list, tools, source) {
  const tiles = () => [...list.children].filter((el) => el instanceof HTMLElement && el.tagName === "LI" && el !== tools);
  let pressed;
  let drag;
  let settling;
  let scrolling = 0;
  const contentPoint = (x, y) => drag ? { x: x + drag.scroller.scrollLeft, y: y + drag.scroller.scrollTop } : { x, y };
  function layout() {
    if (!drag)
      return;
    const { x, y } = contentPoint(drag.x, drag.y);
    drag.to = Math.max(0, nearestSlot(drag.slots, x, y));
    drag.tile.style.transform = `translate(${x - drag.startX}px, ${y - drag.startY}px)`;
    drag.all.forEach((el, i) => {
      if (i === drag.from)
        return;
      const at = shiftedIndex(i, drag.from, drag.to);
      const dx = drag.slots[at].left - drag.slots[i].left, dy = drag.slots[at].top - drag.slots[i].top;
      if (dx || dy)
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      else
        el.style.removeProperty("transform");
    });
  }
  function autoScroll() {
    scrolling = 0;
    if (!drag)
      return;
    const box = drag.scroller.getBoundingClientRect();
    const step = (p, start, end) => p < start + EDGE_PX ? -Math.ceil((start + EDGE_PX - p) / 4) : p > end - EDGE_PX ? Math.ceil((p - end + EDGE_PX) / 4) : 0;
    const dx = drag.scroller.scrollWidth > drag.scroller.clientWidth ? step(drag.x, box.left, box.right) : 0;
    const dy = drag.scroller.scrollHeight > drag.scroller.clientHeight ? step(drag.y, box.top, box.bottom) : 0;
    if (!dx && !dy)
      return;
    drag.scroller.scrollBy(dx, dy);
    layout();
    scrolling = requestAnimationFrame(autoScroll);
  }
  function begin() {
    if (!pressed)
      return;
    const all = tiles();
    if (all.length !== source.uploads().length || all.indexOf(pressed.tile) !== pressed.from)
      return void (pressed = undefined);
    const scroller = scrollerOf(list);
    const slots = all.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left + scroller.scrollLeft, top: r.top + scroller.scrollTop, width: r.width, height: r.height };
    });
    drag = {
      tile: pressed.tile,
      from: pressed.from,
      to: pressed.from,
      all,
      slots,
      scroller,
      pointerId: pressed.pointerId,
      startX: pressed.x + scroller.scrollLeft,
      startY: pressed.y + scroller.scrollTop,
      x: pressed.x,
      y: pressed.y
    };
    pressed = undefined;
    try {
      list.setPointerCapture(drag.pointerId);
    } catch {}
    list.classList.add("evi-ut-sorting");
    drag.tile.classList.add("evi-ut-dragged");
  }
  function swallowClick() {
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("click", stop, true);
    setTimeout(() => window.removeEventListener("click", stop, true), 0);
  }
  function finish(commit2) {
    const done = drag;
    drag = undefined;
    cancelAnimationFrame(scrolling);
    if (!done)
      return;
    try {
      list.releasePointerCapture(done.pointerId);
    } catch {}
    const to = commit2 ? done.to : done.from;
    if (!commit2)
      done.all.forEach((el, i) => i !== done.from && el.style.removeProperty("transform"));
    done.tile.classList.add("evi-ut-settling");
    const target = done.slots[to], origin = done.slots[done.from];
    done.tile.style.transform = target.left === origin.left && target.top === origin.top ? "translate(0px, 0px)" : `translate(${target.left - origin.left}px, ${target.top - origin.top}px)`;
    settling = setTimeout(() => {
      settling = undefined;
      const uploads = source.uploads();
      if (to === done.from || uploads.length !== done.all.length || !source.commit(move(uploads, done.from, to)))
        clearShift(list);
    }, SETTLE_MS);
  }
  const onDown = (e) => {
    if (e.button !== 0 || drag || settling)
      return;
    const tile = e.target?.closest?.("li");
    if (!(tile instanceof HTMLElement) || tile.parentElement !== list || tile === tools)
      return;
    pressed = { tile, from: tiles().indexOf(tile), x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  };
  const onMove = (e) => {
    if (pressed && e.pointerId === pressed.pointerId && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) >= DRAG_FROM_PX)
      begin();
    if (!drag || e.pointerId !== drag.pointerId)
      return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    layout();
    if (!scrolling)
      scrolling = requestAnimationFrame(autoScroll);
  };
  const onUp = (e) => {
    pressed = undefined;
    if (!drag || e.pointerId !== drag.pointerId)
      return;
    swallowClick();
    finish(e.type === "pointerup");
  };
  const onKey = (e) => {
    if (drag && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return finish(false);
    }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key !== "ArrowLeft" && e.key !== "ArrowRight" || drag || settling)
      return;
    const tile = e.target?.closest?.("li");
    if (!(tile instanceof HTMLElement) || tile.parentElement !== list || tile === tools)
      return;
    const all = tiles(), uploads = source.uploads();
    const from = all.indexOf(tile);
    const rtl = getComputedStyle(list).direction === "rtl";
    const to = from + (e.key === "ArrowRight" !== rtl ? 1 : -1);
    if (from < 0 || to < 0 || to >= all.length || all.length !== uploads.length)
      return;
    e.preventDefault();
    e.stopPropagation();
    if (source.commit(move(uploads, from, to)))
      requestAnimationFrame(() => tile.isConnected && tile.focus());
  };
  const onDragStart = (e) => {
    if (e.target?.closest?.("li") !== tools)
      e.preventDefault();
  };
  list.classList.add("evi-ut-sortable");
  list.addEventListener("pointerdown", onDown);
  list.addEventListener("pointermove", onMove);
  list.addEventListener("pointerup", onUp);
  list.addEventListener("pointercancel", onUp);
  list.addEventListener("keydown", onKey, true);
  list.addEventListener("dragstart", onDragStart);
  return () => {
    list.removeEventListener("pointerdown", onDown);
    list.removeEventListener("pointermove", onMove);
    list.removeEventListener("pointerup", onUp);
    list.removeEventListener("pointercancel", onUp);
    list.removeEventListener("keydown", onKey, true);
    list.removeEventListener("dragstart", onDragStart);
    cancelAnimationFrame(scrolling);
    clearTimeout(settling);
    drag = pressed = undefined;
    clearShift(list);
    list.classList.remove("evi-ut-sortable");
  };
}
function Tools({ uploads, channelId, draftType }) {
  import_api5.useLocale();
  const ref = import_api5.React.useRef(null);
  const latest = import_api5.React.useRef(uploads);
  latest.current = uploads;
  const order = uploads.map((u) => u.id).join(",");
  import_api5.React.useLayoutEffect(() => {
    const list = ref.current?.parentElement;
    if (list)
      clearShift(list);
  }, [order]);
  import_api5.React.useEffect(() => {
    const tools = ref.current, list = tools?.parentElement;
    if (!tools || !list)
      return;
    return attachSorting(list, tools, {
      uploads: () => latest.current,
      commit: (shown) => {
        try {
          return setUploads(channelId, draftType, shown);
        } catch (err) {
          state.ctx?.logger.error("Couldn't reorder", err);
          return false;
        }
      }
    });
  }, [channelId, draftType]);
  const allSpoilers = uploads.every((u) => u.spoiler);
  const label = allSpoilers ? t("tools.unspoilerAll") : t("tools.spoilerAll");
  const toggle = () => {
    const actions = import_api5.find(uploadActions);
    if (typeof actions?.update !== "function")
      return;
    for (const u of uploads) {
      if (!!u.spoiler === !allSpoilers)
        continue;
      actions.update(channelId, u.id, draftType, { spoiler: !allSpoilers });
    }
  };
  const button = /* @__PURE__ */ jsx_runtime3.jsx("button", {
    type: "button",
    className: "evi-ut-tool",
    "aria-label": label,
    "aria-pressed": allSpoilers,
    onClick: toggle,
    children: /* @__PURE__ */ jsx_runtime3.jsx("svg", {
      width: 20,
      height: 20,
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx_runtime3.jsx("path", {
        fill: "currentColor",
        d: allSpoilers ? EYE_OFF : EYE
      })
    })
  });
  const Tooltip = import_api5.Components.Tooltip;
  return /* @__PURE__ */ jsx_runtime3.jsx("li", {
    ref,
    className: "evi-ut-tools",
    "aria-label": t("tools.label"),
    children: Tooltip ? /* @__PURE__ */ jsx_runtime3.jsx(Tooltip, {
      text: label,
      children: button
    }) : import_api5.React.cloneElement(button, { title: label })
  });
}
function withTools(tiles, uploads, channelId, draftType) {
  if (!isOn("previewTools") || !Array.isArray(tiles) || !Array.isArray(uploads) || uploads.length < 2)
    return tiles;
  return [...tiles, /* @__PURE__ */ jsx_runtime3.jsx(Tools, {
    uploads,
    channelId,
    draftType
  }, "evi-upload-tools")];
}

// plugins/upload-tools/index.tsx
var jsx_runtime4 = require("react/jsx-runtime");
var pendingUploadFilter = import_api6.filters.componentByCode("getMessageForFile", "currentSize>0");
var editorCode = import_api6.filters.byCode("validateEdit", "onConfirmDelete", "renderLeftAccessories");
var editorFilter = Object.assign((v) => typeof v?.prototype?.render === "function" && editorCode(v), {
  $code: editorCode.$code,
  $label: `class with ${editorCode.$label}`
});
var TASKBAR_EVERY_MS = 250;
function setTaskbar(value) {
  try {
    window.DiscordNative?.window?.setProgressBar?.(value);
  } catch {}
}
var upload_tools_default = import_api6.definePlugin({
  settings,
  patches: [
    {
      find: 'subscribe("APPLICATION_COMMAND_SET_ACTIVE_COMMAND"',
      replace: {
        match: /(\i)\.map\((\i)=>\(0,\i\.jsx\)\(\i\.\i,\{channelId:(\i),draftType:(\i)\.drafts\.type,upload:\2,[^{}]*\},\2\.id\)\)/,
        with: "($self?.tiles?.($&,$1,$3,$4.drafts.type)??$&)"
      }
    }
  ],
  tiles(tiles, uploads, channelId, draftType) {
    try {
      return withTools(tiles, uploads, channelId, draftType);
    } catch (err) {
      state.ctx?.logger.error("Couldn't add the upload tools", err);
      return tiles;
    }
  },
  start(ctx) {
    state.ctx = ctx;
    ctx.onDispose(() => void (state.ctx = undefined));
    ctx.hookExport("after", pendingUploadFilter, ({ args, result }) => {
      const props = args[0];
      if (!result || !props?.file || !props.channelId || !isOn("details"))
        return;
      return /* @__PURE__ */ jsx_runtime4.jsxs(jsx_runtime4.Fragment, {
        children: [
          result,
          /* @__PURE__ */ jsx_runtime4.jsx(UploadDetails, {
            channelId: props.channelId,
            file: props.file
          })
        ]
      });
    });
    ctx.waitFor(editorFilter, (Editor) => {
      if (typeof Editor?.prototype?.render !== "function")
        return;
      ctx.hook.before(Editor.prototype, "render", ({ self }) => {
        if (isOn("editFiles"))
          wrapSubmit(self);
      });
      ctx.hook.after(Editor.prototype, "render", ({ self, result }) => {
        const { channel, message } = self?.props ?? {};
        if (!result || !channel || !message?.id || !isOn("editFiles"))
          return;
        const element = result;
        return import_api6.React.cloneElement(element, undefined, ...import_api6.React.Children.toArray(element.props.children), /* @__PURE__ */ jsx_runtime4.jsx(EditFiles, {
          channel,
          message
        }, "evi-upload-tools-edit"));
      });
    });
    subscribeEdits();
    const transfers = new Map;
    let shown = -1;
    let queued = false;
    const paint = () => {
      queued = false;
      const value = isOn("taskbar") ? overall(transfers.values()) : -1;
      if (value === shown)
        return;
      shown = value;
      setTaskbar(value);
    };
    const schedule = () => {
      if (queued)
        return;
      queued = true;
      ctx.setTimeout(paint, TASKBAR_EVERY_MS);
    };
    const track = ({ file }) => {
      if (!file?.id)
        return;
      const total = Math.max(0, file.currentSize ?? 0);
      transfers.set(file.id, { loaded: total * Math.max(0, file.progress ?? 0) / 100, total });
      schedule();
    };
    const untrack = ({ file }) => {
      if (file?.id && transfers.delete(file.id))
        schedule();
    };
    ctx.flux.subscribe("UPLOAD_START", track);
    ctx.flux.subscribe("UPLOAD_PROGRESS", (action) => {
      if (action.file?.id && transfers.has(action.file.id))
        track(action);
    });
    ctx.flux.subscribe("UPLOAD_COMPLETE", untrack);
    ctx.flux.subscribe("UPLOAD_FAIL", untrack);
    ctx.flux.subscribe("UPLOAD_CANCEL_REQUEST", untrack);
    ctx.settings.onChange(paint);
    ctx.onDispose(() => {
      if (shown !== -1)
        setTaskbar(-1);
    });
  },
  css: `
@keyframes evi-ut-in {
    from { opacity: 0; transform: translateY(-2px); }
}

/* Upload details */
.evi-ut-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-inline-size: 520px;
    margin-block-start: 6px;
}
.evi-ut-stats {
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
}
.evi-ut-files { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.evi-ut-file {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px 72px 24px;
    align-items: center;
    gap: 10px;
    min-block-size: 28px;
    padding: 2px 2px 2px 8px;
    border-radius: 6px;
    font-size: 13px;
    animation: evi-ut-in 0.18s ease-out;
}
.evi-ut-file:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.04)); }
.evi-ut-file-name { overflow: hidden; color: var(--text-normal, #dbdee1); text-overflow: ellipsis; white-space: nowrap; }
.evi-ut-file-bar {
    block-size: 4px;
    border-radius: 2px;
    background: var(--background-modifier-accent, rgb(255 255 255 / 0.1));
    overflow: hidden;
}
.evi-ut-file-bar > span {
    display: block;
    block-size: 100%;
    background: var(--brand-500, #5865f2);
    transform-origin: left;
    transition: transform 0.2s linear;
}
.evi-ut-file-state { color: var(--text-muted, #949ba4); font-size: 12px; text-align: end; font-variant-numeric: tabular-nums; }
.evi-ut-icon-button {
    display: grid;
    place-items: center;
    inline-size: 24px;
    block-size: 24px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--interactive-normal, #b5bac1);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-ut-icon-button:hover { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); color: var(--interactive-hover, #dbdee1); }
.evi-ut-icon-button:focus-visible, .evi-ut-tool:focus-visible, .evi-ut-add:focus-visible { outline: 2px solid var(--focus-primary, #00a8fc); outline-offset: 1px; }

/* Upload tools, after the preview's tiles */
.evi-ut-tools {
    display: flex;
    flex: none;
    align-items: center;
    align-self: stretch;
    padding-inline: 4px 8px;
    list-style: none;
}
.evi-ut-tool {
    display: grid;
    place-items: center;
    inline-size: 36px;
    block-size: 36px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: var(--background-modifier-hover, rgb(255 255 255 / 0.06));
    color: var(--interactive-normal, #b5bac1);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
}
.evi-ut-tool:hover { background: var(--background-modifier-selected, rgb(255 255 255 / 0.1)); color: var(--interactive-hover, #dbdee1); }
.evi-ut-tool[aria-pressed="true"] { color: var(--interactive-active, #fff); }
.evi-ut-sortable > li:not(.evi-ut-tools) { cursor: grab; }
.evi-ut-sorting { user-select: none; }
.evi-ut-sorting > li:not(.evi-ut-tools) { position: relative; cursor: grabbing; transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1); }
.evi-ut-sorting > li.evi-ut-dragged { z-index: 2; transition: none; }
.evi-ut-sorting > li.evi-ut-dragged.evi-ut-settling { transition: transform 0.16s cubic-bezier(0.2, 0, 0, 1); }
.evi-ut-dragged > * {
    border-radius: 8px;
    box-shadow: var(--shadow-high, 0 8px 24px rgb(0 0 0 / 0.35));
    transform: scale(1.04);
    transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.evi-ut-settling > * { transform: none; box-shadow: none; }

/* Adding files while editing */
.evi-ut-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding-block-start: 4px;
    font-size: 12px;
    line-height: 16px;
}
.evi-ut-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--text-link, #00a8fc);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s;
}
.evi-ut-add:hover:not(:disabled) { background: var(--background-modifier-hover, rgb(255 255 255 / 0.06)); }
.evi-ut-add:disabled { color: var(--text-muted, #949ba4); cursor: not-allowed; }
.evi-ut-edit-note { color: var(--text-muted, #949ba4); }
.evi-ut-chips { display: flex; flex-basis: 100%; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.evi-ut-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-inline-size: 280px;
    padding: 2px 2px 2px 10px;
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 0.08));
    border-radius: 8px;
    background: var(--background-base-lowest, var(--background-tertiary, #1e1f22));
    overflow: hidden;
    animation: evi-ut-in 0.18s ease-out;
}
.evi-ut-chip > :not(.evi-ut-chip-fill) { position: relative; }
.evi-ut-chip-fill {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--brand-500, #5865f2) 18%, transparent);
    transform-origin: left;
    transition: transform 0.2s linear;
}
.evi-ut-chip-name { min-inline-size: 0; overflow: hidden; color: var(--text-normal, #dbdee1); text-overflow: ellipsis; white-space: nowrap; }
.evi-ut-chip-state { flex: none; color: var(--text-muted, #949ba4); font-variant-numeric: tabular-nums; }
.evi-ut-chip[data-state="error"] { border-color: var(--status-danger, #f23f43); }
.evi-ut-chip[data-state="error"] .evi-ut-chip-state { color: var(--text-feedback-critical, #f23f43); }

@media (prefers-reduced-motion: reduce) {
    .evi-ut-file, .evi-ut-chip { animation: none; }
    .evi-ut-sorting > li:not(.evi-ut-tools), .evi-ut-dragged > *, .evi-ut-sorting > li.evi-ut-dragged.evi-ut-settling { transition: none; }
}
`
});
