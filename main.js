// ============================================
//           FIEREN-BOT - BOT DE WHATSAPP
//           Desarrolladores: Emma y Jinn
//           WhatsApp: 5354185002 / 18096758983
// ============================================

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  generateWAMessageFromContent,
  proto,
} = require("@whiskeysockets/baileys");
const chalk = require("chalk");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { exec } = require("child_process");
const os = require("os");
const util = require("util");
const execPromise = util.promisify(exec);
const yts = require("yt-search");
const qrcode = require("qrcode");
const AdmZip = require("adm-zip");
// Binario de ffmpeg empaquetado vía npm: evita depender de que el sistema
// (Railway, Docker, Termux, etc.) tenga "ffmpeg" instalado y en el PATH.
// Si por algún motivo el paquete no trae el binario para la plataforma,
// se hace fallback al "ffmpeg" del sistema (comportamiento anterior).
let ffmpegPath;
try {
  ffmpegPath = require("ffmpeg-static") || "ffmpeg";
} catch {
  ffmpegPath = "ffmpeg";
}

// ════════════════════════════════════════════════════════════
//   ESTILO "FIEREN" PARA TODOS LOS MENSAJES DEL BOT
//   En vez de editar cada sock.sendMessage(...) del código uno
//   por uno, se envuelve el método una sola vez por socket
//   (bot principal y cada sub-bot). Así cualquier texto/caption
//   que se envíe queda con el mismo estilo automáticamente.
// ════════════════════════════════════════════════════════════
// Canal oficial de WhatsApp de Fieren-bot (se muestra en el menú y como firma)
const FIEREN_CHANNEL_LINK = "https://whatsapp.com/channel/0029Vb7tC3zKWEKzwOCXNo2F";

function fierenStyleText(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  // No re-enmarcar contenido que ya trae su propio diseño pesado (menú, tarjetas
  // largas con bordes ┄━═), para no anidar cajas una dentro de otra.
  if (trimmed.length > 600) return text;
  if (/^[┄━═]/.test(trimmed)) return text;
  return `❄️ ᜊ *Fieren* ᜊ ❄️\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n${trimmed}`;
}

function applyFierenBranding(sock) {
  const originalSend = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options) => {
    if (content && typeof content === "object") {
      if (typeof content.text === "string") {
        content = { ...content, text: fierenStyleText(content.text) };
      } else if (typeof content.caption === "string") {
        content = { ...content, caption: fierenStyleText(content.caption) };
      }
    }
    return originalSend(jid, content, options);
  };
  return sock;
}


const settings = require("./settings");
const { logError } = require("./logger");

// Carpeta de datos configurable (env DATA_DIR) para poder apuntar a un Volume
// persistente en Railway y que nada se borre en cada redeploy.
const APP_DATA_DIR = path.isAbsolute(settings.storage.dataDir)
  ? settings.storage.dataDir
  : path.join(process.cwd(), settings.storage.dataDir);

const db = require("./db");
const economy = require("./economy");
const {
  cmdBalance, cmdDaily, cmdWork, cmdCrime, cmdSlut,
  cmdDeposit, cmdWithdraw, cmdGiveCoins, cmdCoinFlip,
  cmdRoulette, cmdSteal, cmdEconomyBoard, cmdEconomyInfo,
  cmdMonthly, cmdCoffer, cmdCasino, cmdPPT,
  cmdAdventure, cmdDungeon, cmdHunt, cmdFish, cmdMine, cmdInvoke, cmdHeal,
  cmdMath, checkMathAnswer,
} = economy;

const gacha = require("./gacha");
const {
  cmdRollWaifu, cmdClaim, cmdHarem, cmdCharInfo, cmdDeleteWaifu,
  cmdGiveChar, cmdTrade, cmdSetFav, cmdDelFav, cmdVote,
  cmdWaifusTop, cmdFavTop, cmdSerieList, cmdSerieInfo, cmdGachaInfo,
  cmdSetClaimMsg, cmdDelClaimMsg, cmdHaremShop, cmdSell, cmdBuyChar,
  cmdRemoveSale, cmdCharImage, cmdGiveAllHarem, cmdRobWaifu,
} = gacha;

const profiles = require("./profiles");
const {
  cmdProfile, cmdLevel, cmdLeaderboard,
  cmdSetDescription, cmdDelDescription,
  cmdSetGenre, cmdDelGenre,
  cmdSetBirthday, cmdDelBirthday,
  cmdSetHobby, cmdDelHobby,
  cmdMarry, cmdDivorce,
  cmdAfk, checkAfk,
  addMessageXP,
} = profiles;

const aiChat = require("./ai");

// ════════════════════════════════════════════════════════════
//   HELPERS GENERALES
// ════════════════════════════════════════════════════════════

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function isYTUrl(url = "") {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/i.test(url);
}

function getVideoId(text = "") {
  const raw = String(text || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  return (
    raw.match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|[?&]v=)([a-zA-Z0-9_-]{11})/
    )?.[1] || null
  );
}

function sanitizeFileName(name = "video") {
  return String(name)
    .replace(/\.(mp4|mkv|webm|mov|avi)$/i, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";
}

function formatBytes(bytes = 0) {
  if (!bytes || Number.isNaN(bytes)) return "Desconocido";
  const units = ["B", "KB", "MB", "GB"];
  let size = Number(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function parseFileSize(size) {
  if (!size) return null;
  const raw = String(size).trim();
  const match = raw.match(/([\d.,]+)\s*(bytes?|b|kb|kib|mb|mib|gb|gib)/i);
  if (!match) return null;
  let valueText = match[1];
  if (valueText.includes(",") && valueText.includes(".")) {
    valueText = valueText.replace(/,/g, "");
  } else {
    valueText = valueText.replace(",", ".");
  }
  const value = Number(valueText);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  const mult = { b: 1, byte: 1, bytes: 1, kb: 1024, kib: 1024, mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3 };
  return Math.round(value * (mult[unit] || 1));
}

async function getRemoteFileSize(url) {
  const head = await fetch(url, { method: "HEAD", headers: { "user-agent": "Mozilla/5.0" } }).catch(() => null);
  let length = head?.headers?.get("content-length");
  let bytes = Number(length);
  if (Number.isFinite(bytes) && bytes > 0) return bytes;
  const range = await fetch(url, { method: "GET", headers: { range: "bytes=0-0", "user-agent": "Mozilla/5.0" } }).catch(() => null);
  const contentRange = range?.headers?.get("content-range");
  const m = contentRange?.match(/\/(\d+)$/);
  if (m?.[1]) { bytes = Number(m[1]); if (Number.isFinite(bytes) && bytes > 0) return bytes; }
  length = range?.headers?.get("content-length");
  bytes = Number(length);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

// ════════════════════════════════════════════════════════════
//   YOUTUBE — búsqueda con yt-search + descarga via fare.ink
// ════════════════════════════════════════════════════════════

async function getVideoInfo(input, videoId) {
  if (videoId) {
    try {
      const info = await yts({ videoId });
      if (info?.videoId) return { ...info, url: `https://youtu.be/${info.videoId}`, image: info.thumbnail || info.image };
    } catch {}
  }
  const search = await yts(input);
  return search.videos?.[0] || search.all?.find(v => v.type === "video") || null;
}

async function getYoutubeUrl(input) {
  const id = getVideoId(input);
  if (id) return `https://youtu.be/${id}`;
  if (isYTUrl(input)) return input;
  const search = await yts(input);
  const video = search.videos?.[0] || search.all?.find(v => v.type === "video");
  if (!video?.url) throw new Error("No se encontró un video válido de YouTube");
  return video.url;
}

// ── ytmp3 via fare.ink ────────────────────────────────────────────────────────
// NOTA: antes esta función descargaba el audio completo a un Buffer en RAM
// (fetch + arrayBuffer). En servidores con poca memoria (Railway free, VPS
// chicos, etc.) eso podía disparar el uso de memoria y hacer que el proceso
// muriera por OOM (el hosting lo veía como el bot "reiniciándose"). Ahora,
// igual que en handleYtMp4, solo se valida que el enlace responda y se le
// pasa la URL directa a Baileys para que la transmita sin bufferizarla entera.
async function getAudioFromFare(url) {
  const apiUrl = `https://fare.ink/dl/yta?url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Fare API falló: HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.status || !json?.descarga?.url) throw new Error("No se encontró el enlace de descarga.");
  const check = await fetch(json.descarga.url, { method: "HEAD" }).catch(() => null);
  if (check && !check.ok) throw new Error(`No se pudo acceder al audio: HTTP ${check.status}`);
  return { url: json.descarga.url, name: json.descarga.archivo || "audio.mp3" };
}

// ── ytmp4 via apicausas (con fallback a fare.ink) ──────────────────────────────
// NOTA: no logré confirmar la forma exacta del JSON de este endpoint (dio timeout
// en mis pruebas), así que busca los campos por varios nombres posibles. Si algo
// no encaja, revisa el log "[ytmp4] apicausas" para ver la respuesta cruda.
async function getVideoFromApicausas(url, quality = "720") {
  const apiUrl = `https://rest.apicausas.xyz/api/v1/descargas/youtube?apikey=${settings.apis.apicausas}&url=${encodeURIComponent(url)}&type=video&quality=${quality}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`apicausas API HTTP ${res.status}: ${text.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Respuesta no-JSON de apicausas: ${text.slice(0, 200)}`); }

  const root = (json?.data && typeof json.data === "object") ? json.data : json;
  const downloadUrl = root?.url || root?.download_url || root?.downloadUrl || root?.link || root?.result?.url || root?.dl_url;
  if (!downloadUrl) {
    throw new Error(`apicausas no devolvió un enlace de descarga: ${text.slice(0, 300)}`);
  }

  // Normalizamos al mismo formato que ya usaba fare.ink para no tocar el resto de handleYtMp4
  return {
    status: true,
    titulo: root?.title || root?.titulo || root?.filename || "video",
    canal: { nombre: root?.author || root?.channel || root?.canal || root?.autor || "Desconocido" },
    duracion: root?.duration || root?.duracion || "Desconocido",
    vistas: root?.views || root?.vistas || 0,
    miniatura: root?.thumbnail || root?.miniatura || root?.thumb || root?.image || null,
    descarga: {
      url: downloadUrl,
      calidad: root?.quality || root?.calidad || `${quality}p`,
      tamaño: root?.filesize || root?.size || root?.tamaño || root?.tamano || null,
    },
  };
}

// ── ytmp4 via fare.ink ────────────────────────────────────────────────────────
async function getVideoFromFare(url) {
  const apiUrl = `https://fare.ink/dl/ytv?url=${encodeURIComponent(url)}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Fare API HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`Respuesta inválida de Fare API: ${text.slice(0, 200)}`); }
}

async function getThumbnailBuffer(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length ? buffer : null;
  } catch { return null; }
}

// ── DESCARGAS: Facebook / TikTok / Instagram vía apicausas ─────────────────────
// NOTA: no logré confirmar la forma exacta del JSON de estos 3 endpoints (mis
// pruebas dieron error 500/404 con los links de ejemplo), así que se buscan los
// campos por varios nombres posibles, igual que se hizo con ytmp4. Si algo no
// encaja al probarlo de verdad, revisa el mensaje de error (incluye el JSON
// crudo recortado) y lo ajustamos.
async function fetchApicausas(kind, params) {
  const qs = new URLSearchParams({ apikey: settings.apis.apicausas, ...params });
  const apiUrl = `https://rest.apicausas.xyz/api/v1/descargas/${kind}?${qs.toString()}`;
  const res = await fetch(apiUrl, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`apicausas (${kind}) HTTP ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Respuesta no-JSON de apicausas (${kind}): ${text.slice(0, 300)}`); }
  return { json, raw: text };
}

// Busca recursivamente (poco profundo) un array de urls de medios dentro de la respuesta.
function extractMediaUrls(root) {
  const direct = root?.url || root?.download_url || root?.downloadUrl || root?.link || root?.dl_url || root?.video || root?.video_url;
  if (typeof direct === "string") return [direct];

  const arrayCandidates = root?.medias || root?.media || root?.urls || root?.images || root?.photos || root?.data;
  if (Array.isArray(arrayCandidates)) {
    const urls = arrayCandidates
      .map((it) => (typeof it === "string" ? it : it?.url || it?.link || it?.download_url))
      .filter((u) => typeof u === "string" && u.startsWith("http"));
    if (urls.length) return urls;
  }
  return [];
}

async function handleFacebookDownload(sock, from, msg, url) {
  if (!url) { await sock.sendMessage(from, { text: `Usa: *${settings.prefix}fb <link de Facebook>*` }, { quoted: msg }); return; }
  if (!/facebook\.com|fb\.watch/.test(url)) { await sock.sendMessage(from, { text: "Envía un link válido de Facebook." }, { quoted: msg }); return; }

  await reactToMessage(sock, msg, "⏳");
  try {
    const { json, raw } = await fetchApicausas("facebook", { url });
    const root = (json?.data && typeof json.data === "object") ? json.data : json;
    const urls = extractMediaUrls(root);
    if (!urls.length) throw new Error(`No se encontró un enlace descargable. Respuesta: ${raw.slice(0, 300)}`);

    const caption = `🎬 *Facebook Download*\n${root?.title ? `📌 ${root.title}\n` : ""}`;
    await sock.sendMessage(from, { video: { url: urls[0] }, caption, mimetype: "video/mp4" }, { quoted: msg });
    await reactToMessage(sock, msg, "✅");
  } catch (error) {
    logError("Error en fb:", error);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `No pude descargar ese video de Facebook.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}` }, { quoted: msg });
  }
}

async function handleTiktokDownload(sock, from, msg, url) {
  if (!url) { await sock.sendMessage(from, { text: `Usa: *${settings.prefix}tiktok <link de TikTok>*` }, { quoted: msg }); return; }
  if (!/tiktok\.com/.test(url)) { await sock.sendMessage(from, { text: "Envía un link válido de TikTok." }, { quoted: msg }); return; }

  await reactToMessage(sock, msg, "⏳");
  try {
    const { json, raw } = await fetchApicausas("tiktok", { url, type: "video" });
    const root = (json?.data && typeof json.data === "object") ? json.data : json;
    const urls = extractMediaUrls(root);
    if (!urls.length) throw new Error(`No se encontró un enlace descargable. Respuesta: ${raw.slice(0, 300)}`);

    const caption = `🎵 *TikTok Download*\n${root?.title ? `📌 ${root.title}\n` : ""}${root?.author?.nickname || root?.author ? `👤 ${root?.author?.nickname || root.author}\n` : ""}`;

    if (urls.length > 1) {
      // Carrusel de imágenes (slideshow de TikTok)
      for (const imgUrl of urls.slice(0, 10)) {
        await sock.sendMessage(from, { image: { url: imgUrl }, caption }, { quoted: msg });
      }
    } else {
      await sock.sendMessage(from, { video: { url: urls[0] }, caption, mimetype: "video/mp4" }, { quoted: msg });
    }
    await reactToMessage(sock, msg, "✅");
  } catch (error) {
    logError("Error en tiktok:", error);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `No pude descargar ese contenido de TikTok.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}` }, { quoted: msg });
  }
}

async function handleInstagramDownload(sock, from, msg, url) {
  if (!url) { await sock.sendMessage(from, { text: `Usa: *${settings.prefix}ig <link de Instagram>*` }, { quoted: msg }); return; }
  if (!/instagram\.com/.test(url)) { await sock.sendMessage(from, { text: "Envía un link válido de Instagram." }, { quoted: msg }); return; }

  await reactToMessage(sock, msg, "⏳");
  try {
    const { json, raw } = await fetchApicausas("instagram", { url });
    const root = (json?.data && typeof json.data === "object") ? json.data : json;
    const urls = extractMediaUrls(root);
    if (!urls.length) throw new Error(`No se encontró un enlace descargable. Respuesta: ${raw.slice(0, 300)}`);

    const caption = `📸 *Instagram Download*\n${root?.title || root?.caption ? `📌 ${root.title || root.caption}\n` : ""}`;

    if (urls.length > 1) {
      for (const mediaUrl of urls.slice(0, 10)) {
        const isVideo = /\.mp4(\?|$)/i.test(mediaUrl);
        await sock.sendMessage(from, isVideo ? { video: { url: mediaUrl }, caption } : { image: { url: mediaUrl }, caption }, { quoted: msg });
      }
    } else {
      const isVideo = /\.mp4(\?|$)/i.test(urls[0]) || root?.type === "video";
      await sock.sendMessage(from, isVideo ? { video: { url: urls[0] }, caption, mimetype: "video/mp4" } : { image: { url: urls[0] }, caption }, { quoted: msg });
    }
    await reactToMessage(sock, msg, "✅");
  } catch (error) {
    logError("Error en instagram:", error);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `No pude descargar ese contenido de Instagram.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}` }, { quoted: msg });
  }
}

// ── Comando ytmp3 ─────────────────────────────────────────────────────────────
async function handleYtMp3(sock, from, msg, query) {
  if (!query) {
    await sock.sendMessage(from, {
      text: `Usa: *${settings.prefix}ytmp3 <nombre o URL>*\nEjemplo: *${settings.prefix}ytmp3 Despacito Luis Fonsi*`,
    });
    return;
  }

  await reactToMessage(sock, msg, "⏳");

  try {
    const videoId = getVideoId(query);
    const url = await getYoutubeUrl(query);
    let title = "audio";
    let thumbnail = null;

    try {
      const info = await getVideoInfo(query, videoId);
      if (info) {
        title = info.title || title;
        thumbnail = info.image || info.thumbnail || null;
        const views = Number(info.views || 0).toLocaleString("es");
        const channel = info.author?.name || info.author || "Desconocido";
        const infoMsg =
          `➩ Descargando › *${title}*\n\n` +
          `> ❖ Canal › *${channel}*\n` +
          `> ⴵ Duración › *${info.timestamp || "Desconocido"}*\n` +
          `> ❀ Vistas › *${views}*\n` +
          `> ✩ Publicado › *${info.ago || "Desconocido"}*\n` +
          `> ❒ Enlace › *${url}*`;
        if (thumbnail) {
          await sock.sendMessage(from, { image: { url: thumbnail }, caption: infoMsg }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { text: infoMsg });
        }
      }
    } catch {}

    if (!isYTUrl(url)) {
      await reactToMessage(sock, msg, "❌");
      await sock.sendMessage(from, { text: "❌ No se encontró un video válido de YouTube." });
      return;
    }

    const audio = await getAudioFromFare(url);
    if (!audio?.url) {
      await reactToMessage(sock, msg, "❌");
      await sock.sendMessage(from, { text: "❌ No se pudo descargar el audio. Intenta más tarde." });
      return;
    }

    await sock.sendMessage(from, {
      audio: { url: audio.url },
      fileName: audio.name || `${title}.mp3`,
      mimetype: "audio/mpeg",
    }, { quoted: msg });

    await reactToMessage(sock, msg, "✅");
  } catch (err) {
    logError("[ytmp3] Error:", err);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `❌ No pude descargar el audio.\n_${err.message}_` });
  }
}

// ── Comando ytmp4 ─────────────────────────────────────────────────────────────
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

async function handleYtMp4(sock, from, msg, query) {
  if (!query) {
    await sock.sendMessage(from, {
      text: `Usa: *${settings.prefix}ytmp4 <nombre o URL>*\nEjemplo: *${settings.prefix}ytmp4 Despacito Luis Fonsi*`,
    });
    return;
  }

  await reactToMessage(sock, msg, "⏳");

  try {
    const url = await getYoutubeUrl(query);

    let data;
    try {
      data = await getVideoFromApicausas(url);
    } catch (apicausasErr) {
      logError("[ytmp4] apicausas falló, usando fare.ink como respaldo:", apicausasErr);
      data = await getVideoFromFare(url);
    }

    if (!data?.status || !data?.descarga?.url) {
      await reactToMessage(sock, msg, "❌");
      await sock.sendMessage(from, { text: "❌ No se pudo obtener el video. Intenta más tarde." });
      return;
    }

    const title = data.titulo || "video";
    const channel = data.canal?.nombre || "Desconocido";
    const duration = data.duracion || "Desconocido";
    const views = Number(data.vistas || 0).toLocaleString("es");
    const thumbnail = data.miniatura || null;
    const download = data.descarga;
    const quality = download.calidad || "360p";
    const fileName = sanitizeFileName(title) + ".mp4";

    const sizeBytes =
      parseFileSize(download.tamaño) ||
      (await getRemoteFileSize(download.url).catch(() => null));
    const sizeText = sizeBytes ? formatBytes(sizeBytes) : download.tamaño || "Desconocido";
    const sendAsDocument = sizeBytes ? sizeBytes > MAX_VIDEO_SIZE : false;

    const infoMsg =
      `➩ Descargando › *${title}*\n\n` +
      `> ❖ Canal › *${channel}*\n` +
      `> ⴵ Duración › *${duration}*\n` +
      `> ❀ Vistas › *${views}*\n` +
      `> ❒ Calidad › *${quality}*\n` +
      `> ❒ Tamaño › *${sizeText}*\n` +
      `> ❒ Enlace › *${url}*`;

    if (thumbnail) {
      await sock.sendMessage(from, { image: { url: thumbnail }, caption: infoMsg }, { quoted: msg });
    } else {
      await sock.sendMessage(from, { text: infoMsg });
    }

    const caption =
      `乂 *Video descargado*\n\n` +
      `> ❒ Calidad › *${quality}*\n` +
      `> ❒ Tamaño › *${sizeText}*`;

    if (sendAsDocument) {
      await sock.sendMessage(from, {
        document: { url: download.url },
        mimetype: "video/mp4",
        fileName,
        caption,
      }, { quoted: msg });
    } else {
      try {
        const thumbBuf = thumbnail ? await getThumbnailBuffer(thumbnail) : null;
        await sock.sendMessage(from, {
          video: { url: download.url },
          mimetype: "video/mp4",
          fileName,
          caption,
          ...(thumbBuf ? { jpegThumbnail: thumbBuf } : {}),
        }, { quoted: msg });
      } catch {
        // Fallback: enviar como documento si el video falla
        await sock.sendMessage(from, {
          document: { url: download.url },
          mimetype: "video/mp4",
          fileName,
          caption,
        }, { quoted: msg });
      }
    }

    await reactToMessage(sock, msg, "✅");
  } catch (err) {
    logError("[ytmp4] Error:", err);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `❌ No pude descargar el video.\n_${err.message}_` });
  }
}

// ── Comando ytsearch ──────────────────────────────────────────────────────────
async function handleYtSearch(sock, from, msg, query) {
  if (!query) {
    await sock.sendMessage(from, {
      text: `Usa: *${settings.prefix}ytsearch <título>*\nEjemplo: *${settings.prefix}ytsearch Despacito*`,
    });
    return;
  }

  await reactToMessage(sock, msg, "🔍");

  try {
    const results = await yts(query);
    const videos = results.all.filter(v => v.type === "video" || v.type === "channel").slice(0, 8);

    if (!videos.length) {
      await reactToMessage(sock, msg, "❌");
      await sock.sendMessage(from, { text: `❌ No encontré resultados para *"${query}"*.` });
      return;
    }

    const sep = "\n\n╾─┄─ ─〬─ ┄─╼\n\n";
    const text = videos.map(v => {
      if (v.type === "video") {
        return (
          `➩ *Título ›* *${v.title}*\n\n` +
          `> ⴵ *Duración ›* ${v.timestamp}\n` +
          `> ❖ *Subido ›* ${v.ago}\n` +
          `> ✿ *Vistas ›* ${v.views?.toLocaleString?.() || v.views}\n` +
          `> ❒ *Url ›* ${v.url}`
        ).trim();
      }
      if (v.type === "channel") {
        return (
          `> ❖ Canal › *${v.name}*\n` +
          `> ❒ Url › ${v.url}\n` +
          `> ❀ Suscriptores › ${v.subCountLabel || "N/A"}\n` +
          `> ✿ Videos › ${v.videoCount || "N/A"}`
        ).trim();
      }
      return null;
    }).filter(Boolean).join(sep);

    // Enviar con thumbnail del primer video
    const firstVideo = videos.find(v => v.type === "video");
    if (firstVideo?.thumbnail) {
      try {
        const thumbBuf = await getThumbnailBuffer(firstVideo.thumbnail);
        if (thumbBuf) {
          await sock.sendMessage(from, { image: thumbBuf, caption: text }, { quoted: msg });
          await reactToMessage(sock, msg, "✅");
          return;
        }
      } catch {}
    }

    await sock.sendMessage(from, { text }, { quoted: msg });
    await reactToMessage(sock, msg, "✅");
  } catch (err) {
    logError("[ytsearch] Error:", err);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `❌ Error al buscar: _${err.message}_` });
  }
}

// ════════════════════════════════════════════════════════════
//   PINTEREST via fare.ink
// ════════════════════════════════════════════════════════════

async function getPinterestDownload(url) {
  try {
    const res = await fetchJson(`https://fare.ink/dl/pin?url=${encodeURIComponent(url)}`);
    if (!res.status || !res.resultado?.url) return null;
    const data = res.resultado;
    const filename = data.filename || "";
    const mediaUrl = data.url || "";
    const isVideo = /\.mp4(?:$|\?)/i.test(filename) || /\.mp4(?:$|\?)/i.test(mediaUrl);
    const ext = filename.split(".").pop() || (isVideo ? "mp4" : "jpg");
    return {
      type: isVideo ? "video" : "image",
      title: data.titulo || null,
      author: data.autor || null,
      format: ext,
      url: mediaUrl,
      thumbnail: data.thumbnail || mediaUrl,
      filename: filename || `pinterest.${ext}`,
    };
  } catch { return null; }
}

async function getPinterestSearch(query) {
  try {
    const res = await fetchJson(`https://fare.ink/search/pin?q=${encodeURIComponent(query)}&limit=20`);
    if (!res.status || !Array.isArray(res.results) || !res.results.length) return [];
    return res.results
      .filter(d => d?.descarga)
      .map(d => {
        const tipo = String(d.tipo || "").toLowerCase();
        const descarga = d.descarga || null;
        const isVideo = tipo === "video" || /\.mp4(?:$|\?)/i.test(descarga || "");
        return {
          type: isVideo ? "video" : "image",
          title: d.titulo || null,
          name: d.autor || null,
          likes: d.likes || null,
          image: descarga,
          url: d.url || null,
        };
      });
  } catch { return []; }
}

async function handlePinterest(sock, from, msg, query) {
  if (!query) {
    await sock.sendMessage(from, {
      text: `Usa: *${settings.prefix}pinterest <búsqueda o enlace>*\nEjemplo: *${settings.prefix}pinterest aesthetic room*`,
    });
    return;
  }

  await reactToMessage(sock, msg, "🔍");

  const isPinterestUrl = /^https?:\/\//.test(query);

  try {
    if (isPinterestUrl) {
      // ── Descarga por URL directa ──
      await sock.sendMessage(from, { text: `📥 Descargando desde Pinterest...` });
      const data = await getPinterestDownload(query);

      if (!data) {
        await reactToMessage(sock, msg, "❌");
        await sock.sendMessage(from, { text: "❌ No se pudo obtener el contenido del enlace." });
        return;
      }

      const caption =
        `🌸 *Pinterest Download*\n\n` +
        (data.title  ? `📌 *Título ›* ${data.title}\n`  : "") +
        (data.author ? `👤 *Autor ›* ${data.author}\n`  : "") +
        (data.format ? `📄 *Formato ›* ${data.format}\n`: "") +
        `🔗 *Enlace ›* ${query}`;

      if (data.type === "video") {
        await sock.sendMessage(from, {
          video: { url: data.url },
          caption,
          mimetype: "video/mp4",
          fileName: data.filename || "pin.mp4",
        }, { quoted: msg });
      } else {
        await sock.sendMessage(from, {
          image: { url: data.url },
          caption,
        }, { quoted: msg });
      }

      await reactToMessage(sock, msg, "✅");

    } else {
      // ── Búsqueda por texto ──
      await sock.sendMessage(from, { text: `🔍 Buscando *"${query}"* en Pinterest...` });
      const results = await getPinterestSearch(query);

      if (!results.length) {
        await reactToMessage(sock, msg, "❌");
        await sock.sendMessage(from, {
          text: `❌ No encontré resultados para *"${query}"*.\nIntenta con otro término o en inglés.`,
        });
        return;
      }

      const medias = results.slice(0, 10).filter(r => r.image);
      if (!medias.length) {
        await reactToMessage(sock, msg, "❌");
        await sock.sendMessage(from, { text: "❌ No se pudieron obtener imágenes válidas." });
        return;
      }

      // Enviar hasta 5 imágenes
      const selected = medias.slice(0, 5);
      let enviadas = 0;
      for (let i = 0; i < selected.length; i++) {
        try {
          const r = selected[i];
          const caption =
            `🌸 *Pinterest Search* — ${query}\n\n` +
            (r.title ? `📌 *Título ›* ${r.title}\n` : "") +
            (r.name  ? `👤 *Autor ›* ${r.name}\n`  : "") +
            (r.likes ? `❤️ *Likes ›* ${r.likes}\n`  : "");

          if (r.type === "video") {
            await sock.sendMessage(from, {
              video: { url: r.image },
              caption: enviadas === 0 ? caption : "",
              mimetype: "video/mp4",
            }, enviadas === 0 ? { quoted: msg } : {});
          } else {
            await sock.sendMessage(from, {
              image: { url: r.image },
              caption: enviadas === 0 ? caption : "",
            }, enviadas === 0 ? { quoted: msg } : {});
          }
          enviadas++;
        } catch (e) {
          logError("[Pinterest] Error enviando item:", e);
        }
      }

      if (enviadas === 0) {
        await reactToMessage(sock, msg, "❌");
        await sock.sendMessage(from, { text: "❌ No pude enviar ninguna imagen. Intenta de nuevo." });
        return;
      }

      await reactToMessage(sock, msg, "✅");
    }
  } catch (err) {
    logError("[Pinterest] Error general:", err);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, { text: `❌ Error al procesar Pinterest.\n_${err.message}_` });
  }
}

// ════════════════════════════════════════════════════════════
//   REACCIONES ANIME
// ════════════════════════════════════════════════════════════

const REACTION_COMMANDS = {
  // ── Menú anime base (apicausas, con fallback a waifu.pics) ──
  hug:    { aliases: ["abrazar"], emoji: "🤗", needMention: true,  source: "apicausas", text: "le dio un abrazo a" },
  kiss:   { aliases: ["muak"],    emoji: "😘", needMention: true,  source: "apicausas", text: "le dio un beso a" },
  pat:    { aliases: [],          emoji: "🫳", needMention: true,  source: "apicausas", text: "acarició a" },
  slap:   { aliases: [],          emoji: "👋", needMention: true,  source: "apicausas", text: "le dio una bofetada a" },
  cry:    { aliases: ["llorar"],  emoji: "😭", needMention: false, source: "apicausas", text: "se puso a llorar" },
  dance:  { aliases: ["bailar"],  emoji: "💃", needMention: false, source: "apicausas", text: "se puso a bailar" },
  lick:   { aliases: ["lamer"],   emoji: "😛", needMention: true,  source: "apicausas", text: "lamió a" },
  bite:   { aliases: ["morder"],  emoji: "🧛", needMention: true,  source: "apicausas", text: "mordió a" },
  blush:  { aliases: [],          emoji: "😊", needMention: false, source: "apicausas", text: "se sonrojó" },
  bonk:   { aliases: [],          emoji: "🔨", needMention: true,  source: "apicausas", text: "le dio un golpe divertido a" },
  cuddle: { aliases: ["acurrucar"], emoji: "🫂", needMention: true,  source: "apicausas", text: "se acurrucó con" },
  kill:   { aliases: ["matar"],   emoji: "💀", needMention: true,  source: "apicausas", text: "atacó dramáticamente a" },
  wave:   { aliases: ["saludar"], emoji: "👋", needMention: false, source: "apicausas", text: "saludó con la mano" },
  wink:   { aliases: [],          emoji: "😉", needMention: false, source: "apicausas", text: "guiñó un ojo" },
  smile:  { aliases: ["sonreir"], emoji: "😄", needMention: false, source: "apicausas", text: "sonrió" },
  sad:    { aliases: ["triste"],  emoji: "😢", needMention: false, source: "apicausas", text: "expresó tristeza" },
  happy:  { aliases: ["feliz"],   emoji: "🥳", needMention: false, source: "apicausas", text: "saltó de felicidad" },
  angry:  { aliases: ["enojado"], emoji: "😠", needMention: false, source: "apicausas", text: "se enojó" },
  shy:    { aliases: ["timido"],  emoji: "🫣", needMention: false, source: "apicausas", text: "se puso tímido" },
  run:    { aliases: ["correr"],  emoji: "🏃", needMention: false, source: "apicausas", text: "salió corriendo" },
  eat:    { aliases: ["nom", "comer"], emoji: "🍔", needMention: false, source: "apicausas", text: "se fue a comer algo delicioso" },
  love:   { aliases: ["enamorado", "enamorada"], emoji: "😍", needMention: false, source: "apicausas", text: "está enamorado/a" },

  // ── Nuevas reacciones (nekos.best) ──
  bleh:     { aliases: ["meh"],        emoji: "😝", needMention: false, source: "nekosbest", text: "sacó la lengua" },
  blowkiss: { aliases: ["besito"],     emoji: "😘", needMention: true,  source: "nekosbest", text: "le lanzó un beso a" },
  bored:    { aliases: ["aburrido", "aburrida"], emoji: "🥱", needMention: false, source: "nekosbest", text: "está aburrido/a" },
  clap:     { aliases: ["aplaudir"],   emoji: "👏", needMention: false, source: "nekosbest", text: "está aplaudiendo" },
  handhold: { aliases: ["tomar"],      emoji: "🤝", needMention: true,  source: "nekosbest", text: "le tomó la mano a" },
  highfive: { aliases: ["chocar"],     emoji: "🖐️", needMention: true,  source: "nekosbest", text: "chocó los cinco con" },
  laugh:    { aliases: ["reir"],       emoji: "😂", needMention: false, source: "nekosbest", text: "se está riendo" },
  nope:     { aliases: ["nop"],        emoji: "🙅", needMention: false, source: "nekosbest", text: "dice que no" },
  pout:     { aliases: ["mueca"],      emoji: "😤", needMention: false, source: "nekosbest", text: "está haciendo pucheros" },
  punch:    { aliases: ["golpear", "puñetazo"], emoji: "👊", needMention: true,  source: "nekosbest", text: "le dio un puñetazo a" },
  sleep:    { aliases: ["dormir"],     emoji: "😴", needMention: false, source: "nekosbest", text: "se quedó dormido/a" },
  smug:     { aliases: ["presumir"],   emoji: "😏", needMention: false, source: "nekosbest", text: "está presumiendo" },
  stare:    { aliases: ["mirar"],      emoji: "👀", needMention: true,  source: "nekosbest", text: "se queda mirando fijamente a" },
  think:    { aliases: ["pensar"],     emoji: "🤔", needMention: false, source: "nekosbest", text: "está pensando profundamente" },
  tickle:   { aliases: ["cosquillas"], emoji: "🤭", needMention: true,  source: "nekosbest", text: "le hizo cosquillas a" },
  comfort:  { aliases: ["consolar"],   emoji: "🤗", needMention: true,  source: "purrbot",   text: "está consolando a" },
};

const COMMAND_ALIASES = Object.entries(REACTION_COMMANDS).reduce((acc, [key, value]) => {
  acc[key] = key;
  for (const alias of value.aliases) acc[alias] = key;
  return acc;
}, {});

const WAIFUPICS_MAP = {
  hug: "hug", kiss: "kiss", pat: "pat", slap: "slap", cry: "cry",
  dance: "dance", lick: "lick", bite: "bite", blush: "blush", bonk: "bonk",
  cuddle: "cuddle", kill: "kill", wave: "wave", wink: "wink", smile: "smile",
  sad: "cry", happy: "happy", angry: "angry", shy: "blush", run: "run", eat: "nom",
  love: "blush",
};

// ════════════════════════════════════════════════════════════
//   UTILIDADES
// ════════════════════════════════════════════════════════════

function formatOwnerNumber(number) {
  return `${number}`.replace(/[^0-9]/g, "");
}

function formatMenuDate(date) {
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  let h = date.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${meses[date.getMonth()]} ${date.getFullYear()}, ${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

function getMessageText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ""
  );
}

function getMentionedJid(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || null;
}

function getQuotedParticipant(msg) {
  return msg.message?.extendedTextMessage?.contextInfo?.participant || null;
}

// ── Detección de "responder a un mensaje de la IA" ──────────────────────────
// Guardamos el ID de cada mensaje que la IA envía, para poder distinguir
// "el usuario le respondió a la IA" de "el usuario respondió a cualquier otro
// mensaje del bot" (ej. un !ping). Así el modo sin prefijo solo se activa
// cuando corresponde, y no se malgastan llamadas a la API por accidente.
const aiSentMessageIds = new Map(); // stanzaId → timestamp de expiración
const AI_REPLY_WINDOW_MS = 30 * 60 * 1000; // margen amplio para poder seguir la conversación

function markAiMessage(key) {
  if (!key?.id) return;
  aiSentMessageIds.set(key.id, Date.now() + AI_REPLY_WINDOW_MS);
}

function isReplyToAiMessage(msg) {
  const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (!quotedId) return false;
  const expiresAt = aiSentMessageIds.get(quotedId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    aiSentMessageIds.delete(quotedId);
    return false;
  }
  return true;
}

function isOwner(sender, settings, msg) {
  const list = [
    ...(settings.bot.ownerNumbers || []),
    settings.bot.ownerNumber,
    settings.bot.secondaryOwnerNumber,
  ]
    .filter(Boolean)
    .map((n) => bareNumber(n));

  // Candidatos: el remitente y cualquier JID alternativo (@lid) que WhatsApp
  // pueda adjuntar al mensaje en vez del número real — mismo criterio que isAdmin().
  const candidates = [
    sender,
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participantLid,
  ]
    .filter(Boolean)
    .map((jid) => bareNumber(jid));

  return candidates.some((c) => list.includes(c));
}

// Los mensajes "ver una vez" (foto/video) llegan envueltos en
// viewOnceMessage / viewOnceMessageV2 / viewOnceMessageV2Extension.
// Esta función los desenvuelve para llegar al imageMessage/videoMessage real.
function unwrapViewOnce(message) {
  if (!message) return message;
  const wrapper =
    message.viewOnceMessage ||
    message.viewOnceMessageV2 ||
    message.viewOnceMessageV2Extension;
  return wrapper?.message ? unwrapViewOnce(wrapper.message) : message;
}

function getQuotedImageMessage(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return unwrapViewOnce(quoted)?.imageMessage || null;
}

function getQuotedVideoMessage(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return unwrapViewOnce(quoted)?.videoMessage || null;
}

function normalizeJid(jid) {
  return jid?.replace(/:[0-9]+@/, "@") || "";
}

// ════════════════════════════════════════════════════════════
//   CONFIGURACIÓN POR SOCKET (bot principal o sub-bot)
//   Cada número conectado (sock) puede tener su propio
//   nombre, prefijo, owner, moneda, etc. guardados en db.js
// ════════════════════════════════════════════════════════════
function getBotId(sock) {
  const raw = sock?.user?.id || "";
  return formatOwnerNumber(raw.split(":")[0]) + "@s.whatsapp.net";
}

function isSocketOwner(sock, sender, senderIsOwner, msg) {
  if (senderIsOwner) return true;
  const botId = getBotId(sock);
  const config = db.getSettings(botId) || {};
  const list = [botId, config.owner].filter(Boolean).map((jid) => bareNumber(jid));
  const candidates = [
    sender,
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participantLid,
  ]
    .filter(Boolean)
    .map((jid) => bareNumber(jid));
  return candidates.some((c) => list.includes(c));
}

function getBotDisplayName(sock) {
  const config = db.getSettings(getBotId(sock)) || {};
  return config.botname || settings.bot.name;
}

function getBotShortName(sock) {
  const config = db.getSettings(getBotId(sock)) || {};
  return config.namebot || settings.bot.name;
}

function getBotPrefixes(sock) {
  const config = db.getSettings(getBotId(sock)) || {};
  if (config.prefix === "noprefix") return [""];
  if (Array.isArray(config.prefix) && config.prefix.length) return config.prefix;
  return [settings.prefix];
}

function getBotCurrency(sock) {
  const config = db.getSettings(getBotId(sock)) || {};
  return config.currency || "coins";
}

// Con solo 500 MiB de RAM disponibles en el contenedor, cada proceso de
// ffmpeg corriendo en paralelo (fuera del heap de Node, es un proceso aparte)
// suma memoria extra. Esta cola simple asegura que nunca corra más de un
// ffmpeg a la vez, para no acumular varios procesos pesados al mismo tiempo
// si varias personas usan comandos de sticker/reacción/descarga a la vez.
let ffmpegQueue = Promise.resolve();
function runFfmpeg(args) {
  const run = () => new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
  const result = ffmpegQueue.then(run, run);
  // Seguimos la cadena de la cola aunque este ffmpeg falle, para no trabar
  // las siguientes conversiones por un solo error.
  ffmpegQueue = result.catch(() => {});
  return result;
}

async function reactToMessage(sock, msg, emoji) {
  try {
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key },
    });
  } catch (error) {
    logError("Error enviando reaccion:", error);
  }
}

async function convertGifBufferToMp4(buffer) {
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `reaction_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const inputPath = path.join(tempDir, `${baseName}.gif`);
  const outputPath = path.join(tempDir, `${baseName}.mp4`);
  fs.writeFileSync(inputPath, buffer);
  try {
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-movflags", "faststart",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-an", outputPath,
    ]);
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

async function sendReactionMedia(sock, jid, media, caption, mentions = []) {
  if (!media) {
    await sock.sendMessage(jid, { text: caption, mentions });
    return;
  }

  // Caso 1: ya tenemos el buffer descargado (p.ej. APIs que devuelven el binario directo)
  if (typeof media === "object" && media.buffer) {
    try {
      const contentType = (media.contentType || "").toLowerCase();
      let buffer = media.buffer;
      const isGif = contentType.includes("gif");
      const isVideo = contentType.includes("video") || media.isVideo;
      if (isGif) {
        buffer = await convertGifBufferToMp4(buffer);
        await sock.sendMessage(jid, { video: buffer, gifPlayback: true, caption, mentions, mimetype: "video/mp4", fileLength: buffer.length });
      } else if (isVideo) {
        await sock.sendMessage(jid, { video: buffer, gifPlayback: true, caption, mentions, mimetype: "video/mp4", fileLength: buffer.length });
      } else {
        await sock.sendMessage(jid, { image: buffer, caption, mentions, mimetype: contentType || "image/jpeg" });
      }
    } catch (err) {
      logError("Error enviando media (buffer) reaccion:", err);
      await sock.sendMessage(jid, { text: caption, mentions });
    }
    return;
  }

  // Caso 2: nos dieron una URL (string o { url, isVideo }) que hay que enviar
  const mediaUrl = typeof media === "string" ? media : media.url;
  const ext = mediaUrl.split("?")[0].split(".").pop().toLowerCase();
  const isGif = ext === "gif";
  const isMp4 = ext === "mp4" || (typeof media === "object" && media.isVideo);
  try {
    if (isGif) {
      // Los GIFs sí necesitan pasar por ffmpeg para convertirse a mp4, así que
      // en este caso puntual es inevitable traer los bytes a memoria.
      const res = await fetch(mediaUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; WhatsApp/2.0)" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      const buffer = await convertGifBufferToMp4(raw);
      await sock.sendMessage(jid, { video: buffer, gifPlayback: true, caption, mentions, mimetype: "video/mp4", fileLength: buffer.length });
    } else if (isMp4) {
      // Imágenes y videos ya listos se pasan por URL: Baileys los transmite
      // directo sin que el proceso tenga que cargarlos enteros en RAM.
      await sock.sendMessage(jid, { video: { url: mediaUrl }, gifPlayback: true, caption, mentions, mimetype: "video/mp4" });
    } else {
      await sock.sendMessage(jid, { image: { url: mediaUrl }, caption, mentions, mimetype: "image/jpeg" });
    }
  } catch (err) {
    logError("Error enviando media reaccion:", err);
    await sock.sendMessage(jid, { text: `${caption}\n\n🔗 ${mediaUrl}`, mentions });
  }
}

async function fetchWaifuPics(endpoint) {
  try {
    const res = await fetch(`https://api.waifu.pics/sfw/${endpoint}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.url;
    if (!url) return null;
    return { url, isVideo: url.endsWith(".mp4") };
  } catch (e) {
    logError("[waifu.pics] Error:", e);
    return null;
  }
}

// Fuente alterna para el comando !waifu: waifu.im, más estable/mantenida que
// waifu.pics (tiene su propia página de status pública y se actualiza seguido).
async function fetchWaifuIm() {
  try {
    const res = await fetch(`https://api.waifu.im/search?included_tags=waifu&is_nsfw=false`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.images?.[0]?.url;
    if (!url) return null;
    return { url, isVideo: false };
  } catch (e) {
    logError("[waifu.im] Error:", e);
    return null;
  }
}

async function fetchNekosBest(endpoint) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${endpoint}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const url = json?.results?.[0]?.url;
    if (!url) return null;
    return { url, isVideo: false };
  } catch (e) {
    logError("[nekos.best] Error:", e);
    return null;
  }
}

async function fetchPurrbot(endpoint) {
  try {
    const res = await fetch(`https://api.purrbot.site/v2/img/sfw/${endpoint}/gif`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.error || !json?.link) return null;
    return { url: json.link, isVideo: false };
  } catch (e) {
    logError("[purrbot] Error:", e);
    return null;
  }
}

async function fetchPinterest(query) {
  try {
    const url = `https://rest.apicausas.xyz/api/v1/buscadores/pinterest?apikey=${settings.apis.apicausas}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.status || !Array.isArray(json.data) || json.data.length === 0) return null;
    return json.data;
  } catch (e) {
    logError("[apicausas/pinterest] Error:", e);
    return null;
  }
}

async function fetchApicausasAnime(action) {
  try {
    const url = `https://rest.apicausas.xyz/api/v1/anime?apikey=${settings.apis.apicausas}&action=${encodeURIComponent(action)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    // Si la API no reconoce la acción, algunas devuelven JSON de error en vez de binario
    if (contentType.includes("json")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return null;
    return { buffer, contentType };
  } catch (e) {
    logError("[apicausas/anime] Error:", e);
    return null;
  }
}

async function fetchPPCouple() {
  try {
    const res = await fetch("https://raw.githubusercontent.com/ShirokamiRyzen/WAbot-DB/main/fitur_db/ppcp.json");
    if (!res.ok) return null;
    const data = await res.json();
    return data[Math.floor(Math.random() * data.length)] || null;
  } catch { return null; }
}

// Extrae solo los dígitos del usuario, ignorando dominio (@s.whatsapp.net / @lid) y sufijo de dispositivo (:NN)
function bareNumber(jid) {
  return `${jid || ""}`.split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

async function isAdmin(sock, groupJid, userJid, msg) {
  const metadata = await sock.groupMetadata(groupJid);
  // Candidatos: el JID que tenemos del remitente, y cualquier JID alternativo que WhatsApp
  // adjunte en el mensaje (algunos grupos usan @lid en vez de @s.whatsapp.net para los participantes).
  const candidates = new Set(
    [
      userJid,
      msg?.key?.participantAlt,
      msg?.key?.participantPn,
      msg?.key?.participantLid,
    ]
      .filter(Boolean)
      .map(bareNumber)
  );

  return metadata.participants.some((p) => {
    if (p.admin !== "admin" && p.admin !== "superadmin") return false;
    const participantIds = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).map(bareNumber);
    return participantIds.some((id) => candidates.has(id));
  });
}

async function isBotAdmin(sock, groupJid) {
  const metadata = await sock.groupMetadata(groupJid);
  const botCandidates = new Set(
    [sock.user?.id, sock.user?.lid].filter(Boolean).map(bareNumber)
  );
  return metadata.participants.some((p) => {
    if (p.admin !== "admin" && p.admin !== "superadmin") return false;
    const participantIds = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).map(bareNumber);
    return participantIds.some((id) => botCandidates.has(id));
  });
}

async function createStickerFromImage(msg) {
  const buffer = await downloadMediaMessage(msg, "buffer", {}, {});
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `sticker_${Date.now()}`;
  const inputPath = path.join(tempDir, `${baseName}.jpg`);
  const outputPath = path.join(tempDir, `${baseName}.webp`);
  fs.writeFileSync(inputPath, buffer);
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
    "-vcodec", "libwebp", "-lossless", "1", "-compression_level", "6",
    "-qscale", "100", "-preset", "photo", "-loop", "0", "-an", "-vsync", "0", outputPath,
  ]);
  const stickerBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(outputPath);
  return stickerBuffer;
}

async function createStickerFromVideo(msg) {
  const buffer = await downloadMediaMessage(msg, "buffer", {}, {});
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `video_sticker_${Date.now()}`;
  const inputPath = path.join(tempDir, `${baseName}.mp4`);
  const outputPath = path.join(tempDir, `${baseName}.webp`);
  fs.writeFileSync(inputPath, buffer);
  await runFfmpeg([
    "-y", "-i", inputPath, "-t", "10",
    "-vf", "fps=20,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
    "-vcodec", "libwebp", "-lossless", "0", "-compression_level", "4",
    "-qscale", "80", "-loop", "0", "-an", "-preset", "default", "-vsync", "0", outputPath,
  ]);
  const stickerBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(outputPath);
  return stickerBuffer;
}

// ── Stickers "especiales" (brat, bratv, emojimix, qc) ──────────────────────
// A diferencia de createStickerFromImage/Video (que parten de un mensaje de
// WhatsApp), estas funciones parten de un Buffer ya descargado de una API
// externa, así que factorizamos la conversión ffmpeg -> webp por separado.

async function bufferToWebpSticker(buffer, { isVideo = false } = {}) {
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `special_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const inputPath = path.join(tempDir, `${baseName}.${isVideo ? "mp4" : "png"}`);
  const outputPath = path.join(tempDir, `${baseName}.webp`);
  fs.writeFileSync(inputPath, buffer);
  if (isVideo) {
    await runFfmpeg([
      "-y", "-i", inputPath, "-t", "10",
      "-vf", "fps=20,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "-vcodec", "libwebp", "-lossless", "0", "-compression_level", "4",
      "-qscale", "80", "-loop", "0", "-an", "-preset", "default", "-vsync", "0", outputPath,
    ]);
  } else {
    await runFfmpeg([
      "-y", "-i", inputPath,
      "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "-vcodec", "libwebp", "-lossless", "1", "-compression_level", "6",
      "-qscale", "100", "-preset", "photo", "-loop", "0", "-an", "-vsync", "0", outputPath,
    ]);
  }
  const webpBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(outputPath);
  return webpBuffer;
}

// Escribe el nombre de paquete/autor en el EXIF del webp (lo que WhatsApp
// muestra como "pack" y "autor" del sticker). Si algo falla, se devuelve el
// buffer original sin metadata en vez de romper el envío del sticker.
async function writeStickerExif(webpBuffer, packname, author) {
  try {
    const { Image } = require("node-webpmux");
    const img = new Image();
    await img.load(webpBuffer);
    const json = {
      "sticker-pack-id": `fierenbot-${Date.now()}`,
      "sticker-pack-name": packname || "",
      "sticker-pack-publisher": author || "",
      emojis: ["🔥"],
    };
    const exifAttr = Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
      0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    img.exif = exif;
    return await img.save(null);
  } catch (error) {
    logError("Error escribiendo EXIF del sticker:", error);
    return webpBuffer;
  }
}

// Nombre de pack / autor por defecto para los stickers "especiales".
function getStickerBranding(sock, sender, pushName) {
  const packname = getBotDisplayName(sock);
  const author = pushName && pushName.trim() ? pushName.trim() : `@${sender.split("@")[0]}`;
  return { packname, author };
}

// Extrae el texto del mensaje citado (para !brat, !bratv, !qc respondiendo a un mensaje).
function getQuotedText(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return "";
  const real = unwrapViewOnce(quoted);
  return (
    real?.conversation ||
    real?.extendedTextMessage?.text ||
    real?.imageMessage?.caption ||
    real?.videoMessage?.caption ||
    ""
  );
}

// Ejecuta una consulta a la IA (Fieren) y responde en el chat. Se usa tanto
// desde el comando explícito (!ia <pregunta>) como desde el "modo sin
// prefijo" cuando ya hay una conversación activa con el usuario.
async function runAiQuery(sock, msg, sender, from, question, isImageMsg, directMsg) {
  try {
    const trimmedQuestion = (question || "").trim();

    const quotedImg = getQuotedImageMessage(msg);
    const hasDirectImage = !!isImageMsg && !!trimmedQuestion;
    const targetImageMessage = hasDirectImage ? directMsg.imageMessage : quotedImg;

    if (!trimmedQuestion && !targetImageMessage) return;

    await reactToMessage(sock, msg, "🤔");

    let imageBuffer = null;
    let imageMimetype = null;
    if (targetImageMessage) {
      try {
        const target = hasDirectImage ? msg : { key: msg.key, message: { imageMessage: targetImageMessage } };
        imageBuffer = await downloadMediaMessage(target, "buffer", {}, {});
        imageMimetype = targetImageMessage.mimetype || "image/jpeg";
      } catch (imgErr) {
        logError("Error descargando imagen para IA:", imgErr);
      }
    }

    const ownerContacts = settings.bot.ownerNumbers.map((n) => `wa.me/${n}`).join(" y ");
    const effectiveQuestion = trimmedQuestion || "Describe o comenta esta imagen.";

    const result = await aiChat.ask({
      question: effectiveQuestion,
      userId: sender,
      chatId: from,
      botName: getBotDisplayName(sock),
      ownerContacts,
      apiKey: settings.apis.apicausas,
      imageBuffer,
      imageMimetype,
    });

    let replyText = result.reply;
    if (targetImageMessage && result.imageUploadFailed) {
      replyText += `\n\n_(No pude procesar la imagen adjunta, así que respondí solo con base en el texto.)_`;
    }

    const sentMsg = await sock.sendMessage(from, { text: replyText }, { quoted: msg });
    markAiMessage(sentMsg?.key);
    await reactToMessage(sock, msg, "✅");
  } catch (error) {
    logError("Error en comando ia:", error);
    await reactToMessage(sock, msg, "❌");
    await sock.sendMessage(from, {
      text:
        `No pude obtener una respuesta de la IA (probablemente esté saturada o caída en este momento). ` +
        `Intenta de nuevo en un momento.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
    });
  }
}

// ── Comando !sticker mejorado: formas, efectos, URL y stickers citados ─────

function getQuotedStickerMessage(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return unwrapViewOnce(quoted)?.stickerMessage || null;
}

function isUrlString(text) {
  return /^https?:\/\/\S+$/i.test(text || "");
}

function isAnimatedWebpBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return false;
  return buffer.includes(Buffer.from("ANIM")) || buffer.includes(Buffer.from("ANMF"));
}

const STICKER_SHAPE_FLAGS = {
  "-c": "circle", "-t": "triangle", "-s": "star", "-r": "roundrect", "-h": "hexagon",
  "-d": "diamond", "-f": "frame", "-b": "border", "-w": "wave", "-m": "mirror",
  "-o": "octagon", "-y": "pentagon", "-e": "ellipse", "-z": "cross", "-v": "heart",
  "-x": "cover", "-i": "contain",
};

const STICKER_EFFECT_FLAGS = {
  "-blur": "blur", "-sepia": "sepia", "-sharpen": "sharpen", "-brighten": "brighten",
  "-darken": "darken", "-invert": "invert", "-grayscale": "grayscale",
  "-rotate90": "rotate90", "-rotate180": "rotate180", "-flip": "flip", "-flop": "flop",
  "-normalice": "normalise", "-negate": "negate", "-tint": "tint",
};

const STICKER_LIST_HELP = `ꕥ Lista de formas y efectos disponibles para *${settings.prefix}sticker*:

✦ *Formas* (usa solo una):
- -c circular · -t triangular · -s estrella · -r esquinas redondeadas
- -h hexagonal · -d diamante · -f marco · -b borde · -w onda
- -m espejo · -o octogonal · -y pentagonal · -e elíptico
- -z cruz · -v corazón · -x expandido (cover) · -i expandido (contain)

✧ *Efectos* (puedes combinar varios):
- -blur -sepia -sharpen -brighten -darken -invert -grayscale
- -rotate90 -rotate180 -flip -flop -normalice -negate -tint

También puedes:
- Pegar una *URL* de imagen/gif/video/webp en vez de adjuntar el archivo.
- Escribir texto al final para personalizar el pack/autor: *Pack | Autor*.

> Ejemplo: *${settings.prefix}sticker -c -blur Mi Pack | Mi Nombre*`;

function buildStickerFilters(effects = []) {
  const W = 512;
  const H = 512;
  const filters = [];
  const shape = effects.find((e) => e.type === "shape")?.value;
  const effectList = effects.filter((e) => e.type === "effect").map((e) => e.value);

  if (shape === "cover") {
    filters.push(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`);
  } else {
    filters.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
    filters.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
  }
  filters.push("format=rgba");

  for (const effect of effectList) {
    switch (effect) {
      case "blur": filters.push("gblur=sigma=5"); break;
      case "sepia": filters.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"); break;
      case "sharpen": filters.push("unsharp=5:5:1.0:5:5:0.0"); break;
      case "brighten": filters.push("eq=brightness=0.05"); break;
      case "darken": filters.push("eq=brightness=-0.05"); break;
      case "invert": case "negate": filters.push("negate"); break;
      case "grayscale": filters.push("hue=s=0"); break;
      case "rotate90": filters.push("transpose=1"); break;
      case "rotate180": filters.push("rotate=PI"); break;
      case "flip": filters.push("hflip"); break;
      case "flop": filters.push("vflip"); break;
      case "normalice": filters.push("normalize"); break;
      case "tint": filters.push("colorchannelmixer=1:0:0:0:0:0.5:0:0:0:0:0.5"); break;
    }
  }

  if (shape === "mirror") filters.push("hflip");
  if (shape && !["cover", "contain", "mirror", "border", "frame"].includes(shape)) {
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2;
    let alphaExpr = "";
    switch (shape) {
      case "circle": alphaExpr = `if(lte((X-${cx})*(X-${cx})+(Y-${cy})*(Y-${cy}),${r * r}),255,0)`; break;
      case "triangle": alphaExpr = `if(gte(Y,${H * 0.1})*lte(Y,${H * 0.9})*lte(abs(X-${cx}),((${H * 0.9}-Y)*0.6)),255,0)`; break;
      case "star": alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.25}+${W * 0.1}*cos(5*atan2(Y-${cy},X-${cx}))),255,0)`; break;
      case "roundrect": {
        const rad = 50;
        alphaExpr = `if(lte(if(gte(X,${rad})*lte(X,${W - rad})*gte(Y,0)*lte(Y,${H}),0,if(gte(Y,${rad})*lte(Y,${H - rad})*gte(X,0)*lte(X,${W}),0,if(lte(X,${rad})*lte(Y,${rad}),(X-${rad})*(X-${rad})+(Y-${rad})*(Y-${rad}),if(gte(X,${W - rad})*lte(Y,${rad}),(X-${W - rad})*(X-${W - rad})+(Y-${rad})*(Y-${rad}),if(lte(X,${rad})*gte(Y,${H - rad}),(X-${rad})*(X-${rad})+(Y-${H - rad})*(Y-${H - rad}),(X-${W - rad})*(X-${W - rad})+(Y-${H - rad})*(Y-${H - rad})))))),${rad * rad}),255,0)`;
        break;
      }
      case "hexagon": alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/6)/cos(mod(atan2(Y-${cy},X-${cx}),PI/3)-PI/6)),255,0)`; break;
      case "diamond": alphaExpr = `if(lte(abs(X-${cx})+abs(Y-${cy}),${r}),255,0)`; break;
      case "wave": alphaExpr = `if(lte(abs(Y-(${cy}+${H * 0.05}*sin(X*0.05))),${H * 0.4}),255,0)`; break;
      case "octagon": alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/8)/cos(mod(atan2(Y-${cy},X-${cx}),PI/4)-PI/8)),255,0)`; break;
      case "pentagon": alphaExpr = `if(lte(hypot(X-${cx},Y-${cy}),${W * 0.4}*cos(PI/5)/cos(mod(atan2(Y-${cy},X-${cx}),2*PI/5)-PI/5)),255,0)`; break;
      case "ellipse": alphaExpr = `if(lte(((X-${cx})*(X-${cx}))/(${(W * 0.45) * (W * 0.45)})+((Y-${cy})*(Y-${cy}))/(${(H * 0.4) * (H * 0.4)}),1),255,0)`; break;
      case "cross": alphaExpr = `if(gt(lte(abs(X-${cx}),${W * 0.15})*lte(abs(Y-${cy}),${H * 0.45})+lte(abs(Y-${cy}),${H * 0.15})*lte(abs(X-${cx}),${W * 0.45}),0),255,0)`; break;
      case "heart": alphaExpr = `if(lte(pow((X-${cx})/(${W * 0.3})*(X-${cx})/(${W * 0.3})+(Y-${cy})/(${H * 0.3})*(Y-${cy})/(${H * 0.3})-1,3)-((X-${cx})/(${W * 0.3})*(X-${cx})/(${W * 0.3}))*pow((Y-${cy})/(${H * 0.3}),3),0),255,0)`; break;
    }
    if (alphaExpr) filters.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}'`);
  }
  if (shape === "border") filters.push(`drawbox=x=0:y=0:w=${W}:h=${H}:color=white@0.9:t=10`);
  if (shape === "frame") filters.push(`drawbox=x=15:y=15:w=${W - 30}:h=${H - 30}:color=white@0.7:t=8`);
  filters.push("format=yuva420p");
  return filters.join(",");
}

// Convierte cualquier imagen/gif/video (buffer) a webp de sticker, aplicando
// formas/efectos si se piden. Se usa una única ruta (libwebp_anim) tanto para
// estáticos como animados, igual que hace WhatsApp internamente.
async function bufferToStickerWithEffects(buffer, { isVideo = false, effects = [] } = {}) {
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `s_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const inputPath = path.join(tempDir, `${baseName}.${isVideo ? "mp4" : "img"}`);
  const outputPath = path.join(tempDir, `${baseName}.webp`);
  fs.writeFileSync(inputPath, buffer);
  const vf = buildStickerFilters(effects);
  const args = ["-y", "-i", inputPath];
  if (isVideo) args.push("-t", "10");
  args.push(
    "-vf", vf, "-an", "-fps_mode", "passthrough",
    "-c:v", "libwebp_anim", "-preset", "picture", "-compression_level", "6",
    "-q:v", "70", "-loop", "0", outputPath
  );
  await runFfmpeg(args);
  const webpBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(outputPath);
  return webpBuffer;
}

// Convierte un webp animado (sticker citado) a gif, para poder aplicarle
// formas/efectos con los mismos filtros que el resto de fuentes.
async function convertWebpToGifBuffer(webpBuffer) {
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `conv_${Date.now()}`;
  const inputPath = path.join(tempDir, `${baseName}.webp`);
  const gifPath = path.join(tempDir, `${baseName}.gif`);
  fs.writeFileSync(inputPath, webpBuffer);
  await runFfmpeg([
    "-y", "-i", inputPath,
    "-vf", "fps=10,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
    "-loop", "0", gifPath,
  ]);
  const gifBuffer = fs.readFileSync(gifPath);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(gifPath);
  return gifBuffer;
}

async function handleAnimeReaction(sock, msg, sender, from, commandKey) {
  const config = REACTION_COMMANDS[commandKey];
  if (!config) return false;
  const mention = getMentionedJid(msg);
  if (config.needMention && !mention) {
    await sock.sendMessage(from, { text: `Debes mencionar a alguien para usar *${settings.prefix}${commandKey}*.` });
    return true;
  }
  const senderTag = `@${sender.split("@")[0]}`;
  const mentions = [sender];
  let text = "";
  if (mention) {
    const targetTag = `@${mention.split("@")[0]}`;
    mentions.push(mention);
    text = `${config.emoji} ${senderTag} ${config.text} ${targetTag}`;
  } else {
    text = `${config.emoji} ${senderTag} ${config.text}`;
  }
  await reactToMessage(sock, msg, config.emoji);
  let mediaUrl;
  if (config.source === "apicausas") {
    mediaUrl = await fetchApicausasAnime(commandKey);
    if (!mediaUrl) {
      // Fallback a waifu.pics si apicausas no soporta esta acción o falla
      const endpoint = WAIFUPICS_MAP[commandKey] || commandKey;
      mediaUrl = await fetchWaifuPics(endpoint);
    }
  } else if (config.source === "nekosbest") {
    mediaUrl = await fetchNekosBest(commandKey);
  } else if (config.source === "purrbot") {
    mediaUrl = await fetchPurrbot(commandKey === "comfort" ? "comfy" : commandKey);
  } else {
    const endpoint = WAIFUPICS_MAP[commandKey] || commandKey;
    mediaUrl = await fetchWaifuPics(endpoint);
  }
  await sendReactionMedia(sock, from, mediaUrl, text, mentions);
  return true;
}

// ════════════════════════════════════════════════════════════
//   LOGGER
// ════════════════════════════════════════════════════════════
const log = {
  info:    (m) => console.log(chalk.bgBlue.white.bold(" INFO "),    chalk.white(m)),
  success: (m) => console.log(chalk.bgGreen.white.bold(" OK "),     chalk.greenBright(m)),
  warn:    (m) => console.log(chalk.bgYellowBright.black.bold(" WARN "), chalk.yellow(m)),
  error:   (m) => console.log(chalk.bgRed.white.bold(" ERROR "),   chalk.redBright(m)),
};

// ════════════════════════════════════════════════════════════
//   NORMALIZACIÓN DE TELÉFONO
// ════════════════════════════════════════════════════════════
function normalizePhone(input) {
  let s = String(input).replace(/\D/g, "");
  if (!s) return "";
  if (s.startsWith("0")) s = s.replace(/^0+/, "");
  if (s.length === 10 && s.startsWith("3")) s = "57" + s;
  if (s.startsWith("52") && !s.startsWith("521") && s.length >= 12) s = "521" + s.slice(2);
  if (s.startsWith("54") && !s.startsWith("549") && s.length >= 11) s = "549" + s.slice(2);
  return s;
}

// ════════════════════════════════════════════════════════════
//   MENÚ DE VINCULACIÓN (síncrono, antes de iniciar el bot)
// ════════════════════════════════════════════════════════════
function clearSession() {
  try {
    const sessionDir = settings.baileys.authFolder;
    if (!fs.existsSync(sessionDir)) return;
    for (const file of fs.readdirSync(sessionDir)) {
      try { fs.unlinkSync(path.join(sessionDir, file)); } catch {}
    }
    log.warn("Sesión eliminada — reiniciando para vincular de nuevo...");
  } catch (e) {
    log.error(`clearSession → ${e?.message || e}`);
  }
}

// ════════════════════════════════════════════════════════════
//   SUB-BOTS — conexiones independientes (número vinculado
//   aparte del bot principal, cada uno con su propia sesión)
// ════════════════════════════════════════════════════════════
const subBots = {}; // { [phoneNumber]: { sock, authFolder, connected, isCode, ownerSock, ownerChatId, ownerMsg } }
let mainSock = null; // referencia al socket principal, usada en el apagado ordenado
const MAX_SUBBOTS = 50;
const LINK_COOLDOWN_MS = 80_000; // 80s entre solicitudes de vinculación por usuario
const WAIFU_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos entre usos de !waifu por usuario

function fmtWaifuTimeLeft(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  let out = "";
  if (m > 0) out += `${m}m `;
  if (s > 0 || out === "") out += `${s}s`;
  return out.trim();
}

function subBotAuthFolder(phoneNumber) {
  const base = settings.baileys.subBotsFolder || "./auth_info_subbots";
  return path.join(base, phoneNumber);
}

// Envía un mensaje con el botón nativo "Copiar código" de WhatsApp (cta_copy),
// para que el código de vinculación se copie al portapapeles con un toque en
// vez de tener que seleccionar el texto a mano. Si la versión de WhatsApp o
// de Baileys no soporta el botón, cae automáticamente a un mensaje de texto normal.
async function sendCopyableCode(sock, jid, { body, footer, code, quoted } = {}) {
  try {
    const waMsg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
            interactiveMessage: proto.Message.InteractiveMessage.create({
              body: proto.Message.InteractiveMessage.Body.create({ text: body }),
              footer: proto.Message.InteractiveMessage.Footer.create({ text: footer || "" }),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                buttons: [
                  {
                    name: "cta_copy",
                    buttonParamsJson: JSON.stringify({
                      display_text: "📋 Copiar código",
                      id: `copy_${Date.now()}`,
                      copy_code: code,
                    }),
                  },
                ],
              }),
            }),
          },
        },
      },
      { userJid: sock.user?.id, quoted }
    );
    await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
    return waMsg;
  } catch (error) {
    logError("Error enviando botón de copiar, usando texto plano:", error);
    return sock.sendMessage(jid, { text: body }, quoted ? { quoted } : {});
  }
}

async function startSubBot(phoneNumber, ownerSock, ownerChatId, ownerMsg, isCode = true) {
  if (subBots[phoneNumber]?.sock) {
    throw new Error(`Ya existe un sub-bot activo o en proceso para ${phoneNumber}.`);
  }

  const authFolder = subBotAuthFolder(phoneNumber);
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const subSock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: settings.baileys.markOnlineOnConnect,
    keepAliveIntervalMs: 25_000,
    shouldIgnoreJid: (jid) => jid.endsWith("@broadcast"),
    generateHighQualityLinkPreview: true,
  });
  applyFierenBranding(subSock);

  // BUG FIX (sub-bots): ownerSock/ownerChatId/ownerMsg viven DENTRO del
  // registro (no solo como parámetros cerrados en el closure) para poder
  // refrescarlos desde afuera (ver connection === "open" del bot principal)
  // cuando el socket que los vinculó se reconecta con un objeto nuevo.
  subBots[phoneNumber] = {
    sock: subSock,
    authFolder,
    connected: false,
    isCode,
    ownerSock,
    ownerChatId,
    ownerMsg,
  };

  subSock.ev.on("creds.update", saveCreds);
  subSock.ev.on("messages.upsert", (payload) => {
    handleMessages(subSock, payload).catch((error) => {
      logError(`❌ Error no capturado procesando mensaje en sub-bot ${phoneNumber}:`, error);
    });
  });

  let pairingRequested = false;
  let subReconexion = 0;

  // DIAGNÓSTICO: si en 20s no llegó ni un "qr" ni la conexión se cerró, algo
  // se quedó atascado en el handshake con WhatsApp (antes esto fallaba en
  // silencio total: sin código, sin error, para siempre). Avisamos al owner
  // y dejamos rastro en consola para poder diagnosticarlo.
  const stallTimeout = setTimeout(() => {
    if (!pairingRequested && subBots[phoneNumber]?.sock === subSock) {
      log.warn(`Sub-bot ${phoneNumber}: sigue en "connecting" tras 20s, no llegó ningún "qr" de WhatsApp.`);
      liveOwnerSockSafeNotify(
        subBots[phoneNumber],
        `⚠️ El sub-bot *${phoneNumber}* lleva más de 20s intentando conectar y no recibió respuesta de WhatsApp para generar el código.\n` +
          `> Posibles causas: otro proceso/instancia vieja del bot sigue corriendo (revisa con \`node\` en tu Administrador de tareas o \`ps\`), un firewall/antivirus bloqueando la conexión, o WhatsApp limitando intentos repetidos. Prueba cerrar cualquier proceso viejo, espera un minuto y usa *${settings.prefix}code* de nuevo.`
      );
    }
  }, 20_000);

  function liveOwnerSockSafeNotify(entry, text) {
    const s = entry?.ownerSock || ownerSock;
    const c = entry?.ownerChatId || ownerChatId;
    if (!s || !c) return;
    s.sendMessage(c, { text }).catch(() => {});
  }

  subSock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
    // DIAGNÓSTICO: registro en consola de cada cambio de estado, para poder
    // ver en logs si se queda atascado en "connecting" o si cierra con algún
    // motivo específico.
    if (connection) log.info(`Sub-bot ${phoneNumber}: connection.update → ${connection}${qr ? " (con qr)" : ""}`);

    // BUG FIX (sub-bots): leemos ownerSock/ownerChatId/ownerMsg desde el
    // registro vivo (no desde los parámetros originales) por si el socket
    // principal se reconectó entre que se pidió la vinculación y ahora.
    const owner = subBots[phoneNumber] || { ownerSock, ownerChatId, ownerMsg };
    const { ownerSock: liveOwnerSock, ownerChatId: liveOwnerChatId, ownerMsg: liveOwnerMsg } = owner;

    if (qr && !state.creds.registered && !pairingRequested) {
      pairingRequested = true;
      clearTimeout(stallTimeout);
      if (isCode) {
        try {
          const code = await subSock.requestPairingCode(phoneNumber);
          const formatted = code.match(/.{1,4}/g)?.join("-") || code;
          await liveOwnerSock.sendMessage(liveOwnerChatId, {
            text: `📞 Número: *${phoneNumber}*`,
          }, { quoted: liveOwnerMsg });
          const codeMsg = await sendCopyableCode(liveOwnerSock, liveOwnerChatId, {
            body:
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `📜 *Sello de Vinculación (Sub-Bot)*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `\n` +
              `　🔢 *${formatted}*\n` +
              `\n` +
              `☆ Toca el botón para copiar el código, o ingrésalo tú mismo en WhatsApp de ese número:\n` +
              `   ↳ *Dispositivos vinculados →*\n` +
              `   ↳ *Vincular con número de teléfono*\n` +
              `\n` +
              `⚠️ El sello se desvanece en *60 segundos*.`,
            footer: "Fieren-bot ⋆ Vinculación de Sub-Bot",
            code,
            quoted: liveOwnerMsg,
          });
          setTimeout(() => {
            liveOwnerSock.sendMessage(liveOwnerChatId, { delete: codeMsg.key }).catch(() => {});
          }, 60_000);
        } catch (error) {
          delete subBots[phoneNumber];
          try { subSock.end(undefined); } catch {}
          try {
            await liveOwnerSock.sendMessage(liveOwnerChatId, {
              text: `❌ No se pudo generar el código para el sub-bot.\n> ${error?.message || "Error desconocido"}`,
            }, { quoted: liveOwnerMsg });
          } catch {}
        }
      } else {
        try {
          const qrBuffer = await qrcode.toBuffer(qr, { scale: 8 });
          const qrMsg = await liveOwnerSock.sendMessage(liveOwnerChatId, {
            image: qrBuffer,
            caption:
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `📜 *Sello de Vinculación (Sub-Bot)*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n` +
              `☆ Escanea este código QR con WhatsApp:\n` +
              `   ↳ *Dispositivos vinculados →*\n` +
              `   ↳ *Vincular un dispositivo*\n\n` +
              `⚠️ El sello se desvanece en *60 segundos*.`,
          }, { quoted: liveOwnerMsg });
          setTimeout(() => {
            liveOwnerSock.sendMessage(liveOwnerChatId, { delete: qrMsg.key }).catch(() => {});
          }, 60_000);
        } catch (error) {
          delete subBots[phoneNumber];
          try { subSock.end(undefined); } catch {}
          try {
            await liveOwnerSock.sendMessage(liveOwnerChatId, {
              text: `❌ No se pudo generar el código QR para el sub-bot.\n> ${error?.message || "Error desconocido"}`,
            }, { quoted: liveOwnerMsg });
          } catch {}
        }
      }
    }

    if (connection === "open") {
      clearTimeout(stallTimeout);
      if (subBots[phoneNumber]) subBots[phoneNumber].connected = true;
      subReconexion = 0;
      log.success(`Sub-bot ${phoneNumber} conectado.`);
      try { db.setSettings(`${phoneNumber}@s.whatsapp.net`, "type", "Sub"); } catch {}
      try {
        await liveOwnerSock.sendMessage(liveOwnerChatId, {
          text: `✅ Sub-bot *${phoneNumber}* vinculado y conectado correctamente.`,
        });
      } catch (err) {
        log.error(`Sub-bot ${phoneNumber}: se conectó pero no pude avisarle al owner → ${err?.message || err}`);
      }
    }

    if (connection === "close") {
      clearTimeout(stallTimeout);
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      // Nombre legible del motivo, solo para que el log diga algo útil en vez de un número.
      const reasonName =
        Object.entries(DisconnectReason).find(([, value]) => value === reason)?.[0] || `desconocido`;
      log.warn(`Sub-bot ${phoneNumber}: conexión cerrada (${reason} / ${reasonName}).`);

      if ([DisconnectReason.loggedOut, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(reason)) {
        log.warn(`Sub-bot ${phoneNumber} desvinculado — eliminando sesión.`);
        delete subBots[phoneNumber];
        try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch {}
        try {
          if (liveOwnerChatId) {
            await liveOwnerSock.sendMessage(liveOwnerChatId, {
              text: `⚠️ El sub-bot *${phoneNumber}* se desvinculó (${reasonName}). Vuelve a usar *${settings.prefix}code* para generar un nuevo enlace.`,
            });
          }
        } catch {}
        return;
      }

      subReconexion++;
      if (subReconexion > 10) {
        log.error(`Sub-bot ${phoneNumber}: demasiados reintentos (${reasonName}), deteniendo.`);
        delete subBots[phoneNumber];
        try {
          if (liveOwnerChatId) {
            await liveOwnerSock.sendMessage(liveOwnerChatId, {
              text:
                `❌ No pude completar la vinculación del sub-bot *${phoneNumber}* tras varios intentos ` +
                `(motivo: ${reasonName}).\n` +
                `> Vuelve a intentar con *${settings.prefix}code*. Si el problema persiste, revisa los logs del servidor ` +
                `justo después de ingresar el código — ahí debería quedar registrado el motivo exacto.`,
            });
          }
        } catch {}
        return;
      }

      // El cierre con "restartRequired" justo después de ingresar el código es NORMAL en
      // Baileys (WhatsApp reinicia la conexión para terminar de registrar el dispositivo).
      // En ese caso reconectamos casi de inmediato en vez de esperar el backoff normal.
      const delay = reason === DisconnectReason.restartRequired
        ? 500
        : Math.min(3000 * subReconexion, 30000);

      // IMPORTANTE: liberamos el slot ANTES de reintentar. startSubBot()
      // rechaza con "ya existe un sub-bot activo" si subBots[phoneNumber]
      // sigue apuntando al socket viejo (ya cerrado), lo que hacía que la
      // reconexión fallara siempre y el sub-bot quedara muerto hasta
      // desvincularlo y volver a vincularlo a mano.
      delete subBots[phoneNumber];
      setTimeout(() => {
        startSubBot(phoneNumber, liveOwnerSock, liveOwnerChatId, liveOwnerMsg, isCode).catch((e) => {
          log.error(`Sub-bot ${phoneNumber} → ${e?.message || e}`);
        });
      }, delay);
    }
  });

  return subSock;
}

function stopSubBot(phoneNumber) {
  const entry = subBots[phoneNumber];
  if (!entry) return false;
  try { entry.sock.logout(); } catch {}
  try { entry.sock.end(undefined); } catch {}
  try { fs.rmSync(entry.authFolder, { recursive: true, force: true }); } catch {}
  delete subBots[phoneNumber];
  return true;
}

// ════════════════════════════════════════════════════════════
//   AUTO-CARGA DE SUB-BOTS YA VINCULADOS
//   Al iniciar, reconecta cualquier sesión que ya tenga
//   creds.json (vinculada previamente fuera de Railway, ej.
//   desde Termux, y luego importada con !importsub).
//   No requiere nuevo código de vinculación, así que no choca
//   con el bloqueo de WhatsApp a IPs de datacenter.
// ════════════════════════════════════════════════════════════
async function loadExistingSubBots(ownerSock) {
  const base = settings.baileys.subBotsFolder || "./auth_info_subbots";
  if (!fs.existsSync(base)) return;

  const entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of entries) {
    const phoneNumber = entry.name;
    const credsPath = path.join(base, phoneNumber, "creds.json");
    if (!fs.existsSync(credsPath)) continue;
    if (subBots[phoneNumber]?.sock) continue;

    try {
      await startSubBot(phoneNumber, ownerSock, null, null, false);
      log.info(`Sub-bot ${phoneNumber} recargado desde sesión existente.`);
    } catch (error) {
      log.error(`No se pudo recargar sub-bot ${phoneNumber} → ${error?.message || error}`);
    }
  }
}

let opcion = "2";
const DEFAULT_PAIRING_NUMBER = "5355622656";
let phoneNumber = normalizePhone(process.env.PHONE_NUMBER || DEFAULT_PAIRING_NUMBER);

function chooseLinkMethod() {
  const credsPath = path.join(settings.baileys.authFolder, "creds.json");
  if (fs.existsSync(credsPath)) return; // ya hay sesión, no hace falta vincular de nuevo

  // Vinculación siempre por código, automáticamente, sin QR ni preguntas.
  opcion = "2";
  log.info(`Vinculando por código con el número ${phoneNumber}.`);
}

chooseLinkMethod();

// ════════════════════════════════════════════════════════════
//   BOT PRINCIPAL
// ════════════════════════════════════════════════════════════
let reconexion    = 0;
let bootTime      = Date.now();
let botReady      = false;
let isRestarting  = false;
const retriesLimit = 15;

async function startBot() {
  if (isRestarting) return;
  isRestarting = true;
  bootTime = Date.now();

  const { state, saveCreds } = await useMultiFileAuthState(settings.baileys.authFolder);
  const { version } = await fetchLatestBaileysVersion();

  log.info(`Iniciando ${settings.bot.name} — Baileys ${version.join(".")}`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: settings.baileys.browser,
    syncFullHistory: settings.baileys.syncFullHistory,
    markOnlineOnConnect: settings.baileys.markOnlineOnConnect,
    keepAliveIntervalMs: 25_000,
    shouldIgnoreJid: (jid) => jid.endsWith("@broadcast"),
    generateHighQualityLinkPreview: true,
  });
  applyFierenBranding(sock);
  // BUG FIX (sub-bots): guardamos la referencia al socket principal ANTERIOR
  // antes de pisarla. Los sub-bots guardan su propio "ownerSock" (a quién
  // avisarle cosas como "te desvinculaste" o "ya me conecté"). Si el bot
  // principal se reconecta (nuevo objeto `sock`), esa referencia queda
  // apuntando a un socket muerto y los avisos se pierden en silencio.
  // Más abajo, al reconectar, actualizamos esa referencia en cada sub-bot.
  const previousMainSock = mainSock;
  mainSock = sock;

  sock.ev.on("creds.update", saveCreds);

  let pairingCodeRequested = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications }) => {
    if (qr && !state.creds.registered && !pairingCodeRequested) {
      pairingCodeRequested = true;
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        const formatted = code.match(/.{1,4}/g)?.join("-") || code;
        console.log("\n" + chalk.bold.white(chalk.bgMagenta("  🔢 Código de vinculación:  ")));
        console.log(chalk.bold.cyanBright(`\n  ${formatted}\n`));
        console.log(chalk.gray(`  Número: ${phoneNumber}`));
        console.log(chalk.gray("  WhatsApp → Dispositivos vinculados → Vincular con número de teléfono\n"));
      } catch (err) {
        log.error(`Error al generar código: ${err?.message || err}`);
      }
    }

    if (isNewLogin)                   log.info("Nuevo dispositivo detectado.");
    if (receivedPendingNotifications) log.warn("Cargando mensajes pendientes, espera un momento...");

    if (connection === "open") {
      reconexion   = 0;
      isRestarting = false;
      botReady     = true;
      bootTime     = Date.now();
      log.success(`${settings.bot.name} conectado como ${sock.user?.name || sock.user?.id}`);

      // BUG FIX (sub-bots): los sub-bots que ya estaban vinculados desde el
      // socket principal anterior actualizan su "ownerSock" al nuevo, para
      // no quedarse mandando avisos (desvinculado, reconectado, etc.) a un
      // socket ya cerrado.
      for (const entry of Object.values(subBots)) {
        if (entry.ownerSock === previousMainSock) entry.ownerSock = sock;
      }

      loadExistingSubBots(sock).catch((e) => log.error(`loadExistingSubBots → ${e?.message || e}`));
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode || 0;
      isRestarting = false;

      if ([DisconnectReason.loggedOut, DisconnectReason.forbidden, DisconnectReason.multideviceMismatch].includes(reason)) {
        log.warn(`Desvinculado (${reason}) — limpiando sesión...`);
        botReady = false;
        clearSession();
        process.exit(1);
      }
      if (reason === DisconnectReason.connectionReplaced) {
        log.warn("Conexión reemplazada — cerrá la otra sesión antes de reconectar.");
        return;
      }

      reconexion++;
      if (reconexion > retriesLimit) {
        log.error(`Demasiados reintentos (${retriesLimit}) — limpiando sesión corrupta...`);
        botReady = false;
        reconexion = 0;
        clearSession();
        process.exit(1);
      }

      const reasonMessages = {
        [DisconnectReason.connectionLost]:   "Se perdió la conexión.",
        [DisconnectReason.connectionClosed]: "Conexión cerrada.",
        [DisconnectReason.restartRequired]:  "Se requiere reinicio.",
        [DisconnectReason.timedOut]:         "Tiempo de conexión agotado.",
        [DisconnectReason.badSession]:       "Sesión inválida.",
      };
      const delay = Math.min(3000 * reconexion, 30000);
      log.warn(`${reasonMessages[reason] || `Desconexión (${reason})`} Reconectando en ${delay / 1000}s... (${reconexion}/${retriesLimit})`);
      setTimeout(startBot, delay);
    }
  });

  // ── Banner de bienvenida/despedida (canvas dinámico) ────────────────────
  // Genera una imagen personalizada con foto de perfil del usuario, nombre
  // del grupo y texto (Welcome/Goodbye) usando la API de sm2.alycore.xyz.
  async function buildWelcomeCanvas({ sock, groupId, participant, text }) {
    const DEFAULT_PFP =
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQwArvx_-nYyV9Rsfh8bUS8UVmnubU3svW-JnArdPI4kyY4Bj9nS0pgUmz2&s=10";
    const profileUrl = await sock
      .profilePictureUrl(participant, "image")
      .catch(() => DEFAULT_PFP);
    const groupName = await sock
      .groupMetadata(groupId)
      .then((m) => m.subject)
      .catch(() => "Frieren-bot_Oficial");

    const params = new URLSearchParams({
      background: "https://files.catbox.moe/6yjgna.png",
      profile: profileUrl,
      text,
      group: groupName,
      font: "4.ttf",
      font2: "3.ttf",
      glich: "off",
    });

    const canvasUrl = `https://sm2.alycore.xyz/canvas?${params.toString()}`;
    const res = await fetch(canvasUrl);
    if (!res.ok) throw new Error(`La API de canvas respondió con estado ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    try {
      if (!id.endsWith("@g.us")) return;
      for (const participant of participants) {
        const tag = `@${participant.split("@")[0]}`;
        if (action === "add" && settings.groups?.welcome) {
          const welcomeCaption =
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
            `　　　✿ *¡BIENVENIDO/A!* ✿\n` +
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n` +
            `☆ ${tag}, esperamos que la pases bien por aquí ⋆౨ৎ˚`;
          try {
            const banner = await buildWelcomeCanvas({ sock, groupId: id, participant, text: "Welcome" });
            await sock.sendMessage(id, {
              image: banner,
              caption: welcomeCaption,
              mentions: [participant],
            });
          } catch (error) {
            logError("Error generando banner de bienvenida:", error);
            await sock.sendMessage(id, { text: welcomeCaption, mentions: [participant] });
          }
        }
        if ((action === "remove" || action === "leave") && settings.groups?.goodbye) {
          const goodbyeCaption =
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
            `　　　✿ *¡HASTA PRONTO!* ✿\n` +
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n` +
            `☆ ${tag} salio del grupo.`;
          try {
            const banner = await buildWelcomeCanvas({ sock, groupId: id, participant, text: "Goodbye" });
            await sock.sendMessage(id, {
              image: banner,
              caption: goodbyeCaption,
              mentions: [participant],
            });
          } catch (error) {
            logError("Error generando banner de despedida:", error);
            await sock.sendMessage(id, { text: goodbyeCaption, mentions: [participant] });
          }
        }
      }
    } catch (error) {
      logError("Error en eventos de grupo:", error);
    }
  });

  sock.ev.on("messages.upsert", (payload) => {
    handleMessages(sock, payload).catch((error) => {
      logError("❌ Error no capturado procesando mensaje:", error);
    });
  });
}

// ════════════════════════════════════════════════════════════
//   MANEJADOR DE MENSAJES — reutilizado por el bot principal
//   y por cualquier sub-bot vinculado con !code
// ════════════════════════════════════════════════════════════
async function handleMessages(sock, { messages, type }) {
    if (type !== "notify") return;

    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");

    // BUG FIX: en chats privados, msg.key.participant no existe
    // remoteJid es el JID del usuario directamente
    const sender = isGroup
      ? (msg.key.participant || msg.key.remoteJid)
      : msg.key.remoteJid;

    if (msg.key.fromMe) {
      // Por defecto se ignoran los mensajes salientes del propio bot (sus
      // respuestas, reenvíos, etc.) para no crear loops. Única excepción:
      // el owner del socket (el número vinculado) escribiendo un comando,
      // sea en su chat privado consigo mismo, en un grupo, o en cualquier
      // otro chat — WhatsApp marca fromMe=true en todos esos casos porque
      // el mensaje sale de la misma cuenta conectada. Antes esto solo se
      // permitía en el chat privado consigo mismo (!isGroup), por lo que
      // la persona con el bot vinculado no podía usarlo desde un grupo.
      const botId = getBotId(sock);
      const isFromLinkedOwner = bareNumber(sender) === bareNumber(botId);
      const rawBody = getMessageText(msg).trim();
      const prefixes = getBotPrefixes(sock);
      const looksLikeCommand = prefixes.some((p) => p !== "" && rawBody.startsWith(p));
      if (!isFromLinkedOwner || !looksLikeCommand) return;
    }

    const body = getMessageText(msg).trim();
    const directMessage = unwrapViewOnce(msg.message);
    const isImage = !!directMessage?.imageMessage;
    const quotedImageMessage = getQuotedImageMessage(msg);
    const quotedVideoMessage = getQuotedVideoMessage(msg);
    const quotedImage = !!quotedImageMessage;
    const isVideo = !!directMessage?.videoMessage;
    const quotedVideo = !!quotedVideoMessage;
    const owner1 = formatOwnerNumber(settings.bot.ownerNumber);
    const owner2 = formatOwnerNumber(settings.bot.secondaryOwnerNumber || "");
    const owner3 = formatOwnerNumber(settings.bot.tertiaryOwnerNumber || "");

    const senderIsOwner = isOwner(sender, settings, msg);

    console.log(`Mensaje de ${from}: ${body}`);

    // ── XP automático por mensajes en grupos ──
    if (isGroup) addMessageXP(sender, from);

    // ── AFK: quita el estado AFK si el sender vuelve, y avisa si menciona/cita a un AFK ──
    try {
      await checkAfk(sock, msg, sender, from, getMentionedJid(msg), getQuotedParticipant(msg), economy);
    } catch (error) {
      logError("Error en checkAfk:", error);
    }

    // ── Minijuego de matemáticas: revisa si el mensaje es la respuesta a un problema pendiente ──
    try {
      const answered = await checkMathAnswer(sock, msg, sender, from, body);
      if (answered) return;
    } catch (error) {
      logError("Error en checkMathAnswer:", error);
    }

    // ── Anti-link ──
    // El estado por grupo se guarda en db.js (clave = JID del grupo). Si el
    // grupo nunca lo configuró, se usa el valor por defecto de settings.js.
    const groupAntiLinkCfg = isGroup ? db.getSettings(from) : {};
    const antiLinkEnabled =
      groupAntiLinkCfg.antiLink !== undefined ? groupAntiLinkCfg.antiLink : settings.groups?.antiLink;
    if (isGroup && antiLinkEnabled && body.match(/https?:\/\/|chat\.whatsapp\.com\//i)) {
      try {
        const senderIsAdmin = await isAdmin(sock, from, sender, msg);
        const botIsAdmin = await isBotAdmin(sock, from);
        if (!senderIsAdmin && !senderIsOwner && botIsAdmin) {
          await sock.sendMessage(from, {
            text: `⛔ Enlaces no permitidos, @${sender.split("@")[0]}.`,
            mentions: [sender],
          });
          await sock.groupParticipantsUpdate(from, [sender], "remove");
          return;
        }
      } catch (error) {
        logError("Error en anti-link:", error);
      }
    }

    // ── Modo Self: si está activado para este socket, solo responde al owner del socket ──
    const socketConfig = db.getSettings(getBotId(sock)) || {};
    if (socketConfig.self && !isSocketOwner(sock, sender, senderIsOwner, msg)) return;

    const botPrefixes = getBotPrefixes(sock);
    const usedPrefix = botPrefixes.find((p) => p === "" || body.startsWith(p));

    if (usedPrefix === undefined) {
      // Sin prefijo válido: la IA solo responde si el usuario le está
      // respondiendo (citando) directamente un mensaje que ELLA envió antes.
      // Ya no depende de un "modo sin prefijo" por tiempo, así no contesta
      // mensajes sueltos del grupo ni respuestas a otros comandos del bot.
      if (body.length && isReplyToAiMessage(msg)) {
        await runAiQuery(sock, msg, sender, from, body, isImage, directMessage);
      }
      return;
    }
    if (!body.length) return;

    const [rawCommand, ...args] = body.slice(usedPrefix.length).trim().split(" ");
    const command = (rawCommand || "").toLowerCase();
    const mappedReaction = COMMAND_ALIASES[command];

    if (mappedReaction) {
      await handleAnimeReaction(sock, msg, sender, from, mappedReaction);
      return;
    }

    // ── Red de seguridad global: cualquier error no capturado dentro de un
    // comando (case) cae aquí en vez de tumbar el proceso o perderse en un
    // unhandledRejection silencioso. Se avisa al usuario y se loguea con
    // contexto (comando + chat) para poder depurarlo después.
    try {
    switch (command) {

      // ── BÁSICOS ───────────────────────────────────────────────────────────────
      case "ping": {
        await reactToMessage(sock, msg, "🏓");
        const t0 = Date.now();
        const ramMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
        const uptimeSec = process.uptime();
        const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${Math.floor(uptimeSec % 60)}s`;
        const sent = await sock.sendMessage(from, { text: "🏓 Calculando..." });
        const latency = Date.now() - t0;
        await sock.sendMessage(from, {
          text:
            `🏓 *Pong!*\n\n` +
            `⏱️ *Latencia:* ${latency} ms\n` +
            `💾 *RAM:* ${ramMB} MB\n` +
            `⏳ *Uptime:* ${uptimeStr}`,
          edit: sent.key,
        });
        break;
      }

      case "info":
        await reactToMessage(sock, msg, "ℹ️");
        await sock.sendMessage(from, {
          text: `*${getBotDisplayName(sock)}*\nDevs: Jinn y Emma\nContactos: ${owner1} / ${owner2}\nPrefijo: ${usedPrefix || getBotPrefixes(sock)[0]}`,
        });
        break;

      case "owner":
        await reactToMessage(sock, msg, "👑");
        await sock.sendMessage(from, {
          text: `*Owners del bot*\n\n1. Jinn: wa.me/${owner1}\n2. Emma: wa.me/${owner2}`,
        });
        break;

      case "myid":
        await reactToMessage(sock, msg, "🆔");
        await sock.sendMessage(from, {
          text: `*Tu identificador detectado*\n\nJID completo: ${sender}\nNumero limpio: ${formatOwnerNumber(`${sender}`.split(":")[0])}`,
        });
        break;

      case "help":
      case "menu":
      case "ayuda":
        await reactToMessage(sock, msg, "📋");
        {
          const p = usedPrefix || getBotPrefixes(sock)[0] || settings.prefix;
          const pkgVersion = require("./package.json").version || "1.0.0";
          const pushName = msg.pushName || "Usuario";
          const botDisplayName = getBotDisplayName(sock);
          const totalUsers = (() => {
            try { return Object.keys(economy.loadEconomy()).length; } catch { return 1; }
          })();

          const menuCaption =
              `　　⋆｡°✩ *${botDisplayName}* ✩°｡⋆\n` +
              `　✦ "Un hechizo para cada ocasión" ✦\n\n` +
              `¡Hola, @${sender.split("@")[0]}! Aquí tienes mi grimorio de comandos ⋆౨ৎ˚\n\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🕯️ *INFO*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `☆ Autor ⋆ Jinn y Emma\n` +
              `☆ Tipo ⋆ ${senderIsOwner ? "Owner" : "Usuario"}\n` +
              `☆ Versión ⋆ ^${pkgVersion}\n` +
              `☆ Prefijo ⋆ ${p}\n` +
              `☆ Hora ⋆ ${formatMenuDate(new Date())}\n` +
              `☆ Viajeros ⋆ ${totalUsers}\n` +
              `☆ Canal ⋆ ${FIEREN_CHANNEL_LINK}\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🔮 *ECONOMÍA*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos de Economía para ganar coins y divertirte con tus amigos.\n\n` +
              `☆ *${p}work » ${p}w*\n   ↳ Ganar coins trabajando.\n` +
              `☆ *${p}balance » ${p}bal » ${p}coins* + <mention>\n   ↳ Ver cuántos coins tienes.\n` +
              `☆ *${p}coinflip » ${p}flip » ${p}cf* + <cantidad / cara|cruz>\n   ↳ Apostar coins en un cara o cruz.\n` +
              `☆ *${p}crime*\n   ↳ Ganar coins rápido.\n` +
              `☆ *${p}daily*\n   ↳ Reclamar tu recompensa diaria (con racha).\n` +
              `☆ *${p}deposit » ${p}dep » ${p}depositar*\n   ↳ Depositar tus coins en el banco.\n` +
              `☆ *${p}economyboard » ${p}eboard » ${p}baltop* + <page>\n   ↳ Ver el ranking de usuarios con más coins.\n` +
              `☆ *${p}casino » ${p}apostar* + <cantidad>\n   ↳ Apostar coins en las tragamonedas.\n` +
              `☆ *${p}economyinfo » ${p}einfo*\n   ↳ Ver tu información de economía y salud.\n` +
              `☆ *${p}givecoins » ${p}pay » ${p}coinsgive* + <cantidad / mention>\n   ↳ Dar coins a un usuario.\n` +
              `☆ *${p}roulette » ${p}rt* + <cantidad / color>\n   ↳ Apostar coins en una ruleta.\n` +
              `☆ *${p}slut*\n   ↳ Ganar coins de forma arriesgada.\n` +
              `☆ *${p}steal » ${p}robar » ${p}rob* + <mention>\n   ↳ Intentar robar coins a un usuario.\n` +
              `☆ *${p}withdraw » ${p}with » ${p}retirar*\n   ↳ Retirar tus coins del banco.\n` +
              `☆ *${p}minar » ${p}mine*\n   ↳ Realizar trabajos de minería y ganar coins.\n` +
              `☆ *${p}cofre » ${p}coffer*\n   ↳ Reclamar tu cofre (cada 12h).\n` +
              `☆ *${p}monthly » ${p}mensual*\n   ↳ Reclamar tu recompensa mensual.\n` +
              `☆ *${p}aventura » ${p}adventure*\n   ↳ Ir de aventuras para ganar coins.\n` +
              `☆ *${p}curar » ${p}heal* + <mention>\n   ↳ Curar salud para salir de aventuras.\n` +
              `☆ *${p}cazar » ${p}hunt*\n   ↳ Cazar animales para ganar coins.\n` +
              `☆ *${p}fish » ${p}pescar*\n   ↳ Ganar coins pescando.\n` +
              `☆ *${p}mazmorra » ${p}dungeon*\n   ↳ Explorar mazmorras para ganar coins (mayor riesgo).\n` +
              `☆ *${p}invoke » ${p}ritual » ${p}invocar*\n   ↳ Hacer un ritual arriesgado (cuesta 100 coins).\n` +
              `☆ *${p}math* + <facil|medio|dificil|imposible|imposible2>\n   ↳ Iniciar un juego de matemáticas.\n` +
              `☆ *${p}ppt* + <piedra|papel|tijera>\n   ↳ Jugar piedra, papel o tijera con el bot y gana o pierde coins.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `📜 *GACHA*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos de Gacha para reclamar e intercambiar personajes.\n\n` +
              `☆ *${p}buycharacter » ${p}buychar » ${p}buyc* + <waifu>\n   ↳ Comprar un personaje en venta.\n` +
              `☆ *${p}charimage » ${p}waifuimage » ${p}cimage » ${p}wimage* + <waifu>\n   ↳ Ver una imagen aleatoria de un personaje.\n` +
              `☆ *${p}charinfo » ${p}winfo » ${p}waifuinfo* + <waifu>\n   ↳ Ver información de un personaje.\n` +
              `☆ *${p}claim » ${p}c » ${p}reclamar* + <cite / waifu>\n   ↳ Reclamar un personaje.\n` +
              `☆ *${p}delclaimmsg*\n   ↳ Restablecer el mensaje al reclamar un personaje.\n` +
              `☆ *${p}deletewaifu » ${p}delwaifu » ${p}delchar* + <waifu>\n   ↳ Eliminar un personaje reclamado.\n` +
              `☆ *${p}favoritetop » ${p}favtop*\n   ↳ Ver el top de personajes favoritos.\n` +
              `☆ *${p}gachainfo » ${p}ginfo » ${p}infogacha*\n   ↳ Ver tu información de gacha.\n` +
              `☆ *${p}giveallharem* + <mention>\n   ↳ Regalar todos tus personajes a otro usuario.\n` +
              `☆ *${p}givechar » ${p}givewaifu » ${p}regalar* + <waifu / mention>\n   ↳ Regalar un personaje a otro usuario.\n` +
              `☆ *${p}harem » ${p}waifus » ${p}claims* + <mention>\n   ↳ Ver tus personajes reclamados.\n` +
              `☆ *${p}haremshop » ${p}tiendawaifus » ${p}wshop* + <page>\n   ↳ Ver los personajes en venta.\n` +
              `☆ *${p}removesale » ${p}removerventa* + <waifu>\n   ↳ Eliminar un personaje en venta.\n` +
              `☆ *${p}robwaifu » ${p}robarwaifu* + <mention>\n   ↳ Intentar robar un personaje a otro usuario.\n` +
              `☆ *${p}rollwaifu » ${p}rw » ${p}roll*\n   ↳ Waifu o husbando aleatorio (envía imagen del personaje). Enfriamiento: 15 min.\n` +
              `☆ *${p}sell » ${p}vender* + <valor> <waifu>\n   ↳ Poner un personaje a la venta.\n` +
              `☆ *${p}serieinfo » ${p}ainfo » ${p}animeinfo* + <nombre>\n   ↳ Información de un anime.\n` +
              `☆ *${p}serielist » ${p}slist » ${p}animelist*\n   ↳ Listar series del bot.\n` +
              `☆ *${p}setclaimmsg » ${p}setclaim* + <texto>\n   ↳ Modificar el mensaje al reclamar un personaje.\n` +
              `☆ *${p}trade » ${p}intercambiar* + <tu personaje / personaje 2>\n   ↳ Intercambiar un personaje con otro usuario.\n` +
              `☆ *${p}vote » ${p}votar* + <waifu>\n   ↳ Votar por un personaje para subir su valor.\n` +
              `☆ *${p}waifusboard » ${p}waifustop » ${p}topwaifus » ${p}wtop* + <page>\n   ↳ Ver el top de personajes con mayor valor.\n` +
              `☆ *${p}setfavourite » ${p}setfav* + <waifu>\n   ↳ Establecer tu claim favorito.\n` +
              `☆ *${p}deletefav » ${p}delfav* + <waifu>\n   ↳ Borrar tu claim favorito.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🍃 *DESCARGAS*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos de Descargas para descargar archivos de varias fuentes.\n\n` +
              `☆ *${p}play » ${p}mp3 » ${p}playaudio » ${p}ytaudio » ${p}ytmp3* + <url|búsqueda>\n   ↳ Descargar una canción de YouTube.\n` +
              `☆ *${p}ytmp4 » ${p}yt » ${p}mp4 » ${p}playvideo » ${p}ytvideo* + <url|búsqueda>\n   ↳ Descargar un vídeo de YouTube.\n` +
              `☆ *${p}pinterest » ${p}pin* + <url|búsqueda>\n   ↳ Buscar y descargar imágenes de Pinterest.\n` +
              `☆ *${p}ytsearch » ${p}search » ${p}yts* + <búsqueda>\n   ↳ Buscar videos de YouTube.\n` +
              `☆ *${p}fb » ${p}facebook* + <link>\n   ↳ Descargar un video de Facebook.\n` +
              `☆ *${p}tiktok » ${p}tt* + <link>\n   ↳ Descargar un video de TikTok.\n` +
              `☆ *${p}ig » ${p}instagram* + <link>\n   ↳ Descargar contenido de Instagram.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🪞 *PERFILES*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos de Perfil para ver y configurar tu perfil.\n\n` +
              `☆ *${p}profile » ${p}perfil* + <mention>\n   ↳ Ver tu perfil o el de un usuario.\n` +
              `☆ *${p}leaderboard » ${p}lboard » ${p}lb* + <page>\n   ↳ Top de usuarios con más experiencia.\n` +
              `☆ *${p}level » ${p}lvl* + <mention>\n   ↳ Ver tu nivel y experiencia actual.\n` +
              `☆ *${p}setgenre* + <hombre|mujer>\n   ↳ Establecer tu género.\n` +
              `☆ *${p}delgenre*\n   ↳ Eliminar tu género.\n` +
              `☆ *${p}setbirth* + <dia/mes/año>\n   ↳ Establecer tu fecha de cumpleaños.\n` +
              `☆ *${p}delbirth*\n   ↳ Borrar tu fecha de cumpleaños.\n` +
              `☆ *${p}setdescription » ${p}setdesc* + <texto>\n   ↳ Establecer tu descripción.\n` +
              `☆ *${p}deldescription » ${p}deldesc*\n   ↳ Eliminar tu descripción de perfil.\n` +
              `☆ *${p}marry » ${p}casarse* + <mention>\n   ↳ Casarte con alguien.\n` +
              `☆ *${p}divorce » ${p}divorciarse*\n   ↳ Divorciarte de tu pareja.\n` +
              `☆ *${p}setpasatiempo » ${p}sethobby* + <texto>\n   ↳ Establecer tu pasatiempo.\n` +
              `☆ *${p}delpasatiempo » ${p}delhobby*\n   ↳ Eliminar tu pasatiempo del perfil.\n` +
              `☆ *${p}afk* + <motivo>\n   ↳ Activar el modo ausente (AFK).\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `⚔️ *GRUPOS*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos para administradores de grupos.\n\n` +
              `☆ *${p}tagall*\n   ↳ Menciona a todos en el grupo.\n` +
              `☆ *${p}hidetag » ${p}tag* + <texto>\n   ↳ Envía un mensaje mencionando a todos (oculto).\n` +
              `☆ *${p}abrir » ${p}open*\n   ↳ Abre el grupo para que todos puedan escribir.\n` +
              `☆ *${p}cerrar » ${p}close*\n   ↳ Cierra el grupo para solo administradores.\n` +
              `☆ *${p}kick » ${p}ban* + <mención>\n   ↳ Expulsar a un usuario del grupo.\n` +
              `☆ *${p}promote » ${p}promover* + <mención>\n   ↳ Ascender a un usuario a admin.\n` +
              `☆ *${p}demote » ${p}degradar* + <mención>\n   ↳ Quitar admin a un usuario.\n` +
              `☆ *${p}link*\n   ↳ Obtener el enlace de invitación del grupo.\n` +
              `☆ *${p}revoke » ${p}restablecer*\n   ↳ Restablecer el enlace del grupo.\n` +
              `☆ *${p}setgpname* + <nombre>\n   ↳ Cambiar el nombre del grupo.\n` +
              `☆ *${p}setgpdesc* + <descripción>\n   ↳ Cambiar la descripción del grupo.\n` +
              `☆ *${p}setgpbanner*\n   ↳ Cambiar la foto del grupo (responde a una imagen).\n` +
              `☆ *${p}groupinfo » ${p}gp*\n   ↳ Ver información del grupo.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🪄 *UTILIDADES*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Pequeños hechizos de utilidad para el día a día.\n\n` +
              `☆ *${p}get » ${p}fetch* + <url>\n   ↳ Realizar una solicitud GET a una página web.\n` +
              `☆ *${p}pfp » ${p}getpic* + <mention/cite>\n   ↳ Ver la foto de perfil de un usuario.\n` +
              `☆ *${p}git » ${p}gitclone* + <url/nombre>\n   ↳ Buscar y descargar un repositorio de GitHub.\n` +
              `☆ *${p}read » ${p}readvo* + <cite>\n   ↳ Revelar el contenido de un mensaje "ver una vez".\n` +
              `☆ *${p}translate » ${p}trad » ${p}traducir* + <idioma> <texto/cite>\n   ↳ Traducir un texto a otro idioma.\n` +
              `☆ *${p}tourl* + <cite>\n   ↳ Convertir una imagen, video o sticker en un enlace.\n` +
              `☆ *${p}say » ${p}decir* + <texto/cite>\n   ↳ Hacer que el bot repita un mensaje.\n` +
              `☆ *${p}toimg » ${p}toimage* + <cite sticker>\n   ↳ Convertir un sticker en imagen o video.\n` +
              `☆ *${p}hd » ${p}enhance » ${p}remini* + <cite imagen>\n   ↳ Mejorar la calidad de una imagen.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✨ *INTELIGENCIA ARTIFICIAL*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Habla con una IA directamente desde WhatsApp. Recuerda tu conversación y puede intentar leer imágenes citadas.\n\n` +
              `☆ *${p}ia » ${p}ai » ${p}gemini » ${p}preguntar* + <pregunta / responde a un mensaje / cita una imagen>\n   ↳ Hacerle una pregunta a la IA (Gemini). Recuerda los últimos mensajes de tu conversación.\n` +
              `☆ *${p}ia reset*\n   ↳ Olvida la conversación guardada contigo en este chat.\n` +
              `_Tip: puedes responder (citar) cualquier mensaje mío de la IA para seguir la conversación sin escribir el prefijo de nuevo._\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🌙 *ANIME*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos de reacciones de Anime.\n\n` +
              `☆ *${p}waifu » ${p}neko*\n   ↳ Buscar una waifu aleatoria.\n` +
              `☆ *${p}ppcouple » ${p}ppcp*\n   ↳ Generar imágenes para amistades o parejas.\n` +
              `☆ *${p}hug » ${p}abrazar*, *${p}kiss » ${p}muak*, *${p}pat*, *${p}slap*, *${p}cry » ${p}llorar*, *${p}dance » ${p}bailar*, *${p}lick » ${p}lamer*, *${p}bite » ${p}morder*, *${p}blush*, *${p}bonk*, *${p}love » ${p}enamorado* + <mention>\n` +
              `☆ *${p}cuddle » ${p}acurrucar*, *${p}kill » ${p}matar*, *${p}wave » ${p}saludar*, *${p}wink*, *${p}smile » ${p}sonreir*, *${p}sad » ${p}triste*, *${p}happy » ${p}feliz*, *${p}angry » ${p}enojado*, *${p}shy » ${p}timido*, *${p}run » ${p}correr*, *${p}eat » ${p}comer* + <mention>\n` +
              `☆ *${p}blowkiss » ${p}besito*, *${p}handhold » ${p}tomar*, *${p}highfive » ${p}chocar*, *${p}punch » ${p}golpear*, *${p}stare » ${p}mirar*, *${p}tickle » ${p}cosquillas*, *${p}comfort » ${p}consolar* + <mention>\n` +
              `☆ *${p}bleh » ${p}meh*, *${p}bored » ${p}aburrido*, *${p}clap » ${p}aplaudir*, *${p}laugh » ${p}reir*, *${p}nope*, *${p}pout » ${p}mueca*, *${p}sleep » ${p}dormir*, *${p}smug » ${p}presumir*, *${p}think » ${p}pensar*\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `⭐ *GENERAL*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos generales del bot.\n\n` +
              `☆ *${p}ping*\n   ↳ Medir tiempo de respuesta del bot.\n` +
              `☆ *${p}info*\n   ↳ Muestra información del bot.\n` +
              `☆ *${p}owner*\n   ↳ Muestra los owners del bot.\n` +
              `☆ *${p}myid*\n   ↳ Muestra el número que detecta el bot.\n` +
              `☆ *${p}code » ${p}vincular » ${p}serbot* + <número>\n   ↳ Genera un código para vincular tu propio sub-bot (uso libre).\n` +
              `☆ *${p}qr* + <número>\n   ↳ Genera un código QR para vincular tu propio sub-bot (uso libre).\n` +
              `☆ *${p}help » ${p}menu » ${p}ayuda*\n   ↳ Muestra esta lista de comandos.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `👑 *OWNER*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos exclusivos para los dueños del bot.\n\n` +
              `☆ *${p}estado*\n   ↳ Muestra el estado del bot.\n` +
              `☆ *${p}broadcast » ${p}bc* + <mensaje>\n   ↳ Envía un mensaje a los chats del bot.\n` +
              `☆ *${p}setprefix* + <valor>\n   ↳ Cambia el prefijo del bot.\n` +
              `☆ *${p}restart » ${p}reiniciar*\n   ↳ Reinicia el bot.\n` +
              `☆ *${p}update » ${p}fix » ${p}actualizar*\n   ↳ Actualiza el bot con \`git pull\`.\n` +
              `☆ *${p}unlink » ${p}desvincular* + <número>\n   ↳ Elimina un sub-bot vinculado.\n` +
              `☆ *${p}sublist » ${p}listbots*\n   ↳ Muestra los sub-bots activos y su uso de RAM.\n` +
              `☆ *${p}exec » ${p}ex » ${p}e* + <código>\n   ↳ Ejecuta código JavaScript en el bot.\n` +
              `☆ *${p}shell » ${p}r* + <comando>\n   ↳ Ejecuta un comando en la terminal del servidor.\n` +
              `\n` +

              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `🔗 *SOCKET*\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `✦ Comandos para configurar este socket (bot principal o sub-bot). Solo para el owner del socket.\n\n` +
              `☆ *${p}bots » ${p}sockets* + <all>\n   ↳ Ver los sockets activos (principal y subs).\n` +
              `☆ *${p}self* + <on/off>\n   ↳ Hacer privado o público este socket.\n` +
              `☆ *${p}setbotname » ${p}setname* + <corto/largo>\n   ↳ Cambiar el nombre de este socket.\n` +
              `☆ *${p}setbotowner » ${p}setowner* + <mention/número/clear>\n   ↳ Cambiar el owner de este socket.\n` +
              `☆ *${p}setbotprefix* + <valor/multi/noprefix/reset>\n   ↳ Cambiar el prefijo de este socket.\n` +
              `☆ *${p}setstatus* + <texto>\n   ↳ Cambiar el estado de WhatsApp de este socket.\n` +
              `☆ *${p}setusername* + <texto>\n   ↳ Cambiar el nombre de perfil de WhatsApp de este socket.\n` +
              `☆ *${p}setbotlink » ${p}setlink* + <url>\n   ↳ Cambiar el enlace mostrado de este socket.\n` +
              `☆ *${p}setbotcurrency » ${p}setcurrency* + <texto>\n   ↳ Cambiar el nombre de moneda de este socket.\n` +
              `☆ *${p}setbotchannel » ${p}setchannel* + <enlace>\n   ↳ Cambiar el canal de WhatsApp de este socket.\n` +
              `☆ *${p}setimage » ${p}setpfp* + <imagen citada>\n   ↳ Cambiar la foto de perfil de este socket.\n` +
              `☆ *${p}seticon* + <imagen citada>\n   ↳ Cambiar el ícono de este socket (alias de setpfp).\n` +
              `☆ *${p}setbanner* + <imagen citada>\n   ↳ Guardar un banner/imagen de portada para este socket.\n` +
              `☆ *${p}join » ${p}unir* + <enlace de grupo>\n   ↳ Unir este socket a un grupo.\n` +
              `☆ *${p}leave » ${p}salir* + <id de grupo>\n   ↳ Sacar este socket de un grupo.\n` +
              `☆ *${p}logout*\n   ↳ Cerrar la sesión de este socket (solo sub-bots).\n` +
              `☆ *${p}reload*\n   ↳ Reconectar la sesión de este socket (solo sub-bots).\n` +
              `\n` +
              `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
              `☆彡 Únete a nuestro canal de WhatsApp ⋆ ${FIEREN_CHANNEL_LINK}`;

          try {
            const menuPath = path.join(__dirname, "menu.jpg");
            const menuImage = fs.readFileSync(menuPath);
            await sock.sendMessage(from, {
              image: menuImage,
              caption: menuCaption,
              mentions: [sender],
            });
          } catch (error) {
            logError("No se pudo enviar menu.jpg:", error);
            await sock.sendMessage(from, {
              text: `${menuCaption}\n\n⚠️ *No se pudo adjuntar la imagen del menú.*\n🔧 *Detalle técnico:* ${error.message}`,
              mentions: [sender],
            });
          }
        }
        break;

      // ── OWNER ─────────────────────────────────────────────────────────────────
      case "code":
      case "codigo":
      case "serbot":
      case "vincular":
      case "qr": {
        const isCodeMode = command !== "qr";

        // Número de quien pide el comando: prioriza los JIDs alternos (@lid) que WhatsApp
        // a veces usa en vez del número real, igual que isAdmin().
        // Se pasa por normalizePhone() para corregir casos que WhatsApp exige para que
        // el código de vinculación sea válido (México necesita un "1" extra, Argentina
        // un "9" extra, ceros a la izquierda, etc.) — sin esto, el código se genera
        // "casi bien" pero falla al ingresarlo en el teléfono real.
        const requesterNumber = normalizePhone(bareNumber(msg?.key?.participantPn || msg?.key?.participantAlt || sender));

        // Solo un owner del bot puede generar el código para un número que no sea el suyo.
        const overrideArg = args[0] ? normalizePhone(args[0]) : "";
        const phoneArg = (senderIsOwner && overrideArg) ? overrideArg : requesterNumber;

        if (!phoneArg || phoneArg.length < 7) {
          await sock.sendMessage(from, {
            text:
              `📱 *Vincular Sub-Bot*\n\n` +
              `Usa: *${settings.prefix}${command}*\n\n` +
              `> ○ ${isCodeMode ? "El código" : "El QR"} se genera para *tu propio número* (${sender.split("@")[0]}), detectado automáticamente.\n` +
              `> ○ No pude detectar un número válido; intenta escribirlo: *${settings.prefix}${command} 18091234567*.` +
              (senderIsOwner ? `\n> ○ Como owner, puedes generar ${isCodeMode ? "el código" : "el QR"} para otro número: *${settings.prefix}${command} <número>*.` : ""),
          }, { quoted: msg });
          break;
        }

        if (!senderIsOwner && overrideArg && overrideArg !== requesterNumber) {
          await sock.sendMessage(from, {
            text: `☆彡 Solo puedes generar la vinculación para *tu propio número* (${requesterNumber}).`,
          }, { quoted: msg });
          break;
        }

        // ── Cooldown anti-spam: 80s por usuario entre solicitudes de vinculación ──
        if (!senderIsOwner) {
          const cooldownKey = `${sender}@link`;
          const lastLink = db.getSettings(cooldownKey)?.lastLink || 0;
          const elapsed = Date.now() - lastLink;
          if (elapsed < LINK_COOLDOWN_MS) {
            const remainingSec = Math.ceil((LINK_COOLDOWN_MS - elapsed) / 1000);
            await sock.sendMessage(from, {
              text: `⏳ Debes esperar *${remainingSec}s* para volver a intentar vincular un sub-bot.`,
            }, { quoted: msg });
            break;
          }
        }

        if (subBots[phoneArg]) {
          await sock.sendMessage(from, {
            text:
              `⚠️ Ya hay un sub-bot activo o en proceso para *${phoneArg}*.\n` +
              `Usa *${settings.prefix}unlink ${phoneArg}* para eliminarlo primero.`,
          }, { quoted: msg });
          break;
        }

        // ── Límite máximo de sub-bots simultáneos ──
        if (Object.keys(subBots).length >= MAX_SUBBOTS) {
          await sock.sendMessage(from, {
            text: `✐ No se han encontrado espacios disponibles para registrar un nuevo *Sub-Bot* (límite: ${MAX_SUBBOTS}).`,
          }, { quoted: msg });
          break;
        }

        await reactToMessage(sock, msg, isCodeMode ? "🔢" : "📷");
        try {
          await startSubBot(phoneArg, sock, from, msg, isCodeMode);
          db.setSettings(`${sender}@link`, "lastLink", Date.now());
        } catch (error) {
          await sock.sendMessage(from, {
            text: `❌ No se pudo iniciar el sub-bot.\n> ${error?.message || "Error desconocido"}`,
          }, { quoted: msg });
        }
        break;
      }

      case "unlink":
      case "desvincular": {
        // Mismo modelo de permisos que !code: cualquiera puede desvincular, pero si no
        // es owner del bot, solo puede desvincular su propio número (auto-detectado).
        const requesterNumber = normalizePhone(bareNumber(msg?.key?.participantPn || msg?.key?.participantAlt || sender));
        const overrideArg = args[0] ? normalizePhone(args[0]) : "";
        const phoneArg = overrideArg || requesterNumber;

        if (!phoneArg) {
          await sock.sendMessage(from, {
            text: `Usa: *${settings.prefix}unlink <número>*\n> O solo *${settings.prefix}unlink* para desvincular tu propio sub-bot.`,
          }, { quoted: msg });
          break;
        }

        if (!senderIsOwner && overrideArg && overrideArg !== requesterNumber) {
          await sock.sendMessage(from, {
            text: `☆彡 Solo puedes desvincular *tu propio número* (${requesterNumber}).`,
          }, { quoted: msg });
          break;
        }

        const removed = stopSubBot(phoneArg);
        await sock.sendMessage(from, {
          text: removed ? `✅ Sub-bot *${phoneArg}* desvinculado.` : `⚠️ No había ningún sub-bot activo para *${phoneArg}*.`,
        }, { quoted: msg });
        break;
      }

      case "importsub": {
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }

        const phoneArg = normalizePhone(args[0] || "");
        if (!phoneArg) {
          await sock.sendMessage(from, {
            text:
              `📦 *Importar Sub-Bot ya vinculado*\n\n` +
              `Usa: *${settings.prefix}importsub <número>* respondiendo (citando) al archivo *.zip* de la sesión.\n\n` +
              `> El .zip debe contener directamente creds.json y los demás archivos de la carpeta de sesión (sin subcarpeta extra).`,
          }, { quoted: msg });
          break;
        }

        const target = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
          ? { message: msg.message.extendedTextMessage.contextInfo.quotedMessage, key: msg.key }
          : null;
        const docMsg = target?.message?.documentMessage;

        if (!docMsg) {
          await sock.sendMessage(from, {
            text: `⚠️ Responde (cita) al archivo *.zip* de la sesión junto con *${settings.prefix}importsub ${phoneArg}*.`,
          }, { quoted: msg });
          break;
        }

        if (subBots[phoneArg]) {
          await sock.sendMessage(from, {
            text: `⚠️ Ya hay un sub-bot activo para *${phoneArg}*. Usa *${settings.prefix}unlink ${phoneArg}* primero.`,
          }, { quoted: msg });
          break;
        }

        await reactToMessage(sock, msg, "📦");
        try {
          const buffer = await downloadMediaMessage(target, "buffer", {}, {});
          const authFolder = subBotAuthFolder(phoneArg);
          fs.mkdirSync(authFolder, { recursive: true });

          const zip = new AdmZip(buffer);
          zip.extractAllTo(authFolder, true);

          const credsPath = path.join(authFolder, "creds.json");
          if (!fs.existsSync(credsPath)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
            await sock.sendMessage(from, {
              text: `❌ El .zip no contiene un *creds.json* válido en la raíz. Revisa que no tenga una subcarpeta extra.`,
            }, { quoted: msg });
            break;
          }

          await startSubBot(phoneArg, sock, from, msg, false);
          await sock.sendMessage(from, {
            text: `📦 Sesión importada para *${phoneArg}*. Conectando...`,
          }, { quoted: msg });
        } catch (error) {
          await sock.sendMessage(from, {
            text: `❌ No se pudo importar la sesión.\n> ${error?.message || "Error desconocido"}`,
          }, { quoted: msg });
        }
        break;
      }

      case "sublist":
      case "sublista":
      case "listbots":
      case "subbots": {
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }

        const nums = Object.keys(subBots);
        const totalSubs = nums.length;
        const memoryUsedMB = process.memoryUsage().rss / 1024 / 1024;
        const ramPerBot = (memoryUsedMB / (totalSubs + 1)).toFixed(2);

        let report = `*ESTADO DE LA FLOTA — ${settings.bot.name}*\n\n`;
        report += `👑 *Bot principal:* Online\n`;
        report += `📡 *Sub-bots activos:* ${totalSubs}\n`;
        report += `💾 *RAM total:* ${memoryUsedMB.toFixed(2)} MB\n`;
        report += `⚡ *RAM aprox. por bot:* ${ramPerBot} MB\n`;

        if (totalSubs) {
          report += `\n*Lista de sub-bots:*\n`;
          report += nums.map((n) => `• wa.me/${n} — ${subBots[n].connected ? "🟢 conectado" : "🟡 vinculando..."}`).join("\n");
        } else {
          report += `\n_No hay sub-bots activos actualmente._`;
        }

        await sock.sendMessage(from, { text: report }, { quoted: msg });
        break;
      }

      case "estado":
        await reactToMessage(sock, msg, "📊");
        await sock.sendMessage(from, {
          text:
            `*Estado del bot*\n\n` +
            `Nombre: ${settings.bot.name}\n` +
            `Prefijo: ${settings.prefix}\n` +
            `Grupos: ${settings.groups ? "activo" : "inactivo"}\n` +
            `Owner mode: ${settings.owner?.allowOnlyOwnersCommands ? "activo" : "inactivo"}`,
        });
        break;

      case "broadcast":
      case "bc":
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }
        if (!args.length) { await sock.sendMessage(from, { text: `Usa *${settings.prefix}broadcast mensaje*` }); break; }
        await reactToMessage(sock, msg, "📢");
        try {
          const textToSend = `*Broadcast del bot*\n\n${args.join(" ")}`;
          // BUG FIX: sock.store no siempre existe; usar el store de Baileys correctamente
          const chatsMap = sock.store?.chats?.all?.() || [];
          const chats = Array.isArray(chatsMap)
            ? chatsMap.map(c => c.id)
            : Object.keys(sock.store?.chats || {});
          if (!chats.length) {
            await sock.sendMessage(from, { text: "No hay chats disponibles para el broadcast." });
            break;
          }
          let sent = 0;
          for (const jid of chats) {
            try { await sock.sendMessage(jid, { text: textToSend }); sent++; } catch {}
          }
          await sock.sendMessage(from, { text: `Broadcast enviado a ${sent} chats.` });
        } catch (error) {
          logError("Error en broadcast:", error);
          await sock.sendMessage(from, { text: "No pude enviar el broadcast." });
        }
        break;

      // ── SOCKET: configuración del bot principal o de un sub-bot ────────────────
      case "bots":
      case "sockets": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const isAll = args[0]?.toLowerCase() === "all";
        const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
        const groupParticipants = (groupMetadata?.participants || []).map((p) => p.id);
        const mentionedJid = [];
        const lines = { Principal: [], Sub: [] };
        const mainBotId = getBotId(sock);
        if (isAll || groupParticipants.includes(mainBotId)) {
          mentionedJid.push(mainBotId);
          lines.Principal.push(`- [Principal *${getBotShortName(sock)}*] › @${mainBotId.split("@")[0]}`);
        }
        for (const num of Object.keys(subBots)) {
          const jid = `${num}@s.whatsapp.net`;
          if (!isAll && !groupParticipants.includes(jid)) continue;
          const entry = subBots[num];
          mentionedJid.push(jid);
          const subName = entry?.sock ? getBotShortName(entry.sock) : "Sub-Bot";
          lines.Sub.push(`- [Sub ${entry?.connected ? "🟢" : "🟡"} *${subName}*] › @${num}`);
        }
        const total = 1 + Object.keys(subBots).length;
        const shown = lines.Principal.length + lines.Sub.length;
        let message = `ꕥ Números de Sockets activos *(${total})*\n\n`;
        message += `ੈ❖‧₊˚ Principales › *1*\n`;
        message += `ੈ✿‧₊˚ Subs › *${Object.keys(subBots).length}*\n\n`;
        message += isAll ? `➭ *Lista completa ›* ${shown}\n` : `➭ *Bots en el grupo ›* ${shown}\n`;
        if (lines.Principal.length) message += lines.Principal.join("\n") + "\n";
        if (lines.Sub.length) message += lines.Sub.join("\n") + "\n";
        await sock.sendMessage(from, { text: message, mentions: mentionedJid }, { quoted: msg });
        break;
      }

      case "self": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const botId = getBotId(sock);
        const cfg = db.getSettings(botId) || {};
        const isOn = Boolean(cfg.self);
        const opt = (args[0] || "").toLowerCase();
        if (opt === "on" || opt === "enable") {
          if (isOn) { await sock.sendMessage(from, { text: "☆彡 El modo *Self* ya estaba activado." }); break; }
          db.setSettings(botId, "self", true);
          await sock.sendMessage(from, { text: "☆彡 Has *Activado* el modo *Self* (solo el owner del socket podrá usar comandos)." });
        } else if (opt === "off" || opt === "disable") {
          if (!isOn) { await sock.sendMessage(from, { text: "☆彡 El modo *Self* ya estaba desactivado." }); break; }
          db.setSettings(botId, "self", false);
          await sock.sendMessage(from, { text: "☆彡 Has *Desactivado* el modo *Self*." });
        } else {
          await sock.sendMessage(from, { text: `Usa: *${usedPrefix}self on* ó *${usedPrefix}self off*\n> Estado actual: ${isOn ? "Activado" : "Desactivado"}` });
        }
        break;
      }

      case "setbotname":
      case "setname": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: `✐ Debes escribir un nombre corto y un nombre largo.\n> Ejemplo: *${usedPrefix + command} Yuki / Yuki Suou*` }); break; }
        const formatted = value.replace(/\s*\/\s*/g, "/");
        let [short, long] = formatted.includes("/") ? formatted.split("/") : [value, value];
        if (!short || !long) { await sock.sendMessage(from, { text: "✎ Usa el formato: Nombre Corto / Nombre Largo" }); break; }
        if (/\s/.test(short)) { await sock.sendMessage(from, { text: "❖ El nombre corto no puede contener espacios." }); break; }
        const botId = getBotId(sock);
        db.setSettings(botId, "namebot", short.trim());
        db.setSettings(botId, "botname", long.trim());
        await sock.sendMessage(from, { text: `✿ El nombre de este socket ha sido actualizado!\n\n❒ Nombre corto: *${short.trim()}*\n❒ Nombre largo: *${long.trim()}*` });
        break;
      }

      case "setbotowner":
      case "setowner": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const botId = getBotId(sock);
        const cfg = db.getSettings(botId) || {};
        const text = args.join(" ").trim();
        if (text.toLowerCase() === "clear") {
          if (!cfg.owner) { await sock.sendMessage(from, { text: "❀ No hay ningún propietario asignado actualmente." }); break; }
          db.setSettings(botId, "owner", "");
          await sock.sendMessage(from, { text: "❀ Se ha eliminado el propietario de este socket." });
          break;
        }
        const mentioned = getMentionedJid(msg) || getQuotedParticipant(msg);
        const cleanNum = text.replace(/[^0-9]/g, "");
        const nuevo = mentioned || (cleanNum.length >= 7 ? `${cleanNum}@s.whatsapp.net` : null);
        if (!nuevo) { await sock.sendMessage(from, { text: `❀ Menciona a alguien o escribe un número válido.\n> Ejemplo: *${usedPrefix + command} 18091234567*` }); break; }
        db.setSettings(botId, "owner", nuevo);
        await sock.sendMessage(from, { text: `❀ El propietario de este socket ahora es @${nuevo.split("@")[0]}.`, mentions: [nuevo] });
        break;
      }

      case "setbotprefix":
      case "setprefix": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const botId = getBotId(sock);
        const cfg = db.getSettings(botId) || {};
        const value = args.join(" ").trim();
        if (!value) {
          const lista = cfg.prefix === "noprefix" ? "`sin prefijos`" : (Array.isArray(cfg.prefix) ? cfg.prefix : [cfg.prefix || settings.prefix]).map((pr) => `\`${pr}\``).join(", ");
          await sock.sendMessage(from, {
            text: `❀ Elige alguno de los siguientes métodos:\n\n> *○ Un solo prefijo* » ${usedPrefix + command} *.*\n> *○ Multi-prefijo* » ${usedPrefix + command} *!/.#*\n> *○ Sin prefijo* » ${usedPrefix + command} *noprefix*\n> *○ Restablecer* » ${usedPrefix + command} *reset*\n\nꕥ Actualmente en uso: ${lista}`,
          });
          break;
        }
        if (value.toLowerCase() === "reset") {
          db.setSettings(botId, "prefix", "");
          await sock.sendMessage(from, { text: `❀ El prefijo de este socket fue restablecido al predeterminado (*${settings.prefix}*).` });
          break;
        }
        if (value.toLowerCase() === "noprefix") {
          db.setSettings(botId, "prefix", "noprefix");
          await sock.sendMessage(from, { text: "❀ Este socket ahora funciona *sin prefijo*." });
          break;
        }
        const chars = Array.from(value).filter((c) => c !== " ");
        if (!chars.length) { await sock.sendMessage(from, { text: "ꕥ Prefijo inválido." }); break; }
        db.setSettings(botId, "prefix", chars);
        await sock.sendMessage(from, { text: `❀ El/los prefijo(s) de este socket ahora son: ${chars.map((c) => `\`${c}\``).join(", ")}` });
        break;
      }

      case "setstatus": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: `✐ Debes escribir un estado válido.\n> Ejemplo: *${usedPrefix + command} Hola! soy un bot*` }); break; }
        try {
          await sock.updateProfileStatus(value);
          await sock.sendMessage(from, { text: `✿ Se ha actualizado el estado de este socket a *${value}*!` });
        } catch (error) {
          await sock.sendMessage(from, { text: `❌ No se pudo actualizar el estado.\n> ${error?.message || "Error desconocido"}` });
        }
        break;
      }

      case "setusername": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: `✎ Debes escribir un nombre de usuario válido.\n> Ejemplo: *${usedPrefix + command} Yuki Suou*` }); break; }
        try {
          await sock.updateProfileName(value);
          await sock.sendMessage(from, { text: `✿ El nombre de usuario de este socket ha sido actualizado a *${value}*!` });
        } catch (error) {
          await sock.sendMessage(from, { text: `❌ No se pudo actualizar el nombre.\n> ${error?.message || "Error desconocido"}` });
        }
        break;
      }

      case "setbotlink":
      case "setlink": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: "✿ Ingresa un enlace válido que comience con http:// o https://" }); break; }
        if (!/^https?:\/\//i.test(value)) { await sock.sendMessage(from, { text: "ꕥ El enlace debe comenzar con http:// o https://" }); break; }
        db.setSettings(getBotId(sock), "link", value);
        await sock.sendMessage(from, { text: "✎ Se cambió el enlace de este socket correctamente." });
        break;
      }

      case "setbotcurrency":
      case "setcurrency": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: `✐ Debes escribir un nombre de moneda válido.\n> Ejemplo: *${usedPrefix + command} Coins*` }); break; }
        db.setSettings(getBotId(sock), "currency", value);
        await sock.sendMessage(from, { text: `✿ Se ha cambiado la moneda de este socket a *${value}*\n> Nota: esto solo actualiza la etiqueta guardada; los comandos de economía siguen usando "coins" internamente.` });
        break;
      }

      case "setbotchannel":
      case "setchannel": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const value = args.join(" ").trim();
        if (!value) { await sock.sendMessage(from, { text: `❀ Ingresa el enlace de un canal de WhatsApp.\n\nEjemplo:\n*${usedPrefix + command}* https://whatsapp.com/channel/XXXXXXXXXXXXXX` }); break; }
        const code = value.match(/(?:https:\/\/)?(?:www\.)?(?:chat\.|wa\.)?whatsapp\.com\/channel\/([0-9A-Za-z]{22,24})/i)?.[1];
        if (!code) { await sock.sendMessage(from, { text: "ꕥ El enlace proporcionado no es válido." }); break; }
        try {
          const info = await sock.newsletterMetadata("invite", code);
          if (!info) { await sock.sendMessage(from, { text: "ꕥ No se pudo obtener información del canal." }); break; }
          db.setSettings(getBotId(sock), "newsletter_id", info.id);
          db.setSettings(getBotId(sock), "nameid", info.thread_metadata?.name?.text || "Canal sin nombre");
          await sock.sendMessage(from, { text: `✿ Canal de este socket actualizado a *${info.thread_metadata?.name?.text || code}*.` });
        } catch (error) {
          await sock.sendMessage(from, { text: `❌ No se pudo obtener el canal (puede que tu versión de Baileys no soporte esta función).\n> ${error?.message || "Error desconocido"}` });
        }
        break;
      }

      case "setimage":
      case "setpfp":
      case "seticon": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const target = quotedImageMessage ? { message: { imageMessage: quotedImageMessage } } : (isImage ? msg : null);
        if (!target) { await sock.sendMessage(from, { text: "❀ Responde/envía una imagen citándola con este comando." }); break; }
        try {
          const buffer = await downloadMediaMessage(target, "buffer", {}, {});
          await sock.updateProfilePicture(getBotId(sock), buffer);
          await sock.sendMessage(from, { text: "✿ Se actualizó la foto de perfil de este socket." });
        } catch (error) {
          await sock.sendMessage(from, { text: `❌ No se pudo actualizar la foto de perfil.\n> ${error?.message || "Error desconocido"}` });
        }
        break;
      }

      case "setbanner": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const target = quotedImageMessage ? { message: { imageMessage: quotedImageMessage } } : (isImage ? msg : null);
        if (!target) { await sock.sendMessage(from, { text: "❀ Responde/envía una imagen citándola con este comando." }); break; }
        try {
          const buffer = await downloadMediaMessage(target, "buffer", {}, {});
          const bannerDir = path.join(APP_DATA_DIR, "banners");
          if (!fs.existsSync(bannerDir)) fs.mkdirSync(bannerDir, { recursive: true });
          const bannerPath = path.join(bannerDir, `${getBotId(sock).split("@")[0]}.jpg`);
          fs.writeFileSync(bannerPath, buffer);
          db.setSettings(getBotId(sock), "banner", bannerPath);
          await sock.sendMessage(from, { text: "✿ Banner guardado para este socket.\n> Nota: WhatsApp no expone una \"portada\" de perfil vía API; esta imagen se guarda para usarla en tus propias tarjetas de perfil/menú." });
        } catch (error) {
          await sock.sendMessage(from, { text: `❌ No se pudo guardar el banner.\n> ${error?.message || "Error desconocido"}` });
        }
        break;
      }

      case "join":
      case "unir": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const match = (args[0] || "").match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
        if (!match) { await sock.sendMessage(from, { text: "☆彡 Ingresa el enlace del grupo para unir este socket." }); break; }
        try {
          await sock.groupAcceptInvite(match[1]);
          await sock.sendMessage(from, { text: `❀ ${getBotShortName(sock)} se ha unido exitosamente al grupo.` });
        } catch (error) {
          const errMsg = String(error?.message || error);
          let friendly = `❌ No se pudo unir al grupo.\n> ${errMsg}`;
          if (errMsg.includes("not-authorized") || errMsg.includes("requires-admin")) {
            friendly = "☆彡 La unión requiere aprobación de un administrador. Espera a que acepten la solicitud.";
          } else if (errMsg.includes("not-in-group") || errMsg.includes("removed")) {
            friendly = "☆彡 No se pudo unir al grupo porque el bot fue eliminado recientemente.";
          } else if (errMsg.includes("gone") || errMsg.includes("410")) {
            friendly = "☆彡 El enlace del grupo ya no es válido.";
          }
          await sock.sendMessage(from, { text: friendly });
        }
        break;
      }

      case "leave":
      case "salir": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const groupId = args[0] || from;
        try {
          await sock.groupLeave(groupId);
        } catch (error) {
          await sock.sendMessage(from, { text: `> Ocurrió un error inesperado al ejecutar *${usedPrefix + command}*.\n> [Error: *${error.message}*]` });
        }
        break;
      }

      case "logout": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const botNumber = getBotId(sock).split("@")[0];
        if (!subBots[botNumber]) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser usado desde una instancia de Sub-Bot." }); break; }
        await sock.sendMessage(from, { text: "☆彡 Cerrando sesión de este sub-bot..." });
        stopSubBot(botNumber);
        break;
      }

      case "reload": {
        if (!isSocketOwner(sock, sender, senderIsOwner, msg)) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser ejecutado por un owner del socket." }); break; }
        const botNumber = getBotId(sock).split("@")[0];
        if (!subBots[botNumber]) { await sock.sendMessage(from, { text: "☆彡 Este comando solo puede ser usado desde una instancia de Sub-Bot." }); break; }
        const wasCode = subBots[botNumber]?.isCode !== false;
        await sock.sendMessage(from, { text: "☆彡 Recargando sesión de este sub-bot..." });
        stopSubBot(botNumber);
        setTimeout(() => {
          startSubBot(botNumber, sock, from, msg, wasCode).catch((e) => {
            log.error(`Sub-bot ${botNumber} → ${e?.message || e}`);
          });
        }, 1500);
        break;
      }

      case "restart":
      case "reiniciar": {
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }
        await reactToMessage(sock, msg, "♻️");

        // Si el comando se ejecuta desde un sub-bot, solo reiniciamos ESE
        // sub-bot (igual que !reload) en vez de matar el proceso completo,
        // que también tumbaría al bot principal y al resto de sub-bots.
        const restartBotNumber = getBotId(sock).split("@")[0];
        if (subBots[restartBotNumber]) {
          const wasCode = subBots[restartBotNumber]?.isCode !== false;
          await sock.sendMessage(from, { text: "🚀 *Reiniciando motores de este sub-bot...*" });
          stopSubBot(restartBotNumber);
          setTimeout(() => {
            startSubBot(restartBotNumber, sock, from, msg, wasCode).catch((e) => {
              log.error(`Sub-bot ${restartBotNumber} → ${e?.message || e}`);
            });
          }, 1500);
          break;
        }

        await sock.sendMessage(from, { text: "✎ Reiniciando el bot...\n> *Espere un momento...*" });
        setTimeout(() => process.exit(0), 1500);
        break;
      }

      // ⚠️ Ejecuta código JavaScript en el proceso del bot. Solo para el owner: equivale a control total del servidor.
      case "exec":
      case "ex":
      case "e": {
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }
        const codeText = args.join(" ");
        if (!codeText.trim()) {
          await sock.sendMessage(from, { text: "Debes escribir código a ejecutar. Ej: *!e 1+1*" });
          break;
        }
        await reactToMessage(sock, msg, "🕒");
        try {
          const isExpr = command === "e";
          const wrapped = isExpr ? `return (${codeText})` : codeText;
          const fn = new Function(
            "sock", "msg", "from", "sender", "args", "settings", "economy", "require", "process",
            `return (async () => { ${wrapped} })();`
          );
          const result = await fn(sock, msg, from, sender, args, settings, economy, require, process);
          await reactToMessage(sock, msg, "✔️");
          const out = typeof result === "string" ? result : util.inspect(result, { depth: 1 });
          await sock.sendMessage(from, { text: out.slice(0, 4000) || "✅ Ejecutado sin valor de retorno." }, { quoted: msg });
        } catch (error) {
          await reactToMessage(sock, msg, "✖️");
          await sock.sendMessage(from, { text: `❌ Error:\n${String(error?.stack || error).slice(0, 4000)}` }, { quoted: msg });
        }
        break;
      }

      // ⚠️ Ejecuta comandos directamente en la terminal del servidor. Solo para el owner.
      case "shell":
      case "r": {
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }
        const shellCmd = args.join(" ");
        if (!shellCmd.trim()) {
          await sock.sendMessage(from, { text: "Debes escribir un comando a ejecutar. Ej: *!shell ls*" });
          break;
        }
        await reactToMessage(sock, msg, "🕒");
        try {
          const { stdout, stderr } = await execPromise(shellCmd, { timeout: 30000 });
          await reactToMessage(sock, msg, "✔️");
          const out = (stdout?.trim() ? stdout : "") + (stderr?.trim() ? `\n${stderr}` : "");
          await sock.sendMessage(from, { text: out.trim().slice(0, 4000) || "✅ Comando ejecutado sin salida." }, { quoted: msg });
        } catch (error) {
          await reactToMessage(sock, msg, "✖️");
          await sock.sendMessage(from, { text: `❌ Error:\n${String(error?.stderr || error?.message || error).slice(0, 4000)}` }, { quoted: msg });
        }
        break;
      }

      case "update":
      case "fix":
      case "actualizar":
        if (!senderIsOwner) { await sock.sendMessage(from, { text: "Este comando es solo para owners." }); break; }
        await reactToMessage(sock, msg, "🔄");
        await sock.sendMessage(from, { text: "✨ *Sincronizando con el repositorio...*" });
        try {
          const { stdout, stderr } = await execPromise("git pull", { cwd: __dirname, timeout: 60000 });
          const out = stdout?.trim() || "";
          let replyMsg;
          if (out.includes("Already up to date")) {
            replyMsg = "🔥 *El bot ya está actualizado a la última versión.*";
          } else {
            replyMsg = `✅ *Cambios aplicados con éxito:*\n\n${out}${stderr ? `\n${stderr}` : ""}\n\n_Usa !restart para aplicar los cambios._`;
          }
          await sock.sendMessage(from, { text: replyMsg });
        } catch (error) {
          await sock.sendMessage(from, {
            text: `❌ No se pudo actualizar (¿el bot está en un repositorio git?):\n${String(error?.stderr || error?.message || error).slice(0, 2000)}`,
          });
        }
        break;

      // ── STICKER ───────────────────────────────────────────────────────────────
      case "sticker":
      case "s":
        try {
          if (args[0] === "-list") {
            await sock.sendMessage(from, { text: STICKER_LIST_HELP });
            break;
          }

          // Separar la URL (si la hay) del resto de argumentos
          let urlArg = null;
          const argsWithoutUrl = [];
          for (const a of args) {
            if (!urlArg && isUrlString(a)) urlArg = a;
            else argsWithoutUrl.push(a);
          }

          // Formas y efectos pedidos por flags (-c, -blur, etc.)
          const effects = [];
          for (const a of argsWithoutUrl) {
            if (STICKER_SHAPE_FLAGS[a]) effects.push({ type: "shape", value: STICKER_SHAPE_FLAGS[a] });
            else if (STICKER_EFFECT_FLAGS[a]) effects.push({ type: "effect", value: STICKER_EFFECT_FLAGS[a] });
          }

          // Lo que quede de texto (sin flags) permite personalizar "Pack | Autor"
          const brandingText = argsWithoutUrl
            .filter((a) => !STICKER_SHAPE_FLAGS[a] && !STICKER_EFFECT_FLAGS[a])
            .join(" ")
            .trim();
          let customPack, customAuthor;
          if (brandingText) {
            const parts = brandingText.split(/[|•]/).map((p) => p.trim());
            customPack = parts[0] || undefined;
            customAuthor = parts[1] || undefined;
          }

          const quotedStickerMessage = getQuotedStickerMessage(msg);

          let sourceBuffer = null;
          let sourceIsVideo = false;
          let sourceIsAnimatedWebp = false;

          if (urlArg) {
            if (!/\.(jpe?g|png|gif|webp|mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(urlArg)) {
              await sock.sendMessage(from, {
                text: "La URL debe apuntar a una imagen (jpg, png, gif, webp) o video (mp4, mov, avi, mkv, webm).",
              });
              break;
            }
            const res = await fetch(urlArg);
            if (!res.ok) {
              await sock.sendMessage(from, { text: "No pude descargar ese archivo desde la URL." });
              break;
            }
            sourceBuffer = Buffer.from(await res.arrayBuffer());
            sourceIsVideo = /\.(mp4|mov|avi|mkv|webm)(\?.*)?$/i.test(urlArg);
            if (/\.webp(\?.*)?$/i.test(urlArg)) sourceIsAnimatedWebp = isAnimatedWebpBuffer(sourceBuffer);
          } else if (quotedStickerMessage) {
            sourceBuffer = await downloadMediaMessage(
              { key: msg.key, message: { stickerMessage: quotedStickerMessage } }, "buffer", {}, {}
            );
            sourceIsAnimatedWebp = isAnimatedWebpBuffer(sourceBuffer);
          } else if (isImage || quotedImage) {
            const targetMessage = isImage ? msg : { key: msg.key, message: { imageMessage: quotedImageMessage } };
            sourceBuffer = await downloadMediaMessage(targetMessage, "buffer", {}, {});
          } else if (isVideo || quotedVideo) {
            const targetMessage = isVideo ? msg : { key: msg.key, message: { videoMessage: quotedVideoMessage } };
            sourceBuffer = await downloadMediaMessage(targetMessage, "buffer", {}, {});
            sourceIsVideo = true;
          } else {
            await sock.sendMessage(from, {
              text: `Envía o responde a una imagen/video/sticker con *${settings.prefix}sticker*, o pega una URL.\nUsa *${settings.prefix}sticker -list* para ver formas y efectos disponibles.`,
            });
            break;
          }

          await reactToMessage(sock, msg, "🖼️");
          await sock.sendMessage(from, { text: "Creando sticker..." });

          let webpBuffer;
          if (sourceIsAnimatedWebp && effects.length === 0) {
            // Sticker citado sin formas/efectos: se reenvía tal cual (solo se re-etiqueta el EXIF).
            webpBuffer = sourceBuffer;
          } else if (sourceIsAnimatedWebp) {
            const gifBuffer = await convertWebpToGifBuffer(sourceBuffer);
            webpBuffer = await bufferToStickerWithEffects(gifBuffer, { isVideo: true, effects });
          } else {
            webpBuffer = await bufferToStickerWithEffects(sourceBuffer, { isVideo: sourceIsVideo, effects });
          }

          const { packname, author } = getStickerBranding(sock, sender, msg.pushName);
          const finalBuffer = await writeStickerExif(webpBuffer, customPack || packname, customAuthor || author);

          await sock.sendMessage(from, { sticker: finalBuffer });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error creando sticker:", error);
          await sock.sendMessage(from, {
            text: `No pude crear el sticker.\n\n🔧 *Detalle técnico:*\n${String(error?.stderr || error?.message || error).slice(0, 700)}`,
          });
        }
        break;

      // ── STICKERS ESPECIALES ─────────────────────────────────────────────────────
// ── Brat vía apicausas (con fallback a skyzxu) ─────────────────────────────────
// NOTA: no pude confirmar el nombre exacto del parámetro de texto ni si la
// respuesta es la imagen binaria directa o un JSON con una url (mis pruebas
// dieron 400 con varios nombres de parámetro). Se prueba "text" primero y,
// si la respuesta es JSON, se buscan campos comunes de url.
async function fetchBratFromApicausas(text) {
  const apiUrl = `https://rest.apicausas.xyz/api/v1/utilidades/brat?apikey=${settings.apis.apicausas}&text=${encodeURIComponent(text)}`;
  const res = await fetch(apiUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`apicausas (brat) HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  if (contentType.includes("application/json")) {
    const json = await res.json();
    const root = (json?.data && typeof json.data === "object") ? json.data : json;
    const imgUrl = root?.url || root?.image || root?.result || root?.link;
    if (!imgUrl) throw new Error(`apicausas (brat) no devolvió una url: ${JSON.stringify(json).slice(0, 300)}`);
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error(`No se pudo descargar la imagen de brat: HTTP ${imgRes.status}`);
    return Buffer.from(await imgRes.arrayBuffer());
  }

  return Buffer.from(await res.arrayBuffer());
}

async function fetchBratImage(text) {
  try {
    return await fetchBratFromApicausas(text);
  } catch (error) {
    logError("apicausas brat falló, usando fallback skyzxu:", error);
    const res = await fetch(`https://skyzxu-brat.hf.space/brat?text=${encodeURIComponent(text)}`);
    if (!res.ok) throw new Error(`Ambas APIs de brat fallaron. Último error: ${error.message}`);
    return Buffer.from(await res.arrayBuffer());
  }
}


      case "brat": {
        try {
          const text = (getQuotedText(msg) || args.join(" ")).trim();
          if (!text) {
            await sock.sendMessage(from, {
              text: `Responde a un mensaje o escribe un texto.\nEj: *${settings.prefix}brat hola mundo*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const buffer = await fetchBratImage(text);
          const webp = await bufferToWebpSticker(buffer, { isVideo: false });
          const { packname, author } = getStickerBranding(sock, sender, msg.pushName);
          const finalBuffer = await writeStickerExif(webp, packname, author);
          await sock.sendMessage(from, { sticker: finalBuffer });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en brat:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `No pude crear el sticker brat.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "bratv": {
        try {
          const text = (getQuotedText(msg) || args.join(" ")).trim();
          if (!text) {
            await sock.sendMessage(from, {
              text: `Responde a un mensaje o escribe un texto.\nEj: *${settings.prefix}bratv hola mundo*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const res = await fetch(`https://skyzxu-brat.hf.space/brat-animated?text=${encodeURIComponent(text)}`);
          if (!res.ok) throw new Error(`La API de bratv respondió con estado ${res.status}`);
          const buffer = Buffer.from(await res.arrayBuffer());
          const webp = await bufferToWebpSticker(buffer, { isVideo: true });
          const { packname, author } = getStickerBranding(sock, sender, msg.pushName);
          const finalBuffer = await writeStickerExif(webp, packname, author);
          await sock.sendMessage(from, { sticker: finalBuffer });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en bratv:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `No pude crear el video-sticker bratv.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "emojimix": {
        try {
          const text = args.join(" ").trim();
          if (!text || !text.includes("+")) {
            await sock.sendMessage(from, {
              text: `Ingresa 2 emojis para combinar.\nEj: *${settings.prefix}emojimix 👻+👀*`,
            });
            break;
          }
          const [emoji1, emoji2] = text.split("+").map((e) => e.trim());
          if (!emoji1 || !emoji2) {
            await sock.sendMessage(from, {
              text: `Ingresa 2 emojis separados por "+".\nEj: *${settings.prefix}emojimix 👻+👀*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          // Nota: esta key pública de Tenor (Emoji Kitchen) es la que usan la mayoría
          // de bots de WhatsApp/Telegram para esta función; no es una key propia del bot.
          const apiUrl = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}`;
          const apiRes = await fetch(apiUrl);
          const data = await apiRes.json();
          if (!data?.results?.length) {
            throw new Error("No se encontró una combinación para esos emojis.");
          }
          const imgRes = await fetch(data.results[0].url);
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const webp = await bufferToWebpSticker(buffer, { isVideo: false });
          const { packname, author } = getStickerBranding(sock, sender, msg.pushName);
          const finalBuffer = await writeStickerExif(webp, packname, author);
          await sock.sendMessage(from, { sticker: finalBuffer });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en emojimix:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `No pude mezclar esos emojis.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "qc": {
        try {
          const textFinal = (args.join(" ") || getQuotedText(msg)).trim();
          if (!textFinal) {
            await sock.sendMessage(from, {
              text: `Ingresa un texto o responde a un mensaje.\nEj: *${settings.prefix}qc hola mundo*`,
            });
            break;
          }
          if (textFinal.length > 30) {
            await sock.sendMessage(from, { text: "El texto no puede tener más de 30 caracteres." });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const quotedParticipant = getQuotedParticipant(msg);
          const target = quotedParticipant || sender;
          const pp = await sock
            .profilePictureUrl(target, "image")
            .catch(() => "https://telegra.ph/file/24fa902ead26340f3df2c.png");
          const displayName = msg.pushName && !quotedParticipant ? msg.pushName : target.split("@")[0];
          const quoteRes = await fetch("https://bot.lyo.su/quote/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "quote",
              format: "png",
              backgroundColor: "#000000",
              width: 512,
              height: 768,
              scale: 2,
              messages: [
                {
                  entities: [],
                  avatar: true,
                  from: { id: 1, name: displayName, photo: { url: pp } },
                  text: textFinal,
                  replyMessage: {},
                },
              ],
            }),
          });
          const quoteData = await quoteRes.json();
          if (!quoteData?.result?.image) throw new Error("La API de quote-card no devolvió una imagen.");
          const buffer = Buffer.from(quoteData.result.image, "base64");
          const webp = await bufferToWebpSticker(buffer, { isVideo: false });
          const { packname, author } = getStickerBranding(sock, sender, msg.pushName);
          const finalBuffer = await writeStickerExif(webp, packname, author);
          await sock.sendMessage(from, { sticker: finalBuffer });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en qc:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `No pude crear el sticker de cita.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      // ── GRUPOS ────────────────────────────────────────────────────────────────
      case "tagall":
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) {
            await sock.sendMessage(from, { text: "Solo los admins pueden usar este comando." });
            break;
          }
          await reactToMessage(sock, msg, "📢");
          const metadata = await sock.groupMetadata(from);
          const mentions = metadata.participants.map((p) => p.id);
          const text = metadata.participants.map((p, i) => `${i + 1}. @${p.id.split("@")[0]}`).join("\n");
          await sock.sendMessage(from, { text: `*Mención a todos*\n\n${text}`, mentions });
        } catch (error) {
          logError("Error en tagall:", error);
          await sock.sendMessage(from, { text: "No pude ejecutar tagall." });
        }
        break;

      case "abrir":
      case "open":
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden abrir el grupo." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }
          await sock.groupSettingUpdate(from, "not_announcement");
          await reactToMessage(sock, msg, "🔓");
          await sock.sendMessage(from, { text: "🔓 *Grupo abierto.* Todos pueden enviar mensajes." });
        } catch (error) {
          logError("Error al abrir grupo:", error);
          await sock.sendMessage(from, { text: "❌ No pude abrir el grupo." });
        }
        break;

      case "cerrar":
      case "close":
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden cerrar el grupo." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }
          await sock.groupSettingUpdate(from, "announcement");
          await reactToMessage(sock, msg, "🔒");
          await sock.sendMessage(from, { text: "🔒 *Grupo cerrado.* Solo los admins pueden enviar mensajes." });
        } catch (error) {
          logError("Error al cerrar grupo:", error);
          await sock.sendMessage(from, { text: "❌ No pude cerrar el grupo." });
        }
        break;

      case "antilink": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden usar este comando." }); break; }
          const cfg = db.getSettings(from) || {};
          const isOn = cfg.antiLink !== undefined ? Boolean(cfg.antiLink) : Boolean(settings.groups?.antiLink);
          const opt = (args[0] || "").toLowerCase();
          if (opt === "on" || opt === "enable" || opt === "activar") {
            if (isOn) { await sock.sendMessage(from, { text: "☆彡 El *Anti-link* ya estaba activado en este grupo." }); break; }
            db.setSettings(from, "antiLink", true);
            await reactToMessage(sock, msg, "🔗");
            await sock.sendMessage(from, { text: "🔗 *Anti-link activado.* Quien envíe enlaces será expulsado (los admins y el owner están exentos)." });
          } else if (opt === "off" || opt === "disable" || opt === "desactivar") {
            if (!isOn) { await sock.sendMessage(from, { text: "☆彡 El *Anti-link* ya estaba desactivado en este grupo." }); break; }
            db.setSettings(from, "antiLink", false);
            await reactToMessage(sock, msg, "🔗");
            await sock.sendMessage(from, { text: "⛓️‍💥 *Anti-link desactivado* para este grupo." });
          } else {
            await sock.sendMessage(from, {
              text: `Usa: *${usedPrefix}antilink on* ó *${usedPrefix}antilink off*\n> Estado actual: ${isOn ? "Activado ✅" : "Desactivado ❌"}`,
            });
          }
        } catch (error) {
          logError("Error en antilink:", error);
          await sock.sendMessage(from, { text: "❌ No pude cambiar el estado del Anti-link." });
        }
        break;
      }

      case "kick":
      case "ban": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden expulsar usuarios." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }

          const target = getMentionedJid(msg) || getQuotedParticipant(msg);
          if (!target) {
            await sock.sendMessage(from, { text: `Menciona o responde al mensaje de la persona que quieres expulsar.\nEj: *${settings.prefix}kick @usuario*` }, { quoted: msg });
            break;
          }

          const metadata = await sock.groupMetadata(from);
          const botId = bareNumber(sock.user?.id);
          const targetBase = bareNumber(target);
          const participant = metadata.participants.find((p) => bareNumber(p.id) === targetBase);

          if (targetBase === botId) { await sock.sendMessage(from, { text: "No puedo expulsarme a mí mismo." }); break; }
          if (metadata.owner && bareNumber(metadata.owner) === targetBase) { await sock.sendMessage(from, { text: "No puedo expulsar al creador del grupo." }); break; }
          if (isOwner(target, settings)) { await sock.sendMessage(from, { text: "No puedo expulsar a un owner del bot." }); break; }
          if (participant?.admin && !senderIsOwner) { await sock.sendMessage(from, { text: "No puedo expulsar a otro administrador." }); break; }

          await sock.groupParticipantsUpdate(from, [target], "remove");
          await sock.sendMessage(from, { text: `✅ @${targetBase} fue expulsado del grupo.`, mentions: [target] }, { quoted: msg });
        } catch (error) {
          logError("Error en kick:", error);
          await sock.sendMessage(from, { text: `No pude expulsar al usuario.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "promote":
      case "promover": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden ascender usuarios." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }

          const target = getMentionedJid(msg) || getQuotedParticipant(msg);
          if (!target) {
            await sock.sendMessage(from, { text: `Menciona o responde al usuario que deseas ascender a admin.\nEj: *${settings.prefix}promote @usuario*` }, { quoted: msg });
            break;
          }

          const metadata = await sock.groupMetadata(from);
          const targetBase = bareNumber(target);
          const participant = metadata.participants.find((p) => bareNumber(p.id) === targetBase);
          if (participant?.admin) { await sock.sendMessage(from, { text: `@${targetBase} ya es administrador.`, mentions: [target] }, { quoted: msg }); break; }

          await sock.groupParticipantsUpdate(from, [target], "promote");
          await sock.sendMessage(from, { text: `⬆️ @${targetBase} ahora es administrador del grupo.`, mentions: [target] }, { quoted: msg });
        } catch (error) {
          logError("Error en promote:", error);
          await sock.sendMessage(from, { text: `No pude ascender al usuario.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "demote":
      case "degradar": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden degradar usuarios." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }

          const target = getMentionedJid(msg) || getQuotedParticipant(msg);
          if (!target) {
            await sock.sendMessage(from, { text: `Menciona o responde al usuario que deseas degradar.\nEj: *${settings.prefix}demote @usuario*` }, { quoted: msg });
            break;
          }

          const metadata = await sock.groupMetadata(from);
          const targetBase = bareNumber(target);
          if (metadata.owner && bareNumber(metadata.owner) === targetBase) { await sock.sendMessage(from, { text: "No puedo degradar al creador del grupo." }); break; }
          const participant = metadata.participants.find((p) => bareNumber(p.id) === targetBase);
          if (!participant?.admin) { await sock.sendMessage(from, { text: `@${targetBase} no es administrador.`, mentions: [target] }, { quoted: msg }); break; }

          await sock.groupParticipantsUpdate(from, [target], "demote");
          await sock.sendMessage(from, { text: `⬇️ @${targetBase} ya no es administrador del grupo.`, mentions: [target] }, { quoted: msg });
        } catch (error) {
          logError("Error en demote:", error);
          await sock.sendMessage(from, { text: `No pude degradar al usuario.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "link": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para obtener el enlace." }); break; }
          const code = await sock.groupInviteCode(from);
          await sock.sendMessage(from, { text: `🔗 *Enlace del grupo:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
        } catch (error) {
          logError("Error en link:", error);
          await sock.sendMessage(from, { text: `No pude obtener el enlace del grupo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "revoke":
      case "restablecer": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden restablecer el enlace." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }
          await sock.groupRevokeInvite(from);
          const code = await sock.groupInviteCode(from);
          await sock.sendMessage(from, { text: `🔄 *Enlace restablecido:*\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
        } catch (error) {
          logError("Error en revoke:", error);
          await sock.sendMessage(from, { text: `No pude restablecer el enlace.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "setgpname": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden cambiar el nombre del grupo." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }
          const newName = args.join(" ").trim();
          if (!newName) { await sock.sendMessage(from, { text: `Escribe el nuevo nombre.\nEj: *${settings.prefix}setgpname Mi Grupo*` }, { quoted: msg }); break; }
          await sock.groupUpdateSubject(from, newName);
          await sock.sendMessage(from, { text: "✅ Nombre del grupo actualizado." }, { quoted: msg });
        } catch (error) {
          logError("Error en setgpname:", error);
          await sock.sendMessage(from, { text: `No pude cambiar el nombre del grupo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "setgpdesc": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden cambiar la descripción del grupo." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }
          const newDesc = args.join(" ").trim();
          if (!newDesc) { await sock.sendMessage(from, { text: `Escribe la nueva descripción.\nEj: *${settings.prefix}setgpdesc Bienvenidos al grupo*` }, { quoted: msg }); break; }
          await sock.groupUpdateDescription(from, newDesc);
          await sock.sendMessage(from, { text: "✅ Descripción del grupo actualizada." }, { quoted: msg });
        } catch (error) {
          logError("Error en setgpdesc:", error);
          await sock.sendMessage(from, { text: `No pude cambiar la descripción del grupo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "setgpbanner": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden cambiar la foto del grupo." }); break; }
          const botIsAdmin = await isBotAdmin(sock, from);
          if (!botIsAdmin) { await sock.sendMessage(from, { text: "❌ El bot necesita ser admin para hacer esto." }); break; }

          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const imageMsg = msg.message?.imageMessage || quotedMsg?.imageMessage;
          if (!imageMsg) {
            await sock.sendMessage(from, { text: "Envía o responde a una imagen para usarla como foto del grupo." }, { quoted: msg });
            break;
          }
          const target = quotedMsg
            ? { message: quotedMsg, key: msg.key }
            : msg;
          const buffer = await downloadMediaMessage(target, "buffer", {}, {});
          await sock.updateProfilePicture(from, buffer);
          await sock.sendMessage(from, { text: "✅ Foto del grupo actualizada." }, { quoted: msg });
        } catch (error) {
          logError("Error en setgpbanner:", error);
          await sock.sendMessage(from, { text: `No pude cambiar la foto del grupo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "hidetag":
      case "tag": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const senderIsAdmin = await isAdmin(sock, from, sender, msg);
          if (!senderIsAdmin && !senderIsOwner) { await sock.sendMessage(from, { text: "❌ Solo los admins pueden usar hidetag." }); break; }

          const metadata = await sock.groupMetadata(from);
          const mentions = metadata.participants.map((p) => p.id);
          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const userText = args.join(" ").trim();

          if (quotedMsg) {
            const target = { message: quotedMsg, key: msg.key };
            const quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || quotedMsg.videoMessage?.caption || "";
            if (quotedMsg.imageMessage) {
              const buffer = await downloadMediaMessage(target, "buffer", {}, {});
              await sock.sendMessage(from, { image: buffer, caption: quotedText || userText || undefined, mentions });
            } else if (quotedMsg.videoMessage) {
              const buffer = await downloadMediaMessage(target, "buffer", {}, {});
              await sock.sendMessage(from, { video: buffer, caption: quotedText || userText || undefined, mentions, mimetype: "video/mp4" });
            } else {
              await sock.sendMessage(from, { text: quotedText || userText || " ", mentions });
            }
          } else if (userText) {
            await sock.sendMessage(from, { text: userText, mentions });
          } else {
            await sock.sendMessage(from, { text: `Escribe un texto o responde a un mensaje.\nEj: *${settings.prefix}hidetag hola a todos*` }, { quoted: msg });
          }
        } catch (error) {
          logError("Error en hidetag:", error);
          await sock.sendMessage(from, { text: `No pude ejecutar hidetag.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      case "groupinfo":
      case "gp": {
        if (!isGroup) { await sock.sendMessage(from, { text: "Este comando solo funciona en grupos." }); break; }
        try {
          const metadata = await sock.groupMetadata(from);
          const admins = metadata.participants.filter((p) => p.admin === "admin" || p.admin === "superadmin");
          const creatorJid = metadata.owner || null;
          const createdAt = metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString("es-ES") : "Desconocida";

          const text =
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
            `📋 *Información del grupo*\n` +
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n` +
            `☆ Nombre ⋆ ${metadata.subject}\n` +
            `☆ Creador ⋆ ${creatorJid ? `@${creatorJid.split("@")[0]}` : "Desconocido"}\n` +
            `☆ Creado ⋆ ${createdAt}\n` +
            `☆ Participantes ⋆ ${metadata.participants.length}\n` +
            `☆ Admins ⋆ ${admins.length}\n` +
            `☆ Grupo cerrado ⋆ ${metadata.announce ? "Sí" : "No"}\n` +
            (metadata.desc ? `\n📝 *Descripción:*\n${metadata.desc}` : "");

          await sock.sendMessage(from, { text, mentions: creatorJid ? [creatorJid] : [] }, { quoted: msg });
        } catch (error) {
          logError("Error en groupinfo:", error);
          await sock.sendMessage(from, { text: `No pude obtener la información del grupo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 300)}` });
        }
        break;
      }

      // ── INTELIGENCIA ARTIFICIAL ─────────────────────────────────────────────────
      case "ia":
      case "ai":
      case "gemini":
      case "preguntar": {
        const sub = (args[0] || "").toLowerCase();

        // !ia reset / !ia clear → olvida la conversación con este usuario en este chat
        // (y sale del "modo sin prefijo" si estaba activo).
        if (["reset", "clear", "olvidar", "limpiar"].includes(sub)) {
          const existed = aiChat.resetMemory(sender, from);
          await sock.sendMessage(from, {
            text: existed
              ? "🧹 Listo, olvidé nuestra conversación anterior."
              : "No tenía ninguna conversación guardada contigo todavía.",
          }, { quoted: msg });
          break;
        }

        const question = (args.join(" ") || getQuotedText(msg)).trim();
        const quotedImgCheck = getQuotedImageMessage(msg);

        if (!question && !quotedImgCheck && !isImage) {
          await sock.sendMessage(from, {
            text:
              `Escribe una pregunta o responde a un mensaje (también puedes citar una imagen).\n` +
              `Ej: *${settings.prefix}ia ¿qué es una API?*\n` +
              `*${settings.prefix}ia reset* → olvida la conversación anterior.\n\n` +
              `_Tip: responde (cita) cualquier mensaje mío de la IA para seguir hablando sin escribir "${settings.prefix}ia" de nuevo._`,
          });
          break;
        }

        await runAiQuery(sock, msg, sender, from, question, isImage, directMessage);
        break;
      }

      // ── ANIME / IMÁGENES ──────────────────────────────────────────────────────
      case "waifu":
      case "neko": {
        const emoji = command === "waifu" ? "💕" : "🐱";

        if (command === "waifu" && !senderIsOwner) {
          const cooldownKey = `${sender}@waifu`;
          const lastWaifu = db.getSettings(cooldownKey)?.lastWaifu || 0;
          const elapsed = Date.now() - lastWaifu;
          if (elapsed < WAIFU_COOLDOWN_MS) {
            await sock.sendMessage(from, {
              text: `⏳ Debes esperar *${fmtWaifuTimeLeft(WAIFU_COOLDOWN_MS - elapsed)}* para volver a usar *!waifu*.`,
            }, { quoted: msg });
            break;
          }
          db.setSettings(cooldownKey, "lastWaifu", Date.now());
        }

        await reactToMessage(sock, msg, emoji);
        // waifu.pics como fuente principal, waifu.im como respaldo (solo para
        // !waifu, ya que waifu.im no tiene tag de "neko"), y nekos.best como
        // último respaldo para que el comando no se quede sin enviar nada.
        const pic =
          (await fetchWaifuPics(command)) ||
          (command === "waifu" ? await fetchWaifuIm() : null) ||
          (await fetchNekosBest(command));
        console.log(`[${command}] Imagen obtenida: ${pic?.url || "NINGUNA (las 3 fuentes fallaron)"}`);
        if (!pic?.url) {
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, { text: "❌ No pude obtener una imagen. Intenta de nuevo." });
          break;
        }
        try {
          await sock.sendMessage(from, {
            image: { url: pic.url },
            caption: `${emoji} Aquí tienes un ${command} aleatorio.`,
            mentions: [sender],
          });
        } catch (err) {
          logError(`Error enviando ${command}:`, err);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, { text: `❌ No pude enviar la imagen.\n🔗 ${pic.url}` });
        }
        break;
      }

      case "ppcouple":
      case "ppcp": {
        await reactToMessage(sock, msg, "💞");
        const pair = await fetchPPCouple();
        if (!pair) { await sock.sendMessage(from, { text: "No pude obtener las imágenes. Intenta de nuevo." }); break; }
        await sendReactionMedia(sock, from, pair.cowo, "💞 *Masculino* ♂", [sender]);
        await sendReactionMedia(sock, from, pair.cewe, "💞 *Femenina* ♀", [sender]);
        break;
      }

      // ── YOUTUBE ───────────────────────────────────────────────────────────────
      case "ytmp4":
      case "yt":
      case "mp4":
      case "playvideo":
      case "ytvideo":
        await handleYtMp4(sock, from, msg, args.join(" "));
        break;

      case "ytmp3":
      case "mp3":
      case "play":
      case "ytaudio":
      case "playaudio":
        await handleYtMp3(sock, from, msg, args.join(" "));
        break;

      case "ytsearch":
      case "yts":
      case "search":
        await handleYtSearch(sock, from, msg, args.join(" "));
        break;

      // ── PINTEREST ─────────────────────────────────────────────────────────────
      case "pinterest":
      case "pin":
      case "pint":
        await handlePinterest(sock, from, msg, args.join(" "));
        break;

      // ── FACEBOOK / TIKTOK / INSTAGRAM ────────────────────────────────────────
      case "fb":
      case "facebook":
        await handleFacebookDownload(sock, from, msg, args[0]);
        break;

      case "tiktok":
      case "tt":
        await handleTiktokDownload(sock, from, msg, args[0]);
        break;

      case "ig":
      case "instagram":
        await handleInstagramDownload(sock, from, msg, args[0]);
        break;

      // ── ECONOMÍA ──────────────────────────────────────────────────────────────
      case "balance":
      case "bal":
      case "coins": {
        const target = getMentionedJid(msg);
        await cmdBalance(sock, from, sender, target);
        break;
      }

      case "daily":
        await cmdDaily(sock, from, sender);
        break;

      case "work":
      case "w":
        await cmdWork(sock, from, sender);
        break;

      case "crime":
        await cmdCrime(sock, from, sender);
        break;

      case "slut":
        await cmdSlut(sock, from, sender);
        break;

      case "deposit":
      case "dep":
      case "depositar":
        await cmdDeposit(sock, from, sender, args[0]);
        break;

      case "withdraw":
      case "with":
      case "retirar":
        await cmdWithdraw(sock, from, sender, args[0]);
        break;

      case "givecoins":
      case "pay":
      case "coinsgive": {
        const target = getMentionedJid(msg);
        // BUG FIX: la cantidad puede venir en args[0] si no hay @ como arg[0]
        const amount = args.find(a => !a.startsWith("@")) || args[1] || args[0];
        await cmdGiveCoins(sock, from, sender, target, amount);
        break;
      }

      case "coinflip":
      case "flip":
      case "cf":
        await cmdCoinFlip(sock, from, sender, args[0], args[1]);
        break;

      case "roulette":
      case "rt":
        await cmdRoulette(sock, from, sender, args[0], args[1]);
        break;

      case "steal":
      case "robar":
      case "rob": {
        const target = getMentionedJid(msg);
        await cmdSteal(sock, from, sender, target);
        break;
      }

      case "economyboard":
      case "eboard":
      case "baltop":
        await cmdEconomyBoard(sock, from, parseInt(args[0]) || 1);
        break;

      case "economyinfo":
      case "einfo":
        await cmdEconomyInfo(sock, from, sender);
        break;

      case "monthly":
      case "mensual":
        await cmdMonthly(sock, from, sender);
        break;

      case "cofre":
      case "coffer":
        await cmdCoffer(sock, from, sender);
        break;

      case "casino":
      case "apostar":
        await cmdCasino(sock, from, sender, args[0]);
        break;

      case "ppt":
        await cmdPPT(sock, from, sender, args[0], args[1]);
        break;

      case "adventure":
      case "aventura":
        await cmdAdventure(sock, from, sender);
        break;

      case "dungeon":
      case "mazmorra":
        await cmdDungeon(sock, from, sender);
        break;

      case "hunt":
      case "cazar":
        await cmdHunt(sock, from, sender);
        break;

      case "fish":
      case "pescar":
        await cmdFish(sock, from, sender);
        break;

      case "mine":
      case "minar":
        await cmdMine(sock, from, sender);
        break;

      case "invoke":
      case "ritual":
      case "invocar":
        await cmdInvoke(sock, from, sender);
        break;

      case "heal":
      case "curar":
      case "pocion":
      case "potion": {
        const target = getMentionedJid(msg);
        await cmdHeal(sock, from, sender, target);
        break;
      }

      case "math":
        await cmdMath(sock, from, sender, args);
        break;

      // ── GACHA ─────────────────────────────────────────────────────────────────
      case "rollwaifu":
      case "rw":
      case "roll":
        await cmdRollWaifu(sock, msg, sender, from, economy);
        break;

      case "claim":
      case "c":
      case "reclamar":
        await cmdClaim(sock, msg, sender, from, args);
        break;

      case "harem":
      case "waifus":
      case "claims": {
        const mention = getMentionedJid(msg);
        await cmdHarem(sock, msg, sender, from, args, mention);
        break;
      }

      case "charinfo":
      case "winfo":
      case "waifuinfo":
        await cmdCharInfo(sock, msg, from, args);
        break;

      case "delwaifu":
      case "delchar":
      case "deletewaifu":
        await cmdDeleteWaifu(sock, msg, sender, from, args);
        break;

      case "givechar":
      case "givewaifu":
      case "regalar": {
        const mention = getMentionedJid(msg);
        await cmdGiveChar(sock, msg, sender, from, args, mention);
        break;
      }

      case "trade":
      case "intercambiar": {
        const mention = getMentionedJid(msg);
        await cmdTrade(sock, msg, sender, from, args, mention);
        break;
      }

      case "setfav":
      case "setfavourite":
        await cmdSetFav(sock, msg, sender, from, args);
        break;

      case "delfav":
      case "deletefav":
        await cmdDelFav(sock, msg, sender, from);
        break;

      case "vote":
      case "votar":
        await cmdVote(sock, msg, sender, from, args);
        break;

      case "waifustop":
      case "waifusboard":
      case "topwaifus":
      case "wtop":
        await cmdWaifusTop(sock, msg, from, args);
        break;

      case "favoritetop":
      case "favtop":
        await cmdFavTop(sock, msg, from);
        break;

      case "serielist":
      case "slist":
      case "animelist":
        await cmdSerieList(sock, msg, from);
        break;

      case "serieinfo":
      case "ainfo":
      case "animeinfo":
        await cmdSerieInfo(sock, msg, from, args);
        break;

      case "gachainfo":
      case "ginfo":
      case "infogacha":
        await cmdGachaInfo(sock, msg, sender, from);
        break;

      case "setclaimmsg":
      case "setclaim":
        await cmdSetClaimMsg(sock, msg, sender, from, args);
        break;

      case "delclaimmsg":
        await cmdDelClaimMsg(sock, msg, sender, from);
        break;

      case "haremshop":
      case "tiendawaifus":
      case "wshop":
        await cmdHaremShop(sock, msg, from, args);
        break;

      case "sell":
      case "vender":
        await cmdSell(sock, msg, sender, from, args);
        break;

      case "buycharacter":
      case "buychar":
      case "buyc":
        await cmdBuyChar(sock, msg, sender, from, args, economy);
        break;

      case "removesale":
      case "removerventa":
        await cmdRemoveSale(sock, msg, sender, from, args);
        break;

      case "charimage":
      case "waifuimage":
      case "cimage":
      case "wimage":
        await cmdCharImage(sock, msg, from, args);
        break;

      case "giveallharem": {
        const mention = getMentionedJid(msg);
        await cmdGiveAllHarem(sock, msg, sender, from, mention);
        break;
      }

      case "robwaifu":
      case "robarwaifu": {
        const mention = getMentionedJid(msg);
        await cmdRobWaifu(sock, msg, sender, from, mention);
        break;
      }

      // ── PERFILES ──────────────────────────────────────────────────────────────
      case "profile":
      case "perfil": {
        const mention = getMentionedJid(msg);
        await cmdProfile(sock, msg, sender, from, mention, gacha, economy);
        break;
      }

      case "level":
      case "lvl": {
        const mention = getMentionedJid(msg);
        await cmdLevel(sock, msg, sender, from, mention);
        break;
      }

      case "leaderboard":
      case "lboard":
      case "lb":
        await cmdLeaderboard(sock, msg, from, args);
        break;

      case "setdescription":
      case "setdesc":
        await cmdSetDescription(sock, msg, sender, from, args);
        break;

      case "deldescription":
      case "deldesc":
        await cmdDelDescription(sock, msg, sender, from);
        break;

      case "setgenre":
        await cmdSetGenre(sock, msg, sender, from, args);
        break;

      case "delgenre":
        await cmdDelGenre(sock, msg, sender, from);
        break;

      case "setbirth":
        await cmdSetBirthday(sock, msg, sender, from, args);
        break;

      case "delbirth":
        await cmdDelBirthday(sock, msg, sender, from);
        break;

      case "sethobby":
      case "setpasatiempo":
        await cmdSetHobby(sock, msg, sender, from, args);
        break;

      case "delhobby":
      case "delpasatiempo":
        await cmdDelHobby(sock, msg, sender, from);
        break;

      case "afk":
        await cmdAfk(sock, msg, sender, from, args);
        break;

      case "marry":
      case "casarse": {
        const mention = getMentionedJid(msg);
        await cmdMarry(sock, msg, sender, from, mention);
        break;
      }

      case "divorce":
      case "divorciarse":
        await cmdDivorce(sock, msg, sender, from);
        break;

      // ── UTILIDADES ───────────────────────────────────────────────────────────
      case "get":
      case "fetch": {
        try {
          const urlArg = args[0];
          if (!urlArg || !/^https?:\/\//i.test(urlArg)) {
            await sock.sendMessage(from, {
              text: `☆ Ingresa un enlace válido que comience con http o https.\n☆ Ej: *${settings.prefix}get https://api.example.com*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const res = await fetch(urlArg, { headers: { "User-Agent": "Mozilla/5.0" } });
          const contentType = res.headers.get("content-type") || "";
          const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
          if (contentLength > 60 * 1024 * 1024) {
            await reactToMessage(sock, msg, "❌");
            await sock.sendMessage(from, {
              text: `☆彡 El archivo es demasiado grande (${(contentLength / 1024 / 1024).toFixed(1)} MB).`,
            });
            break;
          }
          if (/text|json|xml/i.test(contentType)) {
            const raw = await res.text();
            let pretty = raw;
            if (contentType.includes("json")) {
              try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch {}
            }
            if (pretty.length > 3500) {
              const ext = contentType.includes("json") ? "json" : contentType.includes("html") ? "html" : "txt";
              await sock.sendMessage(from, {
                document: Buffer.from(pretty, "utf8"),
                fileName: `respuesta_${Date.now()}.${ext}`,
                mimetype: contentType.split(";")[0] || "text/plain",
              });
            } else {
              await sock.sendMessage(from, { text: `🔮 *Respuesta invocada*\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` + "```" + pretty.slice(0, 3500) + "```" });
            }
          } else {
            const buffer = Buffer.from(await res.arrayBuffer());
            await sock.sendMessage(from, {
              document: buffer,
              fileName: `archivo_${Date.now()}`,
              mimetype: contentType || "application/octet-stream",
            });
          }
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en get:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude realizar la solicitud.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "pfp":
      case "getpic": {
        try {
          const mention = getMentionedJid(msg);
          const quotedParticipant = getQuotedParticipant(msg);
          const target = mention || quotedParticipant || sender;
          await reactToMessage(sock, msg, "🕒");
          const img = await sock.profilePictureUrl(target, "image").catch(() => null);
          if (!img) {
            await reactToMessage(sock, msg, "❌");
            await sock.sendMessage(from, {
              text: `☆彡 No pude ver el retrato de @${target.split("@")[0]}.`,
              mentions: [target],
            });
            break;
          }
          await sock.sendMessage(from, { image: { url: img }, caption: `🪞 *Retrato de* @${target.split("@")[0]}`, mentions: [target] }, { quoted: msg });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en pfp:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude obtener la foto de perfil.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "git":
      case "gitclone": {
        try {
          const query = args.join(" ").trim();
          if (!query) {
            await sock.sendMessage(from, {
              text: `☆ Ingresa un enlace o nombre de repositorio de GitHub.\n☆ Ej: *${settings.prefix}git https://github.com/WhiskeySockets/Baileys*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const directMatch = query.match(/^(?:https:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
          let owner, repoName;
          if (directMatch) {
            [, owner, repoName] = directMatch;
          } else {
            const searchRes = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`);
            const searchData = await searchRes.json();
            if (!searchData.items?.length) {
              await reactToMessage(sock, msg, "❌");
              await sock.sendMessage(from, { text: "☆彡 No se encontraron repositorios con ese nombre." });
              break;
            }
            owner = searchData.items[0].owner.login;
            repoName = searchData.items[0].name;
          }
          const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`);
          if (!repoRes.ok) throw new Error(`GitHub respondió con estado ${repoRes.status}`);
          const repo = await repoRes.json();
          const info =
            `📦 *Grimorio encontrado ⋆ ${repo.full_name}*\n` +
            `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
            `☆ Descripción ⋆ ${repo.description || "Sin descripción"}\n` +
            `☆ Estrellas ⋆ ${repo.stargazers_count}\n` +
            `☆ Forks ⋆ ${repo.forks}\n` +
            `☆ Issues abiertos ⋆ ${repo.open_issues}\n` +
            `☆ Lenguaje ⋆ ${repo.language || "N/D"}\n` +
            `☆ Actualizado ⋆ ${new Date(repo.updated_at).toLocaleDateString("es")}\n` +
            `☆ Enlace ⋆ ${repo.html_url}`;
          await sock.sendMessage(from, { text: info });
          const zipHead = await fetch(`https://api.github.com/repos/${owner}/${repoName}/zipball`, { method: "HEAD" }).catch(() => null);
          const zipLength = parseInt(zipHead?.headers?.get("content-length") || "0", 10);
          if (!zipLength || zipLength < 90 * 1024 * 1024) {
            const zipRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/zipball`);
            if (zipRes.ok) {
              const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
              await sock.sendMessage(from, { document: zipBuffer, fileName: `${repoName}.zip`, mimetype: "application/zip" });
            }
          } else {
            await sock.sendMessage(from, { text: "☆彡 El repositorio es demasiado grande para enviarlo como archivo." });
          }
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en gitclone:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude obtener el repositorio.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "read":
      case "readvo":
      case "readviewonce": {
        try {
          const quotedRaw = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const real = unwrapViewOnce(quotedRaw);
          const type = real?.imageMessage ? "imageMessage" : real?.videoMessage ? "videoMessage" : real?.audioMessage ? "audioMessage" : null;
          if (!type) {
            await sock.sendMessage(from, {
              text: `☆ Responde a un mensaje "ver una vez" (foto, video o audio) con *${settings.prefix}readvo* para revelarlo.`,
            });
            break;
          }
          await reactToMessage(sock, msg, "👁️");
          const fakeMsg = { key: msg.key, message: { [type]: real[type] } };
          const buffer = await downloadMediaMessage(fakeMsg, "buffer", {}, {});
          if (type === "imageMessage") {
            await sock.sendMessage(from, { image: buffer, caption: real[type].caption || "👁️ *Revelado*" }, { quoted: msg });
          } else if (type === "videoMessage") {
            await sock.sendMessage(from, { video: buffer, caption: real[type].caption || "👁️ *Revelado*", mimetype: "video/mp4" }, { quoted: msg });
          } else {
            await sock.sendMessage(from, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: real[type].ptt || false }, { quoted: msg });
          }
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en readviewonce:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude revelar ese mensaje.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "translate":
      case "trad":
      case "traducir": {
        try {
          const defaultLang = "es";
          let lang = args[0];
          let text = "";
          const quotedText = getQuotedText(msg);
          if (lang && /^[a-z]{2}$/i.test(lang)) {
            text = args.slice(1).join(" ") || quotedText;
          } else {
            lang = defaultLang;
            text = args.join(" ") || quotedText;
          }
          text = (text || "").trim();
          if (!text) {
            await sock.sendMessage(from, {
              text: `☆ Ingresa el idioma (código de 2 letras) seguido del texto, o responde a un mensaje.\n☆ Ej: *${settings.prefix}translate en Hola mundo*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "🌐");
          const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(lang.toLowerCase())}&dt=t&q=${encodeURIComponent(text)}`;
          const res = await fetch(apiUrl);
          if (!res.ok) throw new Error(`El servicio de traducción respondió con estado ${res.status}`);
          const data = await res.json();
          const translated = (data?.[0] || []).map((chunk) => chunk[0]).join("");
          const detectedLang = data?.[2] || "?";
          if (!translated) throw new Error("No se recibió una traducción válida.");
          await sock.sendMessage(from, {
            text: `🌐 *Hechizo de traducción*\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n☆ ${detectedLang} ⟶ ${lang.toLowerCase()}\n\n${translated}`,
          }, { quoted: msg });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en translate:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude traducir el texto.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "tourl": {
        try {
          const stickerMsgTourl = getQuotedStickerMessage(msg);
          let targetMessage, mimetype;
          if (isImage) { targetMessage = msg; mimetype = directMessage.imageMessage.mimetype; }
          else if (quotedImage) { targetMessage = { key: msg.key, message: { imageMessage: quotedImageMessage } }; mimetype = quotedImageMessage.mimetype; }
          else if (isVideo) { targetMessage = msg; mimetype = directMessage.videoMessage.mimetype; }
          else if (quotedVideo) { targetMessage = { key: msg.key, message: { videoMessage: quotedVideoMessage } }; mimetype = quotedVideoMessage.mimetype; }
          else if (stickerMsgTourl) { targetMessage = { key: msg.key, message: { stickerMessage: stickerMsgTourl } }; mimetype = stickerMsgTourl.mimetype || "image/webp"; }
          else {
            await sock.sendMessage(from, { text: `☆ Responde a una imagen, video o sticker con *${settings.prefix}tourl*.` });
            break;
          }
          await reactToMessage(sock, msg, "🕒");
          const buffer = await downloadMediaMessage(targetMessage, "buffer", {}, {});
          const ext = (mimetype || "application/octet-stream").split("/")[1]?.split(";")[0] || "bin";
          const filename = `fierenbot_${Date.now()}.${ext}`;
          const form = new FormData();
          form.append("files[]", new Blob([buffer], { type: mimetype }), filename);
          const res = await globalThis.fetch("https://uguu.se/upload.php", { method: "POST", body: form });
          if (!res.ok) throw new Error(`uguu.se respondió con estado ${res.status}`);
          const json = await res.json();
          const url = json?.files?.[0]?.url;
          if (!url) throw new Error("uguu.se no devolvió un enlace válido.");
          const sizeKb = (buffer.length / 1024).toFixed(1);
          await sock.sendMessage(from, {
            text: `🔗 *Portal invocado* (temporal, ~3h)\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n☆ URL ⋆ ${url}\n☆ Tipo ⋆ ${mimetype}\n☆ Peso ⋆ ${sizeKb} KB`,
          }, { quoted: msg });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en tourl:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude subir el archivo.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "say":
      case "decir": {
        try {
          const stickerMsgSay = getQuotedStickerMessage(msg);
          const quotedAudioMessage = unwrapViewOnce(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage)?.audioMessage || null;
          const userText = args.join(" ").trim();
          const quotedText = getQuotedText(msg);
          const textToSend = userText || quotedText;

          let groupMentions = [];
          if (isGroup && textToSend) {
            const metadata = await sock.groupMetadata(from).catch(() => null);
            const participants = metadata?.participants || [];
            groupMentions = participants.map((p) => p.id).filter((jid) => textToSend.includes(bareNumber(jid)));
          }

          await reactToMessage(sock, msg, "🕒");

          if (quotedImage) {
            const buffer = await downloadMediaMessage({ key: msg.key, message: { imageMessage: quotedImageMessage } }, "buffer", {}, {});
            await sock.sendMessage(from, { image: buffer, caption: textToSend || quotedImageMessage.caption || "", mentions: groupMentions });
          } else if (quotedVideo) {
            const buffer = await downloadMediaMessage({ key: msg.key, message: { videoMessage: quotedVideoMessage } }, "buffer", {}, {});
            await sock.sendMessage(from, { video: buffer, caption: textToSend || quotedVideoMessage.caption || "", mimetype: "video/mp4", mentions: groupMentions });
          } else if (stickerMsgSay) {
            const buffer = await downloadMediaMessage({ key: msg.key, message: { stickerMessage: stickerMsgSay } }, "buffer", {}, {});
            await sock.sendMessage(from, { sticker: buffer });
          } else if (quotedAudioMessage) {
            const buffer = await downloadMediaMessage({ key: msg.key, message: { audioMessage: quotedAudioMessage } }, "buffer", {}, {});
            await sock.sendMessage(from, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: quotedAudioMessage.ptt || false });
          } else if (textToSend) {
            await sock.sendMessage(from, { text: textToSend, mentions: groupMentions });
          } else {
            await reactToMessage(sock, msg, "❌");
            await sock.sendMessage(from, {
              text: `☆ Escribe un texto o responde a un mensaje/media para que lo repita.\n☆ Ej: *${settings.prefix}say Hola a todos*`,
            });
            break;
          }
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en say:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude repetir ese mensaje.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      case "toimg":
      case "toimage": {
        try {
          const stickerMsgToimg = getQuotedStickerMessage(msg);
          if (!stickerMsgToimg) {
            await sock.sendMessage(from, { text: `☆ Responde a un *sticker* con *${settings.prefix}toimg* para convertirlo.` });
            break;
          }
          await reactToMessage(sock, msg, "🖼️");
          const buffer = await downloadMediaMessage({ key: msg.key, message: { stickerMessage: stickerMsgToimg } }, "buffer", {}, {});
          const animated = isAnimatedWebpBuffer(buffer);
          const tempDir = path.join(process.cwd(), "temp_stickers");
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const baseName = `toimg_${Date.now()}`;
          const inputPath = path.join(tempDir, `${baseName}.webp`);
          fs.writeFileSync(inputPath, buffer);
          try {
            if (animated) {
              const outputPath = path.join(tempDir, `${baseName}.mp4`);
              await runFfmpeg(["-y", "-i", inputPath, "-movflags", "faststart", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", outputPath]);
              const outBuffer = fs.readFileSync(outputPath);
              await sock.sendMessage(from, { video: outBuffer, gifPlayback: true, caption: "🖼️ *Sticker desencantado*" }, { quoted: msg });
              fs.unlinkSync(outputPath);
            } else {
              const outputPath = path.join(tempDir, `${baseName}.png`);
              await runFfmpeg(["-y", "-i", inputPath, outputPath]);
              const outBuffer = fs.readFileSync(outputPath);
              await sock.sendMessage(from, { image: outBuffer, caption: "🖼️ *Sticker desencantado*" }, { quoted: msg });
              fs.unlinkSync(outputPath);
            }
          } finally {
            try { fs.unlinkSync(inputPath); } catch {}
          }
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en toimg:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude convertir el sticker.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

async function vectorinkEnhance(buffer) {
  const API = "https://us-central1-vector-ink.cloudfunctions.net/upscaleImage";
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "*/*",
      origin: "https://vectorink.io",
      referer: "https://vectorink.io/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ data: { image: buffer.toString("base64") } }),
  });
  if (!res.ok) throw new Error(`vectorink.io respondió con estado ${res.status}`);
  const json = await res.json();
  let inner;
  try { inner = JSON.parse(json?.result || "{}"); } catch { throw new Error("vectorink.io devolvió una respuesta inválida."); }
  const webpB64 = inner?.image?.b64_json;
  if (!webpB64) throw new Error("vectorink.io no devolvió una imagen.");
  const webpBuffer = Buffer.from(webpB64, "base64");
  const tempDir = path.join(process.cwd(), "temp_stickers");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const baseName = `hd_${Date.now()}`;
  const inputPath = path.join(tempDir, `${baseName}.webp`);
  const outputPath = path.join(tempDir, `${baseName}.png`);
  fs.writeFileSync(inputPath, webpBuffer);
  try {
    await runFfmpeg(["-y", "-i", inputPath, outputPath]);
    return fs.readFileSync(outputPath);
  } finally {
    try { fs.unlinkSync(inputPath); } catch {}
    try { fs.unlinkSync(outputPath); } catch {}
  }
}

      case "hd":
      case "enhance":
      case "remini": {
        try {
          let targetMessage, mimetype;
          if (isImage) { targetMessage = msg; mimetype = directMessage.imageMessage.mimetype; }
          else if (quotedImage) { targetMessage = { key: msg.key, message: { imageMessage: quotedImageMessage } }; mimetype = quotedImageMessage.mimetype; }
          else {
            await sock.sendMessage(from, { text: `☆ Responde a una *imagen* con *${settings.prefix}hd* para lanzarle un hechizo de nitidez.` });
            break;
          }
          if (!/^image\/(jpe?g|png|webp)/i.test(mimetype || "")) {
            await sock.sendMessage(from, { text: `☆彡 El formato *${mimetype}* no es compatible.` });
            break;
          }
          await reactToMessage(sock, msg, "✨");
          const buffer = await downloadMediaMessage(targetMessage, "buffer", {}, {});
          const enhanced = await vectorinkEnhance(buffer);
          await sock.sendMessage(from, { image: enhanced, caption: "✨ *Hechizo de nitidez completado*" }, { quoted: msg });
          await reactToMessage(sock, msg, "✅");
        } catch (error) {
          logError("Error en hd:", error);
          await reactToMessage(sock, msg, "❌");
          await sock.sendMessage(from, {
            text: `☆彡 No pude mejorar la imagen.\n\n🔧 *Detalle técnico:*\n${String(error.message).slice(0, 400)}`,
          });
        }
        break;
      }

      default:
        // BUG FIX: no responder "comando desconocido" a mensajes normales
        // Solo responder si el body claramente tenía el prefijo
        await sock.sendMessage(from, {
          text: `❓ Comando desconocido. Usa *${settings.prefix}help* para ver los comandos disponibles.`,
        });
        break;
    }
    } catch (error) {
      // Cualquier comando que explote (API caída, media corrupta, lo que sea)
      // termina aquí en vez de matar el proceso o el listener de mensajes.
      logError(`❌ Error no capturado en comando "${command}" (${from}):`, error);
      try {
        await reactToMessage(sock, msg, "❌");
      } catch {}
      try {
        await sock.sendMessage(from, {
          text:
            `☆彡 Ocurrió un error al ejecutar *${settings.prefix}${command}*, pero el bot sigue en pie.\n\n` +
            `🔧 *Detalle técnico:*\n${String(error?.message || error).slice(0, 400)}`,
        }, { quoted: msg }).catch(() => {});
      } catch {}
    }
}

// ════════════════════════════════════════════════════════════
//   APAGADO ORDENADO
//   Railway envía SIGTERM al contenedor en cada redeploy/reinicio.
//   Sin esto, Node se mata en seco y una escritura de creds.json a
//   medias puede corromper la sesión (obligando a re-vincular).
//   Aquí solo cerramos la conexión (sock.end), NUNCA logout(), para
//   no invalidar la sesión: junto con un Volume persistente en
//   Railway (ver README) esto permite que, al reiniciar, el bot
//   principal y todos los sub-bots reconecten solos automáticamente
//   gracias a loadExistingSubBots().
// ════════════════════════════════════════════════════════════
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`Señal ${signal} recibida — cerrando sockets antes de salir (redeploy/reinicio)...`);

  for (const phoneNumber of Object.keys(subBots)) {
    try { subBots[phoneNumber].sock.end(undefined); } catch {}
  }
  try { if (mainSock) mainSock.end(undefined); } catch {}

  // Pequeño margen para que terminen de volcarse a disco las últimas
  // escrituras de creds.json (saveCreds) antes de que el proceso muera.
  setTimeout(() => process.exit(0), 1200);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = { startBot };
