
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
    new ButtonBuilder().setCustomId(`signup_dps_${message.id}`).setLabel('⚔ DPS').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_keyholder_${message.id}`).setLabel('🗝 Key Holder').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`undo_signup_${message.id}`).setLabel('↩ Undo').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row1] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const parts = interaction.customId.split('_');
  const action = parts[0];
  let role = parts[1];
  const messageId = parts[2];
  const username = interaction.user.tag;
  const event = eventCache.get(messageId);

  const roleColumns = { tank: 'F', healer: 'G', dps1: 'H', dps2: 'I', keyholder: 'K' };

  if (action === 'signup') {
    if (!event) {
      await interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
      return;
    }

    if (role === 'keyholder') {
      const isSignedUp = ['tank', 'healer', 'dps1', 'dps2'].some(r => event.rolesUsed[r] === username);
      if (!isSignedUp) {
        await interaction.reply({ content: '❌ You must first sign up as a Tank, Healer, or DPS to claim the Key Holder role.', ephemeral: true });
        return;
      }
      if (event.rolesUsed.keyholder) {
        await interaction.reply({ content: '❌ The Key Holder has already been assigned.', ephemeral: true });
        return;
      }
      event.rolesUsed.keyholder = username;

      const scheduleData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:Z' });
      const runRow = scheduleData.data.values.findIndex(row => row[0] === event.runId);
      if (runRow !== -1) {
        const range = `Run_Schedule!${roleColumns.keyholder}${runRow + 1}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[username]] }
        });
      }

      const originalMessage = await interaction.channel.messages.fetch(messageId);
      if (originalMessage.components?.[0]) {
        const oldRow = originalMessage.components[0];
        const newRow = new ActionRowBuilder().addComponents(
          oldRow.components.map(button => {
            if (button.customId === interaction.customId) {
              return ButtonBuilder.from(button).setDisabled(true);
            }
            return button;
          })
        );
        await originalMessage.edit({ components: [newRow] });
      }

      await interaction.reply({ content: `🗝 You are now the **Key Holder** for this run!`, ephemeral: true });
      return;
    }

    if (Object.values(event.rolesUsed).includes(username)) {
      await interaction.reply({ content: `❌ You’ve already signed up for this event.`, ephemeral: true });
      return;
    }

    if (role === 'dps') {
      if (!event.rolesUsed.dps1) {
        role = 'dps1';
      } else if (!event.rolesUsed.dps2) {
        role = 'dps2';
      } else {
        await interaction.reply({ content: `❌ Both DPS slots are already filled.`, ephemeral: true });
        return;
      }
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
      if (originalMessage.components?.[0]) {
        const oldRow = originalMessage.components[0];

        const newRow = new ActionRowBuilder().addComponents(
          oldRow.components.map(button => {
            if (button.customId === `signup_dps_${messageId}` &&
                event.rolesUsed.dps1 && event.rolesUsed.dps2) {
              return ButtonBuilder.from(button).setDisabled(true);
            }
            if (button.customId === interaction.customId && button.customId !== `signup_dps_${messageId}`) {
              return ButtonBuilder.from(button).setDisabled(true);
            }
            return button;
          })
        );

        await originalMessage.edit({ components: [newRow] });
      }
    } catch (err) {
      console.error('Failed to disable button:', err);
    }

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
