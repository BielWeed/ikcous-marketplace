// Tarefa C3.1 (plano 5.3/5.5): a máquina de estados do caixa de balcão é
// PURA — nenhuma peça testada aqui toca `localStorage`, `Date.now()`,
// `crypto` nem `window`. Por isso, apesar da extensão `.tsx` (é o nome que
// o plano fixa, seção 5.5), este arquivo roda no `environment: "node"`
// padrão do vitest.config.ts, sem a diretiva jsdom: não há um componente
// React para montar, só função pura chamada direto.
//
// O relógio é SEMPRE um número passado à mão (nunca `vi.useFakeTimers`),
// molde de tests/front/leitor-de-codigo-buffer-e-debounce.test.ts.
import { describe, expect, it } from "vitest";

import {
  type EstadoDaVenda,
  type ItemDoCupom,
  type OpcaoDeVariacao,
  type RespostaDoCodigo,
  chaveDoItemDoCupom,
  deveIgnorarLeitura,
  estadoInicialDaVenda,
  estoqueEfetivo,
  lerRascunho,
  podeIrPara,
  reducerDaVenda,
  serializarRascunho,
  subtotalDaVenda,
  totalDaVenda,
  vendaPodeSerRegistrada,
} from "@/hooks/useVendaPresencial";
import { JANELA_DE_REPETICAO_MS } from "@/lib/leitor/debounce-de-leitura";

// ============================================================================
// FIXTURES — respostas cruas de `buscar_por_codigo_barras`, nas formas
// medidas na migration 20261161000000 (contexto da tarefa, fato 3).
// ============================================================================

function respostaVariante(
  overrides: Partial<RespostaDoCodigo> = {},
): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "variante",
    codigo: "7891000000011",
    produto: {
      id: "prod-camiseta",
      nome: "Camiseta Estampada",
      ativo: true,
      preco_venda: 59.9,
      estoque: 999, // não deveria ser lido quando origem é variante
      imagem: "img-produto.jpg",
      codigo_barras: "7891000000000",
      tem_variantes: true,
    },
    variante: {
      variant_id: "var-pp",
      nome: "Tamanho",
      valor: "PP",
      preco: 49.9,
      estoque: 5,
      imagem: "img-variante-pp.jpg",
      codigo_barras: "7891000000011",
    },
    preco: 49.9,
    estoque: 5,
    variacoes: [],
    ...overrides,
  };
}

function respostaProdutoSemVariacao(
  overrides: Partial<RespostaDoCodigo> = {},
): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "produto",
    codigo: "7899999999999",
    produto: {
      id: "prod-caneca",
      nome: "Caneca Personalizada",
      ativo: true,
      preco_venda: 29.9,
      estoque: 3,
      imagem: "img-caneca.jpg",
      codigo_barras: "7899999999999",
      tem_variantes: false,
    },
    variante: null,
    preco: 29.9,
    estoque: 3,
    variacoes: [],
    ...overrides,
  };
}

function opcaoDeVariacao(
  overrides: Partial<OpcaoDeVariacao> = {},
): OpcaoDeVariacao {
  return {
    variant_id: "var-preto",
    nome: "Cor",
    valor: "Preto",
    preco: 39.9,
    estoque: 4,
    imagem: "img-bone-preto.jpg",
    codigo_barras: "7898888888801",
    ...overrides,
  };
}

function respostaProdutoComVariacoes(
  overrides: Partial<RespostaDoCodigo> = {},
): RespostaDoCodigo {
  return {
    encontrado: true,
    origem: "produto",
    codigo: "7898888888888",
    produto: {
      id: "prod-bone",
      nome: "Boné Ajustável",
      ativo: true,
      preco_venda: 39.9,
      // PROPOSITALMENTE zero: `p.estoque` da linha do produto não é a soma
      // das variações (armadilha medida na revisão de C1.2) — se a máquina
      // usasse este valor, todo boné apareceria "esgotado".
      estoque: 0,
      imagem: "img-bone.jpg",
      codigo_barras: "7898888888888",
      tem_variantes: true,
    },
    variante: null,
    preco: null,
    estoque: 0,
    variacoes: [
      opcaoDeVariacao({ variant_id: "var-preto", valor: "Preto", estoque: 4 }),
      opcaoDeVariacao({
        variant_id: "var-branco",
        valor: "Branco",
        estoque: 0,
      }),
    ],
    ...overrides,
  };
}

function respostaNaoCadastrada(codigo = "0000000000000"): RespostaDoCodigo {
  return {
    encontrado: false,
    origem: null,
    codigo,
    produto: null,
    variante: null,
    preco: null,
    estoque: null,
    variacoes: [],
  };
}

const estadoBase = (): EstadoDaVenda =>
  estadoInicialDaVenda(() => "chave-fixa-de-teste");

// ============================================================================
// (1) LEITURA REPETIDA — dentro/fora da janela
// ============================================================================

describe("bipe repetido — a guarda é sobre o item JÁ NO CUPOM, não sobre o código decodificado", () => {
  it("bipar o mesmo código de novo, DENTRO da janela, é ignorado e mantém o cupom", () => {
    let estado = estadoBase();
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: 0,
    });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].quantidade).toBe(1);

    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: JANELA_DE_REPETICAO_MS - 1,
    });

    expect(estado.aviso).toEqual({
      tipo: "ignorado_repetido",
      codigo: "7891000000011",
    });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].quantidade).toBe(1); // não somou
  });

  it("bipar o mesmo código de novo, FORA da janela, soma quantidade", () => {
    let estado = estadoBase();
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: 0,
    });
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: JANELA_DE_REPETICAO_MS,
    });

    expect(estado.aviso).toBeNull();
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].quantidade).toBe(2);
  });

  it("deveIgnorarLeitura: verdadeiro só para o MESMO código dentro da janela", () => {
    const estado: EstadoDaVenda = {
      ...estadoBase(),
      ultimaEntrada: { chave: "x", codigo: "111", em: 1000 },
    };
    expect(
      deveIgnorarLeitura(estado, "111", 1000 + JANELA_DE_REPETICAO_MS - 1),
    ).toBe(true);
    expect(
      deveIgnorarLeitura(estado, "111", 1000 + JANELA_DE_REPETICAO_MS),
    ).toBe(false);
    expect(deveIgnorarLeitura(estado, "222", 1000)).toBe(false);
    expect(deveIgnorarLeitura(estadoBase(), "111", 1000)).toBe(false); // sem ultimaEntrada
  });
});

// ============================================================================
// (2) OS TRÊS AVISOS — nenhum entra no cupom
// ============================================================================

describe("código não cadastrado, produto inativo e esgotado — três avisos distintos, cupom sempre vazio", () => {
  it("não cadastrado", () => {
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "0000000000000",
      resposta: respostaNaoCadastrada("0000000000000"),
      em: 0,
    });
    expect(estado.aviso).toEqual({
      tipo: "nao_cadastrado",
      codigo: "0000000000000",
    });
    expect(estado.itens).toHaveLength(0);
  });

  it("produto inativo", () => {
    const resposta = respostaProdutoSemVariacao({
      produto: { ...respostaProdutoSemVariacao().produto!, ativo: false },
    });
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    expect(estado.aviso).toEqual({
      tipo: "inativo",
      nome: "Caneca Personalizada",
    });
    expect(estado.itens).toHaveLength(0);
  });

  it("esgotado — produto SEM variação, estoque zero", () => {
    const resposta = respostaProdutoSemVariacao({ estoque: 0 });
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Caneca Personalizada",
    });
    expect(estado.itens).toHaveLength(0);
  });

  it("esgotado — origem 'produto' COM variações decide pela SOMA de variacoes[].estoque, nunca por resposta.estoque", () => {
    // Fixture com todas as variações zeradas: soma é 0, mesmo que alguém
    // (por engano) lesse `resposta.estoque` (que aqui também é 0 — o teste
    // de estoqueEfetivo abaixo é quem prova a diferença de verdade).
    const resposta = respostaProdutoComVariacoes({
      variacoes: [
        opcaoDeVariacao({ variant_id: "var-preto", estoque: 0 }),
        opcaoDeVariacao({ variant_id: "var-branco", estoque: 0 }),
      ],
    });
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    expect(estado.aviso).toEqual({ tipo: "esgotado", nome: "Boné Ajustável" });
    expect(estado.itens).toHaveLength(0);
  });
});

describe("estoqueEfetivo — a armadilha medida na revisão de C1.2", () => {
  it("origem 'variante' usa resposta.estoque (o stock_increment da variante)", () => {
    expect(estoqueEfetivo(respostaVariante({ estoque: 7 }))).toBe(7);
  });

  it("origem 'produto' SEM variações usa resposta.estoque (p.estoque, correto neste caso)", () => {
    expect(estoqueEfetivo(respostaProdutoSemVariacao({ estoque: 3 }))).toBe(3);
  });

  it("origem 'produto' COM variações soma variacoes[].estoque — NUNCA resposta.estoque", () => {
    // resposta.estoque (p.estoque da linha) é 0 na fixture; a soma real das
    // variações é 4 + 0 = 4. Se a função lesse o campo errado, devolveria 0.
    const resposta = respostaProdutoComVariacoes();
    expect(resposta.estoque).toBe(0);
    expect(estoqueEfetivo(resposta)).toBe(4);
  });

  it("não encontrado é sempre zero", () => {
    expect(estoqueEfetivo(respostaNaoCadastrada())).toBe(0);
  });
});

// ============================================================================
// (3) FOLHA DE VARIAÇÃO — abre, cancela, escolhe; opção esgotada é recusada
// ============================================================================

describe("produto com variações", () => {
  it("bipar o código do modelo abre a folha e NADA entra no cupom ainda", () => {
    const resposta = respostaProdutoComVariacoes();
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    expect(estado.etapa).toBe("escolha_de_variacao");
    expect(estado.escolhaDeVariacao).not.toBeNull();
    expect(estado.escolhaDeVariacao?.opcoes).toHaveLength(2);
    expect(estado.itens).toHaveLength(0);
  });

  it("cancelar a folha volta para 'cupom' sem entrar nada", () => {
    const resposta = respostaProdutoComVariacoes();
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    estado = reducerDaVenda(estado, { tipo: "variacao_cancelada" });
    expect(estado.etapa).toBe("cupom");
    expect(estado.escolhaDeVariacao).toBeNull();
    expect(estado.itens).toHaveLength(0);
  });

  it("escolher uma opção com estoque entra no cupom com o variantId e o nome da variação", () => {
    const resposta = respostaProdutoComVariacoes();
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    const opcaoPreta = opcaoDeVariacao({
      variant_id: "var-preto",
      valor: "Preto",
      estoque: 4,
      preco: 39.9,
    });
    estado = reducerDaVenda(estado, {
      tipo: "variacao_escolhida",
      opcao: opcaoPreta,
      em: 10,
    });

    expect(estado.etapa).toBe("cupom");
    expect(estado.escolhaDeVariacao).toBeNull();
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].variantId).toBe("var-preto");
    expect(estado.itens[0].variacao).toBe("Cor Preto");
    expect(estado.itens[0].preco).toBe(39.9);
    expect(estado.itens[0].productId).toBe("prod-bone");
  });

  it("escolher uma opção ESGOTADA é recusada e a folha continua aberta", () => {
    const resposta = respostaProdutoComVariacoes();
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: resposta.codigo,
      resposta,
      em: 0,
    });
    const opcaoBranca = opcaoDeVariacao({
      variant_id: "var-branco",
      valor: "Branco",
      estoque: 0,
    });
    estado = reducerDaVenda(estado, {
      tipo: "variacao_escolhida",
      opcao: opcaoBranca,
      em: 10,
    });

    expect(estado.aviso).toEqual({ tipo: "esgotado", nome: "Boné Ajustável" });
    expect(estado.etapa).toBe("escolha_de_variacao"); // a folha não fechou
    expect(estado.itens).toHaveLength(0);
  });
});

// ============================================================================
// (4)/(5)/(6) QUANTIDADE — soma no bipe, -/+ manual, remoção no zero, teto do estoque
// ============================================================================

describe("quantidade — soma, -/+, remoção e teto do estoque", () => {
  it("busca manual (item_adicionado_manualmente) soma quantidade pelo mesmo caminho do bipe", () => {
    const item: ItemDoCupom = {
      chave: chaveDoItemDoCupom("prod-x", null),
      productId: "prod-x",
      variantId: null,
      nome: "Produto buscado por nome",
      variacao: null,
      preco: 10,
      quantidade: 1,
      estoque: 5,
      imagem: "img.jpg",
    };
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "item_adicionado_manualmente",
      item,
      em: 0,
    });
    expect(estado.itens[0].quantidade).toBe(1);

    estado = reducerDaVenda(estado, {
      tipo: "item_adicionado_manualmente",
      item,
      em: 1,
    });
    expect(estado.itens).toHaveLength(1);
    expect(estado.itens[0].quantidade).toBe(2);
  });

  it("'+' aumenta a quantidade", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 5 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: 1,
    });
    expect(estado.itens[0].quantidade).toBe(2);
  });

  it("'-' em quantidade > 1 diminui", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 5 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: 1,
    }); // 2
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: -1,
    }); // 1
    expect(estado.itens[0].quantidade).toBe(1);
  });

  it("'-' em quantidade 1 REMOVE o item", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 5 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: -1,
    });
    expect(estado.itens).toHaveLength(0);
  });

  it("depois de estourar o teto (aviso 'esgotado' aceso) e apertar '−', o aviso some — a folga voltou, a tarja não deveria continuar", () => {
    // Achado ANOTADO da rodada de correção: só entrarItemNoCupom zerava
    // `aviso`; quantidade_alterada e item_removido (que TIRAM item) não.
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 1 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    // Estourar o teto (estoque 1, tentando ir para 2): acende o aviso.
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: 1,
    });
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Camiseta Estampada",
    });
    // Apertar "−": volta a caber (quantidade 1 → 0 → remove). O aviso do
    // teto que acabou de passar não faz mais sentido nenhum.
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: -1,
    });
    expect(estado.aviso).toBeNull();
  });

  it("item_removido também limpa o aviso", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 1 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: 1,
    }); // acende o aviso de esgotado
    expect(estado.aviso).not.toBeNull();
    estado = reducerDaVenda(estado, { tipo: "item_removido", chave });
    expect(estado.aviso).toBeNull();
  });

  it("'item_removido' tira o item pela chave", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: 0,
    });
    const chave = estado.itens[0].chave;
    estado = reducerDaVenda(estado, { tipo: "item_removido", chave });
    expect(estado.itens).toHaveLength(0);
  });

  it("item_removido libera a janela de repetição: rebipar o MESMO código logo em seguida não vira 'ignorado_repetido'", () => {
    // Achado ANOTADO da rodada de correção (medido em
    // /tmp/repro/tests/revisao-c31-c.test.ts): `deveIgnorarLeitura` só olha
    // `ultimaEntrada`; se ela continuasse apontando para o item que acabou
    // de sair do cupom, o operador que tira um item por engano e bipa de
    // novo na hora ouviria "já bipei esse" com o item JÁ FORA do cupom.
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaProdutoSemVariacao(),
      em: 0,
    });
    expect(estado.itens).toHaveLength(1);
    const chave = estado.itens[0].chave;

    estado = reducerDaVenda(estado, { tipo: "item_removido", chave });
    expect(estado.itens).toHaveLength(0);
    expect(estado.ultimaEntrada).toBeNull();

    // Rebipa o MESMO código 1s depois (dentro da janela de 1,5s).
    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaProdutoSemVariacao(),
      em: 1000,
    });
    expect(estado.aviso).not.toEqual({
      tipo: "ignorado_repetido",
      codigo: "7899999999999",
    });
    expect(estado.itens).toHaveLength(1);
  });

  it("'-' em quantidade 1 (removendo) também libera a janela de repetição do item removido", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7899999999999",
      resposta: respostaProdutoSemVariacao(),
      em: 0,
    });
    const chave = estado.itens[0].chave;

    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: -1,
    });
    expect(estado.itens).toHaveLength(0);
    expect(estado.ultimaEntrada).toBeNull();
  });

  it("não é possível passar do estoque do item — nem pelo '+', nem somando bipes", () => {
    let estado = reducerDaVenda(estadoBase(), {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante({ estoque: 1 }),
      em: 0,
    });
    const chave = estado.itens[0].chave;

    estado = reducerDaVenda(estado, {
      tipo: "quantidade_alterada",
      chave,
      delta: 1,
    });
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Camiseta Estampada",
    });
    expect(estado.itens[0].quantidade).toBe(1); // não mudou

    // bipar de novo fora da janela também respeita o teto.
    estado = reducerDaVenda(
      { ...estado, aviso: null },
      {
        tipo: "codigo_resolvido",
        codigo: "7891000000011",
        resposta: respostaVariante({ estoque: 1 }),
        em: JANELA_DE_REPETICAO_MS,
      },
    );
    expect(estado.aviso).toEqual({
      tipo: "esgotado",
      nome: "Camiseta Estampada",
    });
    expect(estado.itens[0].quantidade).toBe(1);
  });
});

// ============================================================================
// (7) DESCONTO — negativo, maior que o subtotal, sem motivo, e o caso bom
// ============================================================================

describe("vendaPodeSerRegistrada — as mesmas recusas da RPC, ditas cedo (migration 20261162000000)", () => {
  function estadoComUmItem(): EstadoDaVenda {
    const item: ItemDoCupom = {
      chave: chaveDoItemDoCupom("prod-x", null),
      productId: "prod-x",
      variantId: null,
      nome: "Item",
      variacao: null,
      preco: 100,
      quantidade: 1,
      estoque: 5,
      imagem: "",
    };
    return { ...estadoBase(), itens: [item], pagamento: "cash" };
  }

  it("cupom vazio é recusado", () => {
    const estado = { ...estadoBase(), pagamento: "cash" as const };
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo: "A venda precisa de pelo menos um item.",
    });
  });

  it("sem forma de pagamento é recusado", () => {
    const estado = { ...estadoComUmItem(), pagamento: null };
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo: "Forma de pagamento inválida para venda no balcão.",
    });
  });

  it("desconto negativo é recusado", () => {
    const estado = { ...estadoComUmItem(), desconto: -1 };
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo: "O desconto não pode ser negativo.",
    });
  });

  it("desconto > 0 sem motivo é recusado", () => {
    const estado = { ...estadoComUmItem(), desconto: 10, motivoDoDesconto: "" };
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo: "Informe o motivo do desconto.",
    });
  });

  it("desconto maior que o subtotal é recusado", () => {
    const estado = {
      ...estadoComUmItem(),
      desconto: 200,
      motivoDoDesconto: "erro de digitação",
    };
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo: "O desconto não pode ser maior que o subtotal da venda.",
    });
  });

  it("o caso bom: item, pagamento, desconto válido com motivo", () => {
    const estado = {
      ...estadoComUmItem(),
      desconto: 10,
      motivoDoDesconto: "cliente fidelizado",
    };
    expect(vendaPodeSerRegistrada(estado)).toEqual({ ok: true });
  });

  it("subtotalDaVenda e totalDaVenda", () => {
    const estado = { ...estadoComUmItem(), desconto: 30 };
    expect(subtotalDaVenda(estado.itens)).toBe(100);
    expect(totalDaVenda(estado)).toBe(70);
  });

  it("totalDaVenda nunca fica negativo mesmo com desconto absurdo gravado direto no estado", () => {
    const estado = { ...estadoComUmItem(), desconto: 1000 };
    expect(totalDaVenda(estado)).toBe(0);
  });
});

// ============================================================================
// (8) IDEMPOTÊNCIA — a chave não muda entre ações, e MUDA em cupom_limpo
// ============================================================================

describe("chaveDeIdempotencia", () => {
  it("é gerada uma vez, no estado inicial, e sobrevive a ações do cupom", () => {
    let estado = estadoInicialDaVenda(() => "chave-1");
    const chaveOriginal = estado.chaveDeIdempotencia;

    estado = reducerDaVenda(estado, {
      tipo: "codigo_resolvido",
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: 0,
    });
    expect(estado.chaveDeIdempotencia).toBe(chaveOriginal);

    estado = reducerDaVenda(estado, {
      tipo: "pagamento_escolhido",
      pagamento: "cash",
    });
    expect(estado.chaveDeIdempotencia).toBe(chaveOriginal);
  });

  it("SÓ muda em cupom_limpo, e é o chamador (não o reducer) quem gera a chave nova", () => {
    let estado = estadoInicialDaVenda(() => "chave-1");
    estado = reducerDaVenda(estado, {
      tipo: "cupom_limpo",
      novaChave: "chave-2",
    });
    expect(estado.chaveDeIdempotencia).toBe("chave-2");
    expect(estado.itens).toHaveLength(0);
    expect(estado.cliente).toEqual({ tipo: "sem_cliente" });
    expect(estado.pagamento).toBeNull();
    expect(estado.desconto).toBe(0);
  });

  it("cupom_limpo também desliga 'enviando' — venda nova não pode herdar um envio pendurado da anterior", () => {
    // Achado ANOTADO: envio_iniciado liga `enviando: true`; se a RPC nunca
    // responder (rede caindo, o motivo que a idempotência existe para
    // cobrir) e o balconista desistir com "limpar cupom", `enviando` era o
    // único campo de sessão que sobrevivia — um botão que a tela desabilita
    // por `estado.enviando` ficaria morto no cupom novo.
    let estado = estadoInicialDaVenda(() => "chave-1");
    estado = reducerDaVenda(estado, { tipo: "envio_iniciado" });
    expect(estado.enviando).toBe(true);
    estado = reducerDaVenda(estado, {
      tipo: "cupom_limpo",
      novaChave: "chave-2",
    });
    expect(estado.enviando).toBe(false);
  });
});

// ============================================================================
// (9) RASCUNHO — serializar→ler devolve o mesmo estado; JSON torto vira null
// ============================================================================

describe("rascunho (serializarRascunho / lerRascunho)", () => {
  it("serializar e ler de volta devolve o MESMO estado (menos recibo/enviando/erro, que já nascem no default)", () => {
    const item: ItemDoCupom = {
      chave: chaveDoItemDoCupom("prod-x", "var-y"),
      productId: "prod-x",
      variantId: "var-y",
      nome: "Produto",
      variacao: "Cor Azul",
      preco: 42,
      quantidade: 3,
      estoque: 10,
      imagem: "img.jpg",
    };
    const estado: EstadoDaVenda = {
      ...estadoBase(),
      itens: [item],
      cliente: { tipo: "avulso", nome: "Fulano", whatsapp: "11999998888" },
      pagamento: "pix",
      desconto: 5,
      motivoDoDesconto: "combinado",
      ultimaEntrada: { chave: item.chave, codigo: "123", em: 999 },
    };

    const lido = lerRascunho(serializarRascunho(estado));
    expect(lido).toEqual(estado);
  });

  it("lerRascunho(null) devolve null (sem rascunho gravado)", () => {
    expect(lerRascunho(null)).toBeNull();
  });

  it("JSON quebrado (sintaxe inválida) devolve null e nunca lança", () => {
    expect(() => lerRascunho("{itens: [não é json válido")).not.toThrow();
    expect(lerRascunho("{itens: [não é json válido")).toBeNull();
  });

  it("JSON válido mas com 'itens' que não é array devolve null", () => {
    const torto = JSON.stringify({ ...estadoBase(), itens: "não é um array" });
    expect(lerRascunho(torto)).toBeNull();
  });

  it("JSON válido mas com item sem productId devolve null", () => {
    const torto = JSON.stringify({ ...estadoBase(), itens: [{ chave: "x" }] });
    expect(lerRascunho(torto)).toBeNull();
  });

  it("JSON válido mas com chaveDeIdempotencia que não é string devolve null", () => {
    const torto = JSON.stringify({
      ...estadoBase(),
      chaveDeIdempotencia: 12345,
    });
    expect(lerRascunho(torto)).toBeNull();
  });

  it("rascunho sem 'cliente' (ou com tipo desconhecido) devolve null em vez de envenenar o disco", () => {
    // Ressalva da revisão r3: sem esta guarda, o estado nascia sem cliente,
    // o efeito de gravar/apagar lançava em `estado.cliente.tipo` antes do
    // removeItem, e o rascunho torto ficava em disco quebrando toda abertura.
    const { cliente: _semCliente, ...semCliente } = estadoBase();
    expect(lerRascunho(JSON.stringify(semCliente))).toBeNull();
    expect(
      lerRascunho(JSON.stringify({ ...estadoBase(), cliente: null })),
    ).toBeNull();
    expect(
      lerRascunho(
        JSON.stringify({ ...estadoBase(), cliente: { tipo: "fantasma" } }),
      ),
    ).toBeNull();
  });

  it("item do rascunho com preco/quantidade/estoque que não são números devolve null", () => {
    const itemBase = {
      chave: chaveDoItemDoCupom("prod-1", null),
      productId: "prod-1",
      variantId: null,
      nome: "Caneca",
      variacao: null,
      preco: 10,
      quantidade: 1,
      estoque: 5,
      imagem: "",
    };
    for (const torto of [
      { ...itemBase, preco: "10" },
      { ...itemBase, quantidade: Number.NaN },
      { ...itemBase, estoque: undefined },
    ]) {
      expect(
        lerRascunho(JSON.stringify({ ...estadoBase(), itens: [torto] })),
      ).toBeNull();
    }
  });

  it("lerRascunho rebaixa etapa 'recibo' para 'cupom' quando o recibo não sobrevive ao rascunho", () => {
    // Achado BLOQUEIA da rodada de correção: `podeIrPara` declara
    // etapa==='recibo' com recibo===null impossível, mas `rascunho_restaurado`
    // troca o estado inteiro sem passar pela guarda. Como o rascunho NUNCA
    // guarda `recibo` (serializarRascunho o descarta), qualquer estado
    // serializado com etapa 'recibo' vai voltar do JSON sem recibo — o
    // invariante do módulo não pode depender só do lado que escreve
    // (comentário do achado): é `lerRascunho`, não só quem grava, quem tem
    // de recusar essa combinação.
    const estadoDeUmaVendaFechada: EstadoDaVenda = {
      ...estadoBase(),
      etapa: "recibo",
      itens: [
        {
          chave: chaveDoItemDoCupom("prod-1", null),
          productId: "prod-1",
          variantId: null,
          nome: "Caneca",
          variacao: null,
          preco: 10,
          quantidade: 1,
          estoque: 5,
          imagem: "",
        },
      ],
      recibo: {
        orderId: "ped-1",
        numero: "PED001",
        criadoEm: new Date(0).toISOString(),
        total: 10,
        subtotal: 10,
        desconto: 0,
        pagamento: "cash",
        cliente: { tipo: "sem_cliente" },
        itens: [],
        jaExistia: false,
      },
    };

    const lido = lerRascunho(serializarRascunho(estadoDeUmaVendaFechada));

    expect(lido).not.toBeNull();
    expect(lido?.recibo).toBeNull();
    // A parte que importa: a etapa restaurada é COERENTE com recibo: null,
    // não a etapa 'recibo' congelada no momento em que o rascunho foi
    // gravado (que `podeIrPara` recusaria se passasse pela guarda normal).
    expect(lido?.etapa).toBe("cupom");
  });

  it("lerRascunho rebaixa etapa DESCONHECIDA (fora da união fechada EtapaDaVenda) para 'cupom'", () => {
    // Achado ANOTADO da rodada de correção (medido em
    // /tmp/repro/tests/revisao-c31.test.tsx, caso C): `pareceRascunhoValido`
    // checava só `typeof v.etapa === "string"`, o que aceita QUALQUER
    // string — storage adulterada no devtools do balcão, resíduo de uma
    // versão futura que renomeie uma etapa, ou um deploy que troque o
    // vocabulário produziriam um `EstadoDaVenda` cujo `etapa` não pertence
    // ao tipo declarado, e a tela de C3.2 (que escolhe a camada por
    // `estado.etapa`) não desenharia camada nenhuma.
    const base = estadoInicialDaVenda(() => "K");
    const torto = JSON.stringify({
      ...base,
      etapa: "etapa_que_nao_existe",
    });
    expect(lerRascunho(torto)?.etapa).toBe("cupom");
  });

  it("não guarda recibo/enviando/erro — são de sessão, não da venda", () => {
    const estadoComRecibo: EstadoDaVenda = {
      ...estadoBase(),
      enviando: true,
      erro: "algum erro de sessão",
      recibo: {
        orderId: "abc-123",
        numero: "ABC123",
        criadoEm: new Date(0).toISOString(),
        total: 10,
        subtotal: 10,
        desconto: 0,
        pagamento: "cash",
        cliente: { tipo: "sem_cliente" },
        itens: [],
        jaExistia: false,
      },
    };
    const bruto = serializarRascunho(estadoComRecibo);
    expect(bruto).not.toContain("algum erro de sessão");
    expect(bruto).not.toContain("orderId");

    const lido = lerRascunho(bruto);
    expect(lido?.recibo).toBeNull();
    expect(lido?.enviando).toBe(false);
    expect(lido?.erro).toBeNull();
  });
});

// ============================================================================
// (10) podeIrPara — guardas de etapa
// ============================================================================

describe("podeIrPara e a guarda em 'etapa_pedida'", () => {
  it("fechamento com cupom vazio é recusado", () => {
    expect(podeIrPara(estadoBase(), "fechamento")).toBe(false);
  });

  it("fechamento com item no cupom é permitido", () => {
    const item: ItemDoCupom = {
      chave: chaveDoItemDoCupom("p", null),
      productId: "p",
      variantId: null,
      nome: "x",
      variacao: null,
      preco: 1,
      quantidade: 1,
      estoque: 1,
      imagem: "",
    };
    expect(podeIrPara({ ...estadoBase(), itens: [item] }, "fechamento")).toBe(
      true,
    );
  });

  it("recibo sem recibo preenchido é recusado", () => {
    expect(podeIrPara(estadoBase(), "recibo")).toBe(false);
  });

  it("o reducer respeita a guarda: 'etapa_pedida' para fechamento com cupom vazio não muda a etapa", () => {
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "etapa_pedida",
      etapa: "fechamento",
    });
    expect(estado.etapa).toBe("cupom"); // pedido inválido, devolve o estado como está
  });

  it("'etapa_pedida' para 'cliente' é sempre permitida", () => {
    const estado = reducerDaVenda(estadoBase(), {
      tipo: "etapa_pedida",
      etapa: "cliente",
    });
    expect(estado.etapa).toBe("cliente");
  });

  it("depois de 'venda_registrada', 'etapa_pedida' NÃO tira o estado de 'recibo' — só 'cupom_limpo' sai de lá", () => {
    // Achado ANTES DE CRESCER da rodada de correção (medido em
    // /tmp/repro/tests/revisao-c31.test.tsx, caso B): sem esta guarda, um
    // Voltar/popstate (que despacha 'etapa_pedida') depois da venda
    // registrada devolvia o cupom intacto para a tela com a MESMA
    // `chaveDeIdempotencia` já consumida — a próxima venda montada em cima
    // dela vira "duplo toque" aos olhos da RPC (migration 20261162000000):
    // o pedido novo não nasce, o estoque não é debitado, mas o dinheiro já
    // entrou na gaveta.
    const item: ItemDoCupom = {
      chave: chaveDoItemDoCupom("p1", null),
      productId: "p1",
      variantId: null,
      nome: "Caneca",
      variacao: null,
      preco: 10,
      quantidade: 1,
      estoque: 5,
      imagem: "",
    };
    let estado: EstadoDaVenda = {
      ...estadoBase(),
      itens: [item],
      pagamento: "cash",
    };
    const chaveConsumida = estado.chaveDeIdempotencia;
    estado = reducerDaVenda(estado, {
      tipo: "venda_registrada",
      recibo: {
        orderId: "ped-1",
        numero: "PED001",
        criadoEm: new Date(0).toISOString(),
        total: 10,
        subtotal: 10,
        desconto: 0,
        pagamento: "cash",
        cliente: { tipo: "sem_cliente" },
        itens: [item],
        jaExistia: false,
      },
    });
    expect(estado.etapa).toBe("recibo");

    // O botão Voltar / o popstate da camada despacham 'etapa_pedida', não
    // 'cupom_limpo' — é exatamente o caminho que a tela de C3.3 vai tomar.
    expect(podeIrPara(estado, "cupom")).toBe(false);
    const depoisDoVoltar = reducerDaVenda(estado, {
      tipo: "etapa_pedida",
      etapa: "cupom",
    });
    expect(depoisDoVoltar.etapa).toBe("recibo");
    expect(depoisDoVoltar.chaveDeIdempotencia).toBe(chaveConsumida);

    // Cinturão e suspensório: mesmo que algo consiga tirar a etapa de
    // "recibo", `vendaPodeSerRegistrada` recusa reenviar com o recibo preso.
    expect(vendaPodeSerRegistrada(estado)).toEqual({
      ok: false,
      motivo:
        "Esta venda já foi registrada — limpe o cupom para começar outra.",
    });
  });
});

// ============================================================================
// Reducer puro — nenhuma das peças acima lê localStorage/Date.now/crypto/window
// ============================================================================

describe("pureza", () => {
  it("reducerDaVenda não muta o estado recebido (retorna objeto novo)", () => {
    const estado = estadoBase();
    const congelado = Object.freeze({ ...estado });
    const proximo = reducerDaVenda(estado, {
      tipo: "pagamento_escolhido",
      pagamento: "pix",
    });
    expect(estado).toEqual(congelado);
    expect(proximo).not.toBe(estado);
  });

  it("a mesma entrada sempre devolve a mesma saída (determinismo)", () => {
    const acao = {
      tipo: "codigo_resolvido" as const,
      codigo: "7891000000011",
      resposta: respostaVariante(),
      em: 42,
    };
    const a = reducerDaVenda(estadoBase(), acao);
    const b = reducerDaVenda(estadoBase(), acao);
    expect(a).toEqual(b);
  });
});
