// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `order-cartao-repeticao.ts` — a única
 * repetição automática de uma cobrança de cartão (repetir quando não devia é
 * cobrar duas vezes). 33 mutantes plantados; 8 sobreviviam às 27 provas de
 * `order-cartao-repeticao_test.ts`:
 *
 *   * os seis códigos de validação de campo que autorizam a repetição valem um a
 *     um (a suíte só exercitava `property_value` e `property_type`), e qualquer
 *     outro código de erro (autorização, erro interno) NÃO autoriza;
 *   * uma recusa com `id: null` (a order não nasceu) autoriza; com `id` ou
 *     `data` preenchidos NÃO (a order pode existir: repetir cobraria duas vezes);
 *   * a repetição leva a chave de idempotência original com o sufixo `:r1`;
 *   * o log da repetição lista até 6 campos e deixa de fora os caminhos com
 *     índice de 3+ dígitos (podem carregar número de documento).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarOrderDeCartao, recusaApontaSoCamposOpcionais } from "./order-cartao-repeticao.ts";

const CHAVE = "11111111-2222-4333-8444-555555555555:c0";

const erro = (code: string, ...details: string[]) => ({ errors: [{ code, message: "invalid", details }] });

Deno.test("cada código de validação de campo autoriza a repetição; outro código de erro não", () => {
  for (
    const code of [
      "property_value",
      "property_type",
      "invalid_properties",
      "unsupported_properties",
      "maximum_items",
      "minimum_items",
    ]
  ) {
    assertEquals(
      recusaApontaSoCamposOpcionais(erro(code, "items[0].title must be at most 150 characters")),
      true,
      code,
    );
  }
  for (const code of ["unauthorized", "internal_error", "invalid_credentials", "bad_request", ""]) {
    assertEquals(
      recusaApontaSoCamposOpcionais(erro(code, "items[0].title must be at most 150 characters")),
      false,
      code,
    );
  }
});

Deno.test("recusa com `id` ou `data` preenchidos NÃO autoriza a repetição; null ou ausente sim", () => {
  const erros = erro("property_value", "items[0].title must be at most 150 characters").errors;
  assertEquals(recusaApontaSoCamposOpcionais({ errors: erros }), true);
  assertEquals(recusaApontaSoCamposOpcionais({ id: null, data: null, errors: erros }), true);
  assertEquals(recusaApontaSoCamposOpcionais({ id: "ORDTESTE", errors: erros }), false);
  assertEquals(recusaApontaSoCamposOpcionais({ data: { id: "ORDTESTE" }, errors: erros }), false);
  assertEquals(recusaApontaSoCamposOpcionais({ id: 0, errors: erros }), false);
});

function mpFalso(respostas: Array<{ status: number; corpo: unknown }>) {
  const chamadas: Array<{ chave: string | null }> = [];
  const fn = ((_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({ chave: headers["X-Idempotency-Key"] ?? null });
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(r.corpo), { status: r.status }));
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const corpo = () => ({
  type: "online",
  total_amount: "100.00",
  payer: { email: "comprador.falso@exemplo.test", phone: { area_code: "11", number: "987654321" } },
  items: [{ title: "Camiseta", unit_price: "100.00", quantity: 1 }],
  transactions: { payments: [{ amount: "100.00", payment_method: { id: "visa", type: "credit_card" } }] },
});

async function repetindo(detalhes: string[]) {
  const mp = mpFalso([
    { status: 400, corpo: erro("property_value", ...detalhes) },
    { status: 201, corpo: { id: "ORDTST01", status: "processed", status_detail: "accredited" } },
  ]);
  const avisos: unknown[][] = [];
  const original = [console.warn, console.error, console.log];
  console.warn = (...v: unknown[]) => avisos.push(v);
  console.error = console.log = () => {};
  try {
    await criarOrderDeCartao({
      token: "token-de-teste",
      corpo: corpo(),
      chaveIdempotencia: CHAVE,
      fetchImpl: mp.fn,
      deviceId: "device-falso.123",
      corpoNoLog: false,
    });
  } finally {
    [console.warn, console.error, console.log] = original;
  }
  return { mp, avisos };
}

Deno.test("a repetição usa exatamente a chave original com o sufixo ':r1'", async () => {
  const { mp } = await repetindo(["items[0].title must be at most 150 characters"]);
  assertEquals(mp.chamadas.map((c) => c.chave), [CHAVE, `${CHAVE}:r1`]);
});

Deno.test("o log da repetição lista até 6 campos, sem repetir, e deixa de fora caminho com índice de 3+ dígitos", async () => {
  const { avisos } = await repetindo([
    "items[0].title must be at most 150 characters",
    "items[100].title invalid",
    "items[0].description must be at most 100 characters",
    "items[0].unit_price invalid",
    "items[0].quantity invalid",
    "items[10].title invalid",
    "items[0].picture_url invalid",
    "items[0].category_id invalid",
    "items[0].title must be at most 150 characters",
  ]);
  const registro = avisos.find((a) => String(a[0]).includes("repetindo UMA vez"));
  const { campos } = JSON.parse(String(registro?.[1]));
  assertEquals(campos, [
    "items[0].title",
    "items[0].description",
    "items[0].unit_price",
    "items[0].quantity",
    "items[10].title",
    "items[0].picture_url",
  ]);
});
