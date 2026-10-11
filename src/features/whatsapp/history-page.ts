import { z } from "zod";
import { listPageSize } from "@/lib/list-page";
import type { WhatsAppConversation } from "./conversations";

export const historyConversationsInput = z
  .object({
    q: z.string().trim().max(200).default(""),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict()
  .default({});
export const historyMessagesInput = z
  .object({
    contactId: z.string().uuid(),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict();
export type HistoryThread = Omit<WhatsAppConversation, "lastMessageAt" | "lastMessageDirection"> & {
  lastMessageAt: string | null;
  lastMessageDirection: WhatsAppConversation["lastMessageDirection"] | null;
  messageCount: number;
};
