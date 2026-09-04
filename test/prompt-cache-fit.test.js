import test from 'node:test';
import assert from 'node:assert/strict';
import { fit, sharedPrefix, hitRate, VOLATILITY } from '../index.js';

test('VOLATILITY exposes the exact rank table', () => {
  assert.deepEqual(VOLATILITY, { static: 0, shared: 1, session: 2, turn: 3 });
});

test('fit() on an empty array returns the exact empty result', () => {
  assert.deepEqual(fit([]), { blocks: [], text: '', moved: 0, stablePrefixChars: 0 });
});

test('fit() leaves order unchanged when every block shares a volatility', () => {
  const blocks = [
    { text: 'p', volatility: 'session' },
    { text: 'q', volatility: 'session' },
    { text: 'r', volatility: 'session' },
  ];
  const result = fit(blocks);
  assert.equal(result.moved, 0);
  assert.equal(result.text, 'p\n\nq\n\nr');
  assert.deepEqual(result.blocks, blocks);
});

test('fit() sorts by volatility rank, static first', () => {
  const a = { text: 'A', volatility: 'turn' };
  const b = { text: 'B', volatility: 'static' };
  const c = { text: 'C', volatility: 'shared' };
  const result = fit([a, b, c]);
  assert.deepEqual(result.blocks, [b, c, a]);
  assert.equal(result.text, 'B\n\nC\n\nA');
});

test('fit() keeps original relative order for blocks tied on rank (stable sort)', () => {
  const t1 = { text: 'x', volatility: 'turn', id: 't1' };
  const s1 = { text: 'y', volatility: 'static', id: 's1' };
  const t2 = { text: 'z', volatility: 'turn', id: 't2' };
  const result = fit([t1, s1, t2]);
  assert.deepEqual(result.blocks.map((block) => block.id), ['s1', 't1', 't2']);
});

test('fit() treats a missing volatility as turn (default)', () => {
  const m = { text: 'M' };
  const n = { text: 'N', volatility: 'static' };
  const result = fit([m, n]);
  assert.deepEqual(result.blocks, [n, m]);
});

test('fit() treats an unknown volatility string as turn instead of throwing', () => {
  const x = { text: 'X', volatility: 'made-up-tier' };
  const y = { text: 'Y', volatility: 'static' };
  assert.doesNotThrow(() => fit([x, y]));
  const result = fit([x, y]);
  assert.deepEqual(result.blocks, [y, x]);
});

test('fit() keeps a pinned block at its original index while everything else sorts around it, and counts moved correctly', () => {
  const a = { text: 'A', volatility: 'turn' };
  const b = { text: 'B', volatility: 'static', pin: true };
  const c = { text: 'C', volatility: 'static' };
  const d = { text: 'D', volatility: 'turn' };
  const result = fit([a, b, c, d]);
  // B is static and would otherwise jump to index 0, but pin holds it at index 1.
  assert.equal(result.blocks[1], b);
  assert.deepEqual(result.blocks, [c, b, a, d]);
  // A and C changed index; B (pinned) and D did not.
  assert.equal(result.moved, 2);
});

test('fit() supports a custom separator', () => {
  const result = fit([{ text: 'a' }, { text: 'b' }], { separator: '|' });
  assert.equal(result.text, 'a|b');
});

test('fit() uses "\\n\\n" as the default separator', () => {
  const result = fit([{ text: 'a' }, { text: 'b' }]);
  assert.equal(result.text, 'a\n\nb');
});

test('fit() treats an explicit null options the same as omitted options', () => {
  const withNull = fit([{ text: 'a' }], null);
  const withDefault = fit([{ text: 'a' }]);
  assert.deepEqual(withNull, withDefault);
  assert.deepEqual(withNull, { blocks: [{ text: 'a' }], text: 'a', moved: 0, stablePrefixChars: 0 });
});

test('fit() computes stablePrefixChars through the last non-turn block, including the following separator', () => {
  const staticBlock = { text: 'sys', volatility: 'static' };
  const sharedBlock = { text: 'tools', volatility: 'shared' };
  const turnBlock = { text: 'question', volatility: 'turn' };
  const result = fit([staticBlock, turnBlock, sharedBlock]);
  assert.deepEqual(result.blocks, [staticBlock, sharedBlock, turnBlock]);
  // 'sys' (3) + sep (2) + 'tools' (5) + sep (2) = 12, up through and including
  // the separator that follows the last non-turn block.
  assert.equal(result.stablePrefixChars, 12);
});

test('fit() stablePrefixChars is 0 when every block is turn', () => {
  const result = fit([{ text: 'a' }, { text: 'b' }]);
  assert.equal(result.stablePrefixChars, 0);
});

test('sharedPrefix counts matching leading characters', () => {
  assert.equal(sharedPrefix('abc', 'abd'), 2);
  assert.equal(sharedPrefix('abc', 'abc'), 3);
  assert.equal(sharedPrefix('ab', 'abc'), 2);
});

test('sharedPrefix handles empty strings', () => {
  assert.equal(sharedPrefix('', ''), 0);
  assert.equal(sharedPrefix('abc', ''), 0);
});

test('hitRate([]) reports all zeros with no per-request entries', () => {
  const report = hitRate([]);
  assert.deepEqual(report.perRequest, []);
  assert.equal(report.mean, 0);
  assert.equal(report.cachedChars, 0);
  assert.equal(report.totalChars, 0);
});

test('hitRate() with a single prompt reports all zeros with no per-request entries', () => {
  const report = hitRate(['only one']);
  assert.deepEqual(report.perRequest, []);
  assert.equal(report.mean, 0);
  assert.equal(report.cachedChars, 0);
  assert.equal(report.totalChars, 0);
});

test('hitRate() guards against division by zero on an empty prompt', () => {
  const report = hitRate(['abc', '']);
  assert.deepEqual(report.perRequest, [0]);
  assert.equal(report.mean, 0);
  assert.equal(report.cachedChars, 0);
  assert.equal(report.totalChars, 0);
});

test('hitRate() computes per-request fractions, mean, cachedChars and totalChars', () => {
  const report = hitRate(['hello world', 'hello there', 'hello there friend']);
  // 'hello world' vs 'hello there' share 'hello ' -> 6 chars / 11 = 0.5454...
  // 'hello there' vs 'hello there friend' share all 11 chars / 18 = 0.6111...
  assert.equal(report.perRequest.length, 2);
  assert.equal(report.perRequest[0], 6 / 11);
  assert.equal(report.perRequest[1], 11 / 18);
  assert.equal(report.cachedChars, 6 + 11);
  assert.equal(report.totalChars, 11 + 18);
  assert.equal(report.mean, (6 / 11 + 11 / 18) / 2);
});

test('README worked case: moving the volatile block to the end raises the measured hit rate', () => {
  const staticBlock = { text: 'You are a helpful coding assistant.', volatility: 'static' };
  const toolsBlock = { text: 'Tools: search_docs(query), run_tests()', volatility: 'shared' };
  const sessionBlock = {
    text: 'User profile: senior backend engineer, prefers concise answers.',
    volatility: 'session',
  };
  const timestamp1 = { text: 'Timestamp: 2026-09-04T10:00:00Z', volatility: 'turn' };
  const question1 = { text: 'Turn: how do I retry a failed HTTP request?', volatility: 'turn' };
  const timestamp2 = { text: 'Timestamp: 2026-09-04T10:05:00Z', volatility: 'turn' };
  const question2 = { text: 'Turn: how do I cancel an in-flight fetch?', volatility: 'turn' };

  // Hand-rolled order: the volatile timestamp sits in the middle.
  const handRolled1 = [staticBlock, timestamp1, toolsBlock, sessionBlock, question1]
    .map((block) => block.text)
    .join('\n\n');
  const handRolled2 = [staticBlock, timestamp2, toolsBlock, sessionBlock, question2]
    .map((block) => block.text)
    .join('\n\n');

  // fit(): volatile blocks pushed to the end.
  const fitted1 = fit([staticBlock, timestamp1, toolsBlock, sessionBlock, question1]);
  const fitted2 = fit([staticBlock, timestamp2, toolsBlock, sessionBlock, question2]);

  const handRolledReport = hitRate([handRolled1, handRolled2]);
  const fittedReport = hitRate([fitted1.text, fitted2.text]);

  assert.equal(handRolledReport.mean, 63 / 216);
  assert.equal(fittedReport.mean, 168 / 216);
  assert.ok(fittedReport.mean > handRolledReport.mean);
});
