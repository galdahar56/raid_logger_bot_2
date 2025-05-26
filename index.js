
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
      if (!isNaN(parsedDate)) {
        eventTime = parsedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
      } else {
        eventTime = rawDate;
      }
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

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${message.id}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${message.id}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${message.id}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${message.id}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_keyholder_${message.id}`).setLabel('🗝 Key').setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`undo_signup_${message.id}`).setLabel('↩ Undo').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row1, row2] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const role = parts[1];
  const messageId = parts[2];
  const username = interaction.user.tag;
  const event = eventCache.get(messageId);

  const roleColumns = { tank: 'F', healer: 'G', dps1: 'H', dps2: 'I', keyholder: 'K' };

  if (action === 'signup') {
    if (!event) {
      await interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
      return;
    }

    if (Object.values(event.rolesUsed).includes(username)) {
      await interaction.reply({ content: `❌ You’ve already signed up for this event.`, ephemeral: true });
      return;
    }

    if (event.rolesUsed[role]) {
      await interaction.reply({ content: `❌ The **${role.toUpperCase()}** role has already been taken.`, ephemeral: true });
      return;
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
    event.rolesUsed[role] = username;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[username, role.toUpperCase(), event.dungeon, event.runId, event.eventTime, timestamp]]
      }
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

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
      const oldRows = originalMessage.components;

      const newRows = oldRows.map(row => new ActionRowBuilder().addComponents(
        row.components.map(button => {
          if (button.customId === interaction.customId) {
            return ButtonBuilder.from(button).setDisabled(true);
          }
          return button;
        })
      ));

      await originalMessage.edit({ components: newRows });
    } catch (err) {
      console.error('Failed to disable button:', err);
    }

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
  }

  if (action === 'undo') {
    if (!event) {
      await interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
      return;
    }

    const userRole = Object.keys(event.rolesUsed).find(r => event.rolesUsed[r] === username);
    if (!userRole) {
      await interaction.reply({ content: `❌ You haven't signed up for this event.`, ephemeral: true });
      return;
    }

    delete event.rolesUsed[userRole];

    const signupData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Signup Log!A:F' });
    const rowIndex = signupData.data.values.findIndex(row => row[0] === username && row[1] === userRole.toUpperCase() && row[3] === event.runId);
    if (rowIndex !== -1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: rowIndex + 1, endIndex: rowIndex + 2 } } }]
        }
      });
    }

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

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
      const oldRows = originalMessage.components;

      const newRows = oldRows.map(row => new ActionRowBuilder().addComponents(
        row.components.map(button => {
          if (button.customId.includes(`signup_${userRole}_`)) {
            return ButtonBuilder.from(button).setDisabled(false);
          }
          return button;
        })
      ));

      await originalMessage.edit({ components: newRows });
    } catch (err) {
      console.error('Failed to re-enable button:', err);
    }

    await interaction.reply({ content: `❌ Your signup for **${userRole.toUpperCase()}** has been removed.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);