//
// Ondas 3 e 4 da reforma visual do painel (03/09): as 8 telas do contrato
// — Avaliações, Perguntas, Banners, Carrosséis, Cupons e o formulário de
// cupom (onda 3), o formulário de produto e Notificações (onda 4) — passam
// a usar o AdminPageHeader — a fórmula do título do painel vive em UM
// lugar, como já acontece nas ondas anteriores (o componente é testado em
// tests/front/admin-page-header.test.tsx).
//
// Por que lê FONTE e não renderiza a tela: as 8 views são pesadas (hooks,
// supabase, framer-motion) e o que se prova aqui é o CONTRATO de
// padronização — o componente importado e usado, e nenhum `<h1` manual
// sobrando. Antes da onda 3, as 6 telas de lá tinham 5 fórmulas de título
// diferentes entre si (medidas em 03/09: text-lg sem maiúsculas em
// Avaliações/Perguntas, text-xs em Banners/Carrosséis, text-xl em Cupons,
// text-sm no formulário de cupom); a onda 4 achou mais duas fórmulas fora
// do padrão (text-sm/base com destaque verde no produto, text-base em
// Notificações).
//
// `import.meta.glob` com `?raw` lê os arquivos em tempo de build do vitest,
// sem API de Node — senão o typecheck (tsconfig sem "node" para tests/front)
// e o lint:ratchet reprovam (mesma lição já escrita na âncora do
// recusa-do-pedido-ancora-nas-migrations).
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>("/src/views/admin/Admin*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const TELAS = [
  "AdminReviewsView.tsx",
  "AdminQAView.tsx",
  "AdminBannersView.tsx",
  "AdminCarouselsView.tsx",
  "AdminCouponsView.tsx",
  "AdminCouponFormView.tsx",
  // Onda 4 (03/09): fecham o contrato de 8 telas.
  "AdminProductFormView.tsx",
  "AdminNotificationsView.tsx",
];

describe("as 8 telas do painel usam o título padrão", () => {
  it("o glob casou as 8 telas de verdade (nada de prova vazia)", () => {
    expect(Object.keys(FONTES).length).toBeGreaterThanOrEqual(TELAS.length);
    for (const tela of TELAS) {
      expect(FONTES, `falta o fonte de ${tela}`).toHaveProperty(
        `/src/views/admin/${tela}`,
      );
    }
  });

  for (const tela of TELAS) {
    it(`${tela} importa e usa o AdminPageHeader`, () => {
      const fonte = FONTES[`/src/views/admin/${tela}`];
      expect(fonte).toContain(
        'import { AdminPageHeader } from "@/components/admin/AdminPageHeader";',
      );
      expect(fonte).toContain("<AdminPageHeader");
    });

    it(`${tela} não tem <h1> manual (o título de página nasce só no padrão)`, () => {
      const fonte = FONTES[`/src/views/admin/${tela}`];
      expect(
        fonte,
        "há um <h1> copiado na mão fora do AdminPageHeader",
      ).not.toContain("<h1");
    });
  }
});
