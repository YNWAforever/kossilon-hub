import { createSerializationAdapter } from "@tanstack/react-router";

import { ChecklistTemplateWriteError } from "@/features/checklist-templates/errors";
import { ClientWriteError } from "@/features/clients/errors";
import { ServiceSubscriptionWriteError } from "@/features/service-subscriptions/errors";

/**
 * Server functions serialise a thrown Error as its message only. These write
 * errors exist to say *which field* a constraint failure belongs to, so without
 * an adapter the `field` never reached the browser: every duplicate CR/BR,
 * missing contact or taken template name fell back to a toast, and the forms'
 * inline, aria-linked field errors could not appear in production at all.
 */
export const clientWriteErrorAdapter = createSerializationAdapter({
  key: "kossilon-client-write-error",
  test: (value): value is ClientWriteError => value instanceof ClientWriteError,
  toSerializable: (error) => ({ field: error.field as string, message: error.message }),
  fromSerializable: ({ field, message }) =>
    new ClientWriteError(field as ClientWriteError["field"], message),
});

export const serviceSubscriptionWriteErrorAdapter = createSerializationAdapter({
  key: "kossilon-service-subscription-write-error",
  test: (value): value is ServiceSubscriptionWriteError =>
    value instanceof ServiceSubscriptionWriteError,
  toSerializable: (error) => ({ field: error.field as string, message: error.message }),
  fromSerializable: ({ field, message }) =>
    new ServiceSubscriptionWriteError(field as ServiceSubscriptionWriteError["field"], message),
});

export const checklistTemplateWriteErrorAdapter = createSerializationAdapter({
  key: "kossilon-checklist-template-write-error",
  test: (value): value is ChecklistTemplateWriteError =>
    value instanceof ChecklistTemplateWriteError,
  toSerializable: (error) => ({ field: error.field as string, message: error.message }),
  fromSerializable: ({ field, message }) =>
    new ChecklistTemplateWriteError(field as ChecklistTemplateWriteError["field"], message),
});

export const serializationAdapters = [
  clientWriteErrorAdapter,
  serviceSubscriptionWriteErrorAdapter,
  checklistTemplateWriteErrorAdapter,
] as const;
