require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_JSON),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = process.env.SHEET_ID;
const FORMED_GROUPS_CHANNEL_ID = process.env.FORMED_GROUPS_CHANNEL_ID;

const notifiedRuns = new Set(); // Prevents double-posting

client.once('ready', async () => {
  console.log(`✅ Notifier bot ready as ${client.user.tag}`);
  setInterval(checkForFormedGroups, 60 * 1000); // every minute
});

async function checkForFormedGroups() {
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const [scheduleRes, formRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Run_Schedule!A:J' }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Form Responses 1!A:G' }),
  ]);

  const scheduleRows = scheduleRes.data.values || [];
  const formRows = formRes.data.values || [];

  for (let i = 1; i < scheduleRows.length; i++) {
    const [runId, dungeon, date, , , tank, healer, dps1, dps2, key] = scheduleRows[i];

    if (!runId || !tank || !healer || !dps1 || !dps2 || !key) continue;
    if (notifiedRuns.has(runId)) continue;

    const formMatch = formRows.find(row => row[6] === runId);
    if (!formMatch) continue;

    const [timestamp, contact, formDungeon, keyLevel, notes, prefTime] = formMatch;

    const embed = new EmbedBuilder()
      .setTitle(`✅ Group Formed: ${formDungeon || dungeon || 'Unknown Dungeon'}`)
      .addFields(
        { name: 'Key Level', value: keyLevel || 'N/A', inline: true },
        { name: 'Preferred Time', value: prefTime || 'N/A', inline: true },
        { name: 'Contact', value: contact || 'N/A', inline: true },
        { name: 'Notes', value: notes || 'None', inline: false },
        { name: '🛡 Tank', value: tank || 'TBD', inline: true },
        { name: '💉 Healer', value: healer || 'TBD', inline: true },
        { name: '⚔ DPS 1', value: dps1 || 'TBD', inline: true },
        { name: '⚔ DPS 2', value: dps2 || 'TBD', inline: true },
        { name: '🗝 Key Holder', value: key || 'TBD', inline: true }
      )
      .setFooter({ text: `Run ID: ${runId}` })
      .setColor(0x2ecc71)
      .setTimestamp(new Date());

    const channel = await client.channels.fetch(FORMED_GROUPS_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
      console.log(`📢 Posted formed group for Run_ID: ${runId}`);
      notifiedRuns.add(runId);

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Run_Schedule!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[`Formed: ${runId}`, tank, healer, dps1, dps2, key]]
        }
      });
    }
  }
}

client.login(process.env.DISCORD_TOKEN);