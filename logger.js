// ============================================
//           LOGGER DE ERRORES
//   Guarda los errores en /logs/errors-YYYY-MM-DD.log
//   además de mostrarlos en consola. Pensado para servidores
//   con RAM ajustada (Pterodactyl): no guarda nada en memoria,
//   escribe directo a disco con fs.appendFile (async, no bloquea
//   el event loop) y borra logs viejos para no llenar el disco.
// ============================================

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "logs");
const MAX_LOG_DAYS = Number(process.env.LOG_MAX_DAYS || 7); // cuántos días de logs conservar

// Crea la carpeta de logs si no existe
try {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  console.error("❌ No se pudo crear la carpeta de logs:", e.message);
}

function todayFileName() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `errors-${yyyy}-${mm}-${dd}.log`;
}

// Borra archivos de log con más de MAX_LOG_DAYS de antigüedad
function cleanOldLogs() {
  fs.readdir(LOG_DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - MAX_LOG_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      if (!file.startsWith("errors-") || !file.endsWith(".log")) continue;
      const filePath = path.join(LOG_DIR, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (stats.mtimeMs < cutoff) {
          fs.unlink(filePath, () => {});
        }
      });
    }
  });
}

/**
 * Registra un error: lo imprime en consola y lo agrega al archivo de log del día.
 * @param {string} context - de dónde vino el error (ej. "uncaughtException", "comando ytmp3")
 * @param {Error|any} err - el error a registrar
 */
function logError(context, err) {
  const timestamp = new Date().toISOString();
  const message = err && err.message ? err.message : String(err);
  const stack = err && err.stack ? err.stack : "(sin stack trace)";

  console.error(`❌ [${context}] ${message}`);

  const line = `[${timestamp}] [${context}] ${message}\n${stack}\n\n`;
  const filePath = path.join(LOG_DIR, todayFileName());

  fs.appendFile(filePath, line, (err2) => {
    if (err2) console.error("❌ No se pudo escribir en el log de errores:", err2.message);
  });
}

// Limpieza al iniciar y luego una vez al día
cleanOldLogs();
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

module.exports = { logError };
