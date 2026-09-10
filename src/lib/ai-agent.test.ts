import { describe, expect, it } from "vitest";
import { draftReply, retrieveContext, type AiEnquiry } from "./ai-agent";
import type { FaqEntry, ReferenceDoc } from "./knowledge-base";

/**
 * `ai-agent.ts` had no tests, which is how both of the behaviours pinned here
 * survived: a retrieval layer that discarded every Chinese character, and a
 * confidence percentage computed from how many rows came back.
 */

function faq(overrides: Partial<FaqEntry> = {}): FaqEntry {
  return {
    id: "faq-1",
    question: "What is the annual return fee?",
    answer: "The annual return fee is HKD 105.",
    category: "Annual Return",
    tags: [],
    active: true,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const CHINESE_FAQ = faq({
  id: "faq-zh",
  question: "週年申報表的費用是多少？",
  answer: "週年申報表的政府費用是港幣 105 元。",
  category: "Annual Return",
});

function enquiry(lastMessage: string, intent = "Annual Return"): AiEnquiry {
  return { name: "陳大文", phone: "+85290000000", lastMessage, intent };
}

describe("retrieveContext", () => {
  // The defect. Both tokenizers used an ASCII-only class, so a Chinese message
  // produced an empty query and matched nothing -- every Chinese client got the
  // same intent-template reply.
  it("matches a Chinese FAQ from a Chinese message", () => {
    const context = retrieveContext(enquiry("請問週年申報表的費用是多少？"), [CHINESE_FAQ], []);
    expect(context.faqs.map((match) => match.item.id)).toContain("faq-zh");
  });

  it("prefers the Chinese FAQ over an unrelated one for a Chinese message", () => {
    const unrelated = faq({
      id: "faq-dereg",
      question: "註銷公司需要多久？",
      answer: "一般需要六至九個月。",
      category: "Deregistration",
    });
    const context = retrieveContext(
      enquiry("請問週年申報表的費用是多少？"),
      [CHINESE_FAQ, unrelated],
      [],
    );
    expect(context.faqs[0]?.item.id).toBe("faq-zh");
  });

  it("matches a Chinese reference document", () => {
    const doc: ReferenceDoc = {
      id: "doc-zh",
      title: "週年申報指引",
      filename: "annual-return-guide-zh.pdf",
      category: "Annual Return",
      summary: "週年申報表填寫及收費指引。",
      updatedAt: "2026-09-01T00:00:00.000Z",
      active: true,
      sizeKb: 120,
    };
    const context = retrieveContext(enquiry("週年申報收費"), [], [doc]);
    expect(context.documents.map((match) => match.item.id)).toContain("doc-zh");
  });

  it("still matches an English FAQ from an English message", () => {
    const context = retrieveContext(enquiry("what is the annual return fee?"), [faq()], []);
    expect(context.faqs.map((match) => match.item.id)).toContain("faq-1");
  });

  it("does not match an inactive FAQ", () => {
    const context = retrieveContext(
      enquiry("請問週年申報表的費用是多少？"),
      [{ ...CHINESE_FAQ, active: false }],
      [],
    );
    expect(context.faqs).toHaveLength(0);
  });
});

describe("draftReply grounding", () => {
  // Replaced `confidence`, which was min(96, 70 + faqs*4 + docs*3 + 8): a pure
  // arity function that read "Confidence 70%" over nothing at all.
  it("marks a draft ungrounded when nothing in the knowledge base matched", () => {
    const context = retrieveContext(enquiry("hello"), [], []);
    const draft = draftReply(enquiry("hello"), context);

    expect(draft.grounding.ungrounded).toBe(true);
    expect(draft.grounding.matchedFaqs).toBe(0);
    expect(draft.grounding.matchedDocuments).toBe(0);
    expect(draft.markdown).not.toBe("");
  });

  it("reports what actually matched rather than a score", () => {
    const message = "請問週年申報表的費用是多少？";
    const context = retrieveContext(enquiry(message), [CHINESE_FAQ], []);
    const draft = draftReply(enquiry(message), context);

    expect(draft.grounding.ungrounded).toBe(false);
    expect(draft.grounding.matchedFaqs).toBe(1);
    expect(draft.grounding.caseLinked).toBe(false);
  });

  it("exposes no certainty percentage at all", () => {
    const draft = draftReply(enquiry("hello"), retrieveContext(enquiry("hello"), [], []));
    expect(draft).not.toHaveProperty("confidence");
  });
});
