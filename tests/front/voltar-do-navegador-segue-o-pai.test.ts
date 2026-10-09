import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";
import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";
import { destinoDoPopstate } from "@/utils/volta-do-navegador-no-painel";
import { describe, expect, it } from "vitest";

/**
 * Painel simples (C7): o Voltar do NAVEGADOR (popstate) e o botão Voltar do
 * painel têm de ir ao MESMO lugar. Antes, o `App.tsx` mantinha uma lista e
 * uma cadeia if/else próprias, e as duas divergiam em silêncio. Agora o
 * popstate pergunta ao pai único (`paiDaTelaDoAdmin`) — esta função pura é a
 * pergunta, sem tocar em `history`.
 */
describe("destinoDoPopstate", () => {
  const telas = Object.keys(NOMES_DO_PAINEL) as View[];

  it("percorre todas as telas do painel (a lista não ficou vazia)", () => {
    expect(telas.length).toBeGreaterThan(20);
  });

  it.each(telas)(
    "%s: o destino é o pai único (ou nenhum, se o pai é fora do painel)",
    (tela) => {
      const pai = paiDaTelaDoAdmin(tela, null, false);
      expect(destinoDoPopstate(tela)).toBe(pai === "profile" ? null : pai);
    },
  );

  it("as abas raiz não têm destino: o navegador segue o caminho dele", () => {
    for (const raiz of [
      "admin",
      "admin-dashboard",
      "admin-orders",
      "admin-products",
      "admin-customers",
      "admin-settings",
    ] as const) {
      expect(destinoDoPopstate(raiz)).toBeNull();
    }
  });

  it("admin-notifications volta ao Início", () => {
    expect(destinoDoPopstate("admin-notifications")).toBe("admin-dashboard");
  });

  it("os pais novos do painel simples valem também para o navegador", () => {
    expect(destinoDoPopstate("admin-qa")).toBe("admin-customers");
    expect(destinoDoPopstate("admin-reviews")).toBe("admin-customers");
    expect(destinoDoPopstate("admin-push")).toBe("admin-customers");
    expect(destinoDoPopstate("admin-shipping")).toBe("admin-settings");
    expect(destinoDoPopstate("admin-whatsapp-config")).toBe("admin-settings");
    expect(destinoDoPopstate("admin-shipping-national")).toBe("admin-shipping");
    expect(destinoDoPopstate("admin-coupon-form")).toBe("admin-coupons");
  });

  it("uma tela fora do painel não tem destino", () => {
    expect(destinoDoPopstate("home")).toBeNull();
  });
});
