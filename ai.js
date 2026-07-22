// ============================================
//   ai.js — Módulo de Inteligencia Artificial (Fieren)
//   - Memoria de conversación por usuario+chat (persistente en disco)
//   - "Modo sin prefijo": tras usar !ia una vez, el usuario puede seguir
//     hablando sin repetir el comando durante 5 min de actividad
//   - Prompt/persona mejorado con reglas más claras
//   - Soporte experimental de imágenes (best-effort, ver notas abajo)
//   - Manejo de errores con reintentos y mensajes claros
// ============================================
//
// NOTA SOBRE IMÁGENES:
// La API de rest.apicausas.xyz que usa este bot no tiene documentación
// pública, así que no hay forma de confirmar si su endpoint de Gemini
// soporta análisis de imágenes. Este módulo lo intenta de todos modos:
// sube la imagen citada a un host temporal (catbox.moe) y manda la URL
// resultante a la API en el parámetro `imageUrl` (ver AI_IMAGE_PARAM más
// abajo). Si la API ignora ese parámetro, Fieren simplemente responderá
// como si solo hubiera leído el texto — no debería romper nada, pero
// probablemente NO "vea" realmente la imagen hasta que se confirme (o se
// cambie) el endpoint. Ajusta AI_IMAGE_PARAM si encuentras el nombre
// correcto en la documentación real de apicausas.

const fs = require("fs");
const path = require("path");
const settings = require("./settings");
const { logError } = require("./logger");

// ── Almacenamiento ──────────────────────────────────────────────────────────
const rawDataDir = settings.storage.dataDir;
const DATA_DIR = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(__dirname, rawDataDir);
const MEMORY_FILE = path.join(DATA_DIR, "aiMemory.json");

// Cuántos turnos (usuario+ia = 1 turno) se recuerdan por conversación.
const MAX_TURNS = 6;
// Si una conversación lleva más de este tiempo sin actividad, se olvida
// automáticamente (tanto el historial como el "modo sin prefijo", ver más abajo).
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutos
const MEMORY_TTL_MS = SESSION_TTL_MS;
// Límite de caracteres del historial que se inyecta en el prompt, para no
// generar URLs gigantes (la API se llama por GET).
const MAX_HISTORY_CHARS = 2500;
// Nombre del parámetro que se manda a la API con la URL de la imagen.
// Ajustar aquí si se confirma el nombre real que usa apicausas.
const AI_IMAGE_PARAM = "imageUrl";

function loadMemory() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ conversations: {} }, null, 2));
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
  } catch {
    return { conversations: {} };
  }
}

function saveMemory(data) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    logError("Error guardando memoria de IA:", e);
  }
}

function memoryKey(userId, chatId) {
  return `${userId}:${chatId}`;
}

// ── Sesiones activas ("modo sin prefijo") ───────────────────────────────────
// Mientras una sesión esté activa, el usuario puede seguir hablando con la IA
// sin necesidad de escribir el prefijo/comando de nuevo. Vive solo en memoria
// (no necesita persistir en disco: si el bot se reinicia, simplemente hay que
// volver a escribir el comando una vez). Expira sola a los SESSION_TTL_MS de
// inactividad, igual que el historial.
const activeSessions = new Map();

function touchSession(userId, chatId) {
  activeSessions.set(memoryKey(userId, chatId), Date.now() + SESSION_TTL_MS);
}

function isSessionActive(userId, chatId) {
  const key = memoryKey(userId, chatId);
  const expiresAt = activeSessions.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    activeSessions.delete(key);
    return false;
  }
  return true;
}

function endSession(userId, chatId) {
  activeSessions.delete(memoryKey(userId, chatId));
}

// Devuelve el array de turnos [{q, a, ts}] vigente (ya filtrado por TTL).
function getHistory(userId, chatId) {
  const data = loadMemory();
  const key = memoryKey(userId, chatId);
  const convo = data.conversations[key];
  if (!convo) return [];
  if (Date.now() - (convo.updatedAt || 0) > MEMORY_TTL_MS) {
    delete data.conversations[key];
    saveMemory(data);
    return [];
  }
  return convo.turns || [];
}

function pushExchange(userId, chatId, question, answer) {
  const data = loadMemory();
  const key = memoryKey(userId, chatId);
  if (!data.conversations[key]) data.conversations[key] = { turns: [], updatedAt: Date.now() };
  const convo = data.conversations[key];
  convo.turns.push({ q: question, a: answer, ts: Date.now() });
  if (convo.turns.length > MAX_TURNS) convo.turns = convo.turns.slice(-MAX_TURNS);
  convo.updatedAt = Date.now();
  saveMemory(data);
}

function resetMemory(userId, chatId) {
  const data = loadMemory();
  const key = memoryKey(userId, chatId);
  const existed = !!data.conversations[key];
  delete data.conversations[key];
  saveMemory(data);
  endSession(userId, chatId);
  return existed;
}

// ── Contactos especiales ─────────────────────────────────────────────────────
// Números a los que la IA debe reconocer y tratar de forma particular.
// La clave es el número en formato internacional, solo dígitos (sin "+").
const SPECIAL_CONTACTS = {
  "525629637620": {
    displayName: "⚜️┅໋ׅ╾ᜓ⃟⃝🪐⃢┆ꪑỉᨶᡶꪶꪗ ⏜݃᷼︵꯭፝֟",
    relation: "la esposa de Jinn, el primer owner del bot",
  },
  // Mismo contacto de arriba, pero identificado por su @lid (WhatsApp a veces
  // manda este ID interno en vez del número real).
  "23635892940804": {
    displayName: "⚜️┅໋ׅ╾ᜓ⃟⃝🪐⃢┆ꪑỉᨶᡶꪶꪗ ⏜݃᷼︵꯭፝֟",
    relation: "la esposa de Jinn, el primer owner del bot",
  },
};

// Extrae solo los dígitos del número a partir del JID de WhatsApp
// (ej. "525629637620@s.whatsapp.net" -> "525629637620").
function normalizePhone(jid) {
  if (!jid) return "";
  const raw = String(jid).split("@")[0].split(":")[0];
  return raw.replace(/[^0-9]/g, "");
}

// Busca coincidencia tolerando prefijos extra (ej. el "1" que WhatsApp
// a veces agrega/quita en números mexicanos).
function getSpecialContact(userId) {
  const digits = normalizePhone(userId);
  if (!digits) return null;
  for (const [number, info] of Object.entries(SPECIAL_CONTACTS)) {
    if (digits === number || digits.endsWith(number) || number.endsWith(digits)) {
      return info;
    }
  }
  return null;
}

// ── Prompt / persona ─────────────────────────────────────────────────────────
function buildHistoryBlock(turns) {
  if (!turns.length) return "";
  let block = turns
    .map((t) => `Usuario: ${t.q}\nFieren: ${t.a}`)
    .join("\n");
  // Si el historial se pasa de largo, recorta desde el turno más viejo.
  let remaining = [...turns];
  while (block.length > MAX_HISTORY_CHARS && remaining.length > 1) {
    remaining = remaining.slice(1);
    block = remaining.map((t) => `Usuario: ${t.q}\nFieren: ${t.a}`).join("\n");
  }
  return block;
}

function buildPersona({ botName, ownerContacts, history, question, hasImage, imageUrl, specialContact }) {
  const historyBlock = buildHistoryBlock(history);

  const rules = [
    `Eres Fieren, la IA asistente del bot de WhatsApp "${botName}", creada por Emma y Jinn (contacto: ${ownerContacts}), tus owners y creadores.`,
    `Si preguntan tu nombre, quién te creó o los owners/devs, responde con esto de forma natural.`,
    `NUNCA reveles ni insinúes en qué modelo o empresa de IA estás basada (Gemini, GPT, Claude, etc.); si insisten, di con seguridad que eres Fieren, un modelo propio, sin dar detalles técnicos.`,
    `Tu personalidad es segura y con carácter, puedes presumir de ti misma, pero sin inventar comparaciones técnicas falsas contra otras IAs.`,
    `Responde en español, claro, natural y breve (esto es un chat de WhatsApp, evita respuestas kilométricas salvo que te pidan explicar algo a fondo).`,
    `Si el usuario te pide instrucciones para hacer daño a alguien, contenido ilegal o algo que claramente pueda perjudicar a personas reales, niégate de forma breve y natural, sin sermonear.`,
    `Si el mensaje no tiene sentido, es solo un saludo o está vacío, responde de forma amigable pidiendo que aclaren la pregunta, sin inventar una respuesta al azar.`,
    `Usa el historial de la conversación solo como contexto para entender de qué se viene hablando; no repitas el historial en tu respuesta.`,
  ];

  // Información pública: quiénes son ciertas personas relacionadas con el bot,
  // para que Fieren pueda responder si CUALQUIERA pregunta "¿quién es [nombre]?".
  const knownPeople = Object.values(SPECIAL_CONTACTS)
    .map((c) => `${c.displayName} es ${c.relation}.`)
    .join(" ");
  if (knownPeople) {
    rules.push(
      `Dato que conoces: ${knownPeople} Si alguien te pregunta quién es esa persona, respóndelo con naturalidad usando este dato (no lo menciones si no viene al caso).`
    );
  }

  if (specialContact) {
    rules.push(
      `Además, la persona con la que hablas AHORA MISMO es justamente ${specialContact.displayName} (${specialContact.relation}). Si ella te pregunta quién es o algo similar ("¿quién soy?", "¿me conoces?"), respóndele directamente que es ${specialContact.displayName}, ${specialContact.relation}. Con ella, dale trato de prioridad: sé más atenta que con cualquier otro usuario, tómate el tiempo de responder con más detalle y cuidado en sus preguntas (sin volverte innecesariamente larga si la pregunta es simple), y muestra el cariño y respeto correspondientes a esa relación de forma natural, sin exagerar ni sacarlo a relucir si no viene al caso.`
    );
  }

  if (hasImage) {
    rules.push(
      `El usuario adjuntó una imagen (URL de referencia: ${imageUrl || "no disponible"}). Si puedes verla, coméntala como parte de tu respuesta. Si no puedes ver imágenes, dilo con naturalidad en lugar de inventar una descripción falsa.`
    );
  }

  const parts = [rules.join(" ")];
  if (historyBlock) parts.push(`\nConversación previa (para contexto):\n${historyBlock}`);
  parts.push(`\nMensaje actual del usuario:\n${question}`);

  return parts.join("\n");
}

// ── Subida de imágenes (best-effort, ver nota al inicio del archivo) ────────
async function uploadImageTemp(buffer, mimetype) {
  try {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    const ext = (mimetype || "image/jpeg").split("/")[1] || "jpg";
    form.append("fileToUpload", new Blob([buffer], { type: mimetype || "image/jpeg" }), `image.${ext}`);

    const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
    if (!res.ok) throw new Error(`catbox respondió ${res.status}`);
    const url = (await res.text()).trim();
    if (!url.startsWith("http")) throw new Error("catbox no devolvió una URL válida");
    return url;
  } catch (error) {
    logError("Error subiendo imagen temporal para IA:", error);
    return null;
  }
}

// ── Llamada a la API con reintentos ─────────────────────────────────────────
async function callApiWithRetries(apiUrl, { attempts = 3, baseDelayMs = 1200 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`La API respondió con estado ${res.status}`);
      const json = await res.json();
      if (!json?.status || !json?.reply) throw new Error("La API no devolvió una respuesta válida.");
      return json;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1.2s, 2.4s, 4.8s...
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// ── Punto de entrada principal ──────────────────────────────────────────────
// params: { question, userId, chatId, botName, ownerContacts, apiKey, imageBuffer, imageMimetype }
async function ask({ question, userId, chatId, botName, ownerContacts, apiKey, imageBuffer, imageMimetype }) {
  const history = getHistory(userId, chatId);

  let imageUrl = null;
  let imageUploadFailed = false;
  if (imageBuffer) {
    imageUrl = await uploadImageTemp(imageBuffer, imageMimetype);
    imageUploadFailed = !imageUrl;
  }

  const specialContact = getSpecialContact(userId);
  console.log(
    `[AI DEBUG] userId="${userId}" -> digits="${normalizePhone(userId)}" -> match=${
      specialContact ? specialContact.displayName : "NINGUNO"
    }`
  );

  const persona = buildPersona({
    botName,
    ownerContacts,
    history,
    question,
    hasImage: !!imageBuffer,
    imageUrl,
    specialContact,
  });

  let apiUrl = `https://rest.apicausas.xyz/api/v1/ai/gemini?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(persona)}`;
  if (imageUrl) apiUrl += `&${AI_IMAGE_PARAM}=${encodeURIComponent(imageUrl)}`;

  const data = await callApiWithRetries(apiUrl);

  pushExchange(userId, chatId, question, data.reply);
  touchSession(userId, chatId);

  return {
    reply: data.reply,
    imageAttempted: !!imageBuffer,
    imageUploadFailed,
  };
}

module.exports = {
  ask,
  resetMemory,
  getHistory,
  isSessionActive,
};
