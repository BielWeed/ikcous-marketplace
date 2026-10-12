import type { AlcanceDoCupom, Coupon } from "@/types";

/**
 * A linha de `coupons` (banco) vira o `Coupon` da tela — o ÚNICO mapeador
 * (frente B, 28/09/2026: antes eram três cópias, em useCoupons.ts,
 * realtimeSyncEngine.ts e admin_cache.ts, que já tinham divergido uma vez no
 * PAINEL-12).
 *
 * - `usageCount`: só `usage_count` (a coluna que v23/v24 somam), `?? 0` —
 *   zero real continua zero. O `used_count` morto nunca é lido (a coluna
 *   morreu na migration 20261207000000).
 * - `alcance`: banco antigo (sem a coluna, antes da 20261208000000) ou valor
 *   desconhecido → 'codigo' (secreto) — nunca inventa vitrine.
 */
const ALCANCES: readonly AlcanceDoCupom[] = ["codigo", "vitrine", "exclusivo"];

export function alcanceDoBanco(valor: unknown): AlcanceDoCupom {
  return ALCANCES.includes(valor as AlcanceDoCupom)
    ? (valor as AlcanceDoCupom)
    : "codigo";
}

export function cupomDoBanco(raw: Record<string, any>): Coupon {
  return {
    id: raw.id,
    code: raw.code,
    type: raw.type as "percentage" | "fixed",
    value: raw.value,
    minPurchase: raw.min_purchase ?? undefined,
    usageLimit: raw.usage_limit ?? undefined,
    usageCount: raw.usage_count ?? 0,
    validUntil: raw.valid_until ?? undefined,
    active: raw.active ?? true,
    alcance: alcanceDoBanco(raw.alcance),
  };
}
