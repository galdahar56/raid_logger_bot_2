
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { google } = require('googleapis');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_JSON),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = process.env.SHEET_ID;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const eventCache = new Map();

client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.id === client.user.id) return;
  if (!message.author.bot || message.channel.id !== CHANNEL_ID) return;

  const embed = message.embeds[0];
  if (!embed) return;

  let dungeon = "Unknown";
  let eventTime = "Unknown";
  let runId = "N/A";

  if (embed.description) {
    const dungeonMatch = embed.description.match(/Dungeon[:\-]?\s*(.+)/i);
    if (dungeonMatch) dungeon = dungeonMatch[1].replace(/[*_`~]/g, '').trim();

    const dateMatch = embed.description.match(/Date[:\-]?\s*(.+)/i);
    if (dateMatch) {
      const rawDate = dateMatch[1].replace(/[*_`~]/g, '').trim();
      const parsedDate = new Date(rawDate);
      eventTime = !isNaN(parsedDate)
        ? parsedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
        : rawDate;
    }

    const runIdMatch = embed.description.match(/Run\s*ID[:\-]?\s*(.+)/i);
    if (runIdMatch) runId = runIdMatch[1].replace(/[*_`~]/g, '').trim();
  }

  eventCache.set(message.id, {
    dungeon,
    runId,
    eventTime,
    rolesUsed: {}
  });

  const trackerEmbed = new EmbedBuilder()
    .setTitle('📥 Sign-Up Tracker')
    .setDescription('Click your role to be logged in the signup sheet for this event. You can also undo.')
    .setColor(0x00AE86);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${message.id}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${message.id}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${message.id}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${message.id}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_keyholder_${message.id}`).setLabel('🗝 Key Holder').setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`undo_${message.id}`).setLabel('↩ Undo Signup').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row, row2] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const [action, role, messageId] = interaction.customId.split('_');
  const event = eventCache.get(messageId);
  const username = interaction.user.tag;

  const roleColumns = { tank: 'E', healer: 'F', dps1: 'G', dps2: 'H', keyholder: 'K' };

  if (action === 'signup') {
    if (!event) return interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
    if (event.rolesUsed[role]) return interaction.reply({ content: `❌ The **${role.toUpperCase()}** role is already taken.`, ephemeral: true });
    if (Object.values(event.rolesUsed).includes(username)) return interaction.reply({ content: `❌ You’ve already signed up for this event.`, ephemeral: true });

    if (role === 'keyholder') {
      const hasOtherRole = ['tank', 'healer', 'dps1', 'dps2'].some(r => event.rolesUsed[r] === username);
      if (!hasOtherRole) return interaction.reply({ content: '❌ You must first sign up for another role before claiming Key Holder.', ephemeral: true });
    }

    event.rolesUsed[role] = username;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[username, role.toUpperCase(), event.dungeon, event.runId, event.eventTime, timestamp]] }
    });

    const scheduleData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:Z' });
    const runRow = scheduleData.data.values.findIndex(row => row[0] === event.runId);
    if (runRow !== -1 && roleColumns[role]) {
      const range = `Run_Schedule!${roleColumns[role]}${runRow + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[username]] }
      });
    }

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
  }

  if (action === 'undo') {
    if (!event) return interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });

    const userRole = Object.keys(event.rolesUsed).find(r => event.rolesUsed[r] === username);
    if (!userRole) return interaction.reply({ content: `❌ You haven't signed up for this event.`, ephemeral: true });

    delete event.rolesUsed[userRole];

    const scheduleData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:Z' });
    const runRow = scheduleData.data.values.findIndex(row => row[0] === event.runId);
    if (runRow !== -1 && roleColumns[userRole]) {
      const range = `Run_Schedule!${roleColumns[userRole]}${runRow + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['']] }
      });
    }

    await interaction.reply({ content: `↩ Your **${userRole.toUpperCase()}** signup has been removed.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
