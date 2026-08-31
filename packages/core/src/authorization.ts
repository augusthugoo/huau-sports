export type OrganizationCapability =
  | "org_admin"
  | "coach"
  | "tournament_operator"
  | "future_referee";

export type TenantActor = {
  userId: string;
  platformAdmin: boolean;
  supportOrganizationId?: string | null;
  organizationIds: string[];
  capabilities: Record<string, OrganizationCapability[]>;
};

export function canAccessOrganization(actor: TenantActor, organizationId: string): boolean {
  if (actor.organizationIds.includes(organizationId)) return true;
  return actor.platformAdmin && actor.supportOrganizationId === organizationId;
}

export function canAdminOrganization(actor: TenantActor, organizationId: string): boolean {
  if (actor.capabilities[organizationId]?.includes("org_admin")) return true;
  return actor.platformAdmin && actor.supportOrganizationId === organizationId;
}

export function requireOrganizationScope(actor: TenantActor, organizationId: string): void {
  if (!canAccessOrganization(actor, organizationId)) throw new Error("TENANT_ACCESS_DENIED");
}
