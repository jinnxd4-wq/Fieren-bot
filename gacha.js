// ============================================
//        FIEREN-BOT - SISTEMA DE GACHA
// ============================================

const fs = require("fs");
const path = require("path");
const settings = require("./settings");
const { logError } = require("./logger");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// Usa settings.storage.dataDir (env DATA_DIR) para poder apuntar a un
// Volume persistente en Railway y que el gacha no se borre en cada redeploy.
const rawGachaDataDir = settings.storage.dataDir;
const GACHA_DATA_DIR = path.isAbsolute(rawGachaDataDir) ? rawGachaDataDir : path.join(__dirname, rawGachaDataDir);
const GACHA_FILE = path.join(GACHA_DATA_DIR, "gacha.json");

// ── Base de datos de personajes (series populares) ──
const CHARACTERS_DB = [
  // Solo Leveling
  { id: 1, name: "Sung Jinwoo", series: "Solo Leveling", rarity: "SSR", value: 5000 },
  { id: 2, name: "Cha Hae-In", series: "Solo Leveling", rarity: "SR", value: 2500 },
  { id: 3, name: "Go Gunhee", series: "Solo Leveling", rarity: "R", value: 800 },
  // Jujutsu Kaisen
  { id: 4, name: "Gojo Satoru", series: "Jujutsu Kaisen", rarity: "SSR", value: 5000 },
  { id: 5, name: "Megumi Fushiguro", series: "Jujutsu Kaisen", rarity: "SR", value: 2500 },
  { id: 6, name: "Nobara Kugisaki", series: "Jujutsu Kaisen", rarity: "SR", value: 2500 },
  { id: 7, name: "Yuji Itadori", series: "Jujutsu Kaisen", rarity: "SR", value: 2000 },
  { id: 8, name: "Ryomen Sukuna", series: "Jujutsu Kaisen", rarity: "SSR", value: 6000 },
  // Demon Slayer
  { id: 9, name: "Tanjiro Kamado", series: "Demon Slayer", rarity: "SR", value: 2000 },
  { id: 10, name: "Nezuko Kamado", series: "Demon Slayer", rarity: "SR", value: 2500 },
  { id: 11, name: "Zenitsu Agatsuma", series: "Demon Slayer", rarity: "R", value: 1000 },
  { id: 12, name: "Inosuke Hashibira", series: "Demon Slayer", rarity: "R", value: 1000 },
  { id: 13, name: "Muzan Kibutsuji", series: "Demon Slayer", rarity: "SSR", value: 5500 },
  // Attack on Titan
  { id: 14, name: "Eren Yeager", series: "Attack on Titan", rarity: "SSR", value: 5000 },
  { id: 15, name: "Levi Ackerman", series: "Attack on Titan", rarity: "SSR", value: 5500 },
  { id: 16, name: "Mikasa Ackerman", series: "Attack on Titan", rarity: "SR", value: 2500 },
  { id: 17, name: "Armin Arlert", series: "Attack on Titan", rarity: "R", value: 1000 },
  // Naruto
  { id: 18, name: "Naruto Uzumaki", series: "Naruto", rarity: "SSR", value: 5000 },
  { id: 19, name: "Sasuke Uchiha", series: "Naruto", rarity: "SSR", value: 5000 },
  { id: 20, name: "Sakura Haruno", series: "Naruto", rarity: "SR", value: 2000 },
  { id: 21, name: "Kakashi Hatake", series: "Naruto", rarity: "SR", value: 2500 },
  { id: 22, name: "Hinata Hyuga", series: "Naruto", rarity: "SR", value: 2000 },
  // One Piece
  { id: 23, name: "Monkey D. Luffy", series: "One Piece", rarity: "SSR", value: 5000 },
  { id: 24, name: "Roronoa Zoro", series: "One Piece", rarity: "SSR", value: 5000 },
  { id: 25, name: "Nami", series: "One Piece", rarity: "SR", value: 2000 },
  { id: 26, name: "Nico Robin", series: "One Piece", rarity: "SR", value: 2000 },
  // Black Clover
  { id: 27, name: "Asta", series: "Black Clover", rarity: "SR", value: 2000 },
  { id: 28, name: "Yuno", series: "Black Clover", rarity: "SR", value: 2000 },
  { id: 29, name: "Noelle Silva", series: "Black Clover", rarity: "SR", value: 2000 },
  // Re:Zero
  { id: 30, name: "Subaru Natsuki", series: "Re:Zero", rarity: "R", value: 1000 },
  { id: 31, name: "Emilia", series: "Re:Zero", rarity: "SR", value: 2500 },
  { id: 32, name: "Rem", series: "Re:Zero", rarity: "SSR", value: 5500 },
  { id: 33, name: "Ram", series: "Re:Zero", rarity: "SR", value: 2000 },
  // My Hero Academia
  { id: 34, name: "Izuku Midoriya", series: "My Hero Academia", rarity: "SR", value: 2000 },
  { id: 35, name: "Katsuki Bakugo", series: "My Hero Academia", rarity: "SR", value: 2000 },
  { id: 36, name: "Shoto Todoroki", series: "My Hero Academia", rarity: "SR", value: 2500 },
  { id: 37, name: "All Might", series: "My Hero Academia", rarity: "SSR", value: 5000 },
  // Chainsaw Man
  { id: 38, name: "Denji", series: "Chainsaw Man", rarity: "SR", value: 2000 },
  { id: 39, name: "Makima", series: "Chainsaw Man", rarity: "SSR", value: 6000 },
  { id: 40, name: "Power", series: "Chainsaw Man", rarity: "SR", value: 2500 },
];

const RARITY_RATES = { SSR: 5, SR: 25, R: 70 };
const RARITY_EMOJI = { SSR: "🌟", SR: "⭐", R: "✨" };
const ROLL_COST = 500;
const ROLL_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos entre rolls, por usuario
const CLAIM_COST = 0;
const SALE_MIN_PRICE = 2000;
const SALE_MAX_PRICE = 100_000_000;
const SALE_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // 3 días
const ROB_COOLDOWN_MS = 3 * 60 * 60 * 1000;      // 3 horas
const ROB_VICTIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 1 vez por víctima cada 24h
const ROB_SUCCESS_RATE = 0.4;

// ── Helpers de archivo ────────────────────────────────────────────────────────
function loadGacha() {
  try {
    if (!fs.existsSync(path.dirname(GACHA_FILE))) {
      fs.mkdirSync(path.dirname(GACHA_FILE), { recursive: true });
    }
    if (!fs.existsSync(GACHA_FILE)) {
      fs.writeFileSync(GACHA_FILE, JSON.stringify({ users: {}, shop: [], lastRolls: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(GACHA_FILE, "utf-8"));
  } catch { return { users: {}, shop: [], lastRolls: {} }; }
}

function saveGacha(data) {
  try {
    fs.writeFileSync(GACHA_FILE, JSON.stringify(data, null, 2));
  } catch (e) { logError("Error guardando gacha:", e); }
}

function getUser(data, userId, groupId) {
  const key = `${userId}:${groupId}`;
  if (!data.users[key]) {
    data.users[key] = {
      userId, groupId,
      harem: [],       // personajes reclamados
      coins: 0,
      votes: {},       // votos por personaje
      favorito: null,
      claimMsg: null,
      lastRobAt: 0,
      robVictims: {},  // { victimKey: timestamp }
    };
  }
  return data.users[key];
}

function rollCharacter() {
  const rand = Math.random() * 100;
  let rarity;
  if (rand < RARITY_RATES.SSR) rarity = "SSR";
  else if (rand < RARITY_RATES.SSR + RARITY_RATES.SR) rarity = "SR";
  else rarity = "R";
  const pool = CHARACTERS_DB.filter(c => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function findChar(name) {
  return CHARACTERS_DB.find(c => c.name.toLowerCase() === name.toLowerCase());
}

// Imagen del personaje: usa AniList como fuente PRINCIPAL. Es una API GraphQL
// gratuita, sin API key, sin rate-limit agresivo y mucho más estable que Jikan
// (que tiene bugs abiertos frecuentes) y que el scraping de DuckDuckGo (que se
// rompe cada vez que ellos cambian su HTML interno).
async function fetchCharImageFromAniList(charName) {
  try {
    const query = `
      query ($search: String) {
        Character(search: $search) {
          image { large medium }
        }
      }
    `;
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { search: charName } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const img = json?.data?.Character?.image;
    return img?.large || img?.medium || null;
  } catch (e) {
    logError("[AniList] Error buscando imagen de personaje:", e);
    return null;
  }
}

// Imagen del personaje: usa Jikan (API pública y estable basada en MyAnimeList)
// como respaldo si AniList no encuentra el personaje.
async function fetchCharImageFromJikan(charName) {
  try {
    const url = `https://api.jikan.moe/v4/characters?q=${encodeURIComponent(charName)}&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const json = await res.json();
    const char = json?.data?.[0];
    return char?.images?.jpg?.image_url || char?.images?.webp?.image_url || null;
  } catch (e) {
    logError("[Jikan] Error buscando imagen de personaje:", e);
    return null;
  }
}

// Último respaldo: búsqueda de imágenes de DuckDuckGo (frágil, solo se usa si
// ni AniList ni Jikan encontraron nada).
async function fetchCharImageFromDuckDuckGo(charName, series) {
  try {
    const query = `${charName} ${series} anime`;
    const ddgRes = await fetch("https://duckduckgo.com/", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const html = await ddgRes.text();
    const m = html.match(/vqd=([\d-]+)/);
    if (!m) return null;
    const token = m[1];
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${token}&f=,,,,,&p=1`,
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://duckduckgo.com/" } }
    );
    if (!imgRes.ok) return null;
    const json = await imgRes.json();
    return json?.results?.[0]?.image || null;
  } catch { return null; }
}

async function fetchCharImage(charName, series) {
  const aniListImg = await fetchCharImageFromAniList(charName);
  if (aniListImg) return aniListImg;
  const jikanImg = await fetchCharImageFromJikan(charName);
  if (jikanImg) return jikanImg;
  return await fetchCharImageFromDuckDuckGo(charName, series);
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function cmdRollWaifu(sock, msg, sender, from, economy) {
  const data = loadGacha();
  const user = getUser(data, sender, from);

  const elapsedSinceRoll = Date.now() - (user.lastRollAt || 0);
  if (elapsedSinceRoll < ROLL_COOLDOWN_MS) {
    await sock.sendMessage(from, {
      text: `⏳ Debes esperar *${fmtTimeLeft(ROLL_COOLDOWN_MS - elapsedSinceRoll)}* para volver a hacer *!rw*.`,
    }, { quoted: msg });
    return;
  }

  const ecoData = economy.loadEconomy();
  const ecoUser = economy.getEcoUser(ecoData, sender, from);

  if (ecoUser.wallet < ROLL_COST) {
    await sock.sendMessage(from, {
      text: `❌ Necesitas *${ROLL_COST} coins* en tu billetera para hacer un roll.\nTienes: *${ecoUser.wallet} coins*`,
    });
    return;
  }

  ecoUser.wallet -= ROLL_COST;
  economy.saveEconomy(ecoData);

  user.lastRollAt = Date.now();

  const char = rollCharacter();
  const rarityEmoji = RARITY_EMOJI[char.rarity];
  data.lastRolls[from] = { char, time: Date.now() };
  saveGacha(data);

  let imageBuffer = null;
  let imageMimetype = "image/jpeg";
  try {
    const imgUrl = await fetchCharImage(char.name, char.series);
    console.log(`[rw] Personaje: ${char.name} -> imagen: ${imgUrl || "NO ENCONTRADA"}`);
    if (imgUrl) {
      const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (imgRes.ok) {
        imageBuffer = Buffer.from(await imgRes.arrayBuffer());
        // Usamos el content-type real de la respuesta en vez de asumir jpeg a
        // ciegas: Jikan a veces solo tiene la variante .webp del personaje, y
        // mandarla con un mimetype equivocado hace que WhatsApp la rechace o
        // la muestre rota (parecía que "nunca mandaba imagen").
        const contentType = imgRes.headers?.get?.("content-type");
        if (contentType && contentType.startsWith("image/")) imageMimetype = contentType.split(";")[0].trim();
      }
    }
  } catch (error) {
    logError("[rw] Error obteniendo imagen del personaje:", error);
  }

  const text =
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n` +
    `${rarityEmoji} *¡Un espíritu apareció!*\n` +
    `┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n\n` +
    `☆ Nombre ⋆ ${char.name}\n` +
    `☆ Serie ⋆ ${char.series}\n` +
    `☆ Rareza ⋆ ${char.rarity}\n` +
    `☆ Valor ⋆ ${char.value} coins\n\n` +
    `_✎ Usa !claim para reclamarlo_\n` +
    `_✎ Costo del roll: ${ROLL_COST} coins_`;

  if (imageBuffer && imageBuffer.length > 1000) {
    await sock.sendMessage(from, { image: imageBuffer, caption: text, mimetype: imageMimetype }, { quoted: msg });
  } else {
    await sock.sendMessage(from, { text }, { quoted: msg });
  }
}

async function cmdClaim(sock, msg, sender, from, args) {
  const data = loadGacha();
  const lastRoll = data.lastRolls[from];

  if (!lastRoll || Date.now() - lastRoll.time > 5 * 60 * 1000) {
    await sock.sendMessage(from, { text: `❌ No hay ningún personaje disponible para reclamar. Usa *!rw* primero.` });
    return;
  }

  const char = lastRoll.char;

  // Si el usuario escribió un nombre, debe coincidir con el personaje disponible (evita reclamos por error/ambigüedad)
  if (args.length) {
    const charName = args.join(" ");
    if (char.name.toLowerCase() !== charName.toLowerCase()) {
      await sock.sendMessage(from, {
        text: `❌ El personaje disponible es *${char.name}*, no "${charName}".\nUsa *!claim*`,
      });
      return;
    }
  }

  const user = getUser(data, sender, from);
  const alreadyHas = user.harem.find(h => h.id === char.id);
  if (alreadyHas) {
    await sock.sendMessage(from, { text: `❌ Ya tienes a *${char.name}* en tu harem.` });
    return;
  }

  user.harem.push({ ...char, claimedAt: Date.now() });
  delete data.lastRolls[from];
  saveGacha(data);

  const rarityEmoji = RARITY_EMOJI[char.rarity];
  const claimText = user.claimMsg
    ? user.claimMsg.replace("{char}", char.name).replace("{user}", `@${sender.split("@")[0]}`)
    : `${rarityEmoji} *¡@${sender.split("@")[0]} reclamó a ${char.name}!* 🎉`;

  await sock.sendMessage(from, { text: claimText, mentions: [sender] }, { quoted: msg });
}

async function cmdHarem(sock, msg, sender, from, args, mentionedJid) {
  const data = loadGacha();
  const targetId = mentionedJid || sender;
  const user = getUser(data, targetId, from);
  const tag = `@${targetId.split("@")[0]}`;

  if (!user.harem.length) {
    await sock.sendMessage(from, {
      text: `${tag} no tiene personajes reclamados aún.\n_Usa !rw para hacer un roll._`,
      mentions: [targetId],
    });
    return;
  }

  const ssrList = user.harem.filter(h => h.rarity === "SSR");
  const srList = user.harem.filter(h => h.rarity === "SR");
  const rList = user.harem.filter(h => h.rarity === "R");

  let text = `🌸 *Harem de ${tag}*\n`;
  text += `_Total: ${user.harem.length} personajes_\n\n`;

  if (ssrList.length) {
    text += `🌟 *SSR (${ssrList.length})*\n`;
    ssrList.forEach(h => { text += `  • ${h.name} *(${h.series})*\n`; });
    text += "\n";
  }
  if (srList.length) {
    text += `⭐ *SR (${srList.length})*\n`;
    srList.forEach(h => { text += `  • ${h.name} *(${h.series})*\n`; });
    text += "\n";
  }
  if (rList.length) {
    text += `✨ *R (${rList.length})*\n`;
    rList.forEach(h => { text += `  • ${h.name} *(${h.series})*\n`; });
  }

  if (user.favorito) text += `\n💖 *Favorito:* ${user.favorito}`;

  await sock.sendMessage(from, { text, mentions: [targetId] }, { quoted: msg });
}

async function cmdCharInfo(sock, msg, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!charinfo <nombre>*` });
    return;
  }
  const char = findChar(name);
  if (!char) {
    await sock.sendMessage(from, { text: `❌ No encontré el personaje *"${name}"* en la base de datos.` });
    return;
  }
  const rarityEmoji = RARITY_EMOJI[char.rarity];
  const data = loadGacha();
  const totalClaims = Object.values(data.users).filter(u => u.harem.find(h => h.id === char.id)).length;
  const totalVotes = Object.values(data.users).reduce((acc, u) => acc + (u.votes[char.id] || 0), 0);

  let imageBuffer = null;
  try {
    const imgUrl = await fetchCharImage(char.name, char.series);
    if (imgUrl) {
      const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (imgRes.ok) imageBuffer = Buffer.from(await imgRes.arrayBuffer());
    }
  } catch {}

  const text =
    `${rarityEmoji} *${char.name}*\n\n` +
    `📺 *Serie:* ${char.series}\n` +
    `💎 *Rareza:* ${char.rarity}\n` +
    `💰 *Valor:* ${char.value} coins\n` +
    `❤️ *Reclamado por:* ${totalClaims} usuarios\n` +
    `👍 *Votos:* ${totalVotes}`;

  if (imageBuffer && imageBuffer.length > 1000) {
    await sock.sendMessage(from, { image: imageBuffer, caption: text, mimetype: "image/jpeg" }, { quoted: msg });
  } else {
    await sock.sendMessage(from, { text }, { quoted: msg });
  }
}

async function cmdDeleteWaifu(sock, msg, sender, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!delwaifu <nombre>*` });
    return;
  }
  const data = loadGacha();
  const user = getUser(data, sender, from);
  const idx = user.harem.findIndex(h => h.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    await sock.sendMessage(from, { text: `❌ No tienes a *${name}* en tu harem.` });
    return;
  }
  const removed = user.harem.splice(idx, 1)[0];
  if (user.favorito === removed.name) user.favorito = null;
  saveGacha(data);
  await sock.sendMessage(from, { text: `✅ Eliminaste a *${removed.name}* de tu harem.` }, { quoted: msg });
}

async function cmdGiveChar(sock, msg, sender, from, args, mentionedJid) {
  if (!mentionedJid || !args.length) {
    await sock.sendMessage(from, { text: `Usa: *!givechar <nombre> @usuario*` });
    return;
  }
  const charName = args.filter(a => !a.startsWith("@")).join(" ");
  if (!charName) {
    await sock.sendMessage(from, { text: `Debes especificar el nombre del personaje.` });
    return;
  }
  const data = loadGacha();
  const fromUser = getUser(data, sender, from);
  const toUser = getUser(data, mentionedJid, from);
  const idx = fromUser.harem.findIndex(h => h.name.toLowerCase() === charName.toLowerCase());
  if (idx === -1) {
    await sock.sendMessage(from, { text: `❌ No tienes a *${charName}* en tu harem.` });
    return;
  }
  const char = fromUser.harem.splice(idx, 1)[0];
  toUser.harem.push(char);
  if (fromUser.favorito === char.name) fromUser.favorito = null;
  saveGacha(data);

  await sock.sendMessage(from, {
    text: `🎁 *@${sender.split("@")[0]}* le regaló a *${char.name}* a *@${mentionedJid.split("@")[0]}*`,
    mentions: [sender, mentionedJid],
  }, { quoted: msg });
}

async function cmdTrade(sock, msg, sender, from, args, mentionedJid) {
  if (!mentionedJid || args.length < 2) {
    await sock.sendMessage(from, { text: `Usa: *!trade <tu personaje> / <personaje que quieres>*\nEjemplo: *!trade Rem / Nezuko @usuario*` });
    return;
  }
  const fullArgs = args.join(" ");
  const parts = fullArgs.split("/");
  if (parts.length < 2) {
    await sock.sendMessage(from, { text: `Separa los personajes con */*\nEjemplo: *!trade Rem / Nezuko @usuario*` });
    return;
  }
  const myChar = parts[0].replace(/@\w+/g, "").trim();
  const wantChar = parts[1].replace(/@\w+/g, "").trim();

  const data = loadGacha();
  const fromUser = getUser(data, sender, from);
  const toUser = getUser(data, mentionedJid, from);

  const myIdx = fromUser.harem.findIndex(h => h.name.toLowerCase() === myChar.toLowerCase());
  const wantIdx = toUser.harem.findIndex(h => h.name.toLowerCase() === wantChar.toLowerCase());

  if (myIdx === -1) {
    await sock.sendMessage(from, { text: `❌ No tienes a *${myChar}* en tu harem.` });
    return;
  }
  if (wantIdx === -1) {
    await sock.sendMessage(from, {
      text: `❌ *@${mentionedJid.split("@")[0]}* no tiene a *${wantChar}* en su harem.`,
      mentions: [mentionedJid],
    });
    return;
  }

  const myC = fromUser.harem.splice(myIdx, 1)[0];
  const wantC = toUser.harem.splice(wantIdx, 1)[0];
  fromUser.harem.push(wantC);
  toUser.harem.push(myC);
  if (fromUser.favorito === myC.name) fromUser.favorito = null;
  if (toUser.favorito === wantC.name) toUser.favorito = null;
  saveGacha(data);

  await sock.sendMessage(from, {
    text:
      `🔄 *¡Intercambio realizado!*\n\n` +
      `@${sender.split("@")[0]} dio: *${myC.name}*\n` +
      `@${mentionedJid.split("@")[0]} dio: *${wantC.name}*`,
    mentions: [sender, mentionedJid],
  }, { quoted: msg });
}

async function cmdSetFav(sock, msg, sender, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!setfav <nombre del personaje>*` });
    return;
  }
  const data = loadGacha();
  const user = getUser(data, sender, from);
  const char = user.harem.find(h => h.name.toLowerCase() === name.toLowerCase());
  if (!char) {
    await sock.sendMessage(from, { text: `❌ No tienes a *${name}* en tu harem.` });
    return;
  }
  user.favorito = char.name;
  saveGacha(data);
  await sock.sendMessage(from, { text: `💖 Estableciste a *${char.name}* como tu personaje favorito.` }, { quoted: msg });
}

async function cmdDelFav(sock, msg, sender, from) {
  const data = loadGacha();
  const user = getUser(data, sender, from);
  if (!user.favorito) {
    await sock.sendMessage(from, { text: `No tienes ningún personaje favorito establecido.` });
    return;
  }
  const old = user.favorito;
  user.favorito = null;
  saveGacha(data);
  await sock.sendMessage(from, { text: `✅ Eliminaste a *${old}* de tus favoritos.` }, { quoted: msg });
}

async function cmdVote(sock, msg, sender, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!vote <nombre del personaje>*` });
    return;
  }
  const char = findChar(name);
  if (!char) {
    await sock.sendMessage(from, { text: `❌ No encontré *${name}* en la base de datos.` });
    return;
  }
  const data = loadGacha();
  const user = getUser(data, sender, from);
  const lastVote = user.votes[`vote_${char.id}_time`] || 0;
  const cooldown = 12 * 60 * 60 * 1000;
  if (Date.now() - lastVote < cooldown) {
    const remaining = Math.ceil((cooldown - (Date.now() - lastVote)) / 3600000);
    await sock.sendMessage(from, { text: `⏳ Ya votaste por *${char.name}* hoy. Vuelve en *${remaining}h*.` });
    return;
  }
  user.votes[char.id] = (user.votes[char.id] || 0) + 1;
  user.votes[`vote_${char.id}_time`] = Date.now();
  saveGacha(data);
  const totalVotes = Object.values(data.users).reduce((acc, u) => acc + (u.votes[char.id] || 0), 0);
  await sock.sendMessage(from, {
    text: `👍 Votaste por *${char.name}*!\n_Total de votos: ${totalVotes}_`,
  }, { quoted: msg });
}

async function cmdWaifusTop(sock, msg, from, args) {
  const data = loadGacha();
  const page = parseInt(args[0]) || 1;
  const perPage = 10;

  const charVotes = {};
  for (const char of CHARACTERS_DB) {
    charVotes[char.id] = {
      char,
      votes: Object.values(data.users).reduce((acc, u) => acc + (u.votes[char.id] || 0), 0),
      claims: Object.values(data.users).filter(u => u.harem.find(h => h.id === char.id)).length,
    };
  }

  const sorted = Object.values(charVotes).sort((a, b) => b.votes - a.votes || b.claims - a.claims);
  const totalPages = Math.ceil(sorted.length / perPage);
  const slice = sorted.slice((page - 1) * perPage, page * perPage);

  let text = `🏆 *Top Personajes* — Página ${page}/${totalPages}\n\n`;
  slice.forEach((entry, i) => {
    const pos = (page - 1) * perPage + i + 1;
    const emoji = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `${pos}.`;
    text += `${emoji} *${entry.char.name}* _(${entry.char.series})_\n`;
    text += `   👍 ${entry.votes} votos • 🏠 ${entry.claims} dueños\n\n`;
  });
  text += `_Usa !wtop <página> para navegar_`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdFavTop(sock, msg, from) {
  const data = loadGacha();
  const favCount = {};
  for (const user of Object.values(data.users)) {
    if (user.favorito) {
      favCount[user.favorito] = (favCount[user.favorito] || 0) + 1;
    }
  }
  const sorted = Object.entries(favCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!sorted.length) {
    await sock.sendMessage(from, { text: `Nadie ha establecido un personaje favorito aún.` });
    return;
  }
  let text = `💖 *Top Personajes Favoritos*\n\n`;
  sorted.forEach(([name, count], i) => {
    const pos = i + 1;
    const emoji = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `${pos}.`;
    text += `${emoji} *${name}* — ${count} usuarios\n`;
  });
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdSerieList(sock, msg, from) {
  const series = [...new Set(CHARACTERS_DB.map(c => c.series))];
  let text = `📺 *Series disponibles (${series.length})*\n\n`;
  series.forEach((s, i) => {
    const chars = CHARACTERS_DB.filter(c => c.series === s);
    text += `${i + 1}. *${s}* — ${chars.length} personajes\n`;
  });
  text += `\n_Usa !ainfo <serie> para más detalles_`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdSerieInfo(sock, msg, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!ainfo <nombre de la serie>*` });
    return;
  }
  const chars = CHARACTERS_DB.filter(c => c.series.toLowerCase().includes(name.toLowerCase()));
  if (!chars.length) {
    await sock.sendMessage(from, { text: `❌ No encontré la serie *"${name}"*.` });
    return;
  }
  const serieName = chars[0].series;
  let text = `📺 *${serieName}*\n_${chars.length} personajes_\n\n`;
  const ssrC = chars.filter(c => c.rarity === "SSR");
  const srC = chars.filter(c => c.rarity === "SR");
  const rC = chars.filter(c => c.rarity === "R");
  if (ssrC.length) text += `🌟 *SSR:* ${ssrC.map(c => c.name).join(", ")}\n`;
  if (srC.length) text += `⭐ *SR:* ${srC.map(c => c.name).join(", ")}\n`;
  if (rC.length) text += `✨ *R:* ${rC.map(c => c.name).join(", ")}\n`;
  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdGachaInfo(sock, msg, sender, from) {
  const data = loadGacha();
  const user = getUser(data, sender, from);
  const ssrCount = user.harem.filter(h => h.rarity === "SSR").length;
  const srCount = user.harem.filter(h => h.rarity === "SR").length;
  const rCount = user.harem.filter(h => h.rarity === "R").length;
  const totalValue = user.harem.reduce((acc, h) => acc + h.value, 0);

  const text =
    `🎴 *Tu Info de Gacha*\n\n` +
    `🌟 SSR: ${ssrCount}\n` +
    `⭐ SR: ${srCount}\n` +
    `✨ R: ${rCount}\n` +
    `📦 Total: ${user.harem.length} personajes\n` +
    `💰 Valor total: ${totalValue} coins\n` +
    `💖 Favorito: ${user.favorito || "Sin establecer"}\n\n` +
    `_Tasas: SSR ${RARITY_RATES.SSR}% • SR ${RARITY_RATES.SR}% • R ${RARITY_RATES.R}%_\n` +
    `_Costo por roll: ${ROLL_COST} coins_`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdSetClaimMsg(sock, msg, sender, from, args) {
  const text = args.join(" ");
  if (!text) {
    await sock.sendMessage(from, {
      text: `Usa: *!setclaim <mensaje>*\nVariables: {char} = nombre del personaje, {user} = tu nombre\nEjemplo: *!setclaim {user} reclamó a {char} 🎉*`,
    });
    return;
  }
  const data = loadGacha();
  const user = getUser(data, sender, from);
  user.claimMsg = text;
  saveGacha(data);
  await sock.sendMessage(from, { text: `✅ Mensaje de claim personalizado guardado.` }, { quoted: msg });
}

async function cmdDelClaimMsg(sock, msg, sender, from) {
  const data = loadGacha();
  const user = getUser(data, sender, from);
  user.claimMsg = null;
  saveGacha(data);
  await sock.sendMessage(from, { text: `✅ Mensaje de claim restablecido al predeterminado.` }, { quoted: msg });
}

async function cmdHaremShop(sock, msg, from, args) {
  const data = loadGacha();
  const now = Date.now();
  data.shop = (data.shop || []).filter(item => now - item.listedAt < SALE_EXPIRY_MS);
  saveGacha(data);
  const page = parseInt(args[0]) || 1;
  const perPage = 8;
  const forSale = data.shop || [];

  if (!forSale.length) {
    await sock.sendMessage(from, { text: `🛒 La tienda está vacía.\n_Usa !sell <valor> <personaje> para vender._` });
    return;
  }

  const totalPages = Math.ceil(forSale.length / perPage);
  const slice = forSale.slice((page - 1) * perPage, page * perPage);

  let text = `🛒 *Tienda de Personajes* — Página ${page}/${totalPages}\n\n`;
  slice.forEach((item, i) => {
    const rEmoji = RARITY_EMOJI[item.char.rarity];
    text += `${(page - 1) * perPage + i + 1}. ${rEmoji} *${item.char.name}* _(${item.char.series})_\n`;
    text += `   💰 Precio: ${item.price} coins | Vendedor: @${item.seller.split("@")[0]}\n\n`;
  });
  text += `_Usa !buychar <nombre> para comprar_\n_Usa !wshop <página> para navegar_`;

  await sock.sendMessage(from, { text }, { quoted: msg });
}

async function cmdSell(sock, msg, sender, from, args) {
  if (args.length < 2) {
    await sock.sendMessage(from, { text: `Usa: *!sell <precio> <nombre del personaje>*\nEjemplo: *!sell 1000 Rem*` });
    return;
  }
  const price = parseInt(args[0]);
  const charName = args.slice(1).join(" ");
  if (isNaN(price) || price <= 0) {
    await sock.sendMessage(from, { text: `❌ El precio debe ser un número positivo.` });
    return;
  }
  if (price < SALE_MIN_PRICE) {
    await sock.sendMessage(from, { text: `❌ El precio mínimo para vender un personaje es de *${SALE_MIN_PRICE} coins*.` });
    return;
  }
  if (price > SALE_MAX_PRICE) {
    await sock.sendMessage(from, { text: `❌ El precio máximo permitido es de *${SALE_MAX_PRICE} coins*.` });
    return;
  }
  const data = loadGacha();
  const user = getUser(data, sender, from);
  const idx = user.harem.findIndex(h => h.name.toLowerCase() === charName.toLowerCase());
  if (idx === -1) {
    await sock.sendMessage(from, { text: `❌ No tienes a *${charName}* en tu harem.` });
    return;
  }
  const char = user.harem.splice(idx, 1)[0];
  if (user.favorito === char.name) user.favorito = null;
  if (!data.shop) data.shop = [];
  data.shop.push({ char, price, seller: sender, listedAt: Date.now() });
  saveGacha(data);

  await sock.sendMessage(from, {
    text: `✅ Pusiste a *${char.name}* en venta por *${price} coins*.\n_La venta expira en 3 días si nadie la compra._`,
  }, { quoted: msg });
}

async function cmdBuyChar(sock, msg, sender, from, args, economy) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!buychar <nombre del personaje>*` });
    return;
  }
  const data = loadGacha();
  const now = Date.now();
  data.shop = (data.shop || []).filter(item => now - item.listedAt < SALE_EXPIRY_MS);
  const shopIdx = data.shop.findIndex(i => i.char.name.toLowerCase() === name.toLowerCase());
  if (shopIdx === -1) {
    await sock.sendMessage(from, { text: `❌ *${name}* no está en la tienda (o la venta expiró). Usa *!wshop* para ver lo disponible.` });
    saveGacha(data);
    return;
  }
  const item = data.shop[shopIdx];
  if (item.seller === sender) {
    await sock.sendMessage(from, { text: `❌ No puedes comprarte tu propio personaje.` });
    return;
  }

  const ecoData = economy.loadEconomy();
  const buyer = economy.getEcoUser(ecoData, sender, from);
  if (buyer.wallet < item.price) {
    await sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins. Necesitas *${item.price}* y tienes *${buyer.wallet}*.`,
    });
    return;
  }

  buyer.wallet -= item.price;
  const sellerEco = economy.getEcoUser(ecoData, item.seller, from);
  sellerEco.wallet += item.price;
  economy.saveEconomy(ecoData);

  data.shop.splice(shopIdx, 1);
  const buyerGacha = getUser(data, sender, from);
  buyerGacha.harem.push(item.char);
  saveGacha(data);

  await sock.sendMessage(from, {
    text:
      `🛒 *¡Compra exitosa!*\n\n` +
      `Compraste a *${item.char.name}* por *${item.price} coins*.\n` +
      `El vendedor @${item.seller.split("@")[0]} recibió el pago.`,
    mentions: [item.seller],
  }, { quoted: msg });
}

async function cmdRemoveSale(sock, msg, sender, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!removerventa <nombre>*` });
    return;
  }
  const data = loadGacha();
  const idx = (data.shop || []).findIndex(i => i.seller === sender && i.char.name.toLowerCase() === name.toLowerCase());
  if (idx === -1) {
    await sock.sendMessage(from, { text: `❌ No tienes *${name}* en venta.` });
    return;
  }
  const item = data.shop.splice(idx, 1)[0];
  const user = getUser(data, sender, from);
  user.harem.push(item.char);
  saveGacha(data);
  await sock.sendMessage(from, { text: `✅ Retiraste a *${item.char.name}* de la tienda y lo devolviste a tu harem.` }, { quoted: msg });
}

async function cmdCharImage(sock, msg, from, args) {
  const name = args.join(" ");
  if (!name) {
    await sock.sendMessage(from, { text: `Usa: *!cimage <nombre del personaje>*` });
    return;
  }
  const char = findChar(name);
  if (!char) {
    await sock.sendMessage(from, { text: `❌ No encontré *${name}* en la base de datos.` });
    return;
  }
  try {
    const imgUrl = await fetchCharImage(char.name, char.series);
    if (!imgUrl) throw new Error("Sin imagen");
    const imgRes = await fetch(imgUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!imgRes.ok) throw new Error("Fetch fallido");
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    await sock.sendMessage(from, {
      image: buffer,
      caption: `🖼️ *${char.name}* — ${char.series}`,
      mimetype: "image/jpeg",
    }, { quoted: msg });
  } catch {
    await sock.sendMessage(from, { text: `❌ No pude obtener una imagen de *${char.name}*.` });
  }
}

async function cmdGiveAllHarem(sock, msg, sender, from, mentionedJid) {
  if (!mentionedJid) {
    await sock.sendMessage(from, { text: `Usa: *!giveallharem @usuario*` });
    return;
  }
  const data = loadGacha();
  const fromUser = getUser(data, sender, from);
  const toUser = getUser(data, mentionedJid, from);
  if (!fromUser.harem.length) {
    await sock.sendMessage(from, { text: `No tienes personajes en tu harem para regalar.` });
    return;
  }
  const count = fromUser.harem.length;
  toUser.harem.push(...fromUser.harem);
  fromUser.harem = [];
  fromUser.favorito = null;
  saveGacha(data);
  await sock.sendMessage(from, {
    text: `🎁 *@${sender.split("@")[0]}* le regaló *${count} personajes* a *@${mentionedJid.split("@")[0]}*`,
    mentions: [sender, mentionedJid],
  }, { quoted: msg });
}

function fmtTimeLeft(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  let out = "";
  if (h > 0) out += `${h}h `;
  if (m > 0) out += `${m}m `;
  if (s > 0 || out === "") out += `${s}s`;
  return out.trim();
}

async function cmdRobWaifu(sock, msg, sender, from, mentionedJid) {
  const data = loadGacha();
  const robber = getUser(data, sender, from);
  const now = Date.now();

  if (robber.lastRobAt && now < robber.lastRobAt) {
    await sock.sendMessage(from, {
      text: `⏳ Debes esperar *${fmtTimeLeft(robber.lastRobAt - now)}* para volver a robar.`,
    });
    return;
  }

  const targetId = mentionedJid;
  if (!targetId) {
    await sock.sendMessage(from, { text: `Usa: *!robwaifu @usuario*` });
    return;
  }
  if (targetId === sender) {
    await sock.sendMessage(from, { text: `❌ No puedes robarte a ti mismo.` });
    return;
  }

  const victim = getUser(data, targetId, from);
  if (!victim.harem.length) {
    await sock.sendMessage(from, {
      text: `❌ *@${targetId.split("@")[0]}* no tiene personajes que puedas robar.`,
      mentions: [targetId],
    });
    return;
  }

  if (!robber.robVictims) robber.robVictims = {};
  const lastRobOfVictim = robber.robVictims[targetId];
  if (lastRobOfVictim && now - lastRobOfVictim < ROB_VICTIM_COOLDOWN_MS) {
    await sock.sendMessage(from, {
      text: `❌ Ya le robaste a *@${targetId.split("@")[0]}* recientemente. Solo puedes robarle una vez cada 24 horas.`,
      mentions: [targetId],
    });
    return;
  }

  // Inicia el cooldown del ladrón sin importar el resultado
  robber.lastRobAt = now + ROB_COOLDOWN_MS;
  saveGacha(data);

  const success = Math.random() < ROB_SUCCESS_RATE;
  if (!success) {
    await sock.sendMessage(from, {
      text: `🛡️ El intento de robo falló. *@${targetId.split("@")[0]}* defendió su harem.`,
      mentions: [targetId],
    }, { quoted: msg });
    return;
  }

  // El personaje favorito está protegido
  const stealable = victim.harem.filter(h => h.name !== victim.favorito);
  if (!stealable.length) {
    await sock.sendMessage(from, {
      text: `🛡️ *@${targetId.split("@")[0]}* solo tiene a su favorito, no puedes robarlo.`,
      mentions: [targetId],
    });
    return;
  }

  const stolen = stealable[Math.floor(Math.random() * stealable.length)];
  const idx = victim.harem.findIndex(h => h.id === stolen.id);
  victim.harem.splice(idx, 1)[0];
  robber.harem.push(stolen);
  robber.robVictims[targetId] = now;
  saveGacha(data);

  await sock.sendMessage(from, {
    text:
      `🦹 *@${sender.split("@")[0]}* le robó a *${stolen.name}* del harem de *@${targetId.split("@")[0]}*!`,
    mentions: [sender, targetId],
  }, { quoted: msg });
}

module.exports = {
  cmdRollWaifu, cmdClaim, cmdHarem, cmdCharInfo, cmdDeleteWaifu,
  cmdGiveChar, cmdTrade, cmdSetFav, cmdDelFav, cmdVote,
  cmdWaifusTop, cmdFavTop, cmdSerieList, cmdSerieInfo, cmdGachaInfo,
  cmdSetClaimMsg, cmdDelClaimMsg, cmdHaremShop, cmdSell, cmdBuyChar,
  cmdRemoveSale, cmdCharImage, cmdGiveAllHarem, cmdRobWaifu,
  loadGacha, getUser,
};
