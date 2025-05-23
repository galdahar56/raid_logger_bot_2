
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
  if (!embed || !embed.title.includes("Raid Organizer")) return;

  const description = embed.description || "";
  let dungeon = "Unknown";
  let eventTime = "Unknown";
  let runId = "N/A";

  const dungeonMatch = description.match(/Dungeon[:\-]?\s*(.+)/i);
  if (dungeonMatch) dungeon = dungeonMatch[1].replace(/[*_`~]/g, '').trim();

  const dateMatch = description.match(/Date[:\-]?\s*(.+)/i);
  if (dateMatch) {
    const rawDate = dateMatch[1].replace(/[*_`~]/g, '').trim();
    const parsedDate = new Date(rawDate);
    eventTime = !isNaN(parsedDate)
      ? parsedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
      : rawDate;
  }

  const runIdMatch = description.match(/Run\s*ID[:\-]?\s*(.+)/i);
  if (runIdMatch) runId = runIdMatch[1].replace(/[*_`~]/g, '').trim();

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

  const [action, roleOrNothing, messageId] = interaction.customId.split('_');
  const userId = interaction.user.id;
  const username = interaction.user.tag;
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

  const role = roleOrNothing;
  const eventInfo = eventCache.get(messageId) || { dungeon: "Unknown", runId: "N/A", eventTime: "Unknown" };
  const roleClaims = claimedRolesPerMessage.get(messageId) || {};
  const userClaims = userClaimsPerMessage.get(messageId) || {};

  if (action === 'undo') {
    const prevRole = userClaims[userId];
    if (!prevRole) {
      return interaction.reply({ content: '❌ You haven’t signed up yet.', ephemeral: true });
    }

    delete userClaims[userId];
    delete roleClaims[prevRole];
    claimedRolesPerMessage.set(messageId, roleClaims);
    userClaimsPerMessage.set(messageId, userClaims);

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);
      const oldRow = originalMessage.components[0];

      const newRow = new ActionRowBuilder().addComponents(
        oldRow.components.map(button => {
          if (button.customId === `signup_${prevRole}_${messageId}`) {
            return ButtonBuilder.from(button).setDisabled(false);
          }
          return button;
        })
      );

      await originalMessage.edit({ components: [newRow] });
    } catch (err) {
      console.error('Undo: Failed to re-enable button:', err);
    }

    return interaction.reply({ content: `↩ You have undone your **${prevRole.toUpperCase()}** signup.`, ephemeral: true });
  }

  if (action !== 'signup') return;

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
    console.error('Signup: Failed to disable button:', err);
  }

  await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
});

client.login(process.env.DISCORD_TOKEN);
