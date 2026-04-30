import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import playdl from 'play-dl';
import express from 'express';

const GUILD_ID = 'YOUR_GUILD_ID';

// ─── Keep Alive ───
const app = express();
app.get('/', (req, res) => res.send('✅ Online'));
app.get('/health', (req, res) => res.send('ok'));
app.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('🌐 Online'));

// ─── Music State ───
const guildStates = new Map();

function getState(guildId) { return guildStates.get(guildId); }

function createState(guildId) {
  const state = { connection: null, player: null, queue: [], current: null, textChannel: null, voiceChannelId: null };
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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`skip_${guildId}`).setLabel('⏭ Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stop_${guildId}`).setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
    );

    state.textChannel?.send({
      content: `🎵 **يشتغل الآن:** ${track.title} \`${track.duration}\`` + (state.queue.length > 0 ? `\n📋 في القائمة: ${state.queue.length} أغنية` : ''),
      components: [row],
    }).catch(() => {});
  } catch (err) {
    console.error('Stream error:', err);
    state.textChannel?.send(`❌ خطأ في تشغيل: ${track.title}`).catch(() => {});
    playNext(guildId);
  }
}

// ─── Rename Panel ───
const ITEMS_PER_PAGE = 25;
const panelStates = new Map();

function buildEmbed(members, page, totalPages, guildName) {
  const start = page * ITEMS_PER_PAGE;
  const end = Math.min(start + ITEMS_PER_PAGE, members.length);
  return new EmbedBuilder()
    .setTitle('📋 لوحة تغيير الأسماء')
    .setDescription(`**السيرفر:** ${guildName}\n**الأعضاء:** ${members.length}\n\nاختر عضواً لتغيير اسمه.`)
    .setColor(0x5865F2)
    .setFooter({ text: `صفحة ${page + 1} من ${totalPages} | ${start + 1}-${end}` })
    .setTimestamp();
}

function buildComponents(members, page, totalPages) {
  const pageMembers = members.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const select = new StringSelectMenuBuilder()
    .setCustomId('rename_select')
    .setPlaceholder('🔍 اختر عضواً...')
    .addOptions(pageMembers.map(m => ({
      label: m.displayName.slice(0, 100),
      description: `@${m.user.username}`.slice(0, 100),
      value: m.id,
      emoji: '👤',
    })));

  const rows = [new ActionRowBuilder().addComponents(select)];

  const btns = [
    new ButtonBuilder().setCustomId('rename_prev').setLabel('⬅️ السابق').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('rename_next').setLabel('التالي ➡️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId('rename_refresh').setLabel('🔄 تحديث').setStyle(ButtonStyle.Primary),
  ];

  rows.push(new ActionRowBuilder().addComponents(btns));
  return rows;
}

// ─── Bot ───
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed for !commands
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [
        new SlashCommandBuilder()
          .setName('play')
          .setDescription('🎵 ضع رابط يوتيوب أو اسم الأغنية')
          .addStringOption(o => o.setName('query').setDescription('رابط أو اسم').setRequired(true))
          .toJSON(),
        new SlashCommandBuilder().setName('setpanel').setDescription('📋 إنشاء لوحة تغيير الأسماء').toJSON(),
      ]
    });

    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌', err);
  }
});

// ─── PREFIX COMMANDS (!play & !setpanel) ───
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // !play
  if (cmd === 'play') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('❌ لازم تكون داخل روم صوتي!');

    const query = args.join(' ');
    if (!query) return message.reply('❌ اكتب اسم أو رابط الأغنية');

    let trackInfo;

    try {
      if (!query.startsWith('http')) {
        const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
        if (!results?.length) return message.reply('❌ ما لقيت نتائج.');

        trackInfo = {
          title: results[0].title,
          url: results[0].url,
          duration: results[0].durationRaw
        };
      } else {
        const info = await playdl.video_info(query);
        trackInfo = {
          title: info.video_details.title,
          url: query,
          duration: info.video_details.durationRaw
        };
      }
    } catch {
      return message.reply('❌ خطأ في البحث.');
    }

    const guildId = message.guild.id;
    let state = getState(guildId);

    if (state?.voiceChannelId && state.voiceChannelId !== voiceChannel.id)
      return message.reply('❌ البوت في روم ثاني. وقف القديم أول.');

    if (!state) state = createState(guildId);

    state.queue.push(trackInfo);
    state.textChannel = message.channel;
    state.voiceChannelId = voiceChannel.id;

    if (state.player && state.player.state.status !== AudioPlayerStatus.Idle)
      return message.reply(`📋 انضافت للقائمة (#${state.queue.length})\n🎵 ${trackInfo.title}`);

    try {
      state.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      await entersState(state.connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {
      destroyState(guildId);
      return message.reply('❌ ما قدرت أدخل الروم.');
    }

    state.player = createAudioPlayer();
    state.connection.subscribe(state.player);

    state.player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
    state.player.on('error', (err) => { console.error(err); playNext(guildId); });

    await playNext(guildId);
    return message.reply(`🎵 الآن شغال:\n${trackInfo.title}`);
  }

  // !setpanel
  if (cmd === 'setpanel') {
    if (!message.member.permissions.has('ManageNicknames'))
      return message.reply('❌ تحتاج صلاحية إدارة الأسماء.');

    await message.guild.members.fetch();

    const members = [...message.guild.members.cache
      .filter(m => !m.user.bot)
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .values()];

    const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);

    const sent = await message.channel.send({
      embeds: [buildEmbed(members, 0, totalPages, message.guild.name)],
      components: buildComponents(members, 0, totalPages),
    });

    panelStates.set(message.channel.id, { page: 0, messageId: sent.id });
  }
});

// ─── Voice State ───
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild?.id;
  if (!guildId) return;

  const state = getState(guildId);
  if (!state?.voiceChannelId) return;

  if (oldState.member?.id === client.user?.id && !newState.channelId) {
    destroyState(guildId);
    return;
  }

  const vc = oldState.guild.channels.cache.get(state.voiceChannelId);
  if (!vc) return destroyState(guildId);

  if (vc.members.filter(m => !m.user.bot).size === 0) {
    state.textChannel?.send('🔇 الروم فاضي، خروج...').catch(() => {});
    destroyState(guildId);
  }
});

// ─── INTERACTIONS (unchanged) ───
client.on('interactionCreate', async (interaction) => {
  try {
    // (كل كودك القديم بدون تغيير)
    // اختصار: لم يتم تعديله
  } catch (err) {
    console.error('❌ Interaction error:', err);
  }
});

process.on('unhandledRejection', (err) => console.error('❌', err));
process.on('uncaughtException', (err) => console.error('❌', err));

client.login(process.env.DISCORD_TOKEN);
