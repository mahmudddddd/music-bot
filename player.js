const {
joinVoiceChannel, createAudioPlayer, createAudioResource,
AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType
} = require(’@discordjs/voice’);
const ytdl = require(’@distube/ytdl-core’);
const yts = require(‘yt-search’);
const scdl = require(‘soundcloud-downloader’).default;
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require(‘discord.js’);

// ── Spotify link resolver ─────────────────────────────────────────────────────
const SPOTIFY_TRACK_RE = /spotify.com/track/([A-Za-z0-9]+)/;
const SPOTIFY_PLAYLIST_RE = /spotify.com/playlist/([A-Za-z0-9]+)/;

async function resolveSpotify(url) {
// Use odesli/song.link API (no auth needed) to get track title/artist
try {
const fetch = (await import(‘node-fetch’)).default;
const res = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(url)}&userCountry=US`);
const data = await res.json();
const entity = Object.values(data.entitiesByUniqueId || {})[0];
if (entity) return `${entity.artistName} ${entity.title}`;
} catch {}
// Fallback: just extract track ID and search generically
return null;
}

// ── Song resolver ─────────────────────────────────────────────────────────────
async function resolveSong(query) {
// Spotify
if (query.includes(‘spotify.com/track’)) {
const searchTerm = await resolveSpotify(query);
if (searchTerm) return await searchYouTube(searchTerm);
return await searchYouTube(query);
}

// SoundCloud
if (query.includes(‘soundcloud.com’)) {
try {
const info = await scdl.getInfo(query);
return [{
url: query,
title: info.title,
duration: formatDuration(Math.floor(info.duration / 1000)),
thumbnail: info.artwork_url || info.user?.avatar_url,
requester: null,
source: ‘soundcloud’,
}];
} catch (e) {
console.error(‘SoundCloud error:’, e.message);
throw new Error(‘Could not load SoundCloud track.’);
}
}

// YouTube playlist
if (query.includes(‘youtube.com/playlist’) || query.includes(‘list=’)) {
try {
const result = await yts({ listId: new URL(query).searchParams.get(‘list’) });
return result.videos.slice(0, 50).map(v => ({
url: v.url, title: v.title, duration: v.timestamp,
thumbnail: v.thumbnail, requester: null, source: ‘youtube’,
}));
} catch {}
}

// YouTube URL
if (ytdl.validateURL(query)) {
const info = await ytdl.getBasicInfo(query);
const d = info.videoDetails;
return [{
url: query,
title: d.title,
duration: formatDuration(d.lengthSeconds),
thumbnail: d.thumbnails.pop()?.url,
requester: null,
source: ‘youtube’,
}];
}

// Text search → YouTube
return await searchYouTube(query);
}

async function searchYouTube(query) {
const results = await yts(query);
const v = results.videos[0];
if (!v) throw new Error(‘No results found.’);
return [{
url: v.url, title: v.title, duration: v.timestamp,
thumbnail: v.thumbnail, requester: null, source: ‘youtube’,
}];
}

// ── Audio stream with fallback chain ─────────────────────────────────────────
//
//  YouTube fallback order:
//    1. ytdl highestaudio          — best quality, first attempt
//    2. ytdl lowestaudio           — lower quality, different format request
//    3. ytdl opus filter           — force opus stream
//    4. re-search by title on YT   — get a fresh URL in case the original expired
//    5. SoundCloud title search    — completely different source as last resort
//
async function createStream(song) {
// SoundCloud — no fallback needed, very reliable
if (song.source === ‘soundcloud’) {
const stream = await scdl.download(song.url);
return createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
}

// YouTube fallback chain
const attempts = [
{
label: ‘ytdl highestaudio’,
fn: () => ytdl(song.url, { filter: ‘audioonly’, quality: ‘highestaudio’, highWaterMark: 1 << 25 }),
},
{
label: ‘ytdl lowestaudio’,
fn: () => ytdl(song.url, { filter: ‘audioonly’, quality: ‘lowestaudio’, highWaterMark: 1 << 25 }),
},
{
label: ‘ytdl opus filter’,
fn: () => ytdl(song.url, { filter: f => f.codecs === ‘opus’ && f.container === ‘webm’, highWaterMark: 1 << 25 }),
},
{
label: ‘fresh URL re-search’,
fn: async () => {
// YouTube URLs expire — search by title to get a fresh one
const results = await yts(song.title);
const fresh = results.videos[0];
if (!fresh) throw new Error(‘Re-search returned no results’);
song.url = fresh.url; // update URL for future retries
return ytdl(fresh.url, { filter: ‘audioonly’, quality: ‘highestaudio’, highWaterMark: 1 << 25 });
},
},
{
label: ‘SoundCloud title search fallback’,
fn: async () => {
// Last resort: search SoundCloud by song title
const scResults = await scdl.search({ query: song.title, limit: 1, resourceType: ‘tracks’ });
const track = scResults?.collection?.[0];
if (!track?.permalink_url) throw new Error(‘No SoundCloud result found’);
console.log(`  ↳ SoundCloud fallback found: ${track.title}`);
song.source = ‘soundcloud’;
song.url = track.permalink_url;
return await scdl.download(track.permalink_url);
},
},
];

let lastError;
for (const attempt of attempts) {
try {
console.log(`  ⬡ Stream attempt [${attempt.label}] for: ${song.title}`);
const stream = await attempt.fn();
console.log(`  ✔ Stream success  [${attempt.label}]`);
return createAudioResource(stream, { inputType: StreamType.Arbitrary, inlineVolume: true });
} catch (err) {
console.warn(`  ✘ Stream failed   [${attempt.label}]: ${err.message}`);
lastError = err;
await new Promise(r => setTimeout(r, 400)); // brief pause before next attempt
}
}

throw new Error(`All stream attempts failed for "${song.title}": ${lastError?.message}`);
}

// ── Queue manager ─────────────────────────────────────────────────────────────
function getQueue(guildId, queues) {
if (!queues.has(guildId)) {
queues.set(guildId, {
songs: [],
currentSong: null,
connection: null,
player: null,
textChannel: null,
voiceChannel: null,
volume: 80,
loop: ‘none’, // ‘none’ | ‘song’ | ‘queue’
shuffle: false,
nowPlayingMessage: null,
});
}
return queues.get(guildId);
}

// ── Play next track ───────────────────────────────────────────────────────────
async function playNext(guildId, queues) {
const queue = queues.get(guildId);
if (!queue) return;

if (queue.loop === ‘song’ && queue.currentSong) {
queue.songs.unshift(queue.currentSong);
} else if (queue.loop === ‘queue’ && queue.currentSong) {
queue.songs.push(queue.currentSong);
}

if (!queue.songs.length) {
queue.currentSong = null;
await updateNowPlayingMessage(queue, null);
setTimeout(() => {
if (queues.has(guildId) && !queues.get(guildId).songs.length && !queues.get(guildId).currentSong) {
queue.connection?.destroy();
queues.delete(guildId);
}
}, 30000);
return;
}

let nextIndex = 0;
if (queue.shuffle && queue.songs.length > 1) {
nextIndex = Math.floor(Math.random() * queue.songs.length);
}

const song = queue.songs.splice(nextIndex, 1)[0];
queue.currentSong = song;

try {
const sourceBefore = song.source;
const resource = await createStream(song);
resource.volume?.setVolume(queue.volume / 100);
queue.player.play(resource);

```
// If source changed (e.g. fell back to SoundCloud), let the user know
if (song.source !== sourceBefore) {
  queue.textChannel?.send({
    embeds: [new EmbedBuilder()
      .setColor(0xf5a623)
      .setTitle('⚠️ YouTube Unavailable — Used Fallback')
      .setDescription(`YouTube blocked the stream for **${song.title}**.\nPlaying via **SoundCloud** instead — quality may differ slightly.`)
      .setFooter({ text: 'SENSEQUALITY Music Bot' })
    ]
  }).catch(() => {});
}

await updateNowPlayingMessage(queue, song, queues, guildId);
```

} catch (err) {
console.error(‘Stream error:’, err);
queue.textChannel?.send(`❌ Could not play **${song.title}**, skipping...`);
playNext(guildId, queues);
}
}

// ── Now Playing embed + buttons ───────────────────────────────────────────────
function buildNowPlayingEmbed(song, queue) {
if (!song) {
return new EmbedBuilder()
.setColor(0x2B2D31)
.setTitle(‘📭 Queue Finished’)
.setDescription(‘Nothing left to play. Use `/play` to add more songs!’)
.setFooter({ text: ‘SENSEQUALITY Music Bot’ });
}

const sourceEmoji = song.source === ‘soundcloud’ ? ‘🟠’ : ‘🔴’;
const loopEmoji = queue.loop === ‘song’ ? ‘🔂’ : queue.loop === ‘queue’ ? ‘🔁’ : ‘➡️’;
const shuffleEmoji = queue.shuffle ? ‘🔀’ : ‘➡️’;

return new EmbedBuilder()
.setColor(0x5865F2)
.setAuthor({ name: `${sourceEmoji} Now Playing` })
.setTitle(song.title.length > 60 ? song.title.slice(0, 57) + ‘…’ : song.title)
.setURL(song.url)
.setThumbnail(song.thumbnail || null)
.addFields(
{ name: ‘⏱ Duration’, value: song.duration || ‘Live’, inline: true },
{ name: ‘🔊 Volume’, value: `${queue.volume}%`, inline: true },
{ name: ‘📋 Queue’, value: `${queue.songs.length} song${queue.songs.length !== 1 ? 's' : ''}`, inline: true },
{ name: loopEmoji + ’ Loop’, value: queue.loop === ‘none’ ? ‘Off’ : queue.loop === ‘song’ ? ‘Song’ : ‘Queue’, inline: true },
{ name: shuffleEmoji + ’ Shuffle’, value: queue.shuffle ? ‘On’ : ‘Off’, inline: true },
{ name: ‘🎤 Requested by’, value: song.requester || ‘Unknown’, inline: true },
)
.setFooter({ text: ‘SENSEQUALITY Music Bot • Use buttons below to control playback’ })
.setTimestamp();
}

function buildControlButtons(queue) {
const row1 = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(‘btn_pause_resume’)
.setEmoji(queue.player?.state?.status === AudioPlayerStatus.Paused ? ‘▶️’ : ‘⏸️’)
.setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_skip’).setEmoji(‘⏭️’).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_stop’).setEmoji(‘⏹️’).setStyle(ButtonStyle.Danger),
new ButtonBuilder().setCustomId(‘btn_shuffle’)
.setEmoji(‘🔀’)
.setStyle(queue.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_loop’)
.setEmoji(queue.loop === ‘none’ ? ‘➡️’ : queue.loop === ‘song’ ? ‘🔂’ : ‘🔁’)
.setStyle(queue.loop !== ‘none’ ? ButtonStyle.Success : ButtonStyle.Secondary),
);

const row2 = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(‘btn_vol_down’).setEmoji(‘🔉’).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_vol_up’).setEmoji(‘🔊’).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_queue’).setEmoji(‘📋’).setStyle(ButtonStyle.Primary),
new ButtonBuilder().setCustomId(‘btn_np’).setEmoji(‘🎵’).setStyle(ButtonStyle.Primary),
);

return [row1, row2];
}

async function updateNowPlayingMessage(queue, song, queues, guildId) {
if (!queue.textChannel) return;
const embed = buildNowPlayingEmbed(song, queue);
const components = song ? buildControlButtons(queue) : [];
try {
if (queue.nowPlayingMessage) {
await queue.nowPlayingMessage.edit({ embeds: [embed], components }).catch(() => {});
} else {
queue.nowPlayingMessage = await queue.textChannel.send({ embeds: [embed], components });
}
} catch {}
}

// ── Button handler ────────────────────────────────────────────────────────────
async function handleButton(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue) return interaction.reply({ content: ‘❌ Nothing is playing.’, ephemeral: true });

await interaction.deferUpdate();

switch (interaction.customId) {
case ‘btn_pause_resume’:
if (queue.player?.state?.status === AudioPlayerStatus.Paused) {
queue.player.unpause();
} else {
queue.player?.pause();
}
break;
case ‘btn_skip’:
queue.loop = ‘none’; // skip overrides loop-song
queue.player?.stop();
break;
case ‘btn_stop’:
queue.songs = [];
queue.loop = ‘none’;
queue.player?.stop();
queue.connection?.destroy();
client.queues.delete(interaction.guild.id);
await interaction.message.edit({
embeds: [new EmbedBuilder().setColor(0xED4245).setTitle(‘⏹️ Stopped’).setDescription(‘Music stopped and queue cleared.’)],
components: []
}).catch(() => {});
return;
case ‘btn_shuffle’:
queue.shuffle = !queue.shuffle;
break;
case ‘btn_loop’:
if (queue.loop === ‘none’) queue.loop = ‘song’;
else if (queue.loop === ‘song’) queue.loop = ‘queue’;
else queue.loop = ‘none’;
break;
case ‘btn_vol_down’:
queue.volume = Math.max(10, queue.volume - 10);
queue.player?.state?.resource?.volume?.setVolume(queue.volume / 100);
break;
case ‘btn_vol_up’:
queue.volume = Math.min(100, queue.volume + 10);
queue.player?.state?.resource?.volume?.setVolume(queue.volume / 100);
break;
case ‘btn_queue’: {
const list = queue.songs.slice(0, 12).map((s, i) => `\`${i + 1}.` ${s.title} · ${s.duration || ‘?’}`).join('\n'); const qEmbed = new EmbedBuilder() .setColor(0x5865F2) .setTitle('📋 Queue') .setDescription(list || 'Queue is empty') .addFields({ name: 'Now Playing', value: queue.currentSong?.title || 'Nothing', inline: false }) .setFooter({ text: `${queue.songs.length} song(s) remaining` });
await interaction.followUp({ embeds: [qEmbed], ephemeral: true });
return;
}
case ‘btn_np’: {
if (!queue.currentSong) return;
const npEmbed = buildNowPlayingEmbed(queue.currentSong, queue);
await interaction.followUp({ embeds: [npEmbed], ephemeral: true });
return;
}
}

// Refresh the now playing message with updated state
await updateNowPlayingMessage(queue, queue.currentSong, client.queues, interaction.guild.id);
}

// ── Connect and start playing ─────────────────────────────────────────────────
async function connectAndPlay(guildId, voiceChannel, textChannel, queues) {
const queue = getQueue(guildId, queues);
queue.voiceChannel = voiceChannel;
queue.textChannel = textChannel;

if (!queue.connection) {
const connection = joinVoiceChannel({
channelId: voiceChannel.id,
guildId,
adapterCreator: voiceChannel.guild.voiceAdapterCreator,
selfDeaf: true,
});

```
connection.on(VoiceConnectionStatus.Disconnected, async () => {
  try {
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
    ]);
  } catch {
    queues.delete(guildId);
    connection.destroy();
  }
});

const player = createAudioPlayer();
player.on(AudioPlayerStatus.Idle, () => playNext(guildId, queues));
player.on('error', (err) => {
  console.error('Player error:', err);
  playNext(guildId, queues);
});

connection.subscribe(player);
queue.connection = connection;
queue.player = player;
```

}

if (queue.player?.state?.status !== AudioPlayerStatus.Playing &&
queue.player?.state?.status !== AudioPlayerStatus.Buffering) {
playNext(guildId, queues);
}
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(seconds) {
seconds = parseInt(seconds);
const h = Math.floor(seconds / 3600);
const m = Math.floor((seconds % 3600) / 60);
const s = seconds % 60;
if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = {
resolveSong, getQueue, connectAndPlay, playNext,
buildNowPlayingEmbed, buildControlButtons, updateNowPlayingMessage,
handleButton, formatDuration,
};