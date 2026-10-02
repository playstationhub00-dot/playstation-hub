// The message a customer sends when they tap "Message us about this game" on a
// game page, and the m.me link that opens it prefilled. Pure, so it can be
// tested; public/js/game-detail.js keeps the button, the preview and the link
// in step with what they have picked. Type and duration are optional.
(function (root) {
  // opts: { title, typeLabel, daysLabel, totalLine, booked }
  //   booked — nothing can be rented right now, so the message asks about the
  //   next slot instead of placing a rental request.
  function buildMessage(opts) {
    var o = opts || {};
    var lines = o.booked
      ? ['Hi! I\'m interested in ' + o.title + ' 🎮', 'I saw it\'s fully booked — when is the next slot?']
      : ['Hi! I want to RENT a game 🎮', 'Game: ' + o.title];
    if (o.typeLabel) lines.push('Account Type: ' + o.typeLabel);
    if (o.daysLabel) lines.push('Duration: ' + o.daysLabel);
    if (o.totalLine && !o.booked) lines.push(o.totalLine);
    return lines.join('\n');
  }

  function messengerHref(text) {
    return 'http://m.me/PlaystationHub00?text=' + encodeURIComponent(text);
  }

  var api = { buildMessage: buildMessage, messengerHref: messengerHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHMessengerText = api;
})(typeof window !== 'undefined' ? window : this);
