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
  console.log(`📨 Message from ${message.author.tag} (${message.author.id}) in #${message.channel.name} (${message.channel.id})`);

  if (message.author.id === client.user.id) return;
  if (!message.author.bot || message.channel.id !== CHANNEL_ID) {
    console.log('⏭ Skipping message: not a bot or wrong channel.');
    return;
  }

  const embed = message.embeds[0];
  if (!embed) {
    console.log('⏭ Skipping message: no embed found.');
    return;
  }

  const title = embed.title || "";
  const description = embed.description || "";
  console.log(`🔍 Embed title: "${title}"`);
  console.log(`🔍 Embed description: "${description}"`);

  if (!title.includes("Raid Organizer")) {
    console.log('⏭ Skipping message: title does not include "Raid Organizer".');
    return;
  }

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

  eventCache.set(message.id, { dungeon, runId, ev
