/**
 * RealtimeSyncEngine — Centralized Supabase Realtime → IndexedDB Sync
 *
 * Subscribes to postgres_changes on ALL monitored tables and:
 * 1. Applies changes to the DataVault (IndexedDB)
 * 2. Notifies React via callbacks for instant UI updates
 *
 * Tables monitored:
 * - produtos        → products store
 * - categorias      → categories store
 * - banners         → banners store
 * - store_config    → store_config store
 * - coupons         → coupons store
 * - product_variants → product_variants store
 *
 * @module realtimeSyncEngine
 */

import type { DataVault, StoreName } from "@/lib/dataVault";
import { mapProductFromDB, mapVariantFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface SyncEvent {
  table: string;
  store: StoreName;
  eventType: RealtimeEventType;
  newRecord?: any;
  oldRecord?: any;
}

export type SyncCallback = (event: SyncEvent) => void;

// ─── Table → Store mapping ──────────────────────────────────────────────────

interface TableConfig {
  /** Supabase table name */
  table: string;
  /** DataVault store name */
  store: StoreName;
  /**
   * Transform the raw Supabase payload.new into the app-domain shape
   * that's stored in IndexedDB. If null, store the raw record as-is.
   */
  mapRecord: ((raw: any) => any) | null;
}

// Exportado para teste: `tests/front/realtime-sync-engine-identidade-da-loja.test.ts`
// exercita `mapRecord` diretamente, sem montar toda a cadeia de assinatura
// Realtime/DataVault que os métodos de `RealtimeSyncEngine` dependem.
export const TABLE_CONFIGS: TableConfig[] = [
  {
    table: "produtos",
    store: "products",
    mapRecord: (raw: any) => mapProductFromDB(raw),
  },
  {
    table: "categorias",
    store: "categories",
    mapRecord: (raw: any) => ({
      id: raw.id,
      name: raw.nome,
      slug: raw.slug || "",
      description: raw.descricao || "",
      isActive: raw.ativo ?? true,
      createdAt: raw.created_at,
    }),
  },
  {
    table: "banners",
    store: "banners",
    mapRecord: (raw: any) => ({
      id: raw.id,
      imageUrl: raw.image_url || raw.imagem_url,
      title: raw.title || "",
      link: raw.link || undefined,
      position: raw.position,
      active: raw.active ?? raw.ativo ?? true,
      order: raw.order || 0,
    }),
  },
  {
    table: "store_config",
    store: "store_config",
    mapRecord: (raw: any) => ({
      id: "singleton",
      freeShippingMin:
        raw.free_shipping_min !== null && raw.free_shipping_min !== undefined
          ? Number(raw.free_shipping_min)
          : undefined,
      shippingFee:
        raw.shipping_fee !== null && raw.shipping_fee !== undefined
          ? Number(raw.shipping_fee)
          : undefined,
      whatsappNumber: raw.whatsapp_number,
      shareText: raw.share_text,
      businessHours: raw.business_hours,
      enableReviews: raw.enable_reviews,
      enableCoupons: raw.enable_coupons,
      logoUrl: raw.logo_url,
      primaryColor: raw.primary_color,
      themeMode: raw.theme_mode,
      realTimeSalesAlerts: raw.real_time_sales_alerts,
      pushMarketingEnabled: raw.push_marketing_enabled,
      minAppVersion: raw.min_app_version,
      originCep: raw.origin_cep,
      shippingProvider: raw.shipping_provider,
      enabledShippingMethods: raw.enabled_shipping_methods,
      shippingCoverage: raw.shipping_coverage,
      localDeliveryFee:
        raw.local_delivery_fee !== null && raw.local_delivery_fee !== undefined
          ? Number(raw.local_delivery_fee)
          : undefined,
      localCepRange: raw.local_cep_range,
      homeSections: raw.home_sections,
      // Sem estes três, a identidade da loja (Tarefa 2/3 do bloco "o app
      // para de inventar endereço") some assim que o app carrega
      // `store_config` pelo caminho offline/realtime em vez de vir direto
      // do `StoreContext` -- era uma terceira cópia da mesma lista de
      // colunas, desatualizada em relação à RPC e à view do banco.
      storeName: raw.store_name,
      storeCity: raw.store_city,
      storeState: raw.store_state,
    }),
  },
  {
    table: "coupons",
    store: "coupons",
    mapRecord: (raw: any) => ({
      id: raw.id,
      code: raw.code,
      type: raw.type,
      value: raw.value,
      minPurchase: raw.min_purchase ?? undefined,
      usageLimit: raw.usage_limit ?? undefined,
      usageCount: raw.used_count || raw.usage_count || 0,
      validUntil: raw.valid_until ?? undefined,
      active: raw.active ?? true,
    }),
  },
  {
    table: "product_variants",
    store: "product_variants",
    mapRecord: (raw: any) => mapVariantFromDB(raw),
  },
];

// ─── Singleton ───────────────────────────────────────────────────────────────

let _channel: RealtimeChannel | null = null;
let _bcListener: ((event: MessageEvent) => void) | null = null;
let _isCatchingUp = false;
let _connectivityListeners: (() => void) | null = null;
const _listeners = new Set<SyncCallback>();
const bc =
  typeof window !== "undefined"
    ? new BroadcastChannel("ikcous_realtime_db_sync")
    : null;

// ─── Engine ──────────────────────────────────────────────────────────────────

export const RealtimeSyncEngine = {
  /**
   * Start listening to ALL monitored tables.
   * Uses a single Supabase Realtime channel with multiple postgres_changes filters.
   * This is more efficient than one channel per table.
   *
   * @param vault — The DataVault instance to apply changes to
   * @param isLeader — Whether this tab is the leader tab
   * @param isAdmin — Whether this user is an admin
   * @returns cleanup function to unsubscribe
   */
  start(vault: DataVault, isLeader: boolean, isAdmin = false): () => void {
    if (_channel || _bcListener) {
      console.warn("[RealtimeSyncEngine] Already running. Call stop() first.");
      return () => this.stop();
    }

    console.log(
      `[RealtimeSyncEngine] Starting realtime sync (isLeader: ${isLeader}, isAdmin: ${isAdmin})...`,
    );

    if (isLeader) {
      // Build a single channel with all table subscriptions
      let channel = supabase.channel("datavault-sync");

      for (const config of TABLE_CONFIGS) {
        channel = channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: config.table,
          },
          async (payload: RealtimePostgresChangesPayload<any>) => {
            const eventType = payload.eventType as RealtimeEventType;
            const raw = payload.new as any;
            const old = payload.old as any;

            // 1. Process locally on leader tab
            await this._applyChangeAndNotify(
              vault,
              config,
              eventType,
              raw,
              old,
            );

            // 2. Broadcast to secondary tabs
            if (bc) {
              bc.postMessage({
                type: "db_change",
                table: config.table,
                eventType,
                raw,
                old,
              });
            }
          },
        );
      }

      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(
            "[RealtimeSyncEngine] ✅ Subscribed to all tables:",
            TABLE_CONFIGS.map((c) => c.table).join(", "),
          );
          // Perform catch-up on successful subscription (handles reconnects!)
          this.catchUp(vault, isAdmin).catch((err) => {
            console.error(
              "[RealtimeSyncEngine] Catch-up failed after subscription/reconnect:",
              err,
            );
          });
        } else if (status === "CHANNEL_ERROR") {
          const errMessage =
            (err as any)?.message ||
            (typeof (err as any) === "string" ? (err as any) : "");
          const isNormalClose =
            errMessage.includes("1000") || errMessage.includes("normal");
          const isAbnormalClose =
            errMessage.includes("1006") || errMessage.includes("abnormal");
          if (isNormalClose) {
            console.log(
              "[RealtimeSyncEngine] Channel closed normally (socket closed: 1000)",
            );
          } else if (isAbnormalClose) {
            console.warn(
              "[RealtimeSyncEngine] Channel closed abnormally (socket closed: 1006). SDK will auto-reconnect.",
            );
          } else {
            console.error(
              "[RealtimeSyncEngine] Channel error:",
              err?.message || "Unknown",
            );
          }
        } else if (status === "TIMED_OUT") {
          console.warn(
            "[RealtimeSyncEngine] Subscription timed out. Supabase Realtime may be unavailable.",
          );
        }
      });

      _channel = channel;

      // Register connectivity/visibility change listeners
      if (typeof window !== "undefined") {
        const handleOnline = () => {
          console.log(
            "[RealtimeSyncEngine] Connection restored (online). Triggering catchUp...",
          );
          this.catchUp(vault, isAdmin).catch(() => {});
        };

        const handleVisibilityChange = () => {
          if (document.visibilityState === "visible") {
            console.log(
              "[RealtimeSyncEngine] Tab active (visible). Triggering catchUp...",
            );
            this.catchUp(vault, isAdmin).catch(() => {});
          }
        };

        window.addEventListener("online", handleOnline);
        document.addEventListener("visibilitychange", handleVisibilityChange);

        _connectivityListeners = () => {
          window.removeEventListener("online", handleOnline);
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange,
          );
        };
      }
    } else {
      // Secondary tab: Listen for broadcast events from leader tab
      if (bc) {
        _bcListener = async (event: MessageEvent) => {
          if (!event.data) return;
          const { type, table, eventType, raw, old, data, products, variants } =
            event.data;

          if (type === "db_change") {
            const config = TABLE_CONFIGS.find((c) => c.table === table);
            if (config) {
              await this._applyChangeAndNotify(
                vault,
                config,
                eventType,
                raw,
                old,
              );
            }
          } else if (type === "db_change_bulk") {
            const config = TABLE_CONFIGS.find((c) => c.table === table);
            if (config && Array.isArray(data)) {
              const mapped = data.map((item: any) =>
                config.mapRecord ? config.mapRecord(item) : item,
              );
              await vault.replaceAll(config.store, mapped);
              await vault.setLastSync(config.store);
              // Notify React listeners
              const syncEvent: SyncEvent = {
                table,
                store: config.store,
                eventType: "UPDATE",
              };
              for (const cb of _listeners) {
                cb(syncEvent);
              }
            }
          } else if (type === "db_change_bulk_products") {
            if (Array.isArray(products)) {
              const mappedProducts = products.map((p: any) => {
                const productVariants = (variants || []).filter(
                  (v: any) => v.product_id === p.id,
                );
                return mapProductFromDB({
                  ...p,
                  product_variants: productVariants,
                });
              });

              await vault.putMany("products", mappedProducts);
              await vault.setLastSync("products");

              if (Array.isArray(variants) && variants.length > 0) {
                const variantRecord = TABLE_CONFIGS.find(
                  (c) => c.table === "product_variants",
                );
                if (variantRecord) {
                  const mappedVariants = variants.map((v) =>
                    variantRecord.mapRecord ? variantRecord.mapRecord(v) : v,
                  );
                  await vault.putMany("product_variants", mappedVariants);
                  await vault.setLastSync("product_variants");
                }
              }

              const syncEvent: SyncEvent = {
                table: "produtos",
                store: "products",
                eventType: "UPDATE",
              };
              for (const cb of _listeners) {
                cb(syncEvent);
              }
            }
          }
        };
        bc.addEventListener("message", _bcListener);
        console.log(
          "[RealtimeSyncEngine] Secondary tab listening via BroadcastChannel.",
        );
      }
    }

    return () => this.stop();
  },

  /**
   * Stop all realtime subscriptions and BroadcastChannel listeners.
   */
  stop(): void {
    if (_channel) {
      console.log("[RealtimeSyncEngine] Stopping leader realtime sync...");
      supabase.removeChannel(_channel).catch(() => {});
      _channel = null;
    }
    if (_bcListener && bc) {
      console.log(
        "[RealtimeSyncEngine] Stopping secondary broadcast listener...",
      );
      bc.removeEventListener("message", _bcListener);
      _bcListener = null;
    }
    if (_connectivityListeners) {
      console.log(
        "[RealtimeSyncEngine] Stopping connectivity and visibility listeners...",
      );
      _connectivityListeners();
      _connectivityListeners = null;
    }
  },

  /**
   * Register a callback that's invoked on every sync event.
   * Returns an unsubscribe function.
   */
  onSync(callback: SyncCallback): () => void {
    _listeners.add(callback);
    return () => {
      _listeners.delete(callback);
    };
  },

  /**
   * Apply change to DataVault and notify all listeners.
   */
  async _applyChangeAndNotify(
    vault: DataVault,
    config: TableConfig,
    eventType: RealtimeEventType,
    raw: any,
    old: any,
  ): Promise<void> {
    // A exclusão de produto deste app é *soft-delete*: `useProducts` grava
    // `deleted_at` com um UPDATE, então a exclusão chega aqui como UPDATE. Sem
    // esta checagem o `case "UPDATE"` daria `vault.put` e gravaria de volta no
    // cofre o produto que a lojista acabou de excluir -- ele reapareceria na
    // vitrine com preço e estoque. Tratar como DELETE (em vez de só pular o
    // `put`) é o que apaga a cópia velha, que já estava no cofre de antes da
    // exclusão. Genérico de propósito: em tabela sem a coluna, `deleted_at` é
    // `undefined` e nada muda.
    const foiExcluidoPorSoftDelete =
      eventType !== "DELETE" && raw?.deleted_at != null;
    const eventoEfetivo: RealtimeEventType = foiExcluidoPorSoftDelete
      ? "DELETE"
      : eventType;

    // O log conta o que o motor FEZ, não o que chegou: numa exclusão o que
    // chega é UPDATE e o que acontece é um apagamento. Sem isto, quem for
    // investigar "por que este produto sumiu" procura um DELETE no console,
    // não acha nenhum, e conclui que o motor não encostou no produto.
    const eventoNoLog = foiExcluidoPorSoftDelete
      ? `${eventType}→DELETE (soft-delete)`
      : eventType;
    console.log(
      `[RealtimeSyncEngine] Applying ${eventoNoLog} on ${config.table} (id: ${raw?.id || old?.id})`,
    );

    try {
      switch (eventoEfetivo) {
        case "INSERT":
        case "UPDATE": {
          if (raw?.id) {
            const mapped = config.mapRecord ? config.mapRecord(raw) : raw;
            await vault.put(config.store, mapped);
            await vault.setLastSync(config.store);

            // Special handling for product_variants updates to update the parent product in 'products' store
            if (config.store === "product_variants") {
              const variant = mapped;
              const product = await vault.getById<Product>(
                "products",
                variant.productId,
              );
              if (product) {
                const variants = product.variants || [];
                const idx = variants.findIndex((v: any) => v.id === variant.id);
                if (idx >= 0) {
                  variants[idx] = variant;
                } else {
                  variants.push(variant);
                }
                product.variants = variants;
                product.stock = variants.reduce(
                  (acc: number, v: any) =>
                    acc + (v.active ? Number(v.stockIncrement) || 0 : 0),
                  0,
                );
                await vault.put("products", product);
                await vault.setLastSync("products");

                // Trigger synthetic 'products' update event to notify UI
                const productsEvent: SyncEvent = {
                  table: "produtos",
                  store: "products",
                  eventType: "UPDATE",
                  newRecord: product,
                };
                for (const cb of _listeners) {
                  try {
                    cb(productsEvent);
                  } catch (e) {
                    console.error(
                      "[RealtimeSyncEngine] Synthetic product listener error:",
                      e,
                    );
                  }
                }
              }
            }
          }
          break;
        }
        case "DELETE": {
          // Num DELETE de verdade o id só vem no `old`; num soft-delete o
          // registro inteiro vem no `raw`.
          const deleteId = old?.id ?? raw?.id;
          if (deleteId) {
            let productId: string | undefined;
            if (config.store === "product_variants") {
              const variant = await vault.getById<any>(
                "product_variants",
                deleteId,
              );
              productId = variant?.productId;
            }

            await vault.deleteById(config.store, deleteId);
            await vault.setLastSync(config.store);

            // Special handling for deleting a variant
            if (config.store === "product_variants" && productId) {
              const product = await vault.getById<Product>(
                "products",
                productId,
              );
              if (product) {
                const variants = (product.variants || []).filter(
                  (v: any) => v.id !== deleteId,
                );
                product.variants = variants;
                product.stock = variants.reduce(
                  (acc: number, v: any) =>
                    acc + (v.active ? Number(v.stockIncrement) || 0 : 0),
                  0,
                );
                await vault.put("products", product);
                await vault.setLastSync("products");

                // Trigger synthetic 'products' update event to notify UI
                const productsEvent: SyncEvent = {
                  table: "produtos",
                  store: "products",
                  eventType: "UPDATE",
                  newRecord: product,
                };
                for (const cb of _listeners) {
                  try {
                    cb(productsEvent);
                  } catch (e) {
                    console.error(
                      "[RealtimeSyncEngine] Synthetic product listener error:",
                      e,
                    );
                  }
                }
              }
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error(
        "[RealtimeSyncEngine] Failed to apply eventType on table:",
        eventoNoLog,
        config.table,
        err,
      );
    }

    // Notify all React callbacks
    // No soft-delete a interface é avisada no mesmo formato de um DELETE de
    // verdade: aquele registro não existe mais para quem lê o cofre.
    const event: SyncEvent = {
      table: config.table,
      store: config.store,
      eventType: eventoEfetivo,
      newRecord: foiExcluidoPorSoftDelete ? undefined : raw,
      oldRecord: foiExcluidoPorSoftDelete ? raw : old,
    };

    for (const cb of _listeners) {
      try {
        cb(event);
      } catch (err) {
        console.error("[RealtimeSyncEngine] Listener error:", err);
      }
    }
  },

  /**
   * Run delta synchronization / catch-up reconciliation with Supabase.
   */
  async catchUp(vault: DataVault, isAdmin: boolean): Promise<void> {
    if (_isCatchingUp) return;
    _isCatchingUp = true;
    console.log("[RealtimeSyncEngine] 🔄 Running catchUp/reconciliation...");

    try {
      const tableSourceConfig = isAdmin ? "store_config" : "v_store_config";
      const productSource = isAdmin ? "produtos" : "vw_produtos_public";

      // Build products query
      let productsQuery = supabase
        .from(productSource as any)
        .select("id, ultima_atualizacao");
      if (isAdmin) {
        productsQuery = productsQuery.is("deleted_at", null);
      }

      // Execute queries in parallel
      const [
        configResult,
        categoriesResult,
        bannersResult,
        couponsResult,
        summaryResult,
      ] = await Promise.all([
        supabase
          .from(tableSourceConfig as any)
          .select("*")
          .single(),
        supabase.from("categorias").select("*").order("nome"),
        supabase.from("banners").select("*").order("order"),
        isAdmin
          ? supabase
              .from("coupons")
              .select("*")
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: null, error: null }),
        productsQuery,
      ]);

      // Log queries with errors so they don't fail silently
      if (configResult.error) {
        console.warn(
          "[RealtimeSyncEngine] configResult sync failed:",
          configResult.error,
        );
      }
      if (categoriesResult.error) {
        console.warn(
          "[RealtimeSyncEngine] categoriesResult sync failed:",
          categoriesResult.error,
        );
      }
      if (bannersResult.error) {
        console.warn(
          "[RealtimeSyncEngine] bannersResult sync failed:",
          bannersResult.error,
        );
      }
      if (couponsResult.error) {
        console.warn(
          "[RealtimeSyncEngine] couponsResult sync failed:",
          couponsResult.error,
        );
      }
      if (summaryResult.error) {
        console.warn(
          "[RealtimeSyncEngine] summaryResult sync failed:",
          summaryResult.error,
        );
      }

      // 1. Sync store_config
      const rawConfig = configResult.data;
      if (rawConfig) {
        const configRecord = TABLE_CONFIGS.find(
          (c) => c.table === "store_config",
        );
        if (configRecord) {
          await this._applyChangeAndNotify(
            vault,
            configRecord,
            "UPDATE",
            rawConfig,
            null,
          );
          bc?.postMessage({
            type: "db_change",
            table: "store_config",
            eventType: "UPDATE",
            raw: rawConfig,
            old: null,
          });
        }
      }

      // 2. Sync categories (overwrite)
      const rawCategories = categoriesResult.data;
      if (rawCategories) {
        const catRecord = TABLE_CONFIGS.find((c) => c.table === "categorias");
        if (catRecord) {
          const mappedCats = rawCategories.map((raw: any) =>
            catRecord.mapRecord ? catRecord.mapRecord(raw) : raw,
          );
          await vault.replaceAll("categories", mappedCats);
          await vault.setLastSync("categories");
          bc?.postMessage({
            type: "db_change_bulk",
            table: "categorias",
            data: rawCategories,
          });
          const event: SyncEvent = {
            table: "categorias",
            store: "categories",
            eventType: "UPDATE",
          };
          for (const cb of _listeners) {
            cb(event);
          }
        }
      }

      // 3. Sync banners (overwrite)
      const rawBanners = bannersResult.data;
      if (rawBanners) {
        const bannerRecord = TABLE_CONFIGS.find((c) => c.table === "banners");
        if (bannerRecord) {
          const mappedBanners = rawBanners
            .filter((b: any) => b.image_url || b.imagem_url)
            .map((raw: any) =>
              bannerRecord.mapRecord ? bannerRecord.mapRecord(raw) : raw,
            );
          await vault.replaceAll("banners", mappedBanners);
          await vault.setLastSync("banners");
          bc?.postMessage({
            type: "db_change_bulk",
            table: "banners",
            data: rawBanners,
          });
          const event: SyncEvent = {
            table: "banners",
            store: "banners",
            eventType: "UPDATE",
          };
          for (const cb of _listeners) {
            cb(event);
          }
        }
      }

      // 4. Sync coupons if admin (overwrite)
      if (isAdmin && couponsResult.data) {
        const rawCoupons = couponsResult.data;
        const couponRecord = TABLE_CONFIGS.find((c) => c.table === "coupons");
        if (couponRecord) {
          const mappedCoupons = rawCoupons.map((raw: any) =>
            couponRecord.mapRecord ? couponRecord.mapRecord(raw) : raw,
          );
          await vault.replaceAll("coupons", mappedCoupons);
          await vault.setLastSync("coupons");
          bc?.postMessage({
            type: "db_change_bulk",
            table: "coupons",
            data: rawCoupons,
          });
          const event: SyncEvent = {
            table: "coupons",
            store: "coupons",
            eventType: "UPDATE",
          };
          for (const cb of _listeners) {
            cb(event);
          }
        }
      }

      // 5. Sync products (delta update + reconciliation of deleted/inactive)
      const serverProductsSummary = summaryResult.data;

      if (serverProductsSummary) {
        const serverSummary = serverProductsSummary as any[];
        const serverIds = new Set(serverSummary.map((p: any) => p.id));
        const localProducts = await vault.getAll<Product>("products");

        // Find deleted/inactive items: in local but not on server
        const deletedIds = localProducts
          .filter((p) => !serverIds.has(p.id))
          .map((p) => p.id);
        for (const id of deletedIds) {
          await vault.deleteById("products", id);
          // Delete variants for deleted product
          const productVariants = await vault.getByIndex<any>(
            "product_variants",
            "by_product_id",
            id,
          );
          for (const v of productVariants) {
            await vault.deleteById("product_variants", v.id);
          }
          bc?.postMessage({
            type: "db_change",
            table: "produtos",
            eventType: "DELETE",
            old: { id },
          });
        }
        if (deletedIds.length > 0) {
          await vault.setLastSync("products");
          await vault.setLastSync("product_variants");
        }

        // Find updated or new items
        const outOfDateIds: string[] = [];
        for (const serverProd of serverSummary) {
          const localProd = localProducts.find((p) => p.id === serverProd.id);
          if (!localProd) {
            outOfDateIds.push(serverProd.id);
          } else {
            const localTime = new Date(
              localProd.updatedAt || localProd.createdAt,
            ).getTime();
            const serverTime = new Date(
              serverProd.ultima_atualizacao ||
                serverProd.created_at ||
                localProd.createdAt,
            ).getTime();
            if (serverTime > localTime + 1000) {
              // 1s grace window
              outOfDateIds.push(serverProd.id);
            }
          }
        }

        if (outOfDateIds.length > 0) {
          // Espelha o filtro que `productsQuery` já aplica na consulta de
          // RESUMO, no começo deste mesmo método. Entre as duas idas à rede
          // existe uma janela: se um produto for excluído (soft-delete) nesse
          // intervalo, buscar sem este filtro traz de volta um registro já com
          // `deleted_at` preenchido -- e o `putMany` o grava no cofre como se
          // estivesse vivo. A view `vw_produtos_public` já filtra por conta
          // própria e não expõe a coluna, então o filtro só entra no ramo admin.
          let detailQuery = supabase
            .from(isAdmin ? "produtos" : ("vw_produtos_public" as any))
            .select("*, product_variants(*)")
            .in("id", outOfDateIds);
          if (isAdmin) {
            detailQuery = detailQuery.is("deleted_at", null);
          }
          const { data: rawProducts } = await detailQuery;

          if (rawProducts) {
            const variantRecord = TABLE_CONFIGS.find(
              (c) => c.table === "product_variants",
            );

            const mappedProducts = rawProducts.map((p: any) =>
              mapProductFromDB(p),
            );

            await vault.putMany("products", mappedProducts);
            await vault.setLastSync("products");

            const allVariants = rawProducts.flatMap(
              (p: any) => p.product_variants || [],
            );
            if (allVariants.length > 0 && variantRecord) {
              const mappedVariants = allVariants.map((v) =>
                variantRecord.mapRecord ? variantRecord.mapRecord(v) : v,
              );
              await vault.putMany("product_variants", mappedVariants);
              await vault.setLastSync("product_variants");
            }

            // Broadcast bulk update to other tabs
            bc?.postMessage({
              type: "db_change_bulk_products",
              products: rawProducts,
              variants: allVariants,
            });

            // Trigger sync events
            const event: SyncEvent = {
              table: "produtos",
              store: "products",
              eventType: "UPDATE",
            };
            for (const cb of _listeners) {
              cb(event);
            }
          }
        }
      }
      console.log("[RealtimeSyncEngine] ✅ CatchUp complete.");
    } catch (err) {
      console.error(
        "[RealtimeSyncEngine] Catch-up error:",
        err ??
          new Error("Unknown error during catch-up (null/undefined rejection)"),
      );
    } finally {
      _isCatchingUp = false;
    }
  },

  /**
   * Check if the engine is currently running.
   */
  isRunning(): boolean {
    return _channel !== null || _bcListener !== null;
  },

  /**
   * Get the list of monitored table names.
   */
  getMonitoredTables(): string[] {
    return TABLE_CONFIGS.map((c) => c.table);
  },
};
