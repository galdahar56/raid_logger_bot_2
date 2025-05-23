
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

const roleButtons = [
  { label: 'Tank', id: 'role_tank' },
  { label: 'Healer', id: 'role_healer' },
  { label: 'DPS 1', id: 'role_dps1' },
  { label: 'DPS 2', id: 'role_dps2' }
];

const claimedRoles = new Map();
const userClaims = new Map();

client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.channelId !== CHANNEL_ID || !message.embeds.length) return;
  const embedTitle = message.embeds[0].title || "";
  if (!embedTitle.includes('Raid Organizer')) return;

  if (eventCache.has(message.id)) return;
  eventCache.set(message.id, true);

  const row = new ActionRowBuilder()
    .addComponents(
      roleButtons.map(({ label, id }) =>
        new ButtonBuilder()
          .setCustomId(id)
          .setLabel(label)
          .setStyle(ButtonStyle.Primary)
      )
    );

  await message.channel.send({
    embeds: [new EmbedBuilder().setTitle('📌 Sign Up for a Role')],
    components: [row]
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const roleId = interaction.customId;
  const userId = interaction.user.id;

  if (userClaims.has(userId)) {
    return interaction.reply({ content: '❌ You already picked a role!', ephemeral: true });
  }

  if (claimedRoles.has(roleId)) {
    return interaction.reply({ content: '❌ This role is already taken!', ephemeral: true });
  }

  claimedRoles.set(roleId, interaction.user.username);
  userClaims.set(userId, roleId);

  const updatedRow = new ActionRowBuilder()
    .addComponents(
      roleButtons.map(({ label, id }) => 
        new ButtonBuilder()
          .setCustomId(id)
          .setLabel(
            claimedRoles.has(id) ? `${label} - ${claimedRoles.get(id)}` : label
          )
          .setStyle(ButtonStyle.Primary)
          .setDisabled(claimedRoles.has(id))
      )
    );

  await interaction.update({
    components: [updatedRow]
  });
});

client.login(process.env.DISCORD_TOKEN);
