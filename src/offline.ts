const DATABASE_NAME = "youyang-handout-offline";
const DATABASE_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const CURRENT_SNAPSHOT_KEY = "current";

export type OfflineSnapshotEnvelope<T> = {
  snapshot_version: 1;
  schema_version: string;
  generated_at: string;
  data_checksum: string;
  counts: Record<string, number>;
  data: T;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("INDEXED_DB_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readOfflineSnapshot<T>(): Promise<OfflineSnapshotEnvelope<T> | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
      const request = transaction.objectStore(SNAPSHOT_STORE).get(CURRENT_SNAPSHOT_KEY);
      request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_READ_FAILED"));
      request.onsuccess = () => resolve((request.result as OfflineSnapshotEnvelope<T> | undefined) ?? null);
    });
  } finally {
    database.close();
  }
}

export async function writeOfflineSnapshot<T>(snapshot: OfflineSnapshotEnvelope<T>): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      // One transaction replaces the pointer only after the complete snapshot is ready.
      const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
      transaction.objectStore(SNAPSHOT_STORE).put(snapshot, CURRENT_SNAPSHOT_KEY);
      transaction.onerror = () => reject(transaction.error ?? new Error("INDEXED_DB_WRITE_FAILED"));
      transaction.onabort = () => reject(transaction.error ?? new Error("INDEXED_DB_WRITE_ABORTED"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}

export async function clearOfflineSnapshot(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
      transaction.objectStore(SNAPSHOT_STORE).delete(CURRENT_SNAPSHOT_KEY);
      transaction.onerror = () => reject(transaction.error ?? new Error("INDEXED_DB_DELETE_FAILED"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}
