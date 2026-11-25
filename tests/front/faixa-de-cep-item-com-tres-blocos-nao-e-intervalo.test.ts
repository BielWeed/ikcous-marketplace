// Achado por mutação, 25/11/2026: trocar `partes.length === 2` por `>= 2` em
// `faixaDeCepReconhecida` deixava a suíte verde. Um item com TRÊS blocos de
// dígitos ("385000-385999-1") não é intervalo: a cotação (isLocalCep da edge
// calculate-shipping) só trata como faixa o item com EXATAMENTE dois blocos
// longos; com três ele vira um único "CEP" de 13 dígitos, que não casa com
// destino algum. Se o painel reconhecesse essa escrita como faixa, a lojista
// não receberia o aviso "essa faixa não vale" e ficaria sem entrega local
// sem saber por quê.
import { faixaDeCepReconhecida } from "@/lib/faixa-de-cep";
import { describe, expect, it } from "vitest";

describe("faixaDeCepReconhecida — três blocos não são um intervalo", () => {
  it("dois blocos longos e um terceiro solto não são reconhecidos", () => {
    expect(faixaDeCepReconhecida("385000-385999-1")).toBe(false);
    expect(faixaDeCepReconhecida("38500000-38505000-9")).toBe(false);
  });

  it("controle: os mesmos dois blocos sem o terceiro são um intervalo", () => {
    expect(faixaDeCepReconhecida("385000-385999")).toBe(true);
    expect(faixaDeCepReconhecida("38500000-38505000")).toBe(true);
  });

  it("um item de três blocos curtos que cabe em 8 dígitos continua reconhecido como CEP único", () => {
    expect(faixaDeCepReconhecida("38-500-00")).toBe(true);
  });

  it("o item ruim não derruba outro item bom da mesma faixa", () => {
    expect(faixaDeCepReconhecida("385000-385999-1, 38500-000")).toBe(true);
  });
});
