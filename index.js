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
const claimedRolesPerMessage = new Map();
const userClaimsPerMessage = new Map();

client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.id === client.user.id) return;
  if (!message.author.bot || message.channel.id !== CHANNEL_ID) return;

  const embed = message.embeds[0];
  if (!embed) return;

  const title = embed.title || "";
  if (!title.includes("Raid Organizer")) return;

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

  eventCache.set(message.id, { dungeon, runId, eventTime });
  claimedRolesPerMessage.set(message.id, {});
  userClaimsPerMessage.set(message.id, {});

  const trackerEmbed = new EmbedBuilder()
    .setTitle('📥 Sign-Up Tracker')
    .setDescription('Click your role to be logged in the signup sheet for this event.')
    .setColor(0x00AE86);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${message.id}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${message.id}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${message.id}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${message.id}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`undo_${message.id}`).setLabel('↩ Undo').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const parts = interaction.customId.split('_');
  const action = parts[0];

  if (action === 'signup') {
    const role = parts[1];
    const messageId = parts[2];

    const username = interaction.user.tag;
    const userId = interaction.user.id;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

    const eventInfo = eventCache.get(messageId) || { dungeon: "Unknown", runId: "N/A", eventTime: "Unknown" };
    const roleClaims = claimedRolesPerMessage.get(messageId) || {};
    const userClaims = userClaimsPerMessage.get(messageId) || {};

    if (userClaims[userId]) {
      return interaction.reply({ content: '❌ You already picked a role!', ephemeral: true });
    }

    if (roleClaims[role]) {
      return interaction.reply({ content: '❌ This role is already taken!', ephemeral: true });
    }

    roleClaims[role] = username;
    userClaims[userId] = role;
    claimedRolesPerMessage.set(messageId, roleClaims);
    userClaimsPerMessage.set(messageId, userClaims);

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[username, role.toUpperCase(), eventInfo.dungeon, eventInfo.runId, eventInfo.eventTime, timestamp]]
      }
    });

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
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
    } catch (err) {
      console.error('Failed to disable button:', err);
    }
  } else if (action === 'undo') {
    const messageId = parts[1];
    const userId = interaction.user.id;
    const username = interaction.user.tag;

    const roleClaims = claimedRolesPerMessage.get(messageId);
    const userClaims = userClaimsPerMessage.get(messageId);

    if (!roleClaims || !userClaims || !userClaims[userId]) {
      return interaction.reply({ content: '⚠️ You have not signed up for this event.', ephemeral: true });
    }

    const role = userClaims[userId];

    delete roleClaims[role];
    delete userClaims[userId];

    claimedRolesPerMessage.set(messageId, roleClaims);
    userClaimsPerMessage.set(messageId, userClaims);

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const sheet = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F'
    });

    const rows = sheet.data.values || [];
    const rowIndex = rows.findIndex(row =>
      row[0] === username &&
      row[1] === role.toUpperCase() &&
      row[3] === eventCache.get(messageId)?.runId
    );

    if (rowIndex !== -1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1
              }
            }
          }]
        }
      });
    }

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
      const oldRow = originalMessage.components[0];

      const newRow = new ActionRowBuilder().addComponents(
        oldRow.components.map(button => {
          if (button.customId === `signup_${role}_${messageId}`) {
            return ButtonBuilder.from(button).setDisabled(false);
          }
          return button;
        })
      );

      await originalMessage.edit({ components: [newRow] });
    } catch (err) {
      console.error('Failed to re-enable button:', err);
    }

    return interaction.reply({ content: `↩ You have been removed from the **${role.toUpperCase()}** role.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);
