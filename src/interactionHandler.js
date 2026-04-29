import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { searchAndPlay, skipTrack, stopPlayback, getQueue, getVoiceChannelId } from './musicManager.js';
import { createRenamePanel, handleRenameSelect, handleRenameModal, handlePanelPagination } from './renamePanel.js';

export async function handleInteraction(interaction, client) {

  // ── Slash Commands ──
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    if (cmd === 'play') {
      await searchAndPlay(interaction, interaction.options.getString('query'));
    }

    else if (cmd === 'setpanel') {
      if (!interaction.member?.permissions?.has('ManageNicknames'))
        return interaction.reply({ content: '❌ تحتاج صلاحية إدارة الأسماء.', ephemeral: true });
      await createRenamePanel(interaction);
    }
  }

  // ── Select Menus ──
  else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'rename_select') await handleRenameSelect(interaction);
  }

  // ── Modals ──
  else if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('rename_modal_')) await handleRenameModal(interaction);
  }

  // ── Buttons ──
  else if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId === 'rename_next') await handlePanelPagination(interaction, 'next');
    else if (customId === 'rename_prev') await handlePanelPagination(interaction, 'prev');
    else if (customId === 'rename_refresh') await handlePanelPagination(interaction, 'refresh');

    else if (customId.startsWith('music_skip_')) {
      const guildId = customId.replace('music_skip_', '');
      const vcId = getVoiceChannelId(guildId);
      if (!vcId) return interaction.reply({ content: '❌ مافيه شي يشتغل.', ephemeral: true });
      if (interaction.member?.voice?.channelId !== vcId)
        return interaction.reply({ content: '❌ لازم تكون بنفس الروم.', ephemeral: true });
      skipTrack(guildId);
      await interaction.reply({ content: '⏭ تم التخطي!', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }

    else if (customId.startsWith('music_stop_')) {
      const guildId = customId.replace('music_stop_', '');
      const vcId = getVoiceChannelId(guildId);
      if (!vcId) return interaction.reply({ content: '❌ مافيه شي يشتغل.', ephemeral: true });
      if (interaction.member?.voice?.channelId !== vcId)
        return interaction.reply({ content: '❌ لازم تكون بنفس الروم.', ephemeral: true });
      stopPlayback(guildId);
      await interaction.reply({ content: '⏹ تم الإيقاف.', ephemeral: true });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    }
  }
}
