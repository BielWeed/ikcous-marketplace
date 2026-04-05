/**
 * useForensicsDB v18.0
 * IndexedDB-backed forensics log — replaces localStorage 20-entry limit.
 * Stores 500 entries with full metadata, supports structured queries.
 * Shared between App and PwaDiagnostics via a singleton connection.
 */

const DB_NAME = 'ikcous-pwa-forensics';
const DB_VERSION = 1;
const STORE_NAME = 'logs';
const MAX_ENTRIES = 500;

export interface ForensicEntry {
    id?: number;
    t: string;        // ISO timestamp
    m: string;        // message
    d?: unknown;      // data payload
    level?: 'info' | 'warn' | 'error';
    source?: string;  // 'sw' | 'update-check' | 'cache' | 'app'
}

// Singleton DB connection
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('by_time', 't', { unique: false });
                store.createIndex('by_source', 'source', { unique: false });
                store.createIndex('by_level', 'level', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
}

export async function logForensic(entry: Omit<ForensicEntry, 'id'>): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Add entry
        store.add({ ...entry, t: entry.t || new Date().toISOString() });

        // Prune if over max: delete oldest by auto-increment id
        const countReq = store.count();
        countReq.onsuccess = () => {
            const count = countReq.result;
            if (count > MAX_ENTRIES) {
                // Open cursor on oldest and delete excess
                const cursorReq = store.openCursor();
                let deleted = 0;
                const toDelete = count - MAX_ENTRIES;
                cursorReq.onsuccess = () => {
                    const cursor = cursorReq.result;
                    if (cursor && deleted < toDelete) {
                        cursor.delete();
                        deleted++;
                        cursor.continue();
                    }
                };
            }
        };
    } catch { /* silent — forensics must never throw */ }
}

export async function getForensicLogs(limit = 50): Promise<ForensicEntry[]> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('by_time');
            const results: ForensicEntry[] = [];
            // Open cursor in descending order (newest first)
            const req = index.openCursor(null, 'prev');
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value as ForensicEntry);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => resolve([]);
        });
    } catch {
        return [];
    }
}

export async function clearForensicLogs(): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
    } catch { /* silent */ }
}

export async function countForensicLogs(): Promise<number> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(0);
        });
    } catch { return 0; }
}
