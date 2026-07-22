// ============================================
//   db.js — Almacén de configuración por bot
//   Guarda ajustes individuales (nombre, prefijo,
//   owner, moneda, etc.) para el bot principal y
//   cada sub-bot, identificados por su JID.
//   Almacenamiento: JSON local en ./data/botSettings.json
// ============================================

const fs = require("fs");
const path = require("path");
const settings = require("./settings");

// Usa settings.storage.dataDir (env DATA_DIR) para poder apuntar a un
// Volume persistente en Railway y que la config no se borre en cada redeploy.
const rawDataDir = settings.storage.dataDir;
const DB_DIR = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(process.cwd(), rawDataDir);
const DB_FILE = path.join(DB_DIR, "botSettings.json");

function ensureFile() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Devuelve el objeto de configuración guardado para un JID de bot (o {} si no hay nada).
function getSettings(jid) {
  if (!jid) return {};
  const all = readAll();
  return all[jid] || {};
}

// Guarda/actualiza una clave dentro de la configuración de un JID de bot.
function setSettings(jid, key, value) {
  if (!jid) return {};
  const all = readAll();
  if (!all[jid]) all[jid] = {};
  all[jid][key] = value;
  writeAll(all);
  return all[jid];
}

module.exports = { getSettings, setSettings, readAll };
