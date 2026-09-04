/**
 * A single unit of a prompt, tagged with how often its content changes.
 */
export interface Block {
  /** The literal text of this block. */
  text: string;
  /**
   * One of 'static' | 'shared' | 'session' | 'turn'. Unknown values are
   * treated as 'turn'. Defaults to 'turn' when omitted.
   */
  volatility?: string;
  /** Optional identifier, unused by the library itself. */
  id?: string;
  /**
   * When true, this block keeps its original index; it never moves during
   * sorting, regardless of its volatility.
   */
  pin?: boolean;
}

export interface FitOptions {
  /** String joined between rendered blocks. Defaults to '\n\n'. */
  separator?: string;
}

export interface FitResult {
  /** The input blocks, reordered least-volatile to most-volatile. */
  blocks: Block[];
  /** The reordered blocks joined with the separator. */
  text: string;
  /** Count of blocks whose index changed relative to the input. */
  moved: number;
  /**
   * Characters from the start of `text` through the end of the last block
   * whose volatility rank is less than 'turn' (3), including the trailing
   * separator if another block follows it. 0 if every block is 'turn'.
   */
  stablePrefixChars: number;
}

export interface HitRateReport {
  /** One shared-prefix fraction (0..1) per request after the first. */
  perRequest: number[];
  /** Mean of perRequest. 0 if fewer than 2 prompts were given. */
  mean: number;
  /** Sum of shared prefix lengths across all requests after the first. */
  cachedChars: number;
  /** Sum of prompt lengths for every prompt after the first. */
  totalChars: number;
}

/**
 * Volatility tiers and their sort rank, lowest first. Exported as a plain
 * object so forkers can extend it with their own tiers.
 */
export declare const VOLATILITY: {
  static: 0;
  shared: 1;
  session: 2;
  turn: 3;
};

/**
 * Reorder prompt blocks from least-volatile to most-volatile and render
 * them into a single prompt string, so the shared prefix across requests
 * is as long as possible.
 */
export declare function fit(blocks: Block[], options?: FitOptions): FitResult;

/**
 * Count the shared leading characters between two strings.
 */
export declare function sharedPrefix(a: string, b: string): number;

/**
 * Measure how much of each rendered prompt's prefix was shared with the
 * prompt sent immediately before it.
 */
export declare function hitRate(prompts: string[]): HitRateReport;
