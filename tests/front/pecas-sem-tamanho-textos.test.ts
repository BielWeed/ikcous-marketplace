import {
  contarPorProduto,
  lerPecasSemTamanho,
  lerResolucao,
  mensagemDoErroAoResolver,
  textoDoAviso,
  textoDoDescarte,
  textoDoSelo,
  textoDoSucesso,
  textoJaResolvida,
} from "@/lib/pecas-sem-tamanho";
import { PrazoEsgotado } from "@/utils/com-prazo";
import { describe, expect, it } from "vitest";

// Ids inventados (repositorio publico): o numero do pedido sao os 6 ultimos.
const PEDIDO_A = "00000000-0000-4000-8000-00000000a1b2";
const PEDIDO_B = "00000000-0000-4000-8000-00000000c3d4";
const PEDIDO_C = "00000000-0000-4000-8000-00000000e5f6";
const PEDIDO_D = "00000000-0000-4000-8000-0000000017aa";

function linha(id: string, order: string | null, produto = "p-1") {
  return {
    id,
    produto_id: produto,
    order_id: order,
    origem: "pedido_desfeito",
    criada_em: "2026-11-27T12:00:00+00:00",
  };
}

describe("lerPecasSemTamanho", () => {
  it("le as linhas da RPC", () => {
    expect(lerPecasSemTamanho([linha("x-1", PEDIDO_A)])).toEqual([
      {
        id: "x-1",
        produtoId: "p-1",
        orderId: PEDIDO_A,
        origem: "pedido_desfeito",
        criadaEm: "2026-11-27T12:00:00+00:00",
      },
    ]);
  });

  it("lista vazia e' lista vazia; forma torta e' null (nao sei)", () => {
    expect(lerPecasSemTamanho([])).toEqual([]);
    expect(lerPecasSemTamanho(null)).toBeNull();
    expect(lerPecasSemTamanho({})).toBeNull();
    expect(lerPecasSemTamanho([{ id: 1 }])).toBeNull();
    expect(
      lerPecasSemTamanho([{ ...linha("x", null), produto_id: null }]),
    ).toBeNull();
  });
});

describe("contarPorProduto", () => {
  it("conta uma por linha, por produto", () => {
    const pecas = lerPecasSemTamanho([
      linha("a", PEDIDO_A, "p-1"),
      linha("b", PEDIDO_A, "p-1"),
      linha("c", PEDIDO_B, "p-2"),
    ])!;
    const contagem = contarPorProduto(pecas);
    expect(contagem.get("p-1")).toBe(2);
    expect(contagem.get("p-2")).toBe(1);
    expect(contagem.get("p-3")).toBeUndefined();
  });
});

describe("textos", () => {
  it("selo da lista: singular e plural", () => {
    expect(textoDoSelo(1)).toBe("1 peça sem tamanho");
    expect(textoDoSelo(3)).toBe("3 peças sem tamanho");
  });

  it("uma peca: cita o pedido e pergunta o tamanho", () => {
    const pecas = lerPecasSemTamanho([linha("a", PEDIDO_A)])!;
    expect(textoDoAviso(pecas)).toEqual({
      titulo:
        "1 peça deste produto voltou sem tamanho (pedido #00A1B2, vendido antes de você criar os tamanhos). Ela não está à venda.",
      pergunta: "Em qual tamanho ela entra?",
    });
  });

  it("uma peca de pedido que sumiu: sem numero, sem inventar", () => {
    const pecas = lerPecasSemTamanho([linha("a", null)])!;
    expect(textoDoAviso(pecas).titulo).toBe(
      "1 peça deste produto voltou sem tamanho (vendida antes de você criar os tamanhos). Ela não está à venda.",
    );
  });

  it("varias pecas do mesmo pedido: o pedido aparece uma vez", () => {
    const pecas = lerPecasSemTamanho([
      linha("a", PEDIDO_A),
      linha("b", PEDIDO_A),
    ])!;
    expect(textoDoAviso(pecas)).toEqual({
      titulo:
        "2 peças deste produto voltaram sem tamanho (pedido #00A1B2, vendido antes de você criar os tamanhos). Elas não estão à venda.",
      pergunta: "Em qual tamanho entra a do pedido #00A1B2?",
    });
  });

  it("varias pecas de pedidos diferentes: lista ate 3 e resume o resto", () => {
    const duas = lerPecasSemTamanho([
      linha("a", PEDIDO_A),
      linha("b", PEDIDO_B),
    ])!;
    expect(textoDoAviso(duas).titulo).toContain(
      "(pedidos #00A1B2 e #00C3D4, vendidos antes de você criar os tamanhos)",
    );
    const quatro = lerPecasSemTamanho([
      linha("a", PEDIDO_A),
      linha("b", PEDIDO_B),
      linha("c", PEDIDO_C),
      linha("d", PEDIDO_D),
    ])!;
    expect(textoDoAviso(quatro).titulo).toBe(
      "4 peças deste produto voltaram sem tamanho (pedidos #00A1B2, #00C3D4, #00E5F6 e mais 1, vendidos antes de você criar os tamanhos). Elas não estão à venda.",
    );
  });

  it("a primeira peca sem pedido: pergunta pela primeira", () => {
    const pecas = lerPecasSemTamanho([linha("a", null), linha("b", PEDIDO_A)])!;
    expect(textoDoAviso(pecas).pergunta).toBe(
      "Em qual tamanho entra a primeira delas?",
    );
  });

  it("sucesso e descarte", () => {
    expect(textoDoSucesso("M")).toBe(
      "Peça somada ao tamanho M. Já está à venda.",
    );
    expect(textoDoDescarte()).toBe(
      "Pronto: a peça saiu do aviso e o estoque não mudou.",
    );
    expect(textoJaResolvida()).toBe(
      "Essa peça já tinha sido decidida em outra aba ou aparelho. Nada foi somado agora.",
    );
  });
});

describe("lerResolucao", () => {
  it("le a resposta da RPC", () => {
    expect(
      lerResolucao({
        id: "a",
        resolucao: "reposta",
        variant_id: "v-m",
        ja_resolvida: false,
        estoque_da_variacao: 4,
        pendentes: 1,
      }),
    ).toEqual({
      id: "a",
      resolucao: "reposta",
      variantId: "v-m",
      jaResolvida: false,
      pendentes: 1,
    });
    expect(
      lerResolucao({
        id: "a",
        resolucao: "descartada",
        variant_id: null,
        ja_resolvida: true,
        pendentes: 0,
      }),
    ).toMatchObject({
      resolucao: "descartada",
      variantId: null,
      jaResolvida: true,
    });
  });

  it("forma torta e' null", () => {
    expect(lerResolucao(null)).toBeNull();
    expect(lerResolucao({ id: "a", resolucao: "outra" })).toBeNull();
    expect(
      lerResolucao({ id: "a", resolucao: "reposta", pendentes: "1" }),
    ).toBeNull();
  });
});

describe("mensagemDoErroAoResolver", () => {
  it("o 22023 do banco ja vem escrito para a lojista", () => {
    expect(
      mensagemDoErroAoResolver({
        code: "22023",
        message:
          "Esse tamanho está desligado. Ligue o tamanho ou escolha outro.",
      }),
    ).toBe("Esse tamanho está desligado. Ligue o tamanho ou escolha outro.");
  });

  it("permissao, peca que sumiu, prazo e o resto", () => {
    expect(mensagemDoErroAoResolver({ code: "42501" })).toBe(
      "Sua conta não tem permissão para mexer no estoque desta loja.",
    );
    expect(mensagemDoErroAoResolver({ code: "P0002" })).toBe(
      "Essa peça não está mais no aviso. Atualizei a lista.",
    );
    expect(mensagemDoErroAoResolver(new PrazoEsgotado(15_000))).toBe(
      "Não tive resposta. Confira a conexão e toque de novo: tocar duas vezes não soma a peça duas vezes.",
    );
    expect(mensagemDoErroAoResolver(new Error("rede"))).toBe(
      "Não consegui salvar a escolha. Tente de novo.",
    );
    expect(mensagemDoErroAoResolver({ code: "22023" })).toBe(
      "Não consegui salvar a escolha. Tente de novo.",
    );
  });
});
