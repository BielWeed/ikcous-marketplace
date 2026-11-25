import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import type { ExecutorEstorno } from "./index.ts";

// O clique "Devolver" mexe em dinheiro: quando o banco ou o executor FALHA, a
// resposta tem de ser 5xx (o painel mostra "tente de novo" e o robô repete) e
// NUNCA 200 — um 200 com `{ erro }` no corpo é lido como "deu certo" por
// qualquer cliente que olhe só o status. A suíte vizinha prova o texto e o
// estado do ledger dos ramos felizes e dos 409; os `return json(..., 500)` dos
// ramos de falha ficavam sem asserção de status (trocar por 200 não derrubava
// nada). Aqui cada ramo de falha é provocado e o status, o corpo e o EFEITO
// (nenhum POST ao MP, nenhuma marca indevida) são conferidos.
//
// Dublê de banco PRÓPRIO (o dos vizinhos não é exportado): HONRA os filtros nas
// escritas e aceita injeção de erro por tipo de chamada. Nada toca rede nem
// banco real; ids e chaves todos inventados.

const URL_SUPA = "https://supa-fake.local";
const ADMIN = "admin-aaaa-bbbb";
const REFUND = "55555555-5555-4555-8555-555555555555";
const DEVOLUCAO = "66666666-6666-4666-8666-666666666666";
const PEDIDO = "pedido-erro-1";

type Linha = Record<string, unknown>;
type Filtro = { metodo: string; coluna: string; valor: unknown };
type Consulta = { tabela: string; filtros: Filtro[]; valores: Linha | null };
type TipoDeChamada =
  | "le_linha"
  | "le_pedido"
  | "le_ids"
  | "marca"
  | "terminal"
  | "releitura"
  | "outra";

type OpcoesDoBanco = {
  /** Erro devolvido (junto com dados, como um PostgREST maluco faria) por tipo. */
  erros?: Partial<Record<TipoDeChamada, unknown>>;
  /** Sem a linha de pedido (maybeSingle -> null, sem erro). */
  semPedido?: boolean;
  /** Faz a tabela lançar (falha de rede/driver, não erro de PostgREST). */
  lancarEm?: string;
};

function banco(opcoes: OpcoesDoBanco = {}) {
  const erroInjetado = (tipo: TipoDeChamada): unknown => (opcoes.erros ? Reflect.get(opcoes.erros, tipo) : undefined);
  const linhas: Linha[] = [{
    id: REFUND,
    order_id: PEDIDO,
    amount: 40,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 1,
    solicitado_por: ADMIN,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
  }];
  const pedidos: Linha[] = opcoes.semPedido ? [] : [{
    id: PEDIDO,
    gateway_payment_id: "pagamento-erro-1",
    total: 90,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-11-01T12:00:00Z",
    status: "processing",
  }];
  const tabelas = new Map<string, Linha[]>([
    ["order_refunds", linhas],
    ["marketplace_orders", pedidos],
    ["app_settings", []],
    ["devolucoes", []],
  ]);
  const consultas: Array<Consulta & { tipo: TipoDeChamada }> = [];
  const escritas: Array<{ tipo: TipoDeChamada; ids: string[] }> = [];
  let leiturasDaLinha = 0;

  function classificar(c: Consulta): TipoDeChamada {
    if (c.tabela === "marketplace_orders") return "le_pedido";
    if (c.tabela !== "order_refunds") return "outra";
    if (c.valores) {
      const s = c.valores.status;
      if (s === "em_processamento" && c.filtros.some((f) => f.metodo === "in" && (f.valor as unknown[]).length === 2)) {
        return "marca";
      }
      if (s === "falhou" || s === "recusado") return "terminal";
      return "outra";
    }
    if (c.filtros.some((f) => f.metodo === "notNull")) return "le_ids";
    leiturasDaLinha++;
    return leiturasDaLinha === 1 ? "le_linha" : "releitura";
  }

  const supabase = {
    from(tabela: string) {
      if (opcoes.lancarEm === tabela) throw new Error(`queda simulada em ${tabela}`);
      const dados = tabelas.get(tabela);
      if (!dados) throw new Error(`Tabela inesperada: ${tabela}`);
      const consulta: Consulta = { tabela, filtros: [], valores: null };
      let unica = false;
      const api = {
        select(_colunas?: string) {
          return api;
        },
        update(valores: Linha) {
          consulta.valores = valores;
          return api;
        },
        eq(coluna: string, valor: unknown) {
          consulta.filtros.push({ metodo: "eq", coluna, valor });
          return api;
        },
        neq(coluna: string, valor: unknown) {
          consulta.filtros.push({ metodo: "neq", coluna, valor });
          return api;
        },
        in(coluna: string, valor: unknown[]) {
          consulta.filtros.push({ metodo: "in", coluna, valor });
          return api;
        },
        is(coluna: string, valor: unknown) {
          consulta.filtros.push({ metodo: "is", coluna, valor });
          return api;
        },
        not(_coluna: string, _operador: string, _valor: unknown) {
          consulta.filtros.push({ metodo: "notNull", coluna: _coluna, valor: null });
          return api;
        },
        maybeSingle() {
          unica = true;
          return api;
        },
        then(
          resolve: (r: { data: Linha | Linha[] | null; error: unknown }) => unknown,
        ) {
          const tipo = classificar(consulta);
          consultas.push({ ...consulta, tipo });
          const selecionadas = dados.filter((item) =>
            consulta.filtros.every((f) => {
              const v = item[f.coluna];
              if (f.metodo === "eq") return v === f.valor;
              if (f.metodo === "neq") return v !== f.valor;
              if (f.metodo === "in") return (f.valor as unknown[]).includes(v);
              if (f.metodo === "is") return (v ?? null) === f.valor;
              if (f.metodo === "notNull") return v !== null && v !== undefined;
              throw new Error("Filtro inesperado");
            })
          );
          if (consulta.valores) {
            escritas.push({ tipo, ids: selecionadas.map((i) => String(i.id)) });
            // O erro injetado NÃO impede a escrita: o teste olha o efeito do
            // handler diante do erro, não a fidelidade do banco.
            if (!erroInjetado(tipo)) {
              for (const item of selecionadas) Object.assign(item, consulta.valores);
            }
          }
          const copias = selecionadas.map((item) => ({ ...item }));
          return Promise.resolve({
            data: unica ? (copias[0] ?? null) : copias,
            error: erroInjetado(tipo) ?? null,
          }).then(resolve);
        },
      };
      return api;
    },
    rpc(nome: string) {
      throw new Error(`RPC não prevista neste cenário: ${nome}`);
    },
  };
  return { supabase, linhas, consultas, escritas };
}

const ambiente = new Map([
  ["SUPABASE_URL", URL_SUPA],
  ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
  ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" })],
  ["MP_ACCESS_TOKEN", "TEST-0000000000000000-000000"],
]);

function buscarDoAuth(): typeof fetch {
  return (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    let corpo: unknown;
    if (url.origin === URL_SUPA && url.pathname === "/auth/v1/user") {
      corpo = {
        id: ADMIN,
        email: "admin@teste.local",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email", role: "admin" },
      };
    } else if (url.origin === URL_SUPA && url.pathname === "/rest/v1/profiles") {
      corpo = { id: ADMIN, role: "admin" };
    } else {
      throw new Error("Nenhuma rede externa é permitida");
    }
    return Promise.resolve(
      new Response(JSON.stringify(corpo), { headers: { "Content-Type": "application/json" } }),
    );
  };
}

async function comAmbiente(corpo: unknown, supabase: unknown, executarEstorno?: ExecutorEstorno): Promise<Response> {
  const buscar = buscarDoAuth();
  const anteriores = new Map([...ambiente.keys()].map((c) => [c, Deno.env.get(c)]));
  const fetchAnterior = globalThis.fetch;
  const chaveStorage = "sb-supa-fake-auth-token";
  const storageAnterior = localStorage.getItem(chaveStorage);
  try {
    for (const [c, v] of ambiente) Deno.env.set(c, v);
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
    globalThis.fetch = buscar;
    const { handler } = await import("./index.ts");
    return await handler(
      new Request("https://edge.test/estornar-pagamento", {
        method: "POST",
        headers: { Authorization: "Bearer jwt-de-teste", "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      }),
      { supabase, buscar, executarEstorno },
    );
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [c, v] of anteriores) {
      if (v === undefined) Deno.env.delete(c);
      else Deno.env.set(c, v);
    }
    if (storageAnterior === null) localStorage.removeItem(chaveStorage);
    else localStorage.setItem(chaveStorage, storageAnterior);
  }
}

function executorQueConta(resultado: unknown | (() => never)) {
  const chamadas: string[] = [];
  const executarEstorno: ExecutorEstorno = ({ linha }) => {
    chamadas.push(linha.id);
    if (typeof resultado === "function") (resultado as () => never)();
    return Promise.resolve(resultado as Awaited<ReturnType<ExecutorEstorno>>);
  };
  return { chamadas, executarEstorno };
}

const ERRO_DO_BANCO = { message: "falha simulada do banco", code: "XX000" };

// ── ramos de LEITURA e de MARCA: nada sai para o MP ──────────────────────────

Deno.test("erro ao ler a linha do ledger: 500 (nunca 200), nenhuma escrita, nenhum POST ao MP", async () => {
  const b = banco({ erros: { le_linha: ERRO_DO_BANCO } });
  const ex = executorQueConta({ tipo: "em_processamento", mp_refund_id: null, mp_status: "pending" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).erro, "Não consegui ler a devolução agora. Tente novamente em instantes.");
  assertEquals(ex.chamadas, []);
  assertEquals(b.escritas, []);
});

Deno.test("erro ao ler o pedido (mesmo com a linha do pedido junto na resposta): 500, a devolução NÃO é marcada nem enviada", async () => {
  const b = banco({ erros: { le_pedido: ERRO_DO_BANCO } });
  const ex = executorQueConta({ tipo: "em_processamento", mp_refund_id: null, mp_status: "pending" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).erro, "Não consegui ler o pedido desta devolução agora. Tente novamente em instantes.");
  assertEquals(ex.chamadas, []);
  assertEquals(b.escritas, []);
  assertEquals(b.linhas[0].status, "solicitado");
  assertEquals(b.linhas[0].tentativas, 1);
});

Deno.test("pedido da devolução sumiu (sem erro de banco): 500 e a linha NÃO ganha marca nem tentativa", async () => {
  const b = banco({ semPedido: true });
  const ex = executorQueConta({ tipo: "em_processamento", mp_refund_id: null, mp_status: "pending" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).erro, "Não consegui ler o pedido desta devolução agora. Tente novamente em instantes.");
  assertEquals(ex.chamadas, []);
  // Sem a trava, o handler marcaria a linha (tentativas 1 -> 2) e só então
  // tropeçaria no pedido nulo: a linha andaria rumo ao teto sem POST algum.
  assertEquals(b.escritas, []);
  assertEquals(b.linhas[0].tentativas, 1);
});

Deno.test("erro ao gravar a MARCA: 500 e nenhum POST ao MP (sem marca, sem dinheiro saindo)", async () => {
  const b = banco({ erros: { marca: ERRO_DO_BANCO } });
  const ex = executorQueConta({ tipo: "em_processamento", mp_refund_id: null, mp_status: "pending" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).erro, "Não consegui marcar a devolução agora. Tente novamente em instantes.");
  assertEquals(ex.chamadas, []);
  assertEquals(b.escritas.map((e) => e.tipo), ["marca"]);
});

// ── ramos DEPOIS do executor ─────────────────────────────────────────────────

Deno.test("desfecho terminal que o MP deu mas o banco NÃO gravou: 500 (não 200 'terminou'), sem reler a linha", async () => {
  const b = banco({ erros: { terminal: ERRO_DO_BANCO } });
  const ex = executorQueConta({ tipo: "falhou", motivo: "o MP recusou de vez", codigo: "x" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals(
    (await r.json()).erro,
    "A devolução terminou, mas o registro falhou. Atualize a página para ver o estado real.",
  );
  assertEquals(ex.chamadas, [REFUND]);
  assertEquals(b.consultas.some((c) => c.tipo === "releitura"), false);
});

Deno.test("executor devolve um tipo FORA da união: 500 'resposta inesperada' (falha alto, nunca 'ok')", async () => {
  const b = banco();
  const ex = executorQueConta({ tipo: "tipo_novo_que_ninguem_previu" });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals((await r.json()).erro, "Resposta inesperada do executor da devolução.");
  assertEquals(ex.chamadas, [REFUND]);
  // A linha continua marcada em_processamento (o cron decide) e NÃO vira terminal.
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(b.escritas.map((e) => e.tipo), ["marca"]);
});

Deno.test("executor LANÇA exceção: 500 do catch de topo (erro engolido não vira sucesso), linha segue em_processamento", async () => {
  const b = banco();
  const ex = executorQueConta(() => {
    throw new Error("queda de rede no meio do POST");
  });
  const r = await comAmbiente({ refund_id: REFUND }, b.supabase, ex.executarEstorno);
  assertEquals(r.status, 500);
  assertEquals(
    (await r.json()).erro,
    "Não foi possível processar a devolução agora. Tente novamente em instantes.",
  );
  assertEquals(ex.chamadas, [REFUND]);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(b.linhas[0].tentativas, 2);
  assert(!b.escritas.some((e) => e.tipo === "terminal"), "nada pode virar terminal numa exceção");
});

// ── ação reemitir: a queda do banco vira 500, não 200 ────────────────────────

Deno.test("reemitir: queda do banco no meio da reemissão responde 500 (catch de topo), nunca 200", async () => {
  const b = banco({ lancarEm: "devolucoes" });
  const r = await comAmbiente(
    { acao: "reemitir", devolucao_id: DEVOLUCAO, refund_esperado: REFUND },
    b.supabase,
  );
  assertEquals(r.status, 500);
  assertEquals(
    (await r.json()).erro,
    "Não foi possível reemitir o reembolso agora. Tente novamente em instantes.",
  );
  assertEquals(b.escritas, []);
});
