/**
 * Testes dos dados de comprador e produto que o cartao manda ao antifraude do
 * Mercado Pago (03/10/2026). Tudo aqui e' funcao pura — nenhuma rede, nenhum
 * banco. O que se prova e' a REGRA que erra caro: dado torto NUNCA pode virar
 * campo torto no POST /v1/orders (um 400 derruba TODO pagamento de cartao), e
 * a soma dos itens NUNCA pode divergir do total.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  camposDoComprador,
  dadosDoCompradorParaOrder,
  enderecoDaOrder,
  itensDaOrder,
  itensFechamComOTotal,
  lerDadosDoComprador,
  retiradaNaLoja,
  telefoneDoPagador,
} from "./dados-antifraude.ts";

const PRODUTO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PRODUTO = "aa8080814c11e237014c1ff593b57b99";

// ─── telefone ────────────────────────────────────────────────────────────────

Deno.test("telefoneDoPagador: celular com mascara vira area_code + numero so em digitos", () => {
  assertEquals(telefoneDoPagador("(11) 98765-4321"), { area_code: "11", number: "987654321" });
  assertEquals(telefoneDoPagador("11987654321"), { area_code: "11", number: "987654321" });
});

Deno.test("telefoneDoPagador: DDI 55 (com ou sem +) e' tirado; fixo de 8 digitos passa", () => {
  assertEquals(telefoneDoPagador("+55 (21) 99876-5432"), { area_code: "21", number: "998765432" });
  assertEquals(telefoneDoPagador("5521998765432"), { area_code: "21", number: "998765432" });
  assertEquals(telefoneDoPagador("(31) 3456-7890"), { area_code: "31", number: "34567890" });
});

Deno.test("telefoneDoPagador: lixo, curto, longo, DDD invalido, tudo igual ou nao-texto -> undefined (nunca lanca)", () => {
  for (
    const lixo of [
      undefined,
      null,
      "",
      "   ",
      "abc",
      "12345",
      "119876543",
      "119876543210987",
      "(01) 98765-4321",
      "(10) 98765-4321",
      "(11) 88765-4321", // 9 digitos que nao comecam em 9
      "(11) 11111-1111",
      "(11) 00000000",
      42,
      { a: 1 },
      ["11987654321"],
    ]
  ) {
    assertEquals(telefoneDoPagador(lixo), undefined, JSON.stringify(lixo));
  }
});

// ─── endereco ────────────────────────────────────────────────────────────────

const ENDERECO_CRU = {
  cep: "06233-903",
  street: "Rua Teste",
  number: "3003",
  neighborhood: "Bonfim",
  city: "Osasco",
  state: "sp",
  complement: "Apto 303",
};

Deno.test("enderecoDaOrder: endereco completo vira os campos da Orders API, CEP so em digitos e UF maiuscula", () => {
  assertEquals(enderecoDaOrder(ENDERECO_CRU), {
    zip_code: "06233903",
    street_name: "Rua Teste",
    street_number: "3003",
    neighborhood: "Bonfim",
    city: "Osasco",
    state: "SP",
    complement: "Apto 303",
  });
});

Deno.test("enderecoDaOrder: sem CEP valido, sem rua ou sem numero -> undefined (a unidade minima que o antifraude entende)", () => {
  assertEquals(enderecoDaOrder({ ...ENDERECO_CRU, cep: "123" }), undefined);
  assertEquals(enderecoDaOrder({ ...ENDERECO_CRU, cep: undefined }), undefined);
  assertEquals(enderecoDaOrder({ ...ENDERECO_CRU, street: "  " }), undefined);
  assertEquals(enderecoDaOrder({ ...ENDERECO_CRU, number: "" }), undefined);
  assertEquals(enderecoDaOrder(null), undefined);
  assertEquals(enderecoDaOrder("Rua Teste, 3003"), undefined);
  assertEquals(enderecoDaOrder([ENDERECO_CRU]), undefined);
  assertEquals(enderecoDaOrder({ cpf: "12345678909" }), undefined);
});

Deno.test("enderecoDaOrder: campo opcional torto e' OMITIDO sem derrubar o resto (UF de 3 letras, complemento vazio, tipo errado)", () => {
  assertEquals(enderecoDaOrder({ ...ENDERECO_CRU, state: "Sao Paulo", complement: "  ", city: 7 }), {
    zip_code: "06233903",
    street_name: "Rua Teste",
    street_number: "3003",
    neighborhood: "Bonfim",
  });
});

Deno.test("enderecoDaOrder: controle e espaco de sobra saem; texto comprido e' cortado (nunca estoura o corpo)", () => {
  const e = enderecoDaOrder({
    ...ENDERECO_CRU,
    street: "  Rua\u0000   das\nFlores  ",
    complement: "x".repeat(500),
  });
  assertEquals(e?.street_name, "Rua das Flores");
  assertEquals(e?.complement?.length, 60);
});

Deno.test("enderecoDaOrder: nao devolve nem o CPF nem chave nenhuma fora da lista fechada", () => {
  const e = enderecoDaOrder({ ...ENDERECO_CRU, cpf: "12345678909", extra: "x" });
  assertEquals(Object.keys(e ?? {}).sort(), [
    "city",
    "complement",
    "neighborhood",
    "state",
    "street_name",
    "street_number",
    "zip_code",
  ]);
});

// ─── retirada ────────────────────────────────────────────────────────────────

Deno.test("retiradaNaLoja: store-pickup ou retrato do endereco da loja; o resto e' entrega", () => {
  assertEquals(retiradaNaLoja({ customer_data: { shipping_option_id: "store-pickup" } }), true);
  assertEquals(retiradaNaLoja({ customer_data: { pickup_address: "Rua da Loja, 10" } }), true);
  assertEquals(retiradaNaLoja({ customer_data: { shipping_option_id: "local-delivery" } }), false);
  assertEquals(retiradaNaLoja({ customer_data: { pickup_address: "   " } }), false);
  assertEquals(retiradaNaLoja({ customer_data: null }), false);
  assertEquals(retiradaNaLoja(null), false);
});

// ─── itens ───────────────────────────────────────────────────────────────────

Deno.test("itensDaOrder: linhas do pedido viram items da Orders API (unit_price em string de 2 casas, quantity inteira)", () => {
  const itens = itensDaOrder(
    [
      { product_id: PRODUTO, product_name: "Camiseta Azul", quantity: 2, price: 49.9 },
      { product_id: OUTRO_PRODUTO, product_name: "Bone", quantity: 1, price: "19.90" },
    ],
    0,
  );
  assertEquals(itens, [
    { title: "Camiseta Azul", unit_price: "49.90", quantity: 2, description: "Camiseta Azul" },
    { title: "Bone", unit_price: "19.90", quantity: 1, description: "Bone" },
  ]);
});

Deno.test("itensDaOrder: frete maior que zero entra como uma linha 'Frete' (a soma fecha com o total); zero, ausente ou torto nao entra", () => {
  const linhas = [{ product_id: PRODUTO, product_name: "Camiseta", quantity: 1, price: 50 }];
  assertEquals(itensDaOrder(linhas, 12.5)?.map((i) => [i.title, i.unit_price, i.quantity]), [
    ["Camiseta", "50.00", 1],
    ["Frete", "12.50", 1],
  ]);
  for (const frete of [0, null, undefined, "abc", -3, NaN]) {
    assertEquals(itensDaOrder(linhas, frete)?.length, 1, String(frete));
  }
});

Deno.test("itensDaOrder: titulo ausente ganha 'Produto', e titulo comprido e' cortado em 150 (descricao em 100)", () => {
  const [a, b] = itensDaOrder(
    [
      { product_id: PRODUTO, product_name: null, quantity: 1, price: 10 },
      { product_id: OUTRO_PRODUTO, product_name: "T".repeat(400), quantity: 1, price: 10 },
    ],
    0,
  ) ?? [];
  assertEquals(a.title, "Produto");
  assertEquals(b.title.length, 150);
  assertEquals(b.description.length, 100);
});

Deno.test("itensDaOrder: external_code NUNCA vai (MP recusou o UUID do produto com 400 property_value em 03/10)", () => {
  const [a, b] = itensDaOrder(
    [
      { product_id: PRODUTO, product_name: "A", quantity: 1, price: 10 },
      { product_id: null, product_name: "B", quantity: 1, price: 10 },
    ],
    0,
  ) ?? [];
  assertEquals("external_code" in a, false);
  assertEquals("external_code" in b, false);
});

Deno.test("itensDaOrder: UMA linha imprestavel derruba TODOS os itens (pela metade a soma nao fecharia) — nunca lanca", () => {
  const boa = { product_id: PRODUTO, product_name: "Boa", quantity: 1, price: 10 };
  for (
    const ruim of [
      { ...boa, quantity: 0 },
      { ...boa, quantity: 1.5 },
      { ...boa, quantity: "2" },
      { ...boa, quantity: 100000 },
      { ...boa, price: 0 },
      { ...boa, price: -1 },
      { ...boa, price: "abc" },
      { ...boa, price: 10.005 }, // 3 casas: nao fecha em centavos
      { ...boa, price: null },
      null,
      "texto",
    ]
  ) {
    assertEquals(itensDaOrder([boa, ruim], 0), undefined, JSON.stringify(ruim));
  }
});

Deno.test("itensDaOrder: lista vazia, nao-lista ou comprida demais -> undefined", () => {
  assertEquals(itensDaOrder([], 0), undefined);
  assertEquals(itensDaOrder(null, 0), undefined);
  assertEquals(itensDaOrder(undefined, 0), undefined);
  assertEquals(itensDaOrder({ a: 1 }, 0), undefined);
  const muitas = Array.from({ length: 21 }, (_, i) => ({
    product_id: PRODUTO,
    product_name: `P${i}`,
    quantity: 1,
    price: 1,
  }));
  assertEquals(itensDaOrder(muitas, 0), undefined);
  assertEquals(itensDaOrder(muitas.slice(0, 20), 0)?.length, 20);
});

Deno.test("itensDaOrder: nao deixa o 'Frete' estourar o teto — 20 produtos + frete = 21 linhas -> undefined", () => {
  const vinte = Array.from({ length: 20 }, (_, i) => ({
    product_id: PRODUTO,
    product_name: `P${i}`,
    quantity: 1,
    price: 1,
  }));
  assertEquals(itensDaOrder(vinte, 5), undefined);
});

// ─── soma fecha com o total ──────────────────────────────────────────────────

Deno.test("itensFechamComOTotal: soma EXATA em centavos fecha; 1 centavo de diferenca nao", () => {
  const itens = [
    { title: "A", unit_price: "49.90", quantity: 2, description: "A" },
    { title: "B", unit_price: "0.10", quantity: 1, description: "B" },
  ];
  assertEquals(itensFechamComOTotal(itens, "99.90"), true);
  assertEquals(itensFechamComOTotal(itens, "99.89"), false);
  assertEquals(itensFechamComOTotal(itens, "100.00"), false);
  assertEquals(itensFechamComOTotal([], "0.00"), false);
  assertEquals(itensFechamComOTotal(itens, "abc"), false);
});

// ─── o conjunto ──────────────────────────────────────────────────────────────

function pedido(extra: Record<string, unknown> = {}) {
  return {
    id: "pedido-1",
    total: 112.5,
    shipping: 12.5,
    customer_phone: null,
    customer_data: {
      whatsapp: "(11) 98765-4321",
      address: ENDERECO_CRU,
      shipping_option_id: "local-delivery",
    },
    ...extra,
  };
}

const LINHAS = [{ product_id: PRODUTO, product_name: "Camiseta Azul", quantity: 2, price: 50 }];

Deno.test("dadosDoCompradorParaOrder: pedido de entrega com tudo -> itens (com frete), telefone, endereco do pagador e endereco de entrega", () => {
  const d = dadosDoCompradorParaOrder({ pedido: pedido(), itens: LINHAS, enderecoSalvo: null });
  assertEquals(d.items?.map((i) => i.title), ["Camiseta Azul", "Frete"]);
  assertEquals(d.phone, { area_code: "11", number: "987654321" });
  assertEquals(d.address?.zip_code, "06233903");
  assertEquals(d.shipmentAddress, d.address);
});

Deno.test("dadosDoCompradorParaOrder: RETIRADA na loja nao manda endereco de entrega (nao ha entrega), mas manda o resto", () => {
  const d = dadosDoCompradorParaOrder({
    pedido: pedido({
      shipping: 0,
      customer_data: { whatsapp: "11987654321", address: ENDERECO_CRU, shipping_option_id: "store-pickup" },
    }),
    itens: LINHAS,
    enderecoSalvo: null,
  });
  assertEquals(d.shipmentAddress, undefined);
  assertEquals(d.items?.length, 1);
  assertEquals(d.phone, { area_code: "11", number: "987654321" });
});

Deno.test("dadosDoCompradorParaOrder: cliente logado — endereco vem da linha salva quando o pedido nao tem snapshot (ou o snapshot e' so o CPF)", () => {
  const d = dadosDoCompradorParaOrder({
    pedido: pedido({ customer_data: { whatsapp: "11987654321", address: { cpf: "12345678909" } } }),
    itens: LINHAS,
    enderecoSalvo: ENDERECO_CRU,
  });
  assertEquals(d.address?.street_name, "Rua Teste");
  assertEquals(d.shipmentAddress?.street_name, "Rua Teste");
});

Deno.test("dadosDoCompradorParaOrder: telefone cai para a coluna customer_phone quando o jsonb nao tem", () => {
  const d = dadosDoCompradorParaOrder({
    pedido: pedido({ customer_phone: "(21) 99876-5432", customer_data: { address: ENDERECO_CRU } }),
    itens: LINHAS,
    enderecoSalvo: null,
  });
  assertEquals(d.phone, { area_code: "21", number: "998765432" });
});

Deno.test("dadosDoCompradorParaOrder: TUDO ausente ou torto -> {} (o corpo do cartao fica como era), sem lancar", () => {
  for (
    const entrada of [
      { pedido: null, itens: null, enderecoSalvo: null },
      { pedido: undefined, itens: undefined, enderecoSalvo: undefined },
      { pedido: "texto", itens: 42, enderecoSalvo: [] },
      { pedido: { customer_data: "x", total: "y" }, itens: [null], enderecoSalvo: "z" },
      { pedido: pedido({ customer_data: undefined }), itens: [], enderecoSalvo: null },
    ]
  ) {
    assertEquals(dadosDoCompradorParaOrder(entrada as never), {}, JSON.stringify(entrada));
  }
});

Deno.test("dadosDoCompradorParaOrder: uma peca ruim nao leva as outras — itens ruins, telefone e endereco bons", () => {
  const d = dadosDoCompradorParaOrder({
    pedido: pedido(),
    itens: [{ product_id: PRODUTO, product_name: "X", quantity: 0, price: 10 }],
    enderecoSalvo: null,
  });
  assertEquals(d.items, undefined);
  assertEquals(d.phone?.area_code, "11");
  assertEquals(d.address?.zip_code, "06233903");
});

Deno.test("dadosDoCompradorParaOrder: getter que lanca (objeto hostil) nao escapa — a peca que depende dele some, as outras ficam", () => {
  const hostil = {
    shipping: 0,
    get customer_data() {
      throw new Error("boom");
    },
  };
  const d = dadosDoCompradorParaOrder({ pedido: hostil, itens: LINHAS, enderecoSalvo: ENDERECO_CRU });
  assertEquals(d.phone, undefined);
  assertEquals(d.items?.length, 1);
  assertEquals(d.address?.zip_code, "06233903");
});

Deno.test("dadosDoCompradorParaOrder: getter hostil em TODOS os lugares -> {} e nada escapa", () => {
  const explode = () => {
    throw new Error("boom");
  };
  const pedidoHostil = {
    get shipping() {
      return explode();
    },
    get customer_data() {
      return explode();
    },
    get customer_phone() {
      return explode();
    },
  };
  const linhaHostil = {
    get product_name() {
      return explode();
    },
  };
  const enderecoHostil = {
    get cep() {
      return explode();
    },
  };
  assertEquals(
    dadosDoCompradorParaOrder({ pedido: pedidoHostil, itens: [linhaHostil], enderecoSalvo: enderecoHostil }),
    {},
  );
});

// ─── o que entra no corpo ────────────────────────────────────────────────────

Deno.test("camposDoComprador: itens so entram quando a soma fecha AO CENTAVO com o total; frete incluso", () => {
  const d = dadosDoCompradorParaOrder({ pedido: pedido(), itens: LINHAS, enderecoSalvo: null });
  const fecha = camposDoComprador(d, "112.50");
  assertEquals(fecha.items?.map((i) => i.title), ["Camiseta Azul", "Frete"]);
  assertEquals(fecha.phone, { area_code: "11", number: "987654321" });
  assertEquals(fecha.shipment?.address.zip_code, "06233903");
  assertEquals(fecha.address?.zip_code, "06233903");

  // Pedido com DESCONTO: o total e' menor que a soma — itens saem, o resto fica.
  const comDesconto = camposDoComprador(d, "100.00");
  assertEquals(comDesconto.items, undefined);
  assertEquals(comDesconto.phone, { area_code: "11", number: "987654321" });
  // 1 centavo a mais ou a menos tambem nao fecha.
  assertEquals(camposDoComprador(d, "112.51").items, undefined);
  assertEquals(camposDoComprador(d, "112.49").items, undefined);
});

Deno.test("camposDoComprador: entrada hostil (nao-objeto, item fora de forma, telefone/endereco tortos) vira {} — sem lancar", () => {
  for (const lixo of [null, undefined, "x", 1, []]) {
    assertEquals(camposDoComprador(lixo, "10.00"), {}, JSON.stringify(lixo));
  }
  const torto = camposDoComprador(
    {
      items: [{ title: "A", unit_price: "10", quantity: 1 }], // sem 2 casas
      phone: { area_code: "1", number: "abc" },
      address: { zip_code: "123", street_name: "R", street_number: "1" },
      shipmentAddress: { zip_code: "06233903", street_name: "", street_number: "1" },
    },
    "10.00",
  );
  assertEquals(torto, {});
});

Deno.test("camposDoComprador: copia SO as chaves conhecidas — chave estranha (ex.: cpf) nunca atravessa", () => {
  const r = camposDoComprador(
    {
      phone: { area_code: "11", number: "987654321", cpf: "12345678909" },
      address: {
        zip_code: "06233903",
        street_name: "Rua Teste",
        street_number: "3003",
        cpf: "12345678909",
        state: "SP",
      },
      items: [{ title: "A", unit_price: "10.00", quantity: 1, description: "A", cpf: "1", external_code: PRODUTO }],
    },
    "10.00",
  );
  assertEquals(JSON.stringify(r).includes("12345678909"), false);
  assertEquals(JSON.stringify(r).includes('"cpf"'), false);
  assertEquals("external_code" in (r.items?.[0] ?? {}), false);
  assertEquals(r.address?.state, "SP");
});

// ─── a leitura no banco (melhor esforco) ─────────────────────────────────────

type Leitura = { tabela: string; colunas: string; filtros: Array<[string, unknown]> };

/** Cliente falso: cada tabela devolve o que o cenario manda; registra o que foi lido. */
function bancoFalso(
  respostas: Record<string, { data?: unknown; error?: unknown; lanca?: boolean; trava?: boolean }>,
) {
  const leituras: Leitura[] = [];
  const porTabela = new Map(Object.entries(respostas));
  return {
    leituras,
    from(tabela: string) {
      const leitura: Leitura = { tabela, colunas: "", filtros: [] };
      leituras.push(leitura);
      const resposta = () => {
        const r = porTabela.get(tabela) ?? { data: null };
        if (r.lanca) throw new Error("banco caiu — telefone 11987654321 Rua Secreta");
        if (r.trava) return new Promise(() => {});
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      };
      const cadeia = {
        select(colunas: string) {
          leitura.colunas = colunas;
          return cadeia;
        },
        eq(coluna: string, valor: unknown) {
          leitura.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: () => resposta(),
        then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) => {
          try {
            return resposta().then(ok, nok);
          } catch (e) {
            return Promise.reject(e).then(ok, nok);
          }
        },
      };
      return cadeia;
    },
  };
}

const PEDIDO_LIDO = {
  id: "pedido-1",
  user_id: "usuario-1",
  total: 112.5,
  customer_data: { whatsapp: "(11) 98765-4321", shipping_option_id: "local-delivery" },
};

Deno.test("lerDadosDoComprador: le itens (por order_id), colunas do pedido e o endereco salvo (por id E dono) — e monta tudo", async () => {
  const banco = bancoFalso({
    marketplace_orders: { data: { customer_phone: null, address_id: "end-1", shipping: 12.5 } },
    marketplace_order_items: { data: LINHAS },
    user_addresses: { data: ENDERECO_CRU },
  });
  const d = await lerDadosDoComprador(banco, PEDIDO_LIDO);
  assertEquals(d.items?.map((i) => i.title), ["Camiseta Azul", "Frete"]);
  assertEquals(d.phone, { area_code: "11", number: "987654321" });
  assertEquals(d.address?.street_name, "Rua Teste");
  assertEquals(d.shipmentAddress?.zip_code, "06233903");

  const porTabela = (t: string) => banco.leituras.filter((l) => l.tabela === t);
  assertEquals(porTabela("marketplace_order_items")[0].filtros, [["order_id", "pedido-1"]]);
  assertEquals(porTabela("marketplace_orders")[0].filtros, [["id", "pedido-1"]]);
  // O endereco so e' lido com o filtro do DONO — outro usuario nunca vaza.
  assertEquals(porTabela("user_addresses")[0].filtros, [["id", "end-1"], ["user_id", "usuario-1"]]);
});

Deno.test("lerDadosDoComprador: snapshot de endereco valido no pedido dispensa a leitura de user_addresses", async () => {
  const banco = bancoFalso({
    marketplace_orders: { data: { address_id: "end-1", shipping: 0 } },
    marketplace_order_items: { data: LINHAS },
  });
  const d = await lerDadosDoComprador(banco, {
    ...PEDIDO_LIDO,
    customer_data: { whatsapp: "11987654321", address: ENDERECO_CRU },
  });
  assertEquals(d.address?.zip_code, "06233903");
  assertEquals(banco.leituras.some((l) => l.tabela === "user_addresses"), false);
});

Deno.test("lerDadosDoComprador: sem user_id ou sem address_id NAO le endereco salvo (nada de buscar endereco sem dono)", async () => {
  const semDono = bancoFalso({
    marketplace_orders: { data: { address_id: "end-1" } },
    marketplace_order_items: { data: LINHAS },
    user_addresses: { data: ENDERECO_CRU },
  });
  const d1 = await lerDadosDoComprador(semDono, { ...PEDIDO_LIDO, user_id: null });
  assertEquals(d1.address, undefined);
  assertEquals(semDono.leituras.some((l) => l.tabela === "user_addresses"), false);

  const semEndereco = bancoFalso({
    marketplace_orders: { data: { address_id: null } },
    marketplace_order_items: { data: LINHAS },
    user_addresses: { data: ENDERECO_CRU },
  });
  await lerDadosDoComprador(semEndereco, PEDIDO_LIDO);
  assertEquals(semEndereco.leituras.some((l) => l.tabela === "user_addresses"), false);
});

Deno.test("lerDadosDoComprador: erro de banco numa leitura perde SO aquela peca — as outras seguem", async () => {
  const banco = bancoFalso({
    marketplace_orders: { error: { message: "column customer_phone does not exist" } },
    marketplace_order_items: { data: LINHAS },
  });
  const d = await lerDadosDoComprador(banco, PEDIDO_LIDO);
  // Sem a coluna `shipping`, o frete some e a soma nao fecharia — mas quem
  // decide isso e' o corpo; aqui os itens existem e o telefone ainda vem do jsonb.
  assertEquals(d.items?.map((i) => i.title), ["Camiseta Azul"]);
  assertEquals(d.phone, { area_code: "11", number: "987654321" });
});

Deno.test("lerDadosDoComprador: banco que LANCA (sincrono ou na promessa) nao escapa e a mensagem nao vai para log", async () => {
  const logs: string[] = [];
  const originais = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  console.error = (...a: unknown[]) => void logs.push(a.join(" "));
  console.warn = (...a: unknown[]) => void logs.push(a.join(" "));
  try {
    const banco = bancoFalso({
      marketplace_orders: { lanca: true },
      marketplace_order_items: { lanca: true },
      user_addresses: { lanca: true },
    });
    const d = await lerDadosDoComprador(banco, {
      ...PEDIDO_LIDO,
      customer_data: { whatsapp: "(11) 98765-4321" },
    });
    assertEquals(d, { phone: { area_code: "11", number: "987654321" } });
    const intocavel = {
      from() {
        throw new Error("sincrono");
      },
    };
    assertEquals(await lerDadosDoComprador(intocavel, PEDIDO_LIDO), { phone: { area_code: "11", number: "987654321" } });
  } finally {
    console.log = originais.log;
    console.error = originais.error;
    console.warn = originais.warn;
  }
  assertEquals(logs, []);
});

Deno.test("lerDadosDoComprador: banco que TRAVA nao segura o pagamento — passado o prazo devolve {} (e nao deixa timer pendurado)", async () => {
  const banco = bancoFalso({
    marketplace_orders: { trava: true },
    marketplace_order_items: { trava: true },
  });
  const inicio = performance.now();
  const d = await lerDadosDoComprador(banco, PEDIDO_LIDO, 30);
  assertEquals(d, {});
  assertEquals(performance.now() - inicio < 1000, true);
});

Deno.test("lerDadosDoComprador: pedido sem id, nulo ou nao-objeto -> {} sem tocar o banco", async () => {
  for (const pedido of [null, undefined, "x", {}, { id: 7 }]) {
    const banco = bancoFalso({});
    assertEquals(await lerDadosDoComprador(banco, pedido as never), {}, JSON.stringify(pedido));
    assertEquals(banco.leituras.length, 0);
  }
});
