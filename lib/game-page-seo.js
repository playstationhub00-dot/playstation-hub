// Per-game title and meta overrides for the five priority pages.
// The peso figure is the live weekly Non-Trophy price (after that week's
// discount), so the string regenerates when the price changes. Pattern and
// wording are Title A / Meta A from the 2026-10-21 SEO briefs.
// "PS Hub" is only used here. Every other page keeps "PlayStation Hub".

function peso(amount) {
  return '₱' + amount;
}

const OVERRIDES = {
  'ghost-of-yotei': {
    title: (p) => 'Rent Ghost of Yotei PS5 Philippines – from ' + peso(p) + ' | PS Hub',
    description: (p) => 'Rent Ghost of Yotei for PS5 in the Philippines from ' + peso(p) + '/week. Non-Trophy or Trophy, free 3-hour try, free game swaps. Pay via GCash, Maya or PayPal.'
  },
  'resident-evil-requiem': {
    title: (p) => 'Rent Resident Evil Requiem PS5 Philippines – ' + peso(p) + ' | PS Hub',
    description: (p) => 'Rent Resident Evil Requiem for PS5 in the Philippines from ' + peso(p) + '/week. Finish the ~11-hour story in a week, swap games free. GCash, Maya or PayPal.'
  },
  '007-first-light': {
    title: (p) => 'Rent 007 First Light PS5 Philippines – from ' + peso(p) + ' | PS Hub',
    description: (p) => 'Rent 007 First Light for PS5 in the Philippines from ' + peso(p) + '/week. Finish Bond\'s 17-chapter origin story in a week, then swap games free. GCash, Maya, PayPal.'
  },
  'crimson-desert': {
    title: (p) => 'Rent Crimson Desert PS5 Philippines – from ' + peso(p) + ' | PS Hub',
    description: (p) => 'Rent Crimson Desert for PS5 in the Philippines from ' + peso(p) + '/week. A 60+ hour open world? Go Monthly and extend at the same price. GCash, Maya or PayPal.'
  },
  'battlefield-6': {
    title: (p) => 'Rent Battlefield 6 PS5 Philippines – from ' + peso(p) + ' | PS Hub',
    description: (p) => 'Rent Battlefield 6 for PS5 in the Philippines from ' + peso(p) + '/week. Campaign in a week; online multiplayer needs your own PS Plus. Pay via GCash, Maya or PayPal.'
  }
};

function override(slug) {
  return OVERRIDES[String(slug || '')] || null;
}

module.exports = { override, OVERRIDES };
