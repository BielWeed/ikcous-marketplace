// Painel simples, tarefas C1-C4 (frente portas-e-alternador): o título das
// cinco telas de aba (Produtos, Pedidos, Clientes, Perguntas, Avaliações) vem
// de NOMES_DO_PAINEL, não de uma string escrita na tela. Um nome por tela:
// se o nome mudar em config/nomes-do-painel.ts, o cabeçalho acompanha.
//
// Por que lê FONTE e não renderiza: as cinco views são pesadas (hooks,
// supabase, framer-motion) e o que se prova aqui é de onde o `titulo` vem.
// O texto que chega à tela é provado nos testes que montam as views
// (portas-das-abas-nas-telas e perguntas-e-avaliacoes-alternam).
//
// `import.meta.glob` com `?raw` lê o fonte em tempo de build do vitest, sem
// API de Node (mesma lição de admin-visual-telas-titulo-padronizado).
import { describe, expect, it } from "vitest";
import {
  NOMES_DO_PAINEL,
  type TelaDoPainel,
} from "../../src/config/nomes-do-painel";

const FONTES = import.meta.glob<string>("/src/views/admin/Admin*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const TELAS: ReadonlyArray<{
  readonly arquivo: string;
  readonly rota: TelaDoPainel;
}> = [
  { arquivo: "AdminProductsView.tsx", rota: "admin-products" },
  { arquivo: "AdminOrdersView.tsx", rota: "admin-orders" },
  { arquivo: "AdminCustomersView.tsx", rota: "admin-customers" },
  { arquivo: "AdminQAView.tsx", rota: "admin-qa" },
  { arquivo: "AdminReviewsView.tsx", rota: "admin-reviews" },
];

describe("o título das telas de aba vem de NOMES_DO_PAINEL", () => {
  it("o glob casou as cinco telas (nada de prova vazia)", () => {
    for (const { arquivo } of TELAS) {
      expect(FONTES, `falta o fonte de ${arquivo}`).toHaveProperty(
        `/src/views/admin/${arquivo}`,
      );
    }
  });

  for (const { arquivo, rota } of TELAS) {
    // eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada do usuário
    const nome = NOMES_DO_PAINEL[rota];

    it(`${arquivo}: titulo={NOMES_DO_PAINEL["${rota}"]}, sem "${nome}" escrito na mão`, () => {
      const fonte = FONTES[`/src/views/admin/${arquivo}`];
      // quebra de linha do formatador não muda o que se afirma
      const compacto = fonte.replace(/\s+/g, " ");
      expect(compacto).toContain(
        `<AdminPageHeader titulo={NOMES_DO_PAINEL["${rota}"]}`,
      );
      expect(compacto).not.toContain(`titulo="${nome}"`);
    });
  }
});
