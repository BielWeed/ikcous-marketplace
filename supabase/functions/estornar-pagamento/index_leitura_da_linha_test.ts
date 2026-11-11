import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import type { ExecutorEstorno } from "./index.ts";

const URL_SUPA = "https://supa-fake.local";
const ADMIN = "admin-1111-2222";
const REFUND_A = "11111111-1111-4111-8111-111111111111";
const REFUND_B = "22222222-2222-4222-8222-222222222222";
const INEXISTENTE = "33333333-3333-4333-8333-333333333333";

type Linha = Record<string, unknown>;
type Filtro = { metodo: string; coluna: string; valor: unknown };
type Consulta = { tabela: string; filtros: Filtro[]; valores: Linha | null };

/** Banco em memória: filtra leituras E escritas, sem resposta fixa por chamada. */
function bancoComDuasLinhas() {
  const linha = (id: string, pedido: string, amount: number) => ({
    id,
    order_id: pedido,
    amount,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 0,
    solicitado_por: ADMIN,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
  });
  const pedido = (id: string, pagamento: string, total: number) => ({
    id,
    gateway_payment_id: pagamento,
    total,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-11-01T12:00:00Z",
    status: "processing",
  });
  // B primeiro: devolver a primeira linha sem filtrar também seria errado.
  const linhas: Linha[] = [
    linha(REFUND_B, "pedido-b", 80),
    linha(REFUND_A, "pedido-a", 25),
  ];
  const tabelas = new Map<string, Linha[]>([
    ["order_refunds", linhas],
    ["marketplace_orders", [
      pedido("pedido-b", "pagamento-b", 80),
      pedido("pedido-a", "pagamento-a", 25),
    ]],
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
          const selecionadas = dados.filter((item) =>
            consulta.filtros.every((filtro) => {
              const valor = new Map(Object.entries(item)).get(filtro.coluna);
              if (filtro.metodo === "eq") return valor === filtro.valor;
              if (filtro.metodo === "neq") return valor !== filtro.valor;
              if (filtro.metodo === "in") {
                return (filtro.valor as unknown[]).includes(valor);
              }
              if (filtro.metodo === "notNull") {
                return valor !== null && valor !== undefined;
              }
              throw new Error("Filtro inesperado");
            })
          );
          if (unica && selecionadas.length > 1) {
            return Promise.resolve({ data: null, error: { code: "PGRST116" } })
              .then(resolve);
          }
          if (consulta.valores) {
            escritas.push(selecionadas.map((item) => String(item.id)));
            for (const item of selecionadas) {
              Object.assign(item, consulta.valores);
            }
          }
          // Snapshot: a marca posterior não deve alterar a linha que o handler leu.
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

async function solicitar(refundId: string) {
  const banco = bancoComDuasLinhas();
  const antes = structuredClone(banco.linhas);
  const execucoes: Array<
    { linha: string; pedido: string; pagamento: string; valor: number }
  > = [];
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
      if (url.searchParams.get("id") !== `eq.${ADMIN}`) {
        throw new Error("Perfil fora da sessão");
      }
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
  const executarEstorno: ExecutorEstorno = ({ linha, pedido }) => {
    execucoes.push({
      linha: linha.id,
      pedido: pedido.id,
      pagamento: pedido.gateway_payment_id,
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
        body: JSON.stringify({ refund_id: refundId }),
      }),
      { supabase: banco.supabase, buscar, executarEstorno },
    );
    return { resposta, banco, antes, execucoes, externas };
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

Deno.test("duas devoluções elegíveis: pedir A executa só A com o pagamento de A e preserva B", async () => {
  const { resposta, banco, antes, execucoes, externas } = await solicitar(
    REFUND_A,
  );
  assertEquals(resposta.status, 202);
  assertEquals((await resposta.json()).status, "em_processamento");
  assertEquals(execucoes, [{
    linha: REFUND_A,
    pedido: "pedido-a",
    pagamento: "pagamento-a",
    valor: 25,
  }]);
  assertEquals(banco.linhas[0], antes[0]);
  assertEquals(banco.linhas[1].status, "em_processamento");
  assertEquals(banco.linhas[1].tentativas, 1);
  assertEquals(banco.escritas, [[REFUND_A], [REFUND_A]]);
  assertEquals(banco.rpcs, []);
  assertEquals(externas, []);
  assertEquals(banco.consultas[0], {
    tabela: "order_refunds",
    valores: null,
    filtros: [{ metodo: "eq", coluna: "id", valor: REFUND_A }],
  });
});

Deno.test("id inexistente entre duas devoluções elegíveis: 404 sem marca, executor, RPC ou rede externa", async () => {
  const { resposta, banco, antes, execucoes, externas } = await solicitar(
    INEXISTENTE,
  );
  assertEquals(resposta.status, 404);
  assertEquals(await resposta.json(), { erro: "Devolução não encontrada." });
  assertEquals(banco.linhas, antes);
  assertEquals(banco.escritas, []);
  assertEquals(banco.rpcs, []);
  assertEquals(execucoes, []);
  assertEquals(externas, []);
  assertEquals(banco.consultas, [{
    tabela: "order_refunds",
    valores: null,
    filtros: [{ metodo: "eq", coluna: "id", valor: INEXISTENTE }],
  }]);
});
