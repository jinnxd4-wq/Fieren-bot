// ============================================
//           CONFIGURACIÓN DEL BOT
//           Desarrolladores: Emma y Jinn
//           WhatsApp: 522441357601 / 5354185002
// ============================================

require("dotenv").config();

const settings = {

  // --- GRUPOS ---
  groups: {
    welcome: true,
    goodbye: true,
    antiLink: true,
  },

  // --- OWNER ---
  owner: {
    allowOnlyOwnersCommands: true,
  },

  // --- ALMACENAMIENTO ---
  // En Railway el disco del contenedor se borra en cada redeploy. Para que el
  // bot principal y los sub-bots reconecten solos (sin volver a vincular),
  // monta un Volume en Railway y apunta estas rutas dentro de él, ej:
  //   DATA_DIR=/data/data
  //   AUTH_FOLDER=/data/auth_info
  //   SUB_BOTS_FOLDER=/data/auth_info_subbots
  storage: {
    dataDir: process.env.DATA_DIR || "./data", // economía, perfiles, gacha, ajustes, banners
  },

  // --- BAILEYS ---
  baileys: {
    authFolder: process.env.AUTH_FOLDER || "./auth_info", // Carpeta donde se guarda la sesión
    subBotsFolder: process.env.SUB_BOTS_FOLDER || "./auth_info_subbots", // Carpeta base para sesiones de sub-bots (!code)
    printQRInTerminal: true,                              // Muestra el QR en la terminal para escanear
    browser: ["Ubuntu", "Chrome", "20.0.04"],                 // Perfil reconocido por WhatsApp (necesario para que el código de vinculación funcione)
    syncFullHistory: false,                               // Sincronizar historial completo (recomendado: false)
    markOnlineOnConnect: true,                            // Aparecer en línea al conectar
  },

  // --- PREFIJO DE COMANDOS ---
  prefix: process.env.BOT_PREFIX || "!",                 // Cambia esto en el .env

  // --- APIS EXTERNAS ---
  apis: {
    apicausas: process.env.APICAUSAS_KEY || "causa-4148c87379edfd97", // https://rest.apicausas.xyz
  },

  // --- BASE DE DATOS ---
  database: {
    type: process.env.DB_TYPE || "mysql",                // Opciones: "mysql" | "mongodb" | "sqlite"
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    name: process.env.DB_NAME || "whatsapp_bot",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    // Para MongoDB usa esto en su lugar:
    // uri: process.env.MONGO_URI || "mongodb://localhost:27017/whatsapp_bot",
  },

  // --- CONFIGURACIÓN GENERAL ---
  bot: {
    name: process.env.BOT_NAME || "Fieren-bot",              // Nombre del bot
    language: "es",                                       // Idioma por defecto
    timezone: "America/Mexico_City",                      // Zona horaria
    maxRetries: 3,                                        // Reintentos en caso de error
    ownerNumber: process.env.OWNER_NUMBER || "5354185002", // Número principal del dueño del bot (Jinn)
    secondaryOwnerNumber: process.env.SECONDARY_OWNER_NUMBER || "522441357601", // Número secundario (Emma)
    // Lista de números owner. Acepta cualquier cantidad separados por coma en la variable de entorno OWNER_NUMBERS.
    // Ej: OWNER_NUMBERS=5354185002,522441357601
    ownerNumbers: (process.env.OWNER_NUMBERS || "5354185002,522441357601")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  },

};

module.exports = settings;
