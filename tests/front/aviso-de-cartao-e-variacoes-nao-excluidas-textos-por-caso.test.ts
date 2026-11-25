// Dois textos de tela que decidem por UMA condição pequena e nenhum teste
// citava direto:
//   · `avisoDeCartaoNoPedidoVencido`: pedido cancelado por prazo, mas pago com
//     cartão pode ter sido APROVADO depois — só crédito e débito recebem o
//     aviso "fale com a loja"; PIX, boleto e valor ausente nunca (para eles o
//     texto seria uma mentira que assusta a cliente);
//   · `textoVariacoesNaoExcluidas`: concordância no singular e no plural.
import { avisoDeCartaoNoPedidoVencido } from "@/lib/aviso-de-cartao-no-pedido-vencido";
import { textoVariacoesNaoExcluidas } from "@/lib/texto-variacoes-nao-excluidas";
import { describe, expect, it } from "vitest";

describe("avisoDeCartaoNoPedidoVencido", () => {
  it.each(["credito", "debito"])(
    "pagamento por %s manda falar com a loja antes de comprar de novo",
    (metodo) => {
      const aviso = avisoDeCartaoNoPedidoVencido(metodo);
      expect(aviso).toBe(
        "O prazo do pagamento terminou e o pedido foi cancelado. Antes de comprar de novo, fale com a loja para confirmar se o pagamento do cartão foi aprovado.",
      );
    },
  );

  it.each([
    ["pix", "pix"],
    ["boleto", "boleto"],
    ["texto vazio", ""],
    ["maiúscula (valor do banco é minúsculo)", "CREDITO"],
    ["com acento (não é o valor do banco)", "crédito"],
    ["espaço sobrando", "credito "],
    ["nulo", null],
    ["ausente", undefined],
  ])("%s não recebe aviso de cartão", (_nome, metodo) => {
    expect(avisoDeCartaoNoPedidoVencido(metodo)).toBeUndefined();
  });
});

describe("textoVariacoesNaoExcluidas", () => {
  it("uma variação só: texto no singular, com o nome dela", () => {
    expect(textoVariacoesNaoExcluidas("P / Azul", 1)).toBe(
      "O produto e as outras variações foram salvos, mas não consegui excluir P / Azul. Se ela já tem vendas, desligue-a no botão de ligar/desligar da linha em vez de excluir.",
    );
  });

  it("duas ou mais: texto no plural", () => {
    expect(textoVariacoesNaoExcluidas("P / Azul, M / Azul", 2)).toBe(
      "O produto e as outras variações foram salvos, mas não consegui excluir P / Azul, M / Azul. Se elas já têm vendas, desligue-as no botão de ligar/desligar da linha em vez de excluir.",
    );
    expect(textoVariacoesNaoExcluidas("a, b, c", 3)).toContain(
      "Se elas já têm vendas, desligue-as",
    );
  });

  it("a fronteira é entre 1 e 2: o número é o que decide, não o texto", () => {
    expect(textoVariacoesNaoExcluidas("x", 1)).toContain("desligue-a no botão");
    expect(textoVariacoesNaoExcluidas("x", 1)).not.toContain("desligue-as");
    expect(textoVariacoesNaoExcluidas("x", 2)).toContain("desligue-as");
  });

  it("zero (não deveria chegar aqui) cai no singular, nunca no plural", () => {
    expect(textoVariacoesNaoExcluidas("x", 0)).toContain(
      "Se ela já tem vendas",
    );
  });
});
