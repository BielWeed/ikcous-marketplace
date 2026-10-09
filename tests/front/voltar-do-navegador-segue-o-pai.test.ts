import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";
import { paiDaTelaDoAdmin } from "@/utils/pai-da-tela-do-admin";
import { destinoDoPopstate } from "@/utils/volta-do-navegador-no-painel";
import { describe, expect, it } from "vitest";

// `import.meta.glob` com `?raw` lê o fonte em tempo de build do vitest, sem API
// de Node (o tsconfig de tests/front não tem "node"; mesma lição de
// admin-visual-telas-titulo-padronizado.test.tsx).
const FONTE_DO_APP = import.meta.glob<string>("/src/App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

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

describe("App.tsx pergunta ao pai único no popstate", () => {
  const fonte = FONTE_DO_APP["/src/App.tsx"];

  it("o fonte do App foi lido de verdade (nada de prova vazia)", () => {
    expect(fonte).toBeTruthy();
    expect(fonte.length).toBeGreaterThan(10_000);
  });

  it("usa destinoDoPopstate no lugar da cadeia própria", () => {
    expect(fonte).toContain("destinoDoPopstate(");
    expect(fonte).toContain('from "@/utils/volta-do-navegador-no-painel"');
  });

  it("não tem mais a lista e o if/else próprios (a divergência voltaria)", () => {
    expect(fonte).not.toContain('currView === "admin-coupon-form"');
    expect(fonte).not.toContain("const subAdminViews");
  });
});
