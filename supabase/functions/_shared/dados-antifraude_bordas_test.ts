// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `dados-antifraude.ts` — o que o cartão manda
 * ao antifraude do Mercado Pago sobre o comprador. Um dado torto que vira campo
 * torto derruba TODO pagamento de cartão (400 do MP), e uma soma que não fecha
 * é a mesma coisa. Dos mutantes plantados, estes sobreviviam às suítes de
 * `dados-antifraude_test.ts` e `dados-antifraude_dinheiro_test.ts`; cada um vira
 * um caso de BORDA abaixo:
 *
 *   * caractere de controle 0x1f e 0x7f vira espaço, e o til (0x7e) NÃO;
 *   * preço com 3 casas ("12.500") e número com ruído abaixo do centavo
 *     (12.3004) recusam: nunca arredondam o dinheiro por palpite;
 *   * telefone: o repetido de verdade (999999999, 33333333) é lixo — o teste
 *     antigo só usava repetidos que já caíam em OUTRA regra; fixo não começa em
 *     0 nem em 1; na revalidação o DDD e o tamanho do número valem de novo;
 *   * CEP de 7 dígitos, número de rua numérico (e não-finito), UF de 1 letra e
 *     UF minúscula na revalidação;
 *   * os tetos de tamanho de cada campo (rua 100, número 20, bairro/cidade/
 *     complemento 60, título 150, descrição 100) valem EXATAMENTE — o MP recusa
 *     (400) o que passa deles, e cortar um a menos esconderia parte do endereço;
 *   * `+55` com fixo (12 dígitos), a ORDEM dos telefones (whatsapp, depois
 *     telefone, depois o do pedido) e o endereço alternativo `addressData`;
 *   * preço de item com UMA casa ("10.5") não entra na soma (viraria 105
 *     centavos em vez de 1050 e a soma "fecharia" errada);
 *   * `comPrazo` (o teto que impede a leitura de segurar a cobrança): passado o
 *     prazo devolve `undefined` (e não `null`), o prazo vale o que foi pedido e
 *     o relógio é SEMPRE limpo — no sucesso e na rejeição;
 *   * leitura no banco: resposta com dado E erro perde a peça; pedido com `id` vazio, `address_id`/`user_id` vazios e
 *     `banco` nulo nunca tocam (nem derrubam) a cobrança; o dado FRESCO do banco
 *     vence o do pedido; o prazo padrão da leitura é de 3 segundos.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  camposDoComprador,
  comPrazo,
  dadosDoCompradorParaOrder,
  enderecoDaOrder,
  itensDaOrder,
  itensFechamComOTotal,
  lerDadosDoComprador,
  PRAZO_DA_LEITURA_MS,
  telefoneDoPagador,
} from "./dados-antifraude.ts";

const ENDERECO = {
  cep: "01310-100",
  street: "Rua Fictícia",
  number: "10",
  neighborhood: "Centro",
  city: "Cidade Exemplo",
  state: "SP",
};

// ─── texto: caracteres de controle ───────────────────────────────────────────

Deno.test("endereço: o separador de unidade (0x1f) e o DEL (0x7f) viram espaço; o til não", () => {
  assertEquals(
    enderecoDaOrder({ ...ENDERECO, street: "Rua\u001fA" })?.street_name,
    "Rua A",
  );
  assertEquals(
    enderecoDaOrder({ ...ENDERECO, street: "Rua\u007fA" })?.street_name,
    "Rua A",
  );
  assertEquals(
    enderecoDaOrder({ ...ENDERECO, street: "Rua~A" })?.street_name,
    "Rua~A",
  );
});

// ─── dinheiro: nada de arredondar por palpite ────────────────────────────────

Deno.test("itens: preço com três casas e número com ruído abaixo do centavo recusam a lista inteira", () => {
  const com = (price: unknown) =>
    itensDaOrder([{ product_name: "Camiseta", quantity: 1, price }], 0);
  assertEquals(com("12.50")?.[0].unit_price, "12.50");
  assertEquals(com("12.500"), undefined);
  assertEquals(com(12.3004), undefined);
  assertEquals(com(12.3), [{
    title: "Camiseta",
    unit_price: "12.30",
    quantity: 1,
    description: "Camiseta",
  }]);
});

// ─── telefone ────────────────────────────────────────────────────────────────

Deno.test("telefone: número de um dígito repetido (celular e fixo) é lixo mesmo quando o formato passa", () => {
  assertEquals(telefoneDoPagador("(11) 99999-9999"), undefined);
  assertEquals(telefoneDoPagador("(11) 3333-3333"), undefined);
  // um dígito diferente no meio já não é repetido
  assertEquals(telefoneDoPagador("(11) 99999-9998"), {
    area_code: "11",
    number: "999999998",
  });
});

Deno.test("telefone: fixo de 8 dígitos não começa em 0 nem em 1", () => {
  assertEquals(telefoneDoPagador("(31) 1456-7890"), undefined);
  assertEquals(telefoneDoPagador("(31) 0456-7890"), undefined);
  assertEquals(telefoneDoPagador("(31) 2456-7890"), {
    area_code: "31",
    number: "24567890",
  });
});

Deno.test("revalidação do telefone: DDD com zero e número de 10 dígitos não entram no corpo", () => {
  const com = (phone: unknown) => camposDoComprador({ phone }, "10.00").phone;
  assertEquals(com({ area_code: "11", number: "987654321" }), {
    area_code: "11",
    number: "987654321",
  });
  assertEquals(com({ area_code: "01", number: "987654321" }), undefined);
  assertEquals(com({ area_code: "10", number: "987654321" }), undefined);
  assertEquals(com({ area_code: "11", number: "9876543210" }), undefined);
  assertEquals(com({ area_code: "11", number: "9876543" }), undefined);
});

// ─── endereço ────────────────────────────────────────────────────────────────

Deno.test("endereço: CEP de 7 dígitos recusa; 8 dígitos passam", () => {
  assertEquals(enderecoDaOrder({ ...ENDERECO, cep: "0131010" }), undefined);
  assertEquals(enderecoDaOrder({ ...ENDERECO, cep: "01310100" })?.zip_code, "01310100");
});

Deno.test("endereço: número da rua numérico vira texto; não-finito recusa o endereço", () => {
  assertEquals(enderecoDaOrder({ ...ENDERECO, number: 123 })?.street_number, "123");
  assertEquals(enderecoDaOrder({ ...ENDERECO, number: 0 })?.street_number, "0");
  assertEquals(enderecoDaOrder({ ...ENDERECO, number: Number.NaN }), undefined);
  assertEquals(
    enderecoDaOrder({ ...ENDERECO, number: Number.POSITIVE_INFINITY }),
    undefined,
  );
});

Deno.test("endereço: UF de uma letra sai sozinha (o resto do endereço fica)", () => {
  const e = enderecoDaOrder({ ...ENDERECO, state: "S" });
  assertEquals(e?.zip_code, "01310100");
  assertEquals("state" in (e ?? {}), false);
});

Deno.test("revalidação do endereço: UF minúscula não entra no corpo, maiúscula sim", () => {
  const base = { zip_code: "01310100", street_name: "Rua A", street_number: "1" };
  assertEquals("state" in (camposDoComprador({ address: { ...base, state: "sp" } }, "10.00").address ?? {}), false);
  assertEquals(camposDoComprador({ address: { ...base, state: "SP" } }, "10.00").address?.state, "SP");
});

// ─── itens que passam pela última porta ──────────────────────────────────────

Deno.test("itens revalidados: título e descrição ausentes viram 'Produto' (nunca vazio)", () => {
  const r = camposDoComprador({
    items: [{ unit_price: "10.00", quantity: 1 }],
  }, "10.00");
  assertEquals(r.items, [{
    title: "Produto",
    unit_price: "10.00",
    quantity: 1,
    description: "Produto",
  }]);
});

// ─── a leitura no banco ──────────────────────────────────────────────────────

function bancoFalso(
  respostas: Record<string, { data?: unknown }>,
) {
  const leituras: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  const porTabela = new Map(Object.entries(respostas));
  return {
    leituras,
    from(tabela: string) {
      const leitura = { tabela, filtros: [] as Array<[string, unknown]> };
      leituras.push(leitura);
      const resposta = () =>
        Promise.resolve({ data: porTabela.get(tabela)?.data ?? null, error: null });
      const cadeia = {
        select: () => cadeia,
        eq(coluna: string, valor: unknown) {
          leitura.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: () => resposta(),
        then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) =>
          resposta().then(ok, nok),
      };
      return cadeia;
    },
  };
}

const ITENS = [{ product_name: "Camiseta", quantity: 1, price: 10 }];

Deno.test("leitura: pedido com id VAZIO devolve {} sem tocar o banco", async () => {
  const banco = bancoFalso({ marketplace_order_items: { data: ITENS } });
  assertEquals(await lerDadosDoComprador(banco, { id: "" }), {});
  assertEquals(banco.leituras.length, 0);
});

Deno.test("leitura: banco nulo, indefinido ou sem `from` devolve {} (nunca lança)", async () => {
  const pedido = { id: "pedido-1" };
  assertEquals(await lerDadosDoComprador(null, pedido), {});
  assertEquals(await lerDadosDoComprador(undefined, pedido), {});
  assertEquals(await lerDadosDoComprador({}, pedido), {});
  assertEquals(await lerDadosDoComprador({ from: "texto" }, pedido), {});
});

Deno.test("leitura: o dado FRESCO do banco vence o que o pedido trazia", async () => {
  const banco = bancoFalso({
    marketplace_orders: { data: { customer_phone: "(21) 99876-5432" } },
    marketplace_order_items: { data: ITENS },
  });
  const d = await lerDadosDoComprador(banco, {
    id: "pedido-1",
    customer_phone: "(11) 98765-4321",
  });
  assertEquals(d.phone, { area_code: "21", number: "998765432" });
});

Deno.test("leitura: address_id VAZIO ou user_id VAZIO não leem o endereço salvo", async () => {
  const semEnderecoId = bancoFalso({
    marketplace_orders: { data: { address_id: "" } },
    user_addresses: { data: { ...ENDERECO } },
  });
  await lerDadosDoComprador(semEnderecoId, { id: "pedido-1", user_id: "usuario-1" });
  assertEquals(semEnderecoId.leituras.some((l) => l.tabela === "user_addresses"), false);

  const semDonoId = bancoFalso({
    marketplace_orders: { data: { address_id: "end-1" } },
    user_addresses: { data: { ...ENDERECO } },
  });
  const d = await lerDadosDoComprador(semDonoId, { id: "pedido-1", user_id: "" });
  assertEquals(semDonoId.leituras.some((l) => l.tabela === "user_addresses"), false);
  assertEquals(d.address, undefined);
});

Deno.test("leitura: o prazo padrão que segura a cobrança é de 3 segundos", () => {
  assertEquals(PRAZO_DA_LEITURA_MS, 3000);
});

// ─── tetos de tamanho ────────────────────────────────────────────────────────

Deno.test("endereço: cada campo é cortado EXATAMENTE no teto (rua 100, número 20, bairro/cidade/complemento 60)", () => {
  const e = enderecoDaOrder({
    cep: "01310100",
    street: "r".repeat(101),
    number: "7".repeat(21),
    neighborhood: "b".repeat(61),
    city: "c".repeat(61),
    state: "SP",
    complement: "x".repeat(61),
  });
  assertEquals(e?.street_name, "r".repeat(100));
  assertEquals(e?.street_number, "7".repeat(20));
  assertEquals(e?.neighborhood, "b".repeat(60));
  assertEquals(e?.city, "c".repeat(60));
  assertEquals(e?.complement, "x".repeat(60));
});

Deno.test("revalidação: endereço e itens também são cortados EXATAMENTE no teto", () => {
  const r = camposDoComprador({
    address: {
      zip_code: "01310100",
      street_name: "r".repeat(101),
      street_number: "7".repeat(21),
      neighborhood: "b".repeat(61),
      city: "c".repeat(61),
      complement: "x".repeat(61),
    },
    items: [{
      title: "t".repeat(151),
      unit_price: "10.00",
      quantity: 1,
      description: "d".repeat(101),
    }],
  }, "10.00");
  assertEquals(r.address?.street_name, "r".repeat(100));
  assertEquals(r.address?.street_number, "7".repeat(20));
  assertEquals(r.address?.neighborhood, "b".repeat(60));
  assertEquals(r.address?.city, "c".repeat(60));
  assertEquals(r.address?.complement, "x".repeat(60));
  assertEquals(r.items?.[0].title, "t".repeat(150));
  assertEquals(r.items?.[0].description, "d".repeat(100));
});

Deno.test("itens: descrição da linha é o título cortado em 100 (o título vai até 150)", () => {
  const itens = itensDaOrder(
    [{ product_name: "p".repeat(150), quantity: 1, price: 10 }],
    0,
  );
  assertEquals(itens?.[0].title, "p".repeat(150));
  assertEquals(itens?.[0].description, "p".repeat(100));
});

// ─── telefone: DDI e ordem de preferência ────────────────────────────────────

Deno.test("telefone: +55 com fixo (12 dígitos no total) tira o DDI; 14 dígitos não", () => {
  assertEquals(telefoneDoPagador("+55 (31) 3456-7890"), {
    area_code: "31",
    number: "34567890",
  });
  assertEquals(telefoneDoPagador("+555531987654321"), undefined);
});

Deno.test("telefone do pedido: whatsapp vence telefone, que vence o telefone da linha do pedido", () => {
  const base = { id: "p1" };
  const itens = [{ product_name: "A", quantity: 1, price: 10 }];
  const com = (customer_data: unknown, customer_phone?: unknown) =>
    dadosDoCompradorParaOrder({
      pedido: { ...base, customer_data, customer_phone },
      itens,
      enderecoSalvo: null,
    }).phone?.area_code;
  assertEquals(com({ whatsapp: "(11) 98765-4321", phone: "(21) 99876-5432" }, "(31) 98877-6655"), "11");
  assertEquals(com({ whatsapp: "lixo", phone: "(21) 99876-5432" }, "(31) 98877-6655"), "21");
  assertEquals(com({ whatsapp: "lixo", phone: "lixo" }, "(31) 98877-6655"), "31");
});

Deno.test("endereço do pedido: `address` vence `addressData`, que vence o endereço salvo", () => {
  const monta = (customer_data: unknown, enderecoSalvo: unknown) =>
    dadosDoCompradorParaOrder({
      pedido: { id: "p1", customer_data },
      itens: null,
      enderecoSalvo,
    }).address?.street_name;
  const rua = (street: string) => ({ ...ENDERECO, street });
  assertEquals(monta({ address: rua("Rua Um"), addressData: rua("Rua Dois") }, rua("Rua Tres")), "Rua Um");
  assertEquals(monta({ address: { cep: "x" }, addressData: rua("Rua Dois") }, rua("Rua Tres")), "Rua Dois");
  assertEquals(monta({}, rua("Rua Tres")), "Rua Tres");
});

// ─── soma dos itens ──────────────────────────────────────────────────────────

Deno.test("soma: preço de item com UMA casa não entra (10.5 viraria 105 centavos)", () => {
  const item = (unit_price: string) => [{ title: "A", unit_price, quantity: 1, description: "A" }];
  assertEquals(itensFechamComOTotal(item("10.50"), "10.50"), true);
  assertEquals(itensFechamComOTotal(item("10.5"), "1.05"), false);
  assertEquals(itensFechamComOTotal(item("10.5"), "10.50"), false);
});

// ─── leitura: resposta com dado E erro ───────────────────────────────────────

Deno.test("leitura: resposta com dado E erro perde a peça (o dado é descartado)", async () => {
  const comErro = (data: unknown) => ({
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () => Promise.resolve({ data, error: { message: "coluna inexistente" } }),
        then: (ok: (v: unknown) => unknown) => ok({ data, error: { message: "coluna inexistente" } }),
      };
      return cadeia;
    },
  });
  const d = await lerDadosDoComprador(comErro({ customer_phone: "(21) 99876-5432" }), { id: "p1" });
  assertEquals(d, {});
});

// ─── comPrazo ────────────────────────────────────────────────────────────────

Deno.test("comPrazo: passado o prazo devolve undefined (não null), e o que chega antes vence", async () => {
  const lento = () => new Promise<string>((resolve) => setTimeout(() => resolve("tarde"), 80));
  const rapido = () => new Promise<string>((resolve) => setTimeout(() => resolve("a tempo"), 5));
  assertEquals(await comPrazo(lento, 10), undefined);
  assertEquals(await comPrazo(rapido, 500), "a tempo");
});

Deno.test("comPrazo: trabalho que rejeita vira undefined, sem lançar", async () => {
  assertEquals(await comPrazo(() => Promise.reject(new Error("banco caiu")), 500), undefined);
  assertEquals(
    await comPrazo(() => {
      throw new Error("lançou antes de devolver a promessa");
    }, 500),
    undefined,
  );
});

Deno.test("comPrazo: o relógio é limpo no sucesso e na rejeição (nenhum timer pendurado)", async () => {
  const setOriginal = globalThis.setTimeout;
  const clearOriginal = globalThis.clearTimeout;
  const pendentes = new Set<unknown>();
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const id = setOriginal(() => {
      pendentes.delete(id);
      fn();
    }, ms);
    if (ms === 60_000) pendentes.add(id);
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    pendentes.delete(id);
    return clearOriginal(id);
  }) as typeof clearTimeout;
  try {
    assertEquals(await comPrazo(() => Promise.resolve("ok"), 60_000), "ok");
    assertEquals(pendentes.size, 0);
    assertEquals(await comPrazo(() => Promise.reject(new Error("x")), 60_000), undefined);
    assertEquals(pendentes.size, 0);
  } finally {
    globalThis.setTimeout = setOriginal;
    globalThis.clearTimeout = clearOriginal;
    for (const id of pendentes) clearOriginal(id as number);
  }
});
