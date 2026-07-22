// ============================================
//           FIEREN-BOT - BOT DE WHATSAPP
//           Desarrolladores: Emma y Jinn
//           WhatsApp: 5354185002
// ============================================

// Reporte periódico de memoria en consola: útil para revisar en el panel
// (Pterodactyl, etc.) qué tan cerca del límite está el bot antes de un
// posible crash, sin depender de que aparezca un stack trace.
setInterval(() => {
  const mem = process.memoryUsage();
  console.log(`🧠 Memoria: RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB, Heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`);
}, 5 * 60 * 1000);

const { startBot } = require("./main");
const settings   = require("./settings");
const http = require("http");
const { logError } = require("./logger");

// ============================================
//   SERVIDOR HTTP "KEEP-ALIVE"
//   Render duerme los Web Services gratuitos tras ~15 min
//   sin peticiones HTTP. Este mini servidor no interfiere
//   con el bot: solo existe para que un servicio externo
//   (UptimeRobot, cron-job.org, etc.) le haga ping cada
//   5-10 min a la URL pública de Render y así se mantenga
//   despierto. Usa el puerto que Render inyecta en PORT.
// ============================================
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`🤖 ${settings.bot.name} está activo.\n`);
  })
  .listen(PORT, () => {
    console.log(`🌐 Servidor keep-alive escuchando en el puerto ${PORT}`);
  });

console.log("============================================");
console.log(`   🤖 ${settings.bot.name} - Bot de WhatsApp`);
console.log(`   👨‍💻 Desarrolladores : Emma y Jinn`);
console.log(`   📞 Contactos      : 5354185002 / 18096758983 / 573135180876`);
console.log(`   ⚙️  Prefijo        : ${settings.prefix}`);
console.log("============================================\n");

// --- MANEJO DE ERRORES GLOBALES ---
process.on("uncaughtException", (err) => {
  logError("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  logError("unhandledRejection", reason);
});

// --- INICIAR BOT ---
startBot().catch((err) => {
  logError("startBot", err);
  process.exit(1);
});
