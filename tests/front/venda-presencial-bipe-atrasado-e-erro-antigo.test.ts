// Balcão, duas faixas da máquina de estados (pura, roda em `node`):
//
// 1) A resposta de um bipe é uma ida ao servidor SEM prazo. Se ela chega
//    quando a balconista já saiu do cupom (Cliente, Fechamento, Recibo) ou já
//    está numa escolha de variação, a máquina não pode puxar a tela de volta
//    para a folha "Escolher variação" nem trocar a escolha pendente.
// 2) O aviso de erro de uma recusa antiga (`estado.erro`) some quando o cupom
//    muda de verdade (quantidade ou item removido), mas NÃO nos avisos de teto
//    de estoque nem na simples troca de etapa.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type OpcaoDeVariacao,
  type RespostaDoCodigo,
  chaveDoItemDoCupom,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";
import { MENSAGEM_DE_REDE_DA_VENDA } from "@/lib/erro-da-venda-presencial";

const estadoBase = (): EstadoDaVenda =>
  estadoInicialDaVenda(() => "chave-fixa-de-teste");

function opcao(overrides: Partial<OpcaoDeVariacao> = {}): OpcaoDeVariacao {
  return {
    variant_id: "var-m",
    nome: "Tamanho",
    valor: "M",
    preco: 50,
    estoque: 4,
    imagem: null,
    codigo_barras: "789222",
    ...overrides,
  };
}

const respostaDoModeloComVariacoes: RespostaDoCodigo = {
  encontrado: true,
  origem: "produto",
  codigo: "789000",
  produto: {
    id: "prod-camiseta",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 50,
    estoque: 0,
    imagem: "img-camiseta.jpg",
    codigo_barras: "789000",
    tem_variantes: true,
  },
  variante: null,
  preco: null,
  estoque: 0,
  variacoes: [opcao()],
};

const respostaDeProdutoSimples: RespostaDoCodigo = {
  encontrado: true,
  origem: "produto",
  codigo: "789111",
  produto: {
    id: "prod-caneca",
    nome: "Caneca",
    ativo: true,
    preco_venda: 30,
    estoque: 5,
    imagem: "img-caneca.jpg",
    codigo_barras: "789111",
    tem_variantes: false,
  },
  variante: null,
  preco: 30,
  estoque: 5,
  variacoes: [],
};

function itemComTres(): ItemDoCupom {
  return {
    chave: chaveDoItemDoCupom("prod-camiseta", null),
    productId: "prod-camiseta",
    variantId: null,
    nome: "Camiseta Lisa",
    variacao: null,
    preco: 50,
    quantidade: 3,
    estoque: 3,
    imagem: "",
  };
}

describe("bipe que chega atrasado não puxa a tela de volta", () => {
  for (const etapa of ["cliente", "fechamento", "recibo"] as const) {
    it(`na etapa '${etapa}', um modelo com variações NÃO abre a folha de escolha`, () => {
      const estado: EstadoDaVenda = { ...estadoBase(), etapa };
      const depois = reducerDaVenda(estado, {
        tipo: "codigo_resolvido",
        codigo: "789000",
        resposta: respostaDoModeloComVariacoes,
        em: 0,
      });
      expect(depois.etapa).toBe(etapa);
      expect(depois.escolhaDeVariacao).toBeNull();
    });

    it(`na etapa '${etapa}', um produto simples NÃO entra no cupom`, () => {
      const estado: EstadoDaVenda = { ...estadoBase(), etapa };
      const depois = reducerDaVenda(estado, {
        tipo: "codigo_resolvido",
        codigo: "789111",
        resposta: respostaDeProdutoSimples,
        em: 0,
      });
      expect(depois.itens).toEqual(estado.itens);
      expect(depois.etapa).toBe(etapa);
    });
  }

  it("com a escolha de variação já aberta, uma resposta atrasada NÃO troca a escolha pendente", () => {
    const aberto = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "789000",
      resposta: respostaDoModeloComVariacoes,
      em: 0,
    });
    expect(aberto.etapa).toBe("escolha_de_variacao");

    const outroModelo: RespostaDoCodigo = {
      ...respostaDoModeloComVariacoes,
      codigo: "789333",
      produto: {
        ...respostaDoModeloComVariacoes.produto!,
        id: "prod-calca",
        nome: "Calça Jeans",
      },
    };
    const depois = reducerDaVenda(aberto, {
      tipo: "codigo_resolvido",
      codigo: "789333",
      resposta: outroModelo,
      em: 5000,
    });
    expect(depois).toBe(aberto);
    expect(depois.escolhaDeVariacao?.produtoNome).toBe("Camiseta Lisa");
  });

  it("controle: na etapa 'cupom' o modelo com variações continua abrindo a folha", () => {
    const depois = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "789000",
      resposta: respostaDoModeloComVariacoes,
      em: 0,
    });
    expect(depois.etapa).toBe("escolha_de_variacao");
    expect(depois.escolhaDeVariacao?.produtoNome).toBe("Camiseta Lisa");
  });
});

describe("erro de recusa antiga some quando o cupom muda de verdade", () => {
  function estadoComErro(): EstadoDaVenda {
    const comItem: EstadoDaVenda = { ...estadoBase(), itens: [itemComTres()] };
    return reducerDaVenda(comItem, {
      tipo: "envio_falhou",
      mensagem: "Estoque insuficiente",
    });
  }

  it("diminuir a quantidade limpa o erro", () => {
    const antes = estadoComErro();
    expect(antes.erro).toBe("Estoque insuficiente");
    const depois = reducerDaVenda(antes, {
      tipo: "quantidade_alterada",
      chave: antes.itens[0].chave,
      delta: -1,
    });
    expect(depois.itens[0].quantidade).toBe(2);
    expect(depois.erro).toBeNull();
  });

  it("tirar a última unidade (-1 em quantidade 1) limpa o erro", () => {
    const base = estadoComErro();
    const antes: EstadoDaVenda = {
      ...base,
      itens: [{ ...base.itens[0], quantidade: 1 }],
    };
    const depois = reducerDaVenda(antes, {
      tipo: "quantidade_alterada",
      chave: antes.itens[0].chave,
      delta: -1,
    });
    expect(depois.itens).toHaveLength(0);
    expect(depois.erro).toBeNull();
  });

  it("remover o item limpa o erro", () => {
    const antes = estadoComErro();
    const depois = reducerDaVenda(antes, {
      tipo: "item_removido",
      chave: antes.itens[0].chave,
    });
    expect(depois.itens).toHaveLength(0);
    expect(depois.erro).toBeNull();
  });

  it("controle: o aviso de teto de estoque não mexe nos itens e mantém o erro", () => {
    const antes = estadoComErro();
    const depois = reducerDaVenda(antes, {
      tipo: "quantidade_alterada",
      chave: antes.itens[0].chave,
      delta: 1,
    });
    expect(depois.itens[0].quantidade).toBe(3);
    expect(depois.aviso).not.toBeNull();
    expect(depois.erro).toBe("Estoque insuficiente");
  });

  it("controle: só trocar de etapa mantém o erro", () => {
    const antes = estadoComErro();
    const depois = reducerDaVenda(antes, {
      tipo: "etapa_pedida",
      etapa: "cliente",
    });
    expect(depois.erro).toBe("Estoque insuficiente");
  });
});

describe("o erro de rede (a venda pode ter sido gravada) sobrevive a mexer no cupom", () => {
  function estadoComErroDeRede(): EstadoDaVenda {
    const comItem: EstadoDaVenda = { ...estadoBase(), itens: [itemComTres()] };
    return reducerDaVenda(comItem, {
      tipo: "envio_falhou",
      mensagem: MENSAGEM_DE_REDE_DA_VENDA,
    });
  }

  it("diminuir a quantidade mantém o erro e a mesma chave de idempotência", () => {
    const antes = estadoComErroDeRede();
    const depois = reducerDaVenda(antes, {
      tipo: "quantidade_alterada",
      chave: antes.itens[0].chave,
      delta: -1,
    });
    expect(depois.itens[0].quantidade).toBe(2);
    expect(depois.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
    expect(depois.chaveDeIdempotencia).toBe(antes.chaveDeIdempotencia);
  });

  it("tirar a última unidade mantém o erro", () => {
    const base = estadoComErroDeRede();
    const antes: EstadoDaVenda = {
      ...base,
      itens: [{ ...base.itens[0], quantidade: 1 }],
    };
    const depois = reducerDaVenda(antes, {
      tipo: "quantidade_alterada",
      chave: antes.itens[0].chave,
      delta: -1,
    });
    expect(depois.itens).toHaveLength(0);
    expect(depois.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });

  it("remover o item mantém o erro", () => {
    const antes = estadoComErroDeRede();
    const depois = reducerDaVenda(antes, {
      tipo: "item_removido",
      chave: antes.itens[0].chave,
    });
    expect(depois.itens).toHaveLength(0);
    expect(depois.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });

  it("o fluxo do revisor: rede cai, volta ao cupom, tira uma unidade, o aviso continua", () => {
    let estado = estadoComErroDeRede();
    estado = reducerDaVenda(estado, { tipo: "etapa_pedida", etapa: "cupom" });
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave: estado.itens[0].chave,
      delta: -1,
    });
    expect(estado.erro).toBe(MENSAGEM_DE_REDE_DA_VENDA);
  });

  it("o cancelamento de venda ainda limpa o erro (a venda sai de cena de propósito)", () => {
    const depois = reducerDaVenda(estadoComErroDeRede(), {
      tipo: "cupom_limpo",
      novaChave: "chave-nova-de-teste",
    });
    expect(depois.erro).toBeNull();
  });
});
