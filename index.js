/**
 * prompt-cache-fit
 *
 * Providers cache prompt prefixes. The cache breaks at the first byte that
 * differs between two requests, so volatile content (timestamps, user ids,
 * the live turn) needs to sit at the end of the prompt, not the top. This
 * module reorders prompt blocks from least-volatile to most-volatile and
 * measures how much of the prefix is expected to survive between requests.
 */

/**
 * Volatility tiers and their sort rank. Lower rank sorts first (stays near
 * the top of the prompt, closer to the cacheable prefix). Exported as a
 * plain object so forkers can add their own tiers.
 * @type {{ static: 0, shared: 1, session: 2, turn: 3 }}
 */
export const VOLATILITY = { static: 0, shared: 1, session: 2, turn: 3 };

/**
 * Resolve the sort rank for a volatility label. Missing or unrecognized
 * labels fall back to 'turn' (the most volatile tier) rather than throwing.
 * @param {string} [volatility]
 * @returns {number}
 */
function rankOf(volatility) {
  if (volatility !== undefined && Object.prototype.hasOwnProperty.call(VOLATILITY, volatility)) {
    return VOLATILITY[volatility];
  }
  return VOLATILITY.turn;
}

/**
 * Reorder prompt blocks from least-volatile to most-volatile so that the
 * shared, cacheable prefix is as long as possible, and render them into a
 * single prompt string.
 * @param {{ text: string, volatility?: string, id?: string, pin?: boolean }[]} blocks
 * @param {{ separator?: string }} [options]
 * @returns {{
 *   blocks: { text: string, volatility?: string, id?: string, pin?: boolean }[],
 *   text: string,
 *   moved: number,
 *   stablePrefixChars: number
 * }}
 */
export function fit(blocks, options) {
  const opts = options === undefined || options === null ? {} : options;
  const separator = opts.separator !== undefined ? opts.separator : '\n\n';

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { blocks: [], text: '', moved: 0, stablePrefixChars: 0 };
  }

  // Split into pinned (keep original index) and non-pinned (sortable) blocks.
  const pinnedIndices = [];
  const nonPinned = [];
  blocks.forEach((block, index) => {
    if (block && block.pin === true) {
      pinnedIndices.push(index);
    } else {
      nonPinned.push({ block, index });
    }
  });

  // Array.prototype.sort is stable in Node 18+, so ties keep original order.
  nonPinned.sort((a, b) => rankOf(a.block.volatility) - rankOf(b.block.volatility));

  // Reinsert pinned blocks at their original indices; fill the rest in
  // sorted order.
  const result = new Array(blocks.length);
  for (const idx of pinnedIndices) {
    result[idx] = blocks[idx];
  }
  let cursor = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      result[i] = nonPinned[cursor].block;
      cursor++;
    }
  }

  const text = result.map((block) => block.text).join(separator);

  let moved = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (result[i] !== blocks[i]) moved++;
  }

  // Chars from the start through the end of the last block whose rank is
  // less than 'turn' (3), including the separator that follows it if
  // another block comes after it. 0 if every block is 'turn'.
  let lastStableIndex = -1;
  for (let i = 0; i < result.length; i++) {
    if (rankOf(result[i].volatility) < VOLATILITY.turn) {
      lastStableIndex = i;
    }
  }
  let stablePrefixChars = 0;
  if (lastStableIndex >= 0) {
    for (let i = 0; i <= lastStableIndex; i++) {
      stablePrefixChars += result[i].text.length;
      if (i < lastStableIndex) stablePrefixChars += separator.length;
    }
    if (lastStableIndex < result.length - 1) stablePrefixChars += separator.length;
  }

  return { blocks: result, text, moved, stablePrefixChars };
}

/**
 * Count the shared leading characters between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function sharedPrefix(a, b) {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

/**
 * Measure how much of each rendered prompt's prefix was shared with the
 * prompt sent immediately before it, as a proxy for provider prefix-cache
 * hit rate.
 * @param {string[]} prompts - rendered prompt strings, in send order.
 * @returns {{
 *   perRequest: number[],
 *   mean: number,
 *   cachedChars: number,
 *   totalChars: number
 * }}
 */
export function hitRate(prompts) {
  const perRequest = [];
  let cachedChars = 0;
  let totalChars = 0;

  for (let i = 1; i < prompts.length; i++) {
    const previous = prompts[i - 1];
    const current = prompts[i];
    const shared = sharedPrefix(previous, current);
    const fraction = current.length === 0 ? 0 : shared / current.length;
    perRequest.push(fraction);
    cachedChars += shared;
    totalChars += current.length;
  }

  const mean = perRequest.length === 0
    ? 0
    : perRequest.reduce((sum, value) => sum + value, 0) / perRequest.length;

  return { perRequest, mean, cachedChars, totalChars };
}
