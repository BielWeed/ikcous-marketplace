import { reconferirCarrinho } from "@/lib/reconferirCarrinho";
import type { CartItem, Product } from "@/types";
import { describe, expect, it } from "vitest";

// 🔴 CORRIGIDO em 28/08/2026, depois de a Task 3 reprovar o `npm run typecheck`.
// A primeira versao deste plano assumia `product.nome` e `product.preco`; o tipo
// real de `@/types` usa `name` e `price`. O teste antigo usava
// `as unknown as CartItem`, e foi ESSE cast que escondeu o erro do compilador --
// o teste passava contra uma forma que nao existe. Monte um `Product` DE VERDADE:
// assim quem erra o nome do campo descobre no typecheck, nao em producao.
const produto = (id: string, price: number): Product => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price,
  images: [],
  category: "geral",
  stock: 99,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-08-28T00:00:00Z",
});

const item = (id: string, price: number, qtd: number): CartItem => ({
  product: produto(id, price),
  quantity: qtd,
});

const leitor = (
  linhas: Array<{
    id: string;
    nome: string;
    preco: number;
    estoque: number;
    ativo: boolean;
  }>,
) => ({ lerProdutos: async () => linhas });

describe("reconferirCarrinho", () => {
  it("preco igual e estoque suficiente -> nenhuma mudanca", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 2)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([]);
  });

  it("preco mudou -> aponta de quanto para quanto", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 12.5, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([
      { productId: "a", nome: "Produto a", tipo: "preco", de: 10, para: 12.5 },
    ]);
  });

  it("estoque menor que o pedido -> aponta quanto ainda ha", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 1, ativo: true },
      ]),
    );
    expect(r.mudancas).toEqual([
      { productId: "a", nome: "Produto a", tipo: "estoque", de: 4, para: 1 },
    ]);
  });

  it("produto desativado -> sumiu", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: false },
      ]),
    );
    expect(r.mudancas[0].tipo).toBe("sumiu");
  });

  it("produto que o banco nao devolve -> sumiu, e NAO quebra", async () => {
    const r = await reconferirCarrinho([item("a", 10, 1)], leitor([]));
    expect(r.mudancas[0].tipo).toBe("sumiu");
    expect(r.mudancas[0].productId).toBe("a");
  });

  it("carrinho vazio -> nao consulta o banco", async () => {
    let chamou = false;
    const r = await reconferirCarrinho([], {
      lerProdutos: async () => {
        chamou = true;
        return [];
      },
    });
    expect(r.mudancas).toEqual([]);
    expect(chamou).toBe(false);
  });

  it("o MESMO produto em duas linhas do carrinho NAO duplica o id na consulta", async () => {
    // Achado da revisao: `itens.map((i) => i.product.id)` mandava
    // `["a", "a"]` ao banco quando o mesmo produto aparece em duas linhas
    // (por exemplo, duas variacoes ainda sem `variantId` distinguindo-as).
    let idsRecebidos: string[] = [];
    const r = await reconferirCarrinho([item("a", 10, 1), item("a", 10, 2)], {
      lerProdutos: async (ids) => {
        idsRecebidos = ids;
        return [
          { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
        ];
      },
    });
    expect(idsRecebidos).toEqual(["a"]);
    expect(r.mudancas).toEqual([]);
  });

  it("mudanca de 3 centavos E' relatada -- quem julga se importa e' outro", async () => {
    // Esta funcao nao tem tolerancia na LISTA: ela relata o que mudou. Quem
    // julga se e' o suficiente pra o banco recusar e' `oBancoRecusaria`, no
    // mesmo resultado. Ter a regua em dois lugares produziu dois defeitos.
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.03, estoque: 5, ativo: true },
      ]),
    );
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0]).toMatchObject({ tipo: "preco", de: 10, para: 10.03 });
  });

  it("o MESMO item com preco E estoque mudados reporta os DOIS", async () => {
    // Reportar so' o primeiro devolve a pessoa ao mesmo beco uma rodada depois.
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 12.5, estoque: 1, ativo: true },
      ]),
    );
    expect(r.mudancas.map((m) => m.tipo).sort()).toEqual(["estoque", "preco"]);
  });
});

describe("oBancoRecusaria", () => {
  // 🔴 Rodada 6: nao existe mais uma funcao separada que recebe as DUAS
  // listas (itens + mudancas) e precisa casa-las de volta por chave. Foi essa
  // casada que produziu os defeitos das rodadas 4 e 5 -- a chave so' no
  // produto colapsava variacoes diferentes, e depois a chave composta
  // encontrava as mudancas (que nunca carregam `variantId`) e o `?? 0`
  // silenciava a nao-achada como "nao pesa nada". Aqui o cenario e' montado
  // no LEITOR (o catalogo "vivo"), e a resposta se le em
  // `.oBancoRecusaria`, no MESMO objeto que `reconferirCarrinho` devolve --
  // nao ha chave para casar porque nao ha lista pra casar com outra.

  it("QUANTIDADE multiplica: 4 centavos vezes 10 unidades passa do teto", async () => {
    // O caso medido que provou o defeito da rodada 1: o banco recusava 100,40
    // contra 100,00 e a funcao dizia "nada mudou".
    //
    // 🔴 `estoque: 20` (nao 5): com estoque menor que a quantidade, o teste
    // passaria mesmo se a multiplicacao por `item.quantity` sumisse do
    // codigo, porque `deEstoque.length > 0` sozinho ja faz `oBancoRecusaria`
    // dar `true` -- e essa e' a recusa ERRADA, mascarando a do preco. Medido
    // nesta rodada: a sabotagem "tirar o `* item.quantity`" nao derrubava
    // NADA com `estoque: 5` aqui.
    const r = await reconferirCarrinho(
      [item("a", 10, 10)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("dois itens de 4 centavos no MESMO sentido somam e passam do teto", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1), item("b", 20, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 5, ativo: true },
        { id: "b", nome: "Produto b", preco: 20.04, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  // 🔴 O TESTE QUE FALTAVA, e sem ele a rodada 2 passou com a conta errada.
  // Somar MODULOS e' uma conta diferente de somar COM SINAL, e so' este caso
  // separa as duas. A revisao mediu: com a suite antiga, trocar uma pela outra
  // deixava os 10 testes verdes.
  it("SINAIS OPOSTOS se cancelam, igual no banco -- e a tela NAO avisa", async () => {
    // A lojista sobe R$ 3 na camiseta e baixa R$ 3 na caneca. O banco calcula
    // 30,00 contra 30,00 e FECHA o pedido.
    const r = await reconferirCarrinho(
      [item("a", 10, 1), item("b", 20, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 13, estoque: 5, ativo: true },
        { id: "b", nome: "Produto b", preco: 17, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  it("EXATAMENTE 5 centavos NAO passa -- o banco usa `> 0.05`, nao `>=`", async () => {
    // Em ponto flutuante isto da' 0.050000000000000710 e passaria; a conta em
    // centavos inteiros da' 5, e 5 > 5 e' falso, igual ao `numeric` do Postgres.
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.05, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  it("estoque insuficiente recusa sozinho, sem faixa de aceitacao", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 4)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 1, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("item sumido recusa sozinho", async () => {
    const r = await reconferirCarrinho([item("a", 10, 1)], leitor([]));
    expect(r.oBancoRecusaria).toBe(true);
  });

  it("carrinho sem mudanca nenhuma -> nao recusa", async () => {
    const r = await reconferirCarrinho(
      [item("a", 10, 1)],
      leitor([
        { id: "a", nome: "Produto a", preco: 10, estoque: 5, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(false);
  });

  // 🔴 O TESTE DE COMPOSICAO que a revisao pediu -- o cenario EXATO que
  // devolvia `false` na rodada 5, com as duas funcoes reais. Item com
  // `variantId` preenchido, diferenca de preco que passa do teto so' quando
  // multiplicada pela quantidade: se a chave composta ainda existisse, esta
  // mudanca teria variantId indefinido (nao vem da Task 3b) e seria
  // silenciada.
  it("item COM variantId cuja diferenca multiplicada pela quantidade passa do teto -> banco recusa", async () => {
    // `estoque: 20`, pelo mesmo motivo do teste "QUANTIDADE multiplica":
    // estoque menor que a quantidade recusaria por ESTOQUE, mascarando o que
    // este teste prova sobre PRECO.
    const comVariacao: CartItem = { ...item("a", 10, 10), variantId: "M" };
    const r = await reconferirCarrinho(
      [comVariacao],
      leitor([
        { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
      ]),
    );
    expect(r.oBancoRecusaria).toBe(true);
  });

  // 🔴 O teste que prendia a chave composta agora e' de ponta a ponta: duas
  // linhas do MESMO produto, variacoes diferentes, quantidades diferentes.
  // Sem casar nada por chave, cada linha usa a propria quantidade na conta.
  it("MESMO produto em duas linhas com variacoes DIFERENTES usa a quantidade de CADA uma", async () => {
    // `estoque: 20`: cobre a linha M (10 unidades) sem disparar a recusa por
    // estoque, que mascararia a de preco -- mesmo motivo do teste acima.
    const catalogo = leitor([
      { id: "a", nome: "Produto a", preco: 10.04, estoque: 20, ativo: true },
    ]);
    const camisetaM: CartItem = { ...item("a", 10, 10), variantId: "M" };
    const camisetaP: CartItem = { ...item("a", 10, 1), variantId: "P" };

    // So' a linha M (10 unidades) multiplica os 4 centavos por 10 = 40
    // centavos: passa do teto sozinha.
    const soM = await reconferirCarrinho([camisetaM], catalogo);
    expect(soM.oBancoRecusaria).toBe(true);

    // A MESMA diferenca de preco na linha P (1 unidade) da' so' 4 centavos:
    // nao passa sozinha.
    const soP = await reconferirCarrinho([camisetaP], catalogo);
    expect(soP.oBancoRecusaria).toBe(false);

    // Juntas no mesmo carrinho, as duas linhas somam 40 + 4 = 44 centavos: o
    // dedup do id para a consulta ao catalogo NAO colapsa a conta por linha.
    const juntas = await reconferirCarrinho([camisetaM, camisetaP], catalogo);
    expect(juntas.oBancoRecusaria).toBe(true);
  });

  // 🔴 Task 3c, 28/08/2026: prova o `!Number.isFinite(...)` da guarda. Item
  // "a" volta do catalogo SEM `preco` (adaptador com bug de tipo, ou leitura
  // incompleta) -- `emCentavos(undefined)` da' `NaN`, e sem a guarda isso
  // apagaria a diferenca do item "b" tambem. Sabotagem obrigatoria: tirar
  // `!Number.isFinite(diferencaEmCentavos) ||` do retorno derruba este teste.
  it("item SEM preco no catalogo vira NaN, e NAO pode apagar a diferenca dos outros", async () => {
    const r = await reconferirCarrinho([item("a", 10, 1), item("b", 20, 1)], {
      lerProdutos: async () => [
        {
          id: "a",
          nome: "Produto a",
          preco: undefined as unknown as number,
          estoque: 5,
          ativo: true,
        },
        { id: "b", nome: "Produto b", preco: 25, estoque: 5, ativo: true },
      ],
    });
    expect(r.oBancoRecusaria).toBe(true);
  });
});
