"""
prompt-cache-fit

Providers cache prompt prefixes. The cache breaks at the first byte that
differs between two requests, so volatile content (timestamps, user ids,
the live turn) needs to sit at the end of the prompt, not the top. This
module reorders prompt blocks from least-volatile to most-volatile and
measures how much of the prefix is expected to survive between requests.

This is a Python port of the JavaScript package `prompt-cache-fit`. It
matches the JavaScript version's behavior exactly.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

__all__ = ["VOLATILITY", "fit", "shared_prefix", "hit_rate", "FitResult", "HitRateReport"]

# Volatility tiers and their sort rank. Lower rank sorts first (stays near
# the top of the prompt, closer to the cacheable prefix). Exported as a
# plain dict so forkers can add their own tiers.
VOLATILITY: Dict[str, int] = {"static": 0, "shared": 1, "session": 2, "turn": 3}


def _rank_of(volatility: Optional[str]) -> int:
    """
    Resolve the sort rank for a volatility label. Missing or unrecognized
    labels fall back to 'turn' (the most volatile tier) rather than raising.
    """
    if volatility is not None and volatility in VOLATILITY:
        return VOLATILITY[volatility]
    return VOLATILITY["turn"]


@dataclass(frozen=True)
class FitResult:
    blocks: List[Dict[str, Any]]
    text: str
    moved: int
    stable_prefix_chars: int


@dataclass(frozen=True)
class HitRateReport:
    per_request: List[float]
    mean: float
    cached_chars: int
    total_chars: int


def fit(blocks: List[Dict[str, Any]], *, separator: str = "\n\n") -> FitResult:
    """
    Reorder prompt blocks from least-volatile to most-volatile so that the
    shared, cacheable prefix is as long as possible, and render them into a
    single prompt string.

    blocks: a list of dicts, each with a required "text" key and optional
        "volatility", "id", "pin" keys.
    separator: the string joined between rendered blocks.
    """
    if not isinstance(blocks, (list, tuple)) or len(blocks) == 0:
        return FitResult(blocks=[], text="", moved=0, stable_prefix_chars=0)

    blocks = list(blocks)

    # Split into pinned (keep original index) and non-pinned (sortable) blocks.
    pinned_indices: List[int] = []
    non_pinned: List[Any] = []  # list of (block, index) tuples
    for index, block in enumerate(blocks):
        if block.get("pin") is True:
            pinned_indices.append(index)
        else:
            non_pinned.append((block, index))

    # Python's sorted() is stable, so ties keep original order.
    non_pinned.sort(key=lambda item: _rank_of(item[0].get("volatility")))

    # Reinsert pinned blocks at their original indices; fill the rest in
    # sorted order.
    result: List[Any] = [None] * len(blocks)
    for idx in pinned_indices:
        result[idx] = blocks[idx]
    cursor = 0
    for i in range(len(result)):
        if result[i] is None:
            result[i] = non_pinned[cursor][0]
            cursor += 1

    text = separator.join(block["text"] for block in result)

    moved = 0
    for i in range(len(blocks)):
        if result[i] is not blocks[i]:
            moved += 1

    # Chars from the start through the end of the last block whose rank is
    # less than 'turn' (3), including the separator that follows it if
    # another block comes after it. 0 if every block is 'turn'.
    last_stable_index = -1
    for i in range(len(result)):
        if _rank_of(result[i].get("volatility")) < VOLATILITY["turn"]:
            last_stable_index = i

    stable_prefix_chars = 0
    if last_stable_index >= 0:
        for i in range(last_stable_index + 1):
            stable_prefix_chars += len(result[i]["text"])
            if i < last_stable_index:
                stable_prefix_chars += len(separator)
        if last_stable_index < len(result) - 1:
            stable_prefix_chars += len(separator)

    return FitResult(blocks=result, text=text, moved=moved, stable_prefix_chars=stable_prefix_chars)


def shared_prefix(a: str, b: str) -> int:
    """Count the shared leading characters between two strings."""
    length = min(len(a), len(b))
    i = 0
    while i < length and a[i] == b[i]:
        i += 1
    return i


def hit_rate(prompts: List[str]) -> HitRateReport:
    """
    Measure how much of each rendered prompt's prefix was shared with the
    prompt sent immediately before it, as a proxy for provider prefix-cache
    hit rate.

    prompts: rendered prompt strings, in send order.
    """
    per_request: List[float] = []
    cached_chars = 0
    total_chars = 0

    for i in range(1, len(prompts)):
        previous = prompts[i - 1]
        current = prompts[i]
        shared = shared_prefix(previous, current)
        fraction = 0 if len(current) == 0 else shared / len(current)
        per_request.append(fraction)
        cached_chars += shared
        total_chars += len(current)

    mean = 0 if len(per_request) == 0 else sum(per_request) / len(per_request)

    return HitRateReport(per_request=per_request, mean=mean, cached_chars=cached_chars, total_chars=total_chars)
