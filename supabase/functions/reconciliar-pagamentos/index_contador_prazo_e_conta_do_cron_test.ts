/**
 * Pontos cegos do cron reconciliar-pagamentos achados por mutação (caça "só
 * testes"). Cada teste existe porque um defeito plantado no `index.ts` deixava
 * a suíte vizinha verde:
 *
 *  1. CONTADOR DE TENTATIVAS: a linha 'solicitado' marcada pelo cron chega ao
 *     executor com `tentativas + 1`. Com `- 1` a linha antiga criada fora da
 *     autorização (`criada_sob_autorizacao = false`) deixava de ser tratada
 *     como "o POST pode já ter chegado ao MP" e o POST saía SEM a consulta
 *     prévia — o caminho do estorno em dobro.
 *  2. ORÇAMENTO: a fila de estornos só COMEÇA antes do limite de 70 s; no
 *     instante exato do limite nada começa (o ciclo pode passar da espera do
 *     pg_net se começar tarde).
 *  3. CONTA DOS DESFECHOS: linha travada que o banco trata como "nada saiu"
 *     vira `falhou` e conta em `falhos`, não em `adiados`; e quando o MP
 *     confirmou o estorno mas a escrita local (`concluir_estorno`) falha, a
 *     tentativa gasta SOBE (entra no orçamento do teto de 5), nunca desce.
 *  4. STATUS DESCONHECIDO do pagamento clássico é ignorado, nunca "falha".
 *  5. DIAGNÓSTICO DO CARTÃO: só grava para cartão (pelo tipo da order ou pelo
 *     método gravado no pedido), nunca para PIX recusado.
 *
 * Handler REAL; só banco e HTTP são dublês (sem rede, sem banco). O dublê de
 * banco TEM ESTADO e aplica os filtros que a produção passa (mínimo copiado de
 * `index_marca_e_refund_id_test.ts`). Dados e chaves inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

type Linha = Record<string, unknown>;
type Resultado = { data: Linha[]; error: null };
type Rota = { metodo: string; trecho: string; status: number; corpo: unknown };

const SEGREDO = "segredo-ficticio-contador-e-conta";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-contador-e-conta");

function comparavel(linha: Linha, coluna: string): string | number {
  const valor = Reflect.get(linha, coluna);
  return typeof valor === "number" || typeof valor === "string" ? valor : "";
}

function consulta(linhas: Linha[], aoExecutar: (selecionadas: Linha[]) => void = () => {}, valores?: Linha) {
  let selecionadas = [...linhas];
  let colunas = "*";
  let limite = Infinity;
  const criterios: Array<{ coluna: string; ascendente: boolean }> = [];
  const executar = (): Resultado => {
    selecionadas.sort((a, b) => {
      for (const { coluna, ascendente } of criterios) {
        const va = comparavel(a, coluna);
        const vb = comparavel(b, coluna);
        if (va < vb) return ascendente ? -1 : 1;
        if (va > vb) return ascendente ? 1 : -1;
      }
      return 0;
    });
    const lote = selecionadas.slice(0, limite);
    aoExecutar(lote);
    if (valores) for (const linha of lote) Object.assign(linha, valores);
    const nomes = colunas.split(",").map((nome) => nome.trim());
    return {
      data: lote.map((linha) =>
        colunas === "*"
          ? { ...linha }
          : Object.fromEntries(Object.entries(linha).filter(([nome]) => nomes.includes(nome)))
      ),
      error: null,
    };
  };
  const q = {
    select(novasColunas = "*") {
      colunas = novasColunas;
      return q;
    },
    eq(coluna: string, valor: unknown) {
      selecionadas = selecionadas.filter((linha) => Reflect.get(linha, coluna) === valor);
      return q;
    },
    in(coluna: string, valoresAceitos: unknown[]) {
      selecionadas = selecionadas.filter((linha) => valoresAceitos.includes(Reflect.get(linha, coluna)));
      return q;
    },
    neq(coluna: string, valor: unknown) {
      selecionadas = selecionadas.filter((linha) => Reflect.get(linha, coluna) !== valor);
      return q;
    },
    lt(coluna: string, limiteExclusivo: string) {
      selecionadas = selecionadas.filter((linha) => comparavel(linha, coluna) < limiteExclusivo);
      return q;
    },
    gte(coluna: string, minimo: string) {
      selecionadas = selecionadas.filter((linha) => comparavel(linha, coluna) >= minimo);
      return q;
    },
    not(coluna: string, operador: string, valor: unknown) {
      assertEquals(operador, "is");
      return q.neq(coluna, valor);
    },
    order(coluna: string, opcoes?: { ascending?: boolean }) {
      criterios.push({ coluna, ascendente: opcoes?.ascending ?? true });
      return q;
    },
    limit(n: number) {
      limite = n;
      return q;
    },
    maybeSingle() {
      const resultado = executar();
      return Promise.resolve({ data: resultado.data[0] ?? null, error: null });
    },
    then(resolver: (resultado: Resultado) => unknown, rejeitar?: (erro: unknown) => unknown) {
      return Promise.resolve().then(executar).then(resolver, rejeitar);
    },
  };
  return q;
}

const AGORA = Date.now();
const CINCO_MIN = 5 * 60 * 1000;
const UM_DIA = 24 * 60 * 60 * 1000;
const ID_PEDIDO = "10000000-0000-4000-8000-0000000000aa";

function linhaDeDevolucao(extras: Linha = {}): Linha {
  return {
    id: "rf1",
    order_id: "pedido-rf1",
    amount: 50,
    status: "solicitado",
    solicitado_por: "cliente-ficticio",
    tentativas: 0,
    mp_refund_id: null,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
    updated_at: new Date(AGORA - CINCO_MIN).toISOString(),
    created_at: new Date(AGORA - 60 * 60 * 1000).toISOString(),
    ...extras,
  };
}

function pedidoDe(linha: Linha, extras: Linha = {}): Linha {
  return {
    id: String(linha.order_id),
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(AGORA - UM_DIA).toISOString(),
    status: "cancelled",
    ...extras,
  };
}

interface Cenario {
  linha?: Linha;
  pedido?: Linha;
  /** Pedidos extras (os candidatos de pagamento leem `marketplace_orders`). */
  pedidosExtras?: Linha[];
  rotas: Rota[];
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  /** `concluir_estorno` devolve erro (o MP confirmou mas a escrita local falhou). */
  concluirFalha?: boolean;
  /** Resposta de `registrar_diagnostico_do_estorno`. */
  diagnosticoDoPost?: Linha;
  /** Relógio injetado: devolve o tempo decorrido a partir de quando os estornos começam. */
  relogioNosEstornos?: number;
}

async function rodar(cenario: Cenario) {
  const linhas = cenario.linha ? [{ ...cenario.linha }] : [];
  const pedidos = [...(cenario.linha ? [cenario.pedido ?? pedidoDe(cenario.linha)] : []), ...(cenario.pedidosExtras ?? [])];
  const atualizacoes: Array<{ id: string; valores: Linha }> = [];
  const conclusoes: Linha[] = [];
  const diagnosticosDeCartao: Linha[] = [];
  const rpcsChamadas: string[] = [];
  const chamadasMp: Array<{ url: string; metodo: string }> = [];
  let agoraInjetado = 0;

  const supabase = {
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => consulta(linhas).select(colunas),
          update: (valores: Linha) =>
            consulta(
              linhas,
              (lote) => lote.forEach((linha) => atualizacoes.push({ id: String(linha.id), valores })),
              valores,
            ),
        };
      }
      if (tabela === "marketplace_orders") return consulta(pedidos);
      if (tabela === "app_settings" || tabela === "marketplace_order_history") return consulta([]);
      if (tabela === "tentativas_cartao_diagnostico") {
        return {
          upsert: (linha: Linha) => {
            diagnosticosDeCartao.push(linha);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`Tabela inesperada: ${tabela}`);
    },
    rpc(nome: string, args: Linha = {}) {
      rpcsChamadas.push(nome);
      if (nome === "pagamentos_a_reconciliar") {
        if (cenario.relogioNosEstornos !== undefined) agoraInjetado = cenario.relogioNosEstornos;
        return Promise.resolve({ data: cenario.candidatos ?? [], error: null });
      }
      if (nome === "autorizar_post_do_estorno") {
        const linha = linhas.find((item) => item.id === args.p_refund_id);
        return Promise.resolve({
          data: { decisao: "autorizado", pedido: pedidos.find((pedido) => pedido.id === linha?.order_id) },
          error: null,
        });
      }
      if (nome === "concluir_estorno") {
        conclusoes.push({ ...args });
        if (cenario.concluirFalha) return Promise.resolve({ data: null, error: { message: "queda do banco" } });
        const linha = linhas.find((item) => item.id === args.p_refund_id);
        if (linha) Object.assign(linha, { status: "concluido", mp_refund_id: args.p_mp_refund_id });
        return Promise.resolve({ data: { payment_status: "pago" }, error: null });
      }
      if (nome === "registrar_diagnostico_do_estorno") {
        return Promise.resolve({
          data: cenario.diagnosticoDoPost ?? { transitorios: 0, post_incerto: false },
          error: null,
        });
      }
      if (nome === "liberar_cobranca_do_pedido") return Promise.resolve({ data: true, error: null });
      if (nome === "confirmar_pagamento") return Promise.resolve({ data: "ignorado", error: null });
      if (nome === "marcar_visitas_da_reconciliacao") return Promise.resolve({ data: null, error: null });
      throw new Error(`RPC inesperada: ${nome}`);
    },
  };

  const fetchImpl: typeof fetch = (entrada, init) => {
    const url = entrada instanceof Request ? entrada.url : String(entrada);
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadasMp.push({ url, metodo });
    const rota = cenario.rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(new Response(JSON.stringify(rota?.corpo ?? {}), { status: rota?.status ?? 500 }));
  };

  const console_ = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  let resposta: Response;
  try {
    resposta = await handler(
      new Request("http://localhost/reconciliar-pagamentos", {
        method: "POST",
        headers: { "x-reconciliacao-secret": SEGREDO },
      }),
      {
        supabase: supabase as unknown as NonNullable<Parameters<typeof handler>[1]>["supabase"],
        fetchImpl,
        ...(cenario.relogioNosEstornos !== undefined ? { agora: () => agoraInjetado } : {}),
      },
    );
  } finally {
    console.log = console_.log;
    console.warn = console_.warn;
    console.error = console_.error;
  }
  assertEquals(resposta.status, 200);
  return {
    corpo: await resposta.json(),
    linhaFinal: linhas[0],
    atualizacoes,
    conclusoes,
    diagnosticosDeCartao,
    rpcsChamadas,
    chamadasMp,
  };
}

const postClassico = (status: number, corpo: unknown): Rota => ({
  metodo: "POST",
  trecho: "/v1/payments/123456789/refunds",
  status,
  corpo,
});

const getClassico = (corpo: unknown): Rota => ({
  metodo: "GET",
  trecho: "/v1/payments/123456789",
  status: 200,
  corpo,
});

const PAGAMENTO_SEM_REFUNDS = { id: 123456789, status: "approved", transaction_amount_refunded: 0, refunds: [] };

// ── 1. o contador chega ao executor com `+ 1` ─────────────────────────────────

Deno.test("linha 'solicitado' ANTIGA (criada fora da autorização) com 1 tentativa: o cron CONSULTA o MP antes de qualquer POST (a tentativa marcada é 2, não 0)", async () => {
  const r = await rodar({
    linha: linhaDeDevolucao({ tentativas: 1, criada_sob_autorizacao: false }),
    rotas: [getClassico(PAGAMENTO_SEM_REFUNDS), postClassico(201, { id: 999, status: "approved", amount: 50 })],
  });
  const metodos = r.chamadasMp.map((c) => c.metodo);
  assertEquals(metodos[0], "GET", "o primeiro contato com o MP tem de ser a consulta, nunca o POST");
  assertEquals(metodos, ["GET", "POST"]);
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
});

Deno.test("linha 'solicitado' NOVA (criada sob autorização, 0 tentativas): POST direto, ZERO consulta (controle do teste acima)", async () => {
  const r = await rodar({
    linha: linhaDeDevolucao({ tentativas: 0, criada_sob_autorizacao: true }),
    rotas: [getClassico(PAGAMENTO_SEM_REFUNDS), postClassico(201, { id: 999, status: "approved", amount: 50 })],
  });
  assertEquals(r.chamadasMp.map((c) => c.metodo), ["POST"]);
});

// ── 2. orçamento de tempo: no instante exato do limite nada começa ────────────

for (const [decorrido, comecou] of [[70_000, false], [69_999, true]] as const) {
  Deno.test(`fila de estornos com ${decorrido} ms já gastos: ${comecou ? "ainda COMEÇA a linha" : "NÃO começa (adiada por tempo, nenhuma tentativa gasta, zero MP)"}`, async () => {
    const r = await rodar({
      linha: linhaDeDevolucao(),
      rotas: [postClassico(201, { id: 999, status: "approved", amount: 50 })],
      relogioNosEstornos: decorrido,
    });
    if (comecou) {
      assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
      assertEquals(r.corpo.estornosAdiadosPorTempo, 0);
    } else {
      assertEquals(r.corpo.estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
      assertEquals(r.corpo.estornosAdiadosPorTempo, 1);
      assertEquals(r.chamadasMp, []);
      assertEquals(r.linhaFinal.status, "solicitado", "a linha nem foi marcada");
      assertEquals(r.linhaFinal.tentativas, 0);
    }
  });
}

// ── 3. conta dos desfechos e das tentativas ───────────────────────────────────

Deno.test("linha travada (5 tentativas) que o banco diz 'nada saiu' e o MP não tem reembolso: vira `falhou` e conta em `falhos` (não em `adiados`)", async () => {
  const r = await rodar({
    linha: linhaDeDevolucao({ status: "em_processamento", tentativas: 5 }),
    rotas: [getClassico(PAGAMENTO_SEM_REFUNDS)],
    diagnosticoDoPost: { transitorios: 5, post_incerto: false, mp_codigo: "insufficient_money_for_refund" },
  });
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 0, falhos: 1 });
  assertEquals(r.linhaFinal.status, "falhou");
  assertEquals(r.chamadasMp.filter((c) => c.metodo === "POST"), [], "linha travada nunca faz POST");
});

Deno.test("reenvio aprovado pelo MP mas a escrita local (concluir_estorno) FALHA: a tentativa gasta SOBE (marca 3 -> 4) e a linha continua em_processamento", async () => {
  const r = await rodar({
    linha: linhaDeDevolucao({ status: "em_processamento", tentativas: 2 }),
    rotas: [getClassico(PAGAMENTO_SEM_REFUNDS), postClassico(201, { id: 999, status: "approved", amount: 50 })],
    concluirFalha: true,
  });
  assertEquals(r.chamadasMp.filter((c) => c.metodo === "POST").length, 1);
  assertEquals(r.conclusoes.length, 1);
  assertEquals(r.linhaFinal.status, "em_processamento", "o dinheiro saiu: nunca vira falhou por falha NOSSA");
  assertEquals(r.linhaFinal.tentativas, 4);
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
});

// ── 4. status desconhecido do pagamento clássico ──────────────────────────────

Deno.test("candidato LEGADO cujo pagamento clássico volta com status desconhecido: IGNORADO (nada confirmado, nenhuma falha)", async () => {
  const r = await rodar({
    pedidosExtras: [{ id: ID_PEDIDO, total: 100, total_amount: 100, payment_status: "aguardando", paid_at: null, status: "pending" }],
    candidatos: [{ order_id: ID_PEDIDO, gateway_payment_id: "555000111" }],
    rotas: [{
      metodo: "GET",
      trecho: "/v1/payments/555000111",
      status: 200,
      corpo: { id: 555000111, status: "status_que_nao_existe", transaction_amount: 100, external_reference: ID_PEDIDO },
    }],
  });
  assertEquals(r.corpo.verificados, 1);
  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.corpo.falhas, 0);
  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.rpcsChamadas.includes("confirmar_pagamento"), false);
});

// ── 5. diagnóstico do cartão: só para cartão ──────────────────────────────────

const ID_ORDER_CARTAO = "ORDCARTAO1KZZ4D94WC79335A68CZ5N";

function orderSemTipoLegivel(status: string): Linha {
  return {
    id: ID_ORDER_CARTAO,
    external_reference: ID_PEDIDO,
    status,
    status_detail: status,
    total_amount: "149.90",
    transactions: { payments: [{ id: "PAY01SEMTIPO", status, status_detail: status, amount: "149.90" }] },
  };
}

function cenarioDeRecusa(metodoOnline: string): Cenario {
  return {
    pedidosExtras: [{
      id: ID_PEDIDO,
      total: 149.9,
      total_amount: 149.9,
      payment_status: "aguardando",
      paid_at: null,
      status: "pending",
      metodo_online: metodoOnline,
      gateway_payment_id: ID_ORDER_CARTAO,
    }],
    candidatos: [{ order_id: ID_PEDIDO, gateway_payment_id: ID_ORDER_CARTAO }],
    rotas: [{ metodo: "GET", trecho: `/v1/orders/${ID_ORDER_CARTAO}`, status: 200, corpo: orderSemTipoLegivel("failed") }],
  };
}

Deno.test("recusa de order sem tipo legível em pedido de cartão (metodo_online='credito'): a vaga é liberada E o diagnóstico da tentativa é gravado", async () => {
  const r = await rodar(cenarioDeRecusa("credito"));
  assertEquals(r.rpcsChamadas.includes("liberar_cobranca_do_pedido"), true);
  assertEquals(r.rpcsChamadas.includes("confirmar_pagamento"), false);
  assertEquals(r.diagnosticosDeCartao.length, 1);
  assertEquals(r.diagnosticosDeCartao[0].pedido_id, ID_PEDIDO);
  assertEquals(r.diagnosticosDeCartao[0].status, "failed");
});

Deno.test("recusa de order PIX (metodo_online='pix', sem cartão em lugar nenhum): NENHUM diagnóstico de cartão é gravado", async () => {
  const r = await rodar(cenarioDeRecusa("pix"));
  assertEquals(r.rpcsChamadas.includes("liberar_cobranca_do_pedido"), false);
  assertEquals(r.diagnosticosDeCartao, []);
});
