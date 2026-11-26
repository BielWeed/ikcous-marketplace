// @ts-nocheck
/**
 * reconciliar-pagamentos — o BATIMENTO (migration 20261500000000, plano VIGIA DA FROTA, 26/11/2026).
 *
 * No fim de toda rodada que passou da autenticação, a edge grava a saúde da rodada pela porta
 * `saude_da_reconciliacao_registrar` (degradada ou não, e quais etapas falharam — derivado de `etapas`,
 * o mesmo objeto da resposta). Quem confere de fora lê `saude_da_loja()` e vê a IDADE da última rodada:
 * nula ou alta = a reconciliação parou.
 *
 * O que este arquivo fixa:
 *   (a) rodada saudável (200): grava degradado = false, sem etapa, DEPOIS de todo o resto do trabalho;
 *   (b) rodada degradada com HTTP 200: grava degradado = true com a etapa que falhou;
 *   (c) rodada que responde 500 (fila de pagamentos ilegível): grava também (degradada, com "pagamentos");
 *   (d) a porta devolve erro: status e corpo IGUAIS aos da rodada em que ela grava; o log leva só o NOME
 *       e o CÓDIGO do erro (PGRST202, 42501; nunca a mensagem, o detalhe nem um "código" de texto livre);
 *   (e) a porta lança (síncrona ou rejeitada): idem;
 *   (g) a porta nunca responde: a rodada não espera além do teto e responde igual (log: PrazoEsgotado);
 *   (f) 503 (sem RECONCILIACAO_SECRET) e 401 (segredo errado) NÃO gravam — de propósito: o batimento
 *       envelhece e o vigia acusa.
 *
 * O banco é um dublê NEUTRO (qualquer leitura não roteirizada devolve vazio, sem erro). Dados inventados.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-ficticio-batimento-da-reconciliacao";
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-ficticio-batimento");

const PORTA = "saude_da_reconciliacao_registrar";
const MENSAGEM_SECRETA = "detalhe-interno-que-nao-pode-ir-ao-log";

type Retorno = { data: unknown; error: unknown };
type Chamada = { tipo: "rpc" | "from"; nome: string; args?: unknown };

function banco(opts: {
  falharFila?: boolean;
  falharEstornos?: boolean;
  porta?: (args: unknown) => Promise<Retorno>;
} = {}) {
  const chamadas: Chamada[] = [];

  const cadeia = (tabela: string) => {
    let escrita = false;
    let colunas = "";
    const q: any = {};
    const encadear = () => q;
    const escrever = () => {
      escrita = true;
      return q;
    };
    Object.assign(q, {
      eq: encadear,
      neq: encadear,
      in: encadear,
      is: encadear,
      lt: encadear,
      lte: encadear,
      gt: encadear,
      gte: encadear,
      not: encadear,
      order: encadear,
      limit: encadear,
      ilike: encadear,
      or: encadear,
      filter: encadear,
      contains: encadear,
      update: escrever,
      insert: escrever,
      upsert: escrever,
      delete: escrever,
    });
    q.select = (c?: string) => {
      colunas = c ?? "";
      return q;
    };
    const resolver = (unica: boolean): Retorno => {
      if (!escrita && opts.falharEstornos && tabela === "order_refunds") {
        return { data: null, error: { message: "fila de estornos fora do ar (dublê)" } };
      }
      if (escrita) return { data: unica ? { id: "x" } : [{ id: "x" }], error: null };
      return { data: unica ? null : [], error: null };
    };
    q.maybeSingle = () => Promise.resolve(resolver(true));
    q.single = () => Promise.resolve(resolver(true));
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolver(false)).then(res, rej);
    void colunas;
    return q;
  };

  const supabase = {
    from: (tabela: string) => {
      chamadas.push({ tipo: "from", nome: tabela });
      return cadeia(tabela);
    },
    rpc: (nome: string, args: unknown) => {
      chamadas.push({ tipo: "rpc", nome, args });
      if (nome === PORTA) {
        return opts.porta ? opts.porta(args) : Promise.resolve({ data: null, error: null });
      }
      if (nome === "pagamentos_a_reconciliar") {
        return Promise.resolve(
          opts.falharFila
            ? { data: null, error: { message: "fila fora do ar (dublê)" } }
            : { data: [], error: null },
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabase, chamadas };
}

function requisicao(segredo = SEGREDO) {
  return new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": segredo },
  });
}

async function rodar(b: ReturnType<typeof banco>, segredo = SEGREDO, tetoDoBatimentoMs?: number) {
  const reais = { log: console.log, warn: console.warn, error: console.error };
  const logs: string[] = [];
  // Um Error passado inteiro ao console imprime a mensagem e o stack: o capturador também, senão
  // JSON.stringify(new Error("x")) daria "{}" e esconderia o vazamento que o teste procura.
  const texto = (x: unknown) =>
    typeof x === "string"
      ? x
      : x instanceof Error
      ? `${x.name}: ${x.message} ${JSON.stringify(x)} ${x.stack ?? ""}`
      : JSON.stringify(x) ?? String(x);
  const guardar = (...a: unknown[]) => {
    logs.push(a.map(texto).join(" "));
  };
  console.log = guardar;
  console.warn = guardar;
  console.error = guardar;
  try {
    const resposta = await handler(requisicao(segredo), {
      supabase: b.supabase,
      fetchImpl: () => Promise.resolve(new Response("{}", { status: 404 })),
      enviarPush: () => Promise.resolve(),
      enviarComprovante: () => Promise.resolve(),
      enviarAvisoAtrasado: () => Promise.resolve(),
      enviarPushContado: () => Promise.resolve(1),
      vendedorId: "123456",
      ...(tetoDoBatimentoMs === undefined ? {} : { tetoDoBatimentoMs }),
    });
    return { status: resposta.status, corpo: await resposta.json(), logs };
  } finally {
    console.log = reais.log;
    console.warn = reais.warn;
    console.error = reais.error;
  }
}

const gravacoes = (b: ReturnType<typeof banco>) => b.chamadas.filter((c) => c.tipo === "rpc" && c.nome === PORTA);

// ── (a) rodada saudável ──────────────────────────────────────────────────

Deno.test("(a) rodada saudável: grava UMA vez, degradado = false e sem etapa, depois de todo o resto", async () => {
  const b = banco();
  const r = await rodar(b);

  assertEquals(r.status, 200);
  assertEquals(r.corpo.degradado, false);
  assertEquals(gravacoes(b), [{ tipo: "rpc", nome: PORTA, args: { p_degradado: false, p_etapas_com_falha: [] } }]);
  assertEquals(b.chamadas.at(-1)?.nome, PORTA, "o batimento é a última coisa que a rodada faz no banco");
});

// ── (b) rodada degradada com 200 ────────────────────────────────────────

Deno.test("(b) rodada degradada com HTTP 200: grava degradado = true com a etapa que falhou (derivada de etapas)", async () => {
  const b = banco({ falharEstornos: true });
  const r = await rodar(b);

  assertEquals(r.status, 200);
  assertEquals(r.corpo.degradado, true);
  assertEquals(r.corpo.etapas.estornos.ok, false);
  const falhas = Object.entries(r.corpo.etapas).filter(([, e]) => !e.ok).map(([n]) => n);
  assertEquals(gravacoes(b).map((g) => g.args), [{ p_degradado: true, p_etapas_com_falha: falhas }]);
  // O dublê derruba toda leitura de order_refunds: a contestação (que também a lê) cai junto. Os
  // pagamentos e os cancelamentos seguem bons — a lista é a das etapas que falharam, nada além.
  assertEquals(falhas, ["estornos", "contestacoes"]);
});

// ── (c) rodada que responde 500 ─────────────────────────────────────────

Deno.test("(c) fila de pagamentos ilegível (500): grava também, degradada, com 'pagamentos'", async () => {
  const b = banco({ falharFila: true });
  const r = await rodar(b);

  assertEquals(r.status, 500);
  assertEquals(r.corpo.ok, false);
  assertEquals(gravacoes(b).map((g) => g.args), [{ p_degradado: true, p_etapas_com_falha: ["pagamentos"] }]);
});

// ── (d) e (e) a porta falha: nada muda na resposta, o log leva só o nome e o código ──

const CASOS_DA_PORTA = [
  {
    rotulo: "devolve { error } (função ausente, PGRST202)",
    porta: () =>
      Promise.resolve({
        data: null,
        error: Object.assign(new Error(MENSAGEM_SECRETA), {
          name: "PostgrestError",
          code: "PGRST202",
          details: MENSAGEM_SECRETA,
          hint: MENSAGEM_SECRETA,
        }),
      }),
    nome: "PostgrestError",
    codigo: "PGRST202",
  },
  {
    rotulo: "devolve { error } de permissão (42501)",
    porta: () => Promise.resolve({ data: null, error: { name: "PostgrestError", code: "42501", message: MENSAGEM_SECRETA } }),
    nome: "PostgrestError",
    codigo: "42501",
  },
  {
    // Um "código" que é texto livre não vai ao log: só o que tem cara de código.
    rotulo: "devolve { error } com code de texto livre",
    porta: () => Promise.resolve({ data: null, error: { name: "PostgrestError", code: MENSAGEM_SECRETA, message: "x" } }),
    nome: "PostgrestError",
    codigo: "sem_codigo",
  },
  {
    rotulo: "rejeita a promessa",
    porta: () => Promise.reject(new TypeError(MENSAGEM_SECRETA)),
    nome: "TypeError",
    codigo: "sem_codigo",
  },
  {
    rotulo: "lança de forma síncrona",
    porta: () => {
      throw new RangeError(MENSAGEM_SECRETA);
    },
    nome: "RangeError",
    codigo: "sem_codigo",
  },
];

for (const { rotulo, porta, nome, codigo } of CASOS_DA_PORTA) {
  for (const [cenario, opcoes] of [
    ["saudável", {}],
    ["degradada", { falharEstornos: true }],
    ["500", { falharFila: true }],
  ] as const) {
    Deno.test(`(d/e) a porta ${rotulo}, rodada ${cenario}: status e corpo IGUAIS aos da rodada que grava; log só com o nome e o código do erro`, async () => {
      const referencia = await rodar(banco(opcoes));
      const b = banco({ ...opcoes, porta });
      const r = await rodar(b);

      assertEquals(r.status, referencia.status);
      assertEquals(r.corpo, referencia.corpo);
      assertEquals(gravacoes(b).length, 1, "tentou gravar uma vez");
      const linhas = r.logs.filter((l) => l.includes("saude_da_reconciliacao_registrar"));
      assertEquals(linhas.length, 1, `um aviso no log: ${JSON.stringify(r.logs)}`);
      assertEquals(r.logs.some((l) => l.includes(MENSAGEM_SECRETA)), false, "a mensagem do erro não vai ao log");
      assertStringIncludes(linhas[0], ` ${nome} ${codigo}`);
    });
  }
}

// ── (g) a porta nunca responde: a rodada não espera além do teto ─────────

for (const [cenario, opcoes] of [
  ["saudável", {}],
  ["degradada", { falharEstornos: true }],
  ["500", { falharFila: true }],
] as const) {
  Deno.test(`(g) a porta nunca responde, rodada ${cenario}: a resposta sai IGUAL e dentro do teto; o log diz PrazoEsgotado`, async () => {
    const referencia = await rodar(banco(opcoes));
    const b = banco({ ...opcoes, porta: () => new Promise(() => {}) });
    const inicio = Date.now();
    const r = await rodar(b, SEGREDO, 50);
    const ms = Date.now() - inicio;

    assert(ms < 2000, `a rodada esperou ${ms} ms pela porta`);
    assertEquals(r.status, referencia.status);
    assertEquals(r.corpo, referencia.corpo);
    assertEquals(gravacoes(b).length, 1);
    const linhas = r.logs.filter((l) => l.includes("saude_da_reconciliacao_registrar"));
    assertEquals(linhas.length, 1, `um aviso no log: ${JSON.stringify(r.logs)}`);
    assertStringIncludes(linhas[0], " PrazoEsgotado sem_codigo");
  });
}

// ── (f) saídas cedo não gravam ──────────────────────────────────────────

Deno.test("(f) 401 (segredo errado): não grava batimento", async () => {
  const b = banco();
  const r = await rodar(b, "segredo-errado");

  assertEquals(r.status, 401);
  assertEquals(b.chamadas, [], "nenhum toque no banco");
});

Deno.test("(f) 503 (sem RECONCILIACAO_SECRET no ambiente): não grava batimento", async () => {
  const b = banco();
  Deno.env.delete("RECONCILIACAO_SECRET");
  try {
    const r = await rodar(b);
    assertEquals(r.status, 503);
    assertEquals(b.chamadas, [], "nenhum toque no banco");
  } finally {
    Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
  }
});
