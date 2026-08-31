import { describe, expect, it } from "vitest";
import { canAccessOrganization, canAdminOrganization, requireOrganizationScope } from "./authorization";

const actor = {
  userId: "u-a",
  platformAdmin: false,
  supportOrganizationId: null,
  organizationIds: ["org-a"],
  capabilities: { "org-a": ["org_admin" as const] },
};

describe("tenant authorization", () => {
  it("allows a member to access their organization", () => {
    expect(canAccessOrganization(actor, "org-a")).toBe(true);
  });

  it("prevents Org A from reading Org B", () => {
    expect(canAccessOrganization(actor, "org-b")).toBe(false);
    expect(() => requireOrganizationScope(actor, "org-b")).toThrow("TENANT_ACCESS_DENIED");
  });

  it("allows only org admins to administer a normal tenant", () => {
    expect(canAdminOrganization(actor, "org-a")).toBe(true);
    expect(canAdminOrganization(actor, "org-b")).toBe(false);
  });

  it("does not silently grant tenant access to a platform admin", () => {
    const platform = { ...actor, platformAdmin: true, organizationIds: [], capabilities: {} };
    expect(canAccessOrganization(platform, "org-b")).toBe(false);
  });

  it("allows a platform admin only in explicit support mode", () => {
    const platform = {
      ...actor,
      platformAdmin: true,
      supportOrganizationId: "org-b",
      organizationIds: [],
      capabilities: {},
    };
    expect(canAccessOrganization(platform, "org-b")).toBe(true);
    expect(canAdminOrganization(platform, "org-b")).toBe(true);
    expect(canAccessOrganization(platform, "org-c")).toBe(false);
  });
});
