import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  executarEstorno,
  linhaJaTeveEnvio,
  type LinhaEstorno,
  MOTIVO_REENVIO_JA_NO_MP,
  MOTIVO_REENVIO_SEM_CONSULTA,
  type PedidoParaEstorno,
  TETO_DE_TENTATIVAS_DO_POST,
} from "./estorno.ts";

/**
 * A1 do crítico de desenho do reembolso A/B (15/10/2026): o REENVIO de um
 * reembolso não sai sem antes perguntar ao Mercado Pago.
 *
 * O buraco: a chave de idempotência do MP (`X-Idempotency-Key` = id da linha)
 * só vale 24 h. Uma linha `em_processamento` que JÁ teve envio pode ter criado o
 * reembolso no MP sem a resposta chegar (o POST estourou o tempo). Repetir o POST
 * depois de 24 h cria um SEGUNDO reembolso: a cliente recebe em dobro (pedido de
 * R$200, devolução de R$50: REF1 no dia 1, REF2 no dia 3).
 *
 * A regra (no executor, um lugar para os dois chamadores — clique e robô): linha
 * que já teve envio só recebe POST depois de `consultarReembolsoDoPedido`
 * responder `nao_achou`. `achou` adota (conclui pelo reembolso que o MP já fez);
 * `indeterminado` (GET falhou, corpo ilegível, tempo esgotado, reembolso em
 * andamento) não envia nada. Linha nova continua enviando sem consulta.
 *
 * O dublê do MP é um GUARDIÃO: nos cenários em que a consulta NÃO disse
 * `nao_achou`, todo POST de reembolso que chega a ele é uma VIOLAÇÃO registrada
 * (e respondida com 201, como o MP de verdade responderia — o REF2). O teste
 * reprova pela violação, nunca pelo desfecho: um mutante que pula a consulta
 * receberia `concluido` e passaria por um teste que só olhasse o resultado.
 */

const TOKEN = "TESTE_TOKEN";
const PAGAMENTO = "123456789";
const ORDER = "ORD01ABCDEFOLUIMWQKDXYZ01";
const ID_LINHA = "11111111-1111-4111-8111-111111111111";

/** A linha COMO O EXECUTOR A RECEBE: a marca deste ciclo já somada em `tentativas`. */
function linhaReenviada(extras: Partial<LinhaEstorno> = {}): LinhaEstorno {
  return {
    id: ID_LINHA,
    order_id: "22222222-2222-4222-8222-222222222222",
    amount: 50,
    status: "em_processamento",
    mp_refund_id: null,
    // 1 envio anterior + a marca deste ciclo.
    tentativas: 2,
    criada_sob_autorizacao: true,
    post_autorizado_em: "2026-10-12T10:00:00.000Z",
    ...extras,
  };
}

function linhaNova(extras: Partial<LinhaEstorno> = {}): LinhaEstorno {
  return linhaReenviada({ tentativas: 1, post_autorizado_em: null, ...extras });
}

function pedidoPayments(extras: Partial<PedidoParaEstorno> = {}): PedidoParaEstorno {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    gateway_payment_id: PAGAMENTO,
    total: 200,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: "delivered",
    ...extras,
  };
}

const CONSULTA_NAO_ACHOU = { id: Number(PAGAMENTO), status: "approved", transaction_amount_refunded: 0, refunds: [] };
const CONSULTA_ACHOU = {
  id: Number(PAGAMENTO),
  status: "approved",
  transaction_amount_refunded: 50,
  refunds: [{ id: 7001, status: "approved", amount: 50, date_created: "2026-10-12T10:00:05.000Z" }],
};

type RespostaDoGet = { status: number; corpo: unknown } | "lanca_tempo_esgotado";

/**
 * O MP dublado. `gets` é a sequência de respostas aos GETs (a última se repete).
 * `postProibido`: todo POST de reembolso vira violação registrada.
 */
function mpGuardiao(gets: RespostaDoGet[], opts: { postProibido: boolean }) {
  const chamadas: { url: string; metodo: string; chave?: string }[] = [];
  const violacoes: string[] = [];
  let i = 0;
  const f: typeof fetch = (entrada, init) => {
    const url = typeof entrada === "string" ? entrada : String(entrada instanceof URL ? entrada.href : entrada.url);
    const metodo = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({ url, metodo, chave: headers["X-Idempotency-Key"] });
    if (metodo === "POST" && /\/refunds?$/.test(url)) {
      if (opts.postProibido) violacoes.push(`POST de reembolso sem a consulta dizer nao_achou: ${url}`);
      return Promise.resolve(
        new Response(JSON.stringify({ id: 9999, status: "approved", amount: 50 }), { status: 201 }),
      );
    }
    if (metodo === "GET") {
      const r = gets[Math.min(i, gets.length - 1)];
      i++;
      if (r === "lanca_tempo_esgotado") {
        return Promise.reject(new DOMException("Signal timed out.", "TimeoutError"));
      }
      return Promise.resolve(
        new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), { status: r.status }),
      );
    }
    return Promise.resolve(new Response("", { status: 500 }));
  };
  const posts = () => chamadas.filter((c) => c.metodo === "POST");
  const gets_ = () => chamadas.filter((c) => c.metodo === "GET");
  return { f, chamadas, violacoes, posts, gets: gets_ };
}

function executar(
  linha: LinhaEstorno,
  f: typeof fetch,
  extras: Partial<Parameters<typeof executarEstorno>[0]> = {},
) {
  const pedido = extras.pedido ?? pedidoPayments();
  return executarEstorno({
    linha,
    pedido,
    token: TOKEN,
    buscar: f,
    consultarTransacaoDaOrder: () => Promise.resolve("PAY01XYZEXEMPLODETRANSA1"),
    idsJaReivindicados: [],
    autorizarAntesDoPost: () => Promise.resolve({ decisao: "autorizado", pedido }),
    ...extras,
  });
}

// ---------------------------------------------------------------------------
// O critério "já teve envio" (a linha como o executor a recebe)
// ---------------------------------------------------------------------------

Deno.test("REENVIO-0 - critério: carimbo, id do MP ou marca anterior = já teve envio; só a marca deste ciclo = nova", () => {
  assertEquals(linhaJaTeveEnvio(linhaNova()), false, "tentativas 1 (só a marca deste ciclo), sem carimbo");
  assertEquals(linhaJaTeveEnvio(linhaNova({ tentativas: 0 })), false);
  assertEquals(linhaJaTeveEnvio(linhaNova({ post_autorizado_em: "2026-10-12T10:00:00Z" })), true, "carimbo");
  assertEquals(linhaJaTeveEnvio(linhaNova({ mp_refund_id: "7001" })), true, "id do MP");
  assertEquals(linhaJaTeveEnvio(linhaNova({ tentativas: 2 })), true, "marca anterior, mesmo sem carimbo");
  assertEquals(linhaJaTeveEnvio(linhaNova({ tentativas: 2, criada_sob_autorizacao: null })), true, "legado");
  assertEquals(TETO_DE_TENTATIVAS_DO_POST, 5, "o teto do robô não mudou");
});

// ---------------------------------------------------------------------------
// (a) envio anterior + consulta nao_achou -> exatamente 1 POST, depois do GET
// ---------------------------------------------------------------------------

Deno.test("REENVIO-A - envio anterior + consulta nao_achou: 1 POST com a mesma chave, DEPOIS da consulta", async () => {
  const mp = mpGuardiao([{ status: 200, corpo: CONSULTA_NAO_ACHOU }], { postProibido: false });
  const r = await executar(linhaReenviada(), mp.f);
  assertEquals(r.tipo, "concluido");
  assertEquals(mp.posts().length, 1);
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET", "POST"], "a consulta vem ANTES do POST");
  assertEquals(mp.chamadas[0].url, `https://api.mercadopago.com/v1/payments/${PAGAMENTO}`);
  assertEquals(mp.posts()[0].chave, ID_LINHA);
});

Deno.test("REENVIO-A2 - marca anterior SEM carimbo (tentativas 2, nunca autorizada) também consulta antes; nao_achou libera", async () => {
  const mp = mpGuardiao([{ status: 200, corpo: CONSULTA_NAO_ACHOU }], { postProibido: false });
  const r = await executar(linhaReenviada({ post_autorizado_em: null, tentativas: 2 }), mp.f);
  assertEquals(r.tipo, "concluido");
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET", "POST"]);
});

// ---------------------------------------------------------------------------
// (b) envio anterior + consulta achou -> NÃO envia, adota o reembolso do MP
// ---------------------------------------------------------------------------

Deno.test("REENVIO-B - envio anterior + o MP JÁ fez o reembolso (REF1): ZERO POST, conclui adotando o id do MP", async () => {
  const mp = mpGuardiao([{ status: 200, corpo: CONSULTA_ACHOU }], { postProibido: true });
  const r = await executar(linhaReenviada(), mp.f);
  assertEquals(mp.violacoes, [], "nenhum POST de reembolso: seria o REF2, dinheiro em dobro");
  assertEquals(mp.posts().length, 0);
  assertEquals(r.tipo, "concluido");
  if (r.tipo === "concluido") {
    assertEquals(r.mp_refund_id, "7001");
    assertEquals(r.valor, 50);
  }
});

Deno.test("REENVIO-B2 - achou na consulta, mas a confirmação seguinte não fecha (GET 500): ZERO POST, fica para depois", async () => {
  const mp = mpGuardiao(
    [{ status: 200, corpo: CONSULTA_ACHOU }, { status: 500, corpo: {} }],
    { postProibido: true },
  );
  const r = await executar(linhaReenviada(), mp.f);
  assertEquals(mp.violacoes, []);
  assertEquals(r.tipo, "tentar_depois");
  if (r.tipo === "tentar_depois") assertEquals(r.motivo, MOTIVO_REENVIO_JA_NO_MP);
});

// ---------------------------------------------------------------------------
// (c) envio anterior + consulta sem resposta clara -> NÃO envia
// ---------------------------------------------------------------------------

const INDETERMINADOS: Array<[string, RespostaDoGet]> = [
  ["GET 500", { status: 500, corpo: { message: "erro" } }],
  ["GET 401", { status: 401, corpo: { message: "unauthorized" } }],
  ["corpo ilegível", { status: 200, corpo: "<html>gateway</html>" }],
  ["tempo esgotado", "lanca_tempo_esgotado"],
  ["acumulado ausente (não sei quanto já voltou)", { status: 200, corpo: { id: 1, status: "approved" } }],
  ["acumulado que não bate com a lista", { status: 200, corpo: { id: 1, status: "approved", transaction_amount_refunded: 50, refunds: [] } }],
];

for (const [nome, resposta] of INDETERMINADOS) {
  Deno.test(`REENVIO-C - envio anterior + consulta indeterminada (${nome}): ZERO POST, tentar_depois sem diagnóstico`, async () => {
    const mp = mpGuardiao([resposta], { postProibido: true });
    const r = await executar(linhaReenviada(), mp.f);
    assertEquals(mp.violacoes, [], "nenhum POST de reembolso");
    assertEquals(mp.posts().length, 0);
    assertEquals(r.tipo, "tentar_depois");
    if (r.tipo === "tentar_depois") {
      assertEquals(r.motivo, MOTIVO_REENVIO_SEM_CONSULTA);
      // Nada foi enviado: nenhum diagnóstico de POST (nem carimbo, nem contagem).
      assertEquals(r.diagnostico, undefined);
    }
  });
}

Deno.test("REENVIO-C2 - pedido PIX (order) com o reembolso anterior AINDA em andamento no MP: ZERO POST", async () => {
  const pedido = pedidoPayments({ gateway_payment_id: ORDER });
  const mp = mpGuardiao([{
    status: 200,
    corpo: {
      id: ORDER,
      status: "processed",
      status_detail: "accredited",
      // A forma que a casa lê (`refundsDaOrder`): reembolsos em transactions.refunds.
      transactions: {
        payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
        refunds: [{ id: "REF1", status: "processing", amount: "50.00" }],
      },
    },
  }], { postProibido: true });
  const r = await executar(linhaReenviada(), mp.f, { pedido });
  assertEquals(mp.violacoes, []);
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(mp.gets().length, 1);
  assertEquals(mp.gets()[0].url, `https://api.mercadopago.com/v1/orders/${ORDER}`);
});

Deno.test("REENVIO-C3 - sem a lista dos ids já reivindicados não se sabe de quem é cada reembolso: ZERO chamada, nada enviado", async () => {
  const mp = mpGuardiao([{ status: 200, corpo: CONSULTA_NAO_ACHOU }], { postProibido: true });
  const r = await executar(linhaReenviada(), mp.f, { idsJaReivindicados: undefined });
  assertEquals(mp.violacoes, []);
  assertEquals(mp.chamadas.length, 0);
  assertEquals(r.tipo, "tentar_depois");
});

Deno.test("REENVIO-C4 - a consulta vem ANTES da autorização do banco: indeterminada, o banco nem é perguntado (o carimbo não se renova)", async () => {
  const mp = mpGuardiao([{ status: 500, corpo: {} }], { postProibido: true });
  let perguntas = 0;
  const pedido = pedidoPayments();
  const r = await executar(linhaReenviada(), mp.f, {
    autorizarAntesDoPost: () => {
      perguntas++;
      return Promise.resolve({ decisao: "autorizado", pedido });
    },
  });
  assertEquals(mp.violacoes, []);
  assertEquals(r.tipo, "tentar_depois");
  assertEquals(perguntas, 0);
});

// ---------------------------------------------------------------------------
// (e) controle: linha NOVA envia como hoje, sem consulta extra
// ---------------------------------------------------------------------------

Deno.test("REENVIO-E - linha NOVA (só a marca deste ciclo, sem carimbo): POST direto, ZERO GET (o 1º envio não fica mais lento)", async () => {
  const mp = mpGuardiao([{ status: 500, corpo: {} }], { postProibido: false });
  const r = await executar(linhaNova(), mp.f);
  assertEquals(r.tipo, "concluido");
  assertEquals(mp.chamadas.map((c) => c.metodo), ["POST"]);
});

Deno.test("REENVIO-E2 - linha NOVA de pedido PIX (order): só o POST ao MP (a transação vem da consulta injetada de sempre)", async () => {
  const pedido = pedidoPayments({ gateway_payment_id: ORDER });
  const mp = mpGuardiao([{ status: 500, corpo: {} }], { postProibido: false });
  await executar(linhaNova(), mp.f, { pedido });
  assertEquals(mp.gets().length, 0);
  assertEquals(mp.posts().length, 1);
  assertStringIncludes(mp.posts()[0].url, `/v1/orders/${ORDER}/refund`);
});
