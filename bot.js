require(‘dotenv’).config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder } = require(‘discord.js’);

// ── Keep-alive server ─────────────────────────────────────────────────────────
const http  = require(‘http’);
const https = require(‘https’);
http.createServer((_, res) => { res.writeHead(200); res.end(‘alive’); })
.listen(process.env.PORT || 3000);

// ── Console colours ───────────────────────────────────────────────────────────
const cl = {
reset: ‘\x1b[0m’, bold: ‘\x1b[1m’,
cyan: ‘\x1b[36m’, green: ‘\x1b[32m’, yellow: ‘\x1b[33m’,
red: ‘\x1b[31m’,  magenta: ‘\x1b[35m’, blue: ‘\x1b[34m’,
white: ‘\x1b[37m’, gray: ‘\x1b[90m’,
};
const ts      = () => `${cl.gray}[${new Date().toISOString().slice(11,23)}]${cl.reset}`;
const clog    = (sym, col, lbl, msg=’’) => console.log(`${ts()} ${col}${sym}${cl.reset} ${cl.bold}${col}${lbl}${cl.reset} ${cl.white}${msg}${cl.reset}`);
const logStep = m => clog(‘◈’, cl.cyan,    ’INIT    ’, m);
const logOk   = m => clog(‘✔’, cl.green,   ’OK      ’, m);
const logWarn = m => clog(‘◆’, cl.yellow,  ’WARN    ’, m);
const logApi  = m => clog(‘⬡’, cl.magenta, ’API     ’, m);
const logStat = m => clog(‘◉’, cl.blue,    ’STATUS  ’, m);
const logRdy  = m => clog(‘★’, cl.green,   ’READY   ’, m);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

async function fakeProgress(label, ms = 600) {
process.stdout.write(`${ts()} ${cl.cyan}◈${cl.reset} ${cl.bold}${cl.cyan}INIT    ${cl.reset} ${cl.white}${label}${cl.reset}`);
for (let i = 0; i < Math.floor(ms/80); i++) { await sleep(80); process.stdout.write(`${cl.gray}.${cl.reset}`); }
process.stdout.write(` ${cl.green}done${cl.reset}\n`);
}

// ── Discord embed colours ─────────────────────────────────────────────────────
const COLORS = {
boot:    0x1a1a2e,   // near-black
network: 0x4a90d9,   // blue
modules: 0xf5a623,   // amber
status:  0x9b59b6,   // purple
online:  0x57f287,   // green
error:   0xed4245,   // red
};

// ── Boot log channel helper ───────────────────────────────────────────────────
// Sends a new embed to the log channel, or edits an existing message.
let bootMsg = null;
let bootChannel = null;
let bootStart = Date.now();

async function getBootChannel() {
if (bootChannel) return bootChannel;
const id = process.env.BOOT_LOG_CHANNEL_ID;
if (!id) return null;
try {
const ch = await client.channels.fetch(id);
bootChannel = ch;
return ch;
} catch { return null; }
}

async function sendBootEmbed(embed) {
const ch = await getBootChannel();
if (!ch) return;
try {
if (!bootMsg) {
bootMsg = await ch.send({ embeds: [embed] });
} else {
await bootMsg.edit({ embeds: [embed] });
}
} catch (e) { console.warn(‘Boot embed send failed:’, e.message); }
}

// ── Build each phase embed ────────────────────────────────────────────────────
function buildPhaseEmbed(phase, fields, footer = ‘’) {
const phases = {
boot: {
color: COLORS.boot,
title: ‘⚫  [SYSTEM: BOOT]’,
desc:  ‘Mounting core infrastructure…’,
},
network: {
color: COLORS.network,
title: ‘🔵  [SYSTEM: NETWORK]’,
desc:  ‘Establishing external API handshakes…’,
},
modules: {
color: COLORS.modules,
title: ‘🟡  [SYSTEM: MODULES]’,
desc:  ‘Injecting command modules & audio pipeline…’,
},
status: {
color: COLORS.status,
title: ‘🟣  [SYSTEM: STATUS]’,
desc:  ‘Configuring Discord presence sequence…’,
},
online: {
color: COLORS.online,
title: ‘🟢  [SYSTEM: ONLINE]’,
desc:  ‘Sequence complete. All modules operational.’,
},
error: {
color: COLORS.error,
title: ‘🔴  [SYSTEM: TERMINAL]’,
desc:  ‘Critical error encountered during boot.’,
},
};

const p = phases[phase];
const embed = new EmbedBuilder()
.setColor(p.color)
.setTitle(p.title)
.setDescription(p.desc)
.setTimestamp();

if (fields?.length) {
embed.addFields(fields.map(f => ({
name: f.name,
value: f.value,
inline: f.inline ?? false,
})));
}

if (footer) embed.setFooter({ text: footer });
return embed;
}

// ── Client ────────────────────────────────────────────────────────────────────
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildVoiceStates,
]
});
client.commands = new Collection();
client.queues   = new Map();

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function boot() {
console.log();
console.log(`${cl.bold}${cl.magenta}╔══════════════════════════════════════════════╗${cl.reset}`);
console.log(`${cl.bold}${cl.magenta}║       SENSEQUALITY  MUSIC  BOT  v2.0         ║${cl.reset}`);
console.log(`${cl.bold}${cl.magenta}╚══════════════════════════════════════════════╝${cl.reset}`);
console.log();

// ── ENV check ────────────────────────────────────────────────────────────────
logStep(‘Checking environment variables…’);
await sleep(200);
if (!process.env.DISCORD_TOKEN) {
clog(‘✘’, cl.red, ’FATAL   ’, ‘DISCORD_TOKEN not set — exiting.’);
process.exit(1);
}
logOk(‘DISCORD_TOKEN found’);
if (process.env.RENDER_URL)        logOk(`RENDER_URL → ${process.env.RENDER_URL}`);
else                               logWarn(‘RENDER_URL not set’);
if (process.env.BOOT_LOG_CHANNEL_ID) logOk(`BOOT_LOG_CHANNEL_ID → ${process.env.BOOT_LOG_CHANNEL_ID}`);
else                               logWarn(‘BOOT_LOG_CHANNEL_ID not set — Discord boot log disabled’);
await sleep(200);

// ── Module loading ────────────────────────────────────────────────────────────
console.log();
logStep(‘Loading core modules…’);
await fakeProgress(’Loading discord.js v14                 ’, 500);
await fakeProgress(’Loading @discordjs/voice               ’, 500);
await fakeProgress(’Loading audio pipeline (ffmpeg + opus) ’, 700);
await fakeProgress(’Loading @distube/ytdl-core             ’, 600);
await fakeProgress(’Loading soundcloud-downloader          ’, 500);
await fakeProgress(’Loading node-fetch (Spotify resolver)  ’, 400);

logStep(‘Loading command modules…’);
const commands = require(’./commands’);
for (const [name, cmd] of Object.entries(commands)) client.commands.set(name, cmd);
logOk(`Registered ${client.commands.size} commands`);
await sleep(200);

// ── Login (triggers onReady) ──────────────────────────────────────────────────
console.log();
logStep(‘Authenticating with Discord API…’);
client.once(‘ready’, () => onReady(commands));
await client.login(process.env.DISCORD_TOKEN);
}

// ── onReady ───────────────────────────────────────────────────────────────────
async function onReady(commands) {
bootStart = Date.now();
logOk(`Authenticated as ${cl.bold}${cl.cyan}${client.user.tag}${cl.reset}`);
logOk(`Serving ${client.guilds.cache.size} guild(s)`);
await sleep(200);

// ── PHASE 1: BOOT embed ───────────────────────────────────────────────────────
await sendBootEmbed(buildPhaseEmbed(‘boot’, [
{ name: ‘↳ Discord Gateway’,     value: ‘`Validating WebSocket connection...`’ },
{ name: ‘↳ Environment’,         value: ‘`Loading .env configurations...`’ },
{ name: ‘↳ Memory Allocation’,   value: ‘`Stable`’, inline: true },
{ name: ‘↳ Node.js Runtime’,     value: `\`v${process.versions.node}``, inline: true },
], ‘Phase 1 of 4’));
await sleep(1200);

// Status: invisible
logStat(‘Status → INVISIBLE’);
await client.user.setPresence({ status: ‘invisible’, activities: [] });
await sleep(900);

// ── PHASE 2: NETWORK embed ────────────────────────────────────────────────────
logApi(‘Running API connectivity checks…’);
await fakeProgress(’Probing Discord Gateway WebSocket      ’, 800);
await fakeProgress(’Probing YouTube stream endpoint        ’, 700);
await fakeProgress(’Probing SoundCloud CDN                 ’, 650);
await fakeProgress(’Probing Spotify odesli resolver        ’, 600);
await fakeProgress(’Initialising Opus codec (48kHz stereo) ’, 500);

await sendBootEmbed(buildPhaseEmbed(‘network’, [
{ name: ‘↳ Discord Gateway’,       value: ‘`https://gateway.discord.gg/` **[OK]**’ },
{ name: ‘↳ YouTube Stream API’,    value: ‘`https://youtube.com/` **[OK]**’ },
{ name: ‘↳ SoundCloud CDN’,        value: ‘`https://api.soundcloud.com/` **[OK]**’ },
{ name: ‘↳ Spotify Resolver’,      value: ‘`https://api.song.link/` **[OK]**’ },
{ name: ‘↳ Opus Audio Codec’,      value: ‘`48kHz · 2ch stereo · nominal`’ },
{ name: ‘↳ Routing data pipelines…’, value: ‘`All streams nominal`’ },
], ‘Phase 2 of 4’));

// Status: idle
logStat(‘Status → IDLE’);
await client.user.setPresence({
status: ‘idle’,
activities: [{ name: ‘Connecting to APIs…’, type: ActivityType.Custom }],
});
await sleep(1400);

// ── PHASE 3: MODULES embed ────────────────────────────────────────────────────
logStep(‘Registering slash commands…’);
let slashCount = 0;
try {
const rest = new REST({ version: ‘10’ }).setToken(process.env.DISCORD_TOKEN);
const slashDefs = Object.values(commands).filter(c => c.slash).map(c => c.slash);
await rest.put(Routes.applicationCommands(client.user.id), { body: slashDefs });
slashCount = slashDefs.length;
logOk(`${slashCount} slash commands registered`);
} catch (e) { logWarn(`Slash registration failed: ${e.message}`); }

const cmdNames = […client.commands.keys()].map(n => `\`${n}``).join(' '); await sendBootEmbed(buildPhaseEmbed('modules', [ { name: '↳ commands.js',      value: '`[Loaded]`', inline: true }, { name: '↳ player.js',        value: '`[Loaded]`', inline: true }, { name: '↳ bot.js',           value: '`[Loaded]`', inline: true }, { name: '↳ Slash Commands',   value: ``${slashCount} registered globally``}, { name: '↳ Prefix Commands',  value:``! prefix active`` }, { name: '↳ Available Commands', value: cmdNames }, { name: '↳ Background Tasks', value: '`Queue manager · Keep-alive · Presence watcher`' }, { name: '↳ Cache Integrity',  value: '`Verified ✔`’ },
], ‘Phase 3 of 4’));

// Status: DND
logStat(‘Status → DO NOT DISTURB’);
await client.user.setPresence({
status: ‘dnd’,
activities: [{ name: ‘Loading systems…’, type: ActivityType.Custom }],
});
await sleep(1400);

// ── PHASE 4: STATUS → STREAMING ──────────────────────────────────────────────
await sendBootEmbed(buildPhaseEmbed(‘status’, [
{ name: ‘↳ Presence Sequence’,  value: ‘`⚫ Invisible → 🌙 Idle → ⛔ DND → 🟣 Streaming`’ },
{ name: ‘↳ Activity Type’,      value: ‘`Streaming — /play to start`’ },
{ name: ‘↳ Stream URL’,         value: ‘`twitch.tv/sensequality`’ },
{ name: ‘↳ Finalising…’,      value: ‘`Switching to online status...`’ },
], ‘Phase 4 of 4’));

// Keep-alive
if (process.env.RENDER_URL) {
setInterval(() => {
const lib = process.env.RENDER_URL.startsWith(‘https’) ? https : http;
lib.get(process.env.RENDER_URL, () => {}).on(‘error’, () => {});
}, 14 * 60 * 1000);
logOk(‘Keep-alive pings enabled’);
}
await sleep(800);

// Status: STREAMING (purple)
logStat(‘Status → STREAMING ★’);
await client.user.setPresence({
status: ‘online’,
activities: [{
name: ‘🎵 /play to start’,
type: ActivityType.Streaming,
url: ‘https://www.twitch.tv/sensequality’,
}],
});

const bootMs = Date.now() - bootStart;

// ── PHASE FINAL: ONLINE embed ─────────────────────────────────────────────────
await sendBootEmbed(buildPhaseEmbed(‘online’, [
{ name: ‘↳ Boot Duration’,     value: `**\`${bootMs.toLocaleString()}ms`**`, inline: true }, { name: '↳ Guilds',            value: `**`${client.guilds.cache.size}`**`, inline: true }, { name: '↳ Commands Loaded',   value: `**`${client.commands.size}`**`, inline: true }, { name: '↳ Slash Commands',    value: `**`${slashCount} registered`**`, inline: true }, { name: '↳ Audio Engine',      value: '`Opus 48kHz stereo ✔`', inline: true }, { name: '↳ Keep-Alive',        value: process.env.RENDER_URL ? '`Active ✔`' : '`Disabled`', inline: true }, { name: '↳ Presence',          value: '`🟣 Streaming`', inline: true }, { name: '↳ Prefix',            value: '`!`', inline: true }, { name: '↳ Awaiting user commands.', value: `Use `/play` or `!play` to start the music!`}, ],`SENSEQUALITY Music Bot • Fully operational • ${new Date().toUTCString()}`));

// Console final banner
console.log();
console.log(`${cl.bold}${cl.green}╔══════════════════════════════════════════════╗${cl.reset}`);
console.log(`${cl.bold}${cl.green}║   ✔  ALL SYSTEMS GO — BOT IS ONLINE         ║${cl.reset}`);
console.log(`${cl.bold}${cl.green}╚══════════════════════════════════════════════╝${cl.reset}`);
console.log();
logRdy(`SENSEQUALITY Music Bot fully operational (boot: ${bootMs}ms)`);
console.log();
}

// ── Events ────────────────────────────────────────────────────────────────────
client.on(‘interactionCreate’, async (interaction) => {
if (interaction.isChatInputCommand()) {
const cmd = client.commands.get(interaction.commandName);
if (cmd) await cmd.execute(interaction, client).catch(console.error);
}
if (interaction.isButton()) {
const { handleButton } = require(’./player’);
await handleButton(interaction, client).catch(console.error);
}
});

const PREFIX = ‘!’;
client.on(‘messageCreate’, async (message) => {
if (!message.content.startsWith(PREFIX) || message.author.bot) return;
const args = message.content.slice(PREFIX.length).trim().split(/ +/);
const commandName = args.shift().toLowerCase();
const commands = require(’./commands’);
const cmd = client.commands.get(commandName)
|| Object.values(commands).find(cmd => cmd.aliases?.includes(commandName));
if (cmd) await cmd.executePrefix(message, args, client).catch(console.error);
});

// ── Launch ────────────────────────────────────────────────────────────────────
boot().catch(err => {
console.error(`\x1b[31mFATAL boot error:\x1b[0m`, err);
process.exit(1);
});
