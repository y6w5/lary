import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import playdl from 'play-dl';
import express from 'express';

const GUILD_ID = '1205605710319194122';

// ─── Keep Alive ───
const app = express();
app.get('/', (req, res) => res.send('✅ Online'));
app.get('/health', (req, res) => res.send('ok'));
app.listen(process.env.PORT || 10000, '0.0.0.0');

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
    return destroyState(guildId);
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
      content: `🎵 ${track.title}`,
      components: [row],
    });

  } catch {
    playNext(guildId);
  }
}

// ─── Rename Panel ───
const ITEMS_PER_PAGE = 25;
const panelStates = new Map();

function buildEmbed(members, page, totalPages, guildName) {
  return new EmbedBuilder()
    .setTitle('📋 لوحة تغيير الأسماء')
    .setDescription(`السيرفر: ${guildName}\nعدد الأعضاء: ${members.length}`)
    .setFooter({ text: `صفحة ${page + 1}/${totalPages}` });
}

function buildComponents(members, page, totalPages) {
  const slice = members.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const select = new StringSelectMenuBuilder()
    .setCustomId('rename_select')
    .addOptions(slice.map(m => ({
      label: m.displayName,
      value: m.id,
    })));

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rename_prev').setLabel('⬅️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rename_next').setLabel('➡️').setStyle(ButtonStyle.Secondary)
  );

  return [
    new ActionRowBuilder().addComponents(select),
    nav
  ];
}

// ─── Bot ───
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

client.once('clientReady', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [
      new SlashCommandBuilder().setName('play').setDescription('تشغيل').addStringOption(o => o.setName('query').setDescription('رابط أو اسم').setRequired(true)),
      new SlashCommandBuilder().setName('setpanel').setDescription('لوحة'),
    ]
  });
});

// ─── MESSAGE COMMANDS (اللي طلبته فقط) ───
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  // !play
  if (msg.content.startsWith('!play')) {
    const query = msg.content.slice(6).trim();
    const vc = msg.member.voice.channel;

    if (!vc) return msg.reply('❌ ادخل روم صوتي');

    let track;

    try {
      const r = await playdl.search(query, { limit: 1 });
      if (!r.length) return msg.reply('❌ ما لقيت');

      track = { title: r[0].title, url: r[0].url };
    } catch {
      return msg.reply('❌ خطأ');
    }

    const guildId = msg.guild.id;
    let state = getState(guildId);
    if (!state) state = createState(guildId);

    state.queue.push(track);
    state.textChannel = msg.channel;
    state.voiceChannelId = vc.id;

    if (!state.connection) {
      state.connection = joinVoiceChannel({
        channelId: vc.id,
        guildId,
        adapterCreator: msg.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      await entersState(state.connection, VoiceConnectionStatus.Ready, 10000);

      state.player = createAudioPlayer();
      state.connection.subscribe(state.player);

      state.player.on(AudioPlayerStatus.Idle, () => playNext(guildId));
    }

    if (state.queue.length === 1) playNext(guildId);

    msg.reply('🎶 تم');
  }

  // !setpanel
  if (msg.content === '!setpanel') {
    await msg.guild.members.fetch();

    const members = [...msg.guild.members.cache.filter(m => !m.user.bot).values()];
    const total = Math.ceil(members.length / ITEMS_PER_PAGE);

    await msg.channel.send({
      embeds: [buildEmbed(members, 0, total, msg.guild.name)],
      components: buildComponents(members, 0, total)
    });

    panelStates.set(msg.channel.id, { page: 0 });

    msg.reply('✅ تم');
  }
});

// ─── باقي الكود (ما تغير) ───
client.on('interactionCreate', async (interaction) => {

  if (interaction.isButton()) {
    const [a, id] = interaction.customId.split("_");
    const state = getState(id);
    if (!state) return;

    if (a === "skip") {
      state.player.stop();
      return interaction.reply({ content: "⏭", ephemeral: true });
    }

    if (a === "stop") {
      destroyState(id);
      return interaction.reply({ content: "⏹", ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu()) {
    const id = interaction.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`rename_${id}`)
      .setTitle("تغيير الاسم");

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("الاسم")
          .setStyle(TextInputStyle.Short)
      )
    );

    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit()) {
    const id = interaction.customId.split("_")[1];
    const name = interaction.fields.getTextInputValue("name");

    const member = await interaction.guild.members.fetch(id);
    await member.setNickname(name);

    interaction.reply({ content: "تم", ephemeral: true });
  }
});

client.on('voiceStateUpdate', (oldState) => {
  const state = getState(oldState.guild.id);
  if (!state) return;

  const vc = oldState.guild.channels.cache.get(state.voiceChannelId);
  if (!vc) return;

  if (vc.members.filter(m => !m.user.bot).size === 0) {
    destroyState(oldState.guild.id);
  }
});

client.login(process.env.DISCORD_TOKEN);
