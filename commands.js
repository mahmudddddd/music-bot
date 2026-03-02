const { SlashCommandBuilder, EmbedBuilder } = require(‘discord.js’);
const { resolveSong, getQueue, connectAndPlay, buildNowPlayingEmbed, buildControlButtons } = require(’./player’);

// ── Helper: get voice channel from interaction or message ─────────────────────
function getVoiceChannel(ctx) {
return ctx.member?.voice?.channel || null;
}

function isSlash(ctx) {
return !!ctx.isChatInputCommand;
}

async function reply(ctx, options) {
if (typeof options === ‘string’) options = { content: options };
if (ctx.reply) {
if (ctx.deferred || ctx.replied) return ctx.editReply(options).catch(() => {});
return ctx.reply({ …options, ephemeral: options.ephemeral ?? false });
}
return ctx.channel.send(options);
}

async function deferIfSlash(ctx) {
if (ctx.deferReply && !ctx.deferred) await ctx.deferReply().catch(() => {});
}

// ── /play ─────────────────────────────────────────────────────────────────────
const play = {
aliases: [‘p’],
slash: new SlashCommandBuilder()
.setName(‘play’)
.setDescription(‘Play a song from YouTube, SoundCloud, or Spotify’)
.addStringOption(o => o.setName(‘query’).setDescription(‘Song name or URL’).setRequired(true))
.toJSON(),

async execute(interaction, client) {
await interaction.deferReply();
const query = interaction.options.getString(‘query’);
const vc = getVoiceChannel(interaction);
if (!vc) return interaction.editReply({ content: ‘❌ Join a voice channel first!’, ephemeral: true });
await _play(interaction, query, vc, client);
},

async executePrefix(message, args, client) {
if (!args.length) return message.reply(‘❌ Provide a song name or URL.’);
const vc = getVoiceChannel(message);
if (!vc) return message.reply(‘❌ Join a voice channel first!’);
const msg = await message.channel.send(‘🔍 Searching…’);
await _play(msg, args.join(’ ’), vc, client, true);
},
};

async function _play(ctx, query, vc, client, isPrefix = false) {
try {
const songs = await resolveSong(query);
const guildId = ctx.guild?.id || ctx.guildId;
const queue = getQueue(guildId, client.queues);

```
const requester = isPrefix
  ? ctx.author?.tag
  : ctx.user?.tag || ctx.interaction?.user?.tag;

songs.forEach(s => { s.requester = requester; });
queue.songs.push(...songs);

const isFirst = !queue.connection;
const textChannel = ctx.channel || ctx;

if (isFirst) {
  await connectAndPlay(guildId, vc, textChannel, client.queues);
  // nowPlayingMessage sent by playNext
} else {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(songs.length > 1 ? `➕ Added ${songs.length} songs to queue` : '➕ Added to Queue')
    .setDescription(songs.length === 1
      ? `**[${songs[0].title}](${songs[0].url})**`
      : songs.slice(0, 5).map((s, i) => `\`${i + 1}.\` ${s.title}`).join('\n') + (songs.length > 5 ? `\n...and ${songs.length - 5} more` : ''))
    .addFields(
      { name: '⏱ Duration', value: songs[0].duration || 'N/A', inline: true },
      { name: '📋 Position', value: `#${queue.songs.length - songs.length + 1}`, inline: true },
      { name: '🎤 Added by', value: requester || 'Unknown', inline: true },
    )
    .setThumbnail(songs[0].thumbnail || null)
    .setFooter({ text: 'SENSEQUALITY Music Bot' });

  if (isPrefix) {
    await ctx.edit({ content: '', embeds: [embed] }).catch(() => ctx.channel.send({ embeds: [embed] }));
  } else {
    await ctx.editReply({ embeds: [embed] }).catch(() => {});
  }
}
```

} catch (err) {
console.error(err);
const errMsg = `❌ ${err.message || 'Could not find or play that song.'}`;
if (isPrefix) ctx.edit(errMsg).catch(() => ctx.channel?.send(errMsg));
else ctx.editReply({ content: errMsg }).catch(() => {});
}
}

// ── /skip ─────────────────────────────────────────────────────────────────────
const skip = {
aliases: [‘s’],
slash: new SlashCommandBuilder().setName(‘skip’).setDescription(‘Skip the current song’).toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue?.player) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
const skipped = queue.currentSong?.title;
queue.loop = queue.loop === ‘song’ ? ‘none’ : queue.loop;
queue.player.stop();
interaction.reply({ content: `⏭️ Skipped **${skipped}**`, ephemeral: true });
},
async executePrefix(message, _, client) {
const queue = client.queues.get(message.guild.id);
if (!queue?.player) return message.reply(‘❌ Nothing is playing.’);
queue.loop = queue.loop === ‘song’ ? ‘none’ : queue.loop;
queue.player.stop();
message.react(‘⏭️’);
},
};

// ── /stop ─────────────────────────────────────────────────────────────────────
const stop = {
slash: new SlashCommandBuilder().setName(‘stop’).setDescription(‘Stop music and clear the queue’).toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
queue.songs = []; queue.loop = ‘none’;
queue.player?.stop(); queue.connection?.destroy();
client.queues.delete(interaction.guild.id);
interaction.reply({ content: ‘⏹️ Stopped and cleared the queue.’, ephemeral: true });
},
async executePrefix(message, _, client) {
const queue = client.queues.get(message.guild.id);
if (!queue) return message.reply(‘❌ Nothing is playing.’);
queue.songs = []; queue.loop = ‘none’;
queue.player?.stop(); queue.connection?.destroy();
client.queues.delete(message.guild.id);
message.react(‘⏹️’);
},
};

// ── /pause ────────────────────────────────────────────────────────────────────
const pause = {
slash: new SlashCommandBuilder().setName(‘pause’).setDescription(‘Pause playback’).toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue?.player) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
queue.player.pause();
interaction.reply({ content: ‘⏸️ Paused.’, ephemeral: true });
},
async executePrefix(message, _, client) {
const queue = client.queues.get(message.guild.id);
if (!queue?.player) return message.reply(‘❌ Nothing is playing.’);
queue.player.pause();
message.react(‘⏸️’);
},
};

// ── /resume ───────────────────────────────────────────────────────────────────
const resume = {
aliases: [‘r’],
slash: new SlashCommandBuilder().setName(‘resume’).setDescription(‘Resume playback’).toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue?.player) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
queue.player.unpause();
interaction.reply({ content: ‘▶️ Resumed.’, ephemeral: true });
},
async executePrefix(message, _, client) {
const queue = client.queues.get(message.guild.id);
if (!queue?.player) return message.reply(‘❌ Nothing is playing.’);
queue.player.unpause();
message.react(‘▶️’);
},
};

// ── /loop ─────────────────────────────────────────────────────────────────────
const loop = {
aliases: [‘l’],
slash: new SlashCommandBuilder()
.setName(‘loop’)
.setDescription(‘Set loop mode’)
.addStringOption(o => o.setName(‘mode’).setDescription(‘Loop mode’).setRequired(true)
.addChoices(
{ name: ‘🔂 Song’, value: ‘song’ },
{ name: ‘🔁 Queue’, value: ‘queue’ },
{ name: ‘➡️ Off’, value: ‘none’ },
))
.toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
const mode = interaction.options.getString(‘mode’);
queue.loop = mode;
const labels = { song: ‘🔂 Song loop on’, queue: ‘🔁 Queue loop on’, none: ‘➡️ Loop off’ };
interaction.reply({ content: labels[mode], ephemeral: true });
},
async executePrefix(message, args, client) {
const queue = client.queues.get(message.guild.id);
if (!queue) return message.reply(‘❌ Nothing is playing.’);
const modes = { song: ‘song’, queue: ‘queue’, off: ‘none’, none: ‘none’ };
const mode = modes[args[0]?.toLowerCase()] ??
(queue.loop === ‘none’ ? ‘song’ : queue.loop === ‘song’ ? ‘queue’ : ‘none’);
queue.loop = mode;
const labels = { song: ‘🔂 Song loop on’, queue: ‘🔁 Queue loop on’, none: ‘➡️ Loop off’ };
message.reply(labels[mode]);
},
};

// ── /shuffle ──────────────────────────────────────────────────────────────────
const shuffle = {
slash: new SlashCommandBuilder().setName(‘shuffle’).setDescription(‘Toggle shuffle mode’).toJSON(),
async execute(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
queue.shuffle = !queue.shuffle;
interaction.reply({ content: queue.shuffle ? ‘🔀 Shuffle on’ : ‘➡️ Shuffle off’, ephemeral: true });
},
async executePrefix(message, _, client) {
const queue = client.queues.get(message.guild.id);
if (!queue) return message.reply(‘❌ Nothing is playing.’);
queue.shuffle = !queue.shuffle;
message.reply(queue.shuffle ? ‘🔀 Shuffle on’ : ‘➡️ Shuffle off’);
},
};

// ── /queue ────────────────────────────────────────────────────────────────────
const queue = {
aliases: [‘q’],
slash: new SlashCommandBuilder().setName(‘queue’).setDescription(‘Show the current queue’).toJSON(),
async execute(interaction, client) {
const q = client.queues.get(interaction.guild.id);
if (!q?.currentSong) return interaction.reply({ content: ‘❌ Queue is empty.’, ephemeral: true });
interaction.reply({ embeds: [buildQueueEmbed(q)], ephemeral: true });
},
async executePrefix(message, _, client) {
const q = client.queues.get(message.guild.id);
if (!q?.currentSong) return message.reply(‘❌ Queue is empty.’);
message.channel.send({ embeds: [buildQueueEmbed(q)] });
},
};

function buildQueueEmbed(q) {
const list = q.songs.slice(0, 15).map((s, i) =>
`\`${i + 1}.` [${s.title.length > 45 ? s.title.slice(0, 42) + ‘…’ : s.title}](${s.url}) · `${s.duration || ‘?’}``
).join(’\n’);

return new EmbedBuilder()
.setColor(0x5865F2)
.setTitle(‘📋 Queue’)
.addFields(
{ name: ‘🎵 Now Playing’, value: `[${q.currentSong.title}](${q.currentSong.url})`, inline: false },
{ name: ‘📝 Up Next’, value: list || ‘Nothing queued’, inline: false },
)
.addFields(
{ name: ‘🔁 Loop’, value: q.loop === ‘none’ ? ‘Off’ : q.loop === ‘song’ ? ‘Song’ : ‘Queue’, inline: true },
{ name: ‘🔀 Shuffle’, value: q.shuffle ? ‘On’ : ‘Off’, inline: true },
{ name: ‘🔊 Volume’, value: `${q.volume}%`, inline: true },
)
.setFooter({ text: `${q.songs.length} song(s) in queue • SENSEQUALITY Music Bot` });
}

// ── /volume ───────────────────────────────────────────────────────────────────
const volume = {
aliases: [‘v’, ‘vol’],
slash: new SlashCommandBuilder()
.setName(‘volume’)
.setDescription(‘Set the volume (1-100)’)
.addIntegerOption(o => o.setName(‘level’).setDescription(‘Volume level 1-100’).setRequired(true).setMinValue(1).setMaxValue(100))
.toJSON(),
async execute(interaction, client) {
const q = client.queues.get(interaction.guild.id);
if (!q) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
const vol = interaction.options.getInteger(‘level’);
q.volume = vol;
q.player?.state?.resource?.volume?.setVolume(vol / 100);
interaction.reply({ content: `🔊 Volume set to **${vol}%**`, ephemeral: true });
},
async executePrefix(message, args, client) {
const q = client.queues.get(message.guild.id);
if (!q) return message.reply(‘❌ Nothing is playing.’);
const vol = parseInt(args[0]);
if (isNaN(vol) || vol < 1 || vol > 100) return message.reply(‘❌ Volume must be 1-100.’);
q.volume = vol;
q.player?.state?.resource?.volume?.setVolume(vol / 100);
message.reply(`🔊 Volume set to **${vol}%**`);
},
};

// ── /np ───────────────────────────────────────────────────────────────────────
const np = {
aliases: [‘nowplaying’],
slash: new SlashCommandBuilder().setName(‘np’).setDescription(‘Show what's currently playing’).toJSON(),
async execute(interaction, client) {
const q = client.queues.get(interaction.guild.id);
if (!q?.currentSong) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });
const { buildNowPlayingEmbed, buildControlButtons } = require(’./player’);
interaction.reply({ embeds: [buildNowPlayingEmbed(q.currentSong, q)], components: buildControlButtons(q), ephemeral: true });
},
async executePrefix(message, _, client) {
const q = client.queues.get(message.guild.id);
if (!q?.currentSong) return message.reply(‘❌ Nothing is playing.’);
const { buildNowPlayingEmbed, buildControlButtons } = require(’./player’);
message.channel.send({ embeds: [buildNowPlayingEmbed(q.currentSong, q)], components: buildControlButtons(q) });
},
};

// ── /leave ────────────────────────────────────────────────────────────────────
const leave = {
aliases: [‘dc’, ‘disconnect’],
slash: new SlashCommandBuilder().setName(‘leave’).setDescription(‘Disconnect the bot from voice’).toJSON(),
async execute(interaction, client) {
const q = client.queues.get(interaction.guild.id);
if (!q) return interaction.reply({ content: ‘❌ Not in a voice channel.’, ephemeral: true });
q.songs = []; q.player?.stop(); q.connection?.destroy();
client.queues.delete(interaction.guild.id);
interaction.reply({ content: ‘👋 Disconnected.’, ephemeral: true });
},
async executePrefix(message, _, client) {
const q = client.queues.get(message.guild.id);
if (!q) return message.reply(‘❌ Not in a voice channel.’);
q.songs = []; q.player?.stop(); q.connection?.destroy();
client.queues.delete(message.guild.id);
message.react(‘👋’);
},
};

// ── /help ─────────────────────────────────────────────────────────────────────
const help = {
slash: new SlashCommandBuilder().setName(‘help’).setDescription(‘Show all music commands’).toJSON(),
async execute(interaction) {
interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
},
async executePrefix(message) {
message.channel.send({ embeds: [buildHelpEmbed()] });
},
};

function buildHelpEmbed() {
return new EmbedBuilder()
.setColor(0x5865F2)
.setTitle(‘🎵 SENSEQUALITY Music Bot’)
.setDescription(‘Play music from **YouTube**, **SoundCloud**, and **Spotify** links!’)
.addFields(
{ name: ‘▶️ Playback’, value: ‘`/play` `/pause` `/resume` `/skip` `/stop`’, inline: false },
{ name: ‘📋 Queue’, value: ‘`/queue` `/loop` `/shuffle`’, inline: false },
{ name: ‘🎚️ Settings’, value: ‘`/volume` `/np` `/leave`’, inline: false },
{ name: ‘🎮 Prefix’, value: ‘All commands work with `!` prefix too\ne.g. `!play`, `!skip`, `!loop song`’, inline: false },
{ name: ‘🔁 Loop modes’, value: ‘`/loop song` — repeat current song\n`/loop queue` — repeat entire queue\n`/loop off` — no loop’, inline: false },
{ name: ‘💡 Tips’, value: ‘• Paste a Spotify link → auto-searches YouTube\n• Paste a YouTube playlist URL → queues up to 50 songs\n• Use the buttons under Now Playing to control music’, inline: false },
)
.setFooter({ text: ‘SENSEQUALITY Music Bot’ });
}

// ── Export all commands ───────────────────────────────────────────────────────
module.exports = { play, skip, stop, pause, resume, loop, shuffle, queue, volume, np, leave, help };