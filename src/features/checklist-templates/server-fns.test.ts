import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { ChecklistTemplate } from "./types";
import {
  assertAdminAccess,
  createChecklistTemplateForActor,
  deleteChecklistTemplateForActor,
  duplicateChecklistTemplateForActor,
  listActiveAnnualReturnTemplatesForActor,
  listChecklistTemplatesForActor,
  updateChecklistTemplateForActor,
} from "./server-fns";

const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

const sampleTemplate: ChecklistTemplate = {
  id: "tpl-1",
  name: "Sample",
  serviceType: "Annual Return — Private Ltd",
  description: "",
  active: true,
  documents: [],
  reminders: [],
  riskRules: [],
  updatedAt: "2026-08-18T00:00:00.000Z",
};

function repositoryFor(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const repository = {
    listTemplates: vi.fn(async () => [sampleTemplate]),
    createTemplate: vi.fn(async () => sampleTemplate),
    updateTemplate: vi.fn(async () => sampleTemplate),
    duplicateTemplate: vi.fn(async () => sampleTemplate),
    deleteTemplate: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
  return { repository };
}

describe("assertAdminAccess", () => {
  it("rejects a non-admin actor", () => {
    expect(() => assertAdminAccess(staffActor)).toThrow("Forbidden: Admin access is required.");
  });

  it("rejects an inactive admin actor", () => {
    expect(() => assertAdminAccess({ ...adminActor, active: false })).toThrow(
      "Forbidden: Admin access is required.",
    );
  });

  it("allows an active admin actor", () => {
    expect(() => assertAdminAccess(adminActor)).not.toThrow();
  });
});

describe("listChecklistTemplatesForActor", () => {
  it("rejects a non-admin actor without calling the repository", async () => {
    const { repository } = repositoryFor();

    await expect(listChecklistTemplatesForActor(staffActor, {}, { repository })).rejects.toThrow(
      "Forbidden: Admin access is required.",
    );
    expect(repository.listTemplates).not.toHaveBeenCalled();
  });

  it("returns the repository's list for an admin actor", async () => {
    const { repository } = repositoryFor();

    const result = await listChecklistTemplatesForActor(adminActor, {}, { repository });

    expect(result).toEqual([sampleTemplate]);
  });
});

describe("createChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      createChecklistTemplateForActor(
        staffActor,
        { serviceType: "Annual Return — Private Ltd" },
        { repository },
      ),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.createTemplate).not.toHaveBeenCalled();
  });

  it("creates via the repository for an admin actor", async () => {
    const { repository } = repositoryFor();

    await createChecklistTemplateForActor(
      adminActor,
      { serviceType: "Annual Return — Private Ltd" },
      { repository },
    );

    expect(repository.createTemplate).toHaveBeenCalledWith("Annual Return — Private Ltd");
  });
});

describe("updateChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      updateChecklistTemplateForActor(
        staffActor,
        { id: "tpl-1", patch: { active: false } },
        { repository },
      ),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.updateTemplate).not.toHaveBeenCalled();
  });

  it("passes the patch straight through for an admin actor", async () => {
    const { repository } = repositoryFor();

    await updateChecklistTemplateForActor(
      adminActor,
      { id: "tpl-1", patch: { active: false } },
      { repository },
    );

    expect(repository.updateTemplate).toHaveBeenCalledWith("tpl-1", { active: false });
  });

  it("throws when the template does not exist", async () => {
    const { repository } = repositoryFor({ updateTemplate: vi.fn(async () => null) });

    await expect(
      updateChecklistTemplateForActor(
        adminActor,
        { id: "missing", patch: { active: false } },
        { repository },
      ),
    ).rejects.toThrow("Checklist template not found.");
  });
});

describe("duplicateChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      duplicateChecklistTemplateForActor(staffActor, { id: "tpl-1" }, { repository }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.duplicateTemplate).not.toHaveBeenCalled();
  });

  it("duplicates via the repository for an admin actor", async () => {
    const { repository } = repositoryFor();

    const result = await duplicateChecklistTemplateForActor(
      adminActor,
      { id: "tpl-1" },
      { repository },
    );

    expect(repository.duplicateTemplate).toHaveBeenCalledWith("tpl-1");
    expect(result).toEqual(sampleTemplate);
  });

  it("throws when the template does not exist", async () => {
    const { repository } = repositoryFor({ duplicateTemplate: vi.fn(async () => null) });

    await expect(
      duplicateChecklistTemplateForActor(adminActor, { id: "missing" }, { repository }),
    ).rejects.toThrow("Checklist template not found.");
  });
});

describe("deleteChecklistTemplateForActor", () => {
  it("rejects a non-admin actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      deleteChecklistTemplateForActor(staffActor, { id: "tpl-1" }, { repository }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(repository.deleteTemplate).not.toHaveBeenCalled();
  });

  it("deletes via the repository for an admin actor", async () => {
    const { repository } = repositoryFor();

    await deleteChecklistTemplateForActor(adminActor, { id: "tpl-1" }, { repository });

    expect(repository.deleteTemplate).toHaveBeenCalledWith("tpl-1");
  });
});

describe("listActiveAnnualReturnTemplatesForActor", () => {
  const incorporationTemplate: ChecklistTemplate = {
    ...sampleTemplate,
    id: "tpl-incorporation",
    serviceType: "Incorporation — HK Ltd",
  };
  const inactiveTemplate: ChecklistTemplate = {
    ...sampleTemplate,
    id: "tpl-inactive",
    active: false,
  };

  it("allows a non-Admin staff actor", async () => {
    const { repository } = repositoryFor();

    await expect(
      listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository }),
    ).resolves.toEqual([
      { id: sampleTemplate.id, name: sampleTemplate.name, serviceType: sampleTemplate.serviceType },
    ]);
  });

  it("rejects a Client actor", async () => {
    const { repository } = repositoryFor();
    const clientActor: AuthenticatedActor = { ...staffActor, role: "Client" };

    await expect(
      listActiveAnnualReturnTemplatesForActor(clientActor, {}, { repository }),
    ).rejects.toThrow(/staff access is required/i);
  });

  it("excludes inactive templates and non-Annual-Return service types", async () => {
    const { repository } = repositoryFor({
      listTemplates: vi.fn(async () => [sampleTemplate, incorporationTemplate, inactiveTemplate]),
    });

    const result = await listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository });

    expect(result).toEqual([
      { id: sampleTemplate.id, name: sampleTemplate.name, serviceType: sampleTemplate.serviceType },
    ]);
  });

  it("projects to id/name/serviceType only", async () => {
    const { repository } = repositoryFor();

    const [result] = await listActiveAnnualReturnTemplatesForActor(staffActor, {}, { repository });

    expect(Object.keys(result!)).toEqual(["id", "name", "serviceType"]);
  });
});
