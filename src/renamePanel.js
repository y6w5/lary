import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from 'discord.js';

const ITEMS_PER_PAGE = 25;
const panelStates = new Map();

export async function createRenamePanel(interaction) {
  await interaction.guild.members.fetch();
  const members = [...interaction.guild.members.cache
    .filter(m => !m.user.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .values()];

  const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
  const embed = buildEmbed(members, 0, totalPages, interaction.guild.name);
  const components = buildComponents(members, 0, totalPages);

  const msg = await interaction.reply({ embeds: [embed], components, fetchReply: true });
  panelStates.set(interaction.channelId, { messageId: msg.id, page: 0 });
}

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

export async function handleRenameSelect(interaction) {
  const memberId = interaction.values[0];
  let target;
  try { target = await interaction.guild.members.fetch(memberId); }
  catch { return interaction.reply({ content: '❌ ما لقيت العضو.', ephemeral: true }); }

  const botMember = interaction.guild.members.me;
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    return interaction.reply({ content: `❌ رتبة **${target.displayName}** أعلى مني.`, ephemeral: true });
  }

  const modal = new ModalBuilder()
    .setCustomId(`rename_modal_${memberId}`)
    .setTitle(`تغيير اسم: ${target.displayName.slice(0, 30)}`);

  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('الاسم الجديد')
      .setStyle(TextInputStyle.Short)
      .setValue(target.displayName)
      .setMaxLength(32)
      .setRequired(true)
  ));

  await interaction.showModal(modal);
}

export async function handleRenameModal(interaction) {
  const memberId = interaction.customId.replace('rename_modal_', '');
  const newName = interaction.fields.getTextInputValue('new_name').trim();
  if (!newName) return interaction.reply({ content: '❌ الاسم فارغ.', ephemeral: true });

  let target;
  try { target = await interaction.guild.members.fetch(memberId); }
  catch { return interaction.reply({ content: '❌ ما لقيت العضو.', ephemeral: true }); }

  const oldName = target.displayName;
  try {
    await target.setNickname(newName, `تغيير بواسطة ${interaction.user.tag}`);
    await interaction.reply({ content: `✅ تم تغيير **${oldName}** إلى **${newName}**`, ephemeral: true });
  } catch {
    await interaction.reply({ content: '❌ فشل تغيير الاسم. تحقق من الصلاحيات.', ephemeral: true });
  }
}

export async function handlePanelPagination(interaction, direction) {
  await interaction.guild.members.fetch();
  const members = [...interaction.guild.members.cache
    .filter(m => !m.user.bot)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .values()];

  const totalPages = Math.ceil(members.length / ITEMS_PER_PAGE);
  const state = panelStates.get(interaction.channelId) || { page: 0 };

  if (direction === 'next') state.page = Math.min(state.page + 1, totalPages - 1);
  else if (direction === 'prev') state.page = Math.max(state.page - 1, 0);

  panelStates.set(interaction.channelId, state);

  await interaction.update({
    embeds: [buildEmbed(members, state.page, totalPages, interaction.guild.name)],
    components: buildComponents(members, state.page, totalPages),
  });
}
