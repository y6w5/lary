import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 ضع رابط يوتيوب أو اسم الأغنية')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('رابط يوتيوب أو اسم الأغنية')
          .setRequired(true)
      ),
  },
  {
    data: new SlashCommandBuilder()
      .setName('setpanel')
      .setDescription('📋 إنشاء لوحة تغيير الأسماء'),
  },
];
