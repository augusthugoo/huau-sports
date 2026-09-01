export const HUAU_FOUNDATION_VERSION = "0.5.1-phase4.1a";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
