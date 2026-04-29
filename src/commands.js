import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('🎵 تشغيل أغنية')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('رابط يوتيوب أو اسم الأغنية')
          .setRequired(true)
      ),
  },
  {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('⏭ تخطي الأغنية الحالية'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('⏹ إيقاف التشغيل ومسح القائمة'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('queue')
      .setDescription('📋 عرض قائمة الأغاني'),
  },
  {
    data: new SlashCommandBuilder()
      .setName('setpanel')
      .setDescription('📋 إنشاء لوحة تغيير الأسماء'),
  },
];
