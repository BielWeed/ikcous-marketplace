// @ts-nocheck
/**
 * estornar-pagamento — o que o clique "Devolver dinheiro" entrega ao executor,
 * e as bordas do corpo que a suíte principal deixava passar
 * (caça por mutação "só testes", 25/11/2026).
 *
 * Cada teste existe porque uma alteração pequena no `index.ts` mantinha a
 * suíte inteira verde:
 *
 *  - os CAMPOS que viram argumento do executor (valor como número, id de
 *    reembolso já gravado, total, saldo já estornado, status do pedido): o
 *    executor decide dinheiro com eles;
 *  - a leitura de resposta nula do banco (a marca e o desfecho devolvendo
 *    `null` em vez de lista) — 409, nunca 500 nem "feito";
 *  - o valor que o lojista lê ("R$ x foi devolvido") e o que vai à RPC que
 *    conclui (`p_mp_refund_id` nulo quando o MP não devolveu id);
 *  - refund_id: espaço nas pontas, UUID só inteiro, só texto;
 *  - a ação `reemitir`: cada id validado sozinho, espaços aparados, o status
 *    HTTP que o banco manda e o token que vai ao Mercado Pago;
 *  - pré-voo CORS e corpo em lista.
 *
 * Nada aqui toca rede nem banco de verdade: o cliente do Supabase é um dublê
 * roteirizado e o Mercado Pago é um `buscar` injetado.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const URL_SUPA = "https://supa-fake.local";
const ADMIN = "admin-aaaa-bbbb";
const REFUND = "55555555-5555-4555-8555-555555555555";
const PEDIDO_ID = "66666666-6666-4666-8666-666666666666";
const DEVOLUCAO = "d1000000-0000-4000-8000-000000000001";
const ESPERADA = "e1000000-0000-4000-8000-000000000002";
const TOKEN_ENV = "TEST-0000000000000000-000000";

// ── Banco roteirizado ──────────────────────────────────────────────────────

type Linha = Record<string, unknown>;
type Filtro = { metodo: string; coluna: string; valor: unknown };
type Consulta = {
  tabela: string;
  filtros: Filtro[];
  valores: Linha | null;
  colunas: string | null;
};

type Opcoes = {
  linha?: Linha | null;
  pedido?: Linha | null;
  /** valores de mp_refund_id devolvidos pela leitura dos ids já reivindicados */
  ids?: unknown[];
  /** o que a MARCA devolve; `undefined` = uma linha (marcou) */
  marcada?: unknown;
  /** o que o UPDATE terminal (falhou/recusado) devolve; `undefined` = uma linha */
  fim?: unknown;
  /** a releitura da linha depois que o UPDATE terminal perdeu a corrida */
  releitura?: Linha | null;
  devolucao?: Linha | null;
  reemissaoErro?: { code: string; message: string };
};

function banco(opts: Opcoes = {}) {
  const consultas: Consulta[] = [];
  const marcas: Consulta[] = [];
  const terminais: Consulta[] = [];
  const diagnosticos: Consulta[] = [];
  const rpcs: Array<{ nome: string; args: Linha }> = [];
  let leiturasDaLinha = 0;

  const resolver = (c: Consulta) => {
    consultas.push(c);
    if (c.tabela === "app_settings") return { data: null, error: null };
    if (c.tabela === "devolucoes") {
      return { data: opts.devolucao ?? null, error: null };
    }
    if (c.tabela === "marketplace_orders") {
      return { data: opts.pedido ?? null, error: null };
    }
    // order_refunds
    if (c.valores === null && c.filtros.some((f) => f.metodo === "not")) {
      const ids = opts.ids ?? [];
      return {
        data: ids.map((mp_refund_id) => ({ mp_refund_id })),
        error: null,
      };
    }
    if (c.valores === null) {
      leiturasDaLinha++;
      if (leiturasDaLinha > 1 && "releitura" in opts) {
        return { data: opts.releitura ?? null, error: null };
      }
      return { data: opts.linha ?? null, error: null };
    }
    if (c.valores.status === "em_processamento" && "tentativas" in c.valores) {
      marcas.push(c);
      return {
        data: "marcada" in opts ? opts.marcada : [{ id: REFUND }],
        error: null,
      };
    }
    if (c.valores.status === "falhou" || c.valores.status === "recusado") {
      terminais.push(c);
      return {
        data: "fim" in opts ? opts.fim : [{ id: REFUND }],
        error: null,
      };
    }
    diagnosticos.push(c);
    return { data: null, error: null };
  };

  const supabase = {
    from(tabela: string) {
      const c: Consulta = { tabela, filtros: [], valores: null, colunas: null };
      const api: any = {
        select(colunas?: string) {
          c.colunas = colunas ?? null;
          return api;
        },
        update(valores: Linha) {
          c.valores = valores;
          return api;
        },
        eq(coluna: string, valor: unknown) {
          c.filtros.push({ metodo: "eq", coluna, valor });
          return api;
        },
        neq(coluna: string, valor: unknown) {
          c.filtros.push({ metodo: "neq", coluna, valor });
          return api;
        },
        in(coluna: string, valor: unknown) {
          c.filtros.push({ metodo: "in", coluna, valor });
          return api;
        },
        is(coluna: string, valor: unknown) {
          c.filtros.push({ metodo: "is", coluna, valor });
          return api;
        },
        not(coluna: string, op: string, valor: unknown) {
          c.filtros.push({ metodo: "not", coluna, valor: `${op}:${valor}` });
          return api;
        },
        maybeSingle() {
          return api;
        },
        then(resolve: (r: unknown) => unknown, rejeita: (e: unknown) => unknown) {
          return Promise.resolve(resolver(c)).then(resolve, rejeita);
        },
      };
      return api;
    },
    rpc(nome: string, args: Linha) {
      rpcs.push({ nome, args });
      if (nome === "reemitir_reembolso_da_devolucao") {
        return Promise.resolve(
          opts.reemissaoErro
            ? { data: null, error: opts.reemissaoErro }
            : { data: { resultado: "reemitido" }, error: null },
        );
      }
      if (nome === "registrar_diagnostico_do_estorno") {
        return Promise.resolve({
          data: { transitorios: 1, post_incerto: false, mp_codigo: null },
          error: null,
        });
      }
      return Promise.resolve({
        data: { payment_status: "pago" },
        error: null,
      });
    },
  };
  return { supabase, consultas, marcas, terminais, diagnosticos, rpcs };
}

// ── Cenário base ───────────────────────────────────────────────────────────

const LINHA: Linha = {
  id: REFUND,
  order_id: PEDIDO_ID,
  amount: 100,
  status: "solicitado",
  mp_refund_id: null,
  tentativas: 0,
  solicitado_por: ADMIN,
  post_autorizado_em: null,
  criada_sob_autorizacao: true,
};

const PEDIDO: Linha = {
  id: PEDIDO_ID,
  gateway_payment_id: "123456789",
  total: 100,
  valor_estornado: 0,
  payment_status: "pago",
  paid_at: "2026-11-20T10:00:00.000Z",
  status: "delivered",
};

function pedirJson(corpo: unknown, metodo = "POST") {
  return new Request("https://edge.test/estornar-pagamento", {
    method: metodo,
    headers: {
      Authorization: "Bearer jwt-de-teste",
      "Content-Type": "application/json",
    },
    body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
  });
}

/** Roda o handler com env, sessão e rede de admin falsos — e restaura tudo. */
async function executar(
  req: Request,
  deps: Record<string, unknown>,
): Promise<Response> {
  const ambiente: Array<[string, string]> = [
    ["SUPABASE_URL", URL_SUPA],
    ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
    ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-de-teste" })],
    ["MP_ACCESS_TOKEN", TOKEN_ENV],
  ];
  const anteriores = ambiente.map(([k]) => [k, Deno.env.get(k)] as const);
  const fetchAnterior = globalThis.fetch;
  const chaveStorage = "sb-supa-fake-auth-token";
  const storageAnterior = localStorage.getItem(chaveStorage);
  const adminFalso = ((input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    const ok = (corpo: unknown) =>
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/auth/v1/user")) {
      return ok({
        id: ADMIN,
        email: "admin@teste.local",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email", role: "admin" },
      });
    }
    if (url.includes("/rest/v1/profiles")) return ok({ id: ADMIN, role: "admin" });
    throw new Error(`rede externa proibida: ${url}`);
  }) as typeof fetch;
  try {
    for (const [k, v] of ambiente) Deno.env.set(k, v);
    localStorage.setItem(
      chaveStorage,
      JSON.stringify({
        access_token: "jwt-de-teste",
        refresh_token: "refresh-de-teste",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: ADMIN, aud: "authenticated", role: "authenticated" },
      }),
    );
    globalThis.fetch = adminFalso;
    const { handler } = await import("./index.ts");
    return await handler(req, deps);
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [k, v] of anteriores) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
    if (storageAnterior === null) localStorage.removeItem(chaveStorage);
    else localStorage.setItem(chaveStorage, storageAnterior);
  }
}

function executorQue(resultado: unknown) {
  const chamadas: any[] = [];
  const fn = (args: unknown) => {
    chamadas.push(args);
    return Promise.resolve(resultado);
  };
  return { fn, chamadas };
}

const EM_PROCESSAMENTO = {
  tipo: "em_processamento",
  mp_refund_id: null,
  mp_status: "in_process",
};

function buscarQueNaoDeveSerChamado() {
  return (() => {
    throw new Error("o Mercado Pago não deveria ser chamado");
  }) as typeof fetch;
}

// ── 1. O que o executor recebe ─────────────────────────────────────────────

Deno.test("executor: valor, id de reembolso, total, saldo e status chegam como o executor espera — texto do banco vira NÚMERO", async () => {
  const b = banco({
    linha: {
      ...LINHA,
      amount: "150.50", // numeric que o PostgREST entrega como texto
      status: "em_processamento",
      mp_refund_id: "re_ja_gravado",
      tentativas: 2,
      post_autorizado_em: "2026-11-21T08:00:00.000Z",
    },
    pedido: {
      ...PEDIDO,
      total: "199.90",
      valor_estornado: "20.00",
      status: "processing",
    },
    ids: [null, 123, "re_de_outra_linha"],
  });
  const ex = executorQue(EM_PROCESSAMENTO);
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 202);
  assertEquals(ex.chamadas.length, 1);
  const args = ex.chamadas[0];
  assertEquals(args.linha, {
    id: REFUND,
    order_id: PEDIDO_ID,
    amount: 150.5,
    status: "em_processamento",
    mp_refund_id: "re_ja_gravado",
    tentativas: 3,
    post_autorizado_em: "2026-11-21T08:00:00.000Z",
    criada_sob_autorizacao: true,
  });
  assertEquals(args.pedido, {
    id: PEDIDO_ID,
    gateway_payment_id: "123456789",
    total: 199.9,
    valor_estornado: 20,
    payment_status: "pago",
    paid_at: "2026-11-20T10:00:00.000Z",
    status: "processing",
  });
  assertEquals(args.token, TOKEN_ENV);
  // só id TEXTO de outra linha conta como reivindicado: nulo e número não.
  assertEquals(args.idsJaReivindicados, ["re_de_outra_linha"]);
});

Deno.test("executor: pedido SEM saldo estornado gravado (coluna ausente) chega como 0, nunca NaN", async () => {
  const { valor_estornado: _fora, ...pedidoSemColuna } = PEDIDO;
  const b = banco({ linha: LINHA, pedido: pedidoSemColuna });
  const ex = executorQue(EM_PROCESSAMENTO);
  await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(ex.chamadas.length, 1);
  assertEquals(ex.chamadas[0].pedido.valor_estornado, 0);
  assert(!Number.isNaN(ex.chamadas[0].pedido.valor_estornado));
});

Deno.test("executor: linha com tentativas nulas NÃO é tratada como travada — executa e marca tentativas 1", async () => {
  const b = banco({ linha: { ...LINHA, tentativas: null }, pedido: PEDIDO });
  const ex = executorQue(EM_PROCESSAMENTO);
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 202);
  assertEquals(ex.chamadas.length, 1);
  assertEquals(b.marcas.length, 1);
  assertEquals(b.marcas[0].valores.tentativas, 1);
  assert(
    b.marcas[0].filtros.some((f) =>
      f.metodo === "eq" && f.coluna === "tentativas" && f.valor === 0
    ),
    "o compare-and-swap lê o valor ausente como 0",
  );
});

Deno.test("executor: o fetch entregue a ele recebe a URL como TEXTO mesmo quando ele chama com um Request", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO });
  const vistas: unknown[] = [];
  const buscar = ((entrada: unknown) => {
    vistas.push(entrada);
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  }) as typeof fetch;
  const executorQueUsaRequest = async (args: any) => {
    await args.buscar(
      new Request("https://api.mercadopago.com/v1/payments/123456789/refunds", {
        method: "POST",
        body: "{}",
      }),
    );
    return EM_PROCESSAMENTO;
  };
  await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: executorQueUsaRequest,
    buscar,
  });
  assertEquals(vistas, ["https://api.mercadopago.com/v1/payments/123456789/refunds"]);
});

Deno.test("ids já reivindicados: a leitura é das OUTRAS linhas do MESMO pedido e só as que têm id", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO });
  const ex = executorQue(EM_PROCESSAMENTO);
  await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  const leitura = b.consultas.find((c) =>
    c.tabela === "order_refunds" && c.filtros.some((f) => f.metodo === "not")
  )!;
  assert(leitura, "a leitura dos ids reivindicados tem de existir");
  assertEquals(leitura.filtros, [
    { metodo: "eq", coluna: "order_id", valor: PEDIDO_ID },
    { metodo: "neq", coluna: "id", valor: REFUND },
    { metodo: "not", coluna: "mp_refund_id", valor: "is:null" },
  ]);
});

// ── 2. Resposta nula do banco: 409, nunca 500 nem "feito" ─────────────────

Deno.test("marca que volta NULA (nem lista) -> 409 estorno_em_execucao, MP intocado", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO, marcada: null });
  const ex = executorQue(EM_PROCESSAMENTO);
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { erro: "estorno_em_execucao" });
  assertEquals(ex.chamadas.length, 0);
});

Deno.test("desfecho terminal que volta NULO (nem lista) -> 409 estorno_ja_tratado com o estado real relido", async () => {
  const b = banco({
    linha: LINHA,
    pedido: PEDIDO,
    fim: null,
    releitura: { ...LINHA, status: "concluido" },
  });
  const ex = executorQue({ tipo: "falhou", motivo: "o MP recusou", codigo: "x" });
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { erro: "estorno_ja_tratado", status: "concluido" });
});

Deno.test("desfecho terminal perdeu a corrida e a linha SUMIU na releitura -> 409 com status nulo (não inventa estado)", async () => {
  const b = banco({
    linha: LINHA,
    pedido: PEDIDO,
    fim: [],
    releitura: null,
  });
  const ex = executorQue({ tipo: "recusado", motivo: "saldo não cobre" });
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { erro: "estorno_ja_tratado", status: null });
});

// ── 3. O que o lojista lê e o que a RPC que conclui recebe ────────────────

Deno.test("concluído: refund sem id legível vira NULL na RPC e o detalhe do MP chega a ela", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO });
  const ex = executorQue({
    tipo: "concluido",
    mp_refund_id: "",
    mp_status: "approved",
    mp_status_detail: "accredited",
    valor: 100,
  });
  const r = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 200);
  const concluir = b.rpcs.filter((x) => x.nome === "concluir_estorno");
  assertEquals(concluir.length, 1);
  assertEquals(concluir[0].args, {
    p_refund_id: REFUND,
    p_mp_refund_id: null,
    p_mp_status: "approved",
    p_mp_status_detail: "accredited",
  });
});

Deno.test("concluído: o valor mostrado é o que o executor confirmou; se ele não disse, o da linha", async () => {
  // O executor confirmou R$ 75,50 numa linha de R$ 100: o lojista lê 75,5.
  const a = banco({ linha: LINHA, pedido: PEDIDO });
  const ra = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: a.supabase,
    executarEstorno: executorQue({
      tipo: "concluido",
      mp_refund_id: "re_1",
      mp_status: "approved",
      mp_status_detail: null,
      valor: 75.5,
    }).fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals((await ra.json()).valor, 75.5);

  // O executor não trouxe valor: vale o da linha, nunca zero.
  const c = banco({ linha: { ...LINHA, amount: 100 }, pedido: PEDIDO });
  const rc = await executar(pedirJson({ refund_id: REFUND }), {
    supabase: c.supabase,
    executarEstorno: executorQue({
      tipo: "concluido",
      mp_refund_id: "re_2",
      mp_status: "approved",
      mp_status_detail: null,
    }).fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals((await rc.json()).valor, 100);
});

Deno.test("em processamento: grava o id do reembolso e o status do MP, só em linha em_processamento; sem id, não sobrescreve o que já existe", async () => {
  const comId = banco({ linha: LINHA, pedido: PEDIDO });
  await executar(pedirJson({ refund_id: REFUND }), {
    supabase: comId.supabase,
    executarEstorno: executorQue({
      tipo: "em_processamento",
      mp_refund_id: "re_9",
      mp_status: "in_process",
    }).fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(comId.diagnosticos.length, 1);
  assertEquals(comId.diagnosticos[0].valores.mp_refund_id, "re_9");
  assertEquals(comId.diagnosticos[0].valores.mp_status, "in_process");
  assertEquals(
    comId.diagnosticos[0].filtros.find((f) => f.metodo === "in"),
    { metodo: "in", coluna: "status", valor: ["em_processamento"] },
  );

  const semId = banco({ linha: LINHA, pedido: PEDIDO });
  await executar(pedirJson({ refund_id: REFUND }), {
    supabase: semId.supabase,
    executarEstorno: executorQue(EM_PROCESSAMENTO).fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(semId.diagnosticos.length, 1);
  // `undefined` some do JSON enviado ao PostgREST: o id que já estava lá fica.
  assertEquals(semId.diagnosticos[0].valores.mp_refund_id, undefined);
  assertEquals(JSON.stringify(semId.diagnosticos[0].valores).includes("mp_refund_id"), false);
});

// ── 4. refund_id: espaço, UUID inteiro, só texto ──────────────────────────

Deno.test("refund_id com espaços nas pontas é aceito e a linha é lida pelo id APARADO", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO });
  const ex = executorQue(EM_PROCESSAMENTO);
  const r = await executar(pedirJson({ refund_id: `  ${REFUND}\n` }), {
    supabase: b.supabase,
    executarEstorno: ex.fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(r.status, 202);
  const leituraDaLinha = b.consultas.find((c) =>
    c.tabela === "order_refunds" && c.valores === null && c.filtros.length === 1
  )!;
  assertEquals(leituraDaLinha.filtros, [{ metodo: "eq", coluna: "id", valor: REFUND }]);
});

Deno.test("refund_id: UUID em maiúscula passa; lixo antes ou depois, array e número não — e nada é lido", async () => {
  const maiuscula = banco({ linha: LINHA, pedido: PEDIDO });
  // letras de a a f no id: sem elas a maiúscula não prova nada
  const ok = await executar(pedirJson({ refund_id: "ABCDEF12-3456-4ABC-8DEF-1234567890AB" }), {
    supabase: maiuscula.supabase,
    executarEstorno: executorQue(EM_PROCESSAMENTO).fn,
    buscar: buscarQueNaoDeveSerChamado(),
  });
  assertEquals(ok.status, 202);

  for (
    const ruim of [
      `x${REFUND}`,
      `${REFUND}x`,
      `${REFUND}${REFUND}`,
      [REFUND],
      12345,
      { toString: () => REFUND },
    ]
  ) {
    const b = banco({ linha: LINHA, pedido: PEDIDO });
    const ex = executorQue(EM_PROCESSAMENTO);
    const r = await executar(pedirJson({ refund_id: ruim }), {
      supabase: b.supabase,
      executarEstorno: ex.fn,
      buscar: buscarQueNaoDeveSerChamado(),
    });
    assertEquals(r.status, 400, `refund_id ${JSON.stringify(ruim)}`);
    assertEquals(b.consultas.length, 0);
    assertEquals(ex.chamadas.length, 0);
  }
});

// ── 5. Pré-voo CORS e corpo em lista ──────────────────────────────────────

Deno.test("pré-voo CORS (OPTIONS) responde ok com os cabeçalhos, sem ler o corpo nem o banco", async () => {
  const b = banco({ linha: LINHA, pedido: PEDIDO });
  const r = await executar(
    new Request("https://edge.test/estornar-pagamento", { method: "OPTIONS" }),
    { supabase: b.supabase, buscar: buscarQueNaoDeveSerChamado() },
  );
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert(r.headers.get("Access-Control-Allow-Headers")?.includes("authorization"));
  assertEquals(b.consultas.length, 0);
});

Deno.test("corpo em lista -> 400 'Corpo inválido' (e não o erro do refund_id), sem tocar o banco", async () => {
  for (const corpo of [[], [{ refund_id: REFUND }], null, 7, "texto"]) {
    const b = banco({ linha: LINHA, pedido: PEDIDO });
    const r = await executar(pedirJson(corpo), { supabase: b.supabase });
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals(await r.json(), { erro: "Corpo inválido: esperado JSON { refund_id }." });
    assertEquals(b.consultas.length, 0);
  }
});

// ── 6. A ação `reemitir` ──────────────────────────────────────────────────

const PEDIDO_ORDER = {
  ...PEDIDO,
  gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
};
const ORDER_SEM_REEMBOLSO = {
  id: "ORD01ABCDEFOLUIMWQKDXYZ01",
  status: "processed",
  transactions: { payments: [{ id: "PAY1", status: "processed" }] },
};

function mpDaOrder() {
  const chamadas: Array<{ url: string; headers: Record<string, string> }> = [];
  const buscar = ((entrada: unknown, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    chamadas.push({ url, headers });
    return Promise.resolve(
      new Response(JSON.stringify(ORDER_SEM_REEMBOLSO), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { buscar, chamadas };
}

function bancoDaReemissao(extra: Opcoes = {}) {
  return banco({
    devolucao: { id: DEVOLUCAO, order_id: PEDIDO_ID },
    linha: { ...LINHA, id: ESPERADA },
    pedido: PEDIDO_ORDER,
    ...extra,
  });
}

Deno.test("reemitir: cada id é validado SOZINHO — devolução ruim ou linha esperada ruim dá 400 e nada é lido", async () => {
  for (
    const corpo of [
      { acao: "reemitir", devolucao_id: DEVOLUCAO, refund_esperado: "lixo" },
      { acao: "reemitir", devolucao_id: "lixo", refund_esperado: ESPERADA },
      { acao: "reemitir", devolucao_id: DEVOLUCAO },
      { acao: "reemitir", refund_esperado: ESPERADA },
      { acao: "reemitir", devolucao_id: [DEVOLUCAO], refund_esperado: ESPERADA },
      { acao: "reemitir", devolucao_id: DEVOLUCAO, refund_esperado: [ESPERADA] },
    ]
  ) {
    const b = bancoDaReemissao();
    const mp = mpDaOrder();
    const r = await executar(pedirJson(corpo), { supabase: b.supabase, buscar: mp.buscar });
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals(b.consultas.length, 0);
    assertEquals(b.rpcs.length, 0);
    assertEquals(mp.chamadas.length, 0);
  }
});

Deno.test("reemitir: ids com espaço nas pontas são aparados antes de chegar ao banco", async () => {
  const b = bancoDaReemissao();
  const mp = mpDaOrder();
  const r = await executar(
    pedirJson({
      acao: "reemitir",
      devolucao_id: ` ${DEVOLUCAO} `,
      refund_esperado: `\t${ESPERADA}\n`,
    }),
    { supabase: b.supabase, buscar: mp.buscar },
  );
  assertEquals(r.status, 200);
  const rpc = b.rpcs.find((x) => x.nome === "reemitir_reembolso_da_devolucao")!;
  assertEquals(rpc.args.p_devolucao_id, DEVOLUCAO);
  assertEquals(rpc.args.p_refund_esperado, ESPERADA);
});

Deno.test("reemitir: o status HTTP que o banco decide chega ao lojista (conflito é 409, não 200)", async () => {
  const b = bancoDaReemissao({
    reemissaoErro: { code: "22023", message: "A devolução já tem reembolso em andamento." },
  });
  const mp = mpDaOrder();
  const r = await executar(
    pedirJson({ acao: "reemitir", devolucao_id: DEVOLUCAO, refund_esperado: ESPERADA }),
    { supabase: b.supabase, buscar: mp.buscar },
  );
  assertEquals(r.status, 409);
  assertEquals(await r.json(), { erro: "A devolução já tem reembolso em andamento." });
});

Deno.test("reemitir: a consulta ao Mercado Pago leva o token da credencial resolvida, nunca vazio", async () => {
  const b = bancoDaReemissao();
  const mp = mpDaOrder();
  await executar(
    pedirJson({ acao: "reemitir", devolucao_id: DEVOLUCAO, refund_esperado: ESPERADA }),
    { supabase: b.supabase, buscar: mp.buscar },
  );
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].headers["authorization"], `Bearer ${TOKEN_ENV}`);
});
