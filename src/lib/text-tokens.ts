/**
 * Keyword tokenisation that does not delete Chinese.
 *
 * Two copies of this function existed -- one in `ai-agent.ts`, one in
 * `doc-parser.ts` -- and both normalised with an ASCII-only character class
 * (`[^a-z0-9]+`). Between them they were the entire retrieval layer, so on a
 * platform for Hong Kong company secretaries:
 *
 *   tokenize("請問週年申報表的費用是多少？") -> []
 *   tokenize("陳大文董事身分證")             -> []
 *
 * Every CJK codepoint became a space. A client writing in Chinese matched
 * nothing, and the reply was chosen by the intent chip and a constant boost
 * list alone -- the same answer for every Chinese message with that intent.
 *
 * Chinese is written without spaces, so there are no words to split on. This
 * uses character bigrams, the standard approach when no segmenter is available:
 * 身分證明文件 indexes as 身分, 分證, 證明, 明文, 文件, and the query 身分證
 * (身分, 分證) overlaps it by two. No dictionary, no dependency, and symmetric
 * between query and document, which is what the scoring functions assume.
 *
 * Known limit: a one-character CJK query only matches a one-character run,
 * because a bigram index holds no unigrams. Latin words of one or two letters
 * are still dropped, which is the pre-existing behaviour and left alone here so
 * that fixing Chinese does not silently reweight every English query too.
 */

/** Han (base, extension A, compatibility) plus kana. */
const CJK_CLASS = "\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";

/** One pass, alternating: a Latin/digit run, or a CJK run. */
const TOKEN_RUN = new RegExp(`[a-z0-9]+|[${CJK_CLASS}]+`, "g");
const IS_CJK = new RegExp(`^[${CJK_CLASS}]`);

/** Latin tokens must be longer than this. Pre-existing rule, preserved. */
const MIN_LATIN_LENGTH = 2;

function cjkGrams(run: string): string[] {
  // A lone character has no bigram, so it stands for itself rather than
  // vanishing -- dropping it would put us back where we started.
  if (run.length === 1) return [run];

  const grams: string[] = [];
  for (let index = 0; index + 2 <= run.length; index += 1) {
    grams.push(run.slice(index, index + 2));
  }
  return grams;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  for (const match of text.toLowerCase().matchAll(TOKEN_RUN)) {
    const run = match[0];
    if (IS_CJK.test(run)) {
      tokens.push(...cjkGrams(run));
    } else if (run.length > MIN_LATIN_LENGTH) {
      tokens.push(run);
    }
  }

  return tokens;
}
