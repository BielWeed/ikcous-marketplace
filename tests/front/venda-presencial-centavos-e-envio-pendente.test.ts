// Máquina pura do caixa de balcão: (1) a conta fecha em centavos, (2) com o
// envio pendente o cupom não aceita edição.
import { describe, expect, it } from "vitest";

import {
  type ItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  subtotalDaVenda,
  totalDaVenda,
  vendaPodeSerRegistrada,
} from "@/hooks/useVendaPresencial";

function item(over: Partial<ItemDoCupom> = {}): ItemDoCupom {
  return {
    chave: "p1",
    productId: "p1",
    variantId: null,
    nome: "Camiseta",
    variacao: null,
    preco: 19.9,
    quantidade: 3,
    estoque: 10,
    imagem: "",
    ...over,
  };
}

describe("balcão — a conta fecha em centavos", () => {
  it("3 × R$ 19,90 é exatamente R$ 59,70 e aceita desconto integral", () => {
    const base = estadoInicialDaVenda(() => "k1");
    const estado = {
      ...base,
      itens: [item()],
      pagamento: "cash" as never,
      desconto: 59.7,
      motivoDoDesconto: "cortesia",
    };
    expect(subtotalDaVenda(estado.itens)).toBe(59.7);
    expect(totalDaVenda(estado)).toBe(0);
    expect(vendaPodeSerRegistrada(estado)).toEqual({ ok: true });
  });

  it("desconto de um centavo acima do subtotal continua recusado", () => {
    const base = estadoInicialDaVenda(() => "k1");
    const estado = {
      ...base,
      itens: [item()],
      pagamento: "cash" as never,
      desconto: 59.71,
      motivoDoDesconto: "cortesia",
    };
    expect(vendaPodeSerRegistrada(estado).ok).toBe(false);
  });
});

describe("balcão — com o envio pendente o cupom não muda", () => {
  const enviando = {
    ...estadoInicialDaVenda(() => "k1"),
    itens: [item({ quantidade: 1, preco: 20 })],
    enviando: true,
  };

  it.each([
    { tipo: "quantidade_alterada", chave: "p1", delta: 1 } as const,
    { tipo: "item_removido", chave: "p1" } as const,
    {
      tipo: "item_adicionado_manualmente",
      item: item({ chave: "p2", productId: "p2", quantidade: 1 }),
      em: 1,
    } as const,
    { tipo: "desconto_alterado", valor: 5, motivo: "x" } as const,
    { tipo: "cliente_definido", cliente: { tipo: "sem_cliente" } } as const,
  ])("ignora $tipo", (acao) => {
    expect(reducerDaVenda(enviando, acao)).toBe(enviando);
  });

  it("cupom_limpo e a confirmação do envio continuam passando", () => {
    expect(
      reducerDaVenda(enviando, { tipo: "cupom_limpo", novaChave: "k2" }),
    ).toMatchObject({ enviando: false, itens: [], chaveDeIdempotencia: "k2" });
    expect(
      reducerDaVenda(enviando, { tipo: "envio_falhou", mensagem: "x" }),
    ).toMatchObject({ enviando: false, erro: "x" });
  });

  it("sem envio pendente a edição continua valendo", () => {
    const livre = { ...enviando, enviando: false };
    expect(
      reducerDaVenda(livre, {
        tipo: "quantidade_alterada",
        chave: "p1",
        delta: 1,
      }).itens[0].quantidade,
    ).toBe(2);
  });
});
