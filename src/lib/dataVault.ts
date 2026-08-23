/**
 * DataVault — IKCOUS Offline-First IndexedDB Engine
 *
 * Replaces all localStorage-based caching with IndexedDB for:
 * - No 5MB limit (hundreds of thousands of records)
 * - Non-blocking async reads (no JSON.parse on main thread)
 * - Versioned migrations with atomic transactions
 * - Per-store sync timestamps for stale-while-revalidate
 *
 * @module dataVault
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const DB_NAME = "ikcous-datavault";
const DATA_VAULT_VERSION = 2;

/** All valid store names in the DataVault */
export type StoreName =
  | "products"
  | "categories"
  | "banners"
  | "store_config"
  | "coupons"
  | "product_variants"
  | "_meta";

// ─── Migration System ────────────────────────────────────────────────────────

type MigrationFn = (db: IDBDatabase, tx: IDBTransaction) => void;

/**
 * Sequential migrations keyed by version number.
 * Each migration runs inside `onupgradeneeded` — an atomic IDB transaction.
 * If any migration fails, the entire upgrade rolls back automatically.
 */
const MIGRATIONS: Record<number, MigrationFn> = {
  1: (db) => {
    // ── Products ──
    const products = db.createObjectStore("products", { keyPath: "id" });
    products.createIndex("by_category", "category");
    products.createIndex("by_active", "isActive");

    // ── Categories ──
    const categories = db.createObjectStore("categories", { keyPath: "id" });
    categories.createIndex("by_name", "name");

    // ── Banners ──
    const banners = db.createObjectStore("banners", { keyPath: "id" });
    banners.createIndex("by_position", "position");
    banners.createIndex("by_active", "active");

    // ── Store Config (single-row pattern) ──
    db.createObjectStore("store_config", { keyPath: "id" });

    // ── Coupons ──
    const coupons = db.createObjectStore("coupons", { keyPath: "id" });
    coupons.createIndex("by_code", "code", { unique: true });
    coupons.createIndex("by_active", "active");

    // ── Product Variants ──
    const variants = db.createObjectStore("product_variants", {
      keyPath: "id",
    });
    variants.createIndex("by_product_id", "productId");

    // ── Meta (sync timestamps per store) ──
    db.createObjectStore("_meta", { keyPath: "store" });
  },
  2: (_db, tx) => {
    const store = tx.objectStore("coupons");
    store.deleteIndex("by_code");
    store.createIndex("by_code", "code", { unique: false });
  },
};

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: DataVault | null = null;
let _initPromise: Promise<DataVault> | null = null;

// ─── DataVault Class ─────────────────────────────────────────────────────────

export class DataVault {
  private db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialize the DataVault singleton.
   * Opens the IndexedDB database and runs any pending migrations.
   * Safe to call multiple times — returns the same instance.
   */
  static async init(retries = 3, delay = 250): Promise<DataVault> {
    if (_instance) return _instance;
    if (_initPromise) return _initPromise;

    const attemptOpen = (attempt: number): Promise<DataVault> => {
      return new Promise<DataVault>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DATA_VAULT_VERSION);

        request.onupgradeneeded = (event) => {
          const db = request.result;
          const tx = request.transaction!;
          const oldVersion = event.oldVersion;

          console.log(
            `[DataVault] Upgrading from v${oldVersion} to v${DATA_VAULT_VERSION}`,
          );

          // Run sequential migrations
          for (let v = oldVersion + 1; v <= DATA_VAULT_VERSION; v++) {
            const migration = MIGRATIONS[v];
            if (migration) {
              console.log(`[DataVault] Running migration v${v}...`);
              migration(db, tx);
            }
          }
        };

        request.onsuccess = () => {
          const db = request.result;

          // Handle version change from another tab
          db.onversionchange = () => {
            db.close();
            _instance = null;
            _initPromise = null;
            console.warn(
              "[DataVault] Database version changed in another tab. Closing connection.",
            );
          };

          // Register cleanup on tab close to avoid blocking other connections/reloads
          if (typeof window !== "undefined") {
            const cleanClose = () => {
              try {
                db.close();
                console.log("[DataVault] Connection closed cleanly on unload.");
              } catch {
                // ignore
              }
            };
            window.addEventListener("beforeunload", cleanClose);
          }

          _instance = new DataVault(db);
          console.log(
            "[DataVault] Ready (v%s, stores: %s)",
            DATA_VAULT_VERSION,
            Array.from(db.objectStoreNames).join(", "),
          );
          resolve(_instance);
        };

        request.onerror = async () => {
          console.warn(
            "[DataVault] Failed to open database (attempt %d/%d):",
            attempt,
            retries + 1,
            request.error,
          );
          if (attempt <= retries) {
            _initPromise = null;
            await new Promise((r) => setTimeout(r, delay * 2 ** (attempt - 1)));
            resolve(attemptOpen(attempt + 1));
          } else {
            _initPromise = null;
            reject(
              request.error ?? new Error("IndexedDB database open failed"),
            );
          }
        };

        request.onblocked = async () => {
          console.warn(
            "[DataVault] Database open blocked (attempt %d/%d) — close other tabs or retry",
            attempt,
            retries + 1,
          );
          if (attempt <= retries) {
            _initPromise = null;
            await new Promise((r) => setTimeout(r, delay * 2 ** (attempt - 1)));
            resolve(attemptOpen(attempt + 1));
          } else {
            _initPromise = null;
            reject(new Error("DataVault database open blocked"));
          }
        };
      });
    };

    _initPromise = attemptOpen(1).catch((err) => {
      _initPromise = null;
      throw err;
    });

    return _initPromise;
  }

  /**
   * Destroy the singleton (for testing or forced re-init).
   */
  static destroy(): void {
    if (_instance) {
      _instance.db.close();
      _instance = null;
      _initPromise = null;
    }
  }

  // ── Generic CRUD ───────────────────────────────────────────────────────────

  /**
   * Get all records from a store.
   */
  async getAll<T>(store: StoreName): Promise<T[]> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        const request = objectStore.getAll();

        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(request.error ?? new Error(`getAll('${store}') failed`));
      } catch (err) {
        // Store may not exist if migration failed
        console.error("[DataVault] getAll('%s') failed:", store, err);
        resolve([]);
      }
    });
  }

  /**
   * Get all records from a store, but REJECT on failure instead of
   * resolving to `[]`.
   *
   * `getAll` swallows a broken read (transaction throw, store missing,
   * connection closed by another tab's `onversionchange`) and resolves an
   * empty array — indistinguishable from "the store really is empty". A
   * caller that needs to tell those two cases apart (e.g. a realtime
   * listener deciding whether to blank out the UI) must use this method
   * instead.
   */
  async getAllOrThrow<T>(store: StoreName): Promise<T[]> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        const request = objectStore.getAll();

        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(
            request.error ?? new Error(`getAllOrThrow('${store}') failed`),
          );
      } catch (err) {
        console.error("[DataVault] getAllOrThrow('%s') failed:", store, err);
        reject(err);
      }
    });
  }

  /**
   * Get a single record by its primary key.
   */
  async getById<T>(store: StoreName, id: string): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        const request = objectStore.get(id);

        request.onsuccess = () => resolve(request.result as T | undefined);
        request.onerror = () =>
          reject(
            request.error ?? new Error(`getById('${store}', '${id}') failed`),
          );
      } catch (err) {
        console.error(
          "[DataVault] getById('%s', '%s') failed:",
          store,
          id,
          err,
        );
        resolve(undefined);
      }
    });
  }

  /**
   * Get records by index value.
   */
  async getByIndex<T>(
    store: StoreName,
    indexName: string,
    value: IDBValidKey,
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        const index = objectStore.index(indexName);
        const request = index.getAll(value);

        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () =>
          reject(
            request.error ??
              new Error(`getByIndex('${store}', '${indexName}') failed`),
          );
      } catch (err) {
        console.error(
          "[DataVault] getByIndex('%s', '%s') failed:",
          store,
          indexName,
          err,
        );
        resolve([]);
      }
    });
  }

  /**
   * Bulk upsert (put) records into a store.
   * Uses a single read-write transaction for atomicity.
   */
  async putMany<T>(store: StoreName, items: T[]): Promise<void> {
    if (!items.length) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);

        for (const item of items) {
          objectStore.put(item);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error(`putMany('${store}') failed`));
        tx.onabort = () =>
          reject(
            tx.error ??
              new Error(`Transaction aborted for putMany('${store}')`),
          );
      } catch (err) {
        console.error("[DataVault] putMany('%s') failed:", store, err);
        reject(err);
      }
    });
  }

  /**
   * Put a single record.
   */
  async put<T>(store: StoreName, item: T): Promise<void> {
    return this.putMany(store, [item]);
  }

  /**
   * Delete a record by its primary key.
   */
  async deleteById(store: StoreName, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);
        const request = objectStore.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(
            request.error ??
              new Error(`deleteById('${store}', '${id}') failed`),
          );
      } catch (err) {
        console.error(
          "[DataVault] deleteById('%s', '%s') failed:",
          store,
          id,
          err,
        );
        reject(err);
      }
    });
  }

  /**
   * Clear all records from a store.
   */
  async clear(store: StoreName): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);
        const request = objectStore.clear();

        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error(`clear('${store}') failed`));
      } catch (err) {
        console.error("[DataVault] clear('%s') failed:", store, err);
        reject(err);
      }
    });
  }

  /**
   * Replace all records in a store atomically.
   * Clears the store and inserts all new items in one transaction.
   */
  async replaceAll<T>(store: StoreName, items: T[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readwrite");
        const objectStore = tx.objectStore(store);

        // Clear first
        objectStore.clear();

        // Then insert all
        for (const item of items) {
          objectStore.put(item);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(tx.error ?? new Error(`replaceAll('${store}') failed`));
        tx.onabort = () =>
          reject(
            tx.error ??
              new Error(`Transaction aborted for replaceAll('${store}')`),
          );
      } catch (err) {
        console.error("[DataVault] replaceAll('%s') failed:", store, err);
        reject(err);
      }
    });
  }

  /**
   * Count records in a store.
   */
  async count(store: StoreName): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction(store, "readonly");
        const objectStore = tx.objectStore(store);
        const request = objectStore.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(request.error ?? new Error(`count('${store}') failed`));
      } catch (err) {
        console.error("[DataVault] count('%s') failed:", store, err);
        resolve(0);
      }
    });
  }

  // ── Meta (Sync Timestamps) ─────────────────────────────────────────────────

  /**
   * Get the last sync timestamp for a store (Unix ms).
   * Returns 0 if never synced.
   */
  async getLastSync(store: StoreName): Promise<number> {
    const meta = await this.getById<{ store: string; lastSyncedAt: number }>(
      "_meta",
      store,
    );
    return meta?.lastSyncedAt ?? 0;
  }

  /**
   * Set the last sync timestamp for a store.
   */
  async setLastSync(store: StoreName, ts: number = Date.now()): Promise<void> {
    await this.put("_meta", { store, lastSyncedAt: ts });
  }

  // ── localStorage Migration ─────────────────────────────────────────────────

  /**
   * One-time migration from localStorage to IndexedDB.
   * Runs only on first DataVault boot when IDB is empty but localStorage has data.
   * After migration, cleans up the localStorage keys.
   */
  async migrateFromLocalStorage(): Promise<boolean> {
    const MIGRATION_KEYS: Record<string, StoreName> = {
      ikcous_store_config_cache: "store_config",
      ikcous_products_cache: "products",
      ikcous_admin_products_cache: "products",
      ikcous_categories_cache: "categories",
      ikcous_banners_cache: "banners",
    };

    let migrated = false;

    for (const [lsKey, storeName] of Object.entries(MIGRATION_KEYS)) {
      try {
        const raw = localStorage.getItem(lsKey);
        if (!raw) continue;

        const parsed = JSON.parse(raw);
        if (!parsed) continue;

        // store_config is a single object, wrap in array
        const items =
          storeName === "store_config"
            ? [{ id: "singleton", ...parsed }]
            : Array.isArray(parsed)
              ? parsed
              : [parsed];

        if (items.length > 0) {
          await this.putMany(storeName, items);
          await this.setLastSync(storeName);
          console.log(
            "[DataVault] Migrated %d items from localStorage key '%s' → IDB store '%s'",
            items.length,
            lsKey,
            storeName,
          );
          migrated = true;
        }

        // Clean up localStorage after successful migration
        localStorage.removeItem(lsKey);
      } catch (err) {
        console.error("[DataVault] Migration failed for key '%s':", lsKey, err);
        // Don't remove from localStorage on failure — keep as fallback
      }
    }

    if (migrated) {
      console.log("[DataVault] localStorage → IndexedDB migration complete.");
    }

    return migrated;
  }
}
