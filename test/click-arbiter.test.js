const assert = require('node:assert/strict');
const test = require('node:test');
const { createClickArbiter } = require('../dist/renderer/click-arbiter');

test('single click waits 220ms; double click and disposal cancel it', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clicks = 0;
  const arbiter = createClickArbiter(() => clicks++);
  arbiter.scheduleSingle(); t.mock.timers.tick(219); assert.equal(clicks, 0);
  t.mock.timers.tick(1); assert.equal(clicks, 1);
  arbiter.scheduleSingle(); arbiter.cancelSingle(); t.mock.timers.tick(220); assert.equal(clicks, 1);
  arbiter.scheduleSingle(); arbiter.dispose(); t.mock.timers.tick(220); assert.equal(clicks, 1);
});

test('a later click replaces the pending single click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clicks = 0;
  const arbiter = createClickArbiter(() => clicks++, 100);
  arbiter.scheduleSingle(); t.mock.timers.tick(50); arbiter.scheduleSingle();
  t.mock.timers.tick(99); assert.equal(clicks, 0);
  t.mock.timers.tick(1); assert.equal(clicks, 1);
});
