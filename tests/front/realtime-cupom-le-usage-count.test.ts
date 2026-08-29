//
// Lote 1 do laudo "o que falta" (29/08, achado backend 5, parcial): a
// contagem de uso do cupom tinha DUAS leituras no código. O hook de Cupons
// foi consertado (PAINEL-12: a coluna do schema é `usage_count`; leitura em
// `src/hooks/useCoupons.ts:43-46`) — mas o espelho de tempo real
// (`realtimeSyncEngine.ts`) continuava lendo `used_count` PRIMEIRO e só
// caía para `usage_count` se a primeira fosse falsa. Se qualquer linha
// trouxer `used_count` preenchido (um import antigo, um script, uma coluna
// recriada), o painel passa a mostrar outro número sem denunciar — degrau 1
// da escada de dor: mente em silêncio.
//
// O conserto alinha o espelho com o hook: uma leitura só, `usage_count`,
// com `?? 0` (zero real continua zero). Este teste morria no código de
// antes: `{used_count: 99, usage_count: 5}` devolvia 99.
//
// Mesmo padrão de realtime-sync-engine-identidade-da-loja.test.tsx: dublê
// do client no topo (o módulo importa supabase e o client real não nasce
// fora do navegador) e `mapRecord` exercitado direto, sem a cadeia
// Realtime/DataVault.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

describe("O espelho de tempo real lê a MESMA coluna de uso de cupom que o hook", () => {
  function mapearCupom(raw: Record<string, unknown>) {
    const tabela = TABLE_CONFIGS.find((c) => c.table === "coupons");
    expect(tabela).toBeDefined();
    expect(tabela!.mapRecord).not.toBeNull();
    return tabela!.mapRecord!(raw);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("usage_count é a única fonte: used_count presente não vence", () => {
    expect(mapearCupom({ used_count: 99, usage_count: 5 }).usageCount).toBe(5);
  });

  it("zero real continua zero, e used_count não serve de reserva para coluna ausente", () => {
    expect(mapearCupom({ usage_count: 0 }).usageCount).toBe(0);
    expect(mapearCupom({ usage_count: null }).usageCount).toBe(0);
    expect(mapearCupom({ usage_count: null, used_count: 7 }).usageCount).toBe(
      0,
    );
  });
});
