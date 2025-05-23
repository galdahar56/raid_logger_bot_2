
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

const claimedRoles = new Map(); // roleName => userId
const userSelections = new Set(); // userId

client.once('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const role = interaction.customId; // e.g., "tank", "healer", etc.

  if (userSelections.has(userId)) {
    await interaction.reply({ content: "❌ You’ve already selected a role. You can't choose another.", ephemeral: true });
    return;
  }

  if (claimedRoles.has(role)) {
    await interaction.reply({ content: `❌ That role is already taken by <@${claimedRoles.get(role)}>`, ephemeral: true });
    return;
  }

  // Save their selection
  userSelections.add(userId);
  claimedRoles.set(role, userId);

  // Update the message with new buttons
  const updatedButtons = createButtons();

  await interaction.update({
    content: `✅ <@${userId}> has claimed the **${role}** role!`,
    components: updatedButtons
  });
});

function createButtons() {
  const roles = ['tank', 'healer', 'dps1', 'dps2'];

  const row = new ActionRowBuilder();

  for (const role of roles) {
    const isTaken = claimedRoles.has(role);

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(role)
        .setLabel(role.charAt(0).toUpperCase() + role.slice(1))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isTaken)
    );
  }

  return [row];
}

client.login(process.env.DISCORD_TOKEN);
