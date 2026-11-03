// Run: node scripts/test-gameplay-lightbox.js
//
// The gameplay lightbox: open on a thumbnail, move with buttons, arrow keys
// and a swipe, close on the backdrop, unlock scroll, and put focus back.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function ok(desc, fn) { fn(); passed++; console.log('  ok - ' + desc); }

function load() {
  let focused = null;
  const listen = (node) => {
    node.listeners = {};
    node.addEventListener = (type, fn) => { (node.listeners[type] = node.listeners[type] || []).push(fn); };
    node.dispatch = (type, event) => (node.listeners[type] || []).forEach(fn => fn(event));
    node.focus = () => { focused = node; };
    node.classList = { toggle() {}, add() {}, remove() {} };
    return node;
  };
  const shot = (src, alt) => {
    const img = { getAttribute(k) { return k === 'src' ? src : alt; } };
    const btn = listen({ id: src, img, hidden: false, disabled: false });
    btn.querySelector = (sel) => sel === 'img' ? img : null;
    return btn;
  };
  const shots = [
    shot('https://image.api.playstation.com/a.jpg', 'shot 1'),
    shot('/uploads/b.jpg', 'shot 2'),
    shot('/uploads/c.jpg', 'shot 3')
  ];
  const track = listen({ id: 'gdSliderTrack', scrollTo() {} });
  track.querySelectorAll = () => shots;
  const img = listen({ id: 'gpLbImg', src: '', alt: '' });
  const count = listen({ id: 'gpLbCount', textContent: '' });
  const closeBtn = listen({ id: 'gpLbClose', hidden: false, disabled: false });
  const prev = listen({ id: 'gpLbPrev', hidden: false, disabled: false });
  const next = listen({ id: 'gpLbNext', hidden: false, disabled: false });
  const dialog = listen({ id: 'gpLightbox', open: false });
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; this.dispatch('close', {}); };
  const els = { gdSliderTrack: track, gpLbImg: img, gpLbCount: count, gpLbClose: closeBtn, gpLbPrev: prev, gpLbNext: next, gpLightbox: dialog };
  const body = { style: { overflow: 'auto' } };
  const document = {
    body,
    activeElement: null,
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  Object.defineProperty(document, 'activeElement', { get() { return focused; }, set(v) { focused = v; } });
  const ctx = {
    console,
    window: { addEventListener() {}, location: { search: '' } },
    document,
    PRICES: { nt: { 7: 1, 30: 2 }, tr: { 7: 1, 30: 2 }, ps4: { 7: 1, 30: 2 } },
    BUY_PRICES: { nt: 0, tr: 0 },
    PROMO: { enabled: true, discounts: { 7: 0, 30: 0 }, deposit: 100 },
    AVAIL: { nt: true, tr: true, ps4: false },
    ALL_UNAVAIL: false,
    gameTitle: 'Zzyzx',
    gdSlideCount: 3,
    RENTAL_DURATIONS: [7, 30],
    NEXT_DAYS: { tr: null, nt: null, ps4: null }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game-detail.js'), 'utf8'), ctx);
  return { ctx, dialog, img, count, shots, body, closeBtn, prev, next, focused: () => focused };
}

console.log('\ngameplay lightbox');

ok('opens on the clicked thumbnail, full src, counter, scroll locked', () => {
  const p = load();
  p.ctx.gpOpenFilm(1, p.shots[1]);
  assert.strictEqual(p.dialog.open, true);
  assert.strictEqual(p.img.src, '/uploads/b.jpg');
  assert.strictEqual(p.img.alt, 'shot 2');
  assert.strictEqual(p.count.textContent, '2 / 3');
  assert.strictEqual(p.body.style.overflow, 'hidden');
});

ok('next, previous, arrow keys and a swipe move through every image', () => {
  const p = load();
  p.ctx.gpOpenFilm(0, p.shots[0]);
  p.ctx.gpLbMove(1);
  assert.strictEqual(p.count.textContent, '2 / 3');
  assert.strictEqual(p.img.src, '/uploads/b.jpg');
  p.dialog.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.strictEqual(p.img.src, '/uploads/c.jpg');
  assert.strictEqual(p.count.textContent, '3 / 3');
  p.dialog.dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });
  assert.strictEqual(p.count.textContent, '2 / 3');
  p.dialog.dispatch('touchstart', { touches: [{ clientX: 180 }] });
  p.dialog.dispatch('touchend', { changedTouches: [{ clientX: 20 }] });
  assert.strictEqual(p.count.textContent, '3 / 3');
  p.ctx.gpLbMove(1);
  assert.strictEqual(p.count.textContent, '1 / 3');
  assert.strictEqual(p.img.src, 'https://image.api.playstation.com/a.jpg');
});

ok('backdrop and Close unlock scroll and return focus to the thumbnail', () => {
  const p = load();
  p.ctx.gpOpenFilm(2, p.shots[2]);
  assert.strictEqual(p.focused(), p.closeBtn);
  p.dialog.dispatch('click', { target: p.dialog });
  assert.strictEqual(p.dialog.open, false);
  assert.strictEqual(p.body.style.overflow, 'auto');
  assert.strictEqual(p.focused(), p.shots[2]);
  p.ctx.gpOpenFilm(0, p.shots[0]);
  p.ctx.gpCloseFilm();
  assert.strictEqual(p.dialog.open, false);
  assert.strictEqual(p.focused(), p.shots[0]);
});

ok('Tab stays inside the lightbox', () => {
  const p = load();
  p.ctx.gpOpenFilm(0, p.shots[0]);
  let prevented = false;
  p.dialog.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, false, 'tab from Close should not wrap yet');
  p.next.focus();
  prevented = false;
  p.dialog.dispatch('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, true);
  assert.strictEqual(p.focused(), p.closeBtn);
});

console.log('\n' + passed + ' assertions passed\n');
