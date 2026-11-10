// Run: node scripts/test-admin-shell.js
//
// The new admin shell keeps every old tab and adds the groups from the
// approved information architecture. Old ?tab= values still name a real panel.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'views', 'admin.ejs'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'admin-shell.css'), 'utf8');
const panels = admin + '\n' + ['today', 'returns', 'dashboard', 'orders', 'customers', 'loyalty', 'games', 'accounts', 'content', 'messaging', 'psplus', 'posters', 'settings']
  .map(name => {
    const file = path.join(root, 'views', 'partials', 'admin', name + '.ejs');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }).join('\n');

ok('sidebar groups match the approved map', () => {
  ['Overview', 'Rentals', 'Games &amp; accounts', 'Customers', 'Marketing', 'Settings'].forEach(g => {
    assert.ok(admin.includes('>' + g + '<'), g);
  });
});

ok('every new nav label is present, and old pages stay reachable', () => {
  ['Today', 'Dashboard', 'Orders', 'Returns &amp; deposits', 'Games', 'Accounts &amp; slots',
    'Game requests', 'PS Plus list', 'Customers', 'Loyalty', 'Site content', 'Announcements',
    'Promos', 'Posters', 'Messaging', 'Settings', 'View site', 'Log out'].forEach(label => {
    assert.ok(admin.includes(label), label);
  });
  ['today', 'dashboard', 'orders', 'returns', 'customers', 'loyalty', 'games', 'accounts',
    'content', 'messaging', 'psplus', 'posters', 'settings'].forEach(id => {
    assert.ok(panels.includes('id="tab-' + id + '"'), id);
  });
});

ok('old links are not renamed: dashboard, orders, customers, games, accounts, content, psplus, settings', () => {
  ['dashboard', 'orders', 'customers', 'games', 'accounts', 'content', 'messaging', 'psplus', 'posters', 'settings']
    .forEach(tab => assert.ok(admin.includes('data-tab="' + tab + '"'), tab));
});

ok('the active nav is gold', () => {
  assert.ok(admin.includes('#F5B800') || css.includes('#F5B800'));
  assert.ok(css.includes('.admin-tab.active'));
});

ok('phone layout has the five bottom tabs', () => {
  ['data-bottom="today"', 'data-bottom="orders"', 'data-bottom="games"', 'data-bottom="messaging"', 'data-bottom="more"']
    .forEach(s => assert.ok(admin.includes(s), s));
  assert.ok(admin.includes('>Today</button>'));
  assert.ok(admin.includes('>Orders</button>'));
  assert.ok(admin.includes('>Games</button>'));
  assert.ok(admin.includes('>Messages</button>'));
  assert.ok(admin.includes('>More</button>'));
});

ok('Today and the confirm dialog are included', () => {
  assert.ok(admin.includes("include('partials/admin/today')"));
  assert.ok(admin.includes("include('partials/admin/returns')"));
  assert.ok(admin.includes("include('partials/admin/confirm-dialog')"));
  assert.ok(admin.includes('/js/admin-confirm.js'));
  assert.ok(admin.includes('/js/admin-mask.js'));
});

console.log('\n' + passed + ' assertions passed\n');
