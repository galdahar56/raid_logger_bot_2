
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

const roles = {
  tank: 'ROLE_ID_TANK',
  healer: 'ROLE_ID_HEALER',
  dps: 'ROLE_ID_DPS'
};

const removeButton = new ButtonBuilder()
  .setCustomId('remove_role')
  .setLabel('❌ Remove My Role')
  .setStyle(ButtonStyle.Danger);

const row = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder().setCustomId('tank').setLabel('Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('healer').setLabel('Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('dps').setLabel('DPS').setStyle(ButtonStyle.Secondary),
    removeButton
  );

client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const member = interaction.member;
  const selectedRole = roles[interaction.customId];

  if (interaction.customId === 'remove_role') {
    try {
      for (const roleId of Object.values(roles)) {
        if (interaction.member.roles.cache.has(roleId)) {
          await interaction.member.roles.remove(roleId);
        }
      }

      const sheets = google.sheets({ version: 'v4', auth });
      const userTag = interaction.user.tag;

      const sheetData = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Signup Log!A2:F'
      });

      const rows = sheetData.data.values || [];
      const rowsToDelete = [];

      rows.forEach((row, index) => {
        if (row[0] === userTag) {
          rowsToDelete.push(index + 1);
        }
      });

      if (rowsToDelete.length > 0) {
        rowsToDelete.reverse();

        const deleteRequests = rowsToDelete.map(rowIndex => ({
          deleteDimension: {
            range: {
              sheetId: 0, // Replace with actual sheet ID from gid in your URL
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
      await interaction.reply({ content: '❌ There was an error removing your role or sign-up.', ephemeral: true });
    }
    return;
  }

  if (selectedRole) {
    if (member.roles.cache.has(selectedRole)) {
      await interaction.reply({ content: 'You already have this role.', ephemeral: true });
    } else {
      await member.roles.add(selectedRole);
      await interaction.reply({ content: `You have been assigned the role.`, ephemeral: true });
    }
  }
});

client.login(process.env.BOT_TOKEN);
