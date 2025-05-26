
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
const pendingFilledMessages = new Map();

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

  eventCache.set(message.id, {
    dungeon,
    runId,
    eventTime,
    rolesUsed: {}
  });

  const trackerEmbed = new EmbedBuilder()
    .setTitle('📥 Sign-Up Tracker')
    .setDescription('Click your role to be logged in the signup sheet for this event. You can also undo.')
    .setColor(0x00AE86);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signup_tank_${message.id}`).setLabel('🛡 Tank').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signup_healer_${message.id}`).setLabel('💉 Healer').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signup_dps1_${message.id}`).setLabel('⚔ DPS 1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_dps2_${message.id}`).setLabel('⚔ DPS 2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signup_keyholder_${message.id}`).setLabel('🗝 Key').setStyle(ButtonStyle.Success)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`undo_signup_${message.id}`).setLabel('↩ Undo').setStyle(ButtonStyle.Danger)
  );

  await message.channel.send({ embeds: [trackerEmbed], components: [row1, row2] });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const parts = interaction.customId.split('_');
  const action = parts[0];
  const role = parts[1];
  const messageId = parts[2];
  const username = interaction.user.tag;
  let event = eventCache.get(messageId);

if (!event) {
  try {
    const originalMessage = await interaction.channel.messages.fetch(messageId);

  if (originalMessage.author.id !== client.user.id) {
    console.warn('⚠️ Cannot edit a message not authored by this bot.');
    return;
  }

    const embed = originalMessage.embeds[0];

    if (!embed || !embed.description) {
      await interaction.reply({ content: '⚠️ This event is missing required data.', ephemeral: true });
      return;
    }

    const dungeonMatch = embed.description.match(/Dungeon[:\-]?\s*(.+)/i);
    const dateMatch = embed.description.match(/Date[:\-]?\s*(.+)/i);
    const runIdMatch = embed.description.match(/Run\s*ID[:\-]?\s*(.+)/i);

    if (dungeonMatch && dateMatch && runIdMatch) {
      const rawDate = dateMatch[1].replace(/[*_`~]/g, '').trim();
      const parsedDate = new Date(rawDate);
      const formattedTime = !isNaN(parsedDate)
        ? parsedDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
        : rawDate;

      event = {
        dungeon: dungeonMatch[1].replace(/[*_`~]/g, '').trim(),
        runId: runIdMatch[1].replace(/[*_`~]/g, '').trim(),
        eventTime: formattedTime,
        rolesUsed: {}
      };
      eventCache.set(messageId, event);
    } else {
      await interaction.reply({ content: '⚠️ Could not extract event details from message.', ephemeral: true });
      return;
    }
  } catch (err) {
    console.error('Failed to fetch original message to restore event:', err);
    await interaction.reply({ content: '⚠️ Could not restore event context.', ephemeral: true });
    return;
  }
}


  const roleColumns = { tank: 'F', healer: 'G', dps1: 'H', dps2: 'I', keyholder: 'K' };

  if (action === 'signup') {
    if (!event) {
      await interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
      return;
    }

    if (role === 'keyholder') {
      const hasMainRole = ['tank', 'healer', 'dps1', 'dps2'].some(r => event.rolesUsed[r] === username);
      if (!hasMainRole) {
        await interaction.reply({ content: '❌ You must sign up for Tank, Healer, or DPS first before claiming Key Holder.', ephemeral: true });
        return;
      }
    }

    if (Object.values(event.rolesUsed).includes(username)) {
      if (role === 'keyholder') {
        const alreadyHasKey = event.rolesUsed['keyholder'] === username;
        if (alreadyHasKey) {
          await interaction.reply({ content: `❌ You’ve already claimed the Key Holder role.`, ephemeral: true });
          return;
        }
        const hasMainRole = ['tank', 'healer', 'dps1', 'dps2'].some(r => event.rolesUsed[r] === username);
        if (!hasMainRole) {
          await interaction.reply({ content: '❌ You must first sign up for another role before claiming Key Holder.', ephemeral: true });
          return;
        }
      } else {
        await interaction.reply({ content: `❌ You’ve already signed up for this event.`, ephemeral: true });
        return;
      }
    }

    if (event.rolesUsed[role]) {
      await interaction.reply({ content: `❌ The **${role.toUpperCase()}** role has already been taken.`, ephemeral: true });
      return;
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' });
    event.rolesUsed[role] = username;
const allRolesFilled = ['tank', 'healer', 'dps1', 'dps2', 'keyholder'].every(r => event.rolesUsed[r]);
if (allRolesFilled) {
  if (pendingFilledMessages.has(event.runId)) clearTimeout(pendingFilledMessages.get(event.runId));

  const timeout = setTimeout(async () => {
    try {
      const formData = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Form Responses 1!A:Z'
      });

      const headers = formData.data.values[0];
      const dataRows = formData.data.values.slice(1);
      const runRow = dataRows.find(row => row.includes(event.runId));

      if (!runRow) return;

      const get = label => {
        const colIndex = headers.findIndex(h => h.trim().toLowerCase() === label.toLowerCase());
        return colIndex !== -1 ? runRow[colIndex] : 'N/A';
      };

      const embed = new EmbedBuilder()
        .setTitle('✅ Carry Group Filled')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'Customer', value: get('Customer'), inline: true },
          { name: 'Server', value: get('Server'), inline: true },
          { name: 'Dungeon', value: get('Dungeon'), inline: true },
          { name: 'Key Level', value: get('Key Level'), inline: true },
          { name: 'Class', value: get('Class'), inline: true },
          { name: 'Preferred Date', value: get('Preferred Date'), inline: true },
          { name: 'Preferred Time', value: get('Preferred Time'), inline: true },
          { name: 'Run_ID', value: event.runId, inline: false }
        );

      const formedChannel = await client.channels.fetch('1375189405257695412');
      if (formedChannel) await formedChannel.send({ embeds: [embed] });

    } catch (err) {
      console.error('Failed to send formed group message:', err);
    } finally {
      pendingFilledMessages.delete(event.runId);
    }
  }, 15000);

  pendingFilledMessages.set(event.runId, timeout);
}


    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[username, role.toUpperCase(), event.dungeon, event.runId, event.eventTime, timestamp]]
      }
    });

    const scheduleData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:Z' });
    const runRow = scheduleData.data.values.findIndex(row => row[0] === event.runId);
    if (runRow !== -1 && roleColumns[role]) {
      const range = `Run_Schedule!${roleColumns[role]}${runRow + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[username]] }
      });
    }

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);

  if (originalMessage.author.id !== client.user.id) {
    console.warn('⚠️ Cannot edit a message not authored by this bot.');
    return;
  }

      const oldRows = originalMessage.components;

      const newRows = oldRows.map(row => new ActionRowBuilder().addComponents(
        row.components.map(button => {
          if (button.customId === interaction.customId) {
            return ButtonBuilder.from(button).setDisabled(true);
          }
          return button;
        })
      ));

      await originalMessage.edit({ components: newRows });
    } catch (err) {
      console.error('Failed to disable button:', err);
    }

    await interaction.reply({ content: `✅ You signed up as **${role.toUpperCase()}**`, ephemeral: true });
  }

  if (action === 'undo') {
    if (!event) {
      await interaction.reply({ content: '⚠️ This event is no longer active.', ephemeral: true });
      return;
    }

    const userRole = Object.keys(event.rolesUsed).find(r => event.rolesUsed[r] === username);
    if (!userRole) {
      await interaction.reply({ content: `❌ You haven't signed up for this event.`, ephemeral: true });
      return;
    }

    delete event.rolesUsed[userRole];
if (pendingFilledMessages.has(event.runId)) {
  clearTimeout(pendingFilledMessages.get(event.runId));
  pendingFilledMessages.delete(event.runId);
}


    const signupData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Signup Log!A:F' });
    const rowIndex = signupData.data.values.findIndex(row => row[0] === username && row[1] === userRole.toUpperCase() && row[3] === event.runId);
    if (rowIndex !== -1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ deleteDimension: { range: { sheetId: 0, dimension: 'ROWS', startIndex: rowIndex + 1, endIndex: rowIndex + 2 } } }]
        }
      });
    }

    const scheduleData = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:Z' });
    const runRow = scheduleData.data.values.findIndex(row => row[0] === event.runId);
    if (runRow !== -1 && roleColumns[userRole]) {
      const range = `Run_Schedule!${roleColumns[userRole]}${runRow + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['']] }
      });
    }

    try {
      const originalMessage = await interaction.channel.messages.fetch(messageId);

  if (originalMessage.author.id !== client.user.id) {
    console.warn('⚠️ Cannot edit a message not authored by this bot.');
    return;
  }

      const oldRows = originalMessage.components;

      const newRows = oldRows.map(row => new ActionRowBuilder().addComponents(
        row.components.map(button => {
          if (button.customId.includes(`signup_${userRole}_`)) {
            return ButtonBuilder.from(button).setDisabled(false);
          }
          return button;
        })
      ));

      await originalMessage.edit({ components: newRows });
    } catch (err) {
      console.error('Failed to re-enable button:', err);
    }

    await interaction.reply({ content: `❌ Your signup for **${userRole.toUpperCase()}** has been removed.`, ephemeral: true });
  }
});

client.login(process.env.DISCORD_TOKEN);