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
    if (dungeonMatch) dungeon = dungeonMatch[1].trim();

    const dateMatch = embed.description.match(/Date[:\-]?\s*(.+)/i);
    if (dateMatch) {
      const rawDate = dateMatch[1].trim();
      const parsedDate = new Date(rawDate);
      if (!isNaN(parsedDate)) {
        eventTime = parsedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
      } else {
        eventTime = rawDate; // fallback if parse fails
      }
    }
  }

  let footerText = embed.footer?.text?.replace(/\*\*/g, '') || "";
  const runIdMatch = footerText.match(/Run\s*ID[:\-]?\s*(\w+)/i);
  if (runIdMatch) runId = runIdMatch[1];

  eventCache.set(message.id, {
    dungeon,
    runId,
    eventTime
  });

  const trackerEmbed = new EmbedBuilder()
    .setTitle('📥 Sign-Up Tracker')
    .setDescription('Click your role to be logged in the signup sheet for this event.')
    .setColor(0x00AE86);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${message.id}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${message.id}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${message.id}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${message.id}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, role, messageId] = interaction.customId.split('_');
  if (action !== 'signup') return;

  const username = interaction.user.tag;
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });

  const eventInfo = eventCache.get(messageId) || {
    dungeon: "Unknown", runId: "N/A", eventTime: "Unknown"
  };

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
});

client.login(process.env.DISCORD_TOKEN);
