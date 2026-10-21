// @vitest-environment jsdom
// O cofre offline recebe o mesmo mapa do Realtime: perder o estilo aqui
// faz a Home abrir com o card completo antes de receber o config da rede.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");

function mapearStoreConfig(raw: Record<string, unknown>) {
  const tabela = TABLE_CONFIGS.find((c) => c.table === "store_config");
  expect(tabela).toBeDefined();
  expect(tabela!.mapRecord).not.toBeNull();
  return tabela!.mapRecord!(raw);
}

describe("realtimeSyncEngine — estilo do card de frete no cofre offline", () => {
  it.each(["compacto", "completo"])(
    "preserva a escolha %s do banco",
    (estilo) => {
      expect(
        mapearStoreConfig({ free_shipping_card_style: estilo })
          .freeShippingCardStyle,
      ).toBe(estilo);
    },
  );

  it("banco antigo sem coluna deixa o padrão para quem lê", () => {
    expect(mapearStoreConfig({}).freeShippingCardStyle).toBeUndefined();
  });

  it("coluna nula também fica ausente, sem inventar escolha", () => {
    expect(
      mapearStoreConfig({ free_shipping_card_style: null })
        .freeShippingCardStyle,
    ).toBeUndefined();
  });
});
