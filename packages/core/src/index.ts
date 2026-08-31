export const HUAU_FOUNDATION_VERSION = "0.2.0-phase1";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
