import { afterEach, describe, expect, it } from "vitest";

import { enquiries } from "./app-data";
import { retrieveContext } from "./ai-agent";
import { parseFaqImport } from "./faq-import";
import { filterFaqEntries, kbStore } from "./knowledge-base";

const createdFaqIds: string[] = [];
const createdDocIds: string[] = [];

afterEach(() => {
  createdFaqIds.splice(0).forEach((id) => kbStore.removeFaq(id));
  createdDocIds.splice(0).forEach((id) => kbStore.removeDoc(id));
});

describe("knowledge base workflows", () => {
  it("imports CSV and JSON FAQs, supports editing, and filters searchable content", () => {
    const csv = parseFaqImport(
      'question,answer,category,tags,active\n"How is the Atlas filing paid?","Use the Atlas FPS reference.",Payments,"atlas;fps",true',
      "faqs.csv",
    );
    const json = parseFaqImport(
      JSON.stringify([
        {
          question: "Which Atlas document is required?",
          answer: "Upload the signed Atlas declaration.",
          category: "Annual Return",
          tags: ["atlas", "declaration"],
        },
      ]),
      "faqs.json",
    );

    expect(csv.errors).toEqual([]);
    expect(json.errors).toEqual([]);
    expect(kbStore.importFaqs([...csv.rows, ...json.rows])).toEqual({ added: 2, updated: 0 });

    const imported = kbStore.get().faqs.filter((faq) => faq.question.includes("Atlas"));
    createdFaqIds.push(...imported.map((faq) => faq.id));
    expect(imported).toHaveLength(2);

    const paymentsFaq = imported.find((faq) => faq.category === "Payments");
    expect(paymentsFaq).toBeDefined();
    kbStore.updateFaq(paymentsFaq!.id, { answer: "Use the amended Atlas FPS instructions." });
    expect(filterFaqEntries(kbStore.get().faqs, "amended atlas", "Payments")).toEqual([
      expect.objectContaining({ id: paymentsFaq!.id }),
    ]);
  });

  it("extracts and chunks local files so AI retrieval can search indexed content", async () => {
    const file = new File(
      ["Quantum registry seal instructions require the cobalt filing reference before payment."],
      "quantum-registry.txt",
      { type: "text/plain" },
    );
    const documentId = await kbStore.uploadDoc(file, { category: "General" });
    createdDocIds.push(documentId);

    const document = kbStore.get().docs.find((candidate) => candidate.id === documentId);
    expect(document).toMatchObject({
      filename: "quantum-registry.txt",
      category: "General",
    });
    expect(document?.extractedText).toContain("Quantum registry seal instructions");
    expect(document?.chunks?.length).toBeGreaterThan(0);

    const enquiry = {
      ...enquiries[0],
      intent: "General" as const,
      lastMessage: "Please check the quantum registry seal and cobalt filing reference",
    };
    const context = retrieveContext(enquiry, kbStore.get().faqs, kbStore.get().docs);
    expect(context.documents[0]?.item.id).toBe(documentId);
  });
});
