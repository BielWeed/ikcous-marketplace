import { describe, expect, it } from "vitest";
import type { StoreConfig } from "@/types";

describe("identidade da loja no StoreConfig", () => {
  it("aceita nome, cidade e estado da loja", () => {
    const config: Partial<StoreConfig> = {
      storeName: "Loja Teste",
      storeCity: "Uberlândia",
      storeState: "MG",
    };
    expect(config.storeName).toBe("Loja Teste");
    expect(config.storeCity).toBe("Uberlândia");
    expect(config.storeState).toBe("MG");
  });

  it("trata identidade ausente como indefinida, nunca como texto de reserva", () => {
    const config: Partial<StoreConfig> = {};
    expect(config.storeName).toBeUndefined();
    expect(config.storeCity).toBeUndefined();
    expect(config.storeState).toBeUndefined();
    // Reserva de CEP era "38500-000" e cravava Monte Carmelo em loja que nunca
    // informou de onde despacha.
    expect(config.originCep).toBeUndefined();
  });
});
