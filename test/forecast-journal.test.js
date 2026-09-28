const test = require('node:test');
const assert = require('node:assert/strict');
const { recordForecast } = require('../dist/forecast-journal');
const NOW = Date.parse('2026-09-28T08:00:00Z');
const data = { asOf: NOW, healthy: true, probability: .341234, records: [] };
test('forecast keeps original precision and uses announcement evidence only after observation', () => {
    const saved = { records: [] }; recordForecast(saved, data, NOW);
    recordForecast(saved, data, NOW + 1000); assert.equal(saved.forecasts.length, 1);
    saved.records.push({ id: 'one', eventId: 'event-one', kind: 'banked', stage: 'completed', verified: true, outcomeScope: 'targeted', publishedAt: NOW + 1000 });
    recordForecast(saved, data, NOW + 2000); assert.equal(saved.forecasts[0].outcome, 'pending');
    saved.records[0].outcomeScope = 'broad'; recordForecast(saved, data, NOW + 3000);
    assert.equal(saved.forecasts[0].outcome, 'event'); assert.equal(saved.forecasts[0].probability, .341234);
    const late = { records: saved.records }; recordForecast(late, data, NOW + 10000);
    assert.notEqual(late.forecasts[0].outcome, 'event');
});
