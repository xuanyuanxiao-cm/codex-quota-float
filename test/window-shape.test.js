const assert = require('node:assert/strict');
const test = require('node:test');
const position = require('../dist/window-position');

const contains = (shape, x, y) => shape.some((rect) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);

test('native interaction shape includes the circle but excludes its square corners and padding', () => {
  assert.equal(typeof position.createWindowShape, 'function');
  const shape = position.createWindowShape([{ x: 12, y: 12, width: 76, height: 76, radius: 38 }]);
  assert.equal(contains(shape, 50, 50), true);
  assert.equal(contains(shape, 14, 50), true);
  assert.equal(contains(shape, 50, 14), true);
  for (const [x, y] of [[0, 0], [12, 12], [87, 87], [5, 50], [95, 50]]) {
    assert.equal(contains(shape, x, y), false, `blank point ${x},${y} must pass through`);
  }
});

test('expanded shape excludes the gap, panel rounded corners, and the old picker footprint', () => {
  assert.equal(typeof position.createWindowShape, 'function');
  const shape = position.createWindowShape([
    { x: 198, y: 20, width: 76, height: 76, radius: 38 },
    { x: 12, y: 114, width: 262, height: 192, radius: 18 },
  ]);
  assert.equal(contains(shape, 236, 58), true);
  assert.equal(contains(shape, 140, 180), true);
  for (const [x, y] of [[140, 60], [236, 105], [12, 114], [140, 340], [280, 180]]) {
    assert.equal(contains(shape, x, y), false, `blank point ${x},${y} must pass through`);
  }
});

test('normal and picker bounds use their measured height without moving the orb anchor', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(position.rightDockBounds(area, 'normal', 320, 318), { x: 1626, y: 320, width: 286, height: 318 });
  assert.deepEqual(position.rightDockBounds(area, 'picker', 320, 360), { x: 1626, y: 320, width: 286, height: 360 });
  assert.deepEqual(position.rightDockBounds(area, 'collapsed', 320, 100), { x: 1812, y: 328, width: 100, height: 100 });
  assert.deepEqual(position.rightDockBounds(area, 'collapsed', 320, 131), { x: 1812, y: 328, width: 100, height: 131 });
  assert.deepEqual(position.rightDockBounds(area, 'summary', 320, 170), { x: 1626, y: 328, width: 286, height: 170 });
});

test('content near the bottom is clamped inside the work area at the current height', () => {
  const area = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(position.rightDockBounds(area, 'normal', 900, 318), { x: -294, y: 722, width: 286, height: 318 });
  assert.deepEqual(position.rightDockBounds(area, 'collapsed', 1000, 131), { x: -108, y: 909, width: 100, height: 131 });
  assert.deepEqual(position.rightDockBounds(area, 'summary', 1000, 170), { x: -294, y: 870, width: 286, height: 170 });
});
