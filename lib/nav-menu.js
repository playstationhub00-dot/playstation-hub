// The main-nav Browse and Category menus. Pure: the route passes the live
// catalogue facts, price categories, and the trending list. Every count is
// how many games that link would open. Nothing here is stored.

function enc(s) {
  return encodeURIComponent(s);
}

function browseHref(query) {
  return query ? '/browse?' + query : '/browse';
}

function countOf(games, pred) {
  return (games || []).filter(pred).length;
}

function tierByName(tiers, test) {
  return (tiers || []).find(t => t && test(String(t.name || '')));
}

function build(input) {
  const src = input || {};
  const games = src.games || [];
  const tiers = src.tiers || [];
  const featured = (src.featured || []).slice(0, 3);
  const soonCount = Number(src.soonCount) || 0;
  const psplusCount = Number(src.psplusCount) || 0;
  const trendingCount = Number(src.trendingCount) || 0;

  const genres = new Map();
  games.forEach(g => {
    (g.genres || []).forEach(name => {
      if (!name) return;
      genres.set(name, (genres.get(name) || 0) + 1);
    });
  });
  const genreRows = [...genres.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({
      label: name,
      count,
      href: browseHref('genre=' + enc(name))
    }));

  const accounts = [
    ['tr', 'Trophy'],
    ['nt', 'Non-Trophy'],
    ['ps4', 'PS4 Primary']
  ].map(([key, label]) => ({
    key,
    label,
    count: countOf(games, g => (g.types || []).indexOf(key) >= 0),
    href: browseHref('account=' + key)
  }));

  const consoles = [
    ['ps5', 'PS5'],
    ['ps4', 'PS4']
  ].map(([key, label]) => ({
    key,
    label,
    count: countOf(games, g => !!g[key]),
    href: browseHref('console=' + key)
  }));

  const availability = [
    {
      key: 'open',
      label: 'Available',
      count: countOf(games, g => !!g.avail),
      href: browseHref('stock=open')
    },
    {
      key: 'full',
      label: 'Full — join the line',
      count: countOf(games, g => !g.avail),
      href: browseHref('stock=full')
    }
  ];

  const newGames = tierByName(tiers, name => /new games/i.test(name));
  const ladderNames = ['Deluxe', 'Special', 'Regular'];
  const ladder = ladderNames
    .map(name => tierByName(tiers, n => n.toLowerCase() === name.toLowerCase()))
    .filter(Boolean);
  const shortcuts = [
    { label: 'PS Plus Deluxe', count: psplusCount, href: browseHref('tab=psplus') }
  ];
  if (newGames) {
    shortcuts.push({
      label: 'New Games tier',
      count: countOf(games, g => String(g.tier) === String(newGames.id)),
      href: browseHref('tier=' + newGames.id)
    });
  }
  if (ladder.length) {
    shortcuts.push({
      label: ladder.map(t => t.name).join(' · '),
      count: countOf(games, g => ladder.some(t => String(g.tier) === String(t.id))),
      href: browseHref('tier=' + ladder.map(t => t.id).join(','))
    });
  }

  const newest = games.filter(g => g.released).length;

  return {
    browse: [
      { key: 'all', label: 'All games', detail: 'Every game you can rent', count: games.length, href: '/browse' },
      { key: 'new', label: 'Recently added', detail: 'Newest games on the site', count: Math.min(newest, 20), href: browseHref('tab=new') },
      { key: 'popular', label: 'Most popular', detail: 'Most rented by players', count: countOf(games, g => g.rank != null), href: browseHref('tab=most-rented') },
      { key: 'trending', label: 'Trending', detail: 'Hot this week', count: trendingCount, href: '/trending', fresh: true },
      { key: 'collections', label: 'Collections', detail: 'Bundles, Coming soon, Buy to keep, and PS Plus Deluxe.', count: null, href: '/collections' }
    ],
    featured,
    chips: [
      { label: 'Coming soon', count: soonCount, href: browseHref('tab=coming-soon') },
      { label: 'Available now', count: countOf(games, g => !!g.avail), href: browseHref('tab=available') },
      { label: 'Buy to keep', count: countOf(games, g => !!g.buy), href: browseHref('tab=buy') },
      { label: 'Bundles', count: countOf(games, g => !!g.bundle), href: browseHref('tab=bundles') },
      { label: 'PS Plus Deluxe', count: psplusCount, href: browseHref('tab=psplus') }
    ],
    category: {
      genres: genreRows,
      accounts,
      consoles,
      availability,
      shortcuts
    }
  };
}

module.exports = { build };
