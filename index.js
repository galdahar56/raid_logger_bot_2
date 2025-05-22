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

client.on('ready', () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.id === client.user.id) return;
  if (!message.author.bot || message.channel.id !== CHANNEL_ID) return;

  const runIdMatch = message.content.match(/Run_ID\s*[:\-]?\s*(\w+)/i);
  const runId = runIdMatch ? runIdMatch[1] : "N/A";

  const embed = new EmbedBuilder()
    .setTitle('📥 Sign-Up Tracker')
    .setDescription('Click your role to be logged in the signup sheet for this event.')
    .setColor(0x00AE86);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${runId}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${runId}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${runId}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${runId}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary)
  );

  await message.channel.send({ embeds: [embed], components: [row] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, role, runId] = interaction.customId.split('_');
  if (action !== 'signup') return;

  const username = `${interaction.user.username}#${interaction.user.discriminator}`;
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Signup Log!A:D',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[role.toUpperCase(), username, timestamp, runId || "N/A"]]
    }
  });

  await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
});

client.login(process.env.DISCORD_TOKEN);
