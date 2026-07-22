# 🤖 Fieren-bot - Bot de WhatsApp

Bot de WhatsApp desarrollado con [Baileys](https://github.com/WhiskeySockets/Baileys) y Node.js.

---

## 👨‍💻 Desarrolladores

| Dato | Info |
|------|------|
| Nombre | Emma y Jinn |
| WhatsApp | 5354185002 / 18096758983 / 573135180876 |

---

## 📋 Requisitos

- Node.js v18 o superior
- npm v8 o superior
- MySQL / MongoDB (según configuración)

---

## 🚀 Instalación

1. Clona el repositorio:
```bash
git clone https://github.com/tuusuario/fieren-bot.git
cd fieren-bot
```

2. Instala las dependencias:
```bash
npm install
```

3. Configura el archivo `settings.js` con tus datos.

4. Instala las dependencias:
```bash
npm install
```

5. Inicia el bot:
```bash
npm start
```

6. Escanea el código QR con WhatsApp.

---

## ⚙️ Configuración

Edita el archivo `settings.js` para personalizar el bot:

```js
BOT_PREFIX=!         // Prefijo de comandos en .env
bot.name: "Fieren-bot",  // Nombre del bot
database: { ... }     // Datos de tu base de datos
```

---

## 📂 Estructura del proyecto

```
fieren-bot/
├── index.js        # Punto de entrada
├── main.js         # Lógica principal y conexión
├── settings.js     # Configuración del bot
├── package.json    # Dependencias
└── README.md       # Documentación
```

---

## 🗂️ Comandos disponibles

| Comando | Descripción |
|---------|-------------|
| `!ping` | Verifica si el bot está activo |
| `!info` | Muestra información del bot |
| `!owner` | Muestra los owners del bot |
| `!myid` | Muestra el número que detecta el bot |
| `!help` / `!menu` / `!ayuda` | Muestra la lista de comandos |
| `!sticker` / `!s` | Crea un sticker desde imagen, video, GIF, sticker citado o URL. Soporta formas y efectos (`!sticker -list`) y personalizar pack/autor (`!sticker -c -blur Pack \| Autor`) |
| `!tagall` | Menciona a todos en el grupo |
| `!antilink <on\|off>` | Activa/desactiva el anti-link del grupo (solo admins). Expulsa a quien envíe enlaces, excepto admins/owner |
| `!estado` | Muestra el estado del bot |
| `!broadcast` / `!bc` | Envía un mensaje a los chats del bot (solo owners) |
| `!setprefix` | Indica cómo cambiar el prefijo (solo owners) |
| `!restart` / `!reiniciar` | Reinicia el bot (solo owners) |
| `!ia` / `!ai` / `!gemini` / `!preguntar` `<pregunta>` | Habla con una IA (Gemini vía apicausas.xyz). También funciona respondiendo a un mensaje |
| `!brat <texto>` | Crea un sticker estilo "brat" con el texto (o responde a un mensaje) |
| `!bratv <texto>` | Igual que `!brat` pero como video-sticker animado |
| `!emojimix <emoji1>+<emoji2>` | Combina 2 emojis en un sticker (ej: `!emojimix 👻+👀`) |
| `!qc <texto>` | Crea un sticker de "cita" con tu foto de perfil y el texto (máx. 30 caracteres) |
| `!get` / `!fetch` `<url>` | Realiza una solicitud GET a una URL y muestra o envía la respuesta |
| `!pfp` / `!getpic` | Muestra la foto de perfil de un usuario mencionado o citado |
| `!git` / `!gitclone` `<url o nombre>` | Busca un repositorio de GitHub y lo descarga en .zip |
| `!read` / `!readvo` / `!readviewonce` | Muestra el contenido de un mensaje "ver una vez" citado |
| `!translate` / `!trad` / `!traducir` `[idioma] <texto>` | Traduce un texto (o mensaje citado) al idioma indicado (por defecto: español) |
| `!tourl` | Convierte una imagen, video o sticker citado en un enlace descargable |
| `!say` / `!decir` `<texto>` | Repite un texto o media citado como si lo enviara el bot |
| `!toimg` / `!toimage` | Convierte un sticker citado en imagen (o video, si es animado) |
| `!hd` / `!enhance` / `!remini` | Mejora la calidad/resolución de una imagen |

---

## 🔌 Comandos de Socket (bot principal o sub-bot)

Estos comandos configuran el socket desde el que se ejecutan (el bot principal, o el sub-bot vinculado con `!code`). Solo puede usarlos el **owner del socket**: el owner global del bot, el propio número del socket, o quien se haya asignado con `!setowner`.

| Comando | Descripción |
|---------|-------------|
| `!code` / `!vincular` / `!serbot` `<número>` | Vincula un sub-bot por código de emparejamiento |
| `!qr` `<número>` | Vincula un sub-bot por código QR |
| `!unlink` / `!desvincular` `<número>` | Elimina un sub-bot vinculado |
| `!sublist` / `!listbots` | Ver los sub-bots activos y su uso de RAM |
| `!bots` / `!sockets` `<all>` | Ver los sockets activos (principal y subs) |
| `!self <on\|off>` | Hacer privado o público este socket |
| `!setname` `<corto>/<largo>` | Cambiar el nombre de este socket |
| `!setowner` `<mención/número/clear>` | Cambiar el owner de este socket |
| `!setprefix` `<valor/multi/noprefix/reset>` | Cambiar el prefijo de este socket |
| `!setstatus` `<texto>` | Cambiar el estado de WhatsApp de este socket |
| `!setusername` `<texto>` | Cambiar el nombre de perfil de WhatsApp |
| `!setlink` `<url>` | Cambiar el enlace mostrado de este socket |
| `!setcurrency` `<texto>` | Cambiar el nombre de moneda mostrado (solo etiqueta) |
| `!setchannel` `<enlace>` | Cambiar el canal de WhatsApp de este socket |
| `!setpfp` / `!seticon` (citando imagen) | Cambiar la foto de perfil de este socket |
| `!setbanner` (citando imagen) | Guardar una imagen de portada para este socket |
| `!join` `<enlace de grupo>` | Unir este socket a un grupo |
| `!leave` `<id de grupo>` | Sacar este socket de un grupo |
| `!logout` | Cerrar sesión de este socket (solo sub-bots) |
| `!reload` | Reconectar la sesión de este socket (solo sub-bots, conserva el modo código/QR) |

> Nota: `!setcurrency` solo guarda una etiqueta; el sistema de economía (`economy.js`) sigue calculando en "coins" internamente. `!setbanner` guarda la imagen localmente en `data/banners/`, ya que WhatsApp no expone una "portada" de perfil vía API.
> Nota: `!code`/`!qr` tienen un límite de *50 sub-bots* simultáneos y un cooldown de *80s* por usuario (no aplica a owners) para evitar abuso. El mensaje con el código/QR se autoelimina a los 60s.

---

## 🚂 Sub-bots automáticos en Railway (persistencia)

Railway borra el disco del contenedor en cada redeploy/reinicio. Sin un
almacenamiento persistente, tanto la sesión del bot principal como las de
todos los sub-bots (`auth_info`, `auth_info_subbots`) y los datos (`data/`:
economía, perfiles, gacha, ajustes, banners) se pierden y hay que volver a
vincular todo a mano.

Para que el bot principal y los sub-bots ya vinculados **reconecten solos**
después de cada redeploy (sin `!importsub` ni volver a escanear nada):

1. En el proyecto de Railway, ve a **Settings → Volumes** y crea un Volume
   (por ejemplo, montado en `/data`).
2. Añade estas variables de entorno para que todo se guarde dentro del Volume:

   ```
   DATA_DIR=/data/data
   AUTH_FOLDER=/data/auth_info
   SUB_BOTS_FOLDER=/data/auth_info_subbots
   ```

3. Redeploy. La primera vez tendrás que vincular el bot principal (y los
   sub-bots que quieras) como siempre; a partir de ahí, cada redeploy
   reconectará todo automáticamente al iniciar (`loadExistingSubBots`), sin
   necesitar el `.zip` de `!importsub`.

> ⚠️ Esto resuelve la **persistencia** de sesiones ya vinculadas. WhatsApp
> sigue bloqueando la generación de *códigos nuevos* de vinculación (`!code`)
> desde IPs de datacenter como las de Railway; para vincular un sub-bot por
> primera vez, hazlo desde una IP residencial (ej. Termux/tu celular) y
> luego usa `!importsub`, o simplemente vincula el bot principal ya en
> Railway antes de tener el Volume activo y a partir de ahí todo persiste.

---

## 📦 Dependencias

| Paquete | Uso |
|---------|-----|
| `@whiskeysockets/baileys` | Conexión con WhatsApp |
| `mysql2` | Base de datos MySQL |
| `mongoose` | Base de datos MongoDB |
| `nodemon` | Reinicio automático en desarrollo |
| `node-webpmux` | Escribe el nombre de pack/autor (EXIF) en los stickers |

---

## 🌐 APIs externas usadas por los stickers especiales

`!brat` / `!bratv` / `!emojimix` / `!qc` dependen de servicios públicos de terceros (no operados por este bot). Si alguno falla o está caído, el comando devolverá un error con el detalle técnico:

- `!brat` / `!bratv`: `skyzxu-brat.hf.space` (Hugging Face Space)
- `!emojimix`: API de Emoji Kitchen de Tenor/Google
- `!qc`: `bot.lyo.su` (generador de tarjetas de cita)
- `!translate` / `!trad` / `!traducir`: API pública de Google Translate
- `!tourl`: `uguu.se` (enlace temporal, ~3 horas)
- `!hd` / `!enhance` / `!remini`: `vectorink.io`
- `!git` / `!gitclone`: API de GitHub

---

## ⚠️ Aviso

Este bot es de uso personal. No me hago responsable del mal uso que se le pueda dar.

---

## 📄 Licencia

MIT © Emma y Jinn
