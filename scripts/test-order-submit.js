// Run: node scripts/test-order-submit.js
const assert = require('assert');
const guard = require('../public/js/order-submit.js').guardOrderSubmit;

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

function form(attrs) {
  const el = {
    attrs: Object.assign({}, attrs),
    button: { disabled: false },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector() { return this.button; }
  };
  return el;
}

check('a form that is not a checkout is left alone', () => {
  const f = form({});
  const event = { defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; } };
  assert.strictEqual(guard(f, event), true);
  assert.strictEqual(event.prevented, false);
  assert.strictEqual(f.button.disabled, false);
});

check('the first submit is allowed and the second is blocked', () => {
  const f = form({ 'data-order-once': '' });
  const first = { defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; } };
  assert.strictEqual(guard(f, first), true);
  assert.strictEqual(first.prevented, false);
  assert.strictEqual(f.getAttribute('data-order-sent'), '1');
  const second = { defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; } };
  assert.strictEqual(guard(f, second), false);
  assert.strictEqual(second.prevented, true);
});

check('a validation failure does not burn the submit', () => {
  const f = form({ 'data-order-once': '' });
  const blocked = { defaultPrevented: true, prevented: false, preventDefault() { this.prevented = true; } };
  assert.strictEqual(guard(f, blocked), true);
  assert.strictEqual(f.getAttribute('data-order-sent'), null);
  const retry = { defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; } };
  assert.strictEqual(guard(f, retry), true);
  assert.strictEqual(retry.prevented, false);
});

console.log('\n' + passed + ' assertions passed');
