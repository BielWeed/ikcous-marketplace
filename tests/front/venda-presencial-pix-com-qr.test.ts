// Frente A (28/09/2026) — a máquina de estados do caixa com o PIX com QR, e
// as correções A1 (centavos), A2 (motivo não vaza), B14 (conferência) e A8
// (troco). Puro: nenhum componente montado.
import {
  type EstadoDaVenda,
  type ItemDoCupom,
  estadoInicialDaVenda,
  lerRascunho,
  podeIrPara,
  reducerDaVenda,
  serializarRascunho,
  subtotalDaVenda,
  totalDaVenda,
  trocoDaVenda,
  vendaPodeSerRegistrada,
} from "@/hooks/useVendaPresencial";
import { rotuloDaFormaDoPedido } from "@/lib/forma-de-pagamento";
import {
  desvioDoRelogio,
  formatarContagem,
  restanteMs,
  situacaoDaLinha,
} from "@/lib/pix-do-balcao";
import { describe, expect, it } from "vitest";

function item(preco: number, quantidade = 1, id = "p1"): ItemDoCupom {
  return {
    chave: `${id}::`,
    productId: id,
    variantId: null,
    nome: "Peça",
    variacao: null,
    preco,
    quantidade,
    estoque: 99,
    imagem: "",
  };
}

function comItens(...itens: ItemDoCupom[]): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-do-cupom"),
    itens,
    etapa: "fechamento",
  };
}

function abrirPix(estado: EstadoDaVenda): EstadoDaVenda {
  let e = reducerDaVenda(estado, {
    tipo: "pagamento_escolhido",
    pagamento: "pix_qr",
  });
  e = reducerDaVenda(e, { tipo: "pix_preparado", chave: "chave-do-pix" });
  return reducerDaVenda(e, { tipo: "pix_aberto", orderId: "pedido-1" });
}

describe("PIX com QR na máquina do caixa", () => {
  it("a chave do PIX é própria: nasce no preparo, não é a do cupom, e sobrevive a um segundo preparo", () => {
    let e = reducerDaVenda(comItens(item(10)), {
      tipo: "pix_preparado",
      chave: "chave-do-pix",
    });
    expect(e.pix).toEqual({ chave: "chave-do-pix", orderId: null });
    expect(e.chaveDeIdempotencia).toBe("chave-do-cupom");
    expect(e.enviando).toBe(true);
    e = reducerDaVenda(
      { ...e, enviando: false },
      { tipo: "pix_preparado", chave: "outra" },
    );
    expect(e.pix?.chave).toBe("chave-do-pix");
  });

  it("aberto: vai para a camada 'pix' e o cupom fica SÓ DE LEITURA", () => {
    const aberto = abrirPix(comItens(item(10)));
    expect(aberto.etapa).toBe("pix");
    expect(aberto.pix).toEqual({ chave: "chave-do-pix", orderId: "pedido-1" });
    for (const acao of [
      { tipo: "item_removido", chave: "p1::" },
      { tipo: "quantidade_alterada", chave: "p1::", delta: 1 },
      { tipo: "desconto_alterado", valor: 5, motivo: "x" },
      { tipo: "pagamento_escolhido", pagamento: "cash" },
      {
        tipo: "cliente_definido",
        cliente: { tipo: "avulso", nome: "A", whatsapp: "1" },
      },
      { tipo: "item_adicionado_manualmente", item: item(3, 1, "p2"), em: 1 },
    ] as const) {
      expect(reducerDaVenda(aberto, acao as any)).toBe(aberto);
    }
  });

  it("com o PIX aberto, o Voltar não sai da camada (só cancelar ou pagar)", () => {
    const aberto = abrirPix(comItens(item(10)));
    expect(podeIrPara(aberto, "cupom")).toBe(false);
    expect(podeIrPara(aberto, "fechamento")).toBe(false);
    expect(
      reducerDaVenda(aberto, { tipo: "etapa_pedida", etapa: "cupom" }),
    ).toBe(aberto);
  });

  it("encerrado: volta ao fechamento com o cupom intacto e a chave do PIX descartada", () => {
    const e = reducerDaVenda(abrirPix(comItens(item(10), item(5, 2, "p2"))), {
      tipo: "pix_encerrado",
    });
    expect(e.etapa).toBe("fechamento");
    expect(e.itens).toHaveLength(2);
    expect(e.pix).toBeNull();
    expect(e.chaveDeIdempotencia).toBe("chave-do-cupom");
  });

  it("cupom limpo zera o PIX e a conferência", () => {
    const e = reducerDaVenda(abrirPix(comItens(item(10))), {
      tipo: "cupom_limpo",
      novaChave: "nova",
    });
    expect(e.pix).toBeNull();
    expect(e.pagamentoConferido).toBe(false);
  });

  it("o rascunho guarda o PIX aberto e um F5 volta para a MESMA camada", () => {
    const aberto = abrirPix(comItens(item(10)));
    const restaurado = lerRascunho(serializarRascunho(aberto));
    expect(restaurado?.etapa).toBe("pix");
    expect(restaurado?.pix).toEqual({
      chave: "chave-do-pix",
      orderId: "pedido-1",
    });
  });

  it("rascunho de ANTES desta versão (sem pix/pagamentoConferido) continua válido", () => {
    const { pix: _p, pagamentoConferido: _c, ...antigo } = comItens(item(10));
    const restaurado = lerRascunho(
      JSON.stringify({ ...antigo, recibo: undefined }),
    );
    expect(restaurado?.pix).toBeNull();
    expect(restaurado?.pagamentoConferido).toBe(false);
  });

  it("rascunho com pix de forma errada é recusado", () => {
    const estado = comItens(item(10));
    expect(
      lerRascunho(JSON.stringify({ ...estado, pix: { chave: 1 } })),
    ).toBeNull();
  });

  it("PIX de total zero não é gerado", () => {
    let e = comItens(item(10));
    e = reducerDaVenda(e, { tipo: "pagamento_escolhido", pagamento: "pix_qr" });
    e = reducerDaVenda(e, {
      tipo: "desconto_alterado",
      valor: 10,
      motivo: "brinde",
    });
    expect(vendaPodeSerRegistrada(e)).toEqual({
      ok: false,
      motivo: "Um PIX precisa de valor maior que zero.",
    });
  });
});

describe("correções da investigação", () => {
  it("A1: 3 × R$ 1,15 com desconto de R$ 3,45 é aceito (conta em centavos)", () => {
    let e = comItens(item(1.15, 3));
    e = reducerDaVenda(e, { tipo: "pagamento_escolhido", pagamento: "cash" });
    e = reducerDaVenda(e, {
      tipo: "desconto_alterado",
      valor: 3.45,
      motivo: "cortesia",
    });
    expect(subtotalDaVenda(e.itens)).toBe(3.45);
    expect(totalDaVenda(e)).toBe(0);
    expect(vendaPodeSerRegistrada(e)).toEqual({ ok: true });
    expect(subtotalDaVenda([item(0.1), item(0.2, 1, "p2")])).toBe(0.3);
  });

  it("A2: zerar o desconto apaga o motivo (não vai parar nas notas do pedido)", () => {
    let e = reducerDaVenda(comItens(item(10)), {
      tipo: "desconto_alterado",
      valor: 2,
      motivo: "cliente antiga",
    });
    expect(e.motivoDoDesconto).toBe("cliente antiga");
    e = reducerDaVenda(e, {
      tipo: "desconto_alterado",
      valor: 0,
      motivo: "cliente antiga",
    });
    expect(e.motivoDoDesconto).toBe("");
  });

  it("B14: PIX na chave e maquininha exigem 'conferi'; trocar a forma zera a conferência", () => {
    let e = reducerDaVenda(comItens(item(10)), {
      tipo: "pagamento_escolhido",
      pagamento: "card",
    });
    expect(vendaPodeSerRegistrada(e).ok).toBe(false);
    e = reducerDaVenda(e, { tipo: "pagamento_conferido", conferido: true });
    expect(vendaPodeSerRegistrada(e)).toEqual({ ok: true });
    e = reducerDaVenda(e, { tipo: "pagamento_escolhido", pagamento: "pix" });
    expect(e.pagamentoConferido).toBe(false);
    expect(vendaPodeSerRegistrada(e).ok).toBe(false);
    e = reducerDaVenda(e, { tipo: "pagamento_escolhido", pagamento: "cash" });
    expect(vendaPodeSerRegistrada(e)).toEqual({ ok: true });
  });

  it("A8: troco em centavos", () => {
    expect(trocoDaVenda(37.9, 50)).toBe(12.1);
    expect(trocoDaVenda(37.9, 30)).toBe(-7.9);
    expect(trocoDaVenda(37.9, null)).toBeNull();
  });

  it("D4: um rótulo só para a forma, com canal", () => {
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "card", canal: "presencial" }),
    ).toBe("Cartão na maquininha");
    expect(rotuloDaFormaDoPedido({ paymentMethod: "card" })).toBe(
      "Cartão na entrega",
    );
    expect(
      rotuloDaFormaDoPedido({
        paymentMethod: "online",
        metodoOnline: "pix",
        canal: "presencial",
      }),
    ).toBe("PIX com QR no balcão");
    expect(rotuloDaFormaDoPedido({ paymentMethod: "whatsapp" })).toBe("Outro");
  });
});

describe("o relógio do PIX é o do servidor", () => {
  const SERVIDOR = "2026-09-28T15:00:00.000Z";
  const servidorMs = Date.parse(SERVIDOR);

  it("aparelho 10 min adiantado não encurta o prazo", () => {
    const agoraLocal = servidorMs + 10 * 60_000;
    const desvio = desvioDoRelogio(SERVIDOR, agoraLocal);
    expect(restanteMs("2026-09-28T15:30:00.000Z", agoraLocal, desvio)).toBe(
      30 * 60_000,
    );
  });

  it("contagem mm:ss e nunca negativa", () => {
    expect(formatarContagem(29 * 60_000 + 14_000)).toBe("29:14");
    expect(formatarContagem(0)).toBe("00:00");
    expect(restanteMs("2026-09-28T14:00:00.000Z", servidorMs, 0)).toBe(0);
    expect(restanteMs(null, servidorMs, 0)).toBeNull();
  });

  it("situação da linha: banco manda; prazo pelo relógio do servidor", () => {
    const vivo = {
      payment_status: "aguardando",
      status: "pending",
      expires_at: "2026-09-28T15:10:00Z",
    };
    expect(situacaoDaLinha(vivo, servidorMs)).toBe("aguardando");
    expect(situacaoDaLinha(vivo, servidorMs + 11 * 60_000)).toBe("expirado");
    expect(
      situacaoDaLinha(
        { ...vivo, payment_status: "pago", status: "delivered" },
        servidorMs,
      ),
    ).toBe("pago");
    expect(situacaoDaLinha({ ...vivo, status: "cancelled" }, servidorMs)).toBe(
      "cancelado",
    );
    expect(
      situacaoDaLinha(
        { ...vivo, payment_status: "pago_apos_expirar", status: "cancelled" },
        servidorMs,
      ),
    ).toBe("pago_fora_do_prazo");
  });
});
