export const HUAU_FOUNDATION_VERSION = "0.8.0-phase7-payments";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
export * from "./team";
