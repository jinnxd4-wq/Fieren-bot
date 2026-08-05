// ── economy.js ────────────────────────────────────────────────────────────────
// Sistema de economía para Fieren-bot
// Almacenamiento: JSON local en ./data/economy.json

const fs   = require("fs");
const path = require("path");
const settings = require("./settings");

// Usa settings.storage.dataDir (env DATA_DIR) para poder apuntar a un
// Volume persistente en Railway y que la economía no se borre en cada redeploy.
const rawDataDir = settings.storage.dataDir;
const DATA_DIR = path.isAbsolute(rawDataDir) ? rawDataDir : path.join(process.cwd(), rawDataDir);
const DATA_PATH = path.join(DATA_DIR, "economy.json");

// ── Helpers de DB ─────────────────────────────────────────────────────────────

function loadDB() {
  if (!fs.existsSync(path.dirname(DATA_PATH))) {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  }
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

function getUser(db, userId) {
  if (!db[userId]) {
    db[userId] = {
      wallet:    0,
      bank:      0,
      lastDaily: 0,
      lastWork:  0,
      lastCrime: 0,
      lastSlut:  0,
      lastSteal: 0,
      streak:        0,
      lastMonthly:   0,
      monthlyStreak: 0,
      lastCoffer:    0,
      lastAdventure: 0,
      lastDungeon:   0,
      lastHunt:      0,
      lastFish:      0,
      lastMine:      0,
      lastInvoke:    0,
      health:    100,
      maxHealth: 100,
    };
  }
  return db[userId];
}

function fmt(n) {
  return Number(n).toLocaleString("es");
}

function cooldownLeft(last, seconds) {
  const diff = Math.floor((Date.now() - last) / 1000);
  return diff < seconds ? seconds - diff : 0;
}

function fmtTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Comandos ──────────────────────────────────────────────────────────────────

async function cmdBalance(sock, from, sender, mentionedJid) {
  const db   = loadDB();
  const target = mentionedJid || sender;
  const user = getUser(db, target);
  saveDB(db);

  const tag = `@${target.split("@")[0]}`;
  await sock.sendMessage(from, {
    text:
      `💰 *Balance de ${tag}*\n\n` +
      `👛 Billetera: *${fmt(user.wallet)} coins*\n` +
      `🏦 Banco:     *${fmt(user.bank)} coins*\n` +
      `📊 Total:     *${fmt(user.wallet + user.bank)} coins*`,
    mentions: [target],
  });
}

async function cmdDaily(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastDaily, 86400); // 24h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ Ya reclamaste tu daily. Vuelve en *${fmtTime(cd)}*.`,
    });
  }

  // Racha: si reclama dentro de las 48h siguientes a la última vez, suma racha; si no, se reinicia
  const withinStreak = user.lastDaily && (Date.now() - user.lastDaily) <= 172800000;
  user.streak = withinStreak ? (user.streak || 0) + 1 : 1;

  const base   = Math.floor(Math.random() * 500) + 300; // 300-800
  const bonus  = Math.min((user.streak - 1) * 25, 500); // +25 por día de racha, tope 500
  const reward = base + bonus;
  user.wallet   += reward;
  user.lastDaily = Date.now();
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🎁 *Daily reclamado!*\nRecibiste *+${fmt(reward)} coins* (base ${fmt(base)} + racha ${fmt(bonus)}).\n` +
      `🔥 Racha: *${user.streak} día${user.streak === 1 ? "" : "s"}*\n` +
      `💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdWork(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastWork, 3600); // 1h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ Ya trabajaste. Descansa *${fmtTime(cd)}* más.`,
    });
  }

  const jobs = [
    "programador", "carpintero", "cocinero", "médico",
    "electricista", "piloto", "diseñador", "mecánico",
  ];
  const job    = jobs[Math.floor(Math.random() * jobs.length)];
  const reward = Math.floor(Math.random() * 200) + 100; // 100-300
  user.wallet  += reward;
  user.lastWork = Date.now();
  saveDB(db);

  await sock.sendMessage(from, {
    text: `💼 Trabajaste como *${job}* y ganaste *+${fmt(reward)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdCrime(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastCrime, 7200); // 2h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ La policía te está buscando. Espera *${fmtTime(cd)}*.`,
    });
  }

  const success = Math.random() < 0.65; // 65% éxito
  user.lastCrime = Date.now();

  const crimes = [
    "robaste un banco", "hackeaste una empresa", "vendiste mercancía ilegal",
    "falsificaste billetes", "robaste un auto", "asaltaste una tienda",
  ];
  const fails = [
    "te atrapó la policía", "te delataron", "fallaste el plan",
    "te resbalaste huyendo", "el guardia te vio",
  ];

  if (success) {
    const reward = Math.floor(Math.random() * 600) + 200;
    user.wallet += reward;
    saveDB(db);
    const crime = crimes[Math.floor(Math.random() * crimes.length)];
    await sock.sendMessage(from, {
      text: `🦹 *Crimen exitoso!*\n${crime} y ganaste *+${fmt(reward)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  } else {
    const fine = Math.min(Math.floor(Math.random() * 300) + 100, user.wallet);
    user.wallet = Math.max(0, user.wallet - fine);
    saveDB(db);
    const fail = fails[Math.floor(Math.random() * fails.length)];
    await sock.sendMessage(from, {
      text: `🚔 *Fallaste!*\n${fail} y perdiste *-${fmt(fine)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }
}

async function cmdSlut(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastSlut, 3600); // 1h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ Necesitas descansar. Vuelve en *${fmtTime(cd)}*.`,
    });
  }

  const success = Math.random() < 0.75; // 75% éxito
  user.lastSlut  = Date.now();

  if (success) {
    const reward = Math.floor(Math.random() * 400) + 150;
    user.wallet += reward;
    saveDB(db);
    await sock.sendMessage(from, {
      text: `💋 Tuviste una *noche productiva* y ganaste *+${fmt(reward)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  } else {
    const fine = Math.min(Math.floor(Math.random() * 200) + 50, user.wallet);
    user.wallet = Math.max(0, user.wallet - fine);
    saveDB(db);
    await sock.sendMessage(from, {
      text: `😬 No fue tu noche... perdiste *-${fmt(fine)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }
}

async function cmdMonthly(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastMonthly, 2592000); // 30 días

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ Ya reclamaste tu recompensa mensual. Vuelve en *${fmtTime(cd)}*.`,
    });
  }

  const withinStreak = user.lastMonthly && (Date.now() - user.lastMonthly) <= 2592000000 * 2;
  user.monthlyStreak = withinStreak ? (user.monthlyStreak || 0) + 1 : 1;

  const base   = Math.floor(Math.random() * 4000) + 6000; // 6000-10000
  const bonus  = Math.min((user.monthlyStreak - 1) * 1000, 5000);
  const reward = base + bonus;
  user.wallet    += reward;
  user.lastMonthly = Date.now();
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🗓️ *Recompensa mensual reclamada!*\nRecibiste *+${fmt(reward)} coins* (base ${fmt(base)} + racha ${fmt(bonus)}).\n` +
      `🔥 Meses seguidos: *${user.monthlyStreak}*\n` +
      `💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdCoffer(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastCoffer, 43200); // 12h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ Tu cofre aún no se ha rellenado. Vuelve en *${fmtTime(cd)}*.`,
    });
  }

  const special = Math.random() < 0.1; // 10% cofre especial
  const reward  = special
    ? Math.floor(Math.random() * 2000) + 1500
    : Math.floor(Math.random() * 400) + 150;

  user.wallet    += reward;
  user.lastCoffer = Date.now();
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `${special ? "✨ *¡Cofre especial!*" : "📦 *Cofre reclamado!*"}\n` +
      `Recibiste *+${fmt(reward)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdCasino(sock, from, sender, amountArg) {
  const amount = parseInt(amountArg);
  if (!amountArg || isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: `Uso: *!casino <cantidad>*` });
  }

  const db   = loadDB();
  const user = getUser(db, sender);
  if (amount > user.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }

  const symbols = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
  const slots   = [0, 0, 0].map(() => symbols[Math.floor(Math.random() * symbols.length)]);
  const allEqual = slots[0] === slots[1] && slots[1] === slots[2];
  const twoEqual = slots[0] === slots[1] || slots[1] === slots[2] || slots[0] === slots[2];

  let multiplier = 0;
  if (allEqual) multiplier = slots[0] === "💎" ? 10 : slots[0] === "7️⃣" ? 8 : 5;
  else if (twoEqual) multiplier = 1.5;

  const won = multiplier > 0;
  let netChange = 0;
  if (won) {
    netChange = Math.floor(amount * multiplier) - amount;
    user.wallet += netChange;
  } else {
    netChange = -amount;
    user.wallet -= amount;
  }

  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🎰 *[ ${slots.join(" | ")} ]*\n\n` +
      (won
        ? `✅ *¡Ganaste +${fmt(netChange)} coins!* (x${multiplier})`
        : `❌ *Perdiste -${fmt(amount)} coins.*`) +
      `\n💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdPPT(sock, from, sender, choiceArg, amountArg) {
  const opciones = { piedra: "🪨", papel: "📄", tijera: "✂️" };
  const choice = (choiceArg || "").toLowerCase();
  if (!opciones[choice]) {
    return sock.sendMessage(from, { text: `Uso: *!ppt <piedra/papel/tijera> [apuesta]*` });
  }

  const db   = loadDB();
  const user = getUser(db, sender);
  const amount = parseInt(amountArg) || 0;
  if (amount > 0 && amount > user.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins para apostar.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }

  const keys = Object.keys(opciones);
  const botChoice = keys[Math.floor(Math.random() * keys.length)];
  const beats = { piedra: "tijera", papel: "piedra", tijera: "papel" };

  let resultText, won = null;
  if (choice === botChoice) {
    resultText = "🤝 *¡Empate!*";
  } else if (beats[choice] === botChoice) {
    resultText = "✅ *¡Ganaste!*";
    won = true;
  } else {
    resultText = "❌ *Perdiste.*";
    won = false;
  }

  if (amount > 0 && won !== null) {
    user.wallet += won ? amount : -amount;
    saveDB(db);
  }

  await sock.sendMessage(from, {
    text:
      `${opciones[choice]} vs ${opciones[botChoice]}\n\n${resultText}` +
      (amount > 0 ? (won === null ? "" : `\n${won ? "+" : "-"}${fmt(amount)} coins\n💰 Billetera: *${fmt(user.wallet)} coins*`) : ""),
  });
}

async function cmdDeposit(sock, from, sender, amountArg) {
  const db   = loadDB();
  const user = getUser(db, sender);

  if (!amountArg) {
    return sock.sendMessage(from, { text: `Uso: *!deposit [cantidad | all]*` });
  }

  let amount;
  if (amountArg.toLowerCase() === "all") {
    amount = user.wallet;
  } else {
    amount = parseInt(amountArg);
  }

  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: "❌ Cantidad inválida." });
  }
  if (amount > user.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }

  user.wallet -= amount;
  user.bank   += amount;
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🏦 Depositaste *+${fmt(amount)} coins* al banco.\n` +
      `👛 Billetera: *${fmt(user.wallet)} coins*\n` +
      `🏦 Banco:     *${fmt(user.bank)} coins*`,
  });
}

async function cmdWithdraw(sock, from, sender, amountArg) {
  const db   = loadDB();
  const user = getUser(db, sender);

  if (!amountArg) {
    return sock.sendMessage(from, { text: `Uso: *!withdraw [cantidad | all]*` });
  }

  let amount;
  if (amountArg.toLowerCase() === "all") {
    amount = user.bank;
  } else {
    amount = parseInt(amountArg);
  }

  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: "❌ Cantidad inválida." });
  }
  if (amount > user.bank) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins en el banco.\n🏦 Banco: *${fmt(user.bank)} coins*`,
    });
  }

  user.bank   -= amount;
  user.wallet += amount;
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🏦 Retiraste *${fmt(amount)} coins* del banco.\n` +
      `👛 Billetera: *${fmt(user.wallet)} coins*\n` +
      `🏦 Banco:     *${fmt(user.bank)} coins*`,
  });
}

async function cmdGiveCoins(sock, from, sender, mentionedJid, amountArg) {
  if (!mentionedJid) {
    return sock.sendMessage(from, { text: `Uso: *!pay @usuario [cantidad]*` });
  }
  if (mentionedJid === sender) {
    return sock.sendMessage(from, { text: "❌ No puedes darte coins a ti mismo." });
  }

  const amount = parseInt(amountArg);
  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: "❌ Cantidad inválida." });
  }

  const db     = loadDB();
  const giver  = getUser(db, sender);
  const receiver = getUser(db, mentionedJid);

  if (amount > giver.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins.\n💰 Billetera: *${fmt(giver.wallet)} coins*`,
    });
  }

  giver.wallet    -= amount;
  receiver.wallet += amount;
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `💸 @${sender.split("@")[0]} le dio *${fmt(amount)} coins* a @${mentionedJid.split("@")[0]}.\n` +
      `💰 Tu billetera: *${fmt(giver.wallet)} coins*`,
    mentions: [sender, mentionedJid],
  });
}

async function cmdCoinFlip(sock, from, sender, amountArg, sideArg) {
  if (!amountArg || !sideArg) {
    return sock.sendMessage(from, { text: `Uso: *!coinflip [cantidad] [cara/cruz]*` });
  }

  const side = sideArg.toLowerCase();
  if (!["cara", "cruz"].includes(side)) {
    return sock.sendMessage(from, { text: "❌ Elige *cara* o *cruz*." });
  }

  const amount = parseInt(amountArg);
  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: "❌ Cantidad inválida." });
  }

  const db   = loadDB();
  const user = getUser(db, sender);

  if (amount > user.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }

  const result = Math.random() < 0.5 ? "cara" : "cruz";
  const won    = result === side;
  const coin   = result === "cara" ? "🪙 CARA" : "🔘 CRUZ";

  if (won) {
    user.wallet += amount;
  } else {
    user.wallet -= amount;
  }
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🪙 *Lanzando moneda...*\n\n` +
      `Resultado: *${coin}*\n` +
      (won
        ? `✅ *Ganaste +${fmt(amount)} coins!*`
        : `❌ *Perdiste -${fmt(amount)} coins.*`) +
      `\n💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdRoulette(sock, from, sender, colorArg, amountArg) {
  if (!colorArg || !amountArg) {
    return sock.sendMessage(from, { text: `Uso: *!roulette [red/black] [cantidad]*` });
  }

  const color = colorArg.toLowerCase();
  if (!["red", "black", "rojo", "negro"].includes(color)) {
    return sock.sendMessage(from, { text: "❌ Elige *red/rojo* o *black/negro*." });
  }

  const amount = parseInt(amountArg);
  if (isNaN(amount) || amount <= 0) {
    return sock.sendMessage(from, { text: "❌ Cantidad inválida." });
  }

  const db   = loadDB();
  const user = getUser(db, sender);

  if (amount > user.wallet) {
    return sock.sendMessage(from, {
      text: `❌ No tienes suficientes coins.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }

  const number = Math.floor(Math.random() * 37); // 0-36
  const resultColor = number === 0 ? "green" : number % 2 === 0 ? "black" : "red";
  const betColor    = ["red", "rojo"].includes(color) ? "red" : "black";
  const won         = resultColor === betColor;
  const emoji       = resultColor === "red" ? "🔴" : resultColor === "black" ? "⚫" : "🟢";

  if (won) {
    user.wallet += amount;
  } else {
    user.wallet -= amount;
  }
  saveDB(db);

  await sock.sendMessage(from, {
    text:
      `🎰 *Ruleta girando...*\n\n` +
      `Número: *${number}* ${emoji}\n` +
      (won
        ? `✅ *Ganaste +${fmt(amount)} coins!*`
        : `❌ *Perdiste -${fmt(amount)} coins.*`) +
      `\n💰 Billetera: *${fmt(user.wallet)} coins*`,
  });
}

async function cmdSteal(sock, from, sender, mentionedJid) {
  if (!mentionedJid) {
    return sock.sendMessage(from, { text: `Uso: *!steal @usuario*` });
  }
  if (mentionedJid === sender) {
    return sock.sendMessage(from, { text: "❌ No puedes robarte a ti mismo." });
  }

  const db     = loadDB();
  const thief  = getUser(db, sender);
  const cd     = cooldownLeft(thief.lastSteal, 3600); // 1h

  if (cd > 0) {
    return sock.sendMessage(from, {
      text: `⏳ La policía te vigila. Espera *${fmtTime(cd)}*.`,
    });
  }

  const victim = getUser(db, mentionedJid);
  thief.lastSteal = Date.now();

  if (victim.wallet <= 0) {
    saveDB(db);
    return sock.sendMessage(from, {
      text: `😅 @${mentionedJid.split("@")[0]} no tiene coins en la billetera.`,
      mentions: [mentionedJid],
    });
  }

  const success = Math.random() < 0.45; // 45% éxito

  if (success) {
    const stolen = Math.floor(victim.wallet * (Math.random() * 0.3 + 0.1)); // 10-40%
    victim.wallet -= stolen;
    thief.wallet  += stolen;
    saveDB(db);
    await sock.sendMessage(from, {
      text:
        `🦹 *Robo exitoso!*\nLe robaste *${fmt(stolen)} coins* a @${mentionedJid.split("@")[0]}.\n` +
        `💰 Billetera: *${fmt(thief.wallet)} coins*`,
      mentions: [mentionedJid],
    });
  } else {
    const fine = Math.min(Math.floor(Math.random() * 300) + 100, thief.wallet);
    thief.wallet = Math.max(0, thief.wallet - fine);
    saveDB(db);
    await sock.sendMessage(from, {
      text:
        `🚔 *Te atraparon robando!*\nPagaste una multa de *${fmt(fine)} coins*.\n` +
        `💰 Billetera: *${fmt(thief.wallet)} coins*`,
      mentions: [mentionedJid],
    });
  }
}

// ── Sistema de salud para minijuegos de exploración ─────────────────────────
function healthBar(health, max = 100, length = 10) {
  const filled = Math.max(0, Math.round((health / max) * length));
  return "❤️".repeat(Math.min(filled, length)) + "🖤".repeat(Math.max(0, length - filled));
}

// Genérico para adventure/dungeon/hunt/fish/mine: requiere salud mínima,
// tiene probabilidad de éxito y, si falla, resta salud (y a veces coins).
async function runExploration(sock, from, sender, {
  field, cooldown, minHealth, healthCost, successRate,
  rewardMin, rewardMax, failHealthLoss, failCoinLoss,
  emoji, verbBig, successLines, failLines,
}) {
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user[field], cooldown);

  if (cd > 0) {
    return sock.sendMessage(from, { text: `⏳ Debes esperar *${fmtTime(cd)}* antes de volver a *${verbBig}*.` });
  }
  if (user.health < minHealth) {
    return sock.sendMessage(from, {
      text: `💔 Te quedan muy pocas vidas (*${user.health}/${user.maxHealth}*). Usa *!heal* para recuperarte antes de *${verbBig}*.`,
    });
  }

  user[field] = Date.now();
  const success = Math.random() < successRate;

  if (success) {
    const reward = Math.floor(Math.random() * (rewardMax - rewardMin + 1)) + rewardMin;
    user.wallet += reward;
    user.health = Math.max(0, user.health - healthCost);
    saveDB(db);
    const line = successLines[Math.floor(Math.random() * successLines.length)];
    await sock.sendMessage(from, {
      text:
        `${emoji} *¡Éxito!*\n${line}\nGanaste *+${fmt(reward)} coins*.\n` +
        `💰 Billetera: *${fmt(user.wallet)} coins*\n❤️ Salud: *${user.health}/${user.maxHealth}*`,
    });
  } else {
    const hpLoss = failHealthLoss;
    const coinLoss = Math.min(failCoinLoss, user.wallet);
    user.health = Math.max(0, user.health - hpLoss);
    user.wallet = Math.max(0, user.wallet - coinLoss);
    saveDB(db);
    const line = failLines[Math.floor(Math.random() * failLines.length)];
    await sock.sendMessage(from, {
      text:
        `💥 *¡Fallaste!*\n${line}\n` +
        (coinLoss > 0 ? `Perdiste *-${fmt(coinLoss)} coins* y ` : "") +
        `*-${hpLoss} de salud*.\n` +
        `💰 Billetera: *${fmt(user.wallet)} coins*\n❤️ Salud: *${user.health}/${user.maxHealth}*`,
    });
  }
}

async function cmdAdventure(sock, from, sender) {
  return runExploration(sock, from, sender, {
    field: "lastAdventure", cooldown: 1800, minHealth: 15, healthCost: 5,
    successRate: 0.7, rewardMin: 200, rewardMax: 600,
    failHealthLoss: 12, failCoinLoss: 0,
    emoji: "🗺️", verbBig: "ir de aventura",
    successLines: [
      "Encontraste un cofre escondido en el bosque.",
      "Ayudaste a un aldeano y te recompensó.",
      "Descubriste ruinas antiguas con tesoros.",
    ],
    failLines: [
      "Te perdiste en el bosque y volviste con las manos vacías.",
      "Una trampa te tomó por sorpresa.",
      "Unos bandidos te emboscaron en el camino.",
    ],
  });
}

async function cmdDungeon(sock, from, sender) {
  return runExploration(sock, from, sender, {
    field: "lastDungeon", cooldown: 3600, minHealth: 30, healthCost: 10,
    successRate: 0.55, rewardMin: 500, rewardMax: 1400,
    failHealthLoss: 25, failCoinLoss: 100,
    emoji: "🏰", verbBig: "explorar mazmorras",
    successLines: [
      "Derrotaste al jefe de la mazmorra y saqueaste su tesoro.",
      "Sobreviviste a las trampas y encontraste oro antiguo.",
      "Limpiaste la mazmorra de monstruos menores.",
    ],
    failLines: [
      "Un monstruo te hirió gravemente y tuviste que huir.",
      "Caíste en una trampa mortal.",
      "El jefe de la mazmorra te venció.",
    ],
  });
}

async function cmdHunt(sock, from, sender) {
  return runExploration(sock, from, sender, {
    field: "lastHunt", cooldown: 1800, minHealth: 15, healthCost: 6,
    successRate: 0.7, rewardMin: 150, rewardMax: 450,
    failHealthLoss: 10, failCoinLoss: 0,
    emoji: "🏹", verbBig: "cazar",
    successLines: [
      "Cazaste un venado y vendiste su carne.",
      "Atrapaste un jabalí salvaje.",
      "Capturaste un ave exótica muy valiosa.",
    ],
    failLines: [
      "El animal escapó antes de que pudieras atacar.",
      "Te atacó la presa y saliste herido.",
      "No encontraste ningún rastro de animales.",
    ],
  });
}

async function cmdFish(sock, from, sender) {
  return runExploration(sock, from, sender, {
    field: "lastFish", cooldown: 900, minHealth: 5, healthCost: 2,
    successRate: 0.8, rewardMin: 80, rewardMax: 300,
    failHealthLoss: 3, failCoinLoss: 0,
    emoji: "🎣", verbBig: "pescar",
    successLines: [
      "Pescaste un pez enorme y lo vendiste bien.",
      "Sacaste varios peces de buena calidad.",
      "Encontraste un cofre hundido mientras pescabas.",
    ],
    failLines: [
      "El pez se escapó del anzuelo.",
      "Pasaste horas sin pescar nada.",
      "Se te rompió la caña de pescar.",
    ],
  });
}

async function cmdMine(sock, from, sender) {
  return runExploration(sock, from, sender, {
    field: "lastMine", cooldown: 2400, minHealth: 25, healthCost: 8,
    successRate: 0.65, rewardMin: 300, rewardMax: 900,
    failHealthLoss: 15, failCoinLoss: 0,
    emoji: "⛏️", verbBig: "minar",
    successLines: [
      "Encontraste una veta de oro en la mina.",
      "Extrajiste varias gemas valiosas.",
      "Hallaste un cargamento de minerales raros.",
    ],
    failLines: [
      "Un derrumbe te obligó a salir corriendo.",
      "Tu pico se rompió a mitad de la excavación.",
      "Excavaste durante horas sin encontrar nada útil.",
    ],
  });
}

async function cmdInvoke(sock, from, sender) {
  const cost = 100;
  const db   = loadDB();
  const user = getUser(db, sender);
  const cd   = cooldownLeft(user.lastInvoke, 5400); // 1.5h

  if (cd > 0) {
    return sock.sendMessage(from, { text: `⏳ El ritual aún se está enfriando. Espera *${fmtTime(cd)}*.` });
  }
  if (user.wallet < cost) {
    return sock.sendMessage(from, { text: `❌ Necesitas al menos *${fmt(cost)} coins* para hacer el ritual.` });
  }

  user.lastInvoke = Date.now();
  user.wallet -= cost;
  const success = Math.random() < 0.5;

  if (success) {
    const reward = Math.floor(Math.random() * 1500) + 500;
    user.wallet += reward;
    saveDB(db);
    await sock.sendMessage(from, {
      text:
        `🕯️ *¡El ritual funcionó!*\nUna entidad misteriosa te recompensó con *+${fmt(reward)} coins*.\n` +
        `💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  } else {
    saveDB(db);
    await sock.sendMessage(from, {
      text:
        `🕯️ *El ritual falló...*\nPerdiste los *${fmt(cost)} coins* que ofrendaste.\n` +
        `💰 Billetera: *${fmt(user.wallet)} coins*`,
    });
  }
}

async function cmdHeal(sock, from, sender, mentionedJid) {
  const target = mentionedJid || sender;
  const costPerHp = 5;

  const db = loadDB();
  const targetUser = getUser(db, target);
  const payer = getUser(db, sender);

  if (targetUser.health >= targetUser.maxHealth) {
    return sock.sendMessage(from, {
      text: target === sender ? "❤️ Ya tienes la salud al máximo." : "❤️ Esa persona ya tiene la salud al máximo.",
    });
  }

  const missing = targetUser.maxHealth - targetUser.health;
  const maxAffordable = Math.floor(payer.wallet / costPerHp);
  const healAmount = Math.min(missing, maxAffordable);

  if (healAmount <= 0) {
    return sock.sendMessage(from, { text: `❌ No tienes suficientes coins (*${costPerHp} coins* por punto de salud).` });
  }

  const cost = healAmount * costPerHp;
  payer.wallet -= cost;
  targetUser.health += healAmount;
  saveDB(db);

  const tag = `@${target.split("@")[0]}`;
  await sock.sendMessage(from, {
    text:
      `💊 ${target === sender ? "Te curaste" : `Curaste a ${tag}`} *+${healAmount} de salud* por *${fmt(cost)} coins*.\n` +
      `${healthBar(targetUser.health, targetUser.maxHealth)} *${targetUser.health}/${targetUser.maxHealth}*`,
    mentions: target === sender ? [] : [target],
  });
}

// ── Minijuego de matemáticas ─────────────────────────────────────────────────
// Respuestas pendientes en memoria: pendingMath[`${from}:${sender}`] = { answer, reward, timer }
const pendingMath = {};

const MATH_LIMITS   = { facil: 10, medio: 50, dificil: 90, imposible: 100, imposible2: 160 };
const MATH_REWARDS  = { facil: [500, 1000], medio: [1000, 2000], dificil: [2000, 3500], imposible: [3500, 4800], imposible2: [5000, 6500] };

function buildMathProblem(difficulty) {
  const maxLimit = MATH_LIMITS[difficulty] || 30;
  const num1 = Math.floor(Math.random() * maxLimit) + 1;
  const num2 = Math.floor(Math.random() * maxLimit) + 1;
  const operador = ["+", "-", "*"][Math.floor(Math.random() * 3)]; // se evita / para no dar decimales
  let resultado;
  switch (operador) {
    case "+": resultado = num1 + num2; break;
    case "-": resultado = num1 - num2; break;
    case "*": resultado = num1 * num2; break;
  }
  return { texto: `${num1} ${operador} ${num2}`, resultado };
}

async function cmdMath(sock, from, sender, args) {
  const difficulty = (args[0] || "facil").toLowerCase();
  if (!MATH_LIMITS[difficulty]) {
    return sock.sendMessage(from, {
      text: `Uso: *!math <facil/medio/dificil/imposible/imposible2>*`,
    });
  }

  const key = `${from}:${sender}`;
  if (pendingMath[key]) {
    return sock.sendMessage(from, { text: `⚠️ Ya tienes un problema matemático pendiente. ¡Respóndelo primero!` });
  }

  const { texto, resultado } = buildMathProblem(difficulty);
  const [min, max] = MATH_REWARDS[difficulty];
  const reward = Math.floor(Math.random() * (max - min + 1)) + min;

  pendingMath[key] = { answer: resultado, reward };
  const timer = setTimeout(() => {
    if (pendingMath[key]) {
      delete pendingMath[key];
      sock.sendMessage(from, { text: `⌛ Se acabó el tiempo para responder *${texto}*.` }).catch(() => {});
    }
  }, 30000);
  pendingMath[key].timer = timer;

  await sock.sendMessage(from, {
    text: `🧮 *Resuelve:* \`${texto}\`\nTienes *30 segundos* para responder con el resultado.`,
  });
}

// Se ejecuta en cada mensaje normal (no comando) para revisar si responde un problema de matemáticas pendiente
async function checkMathAnswer(sock, msg, sender, from, body) {
  const key = `${from}:${sender}`;
  const pending = pendingMath[key];
  if (!pending) return false;

  const trimmed = (body || "").trim();
  if (!/^-?\d+$/.test(trimmed)) return false;

  clearTimeout(pending.timer);
  delete pendingMath[key];

  if (parseInt(trimmed, 10) === pending.answer) {
    const db = loadDB();
    const user = getUser(db, sender);
    user.wallet += pending.reward;
    saveDB(db);
    await sock.sendMessage(from, {
      text: `✅ *¡Correcto!* Ganaste *+${fmt(pending.reward)} coins*.\n💰 Billetera: *${fmt(user.wallet)} coins*`,
    }, { quoted: msg });
  } else {
    await sock.sendMessage(from, {
      text: `❌ Respuesta incorrecta. El resultado era *${pending.answer}*.`,
    }, { quoted: msg });
  }
  return true;
}

async function cmdEconomyBoard(sock, from, page = 1) {
  const db      = loadDB();
  const entries = Object.entries(db)
    .map(([id, u]) => ({ id, total: (u.wallet || 0) + (u.bank || 0) }))
    .sort((a, b) => b.total - a.total);

  const perPage = 10;
  const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
  const pg = Math.min(Math.max(1, page), totalPages);
  const slice = entries.slice((pg - 1) * perPage, pg * perPage);

  if (!slice.length) {
    return sock.sendMessage(from, { text: "📊 No hay datos de economía aún." });
  }

  const medals = ["🥇", "🥈", "🥉"];
  const lines  = slice.map((e, i) => {
    const rank = (pg - 1) * perPage + i + 1;
    const medal = medals[rank - 1] || `${rank}.`;
    return `${medal} @${e.id.split("@")[0]} — *${fmt(e.total)} coins*`;
  });

  await sock.sendMessage(from, {
    text:
      `🏆 *Ranking de Economía* (Página ${pg}/${totalPages})\n\n` +
      lines.join("\n"),
    mentions: slice.map(e => e.id),
  });
}

async function cmdEconomyInfo(sock, from, sender) {
  const db   = loadDB();
  const user = getUser(db, sender);
  saveDB(db);

  const cdDaily     = cooldownLeft(user.lastDaily,     86400);
  const cdWork      = cooldownLeft(user.lastWork,      3600);
  const cdCrime     = cooldownLeft(user.lastCrime,     7200);
  const cdSlut      = cooldownLeft(user.lastSlut,      3600);
  const cdSteal     = cooldownLeft(user.lastSteal,     3600);
  const cdMonthly   = cooldownLeft(user.lastMonthly,   2592000);
  const cdCoffer    = cooldownLeft(user.lastCoffer,    43200);
  const cdAdventure = cooldownLeft(user.lastAdventure, 1800);
  const cdDungeon    = cooldownLeft(user.lastDungeon,   3600);
  const cdHunt       = cooldownLeft(user.lastHunt,      1800);
  const cdFish       = cooldownLeft(user.lastFish,      900);
  const cdMine       = cooldownLeft(user.lastMine,      2400);
  const cdInvoke     = cooldownLeft(user.lastInvoke,    5400);

  const cd = (v) => (v > 0 ? fmtTime(v) : "✅ Disponible");

  await sock.sendMessage(from, {
    text:
      `📊 *Info de Economía*\n\n` +
      `👛 Billetera: *${fmt(user.wallet)} coins*\n` +
      `🏦 Banco:     *${fmt(user.bank)} coins*\n` +
      `📈 Total:     *${fmt(user.wallet + user.bank)} coins*\n` +
      `${healthBar(user.health, user.maxHealth)} Salud: *${user.health}/${user.maxHealth}*\n\n` +
      `⏳ *Cooldowns:*\n` +
      `• Daily:     ${cd(cdDaily)}\n` +
      `• Monthly:   ${cd(cdMonthly)}\n` +
      `• Work:      ${cd(cdWork)}\n` +
      `• Crime:     ${cd(cdCrime)}\n` +
      `• Slut:      ${cd(cdSlut)}\n` +
      `• Steal:     ${cd(cdSteal)}\n` +
      `• Cofre:     ${cd(cdCoffer)}\n` +
      `• Aventura:  ${cd(cdAdventure)}\n` +
      `• Mazmorra:  ${cd(cdDungeon)}\n` +
      `• Cazar:     ${cd(cdHunt)}\n` +
      `• Pescar:    ${cd(cdFish)}\n` +
      `• Minar:     ${cd(cdMine)}\n` +
      `• Ritual:    ${cd(cdInvoke)}`,
  });
}

module.exports = {
  cmdBalance,
  cmdDaily,
  cmdWork,
  cmdCrime,
  cmdSlut,
  cmdDeposit,
  cmdWithdraw,
  cmdGiveCoins,
  cmdCoinFlip,
  cmdRoulette,
  cmdSteal,
  cmdEconomyBoard,
  cmdEconomyInfo,
  // Nuevos minijuegos
  cmdMonthly,
  cmdCoffer,
  cmdCasino,
  cmdPPT,
  cmdAdventure,
  cmdDungeon,
  cmdHunt,
  cmdFish,
  cmdMine,
  cmdInvoke,
  cmdHeal,
  cmdMath,
  checkMathAnswer,
  // Internos usados por gacha y profiles
  loadEconomy,
  getEcoUser,
  saveEconomy,
};

// ── Exports adicionales para uso interno (gacha, profiles) ────────────────────
// BUG FIX: gacha.js y profiles.js llaman economy.loadEconomy() y economy.getEcoUser()
// pero economy.js no los exportaba con esos nombres
function loadEconomy() {
  return loadDB();
}

function getEcoUser(db, userId) {
  return getUser(db, userId);
}

function saveEconomy(db) {
  saveDB(db);
}
