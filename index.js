const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  NoSubscriberBehavior
} = require("@discordjs/voice");

const playdl = require("play-dl");

/* ====== BASIC ====== */
require("http")
  .createServer((req, res) => res.end("OK"))
  .listen(process.env.PORT || 3000);

if (!process.env.TOKEN || !process.env.CLIENT_ID) {
  console.log("❌ حط TOKEN و CLIENT_ID في Render");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

/* ====== COMMANDS ====== */
const commands = [
  new SlashCommandBuilder().setName("play").setDescription("تشغيل اغنية").addStringOption(o => o.setName("song").setDescription("اسم او رابط").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("تخطي"),
  new SlashCommandBuilder().setName("stop").setDescription("ايقاف"),
  new SlashCommandBuilder().setName("setpanel").setDescription("انشاء لوحة الاسماء")
].map(c => c.toJSON());

/* ====== REGISTER ====== */
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );

  console.log("✅ Slash Commands جاهزة");
});

/* ====== STATE ====== */
const music = new Map();
let membersCache = [];

/* ====== MUSIC ====== */
function get(id) {
  if (!music.has(id)) {
    music.set(id, {
      queue: [],
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
      }),
      connection: null,
      text: null
    });
  }
  return music.get(id);
}

async function play(vcId) {
  const d = music.get(vcId);
  if (!d || !d.queue.length) return;

  const s = await playdl.stream(d.queue[0]);
  const res = createAudioResource(s.stream);

  d.player.play(res);
  d.connection.subscribe(d.player);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`skip_${vcId}`).setLabel("⏭").setStyle(1),
    new ButtonBuilder().setCustomId(`stop_${vcId}`).setLabel("⏹").setStyle(4)
  );

  d.text.send({ content: "🎧 تشغيل", components: [row] });

  d.player.once(AudioPlayerStatus.Idle, () => {
    d.queue.shift();
    play(vcId);
  });
}

/* ====== PANEL ====== */
function page(p) {
  return membersCache.slice(p * 25, p * 25 + 25);
}

function menu(p) {
  return new StringSelectMenuBuilder()
    .setCustomId(`sel_${p}`)
    .addOptions(page(p).map(m => ({
      label: m.user.username,
      value: m.id
    })));
}

function nav(p, max) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`prev_${p}`).setLabel("◀").setStyle(2),
    new ButtonBuilder().setCustomId(`next_${p}`).setLabel("▶").setStyle(2)
  );
}

async function panel(channel) {
  const members = await channel.guild.members.fetch();
  membersCache = members.filter(m => !m.user.bot).map(m => m);

  const max = Math.ceil(membersCache.length / 25) - 1;

  channel.send({
    content: "📋 لوحة التحكم",
    components: [
      new ActionRowBuilder().addComponents(menu(0)),
      nav(0, max)
    ]
  });
}

/* ====== INTERACTIONS ====== */
client.on(Events.InteractionCreate, async (i) => {

  /* ===== COMMANDS ===== */
  if (i.isChatInputCommand()) {

    if (i.commandName === "setpanel") {
      await panel(i.channel);
      return i.reply({ content: "✅ تم", ephemeral: true });
    }

    if (i.commandName === "play") {
      const q = i.options.getString("song");
      const vc = i.member.voice.channel;

      if (!vc) return i.reply({ content: "❌ ادخل روم صوتي", ephemeral: true });

      const d = get(vc.id);

      const conn = joinVoiceChannel({
        channelId: vc.id,
        guildId: vc.guild.id,
        adapterCreator: vc.guild.voiceAdapterCreator
      });

      try {
        await entersState(conn, VoiceConnectionStatus.Ready, 15000);
      } catch {
        return i.reply("❌ فشل الاتصال");
      }

      d.connection = conn;
      d.text = i.channel;
      d.queue.push(q);

      if (d.queue.length === 1) play(vc.id);

      return i.reply("🎶 تم");
    }

    if (i.commandName === "skip") {
      const vc = i.member.voice.channel;
      if (!vc) return i.reply("❌");

      const d = music.get(vc.id);
      if (!d) return i.reply("❌");

      d.player.stop();
      return i.reply("⏭");
    }

    if (i.commandName === "stop") {
      const vc = i.member.voice.channel;
      if (!vc) return i.reply("❌");

      const d = music.get(vc.id);
      if (!d) return i.reply("❌");

      d.queue = [];
      d.player.stop();
      return i.reply("⏹");
    }
  }

  /* ===== BUTTONS ===== */
  if (i.isButton()) {
    const [a, id] = i.customId.split("_");
    const d = music.get(id);
    if (!d) return;

    if (a === "skip") {
      d.player.stop();
      return i.reply({ content: "⏭", ephemeral: true });
    }

    if (a === "stop") {
      d.queue = [];
      d.player.stop();
      return i.reply({ content: "⏹", ephemeral: true });
    }
  }

  /* ===== SELECT ===== */
  if (i.isStringSelectMenu()) {
    const id = i.values[0];

    const modal = new ModalBuilder()
      .setCustomId(`rename_${id}`)
      .setTitle("تغيير الاسم");

    const input = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("الاسم")
      .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return i.showModal(modal);
  }

  /* ===== RENAME ===== */
  if (i.isModalSubmit()) {
    const name = i.fields.getTextInputValue("name");
    const id = i.customId.split("_")[1];

    const m = await i.guild.members.fetch(id);
    const bot = i.guild.members.me;

    if (m.roles.highest.position >= bot.roles.highest.position) {
      return i.reply({ content: "❌ رتبة أعلى", ephemeral: true });
    }

    await m.setNickname(name);
    return i.reply({ content: "✅ تم", ephemeral: true });
  }
});

/* ===== CLEAN ===== */
client.on("voiceStateUpdate", (oldState) => {
  const vc = oldState.channel;
  if (!vc) return;

  const d = music.get(vc.id);
  if (!d) return;

  const users = vc.members.filter(m => !m.user.bot).size;

  if (users === 0) {
    d.queue = [];
    d.player.stop();
    music.delete(vc.id);
  }
});

client.login(process.env.TOKEN);
