// Buracos que a caça por mutação achou no reducer do balcão
// (`reducerDaVenda`, `subtotalDaVenda`, `chaveDoItemDoCupom`) — tudo função
// pura, sem tela. Cada teste diz o que a lojista sentiria se quebrasse:
//  · escolher uma combinação na folha entra com UMA unidade;
//  · o nome da variação não sobra com espaço (`" PP"`) quando o nome está vazio;
//  · um bipe bom apaga o aviso antigo (a tarja "não cadastrado" não fica);
//  · o aviso de estoque zerado com a peça já na venda diz "esgotado" puro,
//    sem o "só há 0 em estoque, 2 na venda";
//  · o `+` numa peça cujo estoque caiu a zero diz o mesmo;
//  · tirar a peça A não destrava a janela de repetição da peça B;
//  · a janela de repetição conta do instante do bipe (relógio de verdade,
//    na casa dos trilhões de ms, não 0..1500);
//  · com o envio pendente, NENHUMA das oito edições do cupom entra;
//  · o subtotal é em centavos inteiros (sem 0,30000000000000004);
//  · a chave do item tem o formato gravado nos rascunhos.
import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type OpcaoDeVariacao,
  type RespostaDoCodigo,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
  subtotalDaVenda,
} from "@/hooks/useVendaPresencial";
import { describe, expect, it } from "vitest";

// Instante na escala do relógio de verdade (2026), não um número pequeno.
const T0 = 1_790_000_000_000;

function respostaDeProduto(
  id: string,
  codigo: string,
  estoque: number,
  nome = `Produto ${id}`,
): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "produto",
    codigo,
    produto: {
      id,
      nome,
      ativo: true,
      preco_venda: 10,
      estoque,
      imagem: null,
      codigo_barras: codigo,
      tem_variantes: false,
    },
    variante: null,
    preco: 10,
    estoque,
    variacoes: [],
  };
}

function respostaDeVariante(
  nomeDaVariacao: string,
  valor: string,
): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "variante",
    codigo: "7891000000011",
    produto: {
      id: "prod-camiseta",
      nome: "Camiseta",
      ativo: true,
      preco_venda: 59.9,
      estoque: 0,
      imagem: null,
      codigo_barras: null,
      tem_variantes: true,
    },
    variante: {
      variant_id: "var-pp",
      nome: nomeDaVariacao,
      valor,
      preco: 49.9,
      estoque: 5,
      imagem: null,
      codigo_barras: "7891000000011",
    },
    preco: 49.9,
    estoque: 5,
    variacoes: [],
  };
}

function itemManual(
  chave: string,
  estoque: number,
  quantidade = 1,
): ItemDoCupom {
  return {
    chave,
    productId: chave,
    variantId: null,
    nome: `Item ${chave}`,
    variacao: null,
    preco: 10,
    quantidade,
    estoque,
    imagem: "",
  };
}

const novo = (): EstadoDaVenda => estadoInicialDaVenda(() => "chave-fixa");

function bipar(
  estado: EstadoDaVenda,
  resposta: RespostaDoCodigo,
  em = T0,
  deTeclado = true,
): EstadoDaVenda {
  return reducerDaVenda(estado, {
    tipo: "codigo_resolvido",
    codigo: resposta.codigo,
    resposta,
    em,
    deTeclado,
  });
}

describe("folha de variação: o que entra no cupom", () => {
  const opcao = (
    overrides: Partial<OpcaoDeVariacao> = {},
  ): OpcaoDeVariacao => ({
    variant_id: "var-m",
    nome: "Tamanho",
    valor: "M",
    preco: 39.9,
    estoque: 4,
    imagem: null,
    codigo_barras: null,
    ...overrides,
  });

  function comFolhaAberta(): EstadoDaVenda {
    return {
      ...novo(),
      etapa: "escolha_de_variacao",
      escolhaDeVariacao: {
        codigo: "7898888888888",
        produtoId: "prod-bone",
        produtoNome: "Boné",
        opcoes: [opcao()],
      },
    };
  }

  it("escolher a combinação entra com EXATAMENTE uma unidade", () => {
    const depois = reducerDaVenda(comFolhaAberta(), {
      tipo: "variacao_escolhida",
      opcao: opcao(),
      em: T0,
    });
    expect(depois.itens).toHaveLength(1);
    expect(depois.itens[0]?.quantidade).toBe(1);
    expect(depois.etapa).toBe("cupom");
  });

  it("variação sem nome não deixa espaço sobrando: ' M' vira 'M'", () => {
    const o = opcao({ nome: "", valor: "M" });
    const depois = reducerDaVenda(comFolhaAberta(), {
      tipo: "variacao_escolhida",
      opcao: o,
      em: T0,
    });
    expect(depois.itens[0]?.variacao).toBe("M");
  });
});

describe("bipe de variante: o texto da variação", () => {
  it("nome vazio na variante não deixa espaço sobrando na frente", () => {
    const depois = bipar(novo(), respostaDeVariante("", "PP"));
    expect(depois.itens[0]?.variacao).toBe("PP");
  });

  it("nome e valor juntos, separados por um espaço", () => {
    const depois = bipar(novo(), respostaDeVariante("Tamanho", "PP"));
    expect(depois.itens[0]?.variacao).toBe("Tamanho PP");
  });
});

describe("aviso depois de bipe bom ou de estoque zerado", () => {
  it("bipar o código de um modelo com variações abre a folha E apaga o aviso antigo", () => {
    const comAviso: EstadoDaVenda = {
      ...novo(),
      aviso: { tipo: "nao_cadastrado", codigo: "0000" },
    };
    const modelo: RespostaDoCodigo = {
      ...respostaDeProduto("bone", "7898888888888", 0, "Boné"),
      variacoes: [
        {
          variant_id: "v-preto",
          nome: "Cor",
          valor: "Preto",
          preco: 39.9,
          estoque: 4,
          imagem: null,
          codigo_barras: null,
        },
      ],
    };
    const depois = bipar(comAviso, modelo);
    expect(depois.etapa).toBe("escolha_de_variacao");
    expect(depois.aviso).toBeNull();
  });

  it("um bipe bom apaga o aviso que estava aceso", () => {
    const comAviso: EstadoDaVenda = {
      ...novo(),
      aviso: { tipo: "nao_cadastrado", codigo: "0000" },
    };
    const depois = bipar(comAviso, respostaDeProduto("p1", "7891", 3));
    expect(depois.itens).toHaveLength(1);
    expect(depois.aviso).toBeNull();
  });

  it("busca manual de peça JÁ na venda cujo estoque da lista é ZERO: 'esgotado' puro, sem número", () => {
    const comItem: EstadoDaVenda = {
      ...novo(),
      itens: [{ ...itemManual("p1::", 3), quantidade: 1 }],
    };
    const depois = reducerDaVenda(comItem, {
      tipo: "item_adicionado_manualmente",
      item: itemManual("p1::", 0),
      em: T0,
    });
    expect(depois.itens[0]?.quantidade).toBe(1);
    expect(depois.aviso).toEqual({ tipo: "esgotado", nome: "Item p1::" });
  });

  it("'+' numa peça cujo estoque caiu a zero: 'esgotado' puro, sem número", () => {
    const comItem: EstadoDaVenda = {
      ...novo(),
      itens: [itemManual("p1::", 0, 1)],
    };
    const depois = reducerDaVenda(comItem, {
      tipo: "quantidade_alterada",
      chave: "p1::",
      delta: 1,
    });
    expect(depois.itens[0]?.quantidade).toBe(1);
    expect(depois.aviso).toEqual({ tipo: "esgotado", nome: "Item p1::" });
  });

  it("'+' numa peça com estoque 2 e 2 na venda: avisa os números", () => {
    const comItem: EstadoDaVenda = {
      ...novo(),
      itens: [itemManual("p1::", 2, 2)],
    };
    const depois = reducerDaVenda(comItem, {
      tipo: "quantidade_alterada",
      chave: "p1::",
      delta: 1,
    });
    expect(depois.aviso).toEqual({
      tipo: "esgotado",
      nome: "Item p1::",
      estoque: 2,
      naVenda: 2,
    });
  });
});

describe("janela de repetição da câmera", () => {
  it("tirar a peça A NÃO destrava a repetição da peça B (a última a entrar)", () => {
    let estado = novo();
    estado = bipar(estado, respostaDeProduto("a", "1111", 5), T0, true);
    estado = bipar(estado, respostaDeProduto("b", "2222", 5), T0 + 200, true);
    estado = reducerDaVenda(estado, { tipo: "item_removido", chave: "a::" });
    expect(estado.itens.map((i) => i.chave)).toEqual(["b::"]);

    // A câmera ainda vê o código de B parado: continua sendo ignorado.
    const depois = bipar(
      estado,
      respostaDeProduto("b", "2222", 5),
      T0 + 500,
      false,
    );
    expect(depois.itens[0]?.quantidade).toBe(1);
    expect(depois.aviso).toEqual({ tipo: "ignorado_repetido", codigo: "2222" });
  });

  it("'−' que remove a peça A também não destrava a repetição da peça B", () => {
    let estado = novo();
    estado = bipar(estado, respostaDeProduto("a", "1111", 5), T0, true);
    estado = bipar(estado, respostaDeProduto("b", "2222", 5), T0 + 200, true);
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave: "a::",
      delta: -1,
    });
    const depois = bipar(
      estado,
      respostaDeProduto("b", "2222", 5),
      T0 + 500,
      false,
    );
    expect(depois.itens[0]?.quantidade).toBe(1);
    expect(depois.aviso).toEqual({ tipo: "ignorado_repetido", codigo: "2222" });
  });

  it("a janela conta do instante REAL do bipe: a câmera repetindo 300 ms depois é ignorada", () => {
    const depois1 = bipar(novo(), respostaDeProduto("a", "1111", 5), T0, false);
    expect(depois1.ultimaEntrada).toEqual({
      chave: "a::",
      codigo: "1111",
      em: T0,
    });
    const depois2 = bipar(
      depois1,
      respostaDeProduto("a", "1111", 5),
      T0 + 300,
      false,
    );
    expect(depois2.itens[0]?.quantidade).toBe(1);
    expect(depois2.aviso).toEqual({
      tipo: "ignorado_repetido",
      codigo: "1111",
    });
  });
});

describe("com o envio pendente, nenhuma edição do cupom entra", () => {
  const enviando = (): EstadoDaVenda => ({
    ...novo(),
    enviando: true,
    itens: [itemManual("p1::", 5, 1)],
  });

  it.each([
    [
      "codigo_resolvido",
      () => ({
        tipo: "codigo_resolvido" as const,
        codigo: "9999",
        resposta: respostaDeProduto("z", "9999", 5),
        em: T0,
        deTeclado: true,
      }),
    ],
    [
      "variacao_escolhida",
      () => ({
        tipo: "variacao_escolhida" as const,
        opcao: {
          variant_id: "v",
          nome: "Cor",
          valor: "Azul",
          preco: 1,
          estoque: 3,
          imagem: null,
          codigo_barras: null,
        },
        em: T0,
      }),
    ],
    [
      "item_adicionado_manualmente",
      () => ({
        tipo: "item_adicionado_manualmente" as const,
        item: itemManual("z::", 5),
        em: T0,
      }),
    ],
    [
      "quantidade_alterada",
      () => ({
        tipo: "quantidade_alterada" as const,
        chave: "p1::",
        delta: 1 as const,
      }),
    ],
    [
      "item_removido",
      () => ({ tipo: "item_removido" as const, chave: "p1::" }),
    ],
    [
      "cliente_definido",
      () => ({
        tipo: "cliente_definido" as const,
        cliente: { tipo: "avulso" as const, nome: "Ana", whatsapp: "1199" },
      }),
    ],
    [
      "pagamento_escolhido",
      () => ({
        tipo: "pagamento_escolhido" as const,
        pagamento: "pix" as const,
      }),
    ],
    [
      "desconto_alterado",
      () => ({
        tipo: "desconto_alterado" as const,
        valor: 2,
        motivo: "cliente antigo",
      }),
    ],
  ])("%s é barrada e devolve o MESMO estado", (_nome, acao) => {
    const antes = {
      ...enviando(),
      // A variação só tem o que escolher se a folha está aberta.
      escolhaDeVariacao: {
        codigo: "c",
        produtoId: "prod",
        produtoNome: "Boné",
        opcoes: [],
      },
    };
    const depois = reducerDaVenda(antes, acao());
    expect(depois).toBe(antes);
  });

  it("o contraste: sem o envio pendente a mesma edição entra", () => {
    const livre: EstadoDaVenda = { ...enviando(), enviando: false };
    const depois = reducerDaVenda(livre, {
      tipo: "item_removido",
      chave: "p1::",
    });
    expect(depois.itens).toEqual([]);
  });
});

describe("subtotal em centavos e chave do item", () => {
  it("0,10 × 3 dá exatamente 0,3 e 1,15 × 1 dá exatamente 1,15", () => {
    expect(
      subtotalDaVenda(
        [itemManual("a", 9, 3)].map((i) => ({ ...i, preco: 0.1 })),
      ),
    ).toBe(0.3);
    expect(subtotalDaVenda([{ ...itemManual("a", 9, 1), preco: 1.15 }])).toBe(
      1.15,
    );
    expect(subtotalDaVenda([{ ...itemManual("a", 9, 3), preco: 19.9 }])).toBe(
      59.7,
    );
  });

  it("a chave do item sem variação termina em '::' e a da variação leva o id", () => {
    expect(chaveDoItemDoCupom("prod-1", null)).toBe("prod-1::");
    expect(chaveDoItemDoCupom("prod-1", "var-9")).toBe("prod-1::var-9");
  });
});
