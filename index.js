
// ... (same setup as previous) ...

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });

  const parts = interaction.customId.split('_');
  const action = parts[0];
  let role = parts[1];
  const messageId = parts[2];
  const username = interaction.user.tag;
  const event = eventCache.get(messageId);

  const roleColumns = { tank: 'F', healer: 'G', dps1: 'H', dps2: 'I', keyholder: 'K' };

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

    const signupData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Signup Log!A:F'
    });

    const rowIndex = signupData.data.values.findIndex(
      row => row[0] === username && row[1] === userRole.toUpperCase() && row[3] === event.runId
    );

    if (rowIndex !== -1) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex: rowIndex + 1,
                endIndex: rowIndex + 2
              }
            }
          }]
        }
      });
    }

    const scheduleData = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Run_Schedule!A:Z'
    });

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
      if (originalMessage.components?.[0]) {
        const oldRow = originalMessage.components[0];

        const newRow = new ActionRowBuilder().addComponents(
          oldRow.components.map(button => {
            if (
              button.customId === `signup_dps_${messageId}` ||
              button.customId.includes(`signup_${userRole}_`)
            ) {
              return ButtonBuilder.from(button).setDisabled(false);
            }
            return button;
          })
        );

        await originalMessage.edit({ components: [newRow] });
      }
    } catch (err) {
      console.error('Failed to re-enable button:', err);
    }

    await interaction.reply({ content: `❌ Your signup for **${userRole.toUpperCase()}** has been removed.`, ephemeral: true });
    return;
  }

// ... (keep all other signup logic unchanged) ...
});
