// Balcão — o estoque que a busca manual traz vale pela IDADE da leitura.
//
// O defeito: o caixa A tem 1 caneca no cupom (estoque 1, lido pelo bipe). Em
// outro aparelho a lojista repõe o estoque para 5. O caixa A faz uma busca NOVA
// (mostra 5) e adiciona outra caneca — mas o teto guardado continuava 1
// (`Math.min(antigo, novo)`), e a venda de 2 canecas (R$ 60) não saía. Bipar de
// novo já atualizava o teto; a busca manual não.
//
// A regra: cada estoque carrega o instante em que foi LIDO (`estoqueLidoEm`).
//   · leitura MAIS NOVA que a do item no cupom → SUBSTITUI o teto (pode subir);
//   · leitura mais antiga, do mesmo instante ou de instante desconhecido →
//     o MENOR dos dois (a lista velha que ficou na tela nunca derruba o freio).
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type OpcaoDeVariacao,
  type RespostaDoCodigo,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  lerRascunho,
  reducerDaVenda,
  serializarRascunho,
  subtotalDaVenda,
} from "@/hooks/useVendaPresencial";

const CHAVE = chaveDoItemDoCupom("prod-caneca", null);

function itemDaLista(estoque: number, lidoEm: number | undefined): ItemDoCupom {
  return {
    chave: CHAVE,
    productId: "prod-caneca",
    variantId: null,
    nome: "Caneca Personalizada",
    variacao: null,
    preco: 30,
    quantidade: 1,
    estoque,
    imagem: "",
    ...(lidoEm === undefined ? {} : { estoqueLidoEm: lidoEm }),
  };
}

function respostaDoBipe(estoque: number): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "produto",
    codigo: "7899999999999",
    produto: {
      id: "prod-caneca",
      nome: "Caneca Personalizada",
      ativo: true,
      preco_venda: 30,
      estoque,
      imagem: null,
      codigo_barras: "7899999999999",
      tem_variantes: false,
    },
    variante: null,
    preco: 30,
    estoque,
    variacoes: [],
  };
}

/** O caixa A: uma caneca bipada, o servidor dizia `estoque`, lida em `em`. */
function comUmBipe(estoque: number, em: number): EstadoDaVenda {
  return reducerDaVenda(
    estadoInicialDaVenda(() => "k"),
    {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaDoBipe(estoque),
      em,
      deTeclado: true,
    },
  );
}

function adicionarDaBusca(
  estado: EstadoDaVenda,
  estoque: number,
  lidoEm: number | undefined,
  em: number,
): EstadoDaVenda {
  return reducerDaVenda(estado, {
    tipo: "item_adicionado_manualmente",
    item: itemDaLista(estoque, lidoEm),
    em,
  });
}

describe("reposição em outro aparelho: a busca NOVA sobe o teto do estoque", () => {
  it("(d) cupom com 1 caneca (estoque 1); busca NOVA mostra 5: a 2ª caneca entra e o teto passa a 5", () => {
    let estado = comUmBipe(1, 1_000);
    expect(estado.itens[0].estoque).toBe(1);

    // reposição em B; A refaz a busca depois do bipe (lida em 2_000)
    estado = adicionarDaBusca(estado, 5, 2_000, 2_500);

    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.itens[0].estoque).toBe(5);
    expect(estado.aviso).toBeNull();
    expect(subtotalDaVenda(estado.itens)).toBe(60);

    // e o "+" respeita o teto NOVO, não o velho
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave: CHAVE,
      delta: 1,
    });
    expect(estado.itens[0].quantidade).toBe(3);
    expect(estado.aviso).toBeNull();
  });

  it("(d) o teto novo guarda o instante da leitura que o trouxe", () => {
    let estado = comUmBipe(1, 1_000);
    estado = adicionarDaBusca(estado, 5, 2_000, 2_500);
    expect(estado.itens[0].estoqueLidoEm).toBe(2_000);
  });

  it("(d) a mesma busca nova, que ainda NÃO cabe: o aviso mostra o estoque NOVO (não o velho)", () => {
    let estado = comUmBipe(1, 1_000);
    estado = adicionarDaBusca(estado, 5, 2_000, 2_100); // 2 canecas, teto 5
    estado = adicionarDaBusca(estado, 5, 2_000, 2_200); // 3
    estado = adicionarDaBusca(estado, 5, 2_000, 2_300); // 4
    estado = adicionarDaBusca(estado, 5, 2_000, 2_400); // 5
    estado = adicionarDaBusca(estado, 5, 2_000, 2_500); // 6 > 5: barra
    expect(estado.itens[0].quantidade).toBe(5);
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Caneca Personalizada",
      estoque: 5,
      naVenda: 5,
    });
  });

  it("(d) busca nova que mostra estoque MENOR também vale (a leitura mais nova manda, para baixo também)", () => {
    let estado = comUmBipe(5, 1_000);
    estado = adicionarDaBusca(estado, 5, 1_500, 1_600); // 2 canecas, teto 5
    expect(estado.itens[0].quantidade).toBe(2);

    // outro aparelho vendeu 3: a leitura de 2_000 diz que só há 2 no total
    estado = adicionarDaBusca(estado, 2, 2_000, 2_100);
    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.itens[0].estoque).toBe(2);
    expect(estado.aviso).toMatchObject({ tipo: "esgotado", estoque: 2 });
  });

  it("(d) item que NÃO está no cupom entra como veio, com o instante da leitura", () => {
    const estado = adicionarDaBusca(
      estadoInicialDaVenda(() => "k"),
      4,
      1_000,
      1_100,
    );
    expect(estado.itens[0].estoque).toBe(4);
    expect(estado.itens[0].estoqueLidoEm).toBe(1_000);
  });
});

describe("a lista ANTIGA continua sem subir o teto", () => {
  it("(d) lista lida ANTES do bipe (estoque 3) não sobe o teto 1, mesmo clicada depois", () => {
    let estado = comUmBipe(1, 1_000);
    estado = adicionarDaBusca(estado, 3, 500, 5_000);
    expect(estado.itens[0].quantidade).toBe(1);
    expect(estado.itens[0].estoque).toBe(1);
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Caneca Personalizada",
      estoque: 1,
      naVenda: 1,
    });
  });

  it("(d) lista lida no MESMO instante do bipe (mesma geração): vale o menor", () => {
    let estado = comUmBipe(2, 1_000);
    estado = adicionarDaBusca(estado, 6, 1_000, 1_100);
    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.itens[0].estoque).toBe(2);
  });

  it("(d) lista sem instante conhecido: vale o menor (o caso de sempre)", () => {
    let estado = comUmBipe(1, 1_000);
    estado = adicionarDaBusca(estado, 9, undefined, 5_000);
    expect(estado.itens[0].quantidade).toBe(1);
    expect(estado.itens[0].estoque).toBe(1);
  });

  it("(d) item do cupom SEM instante conhecido (rascunho antigo): lista nova NÃO sobe o teto", () => {
    const antigo: EstadoDaVenda = {
      ...estadoInicialDaVenda(() => "k"),
      itens: [{ ...itemDaLista(1, undefined), quantidade: 1 }],
    };
    const estado = adicionarDaBusca(antigo, 5, 9_000, 9_100);
    expect(estado.itens[0].quantidade).toBe(1);
    expect(estado.itens[0].estoque).toBe(1);
  });

  it("(d) 2 listas: a mais nova entrou; a mais velha, clicada depois, não desfaz nem sobe", () => {
    let estado = comUmBipe(1, 1_000);
    estado = adicionarDaBusca(estado, 4, 3_000, 3_100); // lista nova: 2 canecas, teto 4
    expect(estado.itens[0].estoque).toBe(4);
    // a lista de 2_000 (estoque 9, mais velha que a de 3_000) ainda está na tela
    estado = adicionarDaBusca(estado, 9, 2_000, 3_200);
    expect(estado.itens[0].quantidade).toBe(3);
    expect(estado.itens[0].estoque).toBe(4);
    expect(estado.itens[0].estoqueLidoEm).toBe(3_000);
  });

  it("(d) mínimo mantém o instante do item do cupom (a lista velha não rejuvenesce nem envelhece o teto)", () => {
    let estado = comUmBipe(5, 1_000);
    estado = adicionarDaBusca(estado, 3, 500, 1_100); // velha e menor: teto 3
    expect(estado.itens[0].estoque).toBe(3);
    expect(estado.itens[0].estoqueLidoEm).toBe(1_000);
    // uma lista de 800 (também velha) com 9 não sobe
    estado = adicionarDaBusca(estado, 9, 800, 1_200);
    expect(estado.itens[0].estoque).toBe(3);
  });
});

describe("o bipe e a escolha de variação registram o instante do estoque", () => {
  it("bipe: o item entra com `estoqueLidoEm` = o instante da resposta", () => {
    expect(comUmBipe(3, 1_234).itens[0].estoqueLidoEm).toBe(1_234);
  });

  it("bipe de novo: o teto sobe e o instante acompanha", () => {
    let estado = comUmBipe(1, 1_000);
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaDoBipe(4),
      em: 5_000,
      deTeclado: true,
    });
    expect(estado.itens[0].quantidade).toBe(2);
    expect(estado.itens[0].estoque).toBe(4);
    expect(estado.itens[0].estoqueLidoEm).toBe(5_000);
  });

  it("bipe que estoura o teto atualiza estoque E instante do item que já estava", () => {
    let estado = comUmBipe(1, 1_000);
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaDoBipe(1),
      em: 5_000,
      deTeclado: true,
    });
    expect(estado.itens[0].quantidade).toBe(1);
    expect(estado.itens[0].estoqueLidoEm).toBe(5_000);
  });

  it("variação escolhida: o item entra com o instante da escolha", () => {
    const opcao: OpcaoDeVariacao = {
      variant_id: "var-azul",
      nome: "Cor",
      valor: "Azul",
      preco: 30,
      estoque: 4,
      imagem: null,
      codigo_barras: null,
    };
    let estado = reducerDaVenda(
      estadoInicialDaVenda(() => "k"),
      {
        tipo: "codigo_resolvido",
        codigo: "7899999999999",
        deTeclado: true,
        em: 100,
        resposta: {
          ...respostaDoBipe(0),
          produto: { ...respostaDoBipe(0).produto!, tem_variantes: true },
          variacoes: [opcao],
        },
      },
    );
    estado = reducerDaVenda(estado, {
      tipo: "variacao_escolhida",
      opcao,
      em: 7_000,
    });
    expect(estado.itens[0].estoqueLidoEm).toBe(7_000);
  });
});

describe("rascunho — o instante do estoque", () => {
  it("vai ao disco e volta junto com o item", () => {
    const estado = comUmBipe(3, 1_234);
    const lido = lerRascunho(serializarRascunho(estado, 2_000), 2_000);
    expect(lido?.itens[0].estoqueLidoEm).toBe(1_234);
  });

  it("rascunho de antes do campo existir continua valendo (instante desconhecido)", () => {
    const estado = comUmBipe(3, 1_234);
    const bruto = JSON.parse(serializarRascunho(estado, 2_000));
    const { estoqueLidoEm: _semInstante, ...itemAntigo } = bruto.itens[0];
    bruto.itens[0] = itemAntigo;
    const lido = lerRascunho(JSON.stringify(bruto), 2_000);
    expect(lido).not.toBeNull();
    expect(lido?.itens[0].estoqueLidoEm).toBeUndefined();
  });

  it("instante torto no disco (texto, NaN) derruba o rascunho em vez de virar teto errado", () => {
    const estado = comUmBipe(3, 1_234);
    for (const torto of ["ontem", null, { a: 1 }, true]) {
      const bruto = JSON.parse(serializarRascunho(estado, 2_000));
      bruto.itens[0].estoqueLidoEm = torto;
      expect(
        lerRascunho(JSON.stringify(bruto), 2_000),
        JSON.stringify(torto),
      ).toBeNull();
    }
  });
});
