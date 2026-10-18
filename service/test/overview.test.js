import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarise } from '../src/overview.js';

const now = Date.parse('2026-10-18T12:00:00Z');
const docs = [
  { id: 'a', uid: 'me', user: { name: 'Me', email: 'me@example.com' }, question: 'Which browser?', status: 'passed',
    verdict: { outcome: 'passed', reason: 'ok' }, peak: { riskScore: 0, confidence: 0.9, vectors: [] },
    createdAt: new Date(now - 30 * 60_000), app: 'treasury', mode: 'microphone' },
  { id: 'b', uid: 'other', user: { name: 'Other Person', email: 'other@example.com' }, question: 'Which OS?', status: 'refused',
    verdict: { outcome: 'blocked-coaching', reason: 'coached' }, peak: { riskScore: 95, confidence: 0.9, vectors: ['in_room_coaching'] },
    createdAt: new Date(now - 20 * 60_000), mode: 'script:coached' },
  { id: 'c', uid: 'other', user: { email: 'other@example.com' }, status: 'live', createdAt: new Date(now - 60_000), updatedAt: new Date(now - 30_000) },
  { id: 'd', uid: 'other', status: 'live', createdAt: new Date(now - 3600_000), updatedAt: new Date(now - 3600_000) },
];

test('counts every outcome, including in-progress and abandoned', () => {
  const o = summarise(docs, { viewerUid: 'me', operator: false, hours: 24, now });
  assert.deepEqual(o.counts, { total: 4, passed: 1, blocked: 1, failed: 0, inProgress: 2, abandoned: 0 });
  assert.equal(o.live.length, 1, 'only recently updated sessions are live');
  assert.equal(o.live[0].id, 'c');
  assert.deepEqual(o.vectors, [{ name: 'in_room_coaching', count: 1 }]);
});

test('a visitor sees their own identity but never someone else’s', () => {
  const o = summarise(docs, { viewerUid: 'me', operator: false, hours: 24, now });
  const mine = o.records.find((r) => r.id === 'a');
  const theirs = o.records.find((r) => r.id === 'b');
  assert.equal(mine.who, 'Me');
  assert.equal(mine.question, 'Which browser?');
  assert.equal(mine.detail, true);
  assert.equal(theirs.who, 'o•••@example.com');
  assert.equal(theirs.question, null);
  assert.equal(theirs.detail, false);
  assert.equal(theirs.peakRisk, 95, 'scores and tactics stay visible');
});

test('an operator sees everyone', () => {
  const o = summarise(docs, { viewerUid: 'me', operator: true, hours: 24, now });
  const theirs = o.records.find((r) => r.id === 'b');
  assert.equal(theirs.who, 'Other Person');
  assert.equal(theirs.detail, true);
});
