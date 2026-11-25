// @ts-nocheck
/**
 * Caça por mutação (25/11/2026, segunda rodada) em `mercadopago.ts`: defeitos de
 * UMA linha que sobreviviam às cinco suítes `mercadopago_*_test.ts` (e ao resto
 * dos testes que importam o módulo) e que mexem em dinheiro ou na decisão de
 * cobrar de novo:
 *
 *   * QUAL order o sentinela do cartão grava quando a lista mistura morta e viva
 *     (created / processing / action_required): gravar a MORTA soltaria a vaga com
 *     a cobrança viva ainda em aberto — a segunda captura;
 *   * a margem de 15 s para liberar a vaga (exatamente 15 000 ms ainda NÃO libera;
 *     15 001 ms libera);
 *   * o limite inferior do sentinela de 1 ms e de zero;
 *   * o menor valor de cartão aceito (R$ 1,00 e R$ 0,50 valem; zero não);
 *   * a faixa do PIX em minutos (30 a 43 200; 43 201 e 29 não), em horas
 *     (720 vale, 721 não) e a mensagem de "expiração obrigatória";
 *   * a ASSINATURA do webhook (autenticação do Mercado Pago): um v1 que difere do
 *     HMAC certo em UM caractere — o PRIMEIRO, o do meio ou o último — nunca vale,
 *     e a comparação de tempo constante não pode pular o primeiro caractere; espaço
 *     em volta dos valores do header é ignorado (o valor é aparado), com o HMAC certo;
 *   * o valor da order (`extrairValorDaOrder`): a raiz manda quando é legível; senão o
 *     PRIMEIRO pagamento; nunca o segundo, nunca `null` virando zero;
 *   * o formato do token (16 a 128) e do método (2 a 30) do cartão, nos dois lados;
 *   * a busca de orders com resposta de erro (HTTP 500) e corpo que parece lista:
 *     é falha, nunca lista;
 *   * `paging.total` de um único algarismo como texto ("5"), que é legível;
 *   * o log sem dado pessoal: código com 64 caracteres passa, com 65 ou vazio não;
 *     um único campo recusado aparece; o sétimo é cortado; índice de 3 dígitos
 *     (valor colado no caminho) nunca aparece.
 *
 * Valores escritos à mão; fixtures inventadas.
 */
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buscarOrdersDoPedido,
  camposDaAssinatura,
  extrairValorDaOrder,
  limiteInferiorDoSentinela,
  metodoDeCartaoValido,
  MARGEM_LIBERAR_APOS_LIMITE_MS,
  minutosDaExpiracaoPix,
  montarCorpoCartaoOrders,
  montarCorpoPixOrders,
  montarSentinela,
  resolverSentinela,
  resumoSemDadoPessoal,
  tokenDeCartaoValido,
  validarAssinatura,
} from "./mercadopago.ts";

const LIMITE_MS = Date.parse("2026-09-26T12:10:00.000Z");

function ordemDeCartao(status: string, id: string, criadaEmMs: number | null = LIMITE_MS + 60_000) {
  return {
    id,
    status,
    status_detail: `${status}_detail`,
    ...(criadaEmMs !== null ? { date_created: new Date(criadaEmMs).toISOString() } : {}),
    transactions: { payments: [{ id: "PAY1", payment_method: { id: "x", type: "credit_card" } }] },
  };
}

// ─── resolverSentinela: a morta NUNCA ofusca a viva ──────────────────────────

Deno.test("resolverSentinela: lista MISTA morta + viva (qualquer dos três status vivos, em qualquer ordem) grava a VIVA, nunca a morta", () => {
  for (const vivo of ["created", "processing", "action_required"]) {
    const morta = ordemDeCartao("canceled", "ORD-MORTA");
    const viva = ordemDeCartao(vivo, "ORD-VIVA");
    assertEquals(resolverSentinela([morta, viva], LIMITE_MS), { acao: "gravar", order: viva }, `[morta, ${vivo}]`);
    assertEquals(resolverSentinela([viva, morta], LIMITE_MS), { acao: "gravar", order: viva }, `[${vivo}, morta]`);
  }
});

Deno.test("resolverSentinela: com viva e aprovada juntas, a APROVADA é a gravada (e a viva sozinha vale quando não há aprovada)", () => {
  const viva = ordemDeCartao("created", "ORD-VIVA");
  const aprovada = ordemDeCartao("processed", "ORD-APROVADA");
  assertEquals(resolverSentinela([viva, aprovada], LIMITE_MS), { acao: "gravar", order: aprovada });
  assertEquals(resolverSentinela([aprovada, viva], LIMITE_MS), { acao: "gravar", order: aprovada });
});

Deno.test("resolverSentinela: status desconhecido NÃO conta como vivo nem como morto — grava a PRIMEIRA order, mesmo com uma morta depois", () => {
  const desconhecida = ordemDeCartao("status_novo_do_mp", "ORD-DESCONHECIDA");
  const morta = ordemDeCartao("failed", "ORD-MORTA");
  assertEquals(resolverSentinela([desconhecida, morta], LIMITE_MS), { acao: "gravar", order: desconhecida });
});

// ─── a margem de 15 s para liberar ───────────────────────────────────────────

Deno.test("resolverSentinela: a margem para liberar é de 15 000 ms — exatamente no limite NÃO libera; 1 ms depois libera", () => {
  assertEquals(MARGEM_LIBERAR_APOS_LIMITE_MS, 15_000);
  const noLimite = ordemDeCartao("failed", "ORD-NO-LIMITE", LIMITE_MS + 15_000);
  assertEquals(resolverSentinela([noLimite], LIMITE_MS), null);
  const umMsDepois = ordemDeCartao("failed", "ORD-1MS-DEPOIS", LIMITE_MS + 15_001);
  assertEquals(resolverSentinela([umMsDepois], LIMITE_MS), { acao: "liberar" });
  const umMsAntes = ordemDeCartao("failed", "ORD-1MS-ANTES", LIMITE_MS + 14_999);
  assertEquals(resolverSentinela([umMsAntes], LIMITE_MS), null);
});

// ─── o limite inferior do sentinela ──────────────────────────────────────────

Deno.test("sentinela: o limite inferior de 1 ms volta como 1; zero e negativo viram null (não sei)", () => {
  assertEquals(limiteInferiorDoSentinela(montarSentinela("pedido:c0", 1)), 1);
  assertEquals(limiteInferiorDoSentinela(montarSentinela("pedido:c0", 1_790_000_000_000)), 1_790_000_000_000);
  assertEquals(limiteInferiorDoSentinela(montarSentinela("pedido:c0", 0)), null);
  assertEquals(limiteInferiorDoSentinela(montarSentinela("pedido:c0", -5)), null);
});

// ─── o menor valor de cartão ─────────────────────────────────────────────────

function argsCartao(valor: number) {
  return {
    orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    valor,
    email: "cliente@exemplo.com",
    documento: { type: "CPF", number: "12345678909" },
    token: "ff8080814c11e237014c1ff593b57b4d",
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 1,
  };
}

Deno.test("montarCorpoCartaoOrders: R$ 1,00 e R$ 0,50 são valores válidos (o corpo leva o valor em texto); zero e negativo lançam", () => {
  assertEquals(montarCorpoCartaoOrders(argsCartao(1)).total_amount, "1.00");
  assertEquals(montarCorpoCartaoOrders(argsCartao(0.5)).total_amount, "0.50");
  assertEquals(montarCorpoCartaoOrders(argsCartao(0.01)).total_amount, "0.01");
  assertThrows(() => montarCorpoCartaoOrders(argsCartao(0)), Error, "maior que zero");
  assertThrows(() => montarCorpoCartaoOrders(argsCartao(-1)), Error, "maior que zero");
});

// ─── a faixa de expiração do PIX ─────────────────────────────────────────────

function argsPix(expiracao: string) {
  return { valor: 100, email: "cliente@exemplo.com", orderId: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b", expiracao };
}

Deno.test("PIX: a faixa é de 30 a 43 200 minutos (720 horas); 29 min, 43 201 min e 721 h lançam", () => {
  assertEquals(montarCorpoPixOrders(argsPix("PT30M")).total_amount, "100.00");
  assertEquals(montarCorpoPixOrders(argsPix("PT43200M")).total_amount, "100.00");
  assertEquals(montarCorpoPixOrders(argsPix("PT720H")).total_amount, "100.00");
  assertThrows(() => montarCorpoPixOrders(argsPix("PT29M")), Error, "fora da faixa");
  assertThrows(() => montarCorpoPixOrders(argsPix("PT43201M")), Error, "fora da faixa");
  assertThrows(() => montarCorpoPixOrders(argsPix("PT721H")), Error, "fora da faixa");
});

Deno.test("PIX: expiração ilegível lança a mensagem de 'obrigatória', não a de faixa; o parser devolve null", () => {
  for (const ruim of ["", "30", "PT30S", "pt30m", "P1D", "PTM"]) {
    assertThrows(() => montarCorpoPixOrders(argsPix(ruim)), Error, "obrigatória", JSON.stringify(ruim));
    assertEquals(minutosDaExpiracaoPix(ruim), null, JSON.stringify(ruim));
  }
  assertEquals(minutosDaExpiracaoPix("PT43201M"), 43201);
  assertEquals(minutosDaExpiracaoPix("PT2H"), 120);
});

// ─── paging.total de um algarismo, como texto ────────────────────────────────

function ordensDoPedido(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `ORD${i}`, external_reference: "p" }));
}

function buscaComCorpo(corpo: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }))) as unknown as typeof fetch;
}

Deno.test("buscarOrdersDoPedido: paging.total '5' (um algarismo, em texto) é legível — 20 itens com total 5 é lista completa", async () => {
  const r = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(20), paging: { total: "5" } }),
  });
  assertEquals(r, { ok: true, orders: ordensDoPedido(20) });
});

Deno.test("buscarOrdersDoPedido: paging.total só de espaços NÃO é legível — 20 itens continuam lista incompleta", async () => {
  const r = await buscarOrdersDoPedido({
    token: "t",
    pedidoId: "p",
    desde: "d",
    fetchImpl: buscaComCorpo({ data: ordensDoPedido(20), paging: { total: "   " } }),
  });
  assertEquals(r, { ok: false });
});

// ─── o log sem dado pessoal ──────────────────────────────────────────────────

Deno.test("resumoSemDadoPessoal: código de 64 caracteres passa; de 65 e o vazio ficam de fora", () => {
  const sessentaEQuatro = "a".repeat(64);
  const resumo = JSON.parse(resumoSemDadoPessoal({
    errors: [{ code: sessentaEQuatro }, { code: "b".repeat(65) }, { code: "" }, { code: "ok_1" }],
  }));
  assertEquals(resumo.codigos, [sessentaEQuatro, "ok_1"]);
});

Deno.test("resumoSemDadoPessoal: UM campo recusado já aparece; o sétimo é cortado; índice de 3 dígitos nunca aparece", () => {
  const um = JSON.parse(resumoSemDadoPessoal({ errors: [{ code: "x", message: "payer.email invalido" }] }));
  assertEquals(um.campos, ["payer.email"]);

  const sete = JSON.parse(resumoSemDadoPessoal({
    errors: [{ code: "x", message: "payer.a payer.b payer.c payer.d payer.e payer.f payer.g" }],
  }));
  assertEquals(sete.campos, ["payer.a", "payer.b", "payer.c", "payer.d", "payer.e", "payer.f"]);

  const colado = JSON.parse(resumoSemDadoPessoal({
    errors: [{ code: "x", message: "items[123].title items[12].title" }],
  }));
  assertEquals(colado.campos, ["items[12].title"]);
});

// ─── o valor da order ────────────────────────────────────────────────────────

Deno.test("extrairValorDaOrder: raiz em texto ou número manda; ilegível cai no PRIMEIRO pagamento; nada legível = undefined", () => {
  assertEquals(extrairValorDaOrder({ total_amount: "50.00" }), 50);
  assertEquals(extrairValorDaOrder({ total_amount: 149.9 }), 149.9);
  // raiz ilegível (texto, infinito) ou ausente (null, ausente): o primeiro pagamento
  const pagamentos = { payments: [{ amount: "30.50" }, { amount: "99.00" }] };
  assertEquals(extrairValorDaOrder({ total_amount: "abc", transactions: pagamentos }), 30.5);
  assertEquals(extrairValorDaOrder({ total_amount: Infinity, transactions: pagamentos }), 30.5);
  assertEquals(extrairValorDaOrder({ total_amount: null, transactions: pagamentos }), 30.5);
  assertEquals(extrairValorDaOrder({ transactions: pagamentos }), 30.5);
  assertEquals(extrairValorDaOrder({ transactions: { payments: [{ amount: 12 }] } }), 12);
  // nunca o segundo pagamento, e nunca `null` virando zero (pedido de graça)
  assertEquals(extrairValorDaOrder({ transactions: { payments: [{}, { amount: "99.00" }] } }), undefined);
  assertEquals(extrairValorDaOrder({ total_amount: null, transactions: { payments: [{ amount: null }] } }), undefined);
  assertEquals(extrairValorDaOrder({ total_amount: "abc", transactions: { payments: [{ amount: "xyz" }] } }), undefined);
  assertEquals(extrairValorDaOrder({}), undefined);
  assertEquals(extrairValorDaOrder({ total_amount: {}, transactions: { payments: [{ amount: true }] } }), undefined);
});

// ─── formato do token e do método do cartão ──────────────────────────────────

Deno.test("tokenDeCartaoValido: 16 a 128 letras, dígitos e hífen; 15 e 129 não; caractere fora do conjunto não", () => {
  assertEquals(tokenDeCartaoValido("a".repeat(15)), false);
  assertEquals(tokenDeCartaoValido("a".repeat(16)), true);
  assertEquals(tokenDeCartaoValido("A1-".repeat(42) + "ab"), true); // 128
  assertEquals(tokenDeCartaoValido("a".repeat(128)), true);
  assertEquals(tokenDeCartaoValido("a".repeat(129)), false);
  assertEquals(tokenDeCartaoValido("a".repeat(15) + "_"), false);
  assertEquals(tokenDeCartaoValido(1234567890123456), false);
});

Deno.test("metodoDeCartaoValido: 2 a 30 caracteres [a-z0-9_]; 1 e 31 não; maiúscula não", () => {
  assertEquals(metodoDeCartaoValido("a"), false);
  assertEquals(metodoDeCartaoValido("ab"), true);
  assertEquals(metodoDeCartaoValido("a".repeat(30)), true);
  assertEquals(metodoDeCartaoValido("a".repeat(31)), false);
  assertEquals(metodoDeCartaoValido("Master"), false);
  assertEquals(metodoDeCartaoValido(""), false);
});

// ─── busca de orders: erro HTTP com corpo de lista ───────────────────────────

Deno.test("buscarOrdersDoPedido: HTTP 500 com corpo que PARECE lista completa continua falha (ok:false), nunca lista", async () => {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: ordensDoPedido(2), paging: { total: 2 } }), { status: 500 }),
    )) as unknown as typeof fetch;
  const r = await buscarOrdersDoPedido({ token: "t", pedidoId: "p", desde: "d", fetchImpl });
  assertEquals(r, { ok: false });
});

// ─── a assinatura do webhook ─────────────────────────────────────────────────

const SEGREDO = "segredo-de-teste";
const TS = 1700000000;
const DATA_ID = "12345";
const REQUEST_ID = "abc-123";
// Mesmo vetor de `mercadopago_assinatura_test.ts`: gerado FORA do código, com o
// manifesto `id:12345;request-id:abc-123;ts:1700000000;` e o segredo acima.
const V1_VALIDO = "5bad78f1f0f10eb98d20496b6b8330f24a7469884503659db81991a37b30de40";
const AGORA = (TS + 10) * 1000;

function validar(xSignature: string) {
  return validarAssinatura({
    xSignature,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: AGORA,
  });
}

Deno.test("assinatura: o vetor certo vale (controle dos testes abaixo)", async () => {
  assert(await validar(`ts=${TS},v1=${V1_VALIDO}`));
});

Deno.test("assinatura: UM caractere diferente em QUALQUER posição (primeiro, segundo, meio, penúltimo, último) recusa", async () => {
  const posicoes = [0, 1, 31, 62, 63];
  for (const i of posicoes) {
    const trocado = V1_VALIDO[i] === "0" ? "1" : "0";
    const adulterado = V1_VALIDO.slice(0, i) + trocado + V1_VALIDO.slice(i + 1);
    assertEquals(adulterado.length, 64);
    assertEquals(await validar(`ts=${TS},v1=${adulterado}`), false, `posição ${i}`);
  }
});

Deno.test("assinatura: v1 mais curto ou mais comprido que o HMAC (63 e 65 caracteres) recusa", async () => {
  assertEquals(await validar(`ts=${TS},v1=${V1_VALIDO.slice(0, 63)}`), false);
  assertEquals(await validar(`ts=${TS},v1=${V1_VALIDO.slice(1)}`), false);
  assertEquals(await validar(`ts=${TS},v1=${V1_VALIDO}0`), false);
  assertEquals(await validar(`ts=${TS},v1=0${V1_VALIDO}`), false);
});

Deno.test("assinatura: espaço em volta de chaves e valores do header é ignorado — com o HMAC certo vale", async () => {
  assert(await validar(`ts=${TS}, v1=${V1_VALIDO}`));
  assert(await validar(`ts=${TS},v1=${V1_VALIDO} `));
  assert(await validar(` ts = ${TS} , v1 = ${V1_VALIDO} `));
  assertEquals(camposDaAssinatura(" ts = 12 , v1 = abc "), { ts: "12", v1: "abc" });
  assertEquals(camposDaAssinatura("ts=12"), { ts: "12", v1: null });
  assertEquals(camposDaAssinatura(null), { ts: null, v1: null });
});
