import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import playdl from 'play-dl';
import express from 'express';

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
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [
        new SlashCommandBuilder().setName('play').setDescription('🎵 ضع رابط يوتيوب أو اسم الأغنية').addStringOption(o => o.setName('query').setDescription('رابط أو اسم').setRequired(true)).toJSON(),
        new SlashCommandBuilder().setName('setpanel').setDescription('📋 إنشاء لوحة تغيير الأسماء').toJSON(),
      ]
    });
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌', err);
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = oldState.guild?.id;
  if (!guildId) return;
  const state = getState(guildId);
  if (!state?.voiceChannelId) return;
  if (oldState.member?.id === client.user?.id && !newState.channelId) { destroyState(guildId); return; }
  const vc = oldState.guild.channels.cache.get(state.voiceChannelId);
  if (!vc) { destroyState(guildId); return; }
  if (vc.members.filter(m => !m.user.bot).size === 0) {
    state.textChannel?.send('🔇 الروم فاضي، وداعاً! 👋').catch(() => {});
    destroyState(guildId);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {

    // ── Play ──
    if (interaction.isChatInputCommand() && interaction.commandName === 'play') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) return interaction.reply({ content: '❌ لازم تكون داخل روم صوتي!', ephemeral: true });
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      let trackInfo;
      try {
        if (!query.startsWith('http')) {
          const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
          if (!results?.length) return interaction.editReply('❌ ما لقيت نتائج.');
          trackInfo = { title: results[0].title, url: results[0].url, duration: results[0].durationRaw };
        } else {
          const info = await playdl.video_info(query);
          trackInfo = { title: info.video_details.title, url: query, duration: info.video_details.durationRaw };
        }
      } catch {
        return interaction.editReply('❌ خطأ في البحث.');
      }
      const guildId = interaction.guildId;
      let state = getState(guildId);
      if (state?.voiceChannelId && state.voiceChannelId !== voiceChannel.id)
        return interaction.editReply('❌ البوت في روم ثاني. استخدم Stop أولاً.');
      if (!state) state = createState(guildId);
      state.queue.push(trackInfo);
      state.textChannel = interaction.channel;
      state.voiceChannelId = voiceChannel.id;
      if (state.player && state.player.state.status !== AudioPlayerStatus.Idle)
        return interaction.editReply(`📋 **أضيفت للقائمة (#${state.queue.length})**\n🎵 ${trackInfo.title} \`${trackInfo.duration}\``);
      try {
        state.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true });
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
        } catch { destroyState(guildId); }
      });
      state.player = createAudioPlayer();
      state.connection.subscribe(state.player);
      state.player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
      state.player.on('error', (err) => { console.error(err); playNext(guildId); });
      await playNext(guildId);
      return interaction.editReply(`🎵 **يشتغل الآن**\n${state.current?.title} \`${state.current?.duration}\``);
    }

    // ── SetPanel ──
    else if (interaction.isChatInputCommand() && interaction.commandName === 'setpanel') {
      if (!interaction.member?.permissions?.has('ManageNicknames'))
        return interaction.reply({ content: '❌ تحتاج صلاحية إدارة الأسماء.', ephemeral: true });
      await interaction.guild.members.fetch();
      const members = [...interaction.guild.members.cache.filter(m => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName)).values()];
      const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
      const msg = await interaction.reply({ embeds: [buildEmbed(members, 0, totalPages, interaction.guild.name)], components: buildComponents(members, 0, totalPages), fetchReply: true });
      panelStates.set(interaction.channelId, { page: 0 });
    }

    // ── Select Menu ──
    else if (interaction.isStringSelectMenu() && interaction.customId === 'rename_select') {
      const memberId = interaction.values[0];
      let target;
      try { target = await interaction.guild.members.fetch(memberId); }
      catch { return interaction.reply({ content: '❌ ما لقيت العضو.', ephemeral: true }); }
      if (target.roles.highest.position >= interaction.guild.members.me.roles.highest.position)
        return interaction.reply({ content: `❌ رتبة ${target.displayName} أعلى مني.`, ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`rename_modal_${memberId}`).setTitle(`تغيير: ${target.displayName.slice(0, 30)}`);
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('new_name').setLabel('الاسم الجديد').setStyle(TextInputStyle.Short).setValue(target.displayName).setMaxLength(32).setRequired(true)
      ));
      await interaction.showModal(modal);
    }

    // ── Modal ──
    else if (interaction.isModalSubmit() && interaction.customId.startsWith('rename_modal_')) {
      const memberId = interaction.customId.replace('rename_modal_', '');
      const newName = interaction.fields.getTextInputValue('new_name').trim();
      let target;
      try { target = await interaction.guild.members.fetch(memberId); }
      catch { return interaction.reply({ content: '❌ ما لقيت العضو.', ephemeral: true }); }
      try {
        const oldName = target.displayName;
        await target.setNickname(newName);
        await interaction.reply({ content: `✅ تم تغيير **${oldName}** إلى **${newName}**`, ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      } catch {
        await interaction.reply({ content: '❌ فشل تغيير الاسم.', ephemeral: true });
      }
    }

    // ── Buttons ──
    else if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId === 'rename_next' || customId === 'rename_prev' || customId === 'rename_refresh') {
        await interaction.guild.members.fetch();
        const members = [...interaction.guild.members.cache.filter(m => !m.user.bot).sort((a, b) => a.displayName.localeCompare(b.displayName)).values()];
        const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
        const state = panelStates.get(interaction.channelId) || { page: 0 };
        if (customId === 'rename_next') state.page = Math.min(state.page + 1, totalPages - 1);
        else if (customId === 'rename_prev') state.page = Math.max(state.page - 1, 0);
        panelStates.set(interaction.channelId, state);
        await interaction.update({ embeds: [buildEmbed(members, state.page, totalPages, interaction.guild.name)], components: buildComponents(members, state.page, totalPages) });
      }

      else if (customId.startsWith('skip_')) {
        const guildId = customId.replace('skip_', '');
        const state = getState(guildId);
        if (!state) return interaction.reply({ content: '❌ مافيه شي يشتغل.', ephemeral: true });
        if (interaction.member?.voice?.channelId !== state.voiceChannelId)
          return interaction.reply({ content: '❌ لازم تكون بنفس الروم.', ephemeral: true });
        state.player.stop();
        await interaction.reply({ content: '⏭ تم التخطي!', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      }

      else if (customId.startsWith('stop_')) {
        const guildId = customId.replace('stop_', '');
        const state = getState(guildId);
        if (!state) return interaction.reply({ content: '❌ مافيه شي يشتغل.', ephemeral: true });
        if (interaction.member?.voice?.channelId !== state.voiceChannelId)
          return interaction.reply({ content: '❌ لازم تكون بنفس الروم.', ephemeral: true });
        destroyState(guildId);
        await interaction.reply({ content: '⏹ تم الإيقاف.', ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      }
    }

  } catch (err) {
    console.error('❌ Interaction error:', err);
  }
});

process.on('unhandledRejection', (err) => console.error('❌', err));
process.on('uncaughtException', (err) => console.error('❌', err));

client.login(process.env.DISCORD_TOKEN);
