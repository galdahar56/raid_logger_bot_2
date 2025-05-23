
require('dotenv').config();
const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TOKEN = process.env.DISCORD_TOKEN;

const claimedRoles = new Map(); // roleName => userId
const userSelections = new Set(); // userId

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) {
    console.error("❌ Channel not found. Check DISCORD_CHANNEL_ID in .env.");
    return;
  }

  const row = createButtons();
  await channel.send({
    content: "🎮 Select your role (one per user, one user per role):",
    components: row
  });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const role = interaction.customId;

  if (userSelections.has(userId)) {
    await interaction.reply({ content: "❌ You’ve already selected a role.", ephemeral: true });
    return;
  }

  if (claimedRoles.has(role)) {
    await interaction.reply({ content: `❌ ${role} is already taken by <@${claimedRoles.get(role)}>`, ephemeral: true });
    return;
  }

  userSelections.add(userId);
  claimedRoles.set(role, userId);

  const updatedButtons = createButtons();

  await interaction.update({
    content: `✅ <@${userId}> has claimed **${role}**.`,
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

client.login(TOKEN);
