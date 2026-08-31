export const HUAU_APP_NAME = "HUAU Sports" as const;
export const HUAU_FOUNDATION_VERSION = "0.1.0-phase0" as const;

export function foundationIdentity() {
  return {
    app: HUAU_APP_NAME,
    version: HUAU_FOUNDATION_VERSION,
  } as const;
}
