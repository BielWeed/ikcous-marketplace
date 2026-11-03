// Caça 02/11, achado b2: no iPhone, tocar a barra de espaço duas vezes insere um
// ponto, e há quem separe termos por vírgula ("vestido, azul"). A pontuação
// ficava colada na palavra ("camiseta.") e o produto sumia da lista. Agora a
// pontuação das PONTAS de cada palavra não conta; a do MEIO fica ("3.5").
import { produtoCombinaComBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

const camiseta = { name: "Camiseta Básica", category: "Geral" };

describe("produtoCombinaComBusca — pontuação junto da palavra", () => {
  it.each(["camiseta.", "camiseta,", "camiseta!", "(camiseta)", "camiseta ."])(
    "'%s' acha Camiseta Básica",
    (busca) => {
      expect(produtoCombinaComBusca(camiseta, busca)).toBe(true);
    },
  );

  it("vírgula entre os termos: 'camiseta, básica' acha", () => {
    expect(produtoCombinaComBusca(camiseta, "camiseta, básica")).toBe(true);
  });

  it("plural com pontuação: 'camisetas.' ainda acha a forma no singular", () => {
    expect(produtoCombinaComBusca(camiseta, "camisetas.")).toBe(true);
  });

  it("controle: a pontuação não faz achar o que não existe", () => {
    expect(produtoCombinaComBusca(camiseta, "calça.")).toBe(false);
    expect(produtoCombinaComBusca(camiseta, "camiseta, calça")).toBe(false);
  });

  it("número com ponto no meio continua inteiro: '3.5' acha 'Cabo P2 3.5mm'", () => {
    const fone = { name: "Cabo P2 3.5mm", category: "Cabos" };
    expect(produtoCombinaComBusca(fone, "3.5")).toBe(true);
    expect(produtoCombinaComBusca(fone, "3.5.")).toBe(true);
    expect(produtoCombinaComBusca(fone, "35")).toBe(false);
  });

  it("busca sem letra nem número (só pontuação ou emoji) segue como antes: acha só quem tem aquilo no nome", () => {
    const presente = { name: "Caixa 🎁 Presente", category: "Geral" };
    expect(produtoCombinaComBusca(camiseta, "...")).toBe(false);
    expect(produtoCombinaComBusca(camiseta, "🎁")).toBe(false);
    expect(produtoCombinaComBusca(presente, "🎁")).toBe(true);
  });
});
