// @vitest-environment jsdom
//
// Bloco "o app para de inventar endereço": a Tarefa 2 acrescentou
// `store_name`, `store_city` e `store_state` à tabela `store_config`, e o
// `StoreContext` já lê e grava os três. Mas `realtimeSyncEngine.ts` tem uma
// TERCEIRA cópia da mesma lista de colunas -- o `mapRecord` que traduz o
// payload cru do Supabase Realtime (e da carga do cofre offline/IndexedDB)
// para o formato de `StoreConfig` -- e essa cópia não conhecia os três
// campos novos. Sem eles, a identidade da loja definida em Ajustes some
// assim que o app sincroniza pelo caminho offline/realtime em vez de vir
// direto do `StoreContext`.
import { describe, expect, it, vi } from "vitest";

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). O dublê evita
// isso -- nenhum caso deste arquivo chama a rede, só o `mapRecord` puro.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

describe("realtimeSyncEngine — identidade da loja no mapRecord de store_config", () => {
  function mapearStoreConfig(raw: Record<string, unknown>) {
    const tabela = TABLE_CONFIGS.find((c) => c.table === "store_config");
    expect(tabela).toBeDefined();
    expect(tabela!.mapRecord).not.toBeNull();
    return tabela!.mapRecord!(raw);
  }

  it("traduz store_name, store_city e store_state para o formato do StoreConfig", () => {
    const mapeado = mapearStoreConfig({
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
    });

    expect(mapeado.storeName).toBe("Loja Teste");
    expect(mapeado.storeCity).toBe("Uberlândia");
    expect(mapeado.storeState).toBe("MG");
  });

  it("não inventa identidade quando o payload não traz os campos", () => {
    const mapeado = mapearStoreConfig({});

    expect(mapeado.storeName).toBeUndefined();
    expect(mapeado.storeCity).toBeUndefined();
    expect(mapeado.storeState).toBeUndefined();
  });
});
