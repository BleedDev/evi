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

// plugins/strip-metadata/index.ts
var exports_strip_metadata = {};
__export(exports_strip_metadata, {
  default: () => strip_metadata_default
});
module.exports = __toCommonJS(exports_strip_metadata);
var import_api3 = require("@evi/api");

// plugins/strip-metadata/args.ts
var isPlain = (v) => !!v && typeof v === "object" && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype);
function collectFiles(value, found = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 4)
    return found;
  const entries = Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
  for (const [key, v] of entries) {
    if (v instanceof File)
      found.push({ owner: value, key, file: v });
    else if (isPlain(v))
      collectFiles(v, found, depth + 1);
  }
  return found;
}
function dropIn(value, drop, depth) {
  if (!isPlain(value) || depth > 4)
    return true;
  if (Array.isArray(value)) {
    for (let i = value.length - 1;i >= 0; i--) {
      const v = value[i];
      const holds = v instanceof File ? drop.has(v) : isPlain(v) && !Array.isArray(v) && Object.values(v).some((x) => x instanceof File && drop.has(x));
      if (holds)
        value.splice(i, 1);
      else if (!dropIn(v, drop, depth + 1))
        return false;
    }
    return true;
  }
  for (const v of Object.values(value)) {
    if (v instanceof File ? drop.has(v) : !dropIn(v, drop, depth + 1))
      return false;
  }
  return true;
}
function dropFiles(args, drop) {
  return args.every((arg) => arg instanceof File ? !drop.has(arg) : dropIn(arg, drop, 1));
}
function uploadFile(upload) {
  const file = upload?.item?.file;
  return file instanceof File ? file : undefined;
}
function swapUploadFile(upload, file) {
  if (!upload.item)
    return;
  upload.item.file = file;
  upload.currentSize = file.size;
  if (typeof upload.setFilename === "function")
    upload.setFilename(file.name);
}

// plugins/strip-metadata/dialog.tsx
var import_api2 = require("@evi/api");

// plugins/strip-metadata/strings.ts
var import_api = require("@evi/api");
var t = import_api.defineStrings({
  en: {
    "settings.stripImages": "Strip image metadata",
    "settings.stripImages.description": "Remove EXIF (camera, GPS location, dates), XMP and text chunks from JPEG, PNG, WebP and GIF images. Images it can't clean, like HEIC photos, are only uploaded if you say so.",
    "settings.randomNames": "Random file names",
    "settings.randomNames.description": "Upload files with a random name, keeping the extension.",
    "dialog.title": { one: "Upload this image with its details?", other: "Upload these images with their details?" },
    "dialog.body": {
      one: "Couldn't remove the location and camera details from {name}. Anyone who saves it may see where and when it was taken.",
      other: "Couldn't remove the location and camera details from {count} images: {name}. Anyone who saves them may see where and when they were taken."
    },
    "dialog.upload": { one: "Upload as it is", other: "Upload as they are" },
    "dialog.skip": "Don't upload",
    "toast.notUploaded": {
      one: "{name} wasn't uploaded: its location and camera details couldn't be removed.",
      other: "{name} weren't uploaded: their location and camera details couldn't be removed."
    }
  },
  get de() {
    return Object.defineProperty(this, "de", { value: {
      "settings.stripImages": "Bild-Metadaten entfernen",
      "settings.stripImages.description": "Entfernt EXIF (Kamera, GPS-Standort, Datum), XMP und Textblöcke aus JPEG-, PNG-, WebP- und GIF-Bildern. Bilder, die es nicht bereinigen kann, etwa HEIC-Fotos, werden nur hochgeladen, wenn du zustimmst.",
      "settings.randomNames": "Zufällige Dateinamen",
      "settings.randomNames.description": "Lädt Dateien mit einem zufälligen Namen hoch und behält die Dateiendung bei.",
      "dialog.title": { one: "Dieses Bild mit seinen Details hochladen?", other: "Diese Bilder mit ihren Details hochladen?" },
      "dialog.body": {
        one: "Standort und Kameradaten konnten nicht aus {name} entfernt werden. Wer es speichert, kann sehen, wo und wann es aufgenommen wurde.",
        other: "Standort und Kameradaten konnten nicht aus {count} Bildern entfernt werden: {name}. Wer sie speichert, kann sehen, wo und wann sie aufgenommen wurden."
      },
      "dialog.upload": "Unverändert hochladen",
      "dialog.skip": "Nicht hochladen",
      "toast.notUploaded": {
        one: "{name} wurde nicht hochgeladen: Standort und Kameradaten ließen sich nicht entfernen.",
        other: "{name} wurden nicht hochgeladen: Standort und Kameradaten ließen sich nicht entfernen."
      }
    } })["de"];
  },
  get es() {
    return Object.defineProperty(this, "es", { value: {
      "settings.stripImages": "Eliminar metadatos de imágenes",
      "settings.stripImages.description": "Quita EXIF (cámara, ubicación GPS, fechas), XMP y bloques de texto de las imágenes JPEG, PNG, WebP y GIF. Las imágenes que no puede limpiar, como las fotos HEIC, solo se suben si tú lo dices.",
      "settings.randomNames": "Nombres de archivo aleatorios",
      "settings.randomNames.description": "Sube los archivos con un nombre aleatorio y conserva la extensión.",
      "dialog.title": { one: "¿Subir esta imagen con sus datos?", other: "¿Subir estas imágenes con sus datos?" },
      "dialog.body": {
        one: "No se pudieron quitar la ubicación ni los datos de la cámara de {name}. Quien la guarde podrá ver dónde y cuándo se tomó.",
        other: "No se pudieron quitar la ubicación ni los datos de la cámara de {count} imágenes: {name}. Quien las guarde podrá ver dónde y cuándo se tomaron."
      },
      "dialog.upload": "Subir tal cual",
      "dialog.skip": "No subir",
      "toast.notUploaded": {
        one: "{name} no se subió: no se pudieron quitar su ubicación ni los datos de la cámara.",
        other: "{name} no se subieron: no se pudieron quitar su ubicación ni los datos de la cámara."
      }
    } })["es"];
  },
  get fr() {
    return Object.defineProperty(this, "fr", { value: {
      "settings.stripImages": "Supprimer les métadonnées des images",
      "settings.stripImages.description": "Retire les données EXIF (appareil photo, position GPS, dates), XMP et les blocs de texte des images JPEG, PNG, WebP et GIF. Les images qu'il ne peut pas nettoyer, comme les photos HEIC, ne sont envoyées que si tu le décides.",
      "settings.randomNames": "Noms de fichiers aléatoires",
      "settings.randomNames.description": "Envoie les fichiers avec un nom aléatoire en gardant l'extension.",
      "dialog.title": { one: "Envoyer cette image avec ses informations ?", other: "Envoyer ces images avec leurs informations ?" },
      "dialog.body": {
        one: "Impossible de retirer la position et les informations de l'appareil photo de {name}. Quiconque l'enregistre pourra voir où et quand elle a été prise.",
        other: "Impossible de retirer la position et les informations de l'appareil photo de {count} images : {name}. Quiconque les enregistre pourra voir où et quand elles ont été prises."
      },
      "dialog.upload": { one: "Envoyer telle quelle", other: "Envoyer telles quelles" },
      "dialog.skip": "Ne pas envoyer",
      "toast.notUploaded": {
        one: "{name} n'a pas été envoyée : impossible d'en retirer la position et les informations de l'appareil photo.",
        other: "{name} n'ont pas été envoyées : impossible d'en retirer la position et les informations de l'appareil photo."
      }
    } })["fr"];
  },
  get ja() {
    return Object.defineProperty(this, "ja", { value: {
      "settings.stripImages": "画像のメタデータを削除",
      "settings.stripImages.description": "JPEG、PNG、WebP、GIF画像からEXIF(カメラ、GPS位置情報、日付)、XMP、テキストチャンクを取り除きます。HEIC写真など削除できない画像は、あなたが選んだときだけアップロードされます。",
      "settings.randomNames": "ランダムなファイル名",
      "settings.randomNames.description": "拡張子はそのままに、ランダムな名前でファイルをアップロードします。",
      "dialog.title": "詳細情報が残ったままアップロードしますか?",
      "dialog.body": "{name} から位置情報とカメラ情報を削除できませんでした。保存した人は、撮影された場所と日時を見られる可能性があります。",
      "dialog.upload": "そのままアップロード",
      "dialog.skip": "アップロードしない",
      "toast.notUploaded": "{name} はアップロードされませんでした。位置情報とカメラ情報を削除できませんでした。"
    } })["ja"];
  },
  get pl() {
    return Object.defineProperty(this, "pl", { value: {
      "settings.stripImages": "Usuwaj metadane obrazów",
      "settings.stripImages.description": "Usuwa EXIF (aparat, lokalizację GPS, daty), XMP i bloki tekstowe z obrazów JPEG, PNG, WebP i GIF. Obrazy, których nie da się wyczyścić, np. zdjęcia HEIC, są przesyłane tylko wtedy, gdy się na to zgodzisz.",
      "settings.randomNames": "Losowe nazwy plików",
      "settings.randomNames.description": "Przesyła pliki pod losową nazwą, zachowując rozszerzenie.",
      "dialog.title": { one: "Przesłać ten obraz razem z jego danymi?", other: "Przesłać te obrazy razem z ich danymi?" },
      "dialog.body": {
        one: "Nie udało się usunąć lokalizacji ani danych aparatu z {name}. Każdy, kto zapisze ten plik, może zobaczyć, gdzie i kiedy zrobiono zdjęcie.",
        other: "Nie udało się usunąć lokalizacji ani danych aparatu z {count} obrazów: {name}. Każdy, kto zapisze te pliki, może zobaczyć, gdzie i kiedy zrobiono zdjęcia."
      },
      "dialog.upload": "Prześlij bez zmian",
      "dialog.skip": "Nie przesyłaj",
      "toast.notUploaded": "Nie przesłano {name}: nie udało się usunąć lokalizacji ani danych aparatu."
    } })["pl"];
  },
  get "pt-BR"() {
    return Object.defineProperty(this, "pt-BR", { value: {
      "settings.stripImages": "Remover metadados de imagens",
      "settings.stripImages.description": "Remove EXIF (câmera, localização GPS, datas), XMP e blocos de texto de imagens JPEG, PNG, WebP e GIF. Imagens que ele não consegue limpar, como fotos HEIC, só são enviadas se você quiser.",
      "settings.randomNames": "Nomes de arquivo aleatórios",
      "settings.randomNames.description": "Envia os arquivos com um nome aleatório, mantendo a extensão.",
      "dialog.title": { one: "Enviar esta imagem com os dados dela?", other: "Enviar estas imagens com os dados delas?" },
      "dialog.body": {
        one: "Não foi possível remover a localização e os dados da câmera de {name}. Quem salvar a imagem pode ver onde e quando ela foi tirada.",
        other: "Não foi possível remover a localização e os dados da câmera de {count} imagens: {name}. Quem salvar as imagens pode ver onde e quando elas foram tiradas."
      },
      "dialog.upload": "Enviar assim mesmo",
      "dialog.skip": "Não enviar",
      "toast.notUploaded": {
        one: "{name} não foi enviada: não foi possível remover a localização e os dados da câmera.",
        other: "{name} não foram enviadas: não foi possível remover a localização e os dados da câmera."
      }
    } })["pt-BR"];
  },
  get ru() {
    return Object.defineProperty(this, "ru", { value: {
      "settings.stripImages": "Удалять метаданные изображений",
      "settings.stripImages.description": "Убирает EXIF (камера, GPS-координаты, даты), XMP и текстовые блоки из изображений JPEG, PNG, WebP и GIF. Изображения, которые очистить нельзя, например фото HEIC, загружаются только с твоего согласия.",
      "settings.randomNames": "Случайные имена файлов",
      "settings.randomNames.description": "Загружает файлы под случайным именем, сохраняя расширение.",
      "dialog.title": { one: "Загрузить это изображение вместе с данными?", other: "Загрузить эти изображения вместе с данными?" },
      "dialog.body": {
        one: "Не удалось убрать местоположение и данные камеры из {name}. Любой, кто сохранит файл, сможет увидеть, где и когда сделан снимок.",
        other: "Не удалось убрать местоположение и данные камеры из {count} изображений: {name}. Любой, кто сохранит эти файлы, сможет увидеть, где и когда сделаны снимки."
      },
      "dialog.upload": "Загрузить как есть",
      "dialog.skip": "Не загружать",
      "toast.notUploaded": "Не загружено: {name}. Не удалось убрать местоположение и данные камеры."
    } })["ru"];
  },
  get tr() {
    return Object.defineProperty(this, "tr", { value: {
      "settings.stripImages": "Görsel meta verilerini temizle",
      "settings.stripImages.description": "JPEG, PNG, WebP ve GIF görsellerinden EXIF (kamera, GPS konumu, tarihler), XMP ve metin bloklarını kaldırır. HEIC fotoğraflar gibi temizleyemediği görseller yalnızca sen istersen yüklenir.",
      "settings.randomNames": "Rastgele dosya adları",
      "settings.randomNames.description": "Dosyaları uzantısını koruyarak rastgele bir adla yükler.",
      "dialog.title": { one: "Bu görsel bilgileriyle birlikte yüklensin mi?", other: "Bu görseller bilgileriyle birlikte yüklensin mi?" },
      "dialog.body": {
        one: "{name} dosyasından konum ve kamera bilgileri kaldırılamadı. Dosyayı kaydeden herkes nerede ve ne zaman çekildiğini görebilir.",
        other: "{count} görselden konum ve kamera bilgileri kaldırılamadı: {name}. Dosyaları kaydeden herkes nerede ve ne zaman çekildiklerini görebilir."
      },
      "dialog.upload": "Olduğu gibi yükle",
      "dialog.skip": "Yükleme",
      "toast.notUploaded": "{name} yüklenmedi: konum ve kamera bilgileri kaldırılamadı."
    } })["tr"];
  }
});

// plugins/strip-metadata/dialog.tsx
var jsx_runtime = require("react/jsx-runtime");
var MAX_NAMES = 3;
function listNames(names) {
  return names.slice(0, MAX_NAMES).join(", ") + (names.length > MAX_NAMES ? ", …" : "");
}
var queue = Promise.resolve();
var generation = 0;
var stopOpen;
function askToUpload(names) {
  const asked = generation;
  const answer = queue.then(() => asked === generation ? ask(names) : "stopped");
  queue = answer.catch(() => {});
  return answer;
}
function closeDialogs() {
  generation++;
  stopOpen?.();
}
function ask(names) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer, options) => {
      if (settled)
        return;
      settled = true;
      close(options);
      resolve(answer);
    };
    const stop = () => finish("stopped", { instant: true });
    const close = import_api2.openLayer(() => /* @__PURE__ */ jsx_runtime.jsx(Prompt, {
      names,
      onUpload: () => finish("upload"),
      onSkip: () => finish("skip")
    }), {
      onClosed: () => void (stopOpen === stop && (stopOpen = undefined))
    });
    stopOpen = stop;
  });
}
function Prompt({ names, onUpload, onSkip }) {
  const skipRef = import_api2.React.useRef(null);
  import_api2.React.useEffect(() => {
    const previous = document.activeElement;
    skipRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== "Escape")
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onSkip();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);
  const count = names.length;
  const listed = listNames(names);
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    className: "evi-strip-scrim evi-scrim",
    onMouseDown: (e) => e.target === e.currentTarget && onSkip(),
    children: /* @__PURE__ */ jsx_runtime.jsxs("div", {
      className: "evi-strip-modal evi-modal",
      role: "alertdialog",
      "aria-modal": "true",
      "aria-labelledby": "evi-strip-title",
      "aria-describedby": "evi-strip-body",
      children: [
        /* @__PURE__ */ jsx_runtime.jsxs("div", {
          className: "evi-strip-content",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("h2", {
              id: "evi-strip-title",
              children: t("dialog.title", { count })
            }),
            /* @__PURE__ */ jsx_runtime.jsx("p", {
              id: "evi-strip-body",
              children: t("dialog.body", { count, name: listed })
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsxs("footer", {
          className: "evi-strip-actions",
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              className: "evi-strip-upload",
              onClick: onUpload,
              children: t("dialog.upload", { count })
            }),
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              className: "evi-strip-skip",
              ref: skipRef,
              onClick: onSkip,
              children: t("dialog.skip")
            })
          ]
        })
      ]
    })
  });
}
var dialogCss = `
.evi-strip-scrim { position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center; background: rgba(0,0,0,.7); }
.evi-strip-modal { width: min(440px, calc(100vw - 32px)); display: flex; flex-direction: column; border-radius: 12px; overflow: hidden;
  background: var(--modal-background, var(--background-base-low, #313338)); color: var(--text-default, var(--text-normal, #dbdee1)); border: 1px solid var(--border-subtle, transparent);
  box-shadow: var(--shadow-high, 0 8px 24px rgba(0,0,0,.4)); font-family: var(--font-primary); }
.evi-strip-content { padding: 20px 20px 16px; }
.evi-strip-content h2 { margin: 0 0 8px; font-size: 20px; line-height: 24px; font-weight: 600; color: var(--text-strong, var(--header-primary, #f2f3f5)); }
.evi-strip-content p { margin: 0; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.evi-strip-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 20px 20px; }
.evi-strip-actions button { min-height: 38px; padding: 0 16px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; }
.evi-strip-skip { background: var(--button-filled-brand-background, var(--brand-500, #5865f2)); color: var(--white, #fff); }
.evi-strip-skip:hover { background: var(--button-filled-brand-background-hover, var(--brand-560, #4752c4)); }
.evi-strip-upload { background: none; color: var(--text-default, #dbdee1); }
.evi-strip-upload:hover { text-decoration: underline; }
.evi-strip-actions button:focus-visible { outline: 2px solid var(--focus-primary, #00b0f4); outline-offset: 2px; }
`;

// plugins/strip-metadata/strip.ts
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var PNG_DROP = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME", "caBX"]);
var WEBP_DROP = new Set(["EXIF", "XMP ", "C2PA"]);
var GIF_KEEP_APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);
var HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"]);
var AVIF_BRANDS = new Set(["avif", "avis"]);
var JXL_CONTAINER = [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10];
var CLEAN = "clean";
var BROKEN = "broken";
var ascii = (b, start, len) => String.fromCharCode(...b.subarray(start, start + len));
function detectImage(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "jpeg";
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v))
    return "png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP")
    return "webp";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a"))
    return "gif";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (HEIF_BRANDS.has(brand))
      return "heif";
    if (AVIF_BRANDS.has(brand))
      return "avif";
  }
  if (b.length >= 4 && (ascii(b, 0, 4) === "II*\x00" || ascii(b, 0, 4) === "MM\x00*"))
    return "tiff";
  if (b.length >= 2 && b[0] === 255 && b[1] === 10 || b.length >= 12 && JXL_CONTAINER.every((v, i) => b[i] === v))
    return "jxl";
  return null;
}
function stripMetadata(data) {
  const kind = detectImage(data);
  const out = kind === "jpeg" ? stripJpeg(data) : kind === "png" ? stripPng(data) : kind === "webp" ? stripWebp(data) : kind === "gif" ? stripGif(data) : kind ? BROKEN : null;
  if (out instanceof Uint8Array)
    return { data: out, changed: true, kind, failed: false };
  return { data, changed: false, kind, failed: out === BROKEN };
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
function readExifOrientation(seg) {
  if (seg.length < 14 || ascii(seg, 0, 6) !== "Exif\x00\x00")
    return;
  const tiff = seg.subarray(6);
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM")
    return;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = order === "II";
  if (view.getUint16(2, le) !== 42)
    return;
  const ifd = view.getUint32(4, le);
  if (ifd + 2 > tiff.length)
    return;
  const count = view.getUint16(ifd, le);
  for (let i = 0;i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length)
      return;
    if (view.getUint16(entry, le) === 274) {
      const value = view.getUint16(entry + 8, le);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
}
function orientationSegment(orientation) {
  const payload = [
    ...[69, 120, 105, 102, 0, 0],
    77,
    77,
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    1,
    18,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0
  ];
  const len = payload.length + 2;
  return new Uint8Array([255, 225, len >> 8, len & 255, ...payload]);
}
function keepJpegSegment(marker, payload) {
  if (marker === 224)
    return true;
  if (marker === 226)
    return ascii(payload, 0, 12) === "ICC_PROFILE\x00";
  if (marker === 238)
    return ascii(payload, 0, 5) === "Adobe";
  return false;
}
function scanEnd(b, i) {
  while ((i = b.indexOf(255, i)) !== -1 && i + 1 < b.length) {
    const next = b[i + 1];
    if (next === 255)
      i++;
    else if (next === 0 || next >= 208 && next <= 215)
      i += 2;
    else
      return i;
  }
  return b.length;
}
function stripJpeg(b) {
  const parts = [b.subarray(0, 2)];
  let orientation;
  let removed = false;
  let scanned = false;
  let i = 2;
  while (i < b.length) {
    let markerAt = i;
    while (b[markerAt + 1] === 255)
      markerAt++;
    const marker = b[i] === 255 ? b[markerAt + 1] : undefined;
    if (marker === undefined) {
      if (!scanned)
        return BROKEN;
      parts.push(b.subarray(i));
      break;
    }
    if (marker === 217) {
      parts.push(b.subarray(markerAt, markerAt + 2));
      if (markerAt + 2 < b.length)
        removed = true;
      break;
    }
    if (marker === 1 || marker >= 208 && marker <= 215) {
      parts.push(b.subarray(markerAt, markerAt + 2));
      i = markerAt + 2;
      continue;
    }
    const len = markerAt + 4 > b.length ? 0 : b[markerAt + 2] << 8 | b[markerAt + 3];
    const end = markerAt + 2 + len;
    if (len < 2 || end > b.length) {
      if (!scanned)
        return BROKEN;
      parts.push(b.subarray(i));
      break;
    }
    const payload = b.subarray(markerAt + 4, end);
    const isMeta = marker >= 224 && marker <= 239 || marker === 254;
    if (isMeta && !keepJpegSegment(marker, payload)) {
      if (marker === 225)
        orientation ??= readExifOrientation(payload);
      removed = true;
    } else {
      parts.push(b.subarray(markerAt, end));
    }
    i = end;
    if (marker === 218) {
      scanned = true;
      i = scanEnd(b, end);
      parts.push(b.subarray(end, i));
    }
  }
  if (!scanned)
    return BROKEN;
  if (!removed)
    return CLEAN;
  if (orientation && orientation !== 1) {
    const at = parts.length > 1 && parts[1][1] === 224 ? 2 : 1;
    parts.splice(at, 0, orientationSegment(orientation));
  }
  return concat(parts);
}
function stripPng(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [b.subarray(0, 8)];
  let removed = false;
  let i = 8;
  while (i < b.length) {
    if (i + 12 > b.length)
      return BROKEN;
    const len = view.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length)
      return BROKEN;
    if (PNG_DROP.has(type))
      removed = true;
    else
      parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") {
      if (i < b.length)
        removed = true;
      break;
    }
  }
  return removed ? concat(parts) : CLEAN;
}
function stripWebp(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = Math.min(b.length, 8 + view.getUint32(4, true));
  const parts = [];
  let removed = riffEnd < b.length;
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = ascii(b, i, 4);
    const size = view.getUint32(i + 4, true);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > riffEnd)
      return BROKEN;
    if (WEBP_DROP.has(type)) {
      removed = true;
    } else if (type === "VP8X" && size >= 1) {
      const chunk = b.slice(i, Math.min(end, riffEnd));
      chunk[8] &= ~(8 | 4);
      parts.push(chunk);
    } else {
      parts.push(b.subarray(i, Math.min(end, riffEnd)));
    }
    i = end;
  }
  if (i < riffEnd)
    return BROKEN;
  if (!removed)
    return CLEAN;
  const body = concat(parts);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}
function subBlocksEnd(b, i) {
  while (i < b.length) {
    const size = b[i];
    if (size === 0)
      return i + 1;
    i += size + 1;
  }
  return -1;
}
function keepGifExtension(b, i) {
  const label = b[i + 1];
  if (label === 249 || label === 1)
    return true;
  return label === 255 && b[i + 2] === 11 && GIF_KEEP_APPS.has(ascii(b, i + 3, 11));
}
function stripGif(b) {
  if (b.length < 13)
    return BROKEN;
  const screen = b[10];
  let i = 13 + (screen & 128 ? 3 << (screen & 7) + 1 : 0);
  if (i > b.length)
    return BROKEN;
  const parts = [b.subarray(0, i)];
  let removed = false;
  while (i < b.length) {
    const block = b[i];
    if (block === 59) {
      parts.push(b.subarray(i, i + 1));
      if (i + 1 < b.length)
        removed = true;
      break;
    }
    let end;
    if (block === 44) {
      if (i + 10 > b.length)
        return BROKEN;
      const packed = b[i + 9];
      end = subBlocksEnd(b, i + 10 + (packed & 128 ? 3 << (packed & 7) + 1 : 0) + 1);
      if (end < 0)
        return BROKEN;
      parts.push(b.subarray(i, end));
    } else if (block === 33) {
      end = subBlocksEnd(b, i + 2);
      if (end < 0)
        return BROKEN;
      if (keepGifExtension(b, i))
        parts.push(b.subarray(i, end));
      else
        removed = true;
    } else {
      return BROKEN;
    }
    i = end;
  }
  return removed ? concat(parts) : CLEAN;
}
function randomFileName(name, random = Math.random) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let base = "";
  for (let i = 0;i < 12; i++)
    base += chars[Math.floor(random() * chars.length) % chars.length];
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match && match.index > 0 ? `${base}.${match[1]}` : base;
}

// plugins/strip-metadata/index.ts
var settings = {
  stripImages: {
    type: "boolean",
    get label() {
      return t("settings.stripImages");
    },
    get description() {
      return t("settings.stripImages.description");
    },
    default: true
  },
  randomNames: {
    type: "boolean",
    get label() {
      return t("settings.randomNames");
    },
    get description() {
      return t("settings.randomNames.description");
    },
    default: true
  }
};
var MAX_IMAGE_BYTES = 100 * 1024 * 1024;
var IMAGE_NAME = /\.(jpe?g|jfif|png|apng|webp|gif)$/i;
var UNSUPPORTED_NAME = /\.(hei[cf]s?|avifs?|tiff?|jxl|dng)$/i;
var UNSUPPORTED_TYPE = /^image\/(hei[cf](-sequence)?|avifs?|tiff|jxl|x-adobe-dng)$/i;
var METHODS = ["addFiles", "addFile", "setFile"];
var uploadActions = import_api3.filters.byProps("addFiles", "clearAll");
var uploadEntry = import_api3.filters.byCode("INSTANT_UPLOAD", "requireConfirm");
var uploadPayload = import_api3.filters.byProps("getUploadPayload");
var context;
var queueHooked = false;
var handled = new WeakSet;
async function cleanFile(file) {
  const ctx = context;
  if (!ctx || handled.has(file))
    return { file, unclean: false };
  const strip = ctx.settings.get("stripImages");
  const rename = ctx.settings.get("randomNames");
  let parts = [file];
  let name = file.name;
  let unclean = false;
  if (strip) {
    const kind = detectImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    const unsupported = UNSUPPORTED_NAME.test(file.name) || UNSUPPORTED_TYPE.test(file.type);
    const image = !!kind || unsupported || file.type.startsWith("image/") || IMAGE_NAME.test(file.name);
    if (unsupported || image && file.size > MAX_IMAGE_BYTES) {
      unclean = true;
    } else if (image) {
      const result = stripMetadata(new Uint8Array(await file.arrayBuffer()));
      if (result.failed)
        unclean = true;
      else if (result.changed)
        parts = [result.data];
    }
  }
  if (rename)
    name = randomFileName(file.name);
  if (parts[0] === file && name === file.name)
    return { file, unclean };
  return { file: new File(parts, name, { type: file.type, lastModified: Date.now() }), unclean };
}
async function prepare(files) {
  const results = await Promise.all(files.map((file) => cleanFile(file).catch((err) => {
    context?.logger.error("Couldn't clean", file.name, err);
    return { file, unclean: true };
  })));
  const unclean = files.filter((_, i) => results[i].unclean);
  let upload = true;
  if (unclean.length) {
    const answer = await askToUpload(unclean.map((f) => f.name)).catch((err) => {
      context?.logger.error("Couldn't ask about", unclean.map((f) => f.name), err);
      return "stopped";
    });
    upload = answer === "upload";
    if (answer === "stopped")
      import_api3.showToast(t("toast.notUploaded", { count: unclean.length, name: listNames(unclean.map((f) => f.name)) }), { type: "failure" });
  }
  const out = new Map;
  files.forEach((file, i) => {
    const { file: clean, unclean: asked } = results[i];
    if (asked && !upload)
      return void out.set(file, null);
    handled.add(clean);
    out.set(file, clean);
  });
  return out;
}
async function cleanArgs(args) {
  const found = collectFiles(args);
  const files = [...new Set(found.map((f) => f.file))];
  const replacements = await prepare(files);
  const drop = new Set(files.filter((f) => replacements.get(f) === null));
  if (drop.size === files.length)
    return false;
  for (const { owner, key, file } of found) {
    const clean = replacements.get(file);
    if (!clean || clean === file)
      continue;
    owner[key] = clean;
    for (const prop of ["name", "filename"]) {
      if (!Array.isArray(owner) && owner[prop] === file.name)
        owner[prop] = clean.name;
    }
  }
  return !drop.size || dropFiles(args, drop);
}
function hasFiles(args) {
  return collectFiles(args).some((f) => !handled.has(f.file));
}
var enabled = () => !!context && (context.settings.get("stripImages") || context.settings.get("randomNames"));
function interceptEntry(call) {
  const [files, ...rest] = call.args;
  const list = files && typeof files === "object" && typeof files.length === "number" ? Array.from(files) : [];
  const queued = rest[2]?.requireConfirm !== false;
  if (!enabled() || queued && queueHooked || !list.some((f) => f instanceof File && !handled.has(f))) {
    return call.callOriginal(...call.args);
  }
  return prepare(list.filter((f) => f instanceof File)).then((replacements) => {
    const kept = list.flatMap((f) => f instanceof File ? replacements.get(f) ?? [] : [f]);
    if (kept.length)
      return call.callOriginal(kept, ...rest);
  });
}
function interceptUpload(call) {
  if (!enabled() || !hasFiles(call.args)) {
    return call.callOriginal(...call.args);
  }
  return cleanArgs(call.args).then((go) => go ? call.callOriginal(...call.args) : undefined);
}
function interceptPayload(call) {
  const [upload] = call.args;
  const file = uploadFile(upload);
  if (!enabled() || !file || handled.has(file))
    return call.callOriginal(...call.args);
  return prepare([file]).then((replacements) => {
    const clean = replacements.get(file);
    if (clean === null) {
      return { ...call.callOriginal(...call.args), filename: "" };
    }
    if (clean && clean !== file)
      swapUploadFile(upload, clean);
    return call.callOriginal(...call.args);
  });
}
var strip_metadata_default = import_api3.definePlugin({
  settings,
  css: dialogCss,
  start(ctx) {
    context = ctx;
    ctx.onDispose(() => {
      context = undefined;
      queueHooked = false;
      closeDialogs();
    });
    ctx.hookExport("instead", uploadEntry, interceptEntry);
    ctx.waitFor(uploadActions, (actions) => {
      for (const method of METHODS) {
        if (typeof actions[method] === "function")
          ctx.hook.instead(actions, method, interceptUpload);
      }
      queueHooked = typeof actions.addFiles === "function";
    });
    ctx.waitFor(uploadPayload, (payload) => {
      if (typeof payload.getUploadPayload === "function")
        ctx.hook.instead(payload, "getUploadPayload", interceptPayload);
    });
  }
});
