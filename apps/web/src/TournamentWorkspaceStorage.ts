export type TournamentWorkspaceDraft<TDetail, TCompetition, TOperation> = {
  schemaVersion: 1;
  tournamentId: string;
  baseRevision: number;
  snapshot: {
    detail: TDetail;
    competitions: TCompetition[];
  };
  operations: TOperation[];
  savedAt: number;
};

const DB_NAME = "huau-tournament-workspaces";
const DB_VERSION = 1;
const STORE = "drafts";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "tournamentId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
  });
}

export async function loadTournamentWorkspaceDraft<TDetail, TCompetition, TOperation>(
  tournamentId: string,
): Promise<TournamentWorkspaceDraft<TDetail, TCompetition, TOperation> | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(tournamentId);
      request.onsuccess = () =>
        resolve((request.result as TournamentWorkspaceDraft<TDetail, TCompetition, TOperation> | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_READ_FAILED"));
    });
  } finally {
    db.close();
  }
}

export async function saveTournamentWorkspaceDraft<TDetail, TCompetition, TOperation>(
  draft: TournamentWorkspaceDraft<TDetail, TCompetition, TOperation>,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(draft);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("INDEXED_DB_WRITE_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("INDEXED_DB_WRITE_ABORTED"));
    });
  } finally {
    db.close();
  }
}

export async function clearTournamentWorkspaceDraft(tournamentId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(tournamentId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("INDEXED_DB_DELETE_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("INDEXED_DB_DELETE_ABORTED"));
    });
  } finally {
    db.close();
  }
}
