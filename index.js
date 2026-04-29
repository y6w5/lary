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
  ButtonStyle
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require("@discordjs/voice");

const ytSearch = require("yt-search");
const ytdl = require("ytdl-core");

require("http")
  .createServer((req, res) => res.end("OK"))
  .listen(process.env.PORT || 3000, () => {
    console.log("🌐 Render active");
  });

const TOKEN = process.env.TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================= STATE =================
const panels = new Map();
const music = new Map();
let cache = [];

// ================= MUSIC =================
function get(vcId) {
  if (!music.has(vcId)) {
    music.set(vcId, {
      queue: [],
      player: createAudioPlayer(),
      connection: null,
      text: null
    });
  }
  return music.get(vcId);
}

function play(vcId) {
  const d = music.get(vcId);
  if (!d || !d.queue.length) return;

  const stream = ytdl(d.queue[0], { filter: "audioonly" });
  const res = createAudioResource(stream);

  d.player.play(res);
  d.connection.subscribe(d.player);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`skip_${vcId}`).setLabel("⏭").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stop_${vcId}`).setLabel("⏹").setStyle(ButtonStyle.Danger)
  );

  d.text?.send({ content: "🎧 تشغيل", components: [row] });

  d.player.once(AudioPlayerStatus.Idle, () => {
    d.queue.shift();
    play(vcId);
  });
}

async function search(q) {
  const r = await ytSearch(q);
  if (!r.videos.length) return null;
  return r.videos[0].url;
}

// ================= PANEL =================
function page(p) {
  return cache.slice(p * 25, p * 25 + 25);
}

function menu(p) {
  return new StringSelectMenuBuilder()
    .setCustomId(`select_${p}`)
    .setPlaceholder("اختار عضو")
    .addOptions(page(p).map(m => ({
      label: m.user.username,
      value: m.id
    })));
}

function nav(p, max) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`prev_${p}`).setLabel("◀").setStyle(2).setDisabled(p === 0),
    new ButtonBuilder().setCustomId(`next_${p}`).setLabel("▶").setStyle(2).setDisabled(p >= max)
  );
}

async function sendPanel(channel) {
  const members = await channel.guild.members.fetch();
  cache = members.filter(m => !m.user.bot).map(m => m);

  const max = Math.ceil(cache.length / 25) - 1;

  await channel.send({
    content: "📋 لوحة التحكم",
    components: [
      new ActionRowBuilder().addComponents(menu(0)),
      nav(0, max)
    ]
  });
}

// ================= READY =================
client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in ${client.user.tag}`);

  setInterval(() => {
    console.log("💓 alive");
  }, 5 * 60 * 1000);
});

// ================= MESSAGE =================
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // setpanel (يمسح القديم ويعيد)
  if (msg.content === "!setpanel") {
    panels.set(msg.guild.id, msg.channel);

    const members = await msg.guild.members.fetch();
    cache = members.filter(m => !m.user.bot).map(m => m);

    const max = Math.ceil(cache.length / 25) - 1;

    await msg.channel.send({
      content: "📋 لوحة التحكم",
      components: [
        new ActionRowBuilder().addComponents(menu(0)),
        nav(0, max)
      ]
    });

    return msg.reply("✅ تم ربط اللوحة بهذا الروم");
  }

  // play
  if (msg.content.startsWith("!play")) {
    const q = msg.content.split(" ").slice(1).join(" ");
    const vc = msg.member.voice.channel;

    if (!vc) return msg.reply("ادخل روم صوتي");

    const url = await search(q);
    if (!url) return msg.reply("ما لقيت شيء");

    const data = get(vc.id);

    const conn = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator
    });

    data.connection = conn;
    data.text = msg.channel;
    data.queue.push(url);

    if (data.queue.length === 1) play(vc.id);

    msg.reply("🎶 تم التشغيل");
  }
});

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async (i) => {

  if (i.isButton()) {
    const [a, id] = i.customId.split("_");
    const d = music.get(id);
    if (!d) return;

    if (a === "skip") {
      d.player.stop();
      return i.reply({ content: "skip", ephemeral: true });
    }

    if (a === "stop") {
      d.queue = [];
      d.player.stop();
      return i.reply({ content: "stop", ephemeral: true });
    }
  }

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

  if (i.isModalSubmit()) {
    const name = i.fields.getTextInputValue("name");
    const id = i.customId.split("_")[1];

    const m = await i.guild.members.fetch(id);
    const bot = i.guild.members.me;

    if (m.roles.highest.position >= bot.roles.highest.position) {
      return i.reply({ content: "❌", ephemeral: true });
    }

    await m.setNickname(name);
    return i.reply({ content: "تم", ephemeral: true });
  }
});

// ================= SAFETY =================
client.on("voiceStateUpdate", (oldState) => {
  const vcId = oldState.channelId;
  if (!vcId) return;

  const data = music.get(vcId);
  if (!data) return;

  const members = oldState.channel?.members.filter(m => !m.user.bot).size;

  if (oldState.id === client.user.id || members === 0) {
    data.queue = [];
    data.player.stop();
    music.delete(vcId);
  }
});

client.login(TOKEN);
