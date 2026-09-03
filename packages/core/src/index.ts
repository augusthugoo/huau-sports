export const HUAU_FOUNDATION_VERSION = "0.7.0-phase6-online-registration";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
export * from "./team";
