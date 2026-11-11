import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import type { ExecutorEstorno } from "./index.ts";

// O clique "Devolver" só executa dinheiro de linha VIVA. Duas camadas
// independentes, cada uma presa aqui por um teste que falha se ela sumir:
//   1. o portão de status da linha lida (index.ts, passo 2);
//   2. o filtro `.in('status', ['solicitado','em_processamento'])` do UPDATE
//      da marca "em andamento" (index.ts, passo 5), que vale quando a linha
//      mudou ENTRE a leitura e a marca (cron, webhook, clique paralelo).
// O index_test.ts (F4) só cobre o portão com 'concluido'; aqui entram
// falhou e recusado como estado de ENTRADA e o filtro da marca.

const URL_SUPA = "https://supa-fake.local";
const ADMIN = "admin-1111-2222";
const REFUND = "44444444-4444-4444-8444-444444444444";
const PEDIDO = "pedido-status-1";

type Linha = Record<string, unknown>;
type Filtro = { metodo: string; coluna: string; valor: unknown };
type Consulta = { tabela: string; filtros: Filtro[]; valores: Linha | null };

type OpcoesDoBanco = {
  /** Roda quando o handler lê o PEDIDO (passo 3), isto é, DEPOIS de ler a
   * linha e ANTES da marca: simula o outro executor mudando a linha no meio. */
  aoLerOPedido?: (linhas: Linha[]) => void;
};

/**
 * Banco em memória que APLICA os filtros de verdade, nas leituras e nas
 * escritas (.eq, .neq, .in, .not is null): o UPDATE só altera as linhas que
 * passam pelos filtros e devolve só essas. Sem isso o filtro da marca seria
 * decorativo no teste.
 */
function banco(statusInicial: string, opcoes: OpcoesDoBanco = {}) {
  const linhas: Linha[] = [{
    id: REFUND,
    order_id: PEDIDO,
    amount: 40,
    status: statusInicial,
    mp_refund_id: null,
    tentativas: 1,
    solicitado_por: ADMIN,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
  }];
  const tabelas = new Map<string, Linha[]>([
    ["order_refunds", linhas],
    ["marketplace_orders", [{
      id: PEDIDO,
      gateway_payment_id: "pagamento-status-1",
      total: 90,
      valor_estornado: 0,
      payment_status: "pago",
      paid_at: "2026-11-01T12:00:00Z",
      status: "processing",
    }]],
    ["app_settings", []],
  ]);
  const consultas: Consulta[] = [];
  const escritas: string[][] = [];
  const rpcs: string[] = [];
  const supabase = {
    from(tabela: string) {
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
        not(coluna: string, operador: string, valor: unknown) {
          if (operador !== "is" || valor !== null) {
            throw new Error("Operador inesperado");
          }
          consulta.filtros.push({ metodo: "notNull", coluna, valor });
          return api;
        },
        maybeSingle() {
          unica = true;
          return api;
        },
        then(
          resolve: (
            resultado: { data: Linha | Linha[] | null; error: unknown },
          ) => unknown,
        ) {
          consultas.push(consulta);
          if (tabela === "marketplace_orders") opcoes.aoLerOPedido?.(linhas);
          const selecionadas = dados.filter((item) =>
            consulta.filtros.every((filtro) => {
              const valor = item[filtro.coluna];
              if (filtro.metodo === "eq") return valor === filtro.valor;
              if (filtro.metodo === "neq") return valor !== filtro.valor;
              if (filtro.metodo === "in") {
                return (filtro.valor as unknown[]).includes(valor);
              }
              if (filtro.metodo === "is") {
                return (valor ?? null) === filtro.valor;
              }
              if (filtro.metodo === "notNull") {
                return valor !== null && valor !== undefined;
              }
              throw new Error("Filtro inesperado");
            })
          );
          if (consulta.valores) {
            escritas.push(selecionadas.map((item) => String(item.id)));
            for (const item of selecionadas) {
              Object.assign(item, consulta.valores);
            }
          }
          // Snapshot: a marca posterior não altera o que o handler já leu.
          const copias = selecionadas.map((item) => ({ ...item }));
          return Promise.resolve({
            data: unica ? (copias[0] ?? null) : copias,
            error: null,
          }).then(resolve);
        },
      };
      return api;
    },
    rpc(nome: string) {
      rpcs.push(nome);
      throw new Error(`RPC não prevista neste cenário: ${nome}`);
    },
  };
  return { supabase, linhas, consultas, escritas, rpcs };
}

async function clicar(statusInicial: string, opcoes: OpcoesDoBanco = {}) {
  const b = banco(statusInicial, opcoes);
  const antes = structuredClone(b.linhas);
  // Cada execução do executor é UMA chamada ao Mercado Pago (o executor
  // injetado é a fronteira com o MP; a rede externa abaixo é proibida).
  const chamadasAoMp: Array<{ linha: string; status: string; valor: number }> =
    [];
  const externas: string[] = [];
  const buscar: typeof fetch = (input) => {
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
    } else if (
      url.origin === URL_SUPA && url.pathname === "/rest/v1/profiles"
    ) {
      corpo = { id: ADMIN, role: "admin" };
    } else {
      externas.push(url.href);
      throw new Error("Nenhuma rede externa é permitida");
    }
    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const executarEstorno: ExecutorEstorno = ({ linha }) => {
    chamadasAoMp.push({
      linha: linha.id,
      status: linha.status,
      valor: linha.amount,
    });
    return Promise.resolve({
      tipo: "em_processamento",
      mp_refund_id: null,
      mp_status: "pending",
    });
  };
  const ambiente = new Map([
    ["SUPABASE_URL", URL_SUPA],
    ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
    [
      "SUPABASE_SECRET_KEYS",
      JSON.stringify({ default: "service-role-de-teste" }),
    ],
    ["MP_ACCESS_TOKEN", "TEST-0000000000000000-000000"],
  ]);
  const anteriores = new Map(
    [...ambiente.keys()].map((chave) => [chave, Deno.env.get(chave)]),
  );
  const fetchAnterior = globalThis.fetch;
  const chaveStorage = "sb-supa-fake-auth-token";
  const storageAnterior = localStorage.getItem(chaveStorage);
  try {
    for (const [chave, valor] of ambiente) Deno.env.set(chave, valor);
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
    const resposta = await handler(
      new Request("https://edge.test/estornar-pagamento", {
        method: "POST",
        headers: {
          Authorization: "Bearer jwt-de-teste",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refund_id: REFUND }),
      }),
      { supabase: b.supabase, buscar, executarEstorno },
    );
    return { resposta, banco: b, antes, chamadasAoMp, externas };
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
    if (storageAnterior === null) localStorage.removeItem(chaveStorage);
    else localStorage.setItem(chaveStorage, storageAnterior);
  }
}

// ── Camada 1: o portão de status da linha lida ─────────────────────────────

for (const status of ["solicitado", "em_processamento"]) {
  Deno.test(`portão: linha ${status} estorna (1 chamada ao Mercado Pago, linha marcada em_processamento)`, async () => {
    const { resposta, banco: b, chamadasAoMp, externas } = await clicar(status);
    assertEquals(resposta.status, 202);
    assertEquals((await resposta.json()).status, "em_processamento");
    assertEquals(chamadasAoMp, [{
      linha: REFUND,
      status: "em_processamento",
      valor: 40,
    }]);
    // marca (tentativas 1 -> 2) + diagnóstico do ramo em_processamento.
    assertEquals(b.escritas, [[REFUND], [REFUND]]);
    assertEquals(b.linhas[0].status, "em_processamento");
    assertEquals(b.linhas[0].tentativas, 2);
    assertEquals(b.rpcs, []);
    assertEquals(externas, []);
  });
}

for (const status of ["concluido", "falhou", "recusado"]) {
  Deno.test(`portão: linha ${status} NÃO estorna (409 estorno_ja_tratado, 0 chamadas ao MP, nenhuma escrita)`, async () => {
    const { resposta, banco: b, antes, chamadasAoMp, externas } = await clicar(
      status,
    );
    assertEquals(resposta.status, 409);
    // O texto exato importa: com o portão frouxo, a marca (.in) ainda barra,
    // mas devolveria 'estorno_em_execucao' — outro erro, outro significado.
    assertEquals(await resposta.json(), { erro: "estorno_ja_tratado", status });
    assertEquals(chamadasAoMp, []);
    assertEquals(b.escritas, []);
    assertEquals(b.linhas, antes);
    assertEquals(b.rpcs, []);
    assertEquals(externas, []);
    // Parou na leitura da linha: nem o pedido foi lido.
    assertEquals(b.consultas.map((c) => c.tabela), ["order_refunds"]);
  });
}

// ── Camada 2: o filtro de status da MARCA "em andamento" ───────────────────

for (const terminal of ["concluido", "falhou", "recusado"]) {
  Deno.test(`marca: linha lida solicitado que virou ${terminal} no meio NÃO é remarcada nem executada (409 estorno_em_execucao)`, async () => {
    const { resposta, banco: b, chamadasAoMp, externas } = await clicar(
      "solicitado",
      {
        aoLerOPedido: (linhas) => {
          // O outro executor termina a linha entre a leitura e a marca.
          linhas[0].status = terminal;
        },
      },
    );
    assertEquals(resposta.status, 409);
    assertEquals(await resposta.json(), { erro: "estorno_em_execucao" });
    assertEquals(chamadasAoMp, []);
    // A marca foi tentada e não alterou NENHUMA linha (o filtro barrou).
    assertEquals(b.escritas, [[]]);
    // O estado terminal do outro executor e o contador ficam intactos.
    assertEquals(b.linhas[0].status, terminal);
    assertEquals(b.linhas[0].tentativas, 1);
    assertEquals(b.linhas[0].updated_at, undefined);
    // E o filtro que fez isso é exatamente a lista de estados vivos.
    const marca = b.consultas.find((c) => c.valores !== null);
    assert(marca, "a marca deveria ter sido tentada");
    assertEquals(
      marca.filtros.filter((f) => f.metodo === "in"),
      [{
        metodo: "in",
        coluna: "status",
        valor: ["solicitado", "em_processamento"],
      }],
    );
    assertEquals(b.rpcs, []);
    assertEquals(externas, []);
  });
}

Deno.test("marca: linha lida solicitado que virou em_processamento no meio (ainda viva) é remarcada e executa UMA vez", async () => {
  const { resposta, banco: b, chamadasAoMp } = await clicar("solicitado", {
    aoLerOPedido: (linhas) => {
      linhas[0].status = "em_processamento";
    },
  });
  assertEquals(resposta.status, 202);
  assertEquals(chamadasAoMp.length, 1);
  assertEquals(b.escritas, [[REFUND], [REFUND]]);
  assertEquals(b.linhas[0].status, "em_processamento");
  assertEquals(b.linhas[0].tentativas, 2);
});
