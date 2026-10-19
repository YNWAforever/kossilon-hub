import { describe, expect, it } from "vitest";

import { ChecklistTemplateWriteError } from "@/features/checklist-templates/errors";
import { ClientWriteError } from "@/features/clients/errors";
import { ServiceSubscriptionWriteError } from "@/features/service-subscriptions/errors";
import { serializationAdapters } from "./serialization-adapters";

type Adapter = {
  test: (value: unknown) => boolean;
  toSerializable: (value: never) => unknown;
  fromSerializable: (value: never) => unknown;
};

function roundTrip(error: Error): unknown {
  const adapter = (serializationAdapters as unknown as Adapter[]).find((a) => a.test(error));
  if (!adapter) throw new Error(`no adapter for ${error.name}`);
  const wire = JSON.parse(JSON.stringify(adapter.toSerializable(error as never)));
  return adapter.fromSerializable(wire as never);
}

describe("write-error serialization adapters", () => {
  it.each([
    new ClientWriteError("crNumber", "已有公司使用此 CR 號碼。"),
    new ServiceSubscriptionWriteError("serviceType", "此服務已有有效訂閱。"),
    new ChecklistTemplateWriteError("name", "已有同名模板。"),
  ])("keeps %s's class, field and message across the wire", (error) => {
    const received = roundTrip(error) as Error & { field: string };

    expect(received).toBeInstanceOf(error.constructor);
    expect(received.field).toBe((error as Error & { field: string }).field);
    expect(received.message).toBe(error.message);
  });

  it("leaves ordinary errors to the default serialiser", () => {
    const plain = new Error("boom");

    expect((serializationAdapters as unknown as Adapter[]).some((a) => a.test(plain))).toBe(false);
  });
});
