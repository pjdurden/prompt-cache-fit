# prompt-cache-fit

Reorder LLM prompt blocks from least- to most-volatile so provider prefix caches stay hot, and measure whether it actually worked. This is the Python port of the JavaScript package of the same name.

## The problem

Anthropic, OpenAI, xAI and DeepSeek all cache prompt *prefixes*. The cache is only reusable up to the first byte that differs between two requests. Teams that put a timestamp, a request id, or "today's date" near the top of the system prompt throw away the cache for every token below it, even though the rest of the prompt (the system message, the tool schema, the RAG chunks) did not actually change. The published advice is "order your prompt from least-variable to most-variable", but every team hand-rolls that ordering, and almost nobody measures whether the reordering actually raised the hit rate. This package does the reordering and the measurement, nothing else: no tokenizer, no provider SDK, no network calls.

## Install

```
pip install prompt-cache-fit
```

## Usage

```python
from prompt_cache_fit import fit, hit_rate

static_block = {"text": "You are a helpful coding assistant.", "volatility": "static"}
tools_block = {"text": "Tools: search_docs(query), run_tests()", "volatility": "shared"}
session_block = {
    "text": "User profile: senior backend engineer, prefers concise answers.",
    "volatility": "session",
}
timestamp1 = {"text": "Timestamp: 2026-09-04T10:00:00Z", "volatility": "turn"}
question1 = {"text": "Turn: how do I retry a failed HTTP request?", "volatility": "turn"}
timestamp2 = {"text": "Timestamp: 2026-09-04T10:05:00Z", "volatility": "turn"}
question2 = {"text": "Turn: how do I cancel an in-flight fetch?", "volatility": "turn"}

# Hand-rolled: the volatile timestamp sits in the middle of the prompt.
hand_rolled1 = "\n\n".join(
    b["text"] for b in [static_block, timestamp1, tools_block, session_block, question1]
)
hand_rolled2 = "\n\n".join(
    b["text"] for b in [static_block, timestamp2, tools_block, session_block, question2]
)

# fit(): volatile blocks (rank 'turn') sort to the end automatically.
fitted1 = fit([static_block, timestamp1, tools_block, session_block, question1])
fitted2 = fit([static_block, timestamp2, tools_block, session_block, question2])

print(hit_rate([hand_rolled1, hand_rolled2]).mean)  # 0.2916666666666667
print(hit_rate([fitted1.text, fitted2.text]).mean)  # 0.7777777777777778
```

Moving the two `turn`-tier blocks to the end of the prompt takes the measured prefix hit rate on the second request from about 29% to about 78%, because the shared system prompt, tool schema and session block now form one unbroken prefix instead of being interrupted by the timestamp.

## API

### `fit(blocks, *, separator="\n\n") -> FitResult`

- `blocks: List[Dict[str, Any]]`, each dict with a required `text: str` key and optional `volatility: str`, `id`, `pin: bool` keys. Plain dicts are accepted; no class is required.
- `volatility` is one of `"static" | "shared" | "session" | "turn"`, ranked in that order (`static` sorts first, `turn` sorts last). Missing or unrecognized values default to `"turn"`; unknown strings never raise.
- `pin=True` on a block keeps that block at its original index. Every other block is sorted around it.
- The sort is stable: two blocks with the same rank keep their original relative order.
- `separator` (keyword-only, default `"\n\n"`): the string joined between rendered blocks.
- Returns a frozen `FitResult` dataclass:
  - `blocks`: the input blocks, reordered.
  - `text`: the reordered blocks joined with `separator`.
  - `moved`: count of blocks whose index differs from the input.
  - `stable_prefix_chars`: characters from the start of `text` through the end of the last block ranked below `turn`, including the separator that follows it if another block comes after. `0` if every block is `turn`.

### `shared_prefix(a, b) -> int`

Number of shared leading characters between two strings. `shared_prefix("abc", "abd")` is `2`. Returns `0` for empty strings.

### `hit_rate(prompts) -> HitRateReport`

`prompts` is a list of already-rendered prompt strings, in send order. For each prompt after the first, computes `shared_prefix(prompts[i-1], prompts[i]) / len(prompts[i])`. Returns a frozen `HitRateReport` dataclass:

- `per_request`: one fraction (`0..1`) per request after the first.
- `mean`: mean of `per_request`, `0` if fewer than 2 prompts were given.
- `cached_chars`: sum of shared prefix lengths across all requests after the first.
- `total_chars`: sum of `len(prompts[i])` for `i >= 1`.

An empty prompt string contributes `0` instead of dividing by zero.

### `VOLATILITY`

`{"static": 0, "shared": 1, "session": 2, "turn": 3}`, exported as a plain dict so forkers can add their own tiers or change the ranks.

## How it works

`fit()` is a stable sort by volatility rank plus a reinsertion pass for pinned blocks; `hit_rate()` is a character-by-character common-prefix scan. That is the whole library. It does not know how any provider actually tokenizes or chunks its cache, so `stable_prefix_chars` and `hit_rate` are character-level proxies, not a guarantee of a provider-side cache hit: real caches key on token boundaries and have their own minimum prefix length and TTL. This package also does not inject provider-specific cache markers (Anthropic's `cache_control`, OpenAI's automatic prefix caching, etc.) into the output; ordering the blocks correctly is a precondition for those markers to help, but adding the markers themselves is left to the caller, since the marker format is provider-specific and out of scope here.

The JavaScript version of this package lives at the repository root: https://github.com/pjdurden/prompt-cache-fit

## License

MIT
