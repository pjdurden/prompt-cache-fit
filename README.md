# prompt-cache-fit

Reorder LLM prompt blocks from least- to most-volatile so provider prefix caches stay hot, and measure whether it actually worked.

## The problem

Anthropic, OpenAI, xAI and DeepSeek all cache prompt *prefixes*. The cache is only reusable up to the first byte that differs between two requests. Teams that put a timestamp, a request id, or "today's date" near the top of the system prompt throw away the cache for every token below it, even though the rest of the prompt (the system message, the tool schema, the RAG chunks) did not actually change. The published advice is "order your prompt from least-variable to most-variable", but every team hand-rolls that ordering, and almost nobody measures whether the reordering actually raised the hit rate. This package does the reordering and the measurement, nothing else: no tokenizer, no provider SDK, no network calls.

## Install

```
npm i prompt-cache-fit
```

## Usage

```js
import { fit, hitRate } from 'prompt-cache-fit';

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

// Hand-rolled: the volatile timestamp sits in the middle of the prompt.
const handRolled1 = [staticBlock, timestamp1, toolsBlock, sessionBlock, question1]
  .map((b) => b.text)
  .join('\n\n');
const handRolled2 = [staticBlock, timestamp2, toolsBlock, sessionBlock, question2]
  .map((b) => b.text)
  .join('\n\n');

// fit(): volatile blocks (rank 'turn') sort to the end automatically.
const fitted1 = fit([staticBlock, timestamp1, toolsBlock, sessionBlock, question1]);
const fitted2 = fit([staticBlock, timestamp2, toolsBlock, sessionBlock, question2]);

console.log(hitRate([handRolled1, handRolled2]).mean); // 0.2916666666666667
console.log(hitRate([fitted1.text, fitted2.text]).mean); // 0.7777777777777778
```

Moving the two `turn`-tier blocks to the end of the prompt takes the measured prefix hit rate on the second request from about 29% to about 78%, because the shared system prompt, tool schema and session block now form one unbroken prefix instead of being interrupted by the timestamp.

## API

### `fit(blocks, options?) -> FitResult`

- `blocks: { text: string, volatility?: string, id?: string, pin?: boolean }[]`
- `volatility` is one of `'static' | 'shared' | 'session' | 'turn'`, ranked in that order (`static` sorts first, `turn` sorts last). Missing or unrecognized values default to `'turn'`; unknown strings never throw.
- `pin: true` keeps that block at its original index. Every other block is sorted around it.
- The sort is stable: two blocks with the same rank keep their original relative order.
- `options.separator` (default `'\n\n'`): the string joined between rendered blocks.
- Returns:
  - `blocks`: the input blocks, reordered.
  - `text`: the reordered blocks joined with `separator`.
  - `moved`: count of blocks whose index differs from the input.
  - `stablePrefixChars`: characters from the start of `text` through the end of the last block ranked below `turn`, including the separator that follows it if another block comes after. `0` if every block is `turn`.

### `sharedPrefix(a, b) -> number`

Number of shared leading characters between two strings. `sharedPrefix('abc', 'abd')` is `2`. Returns `0` for empty strings.

### `hitRate(prompts) -> HitRateReport`

`prompts` is an array of already-rendered prompt strings, in send order. For each prompt after the first, computes `sharedPrefix(prompts[i-1], prompts[i]) / prompts[i].length`. Returns:

- `perRequest`: one fraction (`0..1`) per request after the first.
- `mean`: mean of `perRequest`, `0` if fewer than 2 prompts were given.
- `cachedChars`: sum of shared prefix lengths across all requests after the first.
- `totalChars`: sum of `prompts[i].length` for `i >= 1`.

An empty prompt string contributes `0` instead of dividing by zero.

### `VOLATILITY`

`{ static: 0, shared: 1, session: 2, turn: 3 }`, exported as a plain object so forkers can add their own tiers or change the ranks.

## How it works

`fit()` is a stable sort by volatility rank plus a reinsertion pass for pinned blocks; `hitRate()` is a character-by-character common-prefix scan. That is the whole library. It does not know how any provider actually tokenizes or chunks its cache, so `stablePrefixChars` and `hitRate` are character-level proxies, not a guarantee of a provider-side cache hit: real caches key on token boundaries and have their own minimum prefix length and TTL. This package also does not inject provider-specific cache markers (Anthropic's `cache_control`, OpenAI's automatic prefix caching, etc.) into the output; ordering the blocks correctly is a precondition for those markers to help, but adding the markers themselves is left to the caller, since the marker format is provider-specific and out of scope here.

## License

MIT
