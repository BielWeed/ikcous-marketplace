// NOMES E PORTAS DO PAINEL (plano painel-simples, B1) — a declaração ÚNICA do
// nome de cada tela admin-* e da aba que tem a porta de cada sub-tela.
//
// O CONTRATO (spec 2026-10-09 §2 e §3):
//   1. Todo admin-* de TELAS_DE_ENTRADA (menos admin-login, que é a tela de
//      entrada e não faz parte do painel) tem nome não vazio — e `admin`, o
//      apelido sem hífen, também.
//   2. Cada sub-view tem UMA porta (uma aba). Ficam de fora, de propósito: os
//      apelidos (link antigo), as filhas de lista (abrem de dentro da lista),
//      o Vender (botão redondo) e as Notificações (sino).
//   3. Os valores seguem a tabela do §3.
import { describe, expect, it } from "vitest";
import {
  ABAS_DO_PAINEL,
  APELIDOS,
  NOMES_DO_PAINEL,
  NOME_DO_PAR_PERGUNTAS_E_AVALIACOES,
  PORTAS_DO_PAINEL,
} from "../../src/config/nomes-do-painel";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const telasDoPainel = TELAS_DE_ENTRADA.filter(
  (t) => (t === "admin" || t.startsWith("admin-")) && t !== "admin-login",
);

// Leitura por Map: as chaves vêm de listas de strings, não de uniões tipadas.
const nomes = new Map<string, string>(Object.entries(NOMES_DO_PAINEL));
const portasPorAba = new Map<string, readonly string[]>(
  Object.entries(PORTAS_DO_PAINEL),
);

const RAIZES_DAS_ABAS = [
  "admin-dashboard",
  "admin-orders",
  "admin-products",
  "admin-customers",
  "admin-settings",
] as const;
const FILHAS_DE_LISTA = [
  "admin-product-form",
  "admin-coupon-form",
  "admin-user-detail",
] as const;
const SEM_ABA = ["admin-pdv", "admin-notifications"] as const;

describe("NOMES_DO_PAINEL", () => {
  it("toda tela admin-* (menos admin-login) tem nome não vazio", () => {
    expect(telasDoPainel).toHaveLength(24);
    for (const tela of telasDoPainel) {
      const nome = nomes.get(tela) ?? "";
      expect(nome, tela).toBeTypeOf("string");
      expect(nome.trim(), tela).not.toBe("");
    }
  });

  it("não inventa nome para tela que não é do painel", () => {
    expect(Object.keys(NOMES_DO_PAINEL).sort()).toEqual(
      [...telasDoPainel].sort(),
    );
  });

  it("valores conforme a tabela do §3 da spec", () => {
    expect(NOMES_DO_PAINEL).toEqual({
      admin: "Início",
      "admin-dashboard": "Início",
      "admin-pdv": "Vender",
      "admin-crm": "Relatórios",
      "admin-financeiro": "Financeiro",
      "admin-orders": "Pedidos",
      "admin-devolucoes": "Devoluções",
      "admin-products": "Produtos",
      "admin-product-form": "Produto",
      "admin-coupons": "Cupons",
      "admin-coupon-form": "Cupom",
      "admin-customers": "Clientes",
      "admin-user-detail": "Ficha do cliente",
      "admin-qa": "Perguntas",
      "admin-reviews": "Avaliações",
      "admin-push": "Avisar clientes",
      "admin-settings": "Ajustes",
      "admin-about-store": "Minha loja",
      "admin-whatsapp-config": "Minha loja",
      "admin-banners": "Banners",
      "admin-carousels": "Vitrines",
      "admin-shipping": "Entrega e frete",
      "admin-shipping-national": "Entrega e frete",
      "admin-notifications": "Notificações",
    });
  });

  it("a porta única de Perguntas e Avaliações tem nome próprio", () => {
    expect(NOME_DO_PAR_PERGUNTAS_E_AVALIACOES).toBe("Perguntas e avaliações");
  });
});

describe("APELIDOS", () => {
  it("são exatamente admin-whatsapp-config, admin-shipping-national e admin", () => {
    expect(Object.keys(APELIDOS).sort()).toEqual([
      "admin",
      "admin-shipping-national",
      "admin-whatsapp-config",
    ]);
  });

  it("cada apelido aponta para uma tela real do painel, com o mesmo nome dela", () => {
    for (const [apelido, { vira }] of Object.entries(APELIDOS)) {
      expect(telasDoPainel, apelido).toContain(vira);
      expect(nomes.get(apelido), apelido).toBe(nomes.get(vira));
    }
  });

  it("o antigo Atendimento abre Minha loja na seção Contato", () => {
    expect(APELIDOS["admin-whatsapp-config"]).toEqual({
      vira: "admin-about-store",
      secao: "contato",
    });
  });

  it("o Frete nacional abre Entrega e frete já no painel nacional", () => {
    expect(APELIDOS["admin-shipping-national"]).toEqual({
      vira: "admin-shipping",
      secao: "nacional",
    });
  });
});

describe("PORTAS_DO_PAINEL", () => {
  it("são as 5 abas do menu, nesta ordem", () => {
    expect(ABAS_DO_PAINEL).toEqual([
      "inicio",
      "pedidos",
      "produtos",
      "clientes",
      "ajustes",
    ]);
    expect(Object.keys(PORTAS_DO_PAINEL)).toEqual([...ABAS_DO_PAINEL]);
  });

  it("toda sub-view com porta aparece em exatamente UMA aba", () => {
    const esperadas = telasDoPainel.filter(
      (t) =>
        !(RAIZES_DAS_ABAS as readonly string[]).includes(t) &&
        !(FILHAS_DE_LISTA as readonly string[]).includes(t) &&
        !(SEM_ABA as readonly string[]).includes(t) &&
        !(t in APELIDOS),
    );
    expect(esperadas).toHaveLength(11);
    for (const tela of esperadas) {
      const abas = ABAS_DO_PAINEL.filter((aba) =>
        portasPorAba.get(aba)?.includes(tela),
      );
      expect(abas, tela).toHaveLength(1);
    }
  });

  it("nada além das sub-views com porta entra em alguma aba", () => {
    const todas = Object.values(PORTAS_DO_PAINEL).flat();
    expect(new Set(todas).size).toBe(todas.length);
    for (const proibida of [
      ...RAIZES_DAS_ABAS,
      ...FILHAS_DE_LISTA,
      ...SEM_ABA,
      ...Object.keys(APELIDOS),
    ]) {
      expect(todas, proibida).not.toContain(proibida);
    }
  });

  it("valores conforme a coluna 'porta única' do §3", () => {
    expect(PORTAS_DO_PAINEL).toEqual({
      inicio: ["admin-crm", "admin-financeiro"],
      pedidos: ["admin-devolucoes"],
      produtos: ["admin-coupons"],
      clientes: ["admin-qa", "admin-reviews", "admin-push"],
      ajustes: [
        "admin-about-store",
        "admin-banners",
        "admin-carousels",
        "admin-shipping",
      ],
    });
  });
});
