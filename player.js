const {
joinVoiceChannel, createAudioPlayer, createAudioResource,
AudioPlayerStatus, VoiceConnectionStatus, entersState, StreamType
} = require(’@discordjs/voice’);
const playdl = require(‘play-dl’);
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require(‘discord.js’);

async function resolveSpotify(url) {
try {
const fetch = (await import(‘node-fetch’)).default;
const res = await fetch(‘https://api.song.link/v1-alpha.1/links?url=’ + encodeURIComponent(url) + ‘&userCountry=US’);
const data = await res.json();
const entity = Object.values(data.entitiesByUniqueId || {})[0];
if (entity) return entity.artistName + ’ ’ + entity.title;
} catch {}
return null;
}

async function resolveSong(query) {
if (query.includes(‘spotify.com/track’)) {
const term = await resolveSpotify(query);
return await searchYouTube(term || query);
}

if (query.includes(‘youtube.com/playlist’) || (query.includes(‘list=’) && query.includes(‘youtube’))) {
try {
const listId = new URL(query).searchParams.get(‘list’);
const playlist = await playdl.playlist_info(‘https://www.youtube.com/playlist?list=’ + listId, { incomplete: true });
const videos = await playlist.all_videos();
return videos.slice(0, 50).map(v => ({
url: v.url, title: v.title, duration: formatDuration(v.durationInSec),
thumbnail: v.thumbnails[0]?.url, requester: null, source: ‘youtube’,
}));
} catch {}
}

if (playdl.yt_validate(query) === ‘video’) {
const info = await playdl.video_info(query);
const d = info.video_details;
return [{
url: query, title: d.title, duration: formatDuration(d.durationInSec),
thumbnail: d.thumbnails[0]?.url, requester: null, source: ‘youtube’,
}];
}

return await searchYouTube(query);
}

async function searchYouTube(query) {
const results = await playdl.search(query, { source: { youtube: ‘video’ }, limit: 1 });
if (!results || !results.length) throw new Error(‘No results found.’);
const v = results[0];
return [{
url: v.url, title: v.title, duration: formatDuration(v.durationInSec),
thumbnail: v.thumbnails[0]?.url, requester: null, source: ‘youtube’,
}];
}

async function createStream(song) {
const attempts = [
{
label: ‘play-dl stream’,
fn: async () => {
const stream = await playdl.stream(song.url, { quality: 2 });
return createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
},
},
{
label: ‘play-dl quality 0’,
fn: async () => {
const stream = await playdl.stream(song.url, { quality: 0 });
return createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
},
},
{
label: ‘re-search’,
fn: async () => {
const results = await playdl.search(song.title, { source: { youtube: ‘video’ }, limit: 1 });
if (!results || !results.length) throw new Error(‘Re-search returned no results’);
song.url = results[0].url;
const stream = await playdl.stream(song.url, { quality: 2 });
return createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
},
},
];

let lastError;
for (const attempt of attempts) {
try {
console.log(‘Stream attempt [’ + attempt.label + ’] for: ’ + song.title);
const resource = await attempt.fn();
console.log(‘Stream success [’ + attempt.label + ‘]’);
return resource;
} catch (err) {
console.warn(‘Stream failed [’ + attempt.label + ’]: ’ + err.message);
lastError = err;
await new Promise(r => setTimeout(r, 400));
}
}
throw new Error(’All stream attempts failed for ’ + song.title + ’: ’ + lastError?.message);
}

function getQueue(guildId, queues) {
if (!queues.has(guildId)) {
queues.set(guildId, {
songs: [], currentSong: null, connection: null, player: null,
textChannel: null, voiceChannel: null, volume: 80,
loop: ‘none’, shuffle: false, nowPlayingMessage: null,
});
}
return queues.get(guildId);
}

async function playNext(guildId, queues) {
const queue = queues.get(guildId);
if (!queue) return;
if (queue.loop === ‘song’ && queue.currentSong) queue.songs.unshift(queue.currentSong);
else if (queue.loop === ‘queue’ && queue.currentSong) queue.songs.push(queue.currentSong);
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
if (queue.shuffle && queue.songs.length > 1) nextIndex = Math.floor(Math.random() * queue.songs.length);
const song = queue.songs.splice(nextIndex, 1)[0];
queue.currentSong = song;
try {
const resource = await createStream(song);
resource.volume?.setVolume(queue.volume / 100);
queue.player.play(resource);
await updateNowPlayingMessage(queue, song, queues, guildId);
} catch (err) {
console.error(‘Stream error:’, err);
queue.textChannel?.send(’Could not play ’ + song.title + ‘, skipping…’);
playNext(guildId, queues);
}
}

function buildNowPlayingEmbed(song, queue) {
if (!song) {
return new EmbedBuilder()
.setColor(0x2B2D31)
.setTitle(‘Queue Finished’)
.setDescription(‘Nothing left to play. Use /play to add more songs!’)
.setFooter({ text: ‘SENSEQUALITY Music Bot’ });
}
const loopLabel = queue.loop === ‘song’ ? ‘Song’ : queue.loop === ‘queue’ ? ‘Queue’ : ‘Off’;
return new EmbedBuilder()
.setColor(0x5865F2)
.setAuthor({ name: ‘Now Playing’ })
.setTitle(song.title.length > 60 ? song.title.slice(0, 57) + ‘…’ : song.title)
.setURL(song.url)
.setThumbnail(song.thumbnail || null)
.addFields(
{ name: ‘Duration’,  value: song.duration || ‘Live’, inline: true },
{ name: ‘Volume’,    value: queue.volume + ‘%’, inline: true },
{ name: ‘Queue’,     value: queue.songs.length + ’ song(s)’, inline: true },
{ name: ‘Loop’,      value: loopLabel, inline: true },
{ name: ‘Shuffle’,   value: queue.shuffle ? ‘On’ : ‘Off’, inline: true },
{ name: ‘Requested’, value: song.requester || ‘Unknown’, inline: true },
)
.setFooter({ text: ‘SENSEQUALITY Music Bot’ })
.setTimestamp();
}

function buildControlButtons(queue) {
const row1 = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(‘btn_pause_resume’).setEmoji(queue.player?.state?.status === AudioPlayerStatus.Paused ? ‘▶️’ : ‘⏸️’).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_skip’).setEmoji(‘⏭️’).setStyle(ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_stop’).setEmoji(‘⏹️’).setStyle(ButtonStyle.Danger),
new ButtonBuilder().setCustomId(‘btn_shuffle’).setEmoji(‘🔀’).setStyle(queue.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary),
new ButtonBuilder().setCustomId(‘btn_loop’).setEmoji(queue.loop === ‘none’ ? ‘➡️’ : queue.loop === ‘song’ ? ‘🔂’ : ‘🔁’).setStyle(queue.loop !== ‘none’ ? ButtonStyle.Success : ButtonStyle.Secondary),
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

async function handleButton(interaction, client) {
const queue = client.queues.get(interaction.guild.id);
if (!queue) return interaction.reply({ content: ‘Nothing is playing.’, ephemeral: true });
await interaction.deferUpdate();
switch (interaction.customId) {
case ‘btn_pause_resume’:
queue.player?.state?.status === AudioPlayerStatus.Paused ? queue.player.unpause() : queue.player?.pause();
break;
case ‘btn_skip’:
queue.loop = ‘none’;
queue.player?.stop();
break;
case ‘btn_stop’:
queue.songs = []; queue.loop = ‘none’;
queue.player?.stop(); queue.connection?.destroy();
client.queues.delete(interaction.guild.id);
await interaction.message.edit({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle(‘Stopped’).setDescription(‘Music stopped and queue cleared.’)], components: [] }).catch(() => {});
return;
case ‘btn_shuffle’: queue.shuffle = !queue.shuffle; break;
case ‘btn_loop’:
queue.loop = queue.loop === ‘none’ ? ‘song’ : queue.loop === ‘song’ ? ‘queue’ : ‘none’;
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
const list = queue.songs.slice(0, 12).map((s, i) => (i+1) + ‘. ’ + s.title + ’ (’ + (s.duration || ‘?’) + ‘)’).join(’\n’);
await interaction.followUp({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(‘Queue’).setDescription(list || ‘Queue is empty’).addFields({ name: ‘Now Playing’, value: queue.currentSong?.title || ‘Nothing’ }).setFooter({ text: queue.songs.length + ’ song(s) remaining’ })], ephemeral: true });
return;
}
case ‘btn_np’:
if (!queue.currentSong) return;
await interaction.followUp({ embeds: [buildNowPlayingEmbed(queue.currentSong, queue)], ephemeral: true });
return;
}
await updateNowPlayingMessage(queue, queue.currentSong, client.queues, interaction.guild.id);
}

async function connectAndPlay(guildId, voiceChannel, textChannel, queues) {
const queue = getQueue(guildId, queues);
queue.voiceChannel = voiceChannel;
queue.textChannel = textChannel;
if (!queue.connection) {
const connection = joinVoiceChannel({
channelId: voiceChannel.id, guildId,
adapterCreator: voiceChannel.guild.voiceAdapterCreator,
selfDeaf: true,
});
connection.on(VoiceConnectionStatus.Disconnected, async () => {
try {
await Promise.race([
entersState(connection, VoiceConnectionStatus.Signalling, 5000),
entersState(connection, VoiceConnectionStatus.Connecting, 5000),
]);
} catch { queues.delete(guildId); connection.destroy(); }
});
const player = createAudioPlayer();
player.on(AudioPlayerStatus.Idle, () => playNext(guildId, queues));
player.on(‘error’, err => { console.error(‘Player error:’, err.message); playNext(guildId, queues); });
connection.subscribe(player);
queue.connection = connection;
queue.player = player;
}
if (queue.player?.state?.status !== AudioPlayerStatus.Playing &&
queue.player?.state?.status !== AudioPlayerStatus.Buffering) {
playNext(guildId, queues);
}
}

function formatDuration(seconds) {
seconds = parseInt(seconds);
if (isNaN(seconds)) return ‘?’;
const h = Math.floor(seconds / 3600);
const m = Math.floor((seconds % 3600) / 60);
const s = seconds % 60;
if (h > 0) return h + ‘:’ + m.toString().padStart(2,‘0’) + ‘:’ + s.toString().padStart(2,‘0’);
return m + ‘:’ + s.toString().padStart(2,‘0’);
}

module.exports = {
resolveSong, getQueue, connectAndPlay, playNext,
buildNowPlayingEmbed, buildControlButtons, updateNowPlayingMessage,
handleButton, formatDuration,
};
