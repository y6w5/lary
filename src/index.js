import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';

import playdl from 'play-dl';
import express from 'express';

const GUILD_ID = '1205605710319194122';

// ─── Keep Alive ───
const app = express();
app.get('/', (req, res) => res.send('✅ Online'));
app.listen(process.env.PORT || 10000, '0.0.0.0');

// ─── STATE ───
const guildStates = new Map();
const panelStates = new Map();

function getState(id) {
  return guildStates.get(id);
}

function createState(id) {
  const state = {
    connection: null,
    player: null,
    queue: [],
    current: null,
    textChannel: null,
    voiceChannelId: null
  };
  guildStates.set(id, state);
  return state;
}

function destroyState(id) {
  const s = guildStates.get(id);
  if (!s) return;
  try { s.player?.stop(true); } catch {}
  try { s.connection?.destroy(); } catch {}
  guildStates.delete(id);
}

// ─── PLAY SYSTEM ───
async function playNext(guildId) {
  const state = getState(guildId);
  if (!state) return;

  if (!state.queue.length) {
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
      new ButtonBuilder().setCustomId(`skip_${guildId}`).setLabel('⏭').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stop_${guildId}`).setLabel('⏹').setStyle(ButtonStyle.Danger)
    );

    state.textChannel?.send({
      content: `🎵 ${track.title}`,
      components: [row]
    });

  } catch {
    playNext(guildId);
  }
}

// ─── PANEL ───
const ITEMS = 25;

function buildEmbed(members, page, total, guildName) {
  return new EmbedBuilder()
    .setTitle('📋 لوحة الأسماء')
    .setDescription(`السيرفر: ${guildName}\nالأعضاء: ${members.length}`)
    .setFooter({ text: `صفحة ${page + 1}/${total}` });
}

function buildComponents(members, page, total) {
  const slice = members.slice(page * ITEMS, (page + 1) * ITEMS);

  const select = new StringSelectMenuBuilder()
    .setCustomId('rename_select')
    .addOptions(slice.map(m => ({
      label: m.displayName,
      value: m.id
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

// ─── BOT ───
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// ─── READY ───
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [
      new SlashCommandBuilder()
        .setName('play')
        .setDescription('تشغيل')
        .addStringOption(o => o.setName('query').setRequired(true)),

      new SlashCommandBuilder()
        .setName('setpanel')
        .setDescription('لوحة')
    ]
  });
});

// ─── MESSAGE COMMANDS (! + /) ───
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;

  const content = msg.content;

  // ─── !play ───
  if (content.startsWith('!play')) {
    const query = content.slice(6).trim();
    const vc = msg.member.voice.channel;
    if (!vc) return msg.reply('❌ ادخل روم صوتي');

    const r = await playdl.search(query, { limit: 1 });
    if (!r.length) return msg.reply('❌ ما لقيت');

    const track = {
      title: r[0].title,
      url: r[0].url
    };

    let state = getState(msg.guild.id);
    if (!state) state = createState(msg.guild.id);

    state.queue.push(track);
    state.textChannel = msg.channel;
    state.voiceChannelId = vc.id;

    if (!state.connection) {
      state.connection = joinVoiceChannel({
        channelId: vc.id,
        guildId: msg.guild.id,
        adapterCreator: msg.guild.voiceAdapterCreator
      });

      await entersState(state.connection, VoiceConnectionStatus.Ready, 10000);

      state.player = createAudioPlayer();
      state.connection.subscribe(state.player);

      state.player.on(AudioPlayerStatus.Idle, () => playNext(msg.guild.id));
    }

    if (state.queue.length === 1) playNext(msg.guild.id);

    return msg.reply('🎶 تم التشغيل');
  }

  // ─── !setpanel ───
  if (content === '!setpanel') {
    await msg.guild.members.fetch();

    const members = [...msg.guild.members.cache.filter(m => !m.user.bot).values()];
    const total = Math.ceil(members.length / ITEMS);

    await msg.channel.send({
      embeds: [buildEmbed(members, 0, total, msg.guild.name)],
      components: buildComponents(members, 0, total)
    });

    panelStates.set(msg.channel.id, { page: 0 });

    return msg.reply('✅ تم');
  }
});

// ─── INTERACTIONS ───
client.on('interactionCreate', async (i) => {

  if (i.isButton()) {
    const [a, id] = i.customId.split('_');
    const state = getState(id);
    if (!state) return;

    if (a === 'skip') {
      state.player.stop();
      return i.reply({ content: '⏭', ephemeral: true });
    }

    if (a === 'stop') {
      destroyState(id);
      return i.reply({ content: '⏹', ephemeral: true });
    }
  }

  if (i.isStringSelectMenu()) {
    const id = i.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`rename_${id}`)
      .setTitle('تغيير الاسم');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('الاسم')
          .setStyle(TextInputStyle.Short)
      )
    );

    return i.showModal(modal);
  }

  if (i.isModalSubmit()) {
    const id = i.customId.split('_')[1];
    const name = i.fields.getTextInputValue('name');

    const member = await i.guild.members.fetch(id);
    await member.setNickname(name);

    i.reply({ content: 'تم', ephemeral: true });
  }
});

// ─── VOICE CLEAN ───
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
