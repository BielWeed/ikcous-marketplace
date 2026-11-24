// FORMAS DE PAGAMENTO NA ENTREGA — a lista devolvida e SEMPRE uma copia nova.
//
// O que protege (buraco achado por mutacao, 24/11/2026): `formasPagamentoNaEntregaValidas`
// devolvia, no caso feliz, o proprio array recebido e, no caso de padrao, a
// constante interna das tres formas. Qualquer um que mexesse na lista devolvida
// (a tela do painel, o cache offline, um `push` de teste) corromperia
// o padrao de TODAS as leituras seguintes — e a loja que nunca configurou
// nada passaria a mostrar formas que a lojista nunca ligou.
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { describe, expect, it } from "vitest";

describe("formasPagamentoNaEntregaValidas devolve copia nova", () => {
  it("mexer na lista do padrao (ausente) nao muda o padrao da proxima leitura", () => {
    const primeira = formasPagamentoNaEntregaValidas(undefined);
    primeira.length = 0;
    expect(formasPagamentoNaEntregaValidas(undefined)).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("mexer na lista do padrao (elemento desconhecido) nao muda o padrao da proxima leitura", () => {
    const primeira = formasPagamentoNaEntregaValidas(["pix", "whatsapp"]);
    primeira.pop();
    expect(formasPagamentoNaEntregaValidas(["whatsapp"])).toEqual([
      "pix",
      "card",
      "cash",
    ]);
  });

  it("a lista valida e uma copia: mexer no resultado nao mexe no que veio do banco", () => {
    const doBanco = ["cash", "pix"];
    const lida = formasPagamentoNaEntregaValidas(doBanco);
    expect(lida).not.toBe(doBanco);
    lida.pop();
    expect(doBanco).toEqual(["cash", "pix"]);
  });

  it("mexer no que veio do banco depois da leitura nao muda a lista lida", () => {
    const doBanco = ["card"];
    const lida = formasPagamentoNaEntregaValidas(doBanco);
    doBanco.push("pix");
    expect(lida).toEqual(["card"]);
  });
});
