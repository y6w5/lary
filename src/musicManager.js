import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import playdl from 'play-dl';

const guildStates = new Map();

function getState(guildId) {
  return guildStates.get(guildId);
}

function createState(guildId) {
  const state = {
    connection: null,
    player: null,
    queue: [],
    current: null,
    textChannel: null,
    voiceChannelId: null,
  };
  guildStates.set(guildId, state);
  return state;
}

function destroyState(guildId) {
  const state = guildStates.get(guildId);
  if (state) {
    try { state.player?.stop(true); } catch {}
    try { state.connection?.destroy(); } catch {}
    guildStates.delete(guildId);
  }
}

export async function searchAndPlay(interaction, query) {
  const voiceChannel = interaction.member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({ content: '❌ لازم تكون داخل روم صوتي!', ephemeral: true });
  }

  await interaction.deferReply();

  let trackInfo;
  try {
    if (!query.startsWith('http')) {
      const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
      if (!results?.length) return interaction.editReply('❌ ما لقيت نتائج.');
      trackInfo = { title: results[0].title, url: results[0].url, duration: results[0].durationRaw };
    } else {
      const info = await playdl.video_info(query);
      trackInfo = {
        title: info.video_details.title,
        url: query,
        duration: info.video_details.durationRaw,
      };
    }
  } catch (err) {
    console.error('Search error:', err);
    return interaction.editReply('❌ خطأ في البحث. تحقق من الرابط أو الاسم.');
  }

  const guildId = interaction.guildId;
  let state = getState(guildId);

  if (state?.voiceChannelId && state.voiceChannelId !== voiceChannel.id) {
    return interaction.editReply(`❌ البوت في روم ثاني. استخدم /stop أولاً.`);
  }

  if (!state) state = createState(guildId);

  state.queue.push(trackInfo);
  state.textChannel = interaction.channel;
  state.voiceChannelId = voiceChannel.id;

  if (state.player && state.player.state.status !== AudioPlayerStatus.Idle) {
    return interaction.editReply(`📋 **أضيفت للقائمة (#${state.queue.length})**\n🎵 ${trackInfo.title} \`${trackInfo.duration}\``);
  }

  try {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    await entersState(state.connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    destroyState(guildId);
    return interaction.editReply('❌ ما قدرت أدخل الروم.');
  }

  state.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(state.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(state.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroyState(guildId);
    }
  });

  state.player = createAudioPlayer();
  state.connection.subscribe(state.player);
  state.player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
  state.player.on('error', (err) => { console.error('Player error:', err); playNext(guildId); });

  await playNext(guildId);

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`music_skip_${guildId}`).setLabel('⏭ Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`music_stop_${guildId}`).setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
  );

  return interaction.editReply({
    content: `🎵 **يشتغل الآن**\n${state.current?.title} \`${state.current?.duration}\``,
    components: [row],
  });
}

async function playNext(guildId) {
  const state = getState(guildId);
  if (!state) return;

  if (state.queue.length === 0) {
    state.current = null;
    setTimeout(() => {
      const s = getState(guildId);
      if (s && s.queue.length === 0) {
        s.textChannel?.send('✅ انتهت القائمة. وداعاً! 👋').catch(() => {});
        destroyState(guildId);
      }
    }, 3000);
    return;
  }

  const track = state.queue.shift();
  state.current = track;

  try {
    const stream = await playdl.stream(track.url, { quality: 2 });
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    state.player.play(resource);

    state.textChannel?.send(
      `🎵 **يشتغل الآن:** ${track.title} \`${track.duration}\`` +
      (state.queue.length > 0 ? `\n📋 في القائمة: ${state.queue.length} أغنية` : '')
    ).catch(() => {});
  } catch (err) {
    console.error('Stream error:', err);
    state.textChannel?.send(`❌ خطأ في تشغيل: ${track.title}. يتخطى...`).catch(() => {});
    playNext(guildId);
  }
}

export function skipTrack(guildId) {
  const state = getState(guildId);
  if (!state?.player) return false;
  state.player.stop();
  return true;
}

export function stopPlayback(guildId) {
  if (!getState(guildId)) return false;
  getState(guildId).queue = [];
  destroyState(guildId);
  return true;
}

export function getQueue(guildId) {
  const state = getState(guildId);
  return state ? { current: state.current, queue: [...state.queue] } : { current: null, queue: [] };
}

export function getVoiceChannelId(guildId) {
  return getState(guildId)?.voiceChannelId || null;
}

export function checkEmptyVoiceChannels(oldState, newState, client) {
  const guildId = oldState.guild?.id;
  if (!guildId) return;
  const state = getState(guildId);
  if (!state?.voiceChannelId) return;

  if (oldState.member?.id === client.user?.id && !newState.channelId) {
    destroyState(guildId);
    return;
  }

  const vc = oldState.guild.channels.cache.get(state.voiceChannelId);
  if (!vc) { destroyState(guildId); return; }

  const humans = vc.members.filter(m => !m.user.bot);
  if (humans.size === 0) {
    state.textChannel?.send('🔇 الروم فاضي، راح أطلع. وداعاً! 👋').catch(() => {});
    destroyState(guildId);
  }
}
