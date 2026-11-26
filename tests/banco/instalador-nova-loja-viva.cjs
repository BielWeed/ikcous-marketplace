"use strict";

/**
 * PROVA VIVA do instalador do banco da loja nova (L4b, T9;
 * scripts/frota/instalador-banco.mjs) contra o Postgres EFÊMERO do db-ci.yml.
 * Nunca banco de loja: a URL passa pela trava de efemero.cjs (CI_BANCO_EFEMERO=1
 * + localhost) e os bancos desta prova são criados AQUI, do template0, e
 * apagados no fim.
 *
 * Os bancos (nomes com o prefixo inst_nova_loja_):
 *   molde  template0 + provisionar-efemero.cjs (o que o Supabase dá de fábrica:
 *          papéis, extensions, auth, storage, cron stub, supabase_realtime) e
 *          NENHUMA migration — o "projeto Supabase novo" da bancada;
 *   a      cópia do molde: instalação do zero, sem interrupção (a referência);
 *   b      cópia do molde: interrompida, falhada e retomada até o fim;
 *   c      cópia do molde com UMA tabela em public: tem de ser recusado;
 *   d      cópia do molde SEM os privilégios padrão de public (o projeto
 *          Supabase novo desde 30/05/2026: revogados aqui, comando a comando).
 *
 * O cliente desta prova imita a Management API: UMA conexão nova por
 * requisição (nada de estado de sessão entre arquivos), o texto inteiro numa
 * consulta simples, as linhas do ÚLTIMO comando de volta, e o erro do banco
 * como { tipo: "sql", codigo: SQLSTATE }.
 *
 *  ZERO        a: a fila INTEIRA vai pelo mesmo envelope (um envio por arquivo,
 *              na ordem do plano, os dois de 13 dígitos nas posições 83/84);
 *              o ledger termina com todas as versões e nomes (statements
 *              NULL) e a marca de instalação CONCLUÍDA.
 *  RETOMADA    b: o 74º comita e a resposta se perde → ESTADO DESCONHECIDO e o
 *              ledger diz 74; o 75º falha DEPOIS do corpo (SQL sabotado antes
 *              do registro) → FALHOU com arquivo e código, e o banco fica
 *              byte a byte como estava; timeout ANTES de enviar → nada muda;
 *              a retomada vai até o fim e o banco fica IGUAL ao a (impressão
 *              digital de funções, colunas, políticas, gatilhos, índices,
 *              restrições, permissões, buckets, cron e contagem de linhas),
 *              mas a resposta da MARCA se perde (fica em curso); a rodada
 *              seguinte dá "nada" e marca concluída.
 *  REENVIO     b (revisão Opus, bloqueante 1): reenviar uma versão já
 *              registrada com corpo que mexe numa função dá 23505 e a função
 *              fica como estava; o CONTROLE com ON CONFLICT DO NOTHING mostra a
 *              regressão (a taxa volta a 0,10).
 *  DE NOVO     a: a segunda rodada é JA_INSTALADA (sucesso, só leituras, nada
 *              gravado) e o DDL do ledger rodado de novo não muda nada.
 *  SEM A REGRA d: a consulta 185 mede tabelas/sequências SEM acesso; o DDL
 *              sabotado (sem os privilégios) é pego pela conferência ANTES da
 *              1ª migration (FALHOU, ledger vazio); a rodada seguinte aplica
 *              os privilégios e a fila inteira, e o d fica com a MESMA
 *              impressão digital do a e a 185 toda ok.
 *  SEM MARCA   a (bloqueante 2): ledger cheio SEM a marca (como as lojas de
 *              hoje) e ledger prefixo sem marca (loja atrasada) → recusados.
 *  RECUSA      c: banco com tabela e sem ledger → recusado sem NENHUMA chamada;
 *              nada criado (nem o esquema do ledger).
 *
 * Adaptação de bancada (a mesma do db-ci, util.cjs): nos arquivos de
 * EXCECOES_DE_PROVISIONAMENTO a linha `CREATE EXTENSION IF NOT EXISTS
 * pg_cron|pg_net;` vira comentário ANTES do plano (o postgres:17 não tem as
 * extensões; o schema cron é o stub do provisionador). O resto do corpo roda
 * de verdade, pelo envelope.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/instalador-nova-loja-viva.cjs
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  EXCECOES_DE_PROVISIONAMENTO,
  neutralizarProvisionamento,
} = require("../../scripts/ci/banco/util.cjs");

const RAIZ = path.resolve(__dirname, "..", "..");
const {
  comandosDosPrivilegiosPadrao,
} = require("../../scripts/ci/banco/privilegios-padrao.cjs");
const CONSULTA_185 = path.join(
  RAIZ,
  "scripts",
  "publicacao",
  "consultas",
  "185-privilegios-padrao-em-public.sql",
);
const PREFIXO = "inst_nova_loja_";
const MOLDE = `${PREFIXO}molde`;
const A = `${PREFIXO}a`;
const B = `${PREFIXO}b`;
const C = `${PREFIXO}c`;
const D = `${PREFIXO}d`;
const TODOS = [A, B, C, D, MOLDE];
const MARCA_DO_LEDGER =
  "\nINSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (";

let URL_BASE;
let inst;
let repo;

const urlDo = (banco) => {
  const u = new URL(URL_BASE);
  u.pathname = `/${banco}`;
  return u.toString();
};

async function comBanco(banco, fn) {
  const c = new Client({ connectionString: urlDo(banco) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

const ehEnvelope = (sql) => sql.includes(MARCA_DO_LEDGER);
const timeout = () =>
  Object.assign(new Error("tempo esgotado (simulado)"), { tipo: "timeout" });

/** Imita a Management API: uma conexão por requisição, consulta simples, as
 * linhas do último comando. `sabotar(n, sql)` (n = ordem do envelope nesta
 * rodada) devolve { antes } (falha sem enviar), { depois } (envia, comita e
 * perde a resposta) ou { trocar } (envia outro texto); `sabotarMarca()` faz o
 * mesmo com a requisição que marca a instalação concluída. */
function clienteDaApi(
  banco,
  { registro = [], sabotar, sabotarMarca, sabotarDdl } = {},
) {
  let envelopes = 0;
  return {
    registro,
    async consultar(sql) {
      registro.push(sql);
      let s;
      if (ehEnvelope(sql)) {
        envelopes += 1;
        s = sabotar?.(envelopes, sql);
      } else if (sql === inst.SQL_CONCLUIR) {
        s = sabotarMarca?.();
      } else if (sql === inst.ddlDoLedger()) {
        s = sabotarDdl?.(sql);
      }
      if (s?.antes) throw s.antes;
      const pg = new Client({ connectionString: urlDo(banco) });
      await pg.connect();
      let r;
      try {
        r = await pg.query(s?.trocar ?? sql);
      } catch (e) {
        const sqlstate =
          typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code);
        throw Object.assign(new Error(e.message), {
          tipo: sqlstate && !e.code.startsWith("08") ? "sql" : "rede",
          codigo: e.code,
        });
      } finally {
        await pg.end().catch(() => {});
      }
      if (s?.depois) throw s.depois;
      const ultimo = Array.isArray(r) ? r[r.length - 1] : r;
      return ultimo.rows;
    },
  };
}

async function planejarEm(banco) {
  const estado = await inst.lerEstado(clienteDaApi(banco));
  return inst.planejarInstalacao(estado, repo);
}

async function ledger(banco) {
  return comBanco(
    banco,
    async (c) =>
      (
        await c.query(
          "SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version",
        )
      ).rows,
  );
}

/** A marca de instalação como o instalador a lê (ausente/em_curso/concluida). */
async function marca(banco) {
  return (await inst.lerEstado(clienteDaApi(banco))).marca;
}

const IMPRESSAO_DIGITAL = `
DO $contagem$
DECLARE r record; n bigint;
BEGIN
  CREATE TEMP TABLE _linhas(x text);
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.schemaname, r.tablename) INTO n;
    INSERT INTO _linhas VALUES ('linhas:' || r.tablename || '=' || n);
  END LOOP;
END $contagem$;
WITH itens(x) AS (
  SELECT 'fn:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') || ':' || p.prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'storage', 'auth', 'cron') AND p.prokind IN ('f', 'p')
  UNION ALL SELECT 'col:' || table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '') || ':' || is_nullable
    FROM information_schema.columns WHERE table_schema IN ('public', 'storage', 'auth')
  UNION ALL SELECT 'pol:' || schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    FROM pg_policies
  UNION ALL SELECT 'trg:' || n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid))
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
  UNION ALL SELECT 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity || ':' || coalesce(array_to_string(c.relacl, ','), '')
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'storage')
  UNION ALL SELECT 'view:' || schemaname || '.' || viewname || '=' || md5(definition) FROM pg_views WHERE schemaname = 'public'
  UNION ALL SELECT 'idx:' || schemaname || '.' || indexname || '=' || md5(indexdef) FROM pg_indexes WHERE schemaname IN ('public', 'storage')
  UNION ALL SELECT 'con:' || n.nspname || '.' || cl.relname || '.' || co.conname || '=' || md5(pg_get_constraintdef(co.oid))
    FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid JOIN pg_namespace n ON n.oid = co.connamespace
   WHERE n.nspname IN ('public', 'storage')
  UNION ALL SELECT 'bucket:' || id FROM storage.buckets
  UNION ALL SELECT 'cron:' || jobname || ':' || schedule || '=' || md5(command) FROM cron.job
  UNION ALL SELECT 'pub:' || pubname || ':' || schemaname || '.' || tablename FROM pg_publication_tables
  UNION ALL SELECT 'ext:' || e.extname || ':' || n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  UNION ALL SELECT 'nsp:' || nspname || ':' || coalesce(array_to_string(nspacl, ','), '') FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%'
  UNION ALL SELECT x FROM _linhas
)
SELECT count(*)::int AS itens, md5(string_agg(x, E'\\n' ORDER BY x)) AS digital FROM itens;`;

/** A consulta 185 (só leitura, rol fechado) como o workflow a roda. */
async function consulta185(banco) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CONSULTA_185 é um caminho fixo deste repositório.
  const sql = require("node:fs").readFileSync(CONSULTA_185, "utf8");
  return comBanco(banco, async (c) => (await c.query(sql)).rows);
}

async function impressao(banco) {
  return comBanco(banco, async (c) => {
    const r = await c.query(IMPRESSAO_DIGITAL);
    const { itens, digital } = r[r.length - 1].rows[0];
    return { itens, digital };
  });
}

async function comAdmin(fn) {
  const c = new Client({ connectionString: urlDo("template1") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => {});
  }
}

async function apagarBancos() {
  await comAdmin(async (adm) => {
    for (const b of TODOS)
      await adm.query(`DROP DATABASE IF EXISTS "${b}" WITH (FORCE)`);
  });
}

async function montarBancos() {
  await apagarBancos();
  await comAdmin((adm) =>
    adm.query(`CREATE DATABASE "${MOLDE}" TEMPLATE template0`),
  );
  const prov = spawnSync(
    process.execPath,
    [path.join(RAIZ, "scripts", "ci", "banco", "provisionar-efemero.cjs")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: urlDo(MOLDE),
        CI_BANCO_EFEMERO: "1",
      },
    },
  );
  if (prov.status !== 0)
    falhar("FALHOU", "provisionar-efemero.cjs no molde saiu != 0");
  await comAdmin(async (adm) => {
    for (const b of [A, B, C, D]) {
      await adm.query(`CREATE DATABASE "${b}" TEMPLATE "${MOLDE}"`);
      // O search_path de fábrica do papel postgres no Supabase (o db-ci o
      // aplica antes de cada arquivo; aqui vale para toda conexão nova).
      await adm.query(
        `ALTER DATABASE "${b}" SET search_path = "$user", public, extensions`,
      );
    }
  });
  // d = o projeto Supabase novo: os MESMOS 9 comandos, ao contrário.
  await comBanco(D, async (c) => {
    for (const cmd of comandosDosPrivilegiosPadrao()) {
      await c.query(
        cmd
          .replace(" GRANT ", " REVOKE ")
          .replace(/ TO (\"[a-z_]+\")$/, " FROM $1"),
      );
    }
  });
}

/** A fila do repositório, com a única adaptação de bancada (pg_cron/pg_net). */
function filaDaBancada() {
  return inst
    .arquivosDoRepo(path.join(RAIZ, "supabase", "migrations"))
    .map((a) => {
      if (!(a.arquivo in EXCECOES_DE_PROVISIONAMENTO)) return a;
      const { texto, avisos } = neutralizarProvisionamento(a.corpo);
      if (avisos.length > 0)
        console.log(`  (bancada) ${a.arquivo}: ${avisos.join("; ")}`);
      return { arquivo: a.arquivo, corpo: texto };
    });
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });
const estado = {};

prova(
  "ZERO: banco vazio recebe a fila INTEIRA pelo envelope, na ordem do plano, e o ledger fica completo",
  async () => {
    const plano = await planejarEm(A);
    assert.equal(plano.acao, "instalar", plano.motivo);
    assert.equal(plano.fila.length, repo.length);
    assert.ok(repo.length >= 276, `fila com ${repo.length}`);
    const cli = clienteDaApi(A);
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "OK", r.mensagem);
    const enviados = cli.registro.filter(ehEnvelope);
    assert.deepEqual(
      enviados,
      plano.fila.map((i) => i.envelope),
      "um envelope por arquivo, na ordem do plano",
    );
    assert.ok(
      enviados[83].includes("VALUES ('2026110000000',"),
      "posição 83 = 2026110000000",
    );
    assert.ok(
      enviados[84].includes("VALUES ('2026110000100',"),
      "posição 84 = 2026110000100",
    );
    const l = await ledger(A);
    assert.deepEqual(
      l.map((x) => x.version).sort(),
      plano.fila.map((i) => i.versao).sort(),
    );
    const base = l.find((x) => x.version === "20260806000000");
    assert.equal(base.name, "baseline_do_schema_vivo");
    assert.ok(
      l.every((x) => x.statements === null),
      "statements = NULL, como aplicar-migrations.yml",
    );
    assert.equal(cli.registro.at(-1), inst.SQL_CONCLUIR, "marca por último");
    assert.equal(await marca(A), "concluida");
    const priv = await inst.lerPrivilegiosPadrao(clienteDaApi(A));
    assert.equal(priv.faltando, "", "privilégios padrão conferidos no a");
    const r185 = await consulta185(A);
    assert.equal(r185.length, 8, "rol de 8 linhas");
    assert.deepEqual(
      r185.filter((l) => l.ok !== true),
      [],
      "a 185 toda ok numa loja com a regra antiga",
    );
    estado.digitalA = await impressao(A);
    console.log(
      `    ${l.length} versões no ledger; impressão digital: ${estado.digitalA.itens} itens, ${estado.digitalA.digital}`,
    );
  },
);

prova(
  "RETOMADA 1: o 74º comita e a resposta se perde → ESTADO DESCONHECIDO, e o ledger diz que comitou (74)",
  async () => {
    const plano = await planejarEm(B);
    const cli = clienteDaApi(B, {
      sabotar: (n) => (n === 74 ? { depois: timeout() } : null),
    });
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "ESTADO_DESCONHECIDO", r.mensagem);
    assert.equal(r.arquivo, repo[73].arquivo);
    assert.match(r.mensagem, /ESTADO DESCONHECIDO: confira o ledger/);
    assert.equal(
      cli.registro.filter(ehEnvelope).length,
      74,
      "nenhum envio depois do timeout",
    );
    assert.equal((await ledger(B)).length, 74);
    assert.equal(await marca(B), "em_curso");
    estado.digital74 = await impressao(B);
  },
);

prova(
  "RETOMADA 2: o 75º falha DEPOIS do corpo (antes do registro) → FALHOU com arquivo e código; o banco não muda",
  async () => {
    const plano = await planejarEm(B);
    assert.equal(plano.acao, "instalar", plano.motivo);
    assert.equal(plano.jaNoLedger, 74);
    assert.equal(plano.fila[0].arquivo, repo[74].arquivo, "retoma no 75º");
    const cli = clienteDaApi(B, {
      sabotar: (n, sql) => {
        if (n !== 1) return null;
        const i = sql.lastIndexOf(MARCA_DO_LEDGER);
        return { trocar: `${sql.slice(0, i)}\nSELECT 1/0;${sql.slice(i)}` };
      },
    });
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "FALHOU", r.mensagem);
    assert.equal(r.arquivo, repo[74].arquivo);
    assert.equal(r.codigo, "22012");
    assert.ok(r.mensagem.includes(repo[74].arquivo), r.mensagem);
    assert.equal(
      cli.registro.filter(ehEnvelope).length,
      1,
      "parou no primeiro",
    );
    assert.equal((await ledger(B)).length, 74);
    assert.deepEqual(
      await impressao(B),
      estado.digital74,
      "o corpo inteiro do 75º voltou junto",
    );
  },
);

prova(
  "RETOMADA 3: timeout ANTES de enviar → ESTADO DESCONHECIDO, nada muda, nada enviado depois",
  async () => {
    const plano = await planejarEm(B);
    const cli = clienteDaApi(B, {
      sabotar: (n) => (n === 1 ? { antes: timeout() } : null),
    });
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "ESTADO_DESCONHECIDO", r.mensagem);
    assert.ok(
      ehEnvelope(cli.registro.at(-1)),
      "o último registro é o envelope que não foi",
    );
    assert.equal((await ledger(B)).length, 74);
    assert.deepEqual(await impressao(B), estado.digital74);
  },
);

prova(
  "RETOMADA 4: vai do 75º até o fim, banco IGUAL ao a; a resposta da MARCA se perde → ESTADO DESCONHECIDO, marca em curso",
  async () => {
    const plano = await planejarEm(B);
    assert.equal(plano.jaNoLedger, 74);
    const cli = clienteDaApi(B, {
      sabotarMarca: () => ({ antes: timeout() }),
    });
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "ESTADO_DESCONHECIDO", r.mensagem);
    assert.equal(r.arquivo, "(marca de conclusão)");
    assert.equal(r.aplicados.length, repo.length - 74);
    assert.equal((await ledger(B)).length, repo.length);
    assert.equal(await marca(B), "em_curso");
    assert.deepEqual(
      await impressao(B),
      estado.digitalA,
      "impressão digital do b = do a",
    );
  },
);

prova(
  "RETOMADA 5: a rodada seguinte dá 'nada' (ensaio só lê) e, com aplicar, marca concluída",
  async () => {
    const plano = await planejarEm(B);
    assert.equal(plano.acao, "nada", plano.motivo);
    const ensaio = clienteDaApi(B);
    const e = await inst.instalar(ensaio, plano);
    assert.equal(e.estado, "ENSAIO", e.mensagem);
    assert.ok(!ensaio.registro.includes(inst.SQL_CONCLUIR));
    assert.equal(await marca(B), "em_curso");
    const cli = clienteDaApi(B);
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "NADA_A_FAZER", r.mensagem);
    assert.equal(r.aviso, undefined, "os privilégios estavam no lugar");
    assert.deepEqual(
      cli.registro.filter(
        (s) =>
          s !== inst.SQL_ESTADO &&
          s !== inst.SQL_LEDGER &&
          s !== inst.SQL_MARCA &&
          s !== inst.SQL_PRIVILEGIOS,
      ),
      [inst.ddlDoLedger(), inst.SQL_CONCLUIR],
      "as escritas são o DDL idempotente e a marca",
    );
    assert.equal(await marca(B), "concluida");
    assert.deepEqual(await impressao(B), estado.digitalA);
    assert.equal(
      (await planejarEm(B)).acao,
      "ja_instalada",
      "agora está instalada e completa",
    );
  },
);

prova(
  "REENVIO (bloqueante 1): versão já registrada com corpo que mexe numa função → 23505 e a função não muda; CONTROLE com ON CONFLICT regride",
  async () => {
    const taxa = (v) =>
      `CREATE OR REPLACE FUNCTION public.prova_reenvio_taxa() RETURNS numeric LANGUAGE sql AS 'SELECT ${v}::numeric';`;
    const lerTaxa = () =>
      comBanco(
        B,
        async (c) =>
          (await c.query("SELECT public.prova_reenvio_taxa()::text AS t"))
            .rows[0].t,
      );
    // "v2" já no ar: a taxa nova é 0.05
    await comBanco(B, (c) => c.query(taxa("0.05")));
    // "v1" reenviada: versão que JÁ está no ledger, corpo da taxa antiga
    const envelope = inst.envelopeDoArquivo({
      arquivo: repo[0].arquivo,
      corpo: taxa("0.10"),
    });
    await assert.rejects(clienteDaApi(B).consultar(envelope), (e) => {
      assert.equal(e.tipo, "sql");
      assert.equal(e.codigo, "23505");
      return true;
    });
    assert.equal(await lerTaxa(), "0.05", "a transação inteira voltou");
    // CONTROLE: o mesmo reenvio com ON CONFLICT DO NOTHING passa sem erro e
    // regride a função (o defeito que o bloqueante 1 tirou).
    const comOnConflict = envelope.replace(
      "');\nCOMMIT;",
      "') ON CONFLICT DO NOTHING;\nCOMMIT;",
    );
    assert.notEqual(comOnConflict, envelope, "o controle tem de mudar o texto");
    await clienteDaApi(B).consultar(comOnConflict);
    assert.equal(await lerTaxa(), "0.10", "controle: com ON CONFLICT regride");
    await comBanco(B, (c) =>
      c.query("DROP FUNCTION public.prova_reenvio_taxa()"),
    );
    assert.equal((await ledger(B)).length, repo.length);
  },
);

prova(
  "DE NOVO: a segunda rodada é JA_INSTALADA (sucesso, só leituras) e o DDL do ledger é idempotente",
  async () => {
    const plano = await planejarEm(A);
    assert.equal(plano.acao, "ja_instalada", plano.motivo);
    const cli = clienteDaApi(A);
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "JA_INSTALADA", r.mensagem);
    const leituras = new Set([
      inst.SQL_ESTADO,
      inst.SQL_LEDGER,
      inst.SQL_MARCA,
      inst.SQL_PRIVILEGIOS,
    ]);
    assert.ok(cli.registro.length > 0);
    assert.deepEqual(
      cli.registro.filter((s) => !leituras.has(s)),
      [],
      "nenhuma escrita",
    );
    await clienteDaApi(A).consultar(inst.ddlDoLedger());
    await clienteDaApi(A).consultar(inst.ddlDoLedger());
    assert.equal((await ledger(A)).length, repo.length);
    assert.equal(await marca(A), "concluida", "o DDL não reabre a marca");
    assert.deepEqual(await impressao(A), estado.digitalA);
  },
);

prova(
  "SEM MARCA (bloqueante 2): ledger cheio sem marca (as lojas de hoje) e ledger prefixo sem marca (loja atrasada) → recusados sem chamada",
  async () => {
    await comBanco(A, (c) =>
      c.query("DROP TABLE supabase_migrations.ikcous_instalacao"),
    );
    assert.equal(await marca(A), "ausente");
    const cheio = await planejarEm(A);
    assert.equal(cheio.acao, "recusar", cheio.motivo);
    assert.match(cheio.motivo, /loja já instalada/);
    assert.match(cheio.motivo, /aplicar-migrations\.yml/);
    const ultimas = repo.slice(-3).map((a) => a.arquivo.split("_")[0]);
    await comBanco(A, (c) =>
      c.query(
        "DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY($1)",
        [ultimas],
      ),
    );
    const atrasada = await planejarEm(A);
    assert.equal(atrasada.acao, "recusar", atrasada.motivo);
    assert.match(atrasada.motivo, /loja já instalada/);
    const cli = clienteDaApi(A);
    const r = await inst.instalar(cli, atrasada, { aplicar: true });
    assert.equal(r.estado, "RECUSADO");
    assert.deepEqual(cli.registro, []);
    assert.equal((await ledger(A)).length, repo.length - 3);
  },
);

prova(
  "SEM A REGRA: projeto novo sem os privilégios padrão — a 185 mede, o DDL sabotado é pego antes da 1ª migration, e a rodada certa deixa o d IGUAL ao a",
  async () => {
    const antes = await consulta185(D);
    assert.equal(antes.length, 8, "rol de 8 linhas");
    // (o controle diz "nao" aqui só porque o public do d ainda está vazio)
    const nao = antes
      .filter((l) => l.ok === false && !l.item.startsWith("controle:"))
      .map((l) => l.item)
      .sort();
    assert.equal(nao.length, 7, `7 linhas sem acesso: ${nao.join(" | ")}`);
    assert.ok(nao.every((i) => /^(tabelas|sequencias|funcoes) /.test(i)));
    assert.match(
      (await inst.lerPrivilegiosPadrao(clienteDaApi(D))).faltando,
      /tabelas:anon/,
    );
    // CONTROLE: o DDL SEM os 9 comandos (o instalador de antes) é pego pela
    // conferência: FALHOU, nenhuma migration enviada, ledger vazio.
    const plano1 = await planejarEm(D);
    assert.equal(plano1.acao, "instalar", plano1.motivo);
    const sab = clienteDaApi(D, {
      sabotarDdl: (sql) => ({
        trocar: sql
          .split("\n")
          .filter((l) => !l.startsWith("ALTER DEFAULT PRIVILEGES"))
          .join("\n"),
      }),
    });
    const r1 = await inst.instalar(sab, plano1, { aplicar: true });
    assert.equal(r1.estado, "FALHOU", r1.mensagem);
    assert.equal(r1.fase, "privilégios padrão");
    assert.equal(sab.registro.filter(ehEnvelope).length, 0);
    assert.equal((await ledger(D)).length, 0);
    // A rodada certa: do zero de novo (ledger vazio, marca em curso).
    const plano2 = await planejarEm(D);
    assert.equal(plano2.acao, "instalar", plano2.motivo);
    assert.equal(plano2.jaNoLedger, 0);
    const r2 = await inst.instalar(clienteDaApi(D), plano2, { aplicar: true });
    assert.equal(r2.estado, "OK", r2.mensagem);
    assert.equal((await ledger(D)).length, repo.length);
    assert.equal(await marca(D), "concluida");
    assert.deepEqual(
      (await consulta185(D)).filter((l) => l.ok !== true),
      [],
      "a 185 toda ok depois do instalador",
    );
    assert.deepEqual(
      await impressao(D),
      estado.digitalA,
      "impressão digital do d = do a (permissões inclusive)",
    );
  },
);

prova(
  "RECUSA: banco com tabela em public e sem ledger → recusado sem NENHUMA chamada; nada criado",
  async () => {
    await comBanco(C, (c) => c.query("CREATE TABLE public.de_alguem (id int)"));
    const plano = await planejarEm(C);
    assert.equal(plano.acao, "recusar");
    assert.match(plano.motivo, /receita de reset/);
    const cli = clienteDaApi(C);
    const r = await inst.instalar(cli, plano, { aplicar: true });
    assert.equal(r.estado, "RECUSADO");
    assert.deepEqual(cli.registro, []);
    const ns = await comBanco(C, (c) =>
      c.query(
        "SELECT to_regnamespace('supabase_migrations') IS NULL AS sem_ledger, (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tabelas",
      ),
    );
    assert.deepEqual(ns.rows[0], { sem_ledger: true, tabelas: 1 });
  },
);

async function main() {
  URL_BASE = lerDatabaseUrlEfemera();
  const modulo = await import(
    pathToFileURL(path.join(RAIZ, "scripts", "frota", "instalador-banco.mjs"))
      .href
  );
  // O ritmo da Management API (600 ms entre pedidos) não vale aqui: o banco é
  // um Postgres local, sem limite de pedidos. Com ele, cada instalação
  // completa dormiria ~3 min no db-ci. A prova do ritmo é a do teste Deno.
  inst = {
    ...modulo,
    instalar: (cliente, plano, opcoes) =>
      modulo.instalar(cliente, plano, {
        ...(opcoes ?? {}),
        ritmo: { intervaloMs: 0 },
      }),
  };
  repo = filaDaBancada();
  const t0 = Date.now();
  await montarBancos();
  let falhas = 0;
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  PASSOU ${nome}`);
      } catch (e) {
        falhas += 1;
        console.error(`  FALHOU ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    await apagarBancos().catch((e) => console.error(`(limpeza) ${e.message}`));
  }
  if (falhas > 0)
    falhar(
      "FALHOU",
      `instalador da loja nova: ${falhas} de ${PROVAS.length} provas falharam`,
    );
  console.log(
    `\n[instalador da loja nova] todas as ${PROVAS.length} provas passaram (${Math.round((Date.now() - t0) / 1000)} s).`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
