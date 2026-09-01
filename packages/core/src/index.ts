export const HUAU_FOUNDATION_VERSION = "0.5.2-phase4.1-parity";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
