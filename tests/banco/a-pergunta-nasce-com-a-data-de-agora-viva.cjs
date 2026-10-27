"use strict";

/**
 * PROVA VIVA da migration 20261396100000_a_pergunta_nasce_com_a_data_de_agora.sql (lote 234, item B) contra o Postgres EFEMERO
 * (clone do rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * O defeito: `questions.created_at` e' escolhido por quem pergunta, e a vitrine ordena por ele (decrescente): uma data futura fixa a
 * pergunta no topo. O conserto: um gatilho BEFORE INSERT troca `created_at := now()` quando quem grava e' cliente (papel de API) que
 * nao e' o administrador de agora; o admin, o service_role e a sessao direta no banco gravam a data como vier.
 *
 *  ANTES       controle: sem o gatilho a data futura vale e a pergunta forjada fica acima da nova (o defeito).
 *  DEPOIS      a data forjada vira agora (1 linha e varias), a pergunta do app (3 colunas) entra igual, o texto/produto/autora ficam,
 *              a forjada NAO fica acima da nova; admin, service_role e sessao direta gravam como vierem; "admin" so no JWT e' trocado;
 *              anon continua recusado pela RLS.
 *  DADOS       pergunta ja gravada (inclusive com data forjada antes do apply) nao e' tocada pelo apply (hash do conteudo).
 *  SO NOVO     o apply cria so a funcao e o gatilho: nenhuma outra funcao, tabela, politica, gatilho ou restricao muda; a funcao nasce
 *              FECHADA (nem PUBLIC, nem anon, nem authenticated, nem service_role executam).
 *  MUTANTES    o mesmo roteiro sobre corpos/gatilhos sabotados FICA VERMELHO na expectativa certa.
 *  MIGRATION   reaplicar (2x) e CRLF = mesmo estado; rollback apaga os dois objetos sem tocar dado e rodar de novo e' no-op; ida e
 *              volta termina igual; o pre-voo recusa SEM escrever; a conferencia final recusa cada estrago; o pre-voo do rollback
 *              recusa o que nao e' dele; consultas 113a/113b nos dois sentidos com o rol fechado.
 *  ATOMICIDADE conexao SEM BEGIN: o arquivo com a conferencia sabotada nao deixa nada para tras; gravacao em voo faz a migration
 *              FALHAR LIMPA no lock_timeout (nao trava a loja) e depois aplica.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-pergunta-nasce-com-a-data-de-agora-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, sha256, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261396100000_a_pergunta_nasce_com_a_data_de_agora.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const A113 = "113a-conferir-a-pergunta-nasce-com-a-data-de-agora-aplicado";
const B113 = "113b-antes-a-pergunta-nasce-com-a-data-de-agora-ausente";
const FN = "public.pergunta_nasce_com_a_data_de_agora()";
const GATILHO = "tr_pergunta_nasce_com_a_data_de_agora";
const NOVOS = {
  funcoes: ["pergunta_nasce_com_a_data_de_agora"],
  gatilhos: [GATILHO],
  restricoes: [],
};

const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(MIGRATION);
const H_CORPO = md5(CORPO);

const U = {
  autor1: "b1396100-0000-4000-8000-0000000000a1",
  autor2: "b1396100-0000-4000-8000-0000000000a2",
  admin: "b1396100-0000-4000-8000-0000000000ad",
  rebaixado: "b1396100-0000-4000-8000-0000000000ae",
};
const PROD = "b1396100-0000-4000-8000-0000000000f1";
const FUTURO = "2099-01-01T00:00:00Z";

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);

async function semear() {
  const c = P.conexao();
  for (const id of Object.values(U))
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@396100.teste', '{}'::jsonb)",
      [id],
    );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Autora Um', 'customer'), ($2, 'Autora Dois', 'customer'), ($3, 'Admin 396100', 'admin'), ($4, 'Ex Admin 396100', 'customer')`,
    [U.autor1, U.autor2, U.admin, U.rebaixado],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = ANY($1::uuid[])',
    [[U.admin, U.rebaixado]],
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta 396100', 100, 10, true, 40)",
    [PROD],
  );
}

const COLUNAS =
  "id, product_id, user_id, question, created_at, (created_at = now()) AS agora";
const SQL_FORJADA = `INSERT INTO public.questions (product_id, user_id, question, created_at) VALUES ($1::uuid, $2::uuid, $3, $4::timestamptz) RETURNING ${COLUNAS}`;
const SQL_NORMAL = `INSERT INTO public.questions (product_id, user_id, question) VALUES ($1::uuid, $2::uuid, $3) RETURNING ${COLUNAS}`;
const forjar = (papel, uid, texto = "tem no M?") =>
  P.tentar(papel, SQL_FORJADA, [PROD, uid, texto, FUTURO], { uid });
const normal = (papel, uid, texto = "chega quando?") =>
  P.tentar(papel, SQL_NORMAL, [PROD, uid, texto], { uid });

/** O roteiro inteiro; cada chave e' uma expectativa que vale `true` quando o comportamento e' o desta migration. */
async function roteiro() {
  const r = {};
  const forjada = await forjar("authenticated", U.autor1, "pergunta forjada");
  r.clienteForja = forjada.linhas?.[0]?.agora === true;
  r.mantemTexto =
    forjada.linhas?.[0]?.question === "pergunta forjada" &&
    forjada.linhas?.[0]?.user_id === U.autor1 &&
    forjada.linhas?.[0]?.product_id === PROD;
  const app = await normal("authenticated", U.autor2, "pergunta do app");
  r.appNormal = app.linhas?.[0]?.agora === true;
  const varias = await P.tentar(
    "authenticated",
    `INSERT INTO public.questions (product_id, user_id, question, created_at) VALUES
       ($1::uuid, $2::uuid, 'a', $3::timestamptz), ($1::uuid, $2::uuid, 'b', '2088-01-01T00:00:00Z'::timestamptz)
     RETURNING (created_at = now()) AS agora`,
    [PROD, U.autor1, FUTURO],
    { uid: U.autor1 },
  );
  r.variasLinhas =
    varias.linhas?.length === 2 && varias.linhas.every((l) => l.agora === true);
  // a forjada (2099) nao pode ficar ACIMA da pergunta do app: com o gatilho as duas nascem no mesmo instante
  r.ordem = forjada.linhas?.[0]?.created_at <= app.linhas?.[0]?.created_at;
  const admin = await forjar("authenticated", U.admin, "do admin");
  r.adminMantem =
    admin.linhas?.[0]?.created_at?.toISOString?.() ===
    new Date(FUTURO).toISOString();
  // No Supabase o service_role tem BYPASSRLS; o papel do efemero nao tem. A transacao desfaz o ALTER ROLE.
  await P.conexao().query("ALTER ROLE service_role BYPASSRLS");
  const servico = await P.tentar(
    "service_role",
    SQL_FORJADA,
    [PROD, U.autor1, "do servico", FUTURO],
    { uid: "" },
  );
  r.servicoMantem =
    servico.linhas?.[0]?.created_at?.toISOString?.() ===
    new Date(FUTURO).toISOString();
  const direto = await P.tentar(
    null,
    SQL_FORJADA,
    [PROD, U.autor1, "do banco", FUTURO],
    { uid: "" },
  );
  r.diretoMantem =
    direto.linhas?.[0]?.created_at?.toISOString?.() ===
    new Date(FUTURO).toISOString();
  // "admin" so no JWT (a conta foi rebaixada no perfil): e' cliente
  await P.conexao().query(
    "UPDATE public.profiles SET role = 'customer' WHERE id = $1",
    [U.rebaixado],
  );
  const rebaixado = await P.tentar(
    "authenticated",
    SQL_FORJADA,
    [PROD, U.rebaixado, "do rebaixado", FUTURO],
    {
      uid: U.rebaixado,
      claims: JSON.stringify({
        role: "authenticated",
        app_metadata: { role: "admin" },
      }),
    },
  );
  r.rebaixadoTrocado = rebaixado.linhas?.[0]?.agora === true;
  const anon = await P.tentar(
    "anon",
    SQL_FORJADA,
    [PROD, U.autor1, "do anonimo", FUTURO],
    { uid: "" },
  );
  r.anonRecusado = Boolean(anon.erro) && /row-level security/.test(anon.erro);
  return r;
}
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

const estado = async () => {
  const c = P.conexao();
  return {
    fn: (
      await c.query(
        `SELECT p.oid::text AS oid, md5(replace(p.prosrc, chr(13), '')) AS md5, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
                p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS dono, pg_get_function_result(p.oid) AS ret
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [FN],
      )
    ).rows[0],
    gatilho: (
      await c.query(
        `SELECT tgrelid::regclass::text AS t, tgtype, tgenabled, tgfoid::regproc::text AS f, tgqual IS NULL AS sem_when, tgnargs
           FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`,
        [GATILHO],
      )
    ).rows,
  };
};
const aplicado = async (c = P.conexao()) =>
  (
    await c.query(
      "SELECT to_regprocedure($1) IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = $2) AS x",
      [FN, GATILHO],
    )
  ).rows[0].x;
const dadosDasPerguntas = async () =>
  (
    await P.conexao().query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') AS h FROM public.questions x`,
    )
  ).rows[0];

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "o corpo e a ACL: md5 conhecido e citado no pre-voo, na conferencia, no rollback e na 113a; a funcao nasce FECHADA",
  async () => {
    assert.equal(
      MIGRATION.split(`'${H_CORPO}'`).length - 1,
      2,
      "pre-voo e conferencia",
    );
    assert.ok(ROLLBACK.includes(`'${H_CORPO}'`));
    assert.ok(P.lerConsulta(A113).includes(`'${H_CORPO}'`));
    await P.emTransacao(
      async () => {
        const e = await estado();
        assert.equal(e.fn.md5, H_CORPO);
        assert.equal(e.fn.prosecdef, true);
        assert.equal(e.fn.provolatile, "v");
        assert.equal(e.fn.cfg, "{search_path=public}");
        assert.equal(e.fn.ret, "trigger");
        const acl = (
          await P.conexao().query(
            `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') AS auth,
                has_function_privilege('service_role', $1::regprocedure, 'EXECUTE') AS srv,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE p.oid = $1::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico`,
            [FN],
          )
        ).rows[0];
        assert.deepEqual(acl, {
          anon: false,
          auth: false,
          srv: false,
          publico: false,
        });
        assert.equal(e.gatilho.length, 1);
        assert.deepEqual(e.gatilho[0], {
          t: "questions",
          tgtype: 7,
          tgenabled: "O",
          f: "pergunta_nasce_com_a_data_de_agora",
          sem_when: true,
          tgnargs: 0,
        });
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "ANTES (controle): sem o gatilho a data futura vale e a pergunta forjada sobe acima da nova (o defeito)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false, "o estado ANTES nao montou");
        const r = await roteiro();
        assert.equal(
          r.clienteForja,
          false,
          "controle: a data forjada devia valer sem o gatilho",
        );
        assert.equal(r.variasLinhas, false);
        // o que ja era certo antes continua certo
        assert.equal(r.appNormal, true);
        assert.equal(r.anonRecusado, true);
        assert.equal(r.adminMantem && r.servicoMantem && r.diretoMantem, true);
        assert.equal(r.rebaixadoTrocado, false);
        assert.equal(
          r.ordem,
          false,
          "sem o gatilho a forjada devia ficar acima da pergunta do app",
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: a data forjada vira agora (uma e varias linhas), o app entra igual, o texto fica, a forjada nao sobe; admin/servico/direto mantem; rebaixado troca; anon recusado",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
        // so as do admin, do servico e do banco ficam no futuro (de proposito); nenhuma de cliente
        const clientes = (
          await P.conexao().query(
            "SELECT count(*)::int AS n FROM public.questions WHERE created_at > now() AND question IN ('pergunta forjada','a','b','do rebaixado')",
          )
        ).rows[0].n;
        assert.equal(clientes, 0);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "DADOS: o apply nao toca pergunta existente (inclusive a de data forjada antes do apply)",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "INSERT INTO public.questions (product_id, user_id, question, created_at) VALUES ($1, $2, 'ja existia', $3)",
        [PROD, U.autor1, FUTURO],
      );
      const d0 = await dadosDasPerguntas();
      await depois();
      await depois();
      assert.deepEqual(
        await dadosDasPerguntas(),
        d0,
        "o apply mexeu em pergunta",
      );
      const futura = (
        await P.conexao().query(
          "SELECT created_at FROM public.questions WHERE question = 'ja existia'",
        )
      ).rows[0];
      assert.equal(
        futura.created_at.toISOString(),
        new Date(FUTURO).toISOString(),
        "a data forjada antiga foi reescrita pelo apply",
      );
      await antes();
      assert.deepEqual(
        await dadosDasPerguntas(),
        d0,
        "o rollback mexeu em pergunta",
      );
    });
  },
);

prova(
  "SO NOVO: o apply cria so a funcao e o gatilho; nada mais muda (funcoes, tabelas, politicas, gatilhos, restricoes)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      const r0 = await P.retrato(NOVOS);
      assert.equal(await aplicado(), false);
      await depois();
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await P.retrato(NOVOS),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
      // e a contagem de objetos novos e' exatamente 2
      const funcoes = (
        await P.conexao().query(
          "SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'pergunta_nasce_com_a_data_de_agora'",
        )
      ).rows[0].n;
      assert.equal(funcoes, 1);
    });
  },
);

// ---- MUTANTES: o mesmo roteiro sobre corpos/gatilhos sabotados fica vermelho na expectativa certa ------------------------------
const MUTANTES = [
  [
    "sem a troca da data",
    (c) => c.replace("NEW.created_at := now();", "NULL;"),
    ["clienteForja", "ordem", "variasLinhas", "rebaixadoTrocado"],
  ],
  [
    "sem a excecao do administrador",
    (c) => c.replace("\n       AND NOT public.rls_admin_atual() THEN", " THEN"),
    ["adminMantem", "servicoMantem"],
  ],
  [
    "excecao invertida (troca so o administrador)",
    (c) =>
      c.replace(
        "AND NOT public.rls_admin_atual()",
        "AND public.rls_admin_atual()",
      ),
    [
      "adminMantem",
      "servicoMantem",
      "clienteForja",
      "ordem",
      "variasLinhas",
      "rebaixadoTrocado",
    ],
  ],
  [
    "sem a excecao da sessao direta",
    (c) =>
      c.replace(
        "COALESCE(NULLIF(current_setting('role', true), ''), 'none') <> 'none'\n       AND ",
        "",
      ),
    ["diretoMantem"],
  ],
  [
    "troca por uma data fixa em vez de agora",
    (c) =>
      c.replace(
        "NEW.created_at := now();",
        "NEW.created_at := '2000-01-01'::timestamptz;",
      ),
    ["clienteForja", "variasLinhas", "rebaixadoTrocado", "appNormal"],
  ],
];
for (const [nome, sabotar, esperado] of MUTANTES) {
  prova(
    `MUTANTE ${nome}: o roteiro fica vermelho nas expectativas certas`,
    async () => {
      const corpoMutado = sabotar(CORPO);
      assert.notEqual(corpoMutado, CORPO, "a sabotagem nao mudou nada");
      await P.emTransacao(
        async () => {
          const r = await roteiro();
          const f = falhou(r);
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
          assert.ok(f.length > 0);
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(
            `CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$${corpoMutado}$f$`,
          );
        },
      );
    },
  );
}
prova(
  "MUTANTE gatilho AFTER INSERT / desligado / so UPDATE: a data forjada vale",
  async () => {
    for (const sabotagem of [
      `DROP TRIGGER ${GATILHO} ON public.questions; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora()`,
      `ALTER TABLE public.questions DISABLE TRIGGER ${GATILHO}`,
      `DROP TRIGGER ${GATILHO} ON public.questions; CREATE TRIGGER ${GATILHO} BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora()`,
    ]) {
      await P.emTransacao(
        async () => {
          const f = falhou(await roteiro());
          assert.ok(
            f.includes("clienteForja") && f.includes("variasLinhas"),
            `a sabotagem '${sabotagem.slice(0, 60)}' devia reprovar: ${JSON.stringify(f)}`,
          );
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(sabotagem);
        },
      );
    }
  },
);

// ---- MIGRATION --------------------------------------------------------------------------------------------------------------
prova(
  "reaplicar 2x e em CRLF = mesmo estado (OID, ACL, atributos, gatilho)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      await depois();
      const e1 = await estado();
      await depois();
      await depois();
      assert.deepEqual(await estado(), e1, "reaplicar 2x mudou o estado");
      await P.conexao().query(emCRLF(MIGRATION));
      const e3 = await estado();
      assert.equal(
        e3.fn.md5,
        e1.fn.md5,
        "em CRLF o corpo muda de md5 (a migration normaliza CR no pre-voo/conferencia)",
      );
      assert.deepEqual(
        { ...e3, fn: { ...e3.fn, oid: null } },
        { ...e1, fn: { ...e1.fn, oid: null } },
      );
    });
  },
);

prova(
  "rollback: apaga os dois objetos sem tocar dado; 2x e' no-op; ida e volta termina igual",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      await P.conexao().query(
        "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1, $2, 'fica')",
        [PROD, U.autor1],
      );
      const d0 = await dadosDasPerguntas();
      const e0 = await estado();
      await antes();
      assert.equal(await aplicado(), false);
      assert.equal(
        (
          await P.conexao().query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = $1",
            [GATILHO],
          )
        ).rows[0].n,
        0,
      );
      assert.deepEqual(
        await dadosDasPerguntas(),
        d0,
        "o rollback mexeu em pergunta",
      );
      await antes();
      assert.equal(await aplicado(), false, "o segundo rollback nao foi no-op");
      await depois();
      assert.deepEqual(
        { ...(await estado()), fn: { ...(await estado()).fn, oid: null } },
        { ...e0, fn: { ...e0.fn, oid: null } },
      );
      assert.deepEqual(await dadosDasPerguntas(), d0);
      assert.equal(sha256(ROLLBACK).length, 64);
    });
  },
);

prova("pre-voo recusa SEM escrever em cada estado ruim", async () => {
  const sabotagens = [
    [
      "funcao com corpo desconhecido",
      "CREATE FUNCTION public.pergunta_nasce_com_a_data_de_agora() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$",
    ],
    [
      "funcao com sobrecarga",
      "CREATE FUNCTION public.pergunta_nasce_com_a_data_de_agora(x integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
    ],
    [
      "gatilho do mesmo nome em outra tabela",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "gatilho do mesmo nome AFTER",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "gatilho do mesmo nome com WHEN",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW WHEN (NEW.question IS NOT NULL) EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "rls_admin_atual ausente",
      "ALTER FUNCTION public.rls_admin_atual() RENAME TO rls_admin_atual_sumida",
    ],
    [
      "questions.created_at inexistente",
      "ALTER TABLE public.questions RENAME COLUMN created_at TO criada_em",
    ],
  ];
  for (const [nome, sabotar] of sabotagens) {
    await P.emTransacao(
      async () => {
        await P.conexao().query(sabotar);
        const r0 = await P.retrato(NOVOS);
        const antesDeTentar = await estado();
        await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await P.retrato(NOVOS),
          r0,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        assert.deepEqual(
          await estado(),
          antesDeTentar,
          `pre-voo (${nome}) mexeu na funcao ou no gatilho`,
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  }
});

prova(
  "a conferencia final recusa cada estrago (corpo, atributos, ACL aberta, gatilho desligado/ausente/duplicado)",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261396100000");
    const estragos = [
      [
        "corpo trocado",
        `CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
        /corpo vivo/,
      ],
      [
        "SECURITY INVOKER",
        "ALTER FUNCTION public.pergunta_nasce_com_a_data_de_agora() SECURITY INVOKER",
        /atributos/,
      ],
      [
        "search_path solto",
        "ALTER FUNCTION public.pergunta_nasce_com_a_data_de_agora() RESET search_path",
        /atributos/,
      ],
      [
        "EXECUTE de authenticated",
        "GRANT EXECUTE ON FUNCTION public.pergunta_nasce_com_a_data_de_agora() TO authenticated",
        /authenticated ou service_role|PUBLIC/,
      ],
      [
        "EXECUTE de PUBLIC",
        "GRANT EXECUTE ON FUNCTION public.pergunta_nasce_com_a_data_de_agora() TO PUBLIC",
        /PUBLIC/,
      ],
      [
        "gatilho desligado",
        `ALTER TABLE public.questions DISABLE TRIGGER ${GATILHO}`,
        /gatilho/,
      ],
      [
        "gatilho ausente",
        `DROP TRIGGER ${GATILHO} ON public.questions`,
        /gatilho/,
      ],
    ];
    for (const [, estrago, padrao] of estragos) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(estrago);
          await P.recusa(bloco, padrao);
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
  },
);

prova(
  "pre-voo do rollback recusa o que nao e' dele (funcao redefinida, gatilho alheio, outro gatilho usando a funcao) sem apagar nada",
  async () => {
    const sabotagens = [
      [
        "funcao redefinida",
        `CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
      ],
      [
        "gatilho com outro momento",
        `DROP TRIGGER ${GATILHO} ON public.questions; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora()`,
      ],
      [
        "outro gatilho usa a funcao",
        "CREATE TRIGGER prova_outro BEFORE INSERT ON public.answers FOR EACH ROW EXECUTE FUNCTION public.pergunta_nasce_com_a_data_de_agora()",
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(sabotar);
          const antesDeTentar = await estado();
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await estado(),
            antesDeTentar,
            `o pre-voo do rollback (${nome}) apagou antes de recusar`,
          );
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
  },
);

prova(
  "consultas 113a/113b nos dois sentidos, com o rol fechado, e cada linha reprova no estrago certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A113), [], "113a no estado DEPOIS");
        const naoSao = await P.consulta(B113);
        assert.ok(
          naoSao.length >= 1,
          "113b depois do apply devia reprovar a linha de ausencia",
        );
        await antes();
        assert.deepEqual(await P.consulta(B113), [], "113b no estado ANTES");
        assert.equal(
          (await P.consulta(A113)).length,
          3,
          "113a no estado ANTES devia reprovar as 3 linhas do objeto",
        );
        await depois();
        for (const [estrago, linha] of [
          [
            `ALTER TABLE public.questions DISABLE TRIGGER ${GATILHO}`,
            /gatilho/,
          ],
          [
            "GRANT EXECUTE ON FUNCTION public.pergunta_nasce_com_a_data_de_agora() TO authenticated",
            /atributos|EXECUTE/,
          ],
          [
            `CREATE OR REPLACE FUNCTION public.pergunta_nasce_com_a_data_de_agora() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$`,
            /corpo exato/,
          ],
        ]) {
          await P.conexao().query("SAVEPOINT estrago");
          await P.conexao().query(estrago);
          const reprovadas = await P.consulta(A113);
          assert.ok(
            reprovadas.some((i) => linha.test(i)),
            `a 113a nao reprovou a linha certa para '${estrago.slice(0, 50)}': ${JSON.stringify(reprovadas)}`,
          );
          await P.conexao().query("ROLLBACK TO SAVEPOINT estrago");
        }
      },
      async () => {
        await depois();
      },
    );
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) -------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, a conferencia sabotada derruba o arquivo inteiro e nao deixa funcao nem gatilho",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
      const quebrada = MIGRATION.split(
        `IF v_hash IS DISTINCT FROM '${H_CORPO}' THEN\n    RAISE EXCEPTION 'conferencia`,
      ).join(
        `IF v_hash IS DISTINCT FROM 'ffffffffffffffffffffffffffffffff' THEN\n    RAISE EXCEPTION 'conferencia`,
      );
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261396100000/,
      );
      assert.equal(
        (
          await c3.query(
            "SELECT to_regprocedure($1) IS NOT NULL AS f, EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = $2) AS g",
            [FN, GATILHO],
          )
        ).rows[0].f,
        false,
        "a funcao ficou depois da conferencia reprovar",
      );
      assert.equal(
        (
          await c3.query(
            "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = $1) AS g",
            [GATILHO],
          )
        ).rows[0].g,
        false,
      );
    } finally {
      await c3.end();
    }
  },
);

prova(
  "TRAVA: gravacao de pergunta em voo faz a migration falhar limpa no lock_timeout e, depois dela, aplicar",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO public.questions (product_id, user_id, question) VALUES (gen_random_uuid(), gen_random_uuid(), 'em voo')",
        );
      },
      aplicado,
    });
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("a-pergunta-nasce-com-a-data-de-agora");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
