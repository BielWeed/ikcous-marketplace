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

import { supabase } from '@/lib/supabase';
import { DataVault, type StoreName } from '@/lib/dataVault';
import { mapProductFromDB, mapVariantFromDB } from '@/lib/mappers';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

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

const TABLE_CONFIGS: TableConfig[] = [
  {
    table: 'produtos',
    store: 'products',
    mapRecord: (raw: any) => mapProductFromDB(raw),
  },
  {
    table: 'categorias',
    store: 'categories',
    mapRecord: (raw: any) => ({
      id: raw.id,
      name: raw.nome,
      slug: raw.slug || '',
      description: raw.descricao || '',
      isActive: raw.ativo ?? true,
      createdAt: raw.created_at,
    }),
  },
  {
    table: 'banners',
    store: 'banners',
    mapRecord: (raw: any) => ({
      id: raw.id,
      imageUrl: raw.image_url || raw.imagem_url,
      title: raw.title || '',
      link: raw.link || undefined,
      position: raw.position,
      active: raw.active ?? raw.ativo ?? true,
      order: raw.order || 0,
    }),
  },
  {
    table: 'store_config',
    store: 'store_config',
    mapRecord: (raw: any) => ({
      id: 'singleton',
      freeShippingMin: raw.free_shipping_min,
      shippingFee: raw.shipping_fee,
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
    }),
  },
  {
    table: 'coupons',
    store: 'coupons',
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
    table: 'product_variants',
    store: 'product_variants',
    mapRecord: (raw: any) => mapVariantFromDB(raw),
  },
];

// ─── Singleton ───────────────────────────────────────────────────────────────

let _channel: RealtimeChannel | null = null;
const _listeners = new Set<SyncCallback>();

// ─── Engine ──────────────────────────────────────────────────────────────────

export const RealtimeSyncEngine = {
  /**
   * Start listening to ALL monitored tables.
   * Uses a single Supabase Realtime channel with multiple postgres_changes filters.
   * This is more efficient than one channel per table.
   * 
   * @param vault — The DataVault instance to apply changes to
   * @returns cleanup function to unsubscribe
   */
  start(vault: DataVault): () => void {
    if (_channel) {
      console.warn('[RealtimeSyncEngine] Already running. Call stop() first.');
      return () => this.stop();
    }

    console.log('[RealtimeSyncEngine] Starting realtime sync for all tables...');

    // Build a single channel with all table subscriptions
    let channel = supabase.channel('datavault-sync');

    for (const config of TABLE_CONFIGS) {
      channel = channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: config.table,
        },
        (payload: RealtimePostgresChangesPayload<any>) => {
          this._handleChange(vault, config, payload);
        }
      );
    }

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('[RealtimeSyncEngine] ✅ Subscribed to all tables:', TABLE_CONFIGS.map(c => c.table).join(', '));
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[RealtimeSyncEngine] Channel error:', err?.message || 'Unknown');
      } else if (status === 'TIMED_OUT') {
        console.warn('[RealtimeSyncEngine] Subscription timed out. Supabase Realtime may be unavailable.');
      }
    });

    _channel = channel;

    return () => this.stop();
  },

  /**
   * Stop all realtime subscriptions.
   */
  stop(): void {
    if (_channel) {
      console.log('[RealtimeSyncEngine] Stopping realtime sync...');
      supabase.removeChannel(_channel).catch(() => {});
      _channel = null;
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
   * Handle a single postgres_changes event.
   * Applies the change to DataVault and notifies all listeners.
   */
  async _handleChange(
    vault: DataVault,
    config: TableConfig,
    payload: RealtimePostgresChangesPayload<any>
  ): Promise<void> {
    const eventType = payload.eventType as RealtimeEventType;
    const raw = payload.new as any;
    const old = payload.old as any;

    console.log(`[RealtimeSyncEngine] ${eventType} on ${config.table} (id: ${raw?.id || old?.id})`);

    try {
      switch (eventType) {
        case 'INSERT':
        case 'UPDATE': {
          if (raw && raw.id) {
            const mapped = config.mapRecord ? config.mapRecord(raw) : raw;
            await vault.put(config.store, mapped);
            await vault.setLastSync(config.store);
          }
          break;
        }
        case 'DELETE': {
          const deleteId = old?.id;
          if (deleteId) {
            await vault.deleteById(config.store, deleteId);
            await vault.setLastSync(config.store);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[RealtimeSyncEngine] Failed to apply ${eventType} on ${config.table}:`, err);
    }

    // Notify all React callbacks
    const event: SyncEvent = {
      table: config.table,
      store: config.store,
      eventType,
      newRecord: raw,
      oldRecord: old,
    };

    for (const cb of _listeners) {
      try {
        cb(event);
      } catch (err) {
        console.error('[RealtimeSyncEngine] Listener error:', err);
      }
    }
  },

  /**
   * Check if the engine is currently running.
   */
  isRunning(): boolean {
    return _channel !== null;
  },

  /**
   * Get the list of monitored table names.
   */
  getMonitoredTables(): string[] {
    return TABLE_CONFIGS.map(c => c.table);
  },
};
