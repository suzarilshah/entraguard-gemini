import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, isCoerced } from '../src/decision.js';
import { aliasMatch, chooseFact, matchNumber, signInFacts } from '../src/facts.js';
import { scriptFor, spoken } from '../src/scenarios.js';

const coached = { riskScore: 85, confidence: 0.9, vectors: ['in_room_coaching'] };

test('coercion refuses even when the number and the answer are both correct', () => {
  const v = decide({ expectedNumber: '68', enteredNumber: '68', coercion: coached, answerMatched: true });
  assert.equal(v.outcome, 'blocked-coaching');
  assert.equal(v.numberCorrect, true);
  assert.match(v.reason, /^The number was correct, but/);
});

test('coercion is reported ahead of a wrong number', () => {
  const v = decide({ expectedNumber: '68', enteredNumber: '12', coercion: coached, answerMatched: true });
  assert.equal(v.outcome, 'blocked-coaching');
  assert.match(v.reason, /incorrect, and separately/);
});

test('high risk without confidence is not acted on', () => {
  const v = decide({ expectedNumber: '68', enteredNumber: '68', coercion: { riskScore: 90, confidence: 0.6 }, answerMatched: true });
  assert.equal(v.outcome, 'passed');
});

test('thresholds are inclusive at exactly 60 and 0.75', () => {
  assert.equal(isCoerced({ riskScore: 60, confidence: 0.75 }), true);
  assert.equal(isCoerced({ riskScore: 59.9, confidence: 0.99 }), false);
  assert.equal(isCoerced({ riskScore: 99, confidence: 0.749 }), false);
  assert.equal(isCoerced(null), false);
});

test('a wrong number fails', () => {
  assert.equal(decide({ expectedNumber: '68', enteredNumber: '86', coercion: null, answerMatched: true }).outcome, 'failed');
  assert.equal(decide({ expectedNumber: '68', enteredNumber: null, coercion: null, answerMatched: true }).outcome, 'failed');
});

test('a correct number with a wrong answer fails', () => {
  const v = decide({ expectedNumber: '68', enteredNumber: '68', coercion: null, answerMatched: false });
  assert.equal(v.outcome, 'failed');
  assert.match(v.reason, /identity question/);
});

test('number and answer correct, no coercion: passes', () => {
  assert.equal(decide({ expectedNumber: '68', enteredNumber: ' 68 ', coercion: null, answerMatched: true }).outcome, 'passed');
});

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('user agents map to the browser and system a person would name', () => {
  const answers = (ua) => signInFacts(ua).map((f) => f.answer);
  assert.deepEqual(answers(CHROME_MAC), ['Google Chrome', 'macOS']);
  assert.deepEqual(answers(EDGE_WIN), ['Microsoft Edge', 'Windows']);
  assert.deepEqual(answers(SAFARI_IOS), ['Safari', 'iOS']);
  assert.deepEqual(signInFacts(''), []);
});

test('alias matching needs a whole word', () => {
  const chrome = signInFacts(CHROME_MAC)[0];
  assert.equal(aliasMatch('It was Chrome.', chrome), true);
  assert.equal(aliasMatch('google chrome i think', chrome), true);
  assert.equal(aliasMatch('chromebook', chrome), false);
  assert.equal(aliasMatch('', chrome), false);
});

test('choice and number are bounded', () => {
  assert.equal(chooseFact([], () => 0.5), null);
  const facts = signInFacts(CHROME_MAC);
  assert.equal(chooseFact(facts, () => 0.999).kind, 'os');
  assert.equal(matchNumber(() => 0), '10');
  assert.equal(matchNumber(() => 0.9999), '99');
});

test('both scripts reach the same number and the same correct answer', () => {
  const ctx = { number: '68', answer: 'Google Chrome', question: 'Which browser?' };
  for (const name of ['coached', 'genuine']) {
    const text = scriptFor(name, ctx).map((l) => l.text).join(' ');
    assert.ok(text.includes(spoken('68')), name);
    assert.ok(text.includes('Google Chrome'), name);
  }
  assert.equal(scriptFor('nope', ctx), null);
});
