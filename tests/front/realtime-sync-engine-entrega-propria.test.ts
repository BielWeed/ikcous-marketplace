// @vitest-environment jsdom
//
// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026) × motor de sincronização.
//
// `realtimeSyncEngine.ts` tem uma cópia da lista de colunas de `store_config`
// — o `mapRecord` que traduz o payload cru do Realtime (e a carga do cofre
// offline) para o formato do `StoreConfig`. O `StoreContext` lê esse registro
// de volta com `mapConfig`: campo que o `mapRecord` não carrega vira
// "ausente" ali, e "ausente" lê como o PADRÃO. Sem os dois campos novos aqui,
// a lojista que escolheu "Só retiro" teria a entrega própria religada no
// celular de cada cliente assim que chegasse o primeiro eco do Realtime — o
// banco diria "só retiro" e a tela, "entrego".
import { describe, expect, it, vi } from "vitest";

// O client real do Supabase falha ao construir em jsdom (sem Web Worker); o
// dublê basta — nenhum caso aqui chama a rede, só o `mapRecord` puro.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

function mapearStoreConfig(raw: Record<string, unknown>) {
  const tabela = TABLE_CONFIGS.find((c) => c.table === "store_config");
  expect(tabela).toBeDefined();
  expect(tabela!.mapRecord).not.toBeNull();
  return tabela!.mapRecord!(raw);
}

describe("realtimeSyncEngine — modo e prazo da entrega própria no mapRecord de store_config", () => {
  it("só retiro com 3 dias chega ao StoreConfig do jeito que o banco tem", () => {
    const mapeado = mapearStoreConfig({
      local_delivery_enabled: false,
      local_delivery_days: 3,
    });
    expect(mapeado.localDeliveryEnabled).toBe(false);
    expect(mapeado.localDeliveryDays).toBe(3);
  });

  it("entrega ligada e prazo ZERO chegam como são (zero é um prazo, true é um valor)", () => {
    const mapeado = mapearStoreConfig({
      local_delivery_enabled: true,
      local_delivery_days: 0,
    });
    expect(mapeado.localDeliveryEnabled).toBe(true);
    expect(mapeado.localDeliveryDays).toBe(0);
  });

  it("payload SEM as colunas (banco antigo): não inventa nada — quem lê aplica o padrão", () => {
    const mapeado = mapearStoreConfig({});
    expect(mapeado.localDeliveryEnabled).toBeUndefined();
    expect(mapeado.localDeliveryDays).toBeUndefined();
  });

  it("colunas nulas: também ausentes, nunca 0 nem false", () => {
    const mapeado = mapearStoreConfig({
      local_delivery_enabled: null,
      local_delivery_days: null,
    });
    expect(mapeado.localDeliveryEnabled).toBeUndefined();
    expect(mapeado.localDeliveryDays).toBeUndefined();
  });

  it("o prazo que o banco manda como texto numérico vira número", () => {
    const mapeado = mapearStoreConfig({ local_delivery_days: "7" });
    expect(mapeado.localDeliveryDays).toBe(7);
  });
});
