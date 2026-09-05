export type TournamentDaySession<TSnapshot = unknown> = {
  schemaVersion: 1;
  storageKey: string;
  tournamentId: string;
  source: "admin" | "operator";
  dirty: boolean;
  updatedAt: number;
  publishedRevision: number;
  finalizedAt: number | null;
  syncStatus: "idle" | "syncing" | "synced" | "failed";
  syncError: string | null;
  snapshot: TSnapshot;
};

const DB_NAME = "huau-tournament-day";
const DB_VERSION = 1;
const STORE = "sessions";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "storageKey" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_OPEN_FAILED"));
  });
}

export async function loadTournamentDaySession<TSnapshot = unknown>(
  storageKey: string,
): Promise<TournamentDaySession<TSnapshot> | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(storageKey);
      request.onsuccess = () =>
        resolve((request.result as TournamentDaySession<TSnapshot> | undefined) ?? null);
      request.onerror = () =>
        reject(request.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_READ_FAILED"));
    });
  } finally {
    db.close();
  }
}

export async function saveTournamentDaySession<TSnapshot = unknown>(
  session: TournamentDaySession<TSnapshot>,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(session);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_WRITE_FAILED"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_WRITE_ABORTED"));
    });
  } finally {
    db.close();
  }
}

export async function clearTournamentDaySession(storageKey: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(storageKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_DELETE_FAILED"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("TOURNAMENT_DAY_INDEXED_DB_DELETE_ABORTED"));
    });
  } finally {
    db.close();
  }
}

export async function tournamentDaySessionExists(storageKey: string): Promise<boolean> {
  return Boolean(await loadTournamentDaySession(storageKey));
}

export function tournamentDayChannelName(tournamentId: string) {
  return `huau-tournament-day:${tournamentId}`;
}
