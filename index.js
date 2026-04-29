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
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus
} = require("@discordjs/voice");

const ytSearch = require("yt-search");
const playdl = require("play-dl");

/* ===== KEEP ALIVE ===== */
require("http")
  .createServer((req, res) => res.end("OK"))
  .listen(process.env.PORT || 3000, () => {
    console.log("🌐 Render active");
  });

/* ===== حماية ===== */
process.on("unhandledRejection", (err) => console.log("❌", err));
process.on("uncaughtException", (err) => console.log("❌", err));

if (!process.env.TOKEN) {
  console.log("❌ TOKEN MISSING");
  process.exit(1);
}

/* ===== CLIENT ===== */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

/* ===== STATE ===== */
const music = new Map();
let cache = [];

/* ===== MUSIC ===== */
function get(vcId) {
  if (!music.has(vcId)) {
    music.set(vcId, {
      queue: [],
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
      }),
      connection: null,
      text: null
    });
  }
  return music.get(vcId);
}

/* ===== STREAM ===== */
async function stream(url) {
  const s = await playdl.stream(url, { quality: 2 });
  return s.stream;
}

/* ===== PLAY ===== */
async function play(vcId) {
  const d = music.get(vcId);
  if (!d || !d.queue.length) return;

  let audio;
  try {
    audio = await stream(d.queue[0]);
  } catch (e) {
    console.log("⚠️ stream error");
    d.queue.shift();
    return play(vcId);
  }

  const resource = createAudioResource(audio, {
    inlineVolume: false
  });

  d.player.play(resource);
  d.connection.subscribe(d.player);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`skip_${vcId}`).setLabel("⏭").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stop_${vcId}`).setLabel("⏹").setStyle(ButtonStyle.Danger)
  );

  d.text?.send({ content: "🎧 تشغيل", components: [row] })
    .then(m => setTimeout(() => m.delete().catch(() => {}), 7000));

  d.player.removeAllListeners();

  d.player.once(AudioPlayerStatus.Idle, () => {
    d.queue.shift();
    play(vcId);
  });

  d.player.on("error", (err) => {
    console.log("❌ player error", err);
    d.queue.shift();
    play(vcId);
  });
}

/* ===== SEARCH ===== */
async function search(q) {
  const r = await ytSearch(q);
  return r.videos.length ? r.videos[0].url : null;
}

/* ===== PANEL ===== */
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

async function sendPanel(ch) {
  const members = await ch.guild.members.fetch();
  cache = members.filter(m => !m.user.bot).map(m => m);

  const max = Math.ceil(cache.length / 25) - 1;

  await ch.send({
    content: "📋 لوحة التحكم",
    components: [
      new ActionRowBuilder().addComponents(menu(0)),
      nav(0, max)
    ]
  });
}

/* ===== READY ===== */
client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in ${client.user.tag}`);
  setInterval(() => console.log("💓 alive"), 300000);
});

/* ===== MESSAGE ===== */
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  if (msg.content === "!setpanel") {
    sendPanel(msg.channel);
    return msg.reply("✅ تم ربط اللوحة");
  }

  if (msg.content.startsWith("!play")) {
    const q = msg.content.slice(6);
    const vc = msg.member.voice.channel;

    if (!vc) return msg.reply("ادخل روم صوتي");

    const url = await search(q);
    if (!url) return msg.reply("ما لقيت شيء");

    const d = get(vc.id);

    const conn = joinVoiceChannel({
      channelId: vc.id,
      guildId: vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator,
      selfDeaf: false
    });

    try {
      await entersState(conn, VoiceConnectionStatus.Ready, 15000);
    } catch {
      conn.destroy();
      return msg.reply("❌ فشل الاتصال الصوتي");
    }

    d.connection = conn;
    d.text = msg.channel;
    d.queue.push(url);

    if (d.queue.length === 1) play(vc.id);

    msg.reply("🎶 تم التشغيل");
  }
});

/* ===== BUTTONS ===== */
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;

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
});

/* ===== CLEAN ===== */
client.on("voiceStateUpdate", (oldState) => {
  const vcId = oldState.channelId;
  if (!vcId) return;

  const d = music.get(vcId);
  if (!d) return;

  const members = oldState.channel?.members.filter(m => !m.user.bot).size;

  if (oldState.id === client.user.id || members === 0) {
    d.queue = [];
    d.player.stop();
    music.delete(vcId);
  }
});

client.login(process.env.TOKEN);
