// ============================================
//       FIEREN-BOT - SISTEMA DE PERFILES
// ============================================

const fs = require("fs");
const path = require("path");
const settings = require("./settings");

// Usa settings.storage.dataDir (env DATA_DIR) para poder apuntar a un
// Volume persistente en Railway y que los perfiles no se borren en cada redeploy.
const rawDataDir = settings.storage.dataDir;
const DATA_DIR = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(__dirname, rawDataDir);
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");

// ── XP por nivel ──────────────────────────────────────────────────────────────
function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

function getLevelFromXP(xp) {
  let level = 1;
  let total = 0;
  while (total + xpForLevel(level) <= xp) {
    total += xpForLevel(level);
    level++;
  }
  return { level, currentXP: xp - (total - xpForLevel(level - 1)), needed: xpForLevel(level) };
}

function xpBar(current, needed, length = 10) {
  const filled = Math.round((current / needed) * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

// ── Formateo de tiempo (para AFK) ───────────────────────────────────────────────
function formatTiempo(ms) {
  if (typeof ms !== "number" || isNaN(ms)) return "desconocido";
  const h = Math.floor(ms / 3600000);
  const min = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? "hora" : "horas"}`);
  if (min) parts.push(`${min} ${min === 1 ? "minuto" : "minutos"}`);
  if (s || (!h && !min)) parts.push(`${s} ${s === 1 ? "segundo" : "segundos"}`);
  return parts.join(" ");
}

// ── Archivo ───────────────────────────────────────────────────────────────────
function loadProfiles() {
  try {
    if (!fs.existsSync(path.dirname(PROFILES_FILE))) {
      fs.mkdirSync(path.dirname(PROFILES_FILE), { recursive: true });
    }
    if (!fs.existsSync(PROFILES_FILE)) {
      fs.writeFileSync(PROFILES_FILE, JSON.stringify({ users: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
  } catch { return { users: {} }; }
}

function saveProfiles(data) {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error("Error guardando perfiles:", e.message); }
}

function getProfileUser(data, userId, groupId) {
  const key = `${userId}:${groupId}`;
  if (!data.users[key]) {
    data.users[key] = {
      userId, groupId,
      xp: 0,
      description: null,
      genre: null,
      birthday: null,
      hobby: null,
      partner: null,     // JID de la pareja
      lastXP: 0,         // cooldown de XP por mensaje
      msgCount: 0,
      afk: null,         // timestamp (ms) desde que está AFK, o null
      afkReason: '',     // motivo del AFK
    };
  }
  return data.users[key];
}

// ── XP automático por mensajes ────────────────────────────────────────────────
function addMessageXP(userId, groupId) {
  const data = loadProfiles();
  const user = getProfileUser(data, userId, groupId);
  const now = Date.now();
  const cooldown = 60 * 1000; // 1 min entre XP
  if (now - user.lastXP < cooldown) return;
  const xpGain = Math.floor(Math.random() * 10) + 5; // 5-15 XP
  user.xp += xpGain;
  user.lastXP = now;
  user.msgCount = (user.msgCount || 0) + 1;
  saveProfiles(data);
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function cmdProfile(sock, msg, sender, from, mentionedJid, gacha, economy) {
  const targetId = mentionedJid || sender;
  const data = loadProfiles();
  const user = getProfileUser(data, targetId, from);
  const { level, currentXP, needed } = getLevelFromXP(user.xp);
  const bar = xpBar(currentXP, needed);
  const tag = `@${targetId.split("@")[0]}`;

  // Datos de economía
  let walletInfo = "";
  try {
    const ecoData = economy.loadEconomy();
    const ecoUser = economy.getEcoUser(ecoData, targetId, from);
    walletInfo = `\n💰 *Coins:* ${ecoUser.wallet} | 🏦 Banco: ${ecoUser.bank}`;
  } catch {}

  // Datos de gacha
  let gachaInfo = "";
  try {
    const gachaData = gacha.loadGacha();
    const gachaUser = gacha.getUser(gachaData, targetId, from);
    const ssrCount = gachaUser.harem.filter(h => h.rarity === "SSR").length;
    gachaInfo = `\n🎴 *Personajes:* ${gachaUser.harem.length} | 🌟 SSR: ${ssrCount}`;
    if (gachaUser.favorito) gachaInfo += `\n💖 *Favorito:* ${gachaUser.favorito}`;
  } catch {}

  // Pareja
  let partnerInfo = "";
  if (user.partner) {
    partnerInfo = `\n💍 *Pareja:* @${user.partner.split("@")[0]}`;
  }

  // Fecha formateada
  let bdayInfo = "";
  if (user.birthday) {
    const [d, m, y] = user.birthday.split("/");
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    bdayInfo = `\n🎂 *Cumpleaños:* ${d} ${months[parseInt(m) - 1]} ${y}`;
  }

  const genreEmoji = user.genre === "hombre" ? "♂️" : user.genre === "mujer" ? "♀️" : "❓";
  const mentions = [targetId];
  if (user.partner) mentions.push(user.partner);

  const text =
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
    `🪞 *Perfil de ${tag}*\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
    `☆ Nivel ⋆ ${level}\n` +
    `☆ XP ⋆ ${currentXP}/${needed}\n` +
    `[${bar}]\n` +
    `☆ Mensajes ⋆ ${user.msgCount || 0}\n` +
    `☆ Género ⋆ ${genreEmoji} ${user.genre || "No establecido"}\n` +
    `${bdayInfo}` +
    `${user.hobby ? `\n☆ Pasatiempo ⋆ ${user.hobby}` : ""}` +
    `${user.description ? `\n☆ Bio ⋆ ${user.description}` : ""}` +
    `${partnerInfo}` +
    `${walletInfo}` +
    `${gachaInfo}\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄`;

  await sock.sendMessage(from, { text, mentions }, { quoted: msg });
}

async function cmdLevel(sock, msg, sender, from, mentionedJid) {
  const targetId = mentionedJid || sender;
  const data = loadProfiles();
  const user = getProfileUser(data, targetId, from);
  const { level, currentXP, needed } = getLevelFromXP(user.xp);
  const bar = xpBar(currentXP, needed);
  const tag = `@${targetId.split("@")[0]}`;

  await sock.sendMessage(from, {
    text:
      `⚡ *Nivel de ${tag}*\n\n` +
      `🏅 Nivel: *${level}*\n` +
      `📊 XP: *${currentXP}/${needed}*\n` +
      `[${bar}]\n` +
      `🌟 XP Total: *${user.xp}*`,
    mentions: [targetId],
  }, { quoted: msg });
}

async function cmdLeaderboard(sock, msg, from, args) {
  const data = loadProfiles();
  const page = parseInt(args[0]) || 1;
  const perPage = 10;

  const groupUsers = Object.values(data.users).filter(u => u.groupId === from || u.userId + ":" + u.groupId === from + ":" + from);
  const allUsers = Object.values(data.users);
  const sorted = allUsers.sort((a, b) => b.xp - a.xp);
  const totalPages = Math.ceil(sorted.length / perPage);
  const slice = sorted.slice((page - 1) * perPage, page * perPage);

  if (!slice.length) {
    await sock.sendMessage(from, { text: `No hay usuarios en el ranking aún.` });
    return;
  }

  let text = `🏆 *Top Usuarios por XP* — Página ${page}/${totalPages || 1}\n\n`;
  slice.forEach((u, i) => {
    const pos = (page - 1) * perPage + i + 1;
    const emoji = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `${pos}.`;
    const { level } = getLevelFromXP(u.xp);
    text += `${emoji} @${u.userId.split("@")[0]}\n`;
    text += `   ⚡ Nivel ${level} • 🌟 ${u.xp} XP\n\n`;
  });
  text += `_Usa !lb <página> para navegar_`;

  const mentions = slice.map(u => u.userId);
  await sock.sendMessage(from, { text, mentions }, { quoted: msg });
}

async function cmdSetDescription(sock, msg, sender, from, args) {
  const desc = args.join(" ");
  if (!desc) {
    await sock.sendMessage(from, { text: `Usa: *!setdesc <descripción>*` });
    return;
  }
  if (desc.length > 100) {
    await sock.sendMessage(from, { text: `❌ La descripción no puede tener más de 100 caracteres.` });
    return;
  }
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.description = desc;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Descripción actualizada.` }, { quoted: msg });
}

async function cmdDelDescription(sock, msg, sender, from) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.description = null;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Descripción eliminada.` }, { quoted: msg });
}

async function cmdSetGenre(sock, msg, sender, from, args) {
  const genre = args[0]?.toLowerCase();
  if (!genre || !["hombre", "mujer"].includes(genre)) {
    await sock.sendMessage(from, { text: `Usa: *!setgenre hombre* o *!setgenre mujer*` });
    return;
  }
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.genre = genre;
  saveProfiles(data);
  const emoji = genre === "hombre" ? "♂️" : "♀️";
  await sock.sendMessage(from, { text: `✅ Género establecido como *${genre}* ${emoji}` }, { quoted: msg });
}

async function cmdDelGenre(sock, msg, sender, from) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.genre = null;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Género eliminado.` }, { quoted: msg });
}

async function cmdSetBirthday(sock, msg, sender, from, args) {
  const date = args[0];
  if (!date) {
    await sock.sendMessage(from, { text: `Usa: *!setbirth <dia/mes/año>*\nEjemplo: *!setbirth 15/06/2000*` });
    return;
  }
  const parts = date.split("/");
  if (parts.length !== 3 || parts.some(p => isNaN(parseInt(p)))) {
    await sock.sendMessage(from, { text: `❌ Formato incorrecto. Usa: *!setbirth 15/06/2000*` });
    return;
  }
  const [d, m, y] = parts.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) {
    await sock.sendMessage(from, { text: `❌ Fecha inválida.` });
    return;
  }
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.birthday = date;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Cumpleaños establecido: *${date}* 🎂` }, { quoted: msg });
}

async function cmdDelBirthday(sock, msg, sender, from) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.birthday = null;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Cumpleaños eliminado.` }, { quoted: msg });
}

async function cmdSetHobby(sock, msg, sender, from, args) {
  const hobby = args.join(" ");
  if (!hobby) {
    await sock.sendMessage(from, { text: `Usa: *!sethobby <pasatiempo>*\nEjemplo: *!sethobby Ver anime*` });
    return;
  }
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.hobby = hobby;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Pasatiempo establecido: *${hobby}* 🎯` }, { quoted: msg });
}

async function cmdDelHobby(sock, msg, sender, from) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.hobby = null;
  saveProfiles(data);
  await sock.sendMessage(from, { text: `✅ Pasatiempo eliminado.` }, { quoted: msg });
}

// ── Matrimonio ───────────────────────────────────────────────────────────────
// Propuestas pendientes en memoria: marriageProposals[from][proposerId] = targetId
const marriageProposals = {};

function spouseWord(genre) {
  return genre === "mujer" ? "Esposa" : genre === "hombre" ? "Esposo" : "Esposx";
}

function marriedWord(genre) {
  return genre === "mujer" ? "casada" : genre === "hombre" ? "casado" : "casadx";
}

async function cmdMarry(sock, msg, sender, from, mentionedJid) {
  if (!mentionedJid) {
    await sock.sendMessage(from, { text: `Usa: *!marry @usuario*` });
    return;
  }
  if (mentionedJid === sender) {
    const data0 = loadProfiles();
    const self0 = getProfileUser(data0, sender, from);
    await sock.sendMessage(from, { text: `❌ No puedes proponerte matrimonio a ti ${marriedWord(self0.genre)}.` });
    return;
  }

  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  const target = getProfileUser(data, mentionedJid, from);

  if (user.partner) {
    await sock.sendMessage(from, {
      text: `❌ Ya estás ${marriedWord(user.genre)} con @${user.partner.split("@")[0]}. Usa *!divorce* primero.`,
      mentions: [user.partner],
    });
    return;
  }
  if (target.partner) {
    await sock.sendMessage(from, {
      text: `❌ @${mentionedJid.split("@")[0]} ya está ${marriedWord(target.genre)} con @${target.partner.split("@")[0]}.`,
      mentions: [mentionedJid, target.partner],
    });
    return;
  }

  marriageProposals[from] = marriageProposals[from] || {};

  // ¿El destinatario ya le había propuesto matrimonio a quien envía ahora? → se confirma
  if (marriageProposals[from][mentionedJid] === sender) {
    delete marriageProposals[from][mentionedJid];
    user.partner = mentionedJid;
    target.partner = sender;
    saveProfiles(data);

    await sock.sendMessage(from, {
      text:
        `✩.･:｡≻───── ⋆♡⋆ ─────.•:｡✩\n` +
        `¡Se han Casado! ฅ^•ﻌ•^ฅ*:･ﾟ✧\n\n` +
        `•.¸♡ ${spouseWord(user.genre)} @${sender.split("@")[0]} ♡¸.•\n` +
        `•.¸♡ ${spouseWord(target.genre)} @${mentionedJid.split("@")[0]} ♡¸.•\n\n` +
        `\`Disfruten de su luna de miel\`\n\n` +
        `✩.･:｡≻───── ⋆♡⋆ ─────.•:｡✩`,
      mentions: [sender, mentionedJid],
    }, { quoted: msg });
    return;
  }

  // Nueva propuesta, expira en 2 minutos
  marriageProposals[from][sender] = mentionedJid;
  setTimeout(() => {
    if (marriageProposals[from]?.[sender] === mentionedJid) {
      delete marriageProposals[from][sender];
    }
  }, 120000);

  await sock.sendMessage(from, {
    text:
      `♡ @${mentionedJid.split("@")[0]}, el usuario @${sender.split("@")[0]} te ha enviado una propuesta de matrimonio, ¿aceptas? •(=^●ω●^=)•\n\n` +
      `⚘ *Responde con:*\n` +
      `> ● *!marry @${sender.split("@")[0]}* para confirmar.\n` +
      `> ● La propuesta expirará en 2 minutos.`,
    mentions: [sender, mentionedJid],
  }, { quoted: msg });
}

async function cmdDivorce(sock, msg, sender, from) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);

  if (!user.partner) {
    await sock.sendMessage(from, { text: `❌ No estás ${marriedWord(user.genre)} con nadie.` });
    return;
  }

  const partnerUser = getProfileUser(data, user.partner, from);
  const exPartner = user.partner;
  user.partner = null;
  partnerUser.partner = null;
  saveProfiles(data);

  await sock.sendMessage(from, {
    text:
      `💔 *@${sender.split("@")[0]}* se divorció de *@${exPartner.split("@")[0]}*.\n\n` +
      `_Fin de una historia..._ 😢`,
    mentions: [sender, exPartner],
  }, { quoted: msg });
}

async function cmdAfk(sock, msg, sender, from, args) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);
  user.afk = Date.now();
  user.afkReason = args.join(" ") || "Sin especificar";
  saveProfiles(data);
  const tag = `@${sender.split("@")[0]}`;
  await sock.sendMessage(from, {
    text: `💤 *${tag}* estará AFK.\n> ○ Motivo » *${user.afkReason}*`,
    mentions: [sender],
  }, { quoted: msg });
}

// Se ejecuta en CADA mensaje (como addMessageXP):
// 1) Si el que envía estaba AFK, lo quita del modo AFK y le da recompensa en coins.
// 2) Si el mensaje menciona o cita a alguien que está AFK, avisa que está ausente.
async function checkAfk(sock, msg, sender, from, mentionedJid, quotedSender, economy) {
  const data = loadProfiles();
  const user = getProfileUser(data, sender, from);

  if (typeof user.afk === "number" && user.afk > 0) {
    const ms = Date.now() - user.afk;
    const minutos = Math.floor(ms / 60000);
    const horas = Math.floor(ms / 3600000);
    let coins = minutos * 8;
    const bonos = Math.floor(horas / 3);
    for (let i = 0; i < bonos; i++) {
      coins += Math.floor(Math.random() * (1500 - 300 + 1)) + 300;
    }
    let recompensa = "";
    if (coins > 0 && economy) {
      try {
        const ecoData = economy.loadEconomy();
        const ecoUser = economy.getEcoUser(ecoData, sender);
        ecoUser.wallet = (ecoUser.wallet || 0) + coins;
        economy.saveEconomy(ecoData);
        recompensa = `\n> ○ Recompensa » *${coins} coins*`;
      } catch { /* economía no disponible, se ignora la recompensa */ }
    }
    const tiempo = formatTiempo(ms);
    const tag = `@${sender.split("@")[0]}`;
    user.afk = null;
    user.afkReason = "";
    saveProfiles(data);
    await sock.sendMessage(from, {
      text: `👋 *${tag}* dejaste de estar AFK.\n> ○ Tiempo inactivo » *${tiempo}*${recompensa}`,
      mentions: [sender],
    }, { quoted: msg });
  }

  const jids = [...new Set([mentionedJid, quotedSender].filter(Boolean))];
  for (const jid of jids) {
    if (jid === sender) continue;
    const target = getProfileUser(data, jid, from);
    if (typeof target.afk !== "number" || target.afk <= 0) continue;
    const ms = Date.now() - target.afk;
    const tiempo = formatTiempo(ms);
    const tag = `@${jid.split("@")[0]}`;
    await sock.sendMessage(from, {
      text: `💤 *${tag}* está AFK.\n> ○ Motivo » *${target.afkReason || "sin especificar"}*\n> ○ Tiempo inactivo » *${tiempo}*`,
      mentions: [jid],
    }, { quoted: msg });
  }
}

module.exports = {
  cmdProfile, cmdLevel, cmdLeaderboard,
  cmdSetDescription, cmdDelDescription,
  cmdSetGenre, cmdDelGenre,
  cmdSetBirthday, cmdDelBirthday,
  cmdSetHobby, cmdDelHobby,
  cmdMarry, cmdDivorce,
  cmdAfk, checkAfk,
  addMessageXP, loadProfiles, getProfileUser,
};
