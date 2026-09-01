export const HUAU_FOUNDATION_VERSION = "0.4.0-phase3";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
