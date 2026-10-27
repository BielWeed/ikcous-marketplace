"use strict";

/* eslint-disable security/detect-object-injection --
 * Os indices vem de listas fechadas deste arquivo (as chaves do roteiro), nunca de entrada de rede. */

/**
 * PROVA VIVA da migration 20261396000000_cada_conta_tem_no_maximo_10_aparelhos_com_aviso.sql (lote 234, item A) contra o Postgres
 * EFEMERO (clone do rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * O defeito: nada limita quantas linhas de `push_subscriptions` uma conta grava; 100 "aparelhos" falsos que nao respondem comem o
 * orcamento de 50 s da campanha de avisos. O conserto: um gatilho BEFORE INSERT recusa a 11a inscricao NOVA da conta (cliente que nao e'
 * administrador), sem apagar nada. O app grava com UPSERT por endpoint e o Postgres dispara o gatilho BEFORE INSERT antes de olhar o
 * conflito: o re-registro do mesmo aparelho (endpoint que ja existe) NAO pode contar.
 *
 *  ANTES       controle: sem o gatilho a 11a e a 101a passam (o defeito).
 *  DEPOIS      10 passam, a 11a recusa (P0001, DETAIL push_limite_de_aparelhos, frase em portugues) e nada e' gravado; o re-registro
 *              de um endpoint existente passa com a conta nos 10 (e com a conta ja acima de 10); endpoint novo por upsert recusa;
 *              outra conta segue livre; apagar uma libera uma vaga; o endpoint de OUTRA conta continua recusado pela RLS (e nao
 *              pelo gatilho); admin, service_role e sessao direta nao tem limite; 12 linhas numa tacada recusam inteiras, 10 passam;
 *              conta com 15 linhas de antes mantem tudo, renova, desliga e so volta a cadastrar abaixo de 10; anon recusado.
 *  CONCORRENCIA duas conexoes reais cadastrando a 10a e a 11a juntas: a segunda ESPERA a primeira e recusa (10 linhas no fim);
 *              sem a trava por conta (mutante) as duas passam (11).
 *  DADOS/SO NOVO/MUTANTES/MIGRATION/ATOMICIDADE/TRAVA: como as irmas (a-pergunta-nasce-com-a-data-de-agora-viva.cjs).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cada-conta-tem-no-maximo-10-aparelhos-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, md5, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261396000000_cada_conta_tem_no_maximo_10_aparelhos_com_aviso.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const A112 =
  "112a-conferir-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-aplicado";
const B112 =
  "112b-antes-cada-conta-tem-no-maximo-10-aparelhos-com-aviso-ausente";
const FN = "public.push_inscricoes_limite_por_conta()";
const GATILHO = "tr_push_inscricoes_limite_por_conta";
const NOVOS = {
  funcoes: ["push_inscricoes_limite_por_conta"],
  gatilhos: [GATILHO],
  restricoes: [],
};

const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(MIGRATION);
const H_CORPO = md5(CORPO);
const CABECA_FN =
  "CREATE OR REPLACE FUNCTION public.push_inscricoes_limite_por_conta() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$";
const comCorpo = (corpo) => `${CABECA_FN}${corpo}$f$`;

const U = {
  a1: "b1396000-0000-4000-8000-0000000000a1",
  a2: "b1396000-0000-4000-8000-0000000000a2",
  a3: "b1396000-0000-4000-8000-0000000000a3",
  a4: "b1396000-0000-4000-8000-0000000000a4",
  a5: "b1396000-0000-4000-8000-0000000000a5",
  admin: "b1396000-0000-4000-8000-0000000000ad",
  conc: "b1396000-0000-4000-8000-0000000000c0",
};
const SQL_NOVO = `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id) VALUES ($1, 'chave-p', 'chave-a', $2::uuid)`;
// o que o app faz (PostgREST upsert onConflict endpoint = merge-duplicates)
const SQL_UPSERT = `${SQL_NOVO} ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_id = EXCLUDED.user_id`;
const ep = (conta, n) => `https://push.exemplo.teste/${conta}/${n}`;

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);

async function semear() {
  const c = P.conexao();
  for (const id of Object.values(U))
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@396000.teste', '{}'::jsonb)",
      [id],
    );
  await c.query(
    "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin 396000', 'admin')",
    [U.admin],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
}
const quantas = async (uid) =>
  (
    await P.conexao().query(
      "SELECT count(*)::int AS n FROM public.push_subscriptions WHERE user_id = $1",
      [uid],
    )
  ).rows[0].n;
const cliente = (sql, uid, endpoint) =>
  P.tentar("authenticated", sql, [endpoint, uid], { uid });
/** Insere `n` endpoints novos da conta como cliente; devolve quantos passaram. */
async function encher(uid, de, ate) {
  let ok = 0;
  for (let i = de; i <= ate; i += 1)
    if (!(await cliente(SQL_NOVO, uid, ep(uid, i))).erro) ok += 1;
  return ok;
}
const eLimite = (r) =>
  Boolean(r.erro) &&
  r.codigo === "P0001" &&
  r.detalhe === "push_limite_de_aparelhos" &&
  /10 aparelhos com aviso ligado/.test(r.erro);

/** O roteiro inteiro; cada chave vale `true` quando o comportamento e' o desta migration. */
async function roteiro() {
  const r = {};
  r.dezPassam = (await encher(U.a1, 1, 10)) === 10;
  const decima1 = await cliente(SQL_NOVO, U.a1, ep(U.a1, 11));
  r.decimaPrimeiraRecusada = eLimite(decima1) && (await quantas(U.a1)) === 10;
  // re-registro do MESMO aparelho com a conta nos 10: o app faz upsert
  const re = await cliente(
    SQL_UPSERT.replace("'chave-p'", "'chave-p-nova'"),
    U.a1,
    ep(U.a1, 3),
  );
  r.reinscricaoNoLimite =
    !re.erro &&
    (
      await P.conexao().query(
        "SELECT p256dh FROM public.push_subscriptions WHERE endpoint = $1",
        [ep(U.a1, 3)],
      )
    ).rows[0].p256dh === "chave-p-nova";
  r.upsertNovoRecusado = eLimite(await cliente(SQL_UPSERT, U.a1, ep(U.a1, 12)));
  r.outraContaLivre = (await encher(U.a2, 1, 3)) === 3;
  // o endpoint de OUTRA conta: continua recusado, pela RLS (nao pelo gatilho, nao vira "limite")
  const alheio = await cliente(SQL_UPSERT, U.a2, ep(U.a1, 1));
  r.endpointAlheioPelaRls =
    Boolean(alheio.erro) &&
    !eLimite(alheio) &&
    /row-level security/.test(alheio.erro);
  // apagar libera exatamente uma vaga
  await P.tentar(
    "authenticated",
    "DELETE FROM public.push_subscriptions WHERE endpoint = $1",
    [ep(U.a1, 10)],
    { uid: U.a1 },
  );
  const vaga = await cliente(SQL_NOVO, U.a1, ep(U.a1, 13));
  const semVaga = await cliente(SQL_NOVO, U.a1, ep(U.a1, 14));
  r.apagarLiberaUmaVaga =
    !vaga.erro && eLimite(semVaga) && (await quantas(U.a1)) === 10;
  // administrador, servico e sessao direta nao tem limite
  const admin = [];
  for (let i = 1; i <= 12; i += 1)
    admin.push((await cliente(SQL_NOVO, U.admin, ep(U.admin, i))).erro);
  r.adminSemLimite = admin.every((e) => !e) && (await quantas(U.admin)) === 12;
  // No Supabase o service_role tem BYPASSRLS; o papel do efemero nao tem. A transacao desfaz o ALTER ROLE.
  await P.conexao().query("ALTER ROLE service_role BYPASSRLS");
  let servico = 0;
  for (let i = 1; i <= 12; i += 1)
    if (
      !(
        await P.tentar("service_role", SQL_NOVO, [ep("srv", i), U.a3], {
          uid: "",
        })
      ).erro
    )
      servico += 1;
  r.servicoSemLimite = servico === 12;
  let direto = 0;
  for (let i = 1; i <= 12; i += 1)
    if (
      !(await P.tentar(null, SQL_NOVO, [ep("dir", i), U.a3], { uid: "" })).erro
    )
      direto += 1;
  r.diretoSemLimite = direto === 12;
  // linha sem dona (user_id nulo) pelo banco: nao ha conta a contar
  r.semDonaPassa = !(
    await P.tentar(
      null,
      SQL_NOVO.replace("$2::uuid", "NULL"),
      [ep("nula", 1)],
      { uid: "" },
    )
  ).erro;
  const anon = await P.tentar("anon", SQL_NOVO, [ep("anon", 1), U.a1], {
    uid: "",
  });
  // anon nao grava inscricao nenhuma (a RLS recusa; para uma conta com 10 ou mais o gatilho, que roda antes da RLS, responde primeiro,
  // sem gravar nada em qualquer dos dois casos)
  r.anonRecusado =
    Boolean(anon.erro) &&
    (
      await P.conexao().query(
        "SELECT count(*)::int AS n FROM public.push_subscriptions WHERE endpoint = $1",
        [ep("anon", 1)],
      )
    ).rows[0].n === 0;
  // varias linhas numa tacada so
  const dez = await P.tentar(
    "authenticated",
    `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id) SELECT 'https://push.exemplo.teste/lote10/' || g, 'p', 'a', $1::uuid FROM generate_series(1, 10) g`,
    [U.a4],
    { uid: U.a4 },
  );
  r.dezNumaTacada = !dez.erro && (await quantas(U.a4)) === 10;
  const doze = await P.tentar(
    "authenticated",
    `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id) SELECT 'https://push.exemplo.teste/lote12/' || g, 'p', 'a', $1::uuid FROM generate_series(1, 12) g`,
    [U.a5],
    { uid: U.a5 },
  );
  r.dozeNumaTacadaRecusa = eLimite(doze) && (await quantas(U.a5)) === 0;
  return r;
}
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

/** Conta com 15 linhas de ANTES do gatilho (inseridas com o gatilho desligado para esta sessao). */
async function legado() {
  const c = P.conexao();
  const r = {};
  await c.query("SET LOCAL session_replication_role = replica");
  for (let i = 1; i <= 15; i += 1)
    await c.query(SQL_NOVO, [ep("legado", i), U.a1]);
  await c.query("SET LOCAL session_replication_role = origin");
  const d0 = (
    await c.query(
      "SELECT md5(string_agg(x::text, '|' ORDER BY x.endpoint)) AS h FROM public.push_subscriptions x WHERE user_id = $1",
      [U.a1],
    )
  ).rows[0].h;
  r.legadoRenova = !(
    await cliente(
      SQL_UPSERT.replace("'chave-p'", "'chave-p-renovada'"),
      U.a1,
      ep("legado", 7),
    )
  ).erro;
  r.legadoNaoCadastraNovo = eLimite(
    await cliente(SQL_NOVO, U.a1, ep("legado", 99)),
  );
  r.legadoNadaApagado = (await quantas(U.a1)) === 15;
  // desliga 6 (15 -> 9): cabe UM novo e o seguinte recusa
  for (let i = 10; i <= 15; i += 1)
    await P.tentar(
      "authenticated",
      "DELETE FROM public.push_subscriptions WHERE endpoint = $1",
      [ep("legado", i)],
      { uid: U.a1 },
    );
  r.legadoVoltaAbaixoDe10 =
    !(await cliente(SQL_NOVO, U.a1, ep("legado", 100))).erro &&
    eLimite(await cliente(SQL_NOVO, U.a1, ep("legado", 101)));
  r.legadoIntactoAteAqui = typeof d0 === "string";
  return r;
}

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
const dadosDasInscricoes = async () =>
  (
    await P.conexao().query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x.endpoint)), '') AS h FROM public.push_subscriptions x`,
    )
  ).rows[0];

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "o corpo e a ACL: md5 conhecido e citado no pre-voo, na conferencia, no rollback e na 112a; a funcao nasce FECHADA; a trava por conta vem antes da contagem",
  async () => {
    assert.equal(
      MIGRATION.split(`'${H_CORPO}'`).length - 1,
      2,
      "pre-voo e conferencia",
    );
    assert.ok(ROLLBACK.includes(`'${H_CORPO}'`));
    assert.ok(P.lerConsulta(A112).includes(`'${H_CORPO}'`));
    assert.ok(
      CORPO.indexOf("pg_advisory_xact_lock") > 0 &&
        CORPO.indexOf("pg_advisory_xact_lock") <
          CORPO.indexOf("LIMIT v_limite"),
    );
    assert.ok(
      CORPO.indexOf("s.endpoint = NEW.endpoint") <
        CORPO.indexOf("pg_advisory_xact_lock"),
      "o endpoint existente tem de sair antes de contar",
    );
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
        assert.deepEqual(e.gatilho, [
          {
            t: "push_subscriptions",
            tgtype: 7,
            tgenabled: "O",
            f: "push_inscricoes_limite_por_conta",
            sem_when: true,
            tgnargs: 0,
          },
        ]);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "ANTES (controle): sem o gatilho a 11a, a 12a por upsert e as 12 numa tacada passam (o defeito)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false, "o estado ANTES nao montou");
        const r = await roteiro();
        assert.equal(
          r.decimaPrimeiraRecusada,
          false,
          "controle: a 11a devia passar sem o gatilho",
        );
        assert.equal(r.upsertNovoRecusado, false);
        assert.equal(r.dozeNumaTacadaRecusa, false);
        assert.equal(r.apagarLiberaUmaVaga, false);
        // o que ja era certo antes continua certo
        for (const k of [
          "dezPassam",
          "reinscricaoNoLimite",
          "outraContaLivre",
          "endpointAlheioPelaRls",
          "adminSemLimite",
          "servicoSemLimite",
          "diretoSemLimite",
          "semDonaPassa",
          "anonRecusado",
          "dezNumaTacada",
        ])
          assert.equal(
            r[k],
            true,
            `no estado ANTES a expectativa ${k} ja devia valer`,
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
  "DEPOIS: 10 passam, a 11a recusa com a frase e nada e' gravado; re-registro do mesmo aparelho passa nos 10; upsert novo recusa; outra conta livre; endpoint alheio pela RLS; apagar libera uma vaga; admin/servico/direto sem limite; tacada de 12 recusa inteira",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "DEPOIS, conta com 15 linhas de antes: nada e' apagado, renova os endpoints que tem, so cadastra novo abaixo de 10",
  async () => {
    await P.emTransacao(
      async () => {
        const r = await legado();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "DADOS: o apply nao toca inscricao existente (inclusive conta acima do limite) e o rollback tambem nao",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      for (let i = 1; i <= 25; i += 1)
        await P.conexao().query(SQL_NOVO, [ep("antiga", i), U.a1]);
      const d0 = await dadosDasInscricoes();
      await depois();
      await depois();
      assert.deepEqual(
        await dadosDasInscricoes(),
        d0,
        "o apply mexeu em inscricao",
      );
      await antes();
      assert.deepEqual(
        await dadosDasInscricoes(),
        d0,
        "o rollback mexeu em inscricao",
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
    });
  },
);

// ---- MUTANTES -----------------------------------------------------------------------------------------------------------------
const MUTANTES = [
  [
    "sem o limite (teto absurdo)",
    (c) =>
      c.replace(
        "v_limite CONSTANT integer := 10;",
        "v_limite CONSTANT integer := 100000;",
      ),
    [
      "decimaPrimeiraRecusada",
      "upsertNovoRecusado",
      "dozeNumaTacadaRecusa",
      "apagarLiberaUmaVaga",
    ],
  ],
  [
    "limite com erro de um (> em vez de >=)",
    (c) => c.replace(") >= v_limite", ") > v_limite"),
    ["decimaPrimeiraRecusada", "upsertNovoRecusado", "apagarLiberaUmaVaga"],
  ],
  [
    "sem a saida do endpoint que ja existe (conta o re-registro)",
    (c) =>
      c.replace(
        / {4}IF EXISTS \(SELECT 1 FROM public\.push_subscriptions s WHERE s\.endpoint = NEW\.endpoint\) THEN\n {8}RETURN NEW;\n {4}END IF;\n/,
        "",
      ),
    ["reinscricaoNoLimite"],
  ],
  [
    "sem a excecao do administrador",
    (c) => c.replace("\n       AND NOT public.rls_admin_atual() THEN", " THEN"),
    ["adminSemLimite", "servicoSemLimite"],
  ],
  [
    "sem a excecao da sessao direta",
    (c) =>
      c.replace(
        "COALESCE(NULLIF(current_setting('role', true), ''), 'none') = 'none' OR NEW.user_id IS NULL",
        "NEW.user_id IS NULL",
      ),
    ["diretoSemLimite"],
  ],
  [
    "conta TODAS as inscricoes da loja (sem filtro por conta)",
    (c) => c.replace("WHERE s.user_id = NEW.user_id LIMIT", "LIMIT"),
    ["outraContaLivre", "dezNumaTacada"],
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
          const f = falhou(await roteiro());
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(comCorpo(corpoMutado));
        },
      );
    },
  );
}
prova("MUTANTE gatilho AFTER INSERT / desligado: a 11a passa", async () => {
  for (const sabotagem of [
    `DROP TRIGGER ${GATILHO} ON public.push_subscriptions; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.push_inscricoes_limite_por_conta()`,
    `ALTER TABLE public.push_subscriptions DISABLE TRIGGER ${GATILHO}`,
  ]) {
    await P.emTransacao(
      async () => {
        const f = falhou(await roteiro());
        assert.ok(
          f.includes("decimaPrimeiraRecusada") &&
            f.includes("dozeNumaTacadaRecusa"),
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
});

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
      await encher(U.a1, 1, 4);
      const d0 = await dadosDasInscricoes();
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
        await dadosDasInscricoes(),
        d0,
        "o rollback mexeu em inscricao",
      );
      await antes();
      assert.equal(await aplicado(), false, "o segundo rollback nao foi no-op");
      await depois();
      const e1 = await estado();
      assert.deepEqual(
        { ...e1, fn: { ...e1.fn, oid: null } },
        { ...e0, fn: { ...e0.fn, oid: null } },
      );
      assert.deepEqual(await dadosDasInscricoes(), d0);
    });
  },
);

prova("pre-voo recusa SEM escrever em cada estado ruim", async () => {
  const sabotagens = [
    [
      "funcao com corpo desconhecido",
      "CREATE FUNCTION public.push_inscricoes_limite_por_conta() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$",
    ],
    [
      "funcao com sobrecarga",
      "CREATE FUNCTION public.push_inscricoes_limite_por_conta(x integer) RETURNS integer LANGUAGE sql AS $f$ SELECT 1 $f$",
    ],
    [
      "gatilho do mesmo nome em outra tabela",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "gatilho do mesmo nome AFTER",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "gatilho do mesmo nome com WHEN",
      `CREATE FUNCTION public.prova_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.push_subscriptions FOR EACH ROW WHEN (NEW.endpoint IS NOT NULL) EXECUTE FUNCTION public.prova_fn()`,
    ],
    [
      "rls_admin_atual ausente",
      "ALTER FUNCTION public.rls_admin_atual() RENAME TO rls_admin_atual_sumida",
    ],
    [
      "push_subscriptions.endpoint com outro tipo",
      "ALTER TABLE public.push_subscriptions ALTER COLUMN endpoint TYPE varchar(500)",
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
  "a conferencia final recusa cada estrago (corpo, atributos, ACL aberta, gatilho desligado/ausente)",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261396000000");
    const estragos = [
      ["corpo trocado", comCorpo(" BEGIN RETURN NEW; END; "), /corpo vivo/],
      [
        "SECURITY INVOKER",
        "ALTER FUNCTION public.push_inscricoes_limite_por_conta() SECURITY INVOKER",
        /atributos/,
      ],
      [
        "search_path solto",
        "ALTER FUNCTION public.push_inscricoes_limite_por_conta() RESET search_path",
        /atributos/,
      ],
      [
        "EXECUTE de authenticated",
        "GRANT EXECUTE ON FUNCTION public.push_inscricoes_limite_por_conta() TO authenticated",
        /authenticated ou service_role|PUBLIC/,
      ],
      [
        "EXECUTE de PUBLIC",
        "GRANT EXECUTE ON FUNCTION public.push_inscricoes_limite_por_conta() TO PUBLIC",
        /PUBLIC/,
      ],
      [
        "gatilho desligado",
        `ALTER TABLE public.push_subscriptions DISABLE TRIGGER ${GATILHO}`,
        /gatilho/,
      ],
      [
        "gatilho ausente",
        `DROP TRIGGER ${GATILHO} ON public.push_subscriptions`,
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
      ["funcao redefinida", comCorpo(" BEGIN RETURN NEW; END; ")],
      [
        "gatilho com outro momento",
        `DROP TRIGGER ${GATILHO} ON public.push_subscriptions; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.push_subscriptions FOR EACH ROW EXECUTE FUNCTION public.push_inscricoes_limite_por_conta()`,
      ],
      [
        "outro gatilho usa a funcao",
        "CREATE TRIGGER prova_outro BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.push_inscricoes_limite_por_conta()",
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
  "consultas 112a/112b nos dois sentidos, com o rol fechado, e cada linha reprova no estrago certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A112), [], "112a no estado DEPOIS");
        assert.ok(
          (await P.consulta(B112)).length >= 1,
          "112b depois do apply devia reprovar a linha de ausencia",
        );
        await antes();
        assert.deepEqual(await P.consulta(B112), [], "112b no estado ANTES");
        assert.equal(
          (await P.consulta(A112)).length,
          3,
          "112a no estado ANTES devia reprovar as 3 linhas do objeto",
        );
        await depois();
        for (const [estrago, linha] of [
          [
            `ALTER TABLE public.push_subscriptions DISABLE TRIGGER ${GATILHO}`,
            /gatilho/,
          ],
          [
            "GRANT EXECUTE ON FUNCTION public.push_inscricoes_limite_por_conta() TO authenticated",
            /atributos|EXECUTE/,
          ],
          [comCorpo(" BEGIN RETURN NEW; END; "), /corpo exato/],
        ]) {
          await P.conexao().query("SAVEPOINT estrago");
          await P.conexao().query(estrago);
          const reprovadas = await P.consulta(A112);
          assert.ok(
            reprovadas.some((i) => linha.test(i)),
            `a 112a nao reprovou a linha certa para '${estrago.slice(0, 50)}': ${JSON.stringify(reprovadas)}`,
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

// ---- CONCORRENCIA, ATOMICIDADE e TRAVA (conexoes proprias, COMMIT de verdade; ficam por ULTIMO e deixam o clone no estado ANTES) --
async function corridaDeDois(c3, corpoMutado) {
  // 9 inscricoes da conta U.conc ja gravadas (commit); a 10a e a 11a chegam juntas em duas conexoes reais
  await c3.query("DELETE FROM public.push_subscriptions WHERE user_id = $1", [
    U.conc,
  ]);
  for (let i = 1; i <= 9; i += 1)
    await c3.query(SQL_NOVO, [ep("conc", i), U.conc]);
  if (corpoMutado) await c3.query(comCorpo(corpoMutado));
  else await c3.query(MIGRATION);
  const url = lerDatabaseUrlEfemera();
  const c1 = new Client({ connectionString: url });
  const c2 = new Client({ connectionString: url });
  await c1.connect();
  await c2.connect();
  try {
    for (const c of [c1, c2]) {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [U.conc]);
      await c.query("SET LOCAL ROLE authenticated");
    }
    await c1.query(SQL_NOVO, [ep("conc", 10), U.conc]); // passa e segura a trava da conta ate o COMMIT
    let terminou = false;
    const p2 = c2.query(SQL_NOVO, [ep("conc", 11), U.conc]).then(
      () => ({ ok: true }),
      (e) => ({ ok: false, e }),
    );
    p2.then(() => {
      terminou = true;
    });
    await new Promise((r) => setTimeout(r, 800));
    const esperouAPrimeira = terminou === false;
    await c1.query("COMMIT");
    const segunda = await p2;
    await c2.query(segunda.ok ? "COMMIT" : "ROLLBACK");
    const n = (
      await c3.query(
        "SELECT count(*)::int AS n FROM public.push_subscriptions WHERE user_id = $1",
        [U.conc],
      )
    ).rows[0].n;
    return {
      esperouAPrimeira,
      segundaOk: segunda.ok,
      codigo: segunda.e?.code,
      n,
    };
  } finally {
    await c1.query("ROLLBACK").catch(() => {});
    await c2.query("ROLLBACK").catch(() => {});
    await c1.end().catch(() => {});
    await c2.end().catch(() => {});
  }
}

prova(
  "CONCORRENCIA: a 10a e a 11a inscricoes da mesma conta, em duas conexoes reais, nao passam as duas (10 no fim); sem a trava por conta passam as duas (11)",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@396000c.teste', '{}'::jsonb) ON CONFLICT (id) DO NOTHING",
        [U.conc],
      );
      const certo = await corridaDeDois(c3, null);
      assert.deepEqual(
        certo,
        { esperouAPrimeira: true, segundaOk: false, codigo: "P0001", n: 10 },
        JSON.stringify(certo),
      );
      const semTrava = CORPO.replace(
        / {4}PERFORM pg_advisory_xact_lock\([^\n]*\n/,
        "",
      );
      assert.notEqual(semTrava, CORPO, "a sabotagem da trava nao mudou nada");
      const mutante = await corridaDeDois(c3, semTrava);
      assert.equal(
        mutante.n,
        11,
        `sem a trava as duas deviam passar: ${JSON.stringify(mutante)}`,
      );
      assert.equal(mutante.segundaOk, true);
      await c3.query(comCorpo(CORPO)); // devolve o corpo certo (o mutante substituiu a funcao com COMMIT)
    } finally {
      await c3.query(comCorpo(CORPO)).catch(() => {});
      await c3
        .query("DELETE FROM public.push_subscriptions WHERE user_id = $1", [
          U.conc,
        ])
        .catch(() => {});
      await c3
        .query("DELETE FROM auth.users WHERE id = $1", [U.conc])
        .catch(() => {});
      await c3.end();
    }
  },
);

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
        /conferencia 20261396000000/,
      );
      assert.equal(
        (await c3.query("SELECT to_regprocedure($1) IS NOT NULL AS f", [FN]))
          .rows[0].f,
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
  "TRAVA: gravacao de inscricao em voo faz a migration falhar limpa no lock_timeout e, depois dela, aplicar",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id) VALUES ('https://push.exemplo.teste/em-voo', 'p', 'a', gen_random_uuid())",
        );
      },
      aplicado,
    });
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("cada-conta-tem-no-maximo-10-aparelhos");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
