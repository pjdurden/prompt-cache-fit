import unittest

from prompt_cache_fit import VOLATILITY, FitResult, HitRateReport, fit, hit_rate, shared_prefix


class TestVolatility(unittest.TestCase):
    def test_volatility_exposes_the_exact_rank_table(self):
        self.assertEqual(VOLATILITY, {"static": 0, "shared": 1, "session": 2, "turn": 3})


class TestFit(unittest.TestCase):
    def test_fit_on_an_empty_list_returns_the_exact_empty_result(self):
        self.assertEqual(fit([]), FitResult(blocks=[], text="", moved=0, stable_prefix_chars=0))

    def test_fit_leaves_order_unchanged_when_every_block_shares_a_volatility(self):
        blocks = [
            {"text": "p", "volatility": "session"},
            {"text": "q", "volatility": "session"},
            {"text": "r", "volatility": "session"},
        ]
        result = fit(blocks)
        self.assertEqual(result.moved, 0)
        self.assertEqual(result.text, "p\n\nq\n\nr")
        self.assertEqual(result.blocks, blocks)

    def test_fit_sorts_by_volatility_rank_static_first(self):
        a = {"text": "A", "volatility": "turn"}
        b = {"text": "B", "volatility": "static"}
        c = {"text": "C", "volatility": "shared"}
        result = fit([a, b, c])
        self.assertEqual(result.blocks, [b, c, a])
        self.assertEqual(result.text, "B\n\nC\n\nA")

    def test_fit_keeps_original_relative_order_for_blocks_tied_on_rank_stable_sort(self):
        t1 = {"text": "x", "volatility": "turn", "id": "t1"}
        s1 = {"text": "y", "volatility": "static", "id": "s1"}
        t2 = {"text": "z", "volatility": "turn", "id": "t2"}
        result = fit([t1, s1, t2])
        self.assertEqual([block["id"] for block in result.blocks], ["s1", "t1", "t2"])

    def test_fit_treats_a_missing_volatility_as_turn_default(self):
        m = {"text": "M"}
        n = {"text": "N", "volatility": "static"}
        result = fit([m, n])
        self.assertEqual(result.blocks, [n, m])

    def test_fit_treats_an_unknown_volatility_string_as_turn_instead_of_raising(self):
        x = {"text": "X", "volatility": "made-up-tier"}
        y = {"text": "Y", "volatility": "static"}
        try:
            fit([x, y])
        except Exception as exc:  # pragma: no cover - fails the test if raised
            self.fail(f"fit() raised unexpectedly for an unknown volatility: {exc!r}")
        result = fit([x, y])
        self.assertEqual(result.blocks, [y, x])

    def test_fit_keeps_a_pinned_block_at_its_original_index_and_counts_moved_correctly(self):
        a = {"text": "A", "volatility": "turn"}
        b = {"text": "B", "volatility": "static", "pin": True}
        c = {"text": "C", "volatility": "static"}
        d = {"text": "D", "volatility": "turn"}
        result = fit([a, b, c, d])
        # B is static and would otherwise jump to index 0, but pin holds it at index 1.
        self.assertEqual(result.blocks[1], b)
        self.assertEqual(result.blocks, [c, b, a, d])
        # A and C changed index; B (pinned) and D did not.
        self.assertEqual(result.moved, 2)

    def test_fit_supports_a_custom_separator(self):
        result = fit([{"text": "a"}, {"text": "b"}], separator="|")
        self.assertEqual(result.text, "a|b")

    def test_fit_uses_double_newline_as_the_default_separator(self):
        result = fit([{"text": "a"}, {"text": "b"}])
        self.assertEqual(result.text, "a\n\nb")

    def test_fit_omitted_separator_keyword_matches_explicit_default(self):
        # The JS suite has a test asserting that an explicit null options
        # object behaves identically to omitted options. There is no
        # equivalent to port literally in Python: options are keyword
        # arguments with defaults, so there is no separate "null options"
        # state to test. This instead confirms that omitting the separator
        # keyword produces the same result as passing the documented default
        # explicitly.
        omitted = fit([{"text": "a"}])
        explicit_default = fit([{"text": "a"}], separator="\n\n")
        self.assertEqual(omitted, explicit_default)
        self.assertEqual(
            omitted,
            FitResult(blocks=[{"text": "a"}], text="a", moved=0, stable_prefix_chars=0),
        )

    def test_fit_computes_stable_prefix_chars_through_the_last_non_turn_block(self):
        static_block = {"text": "sys", "volatility": "static"}
        shared_block = {"text": "tools", "volatility": "shared"}
        turn_block = {"text": "question", "volatility": "turn"}
        result = fit([static_block, turn_block, shared_block])
        self.assertEqual(result.blocks, [static_block, shared_block, turn_block])
        # 'sys' (3) + sep (2) + 'tools' (5) + sep (2) = 12, up through and including
        # the separator that follows the last non-turn block.
        self.assertEqual(result.stable_prefix_chars, 12)

    def test_fit_stable_prefix_chars_is_0_when_every_block_is_turn(self):
        result = fit([{"text": "a"}, {"text": "b"}])
        self.assertEqual(result.stable_prefix_chars, 0)


class TestSharedPrefix(unittest.TestCase):
    def test_shared_prefix_counts_matching_leading_characters(self):
        self.assertEqual(shared_prefix("abc", "abd"), 2)
        self.assertEqual(shared_prefix("abc", "abc"), 3)
        self.assertEqual(shared_prefix("ab", "abc"), 2)

    def test_shared_prefix_handles_empty_strings(self):
        self.assertEqual(shared_prefix("", ""), 0)
        self.assertEqual(shared_prefix("abc", ""), 0)


class TestHitRate(unittest.TestCase):
    def test_hit_rate_empty_reports_all_zeros_with_no_per_request_entries(self):
        report = hit_rate([])
        self.assertEqual(report.per_request, [])
        self.assertEqual(report.mean, 0)
        self.assertEqual(report.cached_chars, 0)
        self.assertEqual(report.total_chars, 0)

    def test_hit_rate_with_a_single_prompt_reports_all_zeros_with_no_per_request_entries(self):
        report = hit_rate(["only one"])
        self.assertEqual(report.per_request, [])
        self.assertEqual(report.mean, 0)
        self.assertEqual(report.cached_chars, 0)
        self.assertEqual(report.total_chars, 0)

    def test_hit_rate_guards_against_division_by_zero_on_an_empty_prompt(self):
        report = hit_rate(["abc", ""])
        self.assertEqual(report.per_request, [0])
        self.assertEqual(report.mean, 0)
        self.assertEqual(report.cached_chars, 0)
        self.assertEqual(report.total_chars, 0)

    def test_hit_rate_computes_per_request_fractions_mean_cached_chars_and_total_chars(self):
        report = hit_rate(["hello world", "hello there", "hello there friend"])
        # 'hello world' vs 'hello there' share 'hello ' -> 6 chars / 11 = 0.5454...
        # 'hello there' vs 'hello there friend' share all 11 chars / 18 = 0.6111...
        self.assertEqual(len(report.per_request), 2)
        self.assertEqual(report.per_request[0], 6 / 11)
        self.assertEqual(report.per_request[1], 11 / 18)
        self.assertEqual(report.cached_chars, 6 + 11)
        self.assertEqual(report.total_chars, 11 + 18)
        self.assertEqual(report.mean, (6 / 11 + 11 / 18) / 2)


class TestReadmeWorkedCase(unittest.TestCase):
    def test_readme_worked_case_moving_the_volatile_block_to_the_end_raises_the_measured_hit_rate(self):
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

        # Hand-rolled order: the volatile timestamp sits in the middle.
        hand_rolled1 = "\n\n".join(
            block["text"] for block in [static_block, timestamp1, tools_block, session_block, question1]
        )
        hand_rolled2 = "\n\n".join(
            block["text"] for block in [static_block, timestamp2, tools_block, session_block, question2]
        )

        # fit(): volatile blocks pushed to the end.
        fitted1 = fit([static_block, timestamp1, tools_block, session_block, question1])
        fitted2 = fit([static_block, timestamp2, tools_block, session_block, question2])

        hand_rolled_report = hit_rate([hand_rolled1, hand_rolled2])
        fitted_report = hit_rate([fitted1.text, fitted2.text])

        self.assertEqual(hand_rolled_report.mean, 63 / 216)
        self.assertEqual(fitted_report.mean, 168 / 216)
        self.assertGreater(fitted_report.mean, hand_rolled_report.mean)

        # These are the exact numbers quoted in the README's worked example.
        self.assertEqual(hand_rolled_report.mean, 0.2916666666666667)
        self.assertEqual(fitted_report.mean, 0.7777777777777778)


if __name__ == "__main__":
    unittest.main()
