// Canned replies for the stand-in AI provider. No model runs in this repo:
// the point of the demo is who pays for the call, not what the call says.
export function cannedReply(prompt) {
  if (/poem/i.test(prompt)) {
    return [
      'An invoice waits in someone else\'s tray,',
      'its numbers patient, polite, overdue.',
      'The key that paid for this was given away,',
      'and every line I write is billed to you.',
    ].join('\n');
  }
  const inv = /#(\d+)/.exec(prompt);
  const client = /to (.+?) for/.exec(prompt);
  const amount = /EUR (\d+)/.exec(prompt);
  if (/remind|overdue|invoice/i.test(prompt)) {
    return [
      `Hi ${client ? client[1] : 'there'},`,
      '',
      `A quick reminder that invoice ${inv ? `#${inv[1]}` : ''} ${amount ? `for EUR ${amount[1]} ` : ''}is now past its due date.`,
      'If it has already been paid, please ignore this message. Otherwise I would be grateful if you could settle it this week.',
      '',
      'Thanks a lot,',
      'Sent with Tallybird',
    ].join('\n');
  }
  return `Here is a draft based on your request:\n\n${prompt.slice(0, 200)}\n\n(Tallybird's AI helper writes short business emails.)`;
}
