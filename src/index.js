import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { keepAlive } from './keepAlive.js';
import { handleInteraction } from './interactionHandler.js';
import { commands } from './commands.js';
import { checkEmptyVoiceChannels } from './musicManager.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot ready: ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands.map(c => c.data.toJSON()) }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction, client);
  } catch (err) {
    console.error('❌ Interaction error:', err);
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  checkEmptyVoiceChannels(oldState, newState, client);
});

process.on('unhandledRejection', (err) => console.error('❌', err));
process.on('uncaughtException', (err) => console.error('❌', err));

keepAlive();
client.login(process.env.DISCORD_TOKEN);
