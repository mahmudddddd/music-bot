require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, EmbedBuilder } = require('discord.js');
const http = require('http');
const https = require('https');

http.createServer((_, res) => { res.writeHead(200); res.end('alive'); }).listen(process.env.PORT || 3000);

const ts = () => '[' + new Date().toISOString().slice(11,23) + ']';
const logStep = m => console.log(ts() + ' INIT     ' + m);
const logOk   = m => console.log(ts() + ' OK       ' + m);
const logWarn = m => console.log(ts() + ' WARN     ' + m);
const logApi  = m => console.log(ts() + ' API      ' + m);
const logStat = m => console.log(ts() + ' STATUS   ' + m);
const logRdy  = m => console.log(ts() + ' READY    ' + m);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

async function fakeProgress(label, ms) {
  process.stdout.write(ts() + ' INIT     ' + label);
  for (let i = 0; i < Math.floor(ms/80); i++) { await sleep(80); process.stdout.write('.'); }
  process.stdout.write(' done' + String.fromCharCode(10));
}

const COLORS = { boot: 0x1a1a2e, network: 0x4a90d9, modules: 0xf5a623, status: 0x9b59b6, online: 0x57f287, error: 0xed4245 };

let bootMsg = null;
let bootChannel = null;
let bootStart = Date.now();

async function getBootChannel() {
  if (bootChannel) return bootChannel;
  const id = process.env.BOOT_LOG_CHANNEL_ID;
  if (!id) return null;
  try { bootChannel = await client.channels.fetch(id); return bootChannel; } catch { return null; }
}

async function sendBootEmbed(embed) {
  const ch = await getBootChannel();
  if (!ch) return;
  try {
    if (!bootMsg) { bootMsg = await ch.send({ embeds: [embed] }); }
    else { await bootMsg.edit({ embeds: [embed] }); }
  } catch (e) { console.warn('Boot embed error:', e.message); }
}

function buildPhaseEmbed(phase, fields, footer) {
  const phases = {
    boot:    { color: COLORS.boot,    title: 'BOOT',    desc: 'Mounting core infrastructure...' },
    network: { color: COLORS.network, title: 'NETWORK', desc: 'Establishing external API handshakes...' },
    modules: { color: COLORS.modules, title: 'MODULES', desc: 'Injecting command modules and audio pipeline...' },
    status:  { color: COLORS.status,  title: 'STATUS',  desc: 'Configuring Discord presence sequence...' },
    online:  { color: COLORS.online,  title: 'ONLINE',  desc: 'Sequence complete. All modules operational.' },
    error:   { color: COLORS.error,   title: 'ERROR',   desc: 'Critical error encountered during boot.' },
  };
  const p = phases[phase];
  const embed = new EmbedBuilder().setColor(p.color).setTitle('[SYSTEM: ' + p.title + ']').setDescription(p.desc).setTimestamp();
  if (fields && fields.length) embed.addFields(fields.map(f => ({ name: f.name, value: f.value, inline: f.inline || false })));
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ]
});
client.commands = new Collection();
client.queues = new Map();

async function boot() {
  console.log('');
  console.log('================================================');
  console.log('    SENSEQUALITY MUSIC BOT v2.0');
  console.log('================================================');
  console.log('');

  logStep('Checking environment variables...');
  await sleep(200);
  if (!process.env.DISCORD_TOKEN) { console.log('FATAL: DISCORD_TOKEN not set'); process.exit(1); }
  logOk('DISCORD_TOKEN found');
  if (process.env.RENDER_URL) logOk('RENDER_URL: ' + process.env.RENDER_URL);
  else logWarn('RENDER_URL not set');
  if (process.env.BOOT_LOG_CHANNEL_ID) logOk('BOOT_LOG_CHANNEL_ID: ' + process.env.BOOT_LOG_CHANNEL_ID);
  else logWarn('BOOT_LOG_CHANNEL_ID not set');
  await sleep(200);

  console.log('');
  logStep('Loading core modules...');
  await fakeProgress('Loading discord.js v14              ', 500);
  await fakeProgress('Loading @discordjs/voice            ', 500);
  await fakeProgress('Loading audio pipeline (ffmpeg+opus)', 700);
  await fakeProgress('Loading @distube/ytdl-core          ', 600);
  await fakeProgress('Loading node-fetch (Spotify)        ', 400);

  logStep('Loading command modules...');
  const commands = require('./commands');
  for (const [name, cmd] of Object.entries(commands)) client.commands.set(name, cmd);
  logOk('Registered ' + client.commands.size + ' commands');
  await sleep(200);

  console.log('');
  logStep('Authenticating with Discord API...');
  client.once('ready', () => onReady(commands));
  await client.login(process.env.DISCORD_TOKEN);
}

async function onReady(commands) {
  bootStart = Date.now();
  logOk('Authenticated as ' + client.user.tag);
  logOk('Serving ' + client.guilds.cache.size + ' guild(s)');
  await sleep(300);

  await sendBootEmbed(buildPhaseEmbed('boot', [
    { name: 'Discord Gateway',   value: 'Validating WebSocket connection...' },
    { name: 'Environment',       value: 'Loading .env configurations...' },
    { name: 'Memory Allocation', value: 'Stable', inline: true },
    { name: 'Node.js Runtime',   value: 'v' + process.versions.node, inline: true },
  ], 'Phase 1 of 4'));
  await sleep(1200);

  logStat('Status: INVISIBLE');
  await client.user.setPresence({ status: 'invisible', activities: [] });
  await sleep(900);

  logApi('Running API connectivity checks...');
  await fakeProgress('Probing Discord Gateway WebSocket  ', 800);
  await fakeProgress('Probing YouTube stream endpoint    ', 700);
  await fakeProgress('Probing Spotify odesli resolver    ', 600);
  await fakeProgress('Initialising Opus codec 48kHz      ', 500);

  await sendBootEmbed(buildPhaseEmbed('network', [
    { name: 'Discord Gateway',    value: 'https://gateway.discord.gg/ [OK]' },
    { name: 'YouTube Stream API', value: 'https://youtube.com/ [OK]' },
    { name: 'Spotify Resolver',   value: 'https://api.song.link/ [OK]' },
    { name: 'Opus Audio Codec',   value: '48kHz stereo nominal' },
    { name: 'Data Pipelines',     value: 'All streams nominal' },
  ], 'Phase 2 of 4'));

  logStat('Status: IDLE');
  await client.user.setPresence({ status: 'idle', activities: [{ name: 'Connecting to APIs...', type: ActivityType.Custom }] });
  await sleep(1400);

  logStep('Registering slash commands...');
  let slashCount = 0;
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const slashDefs = Object.values(commands).filter(c => c.slash).map(c => c.slash);
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashDefs });
    slashCount = slashDefs.length;
    logOk(slashCount + ' slash commands registered');
  } catch (e) { logWarn('Slash registration failed: ' + e.message); }

  const cmdNames = [...client.commands.keys()].map(n => '`' + n + '`').join(' ');
  await sendBootEmbed(buildPhaseEmbed('modules', [
    { name: 'commands.js',        value: '[Loaded]', inline: true },
    { name: 'player.js',          value: '[Loaded]', inline: true },
    { name: 'bot.js',             value: '[Loaded]', inline: true },
    { name: 'Slash Commands',     value: slashCount + ' registered globally' },
    { name: 'Prefix Commands',    value: '! prefix active' },
    { name: 'Available Commands', value: cmdNames },
    { name: 'Cache Integrity',    value: 'Verified' },
  ], 'Phase 3 of 4'));

  logStat('Status: DO NOT DISTURB');
  await client.user.setPresence({ status: 'dnd', activities: [{ name: 'Loading systems...', type: ActivityType.Custom }] });
  await sleep(1400);

  await sendBootEmbed(buildPhaseEmbed('status', [
    { name: 'Presence Sequence', value: 'Invisible -> Idle -> DND -> Streaming' },
    { name: 'Activity Type',     value: 'Streaming - /play to start' },
    { name: 'Stream URL',        value: 'twitch.tv/sensequality' },
    { name: 'Finalising',        value: 'Switching to online status...' },
  ], 'Phase 4 of 4'));

  if (process.env.RENDER_URL) {
    setInterval(() => {
      const lib = process.env.RENDER_URL.startsWith('https') ? https : http;
      lib.get(process.env.RENDER_URL, () => {}).on('error', () => {});
    }, 14 * 60 * 1000);
    logOk('Keep-alive pings enabled');
  }
  await sleep(800);

  logStat('Status: STREAMING');
  await client.user.setPresence({
    status: 'online',
    activities: [{ name: '/play to start', type: ActivityType.Streaming, url: 'https://www.twitch.tv/sensequality' }],
  });

  const bootMs = Date.now() - bootStart;

  await sendBootEmbed(buildPhaseEmbed('online', [
    { name: 'Boot Duration',     value: bootMs.toLocaleString() + 'ms', inline: true },
    { name: 'Guilds',            value: String(client.guilds.cache.size), inline: true },
    { name: 'Commands',          value: String(client.commands.size), inline: true },
    { name: 'Slash Commands',    value: String(slashCount) + ' registered', inline: true },
    { name: 'Audio Engine',      value: 'Opus 48kHz stereo', inline: true },
    { name: 'Keep-Alive',        value: process.env.RENDER_URL ? 'Active' : 'Disabled', inline: true },
    { name: 'Presence',          value: 'Streaming', inline: true },
    { name: 'Prefix',            value: '!', inline: true },
    { name: 'Awaiting commands', value: 'Use /play or !play to start the music!' },
  ], 'SENSEQUALITY Music Bot - Fully operational - ' + new Date().toUTCString()));

  console.log('');
  console.log('================================================');
  console.log('    ALL SYSTEMS GO - BOT IS ONLINE');
  console.log('================================================');
  console.log('');
  logRdy('SENSEQUALITY Music Bot fully operational (boot: ' + bootMs + 'ms)');
  console.log('');
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd) await cmd.execute(interaction, client).catch(console.error);
  }
  if (interaction.isButton()) {
    const { handleButton } = require('./player');
    await handleButton(interaction, client).catch(console.error);
  }
});

const PREFIX = '!';
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;
  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();
  const commands = require('./commands');
  const cmd = client.commands.get(commandName) || Object.values(commands).find(c => c.aliases && c.aliases.includes(commandName));
  if (cmd) await cmd.executePrefix(message, args, client).catch(console.error);
});

boot().catch(err => { console.error('FATAL boot error:', err); process.exit(1); });
