// Customer-facing FAQs for the five priority game pages.
// Wording is the briefs' §7, copied as written on 2026-10-21, including the
// peso figures in those answers. Open items the briefs marked as unconfirmed
// are not in here. Other games have no page FAQ.

const BY_SLUG = {
  'ghost-of-yotei': [
    {
      q: 'How long is Ghost of Yotei? Is a 7-day rental enough?',
      text: 'HowLongToBeat puts the main story at about 30 hours and around 46 hours with side content. If you can play four or more hours a day, a week can cover the story. For side tales and exploring at your own pace, Monthly fits better, and you can extend at the same price.'
    },
    {
      q: 'Can I get the Ghost of Yotei platinum on a rental?',
      text: 'Yes, on a Trophy rental, because trophies land on your own PSN profile. PowerPyx rates the platinum 3/10 at about 50–70 hours, with nothing missable and no online trophies. That\'s a Monthly job for most players. Trophy costs ₱299/week plus a ₱100 refundable deposit.'
    },
    {
      q: 'Can I play Ghost of Yotei Legends online with a rental?',
      text: 'Legends is the free online co-op mode Sucker Punch added in March 2026, with Story, Survival and Incursion missions for two to four players. Sony requires PS Plus for online play, so plan for it: online multiplayer needs your own PS Plus subscription. The main story is single-player.'
    },
    {
      q: 'Is Ghost of Yotei in PS Plus Deluxe?',
      text: 'No, it isn\'t in our PS Plus Deluxe list, so you rent Ghost of Yotei as a single game from ₱249/week. Its predecessor Ghost of Tsushima is in the list, so you can rent PS Plus Deluxe from ₱349/week to play the first game, with online play included.'
    },
    {
      q: 'Is Ghost of Yotei on PS4?',
      text: 'No. Ghost of Yotei is PS5 only, so we rent it on Non-Trophy and Trophy, not PS4 Primary. Non-Trophy is the cheapest way in and comes with a free 3-hour try if a slot is available. Trophy puts every trophy on your own profile for ₱299/week.'
    },
    {
      q: 'Can I switch from Ghost of Yotei to another game?',
      text: 'Yes. Unlimited FREE game changes while your rental is active (2-day cooldown between swaps, subject to slot availability). You swap to a game in the same price tier. If you\'d rather keep your trophies, you can upgrade from Non-Trophy to Trophy by paying the price difference plus the ₱100 deposit.'
    }
  ],
  'resident-evil-requiem': [
    {
      q: 'How long is Resident Evil Requiem? Is one week enough?',
      text: 'Yes for most players. HowLongToBeat lists about 11 hours for the main story, and GameSpot puts a typical first run at 11–14 hours. That fits comfortably in a 7-day rental, often with time for a second playthrough. Need longer? Extend at the same price before your rental ends.'
    },
    {
      q: 'Can I get the Resident Evil Requiem platinum on a rental?',
      text: 'Yes, pick Trophy so trophies land on your own PSN profile. PowerPyx estimates about 20 hours at 4/10 difficulty, including a clear on Insanity. Focused players can finish it in a week; Monthly gives breathing room. Trophy costs ₱399/week plus a ₱100 refundable deposit.'
    },
    {
      q: 'Does Resident Evil Requiem have online multiplayer?',
      text: 'No. Capcom experimented with online ideas but settled on a single-player, offline game, according to GamesRadar. There\'s no co-op or versus mode to plan around, so you just rent it, sign in by QR on your PS5 and play the whole campaign solo, at your own pace.'
    },
    {
      q: 'Which difficulty should I pick for a 7-day rental?',
      text: 'GameSpot lists Casual plus two Standard options, Modern and Classic, with typical Standard runs of 11–14 hours. Casual is the quickest way through if you mainly want the story inside a week. Trophy hunters will need Insanity later, per PowerPyx, so budget extra time for that run.'
    },
    {
      q: 'What other Resident Evil games can I rent?',
      text: 'Catching up on Leon\'s story? We rent Resident Evil 2 Deluxe Edition, Resident Evil 3, Resident Evil 4 Gold Edition, Resident Evil 5 & 6 and the Remake Trilogy as single games. Resident Evil Village and the classic Resident Evil 2 and 3 Nemesis are in our PS Plus Deluxe list.'
    },
    {
      q: 'Is Resident Evil Requiem on PS4?',
      text: 'No. Resident Evil Requiem is PS5 only, so we rent it on Non-Trophy and Trophy, not PS4 Primary. Non-Trophy starts at ₱349/week and comes with a free 3-hour try if a slot is available. Trophy is ₱399/week and keeps every trophy on your own profile.'
    }
  ],
  '007-first-light': [
    {
      q: 'How long is 007 First Light? Is one week enough?',
      text: 'Yes for most players. VGC puts a straight story run at about 15 hours across 17 chapters, and HowLongToBeat lists about 16 hours. That fits a 7-day rental with time to spare. Take Monthly, or extend at the same price, if you want every collectible and TacSim challenge.'
    },
    {
      q: 'Can I get the 007 First Light platinum on a rental?',
      text: 'Yes, on a Trophy rental, so trophies land on your own profile. PowerPyx rates it 2/10 at about 20 hours, with nothing missable. Five TacSim trophies need an online connection, so stay connected for those. Trophy costs ₱399/week plus a ₱100 refundable deposit.'
    },
    {
      q: 'Does 007 First Light have multiplayer?',
      text: 'No. 007 First Light is a single-player game with no co-op or versus mode. Its TacSim challenge missions add online leaderboards for replay value, according to VGC, but you never play directly with or against other people. The full story campaign is yours to play solo.'
    },
    {
      q: 'How many chapters does 007 First Light have?',
      text: 'There are 17 chapters, according to VGC\'s chapter guide. A straight story run takes about 15 hours, so the average chapter is under an hour, though bigger missions take longer. At a couple of chapters a night, you\'ll finish well inside a 7-day rental.'
    },
    {
      q: 'I loved Hitman. Is 007 First Light for me?',
      text: 'Probably. It comes from IO Interactive, the studio behind Hitman, and blends stealth with action across a globe-trotting Bond story. Want more of IO\'s stealth sandbox after Bond? Hitman World of Assassination rents from ₱199/week, on PS4 or PS5, so it\'s an easy follow-up.'
    },
    {
      q: 'Is 007 First Light on PS4?',
      text: 'No. 007 First Light is PS5 only, so we rent it on Non-Trophy and Trophy, not PS4 Primary. Non-Trophy is ₱349/week and comes with a free 3-hour try if a slot is available. Trophy is ₱399/week and keeps every trophy on your own profile.'
    }
  ],
  'crimson-desert': [
    {
      q: 'How long is Crimson Desert? Is a week enough?',
      text: 'Probably not for the story. HowLongToBeat lists about 67 hours for the main story and around 140 hours with side content. A week works as a long test drive, but Monthly fits the story much better, and you can extend at the same price for as long as you\'re playing.'
    },
    {
      q: 'Can I get the Crimson Desert platinum on a rental?',
      text: 'You can, but it\'s a marathon. PowerPyx estimates 200–300+ hours at 7/10 on Normal, with five missable challenge trophies. Pick Trophy so progress lands on your own profile, start Monthly and extend at the same price. Trophy costs ₱399/week plus a ₱100 refundable deposit.'
    },
    {
      q: 'Does Crimson Desert have multiplayer or co-op?',
      text: 'No. Pearl Abyss confirmed Crimson Desert is a single-player game with a defined beginning and end, and Insider Gaming reports no multiplayer planned after launch either. There\'s no co-op to plan around: sign in by QR and explore Pywel solo. Black Desert, Pearl Abyss\'s online game, is in our PS Plus Deluxe list.'
    },
    {
      q: 'Is Crimson Desert free to play?',
      text: 'No. Crimson Desert is a full-price PS5 game, not free-to-play. Renting is the budget way in: ₱349/week on Non-Trophy or ₱399/week on Trophy, with a free 3-hour try on Non-Trophy if a slot is available. Every 5th paid rental is also a free 7-day rental.'
    },
    {
      q: 'Is Crimson Desert hard? Is there an easy mode?',
      text: 'It can be demanding, but an Easy difficulty was added in Patch 1.04, according to PowerPyx, which rates the platinum 6/10 on Easy versus 7/10 on Normal. Not sure it\'s your kind of game? Use the free 3-hour Non-Trophy try first, if a slot is available.'
    },
    {
      q: 'Is Crimson Desert on PS4?',
      text: 'No. Crimson Desert is PS5 only, so we rent it on Non-Trophy and Trophy, not PS4 Primary. Non-Trophy is ₱349/week; Trophy is ₱399/week and keeps your trophies on your own profile. For a game this long, Monthly plus same-price extensions is the most relaxed way to play.'
    }
  ],
  'battlefield-6': [
    {
      q: 'Can I play Battlefield 6 multiplayer with a rental?',
      text: 'Yes, if you have PS Plus. Online multiplayer needs your own PS Plus subscription. Sony\'s Battlefield 6 page says an active PS Plus subscription is required for every online multiplayer mode, and a single-game rental doesn\'t include one. Check your subscription is active before you rent, so you can jump straight into Conquest.'
    },
    {
      q: 'Is a week enough for the Battlefield 6 campaign?',
      text: 'Yes. HowLongToBeat puts the campaign at about 6 hours, so a 7-day rental covers it easily. PowerPyx notes the game needs an internet connection even for the campaign, so play online. If you\'re staying for multiplayer, Monthly works out cheaper per day, and you can extend at the same price.'
    },
    {
      q: 'Can I get the Battlefield 6 platinum on a rental?',
      text: 'Yes, with a Trophy rental and your own PS Plus. PowerPyx estimates 50–75 hours at 5/10, and all 43 trophies are online, so the platinum is a multiplayer grind. Monthly suits it best. Trophy costs ₱299/week plus a ₱100 refundable deposit, and you can extend at the same price.'
    },
    {
      q: 'Do I need to rent Battlefield 6 to play REDSEC?',
      text: 'No. Sony lists Battlefield REDSEC as a separate free-to-play game, so you don\'t need a rental for it. Rent Battlefield 6 when you want the single-player campaign, Portal and the full multiplayer modes like Conquest, Breakthrough and Rush. Online multiplayer needs your own PS Plus subscription.'
    },
    {
      q: 'Does Battlefield 6 have split-screen or couch co-op?',
      text: 'No. Sony\'s Battlefield 6 page lists no local or split-screen multiplayer; it\'s built for online play with up to 64 players. For couch co-op on one PS5, rent It Takes Two, Split Fiction or A Way Out from ₱199/week instead. They\'re built for two players on one console.'
    },
    {
      q: 'Is Battlefield 6 on PS4?',
      text: 'No. Battlefield 6 is PS5 only, so we rent it on Non-Trophy and Trophy, not PS4 Primary. Non-Trophy is ₱249/week and comes with a free 3-hour try if a slot is available. Trophy is ₱299/week and keeps every trophy on your own profile.'
    }
  ]
};

function forSlug(slug) {
  const rows = BY_SLUG[String(slug || '')];
  if (!rows) return [];
  return rows.map(row => ({ q: row.q, text: row.text }));
}

module.exports = { forSlug, BY_SLUG };
