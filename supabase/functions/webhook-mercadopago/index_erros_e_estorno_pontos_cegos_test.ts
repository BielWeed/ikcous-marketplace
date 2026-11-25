/**
 * Pontos cegos do webhook-mercadopago achados por mutação (caça "só testes").
 *
 * Cada teste daqui existe porque um defeito plantado no `index.ts` (uma
 * comparação invertida, um `&&` no lugar do `||`, um `500` trocado por `200`)
 * deixava a suíte vizinha verde. Os grupos:
 *
 *  1. ENTRADA e ERRO — o MP só reenvia o evento se receber 5xx. Um 200 num
 *     ramo de falha significa "evento tratado" e o pagamento nunca mais
 *     chega: data.id vazio/nulo, JSON inválido, sem token, falha ao
 *     recuperar contestação, reconsulta da cobrança gravada que falha,
 *     adoção do cartão que falha, releitura do saldo ilegível.
 *  2. ESTORNO — id do refund NUMÉRICO (a API clássica manda número), refund
 *     já reivindicado por outra linha, acumulado em texto, linha mais velha
 *     primeiro, e a guarda "estorno de cobrança órfã": o aviso ao admin tem
 *     de sair, e a cobrança gravada que MESMO assim mostra devolução parcial
 *     tem de ser registrada.
 *  3. AVISO de valor divergente e corrida de adoção com vaga em branco.
 *
 * O dublê de banco é PRÓPRIO (o do `index_test.ts` não é exportado): guarda
 * várias linhas por tabela e HONRA `.eq`/`.is` de verdade. Nada toca rede nem
 * banco real; todos os ids e chaves são inventados.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-webhook-teste";
const UUID_PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ID_ORDER_TESTE = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const ID_GRAVADA = "ORDGRAVADA1KZZ4D94WC79335A68CZ5N";

type Linha = Record<string, unknown>;
type Filtro = { tipo: "eq" | "is"; coluna: string; valor: unknown };

async function comAmbiente<T>(ajuste: Record<string, string | null>, fn: () => Promise<T>): Promise<T> {
  const base: Record<string, string | null> = {
    MP_WEBHOOK_SECRET: SEGREDO,
    MP_ACCESS_TOKEN: "token-de-teste",
    ...ajuste,
  };
  const anteriores = Object.keys(base).map((k) => [k, Deno.env.get(k)] as const);
  for (const [k, v] of Object.entries(base)) {
    if (v === null) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of anteriores) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

async function semLogs<T>(fn: () => Promise<T>): Promise<T> {
  const reais = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = reais.log;
    console.warn = reais.warn;
    console.error = reais.error;
  }
}

// ── assinatura (regra do manifesto do MP, escrita independente da produção) ──

async function assinar(dataId: string, ts: number, xRequestId: string): Promise<string> {
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SEGREDO),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  return Array.from(new Uint8Array(assinado)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Notificação com assinatura VÁLIDA para `dataId` (o que for no corpo). */
async function notificacao(dataId: string, tipo: string): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-pontos-cegos";
  const v1 = await assinar(dataId, ts, requestId);
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ type: tipo, data: { id: dataId } }),
  });
}

/** Corpo cru (inclusive inválido), COM os cabeçalhos de assinatura bem formados. */
function requisicaoCrua(corpoTexto: string): Request {
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=1700000000,v1=${"a".repeat(64)}`,
      "x-request-id": "req-crua",
    },
    body: corpoTexto,
  });
}

/** `fetch` que roteia a consulta ao MP por caminho: /v1/payments/ e /v1/orders/. */
function fetchDoMp(rotas: {
  pagamento?: { status?: number; corpo: Record<string, unknown> };
  order?: { status?: number; corpo: Record<string, unknown> };
}) {
  const urls: string[] = [];
  const fn = (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    urls.push(u);
    const rota = u.includes("/v1/payments/") ? rotas.pagamento : u.includes("/v1/orders/") ? rotas.order : undefined;
    if (!rota) return Promise.resolve(new Response(JSON.stringify({ message: "fora do roteiro" }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(rota.corpo), { status: rota.status ?? 200 }));
  };
  return { fn: fn as typeof fetch, urls };
}

// ── dublê de banco: várias linhas por tabela, filtros honrados de verdade ────

function casa(linha: Linha, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    const atual = Reflect.get(linha, f.coluna);
    return f.tipo === "is" ? (atual ?? null) === f.valor : atual === f.valor;
  });
}

function projetar(linha: Linha, colunas: string): Linha {
  if (colunas.trim() === "*") return { ...linha };
  const pedidas = new Set(colunas.split(",").map((c) => c.trim()).filter((c) => c.length > 0));
  return Object.fromEntries(Object.entries(linha).filter(([chave]) => pedidas.has(chave)));
}

type OpcoesDoBanco = {
  pedidos: Linha[];
  ledger?: Linha[];
  resultadoConfirmar?: string;
  /** Retorno de `registrar_estorno_externo_do_mp` (padrão: inserido). */
  resultadoExterno?: Linha;
  /** Retorno de `concluir_estorno` (padrão: concluiu agora). */
  retornoConcluir?: Linha;
  /** Erro devolvido pelo UPDATE em `marketplace_orders` (a adoção do cartão). */
  erroNaAdocao?: unknown;
  /** Dispara logo DEPOIS da leitura única do pedido que decide a adoção (a corrida). */
  aposLeituraDoPedido?: (pedido: Linha) => void;
  /** Faz a RELEITURA de `valor_estornado` (select só dessa coluna) devolver isto. */
  valorEstornadoRelido?: unknown;
  /** Faz `from(tabela)` lançar para toda tabela fora de app_settings. */
  tudoLanca?: boolean;
  /** Retorno de `liberar_cobranca_do_pedido` (padrão: true). */
  liberarResultado?: boolean;
};

function bancoFalso(opts: OpcoesDoBanco) {
  const ledger = opts.ledger ?? [];
  const tentativasDeUpdate: Array<{ tabela: string; valores: Linha; filtros: Filtro[]; linhasAtingidas: number }> = [];
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const avisos = new Map<string, { enviado: boolean }>();
  const diagnosticos: Linha[] = [];

  const tabelaDe = (nome: string): Linha[] => {
    if (nome === "marketplace_orders") return opts.pedidos;
    if (nome === "order_refunds") return ledger;
    throw new Error(`tabela inesperada nos testes: ${nome}`);
  };

  const rpc = (nome: string, args: Record<string, unknown>) => {
    chamadasRpc.push({ nome, args });
    if (nome === "confirmar_pagamento") {
      return Promise.resolve({ data: opts.resultadoConfirmar ?? "pago", error: null });
    }
    if (nome === "liberar_cobranca_do_pedido") {
      return Promise.resolve({ data: opts.liberarResultado ?? true, error: null });
    }
    if (nome === "registrar_estorno_externo_do_mp") {
      return Promise.resolve({
        data: opts.resultadoExterno ?? {
          resultado: "inserido",
          aviso: null,
          valor_estornado: 60,
          em_voo: 0,
          disponivel: 0,
        },
        error: null,
      });
    }
    if (nome === "concluir_estorno") {
      return Promise.resolve({ data: opts.retornoConcluir ?? { ja_concluida: false }, error: null });
    }
    if (nome === "reservar_aviso_ao_lojista") {
      const chave = String(args.p_chave);
      const existente = avisos.get(chave);
      if (existente) return Promise.resolve({ data: existente.enviado ? "enviado" : "em_envio", error: null });
      avisos.set(chave, { enviado: false });
      return Promise.resolve({ data: "reservado", error: null });
    }
    if (nome === "confirmar_aviso_ao_lojista") {
      const existente = avisos.get(String(args.p_chave));
      if (existente) existente.enviado = true;
      return Promise.resolve({ data: Boolean(existente), error: null });
    }
    if (nome === "liberar_aviso_ao_lojista") {
      return Promise.resolve({ data: avisos.delete(String(args.p_chave)), error: null });
    }
    throw new Error(`rpc inesperada nos testes: ${nome}`);
  };

  const from = (tabela: string) => {
    if (tabela === "app_settings") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    }
    if (tabela === "tentativas_cartao_diagnostico") {
      return {
        upsert: (linha: Linha) => {
          diagnosticos.push(linha);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (opts.tudoLanca) throw new Error(`queda simulada do banco em ${tabela}`);
    const linhas = tabelaDe(tabela);
    return {
      select(colunas: string) {
        const filtros: Filtro[] = [];
        const cadeia = {
          eq(coluna: string, valor: unknown) {
            filtros.push({ tipo: "eq", coluna, valor });
            return cadeia;
          },
          is(coluna: string, valor: null) {
            filtros.push({ tipo: "is", coluna, valor });
            return cadeia;
          },
          maybeSingle() {
            const achada = linhas.find((l) => casa(l, filtros)) ?? null;
            let dados = achada ? projetar(achada, colunas) : null;
            if (
              tabela === "marketplace_orders" && achada && opts.valorEstornadoRelido !== undefined &&
              colunas.trim() === "valor_estornado"
            ) {
              dados = { valor_estornado: opts.valorEstornadoRelido };
            }
            if (
              tabela === "marketplace_orders" && achada && opts.aposLeituraDoPedido &&
              colunas.includes("total_amount") && colunas.includes("gateway_payment_id")
            ) {
              opts.aposLeituraDoPedido(achada);
            }
            return Promise.resolve({ data: dados, error: null });
          },
          then(resolveu: (v: unknown) => unknown, rejeitou: (e: unknown) => unknown) {
            const copia = linhas.filter((l) => casa(l, filtros)).map((l) => projetar(l, colunas));
            return Promise.resolve({ data: copia, error: null }).then(resolveu, rejeitou);
          },
        };
        return cadeia;
      },
      update(valores: Linha) {
        const filtros: Filtro[] = [];
        const cadeia = {
          eq(coluna: string, valor: unknown) {
            filtros.push({ tipo: "eq", coluna, valor });
            return cadeia;
          },
          is(coluna: string, valor: null) {
            filtros.push({ tipo: "is", coluna, valor });
            return cadeia;
          },
          select(_colunas: string) {
            return {
              maybeSingle() {
                if (tabela === "marketplace_orders" && opts.erroNaAdocao) {
                  return Promise.resolve({ data: null, error: opts.erroNaAdocao });
                }
                const alvos = linhas.filter((l) => casa(l, filtros));
                for (const alvo of alvos) Object.assign(alvo, valores);
                tentativasDeUpdate.push({ tabela, valores, filtros: [...filtros], linhasAtingidas: alvos.length });
                return Promise.resolve({ data: alvos[0] ? { id: alvos[0].id } : null, error: null });
              },
            };
          },
        };
        return cadeia;
      },
    };
  };

  return {
    supabase: { rpc, from },
    ledger,
    pedidos: opts.pedidos,
    tentativasDeUpdate,
    chamadasRpc,
    diagnosticos,
    rpcsDe: (nome: string) => chamadasRpc.filter((c) => c.nome === nome),
    atingidas: (tabela: string) => tentativasDeUpdate.filter((t) => t.tabela === tabela && t.linhasAtingidas > 0),
  };
}

const semAvisos = {
  enviarPush: async () => {},
  enviarComprovante: async () => {},
  enviarAvisoAtrasado: async () => {},
  enviarPushContado: () => Promise.resolve(1),
  dormir: () => Promise.resolve(),
};

// ═══ 1. ENTRADA E ERRO: sem 5xx o MP nunca reenvia ═════════════════════════════

Deno.test("corpo que não é JSON: 400 (nunca 200), antes de qualquer leitura de banco", async () => {
  const banco = bancoFalso({ pedidos: [] });
  const r = await semLogs(() => handler(requisicaoCrua("isto nao e json {"), { supabase: banco.supabase } as never));
  assertEquals(r.status, 400);
  assertEquals((await r.json()).error, "Corpo inválido.");
  assertEquals(banco.chamadasRpc, []);
});

for (const [rotulo, dataId] of [["null", null], ["string vazia", ""], ["ausente", undefined]] as const) {
  Deno.test(`data.id ${rotulo}: 400 'data.id ausente' (não segue para a assinatura nem para o banco)`, async () => {
    const banco = bancoFalso({ pedidos: [] });
    const corpo = dataId === undefined ? { type: "payment", data: {} } : { type: "payment", data: { id: dataId } };
    const r = await semLogs(() =>
      handler(requisicaoCrua(JSON.stringify(corpo)), { supabase: banco.supabase } as never)
    );
    assertEquals(r.status, 400);
    assertEquals((await r.json()).error, "data.id ausente.");
    assertEquals(banco.chamadasRpc, []);
  });
}

Deno.test("sem MP_ACCESS_TOKEN (loja sem cadastro): assinatura válida mas SEM como consultar o MP -> 500, o MP reenvia; nada é confirmado", async () => {
  await comAmbiente({ MP_ACCESS_TOKEN: null }, async () => {
    const banco = bancoFalso({ pedidos: [] });
    const mp = fetchDoMp({});
    const r = await semLogs(async () =>
      handler(await notificacao("12345", "payment"), { supabase: banco.supabase, fetchImpl: mp.fn, ...semAvisos } as never)
    );
    assertEquals(r.status, 500);
    assertEquals((await r.json()).error, "Credencial do Mercado Pago indisponível.");
    // Sem token não se pergunta nada ao MP e nada vira 'pago'.
    assertEquals(mp.urls, []);
    assertEquals(banco.chamadasRpc, []);
  });
});

Deno.test("notificação de contestação (topic_chargebacks_wh) cuja recuperação FALHA: 500, o evento fica na fila do MP", async () => {
  await comAmbiente({}, async () => {
    const banco = bancoFalso({ pedidos: [], tudoLanca: true });
    const mp = fetchDoMp({});
    const r = await semLogs(async () =>
      handler(await notificacao("CBK-CASO-1", "topic_chargebacks_wh"), {
        supabase: banco.supabase,
        fetchImpl: mp.fn,
        vendedorId: "vendedor-teste",
        ...semAvisos,
      } as never)
    );
    assertEquals(r.status, 500);
    assertEquals((await r.json()).error, "Erro ao recuperar a contestação.");
    assertEquals(banco.rpcsDe("confirmar_pagamento"), []);
  });
});

// ═══ 2. ESTORNO ════════════════════════════════════════════════════════════════

function pedidoPago(extra: Linha = {}): Linha {
  return {
    id: UUID_PEDIDO,
    gateway_payment_id: "999",
    total: 100,
    total_amount: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-10-01T00:00:00.000Z",
    status: "delivered",
    ...extra,
  };
}

function linhaDoLedger(id: string, extra: Linha = {}): Linha {
  return {
    id,
    order_id: UUID_PEDIDO,
    amount: 30,
    status: "concluido",
    solicitado_por: "lojista",
    mp_refund_id: null,
    mp_chargeback_id: null,
    tentativas: 1,
    mp_status: "approved",
    concluido_em: "2026-10-01T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

async function entregarPagamentoClassico(
  banco: ReturnType<typeof bancoFalso>,
  corpoDoPagamento: Record<string, unknown>,
) {
  return await comAmbiente({}, async () => {
    const mp = fetchDoMp({ pagamento: { corpo: { id: 999, external_reference: UUID_PEDIDO, ...corpoDoPagamento } } });
    const resposta = await semLogs(async () =>
      handler(await notificacao("999", "payment"), {
        supabase: banco.supabase,
        fetchImpl: mp.fn,
        ...semAvisos,
      } as never)
    );
    return resposta;
  });
}

const PAGAMENTO_PARCIALMENTE_ESTORNADO = {
  status: "approved",
  status_detail: "partially_refunded",
  transaction_amount: 100,
};

Deno.test("estorno feito FORA do app com id de refund NUMÉRICO (a API clássica manda número) entra no ledger com o id em texto — e lixo na lista (null, número solto) não derruba o evento", async () => {
  const banco = bancoFalso({ pedidos: [pedidoPago()], ledger: [] });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: 30,
    refunds: [null, 5, { id: 777, amount: 30, status: "approved" }],
  });
  assertEquals(r.status, 200);
  const externas = banco.rpcsDe("registrar_estorno_externo_do_mp");
  assertEquals(externas.length, 1, "o refund numérico tem de ser registrado UMA vez");
  assertEquals(externas[0].args.p_mp_refund_id, "777");
  assertEquals(externas[0].args.p_valor, 30);
  assertEquals(externas[0].args.p_order_id, UUID_PEDIDO);
});

Deno.test("identidade tardia com id de refund NUMÉRICO: o id é adotado na linha do app (sem 2ª linha externa, saldo não conta em dobro)", async () => {
  const banco = bancoFalso({ pedidos: [pedidoPago({ valor_estornado: 30 })], ledger: [linhaDoLedger("legado-30")] });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: 30,
    refunds: [{ id: 777, amount: 30, status: "approved" }],
  });
  assertEquals(r.status, 200);
  assertEquals(banco.ledger[0].mp_refund_id, "777");
  assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);
  assertEquals(banco.pedidos[0].valor_estornado, 30);
});

Deno.test("identidade tardia com o acumulado do MP em TEXTO ('30.00'): continua legível e confere -> adota o id, sem RPC externa", async () => {
  const banco = bancoFalso({ pedidos: [pedidoPago({ valor_estornado: 30 })], ledger: [linhaDoLedger("legado-30")] });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: "30.00",
    refunds: [{ id: "refund-30", amount: 30, status: "approved" }],
  });
  assertEquals(r.status, 200);
  assertEquals(banco.ledger[0].mp_refund_id, "refund-30");
  assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);
});

Deno.test("refund JÁ reivindicado por outra linha não conta como 'livre': não impede a adoção do id tardio do outro refund de mesmo valor", async () => {
  // Pedido de 100 com 60 devolvidos: a linha K já tem o refund K1 (30) e a linha
  // L (30) foi concluída pelo app sem id. O MP lista K1 e R2 (30 cada) e o
  // acumulado fecha em 60. R2 é a identidade tardia de L. Se K1 fosse tratado
  // como livre, haveria dois refunds de 30 "livres" (adoção ambígua) e a soma
  // esperada passaria de 60: R2 iria para a RPC externa e o saldo contaria em dobro.
  const banco = bancoFalso({
    pedidos: [pedidoPago({ valor_estornado: 60 })],
    ledger: [
      linhaDoLedger("linha-K", { mp_refund_id: "K1" }),
      linhaDoLedger("legado-L"),
    ],
  });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: 60,
    refunds: [
      { id: "K1", amount: 30, status: "approved" },
      { id: "R2", amount: 30, status: "approved" },
    ],
  });
  assertEquals(r.status, 200);
  assertEquals(banco.ledger[1].mp_refund_id, "R2", "R2 é a identidade tardia da linha L");
  assertEquals(banco.ledger[0].mp_refund_id, "K1");
  assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0, "nenhum estorno externo duplicado");
});

for (const ordemNoArray of ["nova-primeiro", "velha-primeiro"] as const) {
  Deno.test(`duas linhas pendentes e UM refund do MP (ledger lido com a ${ordemNoArray === "nova-primeiro" ? "nova" : "velha"} primeiro): o refund credita a linha MAIS VELHA`, async () => {
    const pendente = (id: string, criada: string) =>
      linhaDoLedger(id, {
        status: "solicitado",
        mp_status: null,
        concluido_em: null,
        tentativas: 0,
        created_at: criada,
      });
    const nova = pendente("linha-nova", "2026-10-05T00:00:00.000Z");
    const velha = pendente("linha-velha", "2026-10-01T00:00:00.000Z");
    const banco = bancoFalso({
      pedidos: [pedidoPago({ gateway_payment_id: "999", valor_estornado: 0 })],
      ledger: ordemNoArray === "nova-primeiro" ? [nova, velha] : [velha, nova],
    });
    const r = await entregarPagamentoClassico(banco, {
      ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
      transaction_amount_refunded: 30,
      refunds: [{ id: "R-UNICO", amount: 30, status: "approved" }],
    });
    assertEquals(r.status, 200);
    const conclusoes = banco.rpcsDe("concluir_estorno");
    assertEquals(conclusoes.length, 1, "um refund credita UMA linha");
    assertEquals(conclusoes[0].args.p_refund_id, "linha-velha");
    assertEquals(conclusoes[0].args.p_mp_refund_id, "R-UNICO");
  });
}

Deno.test("identidade tardia com centavos que o ponto flutuante embaralha (0,29 e 0,57): o acumulado do MP ainda confere e o id é adotado; só o refund de 0,57 vai para a RPC externa", async () => {
  // 0,29*100 = 28,999… e 0,57*100 = 56,999…: arredondar para BAIXO (em vez de
  // para o centavo mais próximo) faz a soma esperada fechar em 86 e não em 87 e a
  // adoção é recusada — o refund de 0,29 viraria um 2º lançamento externo.
  const banco = bancoFalso({
    pedidos: [pedidoPago({ valor_estornado: 0.3 })],
    ledger: [
      linhaDoLedger("linha-Z", { amount: 0.01, mp_refund_id: "Z1" }),
      linhaDoLedger("legado-A", { amount: 0.29 }),
    ],
  });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: 0.87,
    refunds: [
      { id: "Z1", amount: 0.01, status: "approved" },
      { id: "R-029", amount: 0.29, status: "approved" },
      { id: "R-057", amount: 0.57, status: "approved" },
    ],
  });
  assertEquals(r.status, 200);
  assertEquals(banco.ledger[1].mp_refund_id, "R-029", "o id tardio de 0,29 pertence à linha do app");
  const externas = banco.rpcsDe("registrar_estorno_externo_do_mp");
  assertEquals(externas.map((e) => e.args.p_mp_refund_id), ["R-057"]);
  assertEquals(externas[0].args.p_valor, 0.57);
});

Deno.test("concluir_estorno diz 'já concluída' e a RELEITURA do saldo vem ilegível: 500 (o MP reenvia) em vez de seguir com saldo NaN", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoPago({ valor_estornado: 0 })],
    ledger: [
      linhaDoLedger("linha-pendente", {
        status: "solicitado",
        mp_status: null,
        concluido_em: null,
        tentativas: 0,
      }),
    ],
    retornoConcluir: { ja_concluida: true },
    valorEstornadoRelido: "ilegivel",
  });
  const r = await entregarPagamentoClassico(banco, {
    ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
    transaction_amount_refunded: 30,
    refunds: [{ id: "R-1", amount: 30, status: "approved" }],
  });
  assertEquals(r.status, 500);
  assertEquals((await r.json()).error, "Erro ao registrar o desfecho do estorno.");
});

for (
  const caso of [
    { resultado: "inserido", chamadas: 1 },
    { resultado: "ja_registrado", chamadas: 1 },
    // Não cabeu no saldo: a identidade fica LIVRE (a reentrega tenta de novo) —
    // por isso uma 2ª entrada do mesmo id na MESMA lista também é tentada.
    { resultado: "nao_cabe", chamadas: 2 },
  ]
) {
  Deno.test(`refund externo repetido na mesma lista, retorno '${caso.resultado}': a RPC é chamada ${caso.chamadas}x (só inserido/ja_registrado reivindicam a identidade)`, async () => {
    const banco = bancoFalso({
      pedidos: [pedidoPago()],
      ledger: [],
      resultadoExterno: { resultado: caso.resultado, aviso: null, valor_estornado: 30 },
    });
    const r = await entregarPagamentoClassico(banco, {
      ...PAGAMENTO_PARCIALMENTE_ESTORNADO,
      refunds: [
        { id: "R-REPETIDO", amount: 30, status: "approved" },
        { id: "R-REPETIDO", amount: 30, status: "approved" },
      ],
    });
    assertEquals(r.status, 200);
    assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, caso.chamadas);
  });
}

// ── a guarda "estorno de cobrança ÓRFÃ" (rota payment, id gravado é uma ORDER) ─

function fetchOrfa(gravada: Record<string, unknown>, statusDaGravada = 200) {
  return fetchDoMp({
    pagamento: {
      corpo: {
        id: 12345,
        status: "refunded",
        status_detail: "refunded",
        external_reference: UUID_PEDIDO,
        transaction_amount: 100,
        refunds: [{ id: 888, amount: 100, status: "approved" }],
      },
    },
    order: { status: statusDaGravada, corpo: gravada },
  });
}

async function entregarOrfa(banco: ReturnType<typeof bancoFalso>, mp: ReturnType<typeof fetchDoMp>) {
  const pushes: Array<{ aviso: { title: string; url: string } }> = [];
  const resposta = await comAmbiente({}, async () =>
    await semLogs(async () =>
      handler(await notificacao("12345", "payment"), {
        supabase: banco.supabase,
        fetchImpl: mp.fn,
        ...semAvisos,
        enviarPush: (a: { aviso: { title: string; url: string } }) => {
          pushes.push(a);
          return Promise.resolve();
        },
      } as never)
    ));
  return { resposta, pushes };
}

const GRAVADA_AINDA_PAGA = {
  id: ID_GRAVADA,
  external_reference: UUID_PEDIDO,
  status: "processed",
  status_detail: "accredited",
  total_amount: "100.00",
  transactions: { payments: [{ id: "PAY1", status: "processed", payment_method: { type: "credit_card" } }] },
};

Deno.test("estorno de cobrança ÓRFÃ pela rota clássica: a gravada segue paga -> ledger intocado E o admin é AVISADO ('Estorno de cobrança sem registro')", async () => {
  const banco = bancoFalso({ pedidos: [pedidoPago({ gateway_payment_id: ID_GRAVADA })], ledger: [] });
  const { resposta, pushes } = await entregarOrfa(banco, fetchOrfa(GRAVADA_AINDA_PAGA));
  assertEquals(resposta.status, 200);
  assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);
  assertEquals(banco.rpcsDe("concluir_estorno").length, 0);
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0);
  assertEquals(pushes.length, 1, "dinheiro estornado sem dono no ledger exige aviso");
  assertEquals(pushes[0].aviso.title, "Estorno de cobrança sem registro");
  assertEquals(pushes[0].aviso.url, `/admin-orders?id=${UUID_PEDIDO}`);
});

Deno.test("cobrança GRAVADA que mostra devolução PARCIAL (status_detail) confirma o gatilho: o refund dela é registrado no ledger e NÃO há aviso de órfã", async () => {
  const gravadaParcial = {
    ...GRAVADA_AINDA_PAGA,
    status_detail: "partially_refunded",
    transactions: {
      payments: [{ id: "PAY1", status: "processed", payment_method: { type: "credit_card" } }],
      refunds: [{ id: "R-GRAVADA-40", amount: "40.00", status: "processed" }],
    },
  };
  const banco = bancoFalso({ pedidos: [pedidoPago({ gateway_payment_id: ID_GRAVADA })], ledger: [] });
  const { pushes } = await entregarOrfa(banco, fetchOrfa(gravadaParcial));
  const externas = banco.rpcsDe("registrar_estorno_externo_do_mp");
  assertEquals(externas.length, 1, "a devolução parcial da cobrança gravada tem de entrar no ledger");
  assertEquals(externas[0].args.p_mp_refund_id, "R-GRAVADA-40");
  assertEquals(externas[0].args.p_valor, 40);
  assertEquals(pushes.filter((p) => p.aviso.title === "Estorno de cobrança sem registro").length, 0);
});

Deno.test("estorno clássico com a reconsulta da cobrança GRAVADA falhando (500 do MP): 500, o evento fica na fila e NADA é registrado", async () => {
  const banco = bancoFalso({ pedidos: [pedidoPago({ gateway_payment_id: ID_GRAVADA })], ledger: [] });
  const { resposta, pushes } = await entregarOrfa(banco, fetchOrfa({ message: "erro interno" }, 500));
  assertEquals(resposta.status, 500);
  assertEquals(banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);
  assertEquals(banco.rpcsDe("concluir_estorno").length, 0);
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0);
  assertEquals(pushes.length, 0, "falha transitória não é órfã: sem aviso, o MP reenvia");
});

// ═══ 3. CARTÃO: adoção da vaga e aviso de valor divergente ═════════════════════

const ID_ORDER_CARTAO_MP = "ORDCARTAO1KZZ4D94WC79335A68CZ5N";

function orderDeCartaoAprovada(): Record<string, unknown> {
  return {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    transactions: {
      payments: [{
        id: "PAY01CARTAO",
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "master", type: "credit_card", installments: 3 },
      }],
    },
  };
}

function pedidoDeCartao(extra: Linha = {}): Linha {
  return {
    id: UUID_PEDIDO,
    customer_name: "Cliente Fixture",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: null,
    metodo_online: null,
    parcelas: null,
    payment_status: "aguardando",
    paid_at: null,
    status: "pending",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

async function entregarCartao(banco: ReturnType<typeof bancoFalso>) {
  const titulos: string[] = [];
  const resposta = await comAmbiente({}, async () =>
    await semLogs(async () =>
      handler(await notificacao(ID_ORDER_TESTE, "order"), {
        supabase: banco.supabase,
        fetchImpl: fetchDoMp({ order: { corpo: orderDeCartaoAprovada() } }).fn,
        ...semAvisos,
        enviarPushContado: ({ aviso }: { aviso: { title: string } }) => {
          titulos.push(aviso.title);
          return Promise.resolve(1);
        },
      } as never)
    ));
  return { resposta, titulos };
}

Deno.test("adoção do cartão cujo UPDATE falha no banco: 500 (o MP reenvia) e a cobrança aprovada NÃO é dada como tratada", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao()],
    erroNaAdocao: { message: "deadlock detectado", code: "40P01" },
  });
  const { resposta } = await entregarCartao(banco);
  assertEquals(resposta.status, 500);
  assertEquals((await resposta.json()).error, "Erro ao adotar a cobrança.");
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0, "sem adoção não se confirma");
});

Deno.test("adoção perde a corrida para uma vaga em BRANCO (string vazia): não é cobrança de outro pedido -> NÃO avisa 'cobrança duplicada'", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao()],
    resultadoConfirmar: "divergente",
    aposLeituraDoPedido: (p) => {
      p.gateway_payment_id = "";
    },
  });
  const { resposta, titulos } = await entregarCartao(banco);
  assertEquals(resposta.status, 200);
  // A adoção foi tentada e não casou (a vaga deixou de ser NULL)...
  assertEquals(banco.tentativasDeUpdate.filter((t) => t.tabela === "marketplace_orders").length, 1);
  // ...mas uma vaga vazia não é uma segunda cobrança: nada de alarme.
  assertEquals(titulos, []);
});

// O aviso "Pagamento precisa de conferência" é gravado UMA vez por chave
// `valor_divergente:<pedido>:<id>`. Na rota clássica o id da chave é o da
// cobrança GRAVADA (a mesma que o cron usa — deduplica entre as duas portas);
// na rota order, ou com a vaga em verificação/vazia, é o id notificado.
for (
  const caso of [
    {
      nome: "rota clássica, vaga com a ORDER gravada",
      tipo: "payment" as const,
      vaga: ID_GRAVADA,
      esperado: ID_GRAVADA,
    },
    {
      nome: "rota clássica, vaga em VERIFICAÇÃO (sentinela)",
      tipo: "payment" as const,
      vaga: `verificando:${UUID_PEDIDO}:c0`,
      esperado: "999",
    },
    { nome: "rota clássica, vaga em branco", tipo: "payment" as const, vaga: "", esperado: "999" },
    { nome: "rota order, vaga com outra cobrança", tipo: "order" as const, vaga: ID_GRAVADA, esperado: ID_ORDER_TESTE },
  ]
) {
  Deno.test(`valor pago diverge do pedido (${caso.nome}): pedido NÃO confirmado e o aviso usa a chave com o id '${caso.esperado}'`, async () => {
    const banco = bancoFalso({
      pedidos: [pedidoDeCartao({ gateway_payment_id: caso.vaga, total: 500 })],
    });
    const orderDivergente = { ...orderDeCartaoAprovada(), id: ID_ORDER_TESTE, total_amount: "100.00" };
    delete (orderDivergente.transactions as Record<string, unknown>).refunds;
    const mp = fetchDoMp({
      pagamento: { corpo: { id: 999, status: "approved", transaction_amount: 100, external_reference: UUID_PEDIDO } },
      order: { corpo: caso.tipo === "order" ? orderDivergente : { ...orderDivergente, id: ID_GRAVADA } },
    });
    const resposta = await comAmbiente({}, async () =>
      await semLogs(async () =>
        handler(await notificacao(caso.tipo === "order" ? ID_ORDER_TESTE : "999", caso.tipo), {
          supabase: banco.supabase,
          fetchImpl: mp.fn,
          ...semAvisos,
        } as never)
      ));
    assertEquals(resposta.status, 200);
    assertEquals((await resposta.json()).ignorado, "valor divergente");
    assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0);
    const reservas = banco.rpcsDe("reservar_aviso_ao_lojista").map((c) => String(c.args.p_chave));
    assert(
      reservas.includes(`valor_divergente:${UUID_PEDIDO}:${caso.esperado}`),
      `chave esperada ausente; reservas: ${JSON.stringify(reservas)}`,
    );
  });
}

// ── diagnóstico do cartão e a busca do sentinela (só quando há sentinela) ─────

function orderSemTipoLegivel(status: string): Record<string, unknown> {
  return {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status,
    status_detail: status,
    total_amount: "149.90",
    transactions: { payments: [{ id: "PAY01SEMTIPO", status, status_detail: status, amount: "149.90" }] },
  };
}

async function entregarOrder(banco: ReturnType<typeof bancoFalso>, order: Record<string, unknown>) {
  const mp = fetchDoMp({ order: { corpo: order } });
  const resposta = await comAmbiente({}, async () =>
    await semLogs(async () =>
      handler(await notificacao(ID_ORDER_TESTE, "order"), {
        supabase: banco.supabase,
        fetchImpl: mp.fn,
        ...semAvisos,
      } as never)
    ));
  return { resposta, mp };
}

Deno.test("recusa de order SEM tipo legível em pedido de cartão (metodo_online='credito'): o diagnóstico da tentativa é gravado (a vaga é liberada, o pedido não é cancelado)", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao({ metodo_online: "credito", gateway_payment_id: ID_ORDER_CARTAO_MP })],
  });
  const { resposta } = await entregarOrder(banco, orderSemTipoLegivel("failed"));
  assertEquals(resposta.status, 200);
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0);
  assertEquals(banco.rpcsDe("liberar_cobranca_do_pedido").length, 1);
  assertEquals(banco.diagnosticos.length, 1);
  assertEquals(banco.diagnosticos[0].pedido_id, UUID_PEDIDO);
  assertEquals(banco.diagnosticos[0].mp_payment_id, "PAY01SEMTIPO");
  assertEquals(banco.diagnosticos[0].status, "failed");
});

Deno.test("recusa de order PIX (sem cartão em lugar nenhum): NENHUM diagnóstico de cartão é gravado, e o pedido segue por confirmar_pagamento('recusado')", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao({ metodo_online: "pix", gateway_payment_id: ID_ORDER_CARTAO_MP })],
    resultadoConfirmar: "recusado",
  });
  const { resposta } = await entregarOrder(banco, orderSemTipoLegivel("failed"));
  assertEquals(resposta.status, 200);
  assertEquals(banco.rpcsDe("liberar_cobranca_do_pedido").length, 0);
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 1);
  assertEquals(banco.diagnosticos, []);
});

Deno.test("cartão recusado cuja vaga hoje guarda OUTRA cobrança de verdade (não um sentinela): não solta nada e NEM consulta a busca de orders do pedido", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao({ metodo_online: "credito", gateway_payment_id: "ORDOUTRA1KZZ4D94WC79335A68CZ5N" })],
    liberarResultado: false,
  });
  const recusada = orderDeCartaoAprovada();
  recusada.status = "failed";
  recusada.status_detail = "failed";
  (recusada.transactions as { payments: Array<Record<string, unknown>> }).payments[0].status = "failed";
  const { resposta, mp } = await entregarOrder(banco, recusada);
  assertEquals(resposta.status, 200);
  // Só a tentativa pelo id da order; sem sentinela não há 2ª tentativa de liberar.
  assertEquals(banco.rpcsDe("liberar_cobranca_do_pedido").length, 1);
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 0);
  // E nenhuma busca de orders: só a consulta GET da própria order.
  assertEquals(mp.urls.length, 1, `requisições ao MP: ${JSON.stringify(mp.urls)}`);
});
