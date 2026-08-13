// Lightweight token estimation for client-side budget warnings.
// Uses the conservative `chars / 4` heuristic which is accurate within ~15%
// for English/Spanish text and well within the precision needed for a UX
// warning. If we ever need true tokenization we can swap in `tiktoken`, but
// the bundle cost isn't justified for a meter.

export const COMBINE_SOFT_LIMIT_TOKENS = 9000;
export const COMBINE_HARD_LIMIT_TOKENS = 12000;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTokensForBlocks(blocks: { text: string; included?: boolean }[]): number {
  let total = 0;
  for (const block of blocks) {
    if (block.included === false) continue;
    total += estimateTokens(block.text);
  }
  return total;
}
