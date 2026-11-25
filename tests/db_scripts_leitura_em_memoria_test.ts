// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de literais e mapas fechados do próprio arquivo. */
/**
 * Os três scripts de LEITURA do banco — scripts/db-reconcilia-ledger.cjs,
 * scripts/db-snapshot-politicas.cjs e scripts/db-check-cron-expiracao.cjs —
 * rodando em memória (caça por mutação de 25/11/2026: nenhum deles tinha teste
 * algum).
 *
 * COMO RODA SEM TOCAR O MUNDO: os três executam `main()` ao serem carregados e
 * não exportam nada, então o código-fonte é lido como TEXTO e executado dentro
 * de uma função com `require`, `process`, `console`, `__dirname` e `Date`
 * trocados por dublês. `pg` é um Client falso que responde por expressão
 * regular sobre o SQL; `fs` é um mapa em memória (nenhum arquivo é lido ou
 * gravado de verdade, `.env` incluso); `process.exit` registra o PRIMEIRO
 * código e lança, como o processo real que termina ali; tudo que o script
 * imprime depois da saída é descartado. Nenhuma rede, nenhum banco.
 *
 * A URL de conexão é montada em pedaços e não tem senha: nada que pareça
 * segredo mora neste arquivo.
 *
 * Mutantes equivalentes anotados no fim do arquivo.
 */
import path from "node:path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const AGORA = "2026-08-05T23:41:02.123Z";
const URL_FALSA = `${["postgresql", "//"].join(":")}usuario-teste@banco-de-teste.invalid:5432/postgres`;

class Saida extends Error {
  constructor(codigo) {
    super(`saida ${codigo}`);
    this.codigo = codigo;
  }
}
// O `process.exit` falso lança na primeira chamada (o processo real acaba ali);
// se a promessa de `main().catch` rejeitar por causa disso, não é defeito.
globalThis.addEventListener("unhandledrejection", (e) => {
  if (e.reason instanceof Saida) e.preventDefault();
});

class DataFixa extends Date {
  constructor(...a) {
    if (a.length === 0) super(AGORA);
    else super(...a);
  }
}

async function rodar(
  arquivo,
  {
    env = { DATABASE_URL: URL_FALSA },
    argv = [],
    arquivos = {},
    migrations = [],
    respostas = [],
    pgAusente = false,
  } = {},
) {
  const fonte = Deno.readTextFileSync(
    new URL(`../scripts/${arquivo}`, import.meta.url),
  ).replace(/^#!.*\n/, "");
  const r = {
    logs: [],
    erros: [],
    avisos: [],
    tabelas: [],
    saida: null,
    consultas: [],
    clientes: [],
    gravados: [],
    pastas: [],
    leituras: [],
    fim: false,
  };
  let encerrado = false;
  const reg =
    (lista) =>
    (...a) => {
      if (!encerrado) lista.push(a.map(String).join(" "));
    };
  const consoleFalso = {
    log: reg(r.logs),
    error: reg(r.erros),
    warn: reg(r.avisos),
    table: (rows) => {
      if (!encerrado) r.tabelas.push(rows);
    },
  };
  const sair = (codigo) => {
    if (encerrado) return;
    encerrado = true;
    r.saida = codigo;
    throw new Saida(codigo);
  };
  class ClienteFalso {
    constructor(opcoes) {
      this.opcoes = opcoes;
      r.clientes.push(opcoes);
    }
    async connect() {}
    async query(sql, params) {
      r.consultas.push({ sql, params });
      for (const [rx, resposta] of respostas) {
        if (!rx.test(sql)) continue;
        if (resposta instanceof Error) throw resposta;
        return { rows: resposta, rowCount: resposta.length };
      }
      throw new Error(`consulta nao prevista: ${sql.slice(0, 60)}`);
    }
    async end() {
      r.fim = true;
    }
  }
  const fsFalso = {
    existsSync: (c) => Object.hasOwn(arquivos, path.basename(c)),
    readFileSync: (c) => {
      r.leituras.push(path.basename(c));
      const nome = path.basename(c);
      if (!Object.hasOwn(arquivos, nome)) throw new Error(`ENOENT ${nome}`);
      return arquivos[nome];
    },
    readdirSync: () => [...migrations],
    mkdirSync: (p, o) => r.pastas.push([p, o]),
    writeFileSync: (p, c, e) =>
      r.gravados.push({ caminho: p, conteudo: c, enc: e }),
  };
  const requireFalso = (nome) => {
    if (nome === "node:fs") return fsFalso;
    if (nome === "node:path") return path;
    if (nome === "pg") {
      if (pgAusente) throw new Error("Cannot find module 'pg'");
      return { Client: ClienteFalso };
    }
    throw new Error(`require inesperado: ${nome}`);
  };
  const processoFalso = { env, argv: ["node", arquivo, ...argv], exit: sair };
  const executar = new Function(
    "require",
    "process",
    "console",
    "__dirname",
    "Date",
    fonte,
  );
  try {
    executar(
      requireFalso,
      processoFalso,
      consoleFalso,
      "/repo/scripts",
      DataFixa,
    );
  } catch (e) {
    if (!(e instanceof Saida)) throw e;
  }
  for (let i = 0; i < 300 && r.saida === null && !r.fim; i++)
    await new Promise((fim) => setTimeout(fim, 2));
  await new Promise((fim) => setTimeout(fim, 20));
  return r;
}

// ===========================================================================
// db-check-cron-expiracao.cjs
// ===========================================================================
const CRON = "db-check-cron-expiracao.cjs";
const JOB = "expirar-pedidos-vencidos";
const linhaJob = (active) => ({
  jobname: JOB,
  schedule: "*/5 * * * *",
  command: "select 1",
  active,
});
const respostaCron = (rows) => [[/FROM cron\.job/, rows]];

Deno.test("cron: job ativo — imprime a tabela, não sai com código e fecha a conexão", async () => {
  const r = await rodar(CRON, { respostas: respostaCron([linhaJob(true)]) });
  assertEquals(r.saida, null);
  assertEquals(r.logs, [
    "Conectado em banco-de-teste.invalid",
    "Somente leitura. Nada sera alterado.",
  ]);
  assertEquals(r.tabelas, [[linhaJob(true)]]);
  assertEquals(r.erros, []);
  assert(r.fim, "tem de fechar a conexão");
  assertEquals(r.clientes[0], {
    connectionString: URL_FALSA,
    ssl: { rejectUnauthorized: false },
  });
});

Deno.test("cron: consulta só o job certo, com parâmetro, e só lê", async () => {
  const r = await rodar(CRON, { respostas: respostaCron([linhaJob(true)]) });
  assertEquals(r.consultas.length, 1);
  assertEquals(r.consultas[0].params, [JOB]);
  assertStringIncludes(r.consultas[0].sql, "WHERE jobname = $1");
  assert(!/insert|update|delete|alter|drop/i.test(r.consultas[0].sql));
});

Deno.test("cron: nenhum job — mensagem própria, código 1, e a tabela não é impressa", async () => {
  const r = await rodar(CRON, { respostas: respostaCron([]) });
  assertEquals(r.saida, 1);
  assertEquals(
    r.logs.at(-1),
    `Nenhum job '${JOB}' encontrado em cron.job. A migration foi aplicada?`,
  );
  assertEquals(r.tabelas, []);
});

Deno.test("cron: job inativo — mostra a tabela, explica e sai com 1", async () => {
  const r = await rodar(CRON, { respostas: respostaCron([linhaJob(false)]) });
  assertEquals(r.saida, 1);
  assertEquals(r.tabelas.length, 1);
  assertEquals(
    r.logs.at(-1),
    `Job '${JOB}' existe mas esta INATIVO (active=false). A varredura nao esta rodando.`,
  );
});

Deno.test("cron: só a primeira linha decide (ativa na frente de inativa passa)", async () => {
  const r = await rodar(CRON, {
    respostas: respostaCron([linhaJob(true), linhaJob(false)]),
  });
  assertEquals(r.saida, null);
});

Deno.test("cron: tabela cron.job inexistente (42P01) vira uma linha legível, código 1", async () => {
  const erro = Object.assign(new Error('relation "cron.job" does not exist'), {
    code: "42P01",
  });
  const r = await rodar(CRON, { respostas: respostaCron(erro) });
  assertEquals(r.saida, 1);
  assertEquals(
    r.logs.at(-1),
    "cron.job não existe: a extensão pg_cron ainda não está instalada neste banco.",
  );
  assertEquals(r.erros, []);
});

Deno.test("cron: outro erro do banco NÃO é engolido — sai 1 com 'Erro:' e a mensagem", async () => {
  const erro = Object.assign(new Error("permissao negada"), { code: "42501" });
  const r = await rodar(CRON, { respostas: respostaCron(erro) });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, ["Erro: permissao negada"]);
  assert(!r.logs.some((l) => l.includes("pg_cron")));
});

Deno.test("cron: sem DATABASE_URL em lugar nenhum — sai 1 dizendo onde procurou", async () => {
  const r = await rodar(CRON, { env: {} });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, [
    "Erro: DATABASE_URL não encontrada (nem no ambiente, nem em .env.local, nem em .env).",
  ]);
  assertEquals(r.clientes, []);
});

Deno.test("cron: sem o pacote pg — instrução de instalação e código 1, antes de qualquer conexão", async () => {
  const r = await rodar(CRON, { pgAusente: true });
  assertEquals(r.saida, 1);
  assertEquals(r.erros.length, 1);
  assertStringIncludes(r.erros[0], "Pacote 'pg' não encontrado");
  assertStringIncludes(r.erros[0], "npm i -D pg");
  assertEquals(r.clientes, []);
});

Deno.test("cron: DATABASE_URL — ambiente vence .env.local, que vence .env; aspas são tiradas", async () => {
  const doLocal = `${["postgresql", "//"].join(":")}local@local-teste.invalid/db`;
  const doEnv = `${["postgresql", "//"].join(":")}env@env-teste.invalid/db`;
  const arquivos = {
    ".env.local": `OUTRA=1\r\nDATABASE_URL="${doLocal}"\r\n`,
    ".env": `DATABASE_URL=${doEnv}\n`,
  };
  const resp = respostaCron([linhaJob(true)]);
  // 1) ambiente
  let r = await rodar(CRON, {
    env: { DATABASE_URL: URL_FALSA },
    arquivos,
    respostas: resp,
  });
  assertEquals(r.clientes[0].connectionString, URL_FALSA);
  assertEquals(r.leituras, []);
  // 2) .env.local (aspas tiradas)
  r = await rodar(CRON, { env: {}, arquivos, respostas: resp });
  assertEquals(r.clientes[0].connectionString, doLocal);
  // 3) só .env
  r = await rodar(CRON, {
    env: {},
    arquivos: { ".env": arquivos[".env"] },
    respostas: resp,
  });
  assertEquals(r.clientes[0].connectionString, doEnv);
  // 3b) variável de nome parecido não é a DATABASE_URL
  r = await rodar(CRON, {
    env: {},
    arquivos: { ".env": `OUTRA_DATABASE_URL=ruim\nDATABASE_URL=${doEnv}\n` },
    respostas: resp,
  });
  assertEquals(r.clientes[0].connectionString, doEnv);
  // 4) .env.local sem a linha cai para o .env
  r = await rodar(CRON, {
    env: {},
    arquivos: { ".env.local": "OUTRA=1\n", ".env": arquivos[".env"] },
    respostas: resp,
  });
  assertEquals(r.clientes[0].connectionString, doEnv);
});

// ===========================================================================
// db-snapshot-politicas.cjs
// ===========================================================================
const SNAP = "db-snapshot-politicas.cjs";
const raiz = path.resolve("/repo/scripts", "..");
const respostasSnap = (extra = {}) => [
  [
    /relrowsecurity/,
    extra.rls ?? [
      { tabela: "pedidos", rls_ligado: true, rls_forcado: false },
      { tabela: "perfis", rls_ligado: false, rls_forcado: true },
    ],
  ],
  [
    /FROM pg_policies/,
    extra.pol ?? [
      {
        schemaname: "public",
        tablename: "pedidos",
        policyname: "dono le",
        permissive: "PERMISSIVE",
        roles: ["authenticated", "service_role"],
        cmd: "SELECT",
        qual: "(user_id = auth.uid())",
        with_check: null,
      },
      {
        schemaname: "public",
        tablename: "perfis",
        policyname: "so admin",
        permissive: "RESTRICTIVE",
        roles: "{anon}",
        cmd: "ALL",
        qual: null,
        with_check: "(false)",
      },
      {
        schemaname: "public",
        tablename: "perfis",
        policyname: "x",
        permissive: "OUTRO",
        roles: "public",
        cmd: "INSERT",
        qual: "(true)",
        with_check: "(true)",
      },
    ],
  ],
  [
    /role_table_grants/,
    extra.grants ?? [
      { table_name: "pedidos", grantee: "anon", privs: "SELECT" },
      {
        table_name: "pedidos",
        grantee: "authenticated",
        privs: "INSERT,SELECT",
      },
    ],
  ],
  [
    /pg_get_function_identity_arguments/,
    extra.fn ?? [
      { proname: "fn_a", args: "uuid", security_definer: true },
      { proname: "fn_b", args: "", security_definer: false },
      { proname: "fn_c", args: "text, int", security_definer: true },
    ],
  ],
];

Deno.test("snapshot: grava UM arquivo com carimbo ordenável, na pasta backups, em utf8", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  assertEquals(r.saida, null);
  assertEquals(r.gravados.length, 1);
  assertEquals(
    r.gravados[0].caminho,
    path.join(raiz, "backups", "politicas-2026-08-05T23-41-02.sql"),
  );
  assertEquals(r.gravados[0].enc, "utf8");
  assertEquals(r.pastas, [[path.join(raiz, "backups"), { recursive: true }]]);
  assert(r.fim);
});

Deno.test("snapshot: o arquivo tem cabeçalho, RLS, policies como CREATE POLICY executável, grants e funções", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  const linhas = r.gravados[0].conteudo.split("\n");
  assertEquals(linhas.slice(0, 7), [
    "-- Snapshot de policies, grants e funcoes — gerado por",
    "-- scripts/db-snapshot-politicas.cjs (BANCO-040, #40).",
    `-- Lido de producao em ${AGORA}.`,
    "--",
    "-- ISTO NAO E UM BACKUP COMPLETO. Nao tem dados, indices, constraints,",
    "-- triggers nem sequences. Para isso: supabase db dump (exige Docker).",
    "",
  ]);
  const texto = r.gravados[0].conteudo;
  assertStringIncludes(
    texto,
    "-- ===== RLS por tabela =====\n-- pedidos: rls=true force=false\n-- perfis: rls=false force=true\n\n",
  );
  assertStringIncludes(texto, "-- ===== 3 policies =====\n");
  assertStringIncludes(
    texto,
    'CREATE POLICY "dono le" ON public.pedidos\n  AS PERMISSIVE\n  FOR SELECT\n  TO authenticated, service_role\n  USING ((user_id = auth.uid()));\n\n',
  );
  // sem USING quando qual é nulo; WITH CHECK quando existe; RESTRICTIVE
  assertStringIncludes(
    texto,
    'CREATE POLICY "so admin" ON public.perfis\n  AS RESTRICTIVE\n  FOR ALL\n  TO {anon}\n  WITH CHECK ((false));\n\n',
  );
  // qualquer coisa que não seja PERMISSIVE vira RESTRICTIVE; USING antes de WITH CHECK
  assertStringIncludes(
    texto,
    'CREATE POLICY "x" ON public.perfis\n  AS RESTRICTIVE\n  FOR INSERT\n  TO public\n  USING ((true))\n  WITH CHECK ((true));\n\n',
  );
  assertStringIncludes(
    texto,
    "-- ===== 2 linhas de grant =====\nGRANT SELECT ON public.pedidos TO anon;\nGRANT INSERT,SELECT ON public.pedidos TO authenticated;\n\n",
  );
  assertStringIncludes(
    texto,
    "-- ===== 3 funcoes, 2 com SECURITY DEFINER =====\n" +
      "-- [DEFINER] fn_a(uuid)\n--            fn_b()\n-- [DEFINER] fn_c(text, int)\n",
  );
  assert(
    texto.endsWith("fn_c(text, int)\n"),
    "termina com uma única quebra de linha",
  );
});

Deno.test("snapshot: o resumo no terminal conta cada seção e dá o caminho relativo", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  assertEquals(r.logs, [
    `Snapshot gravado em: ${path.join("backups", "politicas-2026-08-05T23-41-02.sql")}`,
    "  tabelas ......... 2",
    "  policies ........ 3",
    "  grants .......... 2",
    "  funcoes ......... 3 (2 SECURITY DEFINER)",
  ]);
});

Deno.test("snapshot: banco vazio ainda gera um arquivo válido, com contagens zero", async () => {
  const r = await rodar(SNAP, {
    respostas: respostasSnap({ rls: [], pol: [], grants: [], fn: [] }),
  });
  assertEquals(r.saida, null);
  const texto = r.gravados[0].conteudo;
  assertStringIncludes(texto, "-- ===== 0 policies =====");
  assertStringIncludes(texto, "-- ===== 0 linhas de grant =====");
  assertStringIncludes(
    texto,
    "-- ===== 0 funcoes, 0 com SECURITY DEFINER =====",
  );
  assertEquals(r.logs.at(-1), "  funcoes ......... 0 (0 SECURITY DEFINER)");
});

Deno.test("snapshot: só lê o catálogo — nenhuma consulta que escreva — e consulta public", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  assertEquals(r.consultas.length, 4);
  for (const c of r.consultas) {
    assert(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i.test(c.sql),
      c.sql,
    );
    assertStringIncludes(c.sql, "'public'");
  }
});

Deno.test("snapshot: cada consulta filtra o que diz (tabelas comuns, public) e ordena, para o diff ser estável", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  const por = (rx) => r.consultas.find((c) => rx.test(c.sql)).sql;
  const rls = por(/relrowsecurity/);
  assertStringIncludes(rls, "n.nspname = 'public'");
  assertStringIncludes(rls, "c.relkind = 'r'");
  assertStringIncludes(rls, "ORDER BY c.relname");
  const pol = por(/FROM pg_policies/);
  assertStringIncludes(pol, "schemaname = 'public'");
  assertStringIncludes(pol, "ORDER BY tablename, policyname");
  const grants = por(/role_table_grants/);
  assertStringIncludes(grants, "table_schema = 'public'");
  assertStringIncludes(grants, "ORDER BY table_name, grantee");
  assertStringIncludes(grants, "ORDER BY privilege_type");
  const fn = por(/pg_get_function_identity_arguments/);
  assertStringIncludes(fn, "n.nspname = 'public'");
  assertStringIncludes(fn, "ORDER BY p.proname");
});

Deno.test("snapshot: consulta que falha — nada é gravado, a conexão fecha e sai 1 com a mensagem", async () => {
  const resp = respostasSnap();
  resp[1][1] = new Error("sem permissao em pg_policies");
  const r = await rodar(SNAP, { respostas: resp });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, ["sem permissao em pg_policies"]);
  assertEquals(r.gravados, []);
  assertEquals(r.pastas, []);
});

Deno.test("snapshot: sem DATABASE_URL — sai 1 sem conectar e sem gravar", async () => {
  const r = await rodar(SNAP, { env: {} });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, ["DATABASE_URL não encontrada."]);
  assertEquals(r.clientes, []);
  assertEquals(r.gravados, []);
});

Deno.test("snapshot: conecta com ssl sem verificar o certificado (pooler do Supabase)", async () => {
  const r = await rodar(SNAP, { respostas: respostasSnap() });
  assertEquals(r.clientes[0], {
    connectionString: URL_FALSA,
    ssl: { rejectUnauthorized: false },
  });
});

// ===========================================================================
// db-reconcilia-ledger.cjs
// ===========================================================================
const LEDGER = "db-reconcilia-ledger.cjs";
const CORPO_B =
  'BEGIN\n  RETURN QUERY SELECT   "Valor" FROM public.tabela_b WHERE ativo AND dono = auth.uid();\nEND;';
const CORPO_B_VIVO =
  "begin return query select valor from public.tabela_b where ativo and dono = auth.uid(); end;";
const CORPO_F1 =
  "BEGIN RETURN (SELECT count(*) FROM public.tabela_f1 WHERE criada_em > now() - interval '1 day'); END;";
const CORPO_F2 =
  "BEGIN RETURN (SELECT count(*) FROM public.tabela_f2 WHERE criada_em > now() - interval '2 day'); END;";
const CORPO_D_ARQUIVO =
  "BEGIN RETURN (SELECT max(valor) FROM public.tabela_d WHERE ativo AND dono = auth.uid()); END;";
const CORPO_D_VIVO =
  "begin return (select min(valor) from public.tabela_d where ativo and dono = auth.uid()); end;";

const ARQ = {
  "20260101000000_a.sql": "select 1;",
  "20260102000000_b.sql": `create or replace function public.fb() returns int language plpgsql as $body$${CORPO_B}$body$;`,
  "20260103000000_c.sql":
    "CREATE OR REPLACE FUNCTION public.fc() RETURNS int AS $$ BEGIN RETURN 1234567890 + 1234567890 + 1234567890 + 1234567890 + 1234567890 + 1; END; $$;\ncreate policy a on t; CREATE POLICY b ON t;",
  "20260104000000_d.sql": `CREATE OR REPLACE FUNCTION public.fd() RETURNS int AS $$${CORPO_D_ARQUIVO}$$;`,
  "20260105000000_e.sql":
    "drop policy x on t; DROP POLICY y on t; create policy z on t; REVOKE all on t from anon; revoke all on t from public; -- irrevoked e revoked nao contam",
  "20260106000000_f.sql": `create or replace function public.ff1() returns int as $$${CORPO_F1}$$; create or replace function public.ff2() returns int as $$${CORPO_F2}$$;`,
  "20260106000000_f2.sql": "drop policy w on t; drop policy v on t;",
  "20260108000000_h.sql":
    "create or replace function public.fh() returns int as $$ select 1 $$;",
  "20260708150000_g.sql": "select 1;",
  "sem_versao.sql": "select 1;",
  "rascunho_v2.sql": "select 2;",
  "20260110000000_x.sql.bak": "select 3;",
  "LEIAME.md": "nao e migration",
};
const MIGRATIONS = Object.keys(ARQ);
const VIVAS = [
  {
    proname: "fb",
    def: `CREATE OR REPLACE FUNCTION public.fb() RETURNS int LANGUAGE plpgsql AS $function$ ${CORPO_B_VIVO} $function$`,
  },
  {
    proname: "fd",
    def: `CREATE OR REPLACE FUNCTION public.fd() RETURNS int LANGUAGE sql AS $$${CORPO_D_VIVO}$$`,
  },
  {
    proname: "ff1",
    def: `CREATE FUNCTION public.ff1() RETURNS int AS $$${CORPO_F1}$$`,
  },
  // corpo curto (<= 60 caracteres) não é comparável: tratado como inexistente
  {
    proname: "fh",
    def: "CREATE FUNCTION public.fh() RETURNS int AS $$ select 1 $$",
  },
];
const respostasLedger = (extra = {}) => [
  [
    /schema_migrations/,
    extra.ledger ?? [
      { version: "20260101000000" },
      { version: "20260100000000" },
    ],
  ],
  [/pg_get_functiondef/, extra.vivas ?? VIVAS],
  [/pg_policies/, extra.policies ?? [{ n: 7 }]],
  [/pg_get_function_result/, extra.otp ?? [{ retorno: "boolean" }]],
];
const rodarLedger = (argv = [], extra = {}) =>
  rodar(LEDGER, {
    argv,
    arquivos: ARQ,
    migrations: MIGRATIONS,
    respostas: respostasLedger(extra),
  });

Deno.test("ledger: seção 1 — casadas, só no disco, só no ledger e prefixo duplicado", async () => {
  const r = await rodarLedger();
  assertEquals(r.saida, null);
  assert(r.fim, "tem de fechar a conexão");
  assertEquals(r.clientes[0], {
    connectionString: URL_FALSA,
    ssl: { rejectUnauthorized: false },
  });
  const t = r.logs.join("\n");
  assertStringIncludes(t, "\n=== 1. Ledger x disco ===");
  assertStringIncludes(t, "  linhas no ledger .......... 2\n");
  assertStringIncludes(t, "  arquivos .sql no disco .... 11\n");
  assertStringIncludes(t, "  versoes distintas no disco  8\n");
  assertStringIncludes(t, "  CASADAS ................... 1\n");
  assertStringIncludes(t, "  so no DISCO (pendentes) ... 7\n");
  assertStringIncludes(t, "  so no LEDGER (sem arquivo)  1\n");
  assertStringIncludes(
    t,
    "  PREFIXO DUPLICADO ......... 1\n    20260106000000: 20260106000000_f.sql | 20260106000000_f2.sql",
  );
});

Deno.test("ledger: sem prefixo duplicado a linha de duplicados nem aparece", async () => {
  const { "20260106000000_f2.sql": _removido, ...sem } = ARQ;
  const r = await rodar(LEDGER, {
    arquivos: sem,
    migrations: Object.keys(sem),
    respostas: respostasLedger(),
  });
  assert(!r.logs.join("\n").includes("PREFIXO DUPLICADO"));
});

Deno.test("ledger: seção 2 — corpo idêntico (após normalizar), ausente, divergente, sem função e pares", async () => {
  const t = (await rodarLedger()).logs.join("\n");
  assertStringIncludes(t, "=== 2. Das 7 pendentes, o que ja esta vivo ===");
  // b idêntica (aspas, caixa, espaço normalizados); c e h ausentes (h tem corpo curto); d e f divergentes; e e g sem função
  assertStringIncludes(t, "  sem CREATE OR REPLACE FUNCTION ........ 2\n");
  assertStringIncludes(t, "  corpo IDENTICO ao vivo (ja rodou) ..... 1\n");
  assertStringIncludes(t, "  a funcao NEM EXISTE no banco .......... 2\n");
  assertStringIncludes(t, "  existe mas o corpo DIVERGE ............ 2\n");
  assertStringIncludes(t, "  Em PARES funcao/arquivo: 2 identicos de 6.");
});

Deno.test("ledger: seção 3 — policies e revokes só do PRIMEIRO arquivo de cada versão, revoke por palavra inteira", async () => {
  const t = (await rodarLedger()).logs.join("\n");
  assertStringIncludes(t, "  DROP POLICY nos pendentes ... 2\n");
  assertStringIncludes(t, "  CREATE POLICY nos pendentes . 3\n");
  assertStringIncludes(t, "  REVOKE nos pendentes ........ 2\n");
  assertStringIncludes(t, "  policies VIVAS hoje ......... 7\n");
  assertStringIncludes(t, "  saldo ....................... 1");
});

Deno.test("ledger: seção 4 — o bloqueador conhecido: existe no disco, está na fila e o tipo vivo", async () => {
  let t = (await rodarLedger()).logs.join("\n");
  assertStringIncludes(t, "=== 4. O bloqueador 20260708150000 ===");
  assertStringIncludes(t, "  arquivo existe no disco ..... true\n");
  assertStringIncludes(t, "  esta na fila de pendentes ... true\n");
  assertStringIncludes(t, "  generate_order_otp_v1 VIVA retorna: boolean\n");
  t = (await rodarLedger([], { otp: [] })).logs.join("\n");
  assertStringIncludes(t, "VIVA retorna: (nao existe)\n");
  t = (
    await rodarLedger([], {
      otp: [{ retorno: "boolean" }, { retorno: "text" }],
    })
  ).logs.join("\n");
  assertStringIncludes(t, "VIVA retorna: boolean | text\n");
});

Deno.test("ledger: seção 4 — bloqueador já no ledger não está na fila", async () => {
  const t = (
    await rodarLedger([], {
      ledger: [{ version: "20260101000000" }, { version: "20260708150000" }],
    })
  ).logs.join("\n");
  assertStringIncludes(t, "  arquivo existe no disco ..... true\n");
  assertStringIncludes(t, "  esta na fila de pendentes ... false\n");
});

Deno.test("ledger: seção 5 — versões do ledger sem arquivo, ou '(nenhuma)'", async () => {
  let t = (await rodarLedger()).logs.join("\n");
  assertStringIncludes(
    t,
    "=== 5. Versoes no ledger sem arquivo no disco ===\n  total: 1\n  20260100000000\n",
  );
  t = (
    await rodarLedger([], { ledger: [{ version: "20260101000000" }] })
  ).logs.join("\n");
  assertStringIncludes(t, "  total: 0\n  (nenhuma)\n");
});

Deno.test("ledger: --listar-pendentes imprime só os nomes, ordenados por versão e por nome, sem consultar funções", async () => {
  const r = await rodarLedger(["--listar-pendentes"]);
  assertEquals(r.logs, [
    "20260102000000_b.sql",
    "20260103000000_c.sql",
    "20260104000000_d.sql",
    "20260105000000_e.sql",
    "20260106000000_f.sql",
    "20260106000000_f2.sql",
    "20260108000000_h.sql",
    "20260708150000_g.sql",
  ]);
  assertEquals(r.consultas.length, 1);
  assertStringIncludes(r.consultas[0].sql, "schema_migrations");
  assert(r.fim);
  assertEquals(r.leituras, [], "no modo lista nenhum arquivo .sql é lido");
});

Deno.test("ledger: versão do ledger que chega como número é comparada como texto", async () => {
  const r = await rodarLedger(["--listar-pendentes"], {
    ledger: [{ version: 20260102000000 }, { version: "20260103000000" }],
  });
  assert(!r.logs.includes("20260102000000_b.sql"));
  assert(!r.logs.includes("20260103000000_c.sql"));
  assert(r.logs.includes("20260104000000_d.sql"));
});

Deno.test("ledger: a ordem dos pendentes não depende da ordem em que o disco lista", async () => {
  const desordem = [
    "20260708150000_g.sql",
    "20260108000000_h.sql",
    "20260106000000_f2.sql",
    "20260106000000_f.sql",
    "20260105000000_e.sql",
    "20260104000000_d.sql",
    "20260103000000_c.sql",
    "20260102000000_b.sql",
    "20260101000000_a.sql",
  ];
  const r = await rodar(LEDGER, {
    argv: ["--listar-pendentes"],
    arquivos: ARQ,
    migrations: desordem,
    respostas: respostasLedger(),
  });
  assertEquals(r.logs, [
    "20260102000000_b.sql",
    "20260103000000_c.sql",
    "20260104000000_d.sql",
    "20260105000000_e.sql",
    "20260106000000_f.sql",
    "20260106000000_f2.sql",
    "20260108000000_h.sql",
    "20260708150000_g.sql",
  ]);
});

Deno.test("ledger: versões só no ledger saem em ordem crescente, separadas por vírgula", async () => {
  const t = (
    await rodarLedger([], {
      ledger: [
        { version: "20260101000000" },
        { version: "20260109000000" },
        { version: "20260100000000" },
      ],
    })
  ).logs.join("\n");
  assertStringIncludes(t, "  so no LEDGER (sem arquivo)  2\n");
  assertStringIncludes(t, "  total: 2\n  20260100000000, 20260109000000\n");
});

Deno.test("ledger: rascunho sem prefixo numérico e .sql.bak ficam de fora das versões", async () => {
  const t = (await rodarLedger(["--listar-pendentes"])).logs.join("\n");
  assert(!t.includes("rascunho"));
  assert(!t.includes(".bak"));
});

Deno.test("ledger: só lê — consultas de catálogo, nada que escreva", async () => {
  const r = await rodarLedger();
  assertEquals(r.consultas.length, 4);
  for (const c of r.consultas) {
    assert(
      !/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate)\b/i.test(
        c.sql,
      ),
      c.sql,
    );
  }
});

Deno.test("ledger: ledger que não responde — sai 1 com a mensagem e a conexão é fechada", async () => {
  const r = await rodar(LEDGER, {
    arquivos: ARQ,
    migrations: MIGRATIONS,
    respostas: [[/schema_migrations/, new Error("permissao negada no ledger")]],
  });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, ["permissao negada no ledger"]);
  assertEquals(r.logs, []);
});

Deno.test("ledger: sem DATABASE_URL — sai 1 sem conectar", async () => {
  const r = await rodar(LEDGER, {
    env: {},
    arquivos: ARQ,
    migrations: MIGRATIONS,
  });
  assertEquals(r.saida, 1);
  assertEquals(r.erros, ["DATABASE_URL não encontrada."]);
  assertEquals(r.clientes, []);
});

Deno.test("ledger: DATABASE_URL do .env.local (com aspas) quando o ambiente não tem", async () => {
  const dele = `${["postgresql", "//"].join(":")}local@local-teste.invalid/db`;
  const r = await rodar(LEDGER, {
    env: {},
    argv: ["--listar-pendentes"],
    arquivos: { ...ARQ, ".env.local": `X=1\nDATABASE_URL="${dele}"\n` },
    migrations: MIGRATIONS,
    respostas: respostasLedger(),
  });
  assertEquals(r.clientes[0], {
    connectionString: dele,
    ssl: { rejectUnauthorized: false },
  });
});

const CORPO_A =
  "BEGIN RETURN (SELECT count(*) FROM public.tabela_a WHERE ativo AND dono = auth.uid()); END;";
const CORPO_OUTRO =
  "BEGIN RETURN (SELECT count(*) FROM public.tabela_z WHERE ativo AND dono = auth.uid()); END;";

Deno.test("ledger: função SOBRECARREGADA — o arquivo casa com qualquer uma das definições vivas", async () => {
  const nome = "20260301000000_o.sql";
  const r = await rodar(LEDGER, {
    arquivos: {
      [nome]: `create or replace function public.fo(a int) returns int as $$${CORPO_A}$$;`,
    },
    migrations: [nome],
    respostas: respostasLedger({
      ledger: [],
      vivas: [
        {
          proname: "fo",
          def: `CREATE FUNCTION public.fo(a int) RETURNS int AS $$${CORPO_A}$$`,
        },
        {
          proname: "fo",
          def: `CREATE FUNCTION public.fo(a text) RETURNS int AS $$${CORPO_OUTRO}$$`,
        },
      ],
    }),
  });
  const t = r.logs.join("\n");
  assertStringIncludes(t, "  corpo IDENTICO ao vivo (ja rodou) ..... 1\n");
  assertStringIncludes(t, "  existe mas o corpo DIVERGE ............ 0\n");
});

Deno.test("ledger: delimitador com nome ($fn$) contendo $$ por dentro é lido INTEIRO, não cortado no primeiro $$", async () => {
  const nome = "20260302000000_n.sql";
  const prefixo =
    "BEGIN PERFORM public.funcao_com_nome_bem_comprido_para_passar_dos_sessenta_caracteres(); EXECUTE $$ select 1 $$; ";
  const r = await rodar(LEDGER, {
    arquivos: {
      [nome]: `create or replace function public.fn() returns int as $fn$${prefixo}RETURN 111; END; $fn$;`,
    },
    migrations: [nome],
    respostas: respostasLedger({
      ledger: [],
      vivas: [
        {
          proname: "fn",
          def: `CREATE FUNCTION public.fn() RETURNS int AS $fn$${prefixo}RETURN 222; END; $fn$`,
        },
      ],
    }),
  });
  const t = r.logs.join("\n");
  // só o trecho DEPOIS do $$ interno difere: lido inteiro, o corpo DIVERGE.
  assertStringIncludes(t, "  corpo IDENTICO ao vivo (ja rodou) ..... 0\n");
  assertStringIncludes(t, "  existe mas o corpo DIVERGE ............ 1\n");
});

/*
 * Mutantes equivalentes anotados (não há teste que os derrube, e não precisa):
 *  - db-reconcilia-ledger: `if (corpo.length > 60)` -> `>= 60`/`> 59`: nenhum
 *    corpo deste teste tem exatamente 60 caracteres normalizados, e a fronteira
 *    não muda nenhum resultado real além dessa.
 *  - `ledger.rowCount` x `versoesLedger.size`: iguais enquanto o ledger não
 *    tiver versão repetida (chave primária).
 *  - `readFileSync(..., "utf8")` -> `"latin1"` em db-reconcilia-ledger: o
 *    dublê de fs devolve texto pronto e ignora a codificação; só um disco
 *    de verdade a revelaria.
 */
