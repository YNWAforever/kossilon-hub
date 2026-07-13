import type postgres from "postgres";
import {
  createDocumentRepository,
  type DocumentRepository,
  type PrivateDocument,
} from "@/features/documents/repository";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import { createAnnualReturnRepository, type AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase } from "./types";

type EvidenceSqlClient = SqlClient | postgres.TransactionSql;
type EvidenceTransaction = postgres.TransactionSql;

export type ReviewAnnualReturnEvidenceInput = {
  caseId: string;
  documentId: string;
  checklistItemId?: string;
  decision: "verified" | "rejected";
  reason?: string;
  actorId: string;
};

export type AnnualReturnEvidenceService = {
  reviewEvidence(input: ReviewAnnualReturnEvidenceInput): Promise<{
    document: PrivateDocument;
    caseItem: AnnualReturnCase;
  }>;
  acceptFilingReceipt(input: {
    caseId: string;
    documentId: string;
    filingReference: string;
    actorId: string;
  }): Promise<AnnualReturnCase>;
};

export type AnnualReturnEvidenceServiceDependencies = {
  sql?: EvidenceSqlClient;
  documentRepositoryFactory?: (sql: EvidenceSqlClient) => DocumentRepository;
  annualReturnRepositoryFactory?: (sql: EvidenceSqlClient) => AnnualReturnRepository;
};

const checklistEvidenceCategories = new Set(["identity", "registry", "signature", "other"]);

function withTransaction<T>(
  client: EvidenceSqlClient,
  handler: (transaction: EvidenceTransaction) => Promise<T>,
): Promise<T> {
  return "begin" in client
    ? (client.begin(handler) as Promise<T>)
    : handler(client as EvidenceTransaction);
}

function requireDocumentForCase(
  document: PrivateDocument | null,
  caseItem: AnnualReturnCase | null,
  caseId: string,
): { document: PrivateDocument; caseItem: AnnualReturnCase } {
  if (!document) {
    throw new Error("Document not found.");
  }
  if (!caseItem) {
    throw new Error("Annual return case not found.");
  }
  if (document.caseId !== caseId || document.companyId !== caseItem.companyId) {
    throw new Error("Document does not belong to this annual return case.");
  }
  if (document.uploadStatus !== "available") {
    throw new Error("Only available documents may be reviewed.");
  }

  return { document, caseItem };
}

async function withEvidenceRepositories<T>(
  client: EvidenceSqlClient,
  dependencies: Required<
    Pick<
      AnnualReturnEvidenceServiceDependencies,
      "documentRepositoryFactory" | "annualReturnRepositoryFactory"
    >
  >,
  handler: (documents: DocumentRepository, annualReturns: AnnualReturnRepository) => Promise<T>,
): Promise<T> {
  return withTransaction(client, async (transaction) => {
    const documents = dependencies.documentRepositoryFactory(transaction);
    const annualReturns = dependencies.annualReturnRepositoryFactory(transaction);

    try {
      return await handler(documents, annualReturns);
    } finally {
      await Promise.all([documents.close(), annualReturns.close()]);
    }
  });
}

export function createAnnualReturnEvidenceService(
  dependencies: AnnualReturnEvidenceServiceDependencies = {},
): AnnualReturnEvidenceService {
  const sql = dependencies.sql ?? getSqlClient();
  const repositoryFactories = {
    documentRepositoryFactory:
      dependencies.documentRepositoryFactory ??
      ((client: EvidenceSqlClient) => createDocumentRepository({ sql: client })),
    annualReturnRepositoryFactory:
      dependencies.annualReturnRepositoryFactory ??
      ((client: EvidenceSqlClient) => createAnnualReturnRepository({ sql: client })),
  };

  return {
    reviewEvidence(input) {
      return withEvidenceRepositories(
        sql,
        repositoryFactories,
        async (documents, annualReturns) => {
          const [document, caseItem] = await Promise.all([
            documents.getDocument(input.documentId),
            annualReturns.getCase(input.caseId),
          ]);

          const validated = requireDocumentForCase(document, caseItem, input.caseId);

          if (validated.document.reviewStatus !== "pending") {
            throw new Error("Document has already been reviewed.");
          }

          let updatedCase: AnnualReturnCase;
          if (validated.document.category === "payment") {
            if (input.checklistItemId) {
              throw new Error("Payment evidence cannot target a checklist item.");
            }
            const status = input.decision === "verified" ? "Payment received" : "Payment pending";
            updatedCase = await annualReturns.updatePayment({
              caseId: input.caseId,
              status,
              paymentProofDocumentId: input.decision === "verified" ? input.documentId : null,
              actorId: input.actorId,
            });
          } else if (validated.document.category === "receipt") {
            if (input.checklistItemId) {
              throw new Error("Receipt evidence cannot target a checklist item.");
            }
            updatedCase = validated.caseItem;
          } else {
            if (!checklistEvidenceCategories.has(validated.document.category)) {
              throw new Error("Document category is not reviewable annual return evidence.");
            }
            if (!input.checklistItemId) {
              throw new Error("Checklist evidence requires a checklist item.");
            }
            if (!validated.caseItem.checklist.some((item) => item.id === input.checklistItemId)) {
              throw new Error("Checklist item does not belong to this annual return case.");
            }
            updatedCase = await annualReturns.updateChecklistItem({
              caseId: input.caseId,
              itemId: input.checklistItemId,
              status: input.decision === "verified" ? "Verified" : "Rejected",
              documentId: input.documentId,
              actorId: input.actorId,
            });
          }

          const reviewedDocument = await documents.reviewDocument({
            documentId: input.documentId,
            reviewerId: input.actorId,
            decision: input.decision,
            reason: input.reason,
          });

          return {
            document: reviewedDocument,
            caseItem: updatedCase,
          };
        },
      );
    },

    acceptFilingReceipt(input) {
      return withEvidenceRepositories(
        sql,
        repositoryFactories,
        async (documents, annualReturns) => {
          const [document, caseItem] = await Promise.all([
            documents.getDocument(input.documentId),
            annualReturns.getCase(input.caseId),
          ]);

          const validated = requireDocumentForCase(document, caseItem, input.caseId);

          if (validated.document.category !== "receipt") {
            throw new Error("Filing confirmation must use a receipt document.");
          }
          if (validated.document.reviewStatus !== "verified") {
            throw new Error("Filing receipt must be verified before acceptance.");
          }

          return annualReturns.updateFilingProof({
            caseId: input.caseId,
            filingReference: input.filingReference.trim(),
            confirmationDocumentId: input.documentId,
            actorId: input.actorId,
          });
        },
      );
    },
  };
}
