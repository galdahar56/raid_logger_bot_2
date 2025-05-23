
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

client.on('ready', async () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);

  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Test!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          '✅ Bot was able to write to the sheet!',
          new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
        ]]
      }
    });

    console.log('✅ Google Sheets write succeeded:', response.statusText);
  } catch (error) {
    console.error('❌ Google Sheets test failed:', error);
  }
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
    new ButtonBuilder().setCustomId(`remove_role_${message.id}`).setLabel('❌ Remove My Role').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const [action, role, messageId] = interaction.customId.split('_');
  const username = interaction.user.tag;
  const userId = interaction.user.id;
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

  const eventInfo = eventCache.get(messageId) || { dungeon: "Unknown", runId: "N/A", eventTime: "Unknown" };
  const roleClaims = claimedRolesPerMessage.get(messageId) || {};
  const userClaims = userClaimsPerMessage.get(messageId) || {};

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  if (action === 'remove') {
    try {
      delete roleClaims[userClaims[userId]];
      delete userClaims[userId];
      claimedRolesPerMessage.set(messageId, roleClaims);
      userClaimsPerMessage.set(messageId, userClaims);

      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Signup Log!A2:F'
      });

      const rows = sheetData.data.values || [];
      const rowsToDelete = [];
      rows.forEach((row, index) => {
        if (row[0] === username && row[3] === eventInfo.runId) {
          rowsToDelete.push(index + 1);
        }
      });

      if (rowsToDelete.length > 0) {
        rowsToDelete.reverse();
        const deleteRequests = rowsToDelete.map(rowIndex => ({
          deleteDimension: {
            range: {
              sheetId: 0, // Replace with actual Sheet tab ID if needed
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1
            }
          }
        }));

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: { requests: deleteRequests }
        });
      }

      await interaction.reply({ content: '✅ Your role and sign-up have been removed.', ephemeral: true });
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: '❌ There was an error removing your sign-up.', ephemeral: true });
    }

    return;
  }

  if (action === 'signup') {
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[username, role.toUpperCase(), eventInfo.dungeon, eventInfo.runId, eventInfo.eventTime, timestamp]]
      }
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Run_Schedule!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[username, role.toUpperCase(), eventInfo.dungeon, eventInfo.runId, eventInfo.eventTime, timestamp]]
      }
    });

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
  }
});

client.login(process.env.BOT_TOKEN);
