export const HUAU_FOUNDATION_VERSION = "0.9.0-phase8-explanation";

export function foundationIdentity() {
  return { app: "HUAU Sports", version: HUAU_FOUNDATION_VERSION } as const;
}

export * from "./authorization";
export * from "./tournament";
export * from "./team";
