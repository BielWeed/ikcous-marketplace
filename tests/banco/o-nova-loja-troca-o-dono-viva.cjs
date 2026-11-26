"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (SONDAS, MUTANTES, os ids das fixtures) ou das linhas do
 * Postgres efêmero; nunca de entrada de rede nem de payload de terceiro. */
/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a consulta 88c e o script do repositório), nunca de entrada de rede. */

/**
 * PROVA VIVA da escrita do trocar-dono do nova-loja (sqlTrocarDono e sqlDaTroca, exportados de
 * scripts/frota/nova-loja.mjs; T4 do plano de fechar a loja nova) contra o Postgres EFÊMERO com as migrations aplicadas
 * do zero (rpc-ci), em banco CLONADO (rodar-isolado). Molde: o-nova-loja-define-o-dono-viva.cjs.
 *
 * O texto vai INTEIRO, como o script o monta, por `client.query(sql)` sem parâmetros: a consulta simples do protocolo,
 * a mesma que o pg-meta da Management API faz (várias instruções numa mensagem só, as linhas do ÚLTIMO comando de volta,
 * o erro como SQLSTATE). Uma conexão nova por requisição (o pg-meta cria e fecha a dele a cada chamada). A sessão da
 * "API" NÃO é superusuário: um papel de prova sem SUPERUSER e sem BYPASSRLS, membro de postgres só com a opção SET (sem
 * herdar nada), entra por SET SESSION AUTHORIZATION. O que ele faz no banco é SÓ o que o `SET LOCAL ROLE postgres` de
 * dentro do texto lhe dá.
 *
 * O QUE SE PROVA:
 *   (0) as fixtures e o controle da sessão: a "API" não é superusuário e só vira postgres pelo SET LOCAL ROLE;
 *   (1) cada recusa IKT01..IKT05 (sem dona; dois donos; e-mail sem conta ou com duas; a dona que não é mais admin; a
 *       nova que não é admin nas duas fontes; e-mail não confirmado; a conferência da 88c sabotada DEPOIS do DELETE e
 *       do INSERT) volta com o SEU SQLSTATE e deixa as quatro tabelas tocadas BYTE A BYTE como estavam (cada linha com
 *       o xmin: nem a mesma linha regravada passa); a leitura (sqlDaTroca + decidirTroca) prevê o mesmo código;
 *   (1b) IKT06 (decisão do sócio de 26/11 ~15h, a coluna `bloqueada` da leitura e a guarda do DO): a conta NOVA banida
 *       (banned_until no futuro) ou apagada (deleted_at) no Auth recusa IKT06 sem gravar nada; a conta que JÁ é a dona,
 *       banida, também recusa IKT06 (a guarda vem antes do ja_era_dona); a DONA DE HOJE banida ou apagada não impede a
 *       troca para uma conta nova sem bloqueio; e-mail com duas contas, as duas banidas, é IKT04 (IKT04 vem antes do
 *       IKT06); banned_until no PASSADO não bloqueia (troca);
 *   (2) `trocada` e depois `ja_era_dona` (o segundo sem escrita nenhuma, xmin igual), a 88c verde antes e depois dos
 *       dois; a nova manda (definir_cargo) e a antiga não manda mais; e-mail em maiúsculas e e-mail com aspa, `$$`,
 *       `$trocar_dono$` e ponto e vírgula chegam inteiros ao banco;
 *   (3) duas trocas SIMULTÂNEAS, em duas conexões presas até as duas esperarem: uma troca, a outra espera e vê a nova
 *       dona (ja_era_dona); nunca 23505, nunca 40P01, sempre UM dono;
 *   (4) a) a dona antiga rebaixa a nova pelo definir_cargo ANTES (a transação dela segura a linha): a troca espera a
 *       linha (FOR SHARE) e recusa IKT02, nada trocado;
 *       b) SONDA do achado A1 (revisão da T1): a troca começa primeiro e o definir_cargo da dona antiga passa as guardas
 *       dele antes do COMMIT da troca. O esperado HOJE é a janela existir (a nova vira dona e é rebaixada logo depois).
 *       A sonda REGISTRA o que aconteceu e NÃO reprova; quando a migration do definir_cargo fechar a janela,
 *       A1_VIRA_TRAVA passa a true e o mesmo caso vira trava;
 *   (5) depois de uma recusa nada fica pendurado no caminho real (conexão por requisição): nenhuma trava, nenhuma sessão
 *       em transação abortada, a troca seguinte roda na hora. Na MESMA conexão (se alguém a reusasse) o Postgres deixa
 *       a transação abortada (25P02, doc 53.2.2.1: a consulta simples para no primeiro erro e o COMMIT do texto não roda)
 *       e ela recusa todo comando até um ROLLBACK, mas NÃO segura trava (o aborto já as soltou: uma troca de outra
 *       conexão roda enquanto ela está abortada); depois do ROLLBACK a conexão volta a servir;
 *   (6) CONTROLES: com o texto do script todas as sondas valem; 15 mutantes textuais do SQL (cada guarda tirada, as
 *       travas, o FOR SHARE, o lower, o SET LOCAL ROLE, a guarda IKT06 tirada, antes da do IKT04, com o ban vencido
 *       contando e olhando também a dona de hoje) reprovam AO MENOS a sonda que cada um declara.
 *
 * LIMITE DECLARADO: no postgres:17 do CI o papel postgres É superusuário; no Supabase não é (é dono das tabelas de
 * public). Esta prova mostra que a sessão de fora não escreve nada sem o SET LOCAL ROLE e que, com ele, o texto faz o
 * que promete; não prova os privilégios do postgres de uma loja real.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-nova-loja-troca-o-dono-viva.cjs
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const RAIZ = path.join(__dirname, "..", "..");
const SCRIPT = path.join(RAIZ, "scripts", "frota", "nova-loja.mjs");
const CONSULTA_88C = fs.readFileSync(
  path.join(
    RAIZ,
    "scripts",
    "publicacao",
    "consultas",
    "88c-conferir-o-dono-cadastrado.sql",
  ),
  "utf8",
);

// O achado A1 (a janela entre a troca e o definir_cargo da dona antiga) é SONDA enquanto isto for false: o caso (4b)
// registra o resultado e não reprova. Quando a migration do definir_cargo fechar a janela, troque para true: o mesmo
// caso passa a exigir a janela FECHADA.
const A1_VIRA_TRAVA = false;

// O papel da sessão da "API" (cluster inteiro: criado no começo e apagado no fim desta prova).
const PAPEL_API = "prova_nova_loja_troca_dono_api";

const U_DONA = "d1565000-0000-4000-8000-000000000001"; // a dona de hoje
const U_NOVA = "d1565000-0000-4000-8000-000000000002"; // a futura dona
const U_SO_PERFIL = "d1565000-0000-4000-8000-000000000003"; // admin só em profiles
const U_SO_LOGIN = "d1565000-0000-4000-8000-000000000004"; // admin só em auth.users
const U_CLI = "d1565000-0000-4000-8000-000000000005"; // cliente
const U_GEMEA = "d1565000-0000-4000-8000-000000000006"; // conta que pega o e-mail de outra (ou um e-mail estranho)
const TODOS = [U_DONA, U_NOVA, U_SO_PERFIL, U_SO_LOGIN, U_CLI, U_GEMEA];
// [auth.users raw_app_meta_data.role, profiles.role]
const ADMIN = ["admin", "admin"];
const SO_PERFIL = ["customer", "admin"];
const SO_LOGIN = ["admin", "customer"];

const EMAIL = (id) => `${id}@troca.teste`;

/** O bloqueio no Auth de cada fixture: [banned_until, deleted_at] (expressões SQL fixas deste arquivo). */
const BLOQUEIOS = {
  nenhum: ["NULL", "NULL"],
  banida: ["now() + interval '1 day'", "NULL"],
  apagada: ["NULL", "now()"],
  ban_vencido: ["now() - interval '1 day'", "NULL"],
};
// Aspa, `$$`, a etiqueta do dollar-quote do DO e ponto e vírgula: tem de chegar INTEIRO ao banco, como um literal só.
const EMAIL_ESTRANHO = "o'brien$$x$trocar_dono$;--@troca.teste";

// A dona de hoje cadastrada e admin nas duas fontes; a nova admin nas duas fontes, e-mail confirmado.
const BASE = Object.freeze({
  papeis: { [U_DONA]: ADMIN, [U_NOVA]: ADMIN },
  dono: U_DONA,
});

let URL_EFEMERA = "";
let sqlTrocarDono;
let sqlDaTroca;
let decidirTroca;
let resultadoDaTroca;
let SIM_;
let NAO_;

/**
 * Deixa o banco (commitado) no estado pedido: todo mundo customer nas duas fontes, com e-mail confirmado, o e-mail
 * padrão e sem bloqueio no Auth, menos o que `papeis`, `semConfirmar`, `emails` e `bloqueio` dizem; dono_da_loja e
 * cargo_log vazios, menos o `dono` (e o `outroDono`, que só cabe com a chave da tabela relaxada). Como o postgres (a
 * automação de confiança): as travas de cargo leem o GUC role, que na sessão de login direto vale none.
 */
async function preparar(
  c,
  {
    papeis = {},
    semConfirmar = [],
    emails = {},
    dono = null,
    outroDono = null,
    bloqueio = {},
  },
) {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE postgres");
    await c.query("DELETE FROM public.cargo_log");
    await c.query("DELETE FROM public.dono_da_loja");
    for (const id of TODOS) {
      const [a, p] = papeis[id] ?? ["customer", "customer"];
      // profiles antes de auth.users: o gatilho de sincronia copia o papel de profiles para auth.users.
      await c.query("UPDATE public.profiles SET role = $2 WHERE id = $1", [
        id,
        p,
      ]);
      const [ban, apagada] = BLOQUEIOS[bloqueio[id] ?? "nenhum"];
      await c.query(
        `UPDATE auth.users
            SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', $2::text),
                email_confirmed_at = CASE WHEN $3::boolean THEN NULL ELSE now() END,
                email = $4,
                banned_until = ${ban},
                deleted_at = ${apagada}
          WHERE id = $1`,
        [id, a, semConfirmar.includes(id), emails[id] ?? EMAIL(id)],
      );
    }
    if (dono) {
      await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
        dono,
      ]);
    }
    if (outroDono) {
      await c.query("INSERT INTO public.dono_da_loja (user_id) VALUES ($1)", [
        outroDono,
      ]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  const f = await foto(c);
  for (const l of f.papeis) {
    const [a, p] = papeis[l.id] ?? ["customer", "customer"];
    const b = bloqueio[l.id] ?? "nenhum";
    assert.deepEqual(
      [l.a, l.p, l.conf, l.email, l.ban, l.del],
      [
        a,
        p,
        !semConfirmar.includes(l.id),
        emails[l.id] ?? EMAIL(l.id),
        b === "banida" || b === "ban_vencido",
        b === "apagada",
      ],
      `a fixture ${l.id} não ficou como pedido`,
    );
  }
  assert.deepEqual(
    [...f.donos].sort(),
    [dono, outroDono].filter(Boolean).sort(),
  );
}

/**
 * O estado legível: as linhas do dono, o papel (nas duas fontes), a confirmação, o e-mail e o bloqueio no Auth de cada
 * fixture, o log.
 */
async function foto(c) {
  const donos = (
    await c.query("SELECT user_id::text AS u FROM public.dono_da_loja")
  ).rows.map((l) => l.u);
  const papeis = (
    await c.query(
      `SELECT u.id::text AS id, u.raw_app_meta_data ->> 'role' AS a, p.role AS p,
              u.email_confirmed_at IS NOT NULL AS conf, u.email,
              u.banned_until IS NOT NULL AS ban, u.deleted_at IS NOT NULL AS del
         FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id = ANY ($1::uuid[]) ORDER BY u.id`,
      [TODOS],
    )
  ).rows;
  const log = (await c.query("SELECT count(*)::int AS n FROM public.cargo_log"))
    .rows[0].n;
  return { donos, papeis, log };
}

/**
 * O dump das quatro tabelas que a troca (ou o definir_cargo) pode tocar, linha a linha como texto, cada uma com o xmin
 * (e o ctid na do dono): igual aqui = byte a byte igual, e nem uma linha regravada com o mesmo valor passa.
 */
async function dump(c) {
  const consultas = {
    dono_da_loja:
      "SELECT d.xmin::text || ' ' || d.ctid::text || ' ' || d::text AS l FROM public.dono_da_loja d ORDER BY d::text",
    profiles:
      "SELECT p.xmin::text || ' ' || p::text AS l FROM public.profiles p ORDER BY p.id",
    users:
      "SELECT u.xmin::text || ' ' || u::text AS l FROM auth.users u ORDER BY u.id",
    cargo_log:
      "SELECT g.xmin::text || ' ' || g::text AS l FROM public.cargo_log g ORDER BY g::text",
  };
  const out = {};
  for (const [nome, sql] of Object.entries(consultas)) {
    out[nome] = (await c.query(sql)).rows.map((l) => l.l);
  }
  return out;
}

/**
 * A "Management API": conexão nova, sessão de papel NÃO-superusuário, o texto inteiro numa consulta simples (sem
 * parâmetros). Devolve as linhas do último comando (e de todos), ou o SQLSTATE do erro. Nunca lança por erro de SQL.
 */
async function pelaApi(sql, nome = "prova_troca_api") {
  const k = new Client({
    connectionString: URL_EFEMERA,
    application_name: nome,
  });
  await k.connect();
  try {
    await k.query(`SET SESSION AUTHORIZATION ${PAPEL_API}`);
    try {
      const r = await k.query(sql);
      const todas = (Array.isArray(r) ? r : [r]).map((x) => x.rows);
      return { ok: true, rows: todas[todas.length - 1], todas };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await k.end().catch(() => {});
  }
}

/** A linha final da escrita: exatamente [{ resultado: "<json>" }]; devolve o JSON lido. */
function resultadoDe(r) {
  assert.ok(r.ok, `a transação falhou: ${r.code} ${r.message}`);
  assert.equal(r.rows.length, 1, "a escrita tem de devolver UMA linha");
  assert.deepEqual(Object.keys(r.rows[0]), ["resultado"]);
  assert.equal(typeof r.rows[0].resultado, "string");
  return JSON.parse(r.rows[0].resultado);
}

const TROCADA = { acao: "trocada", donos: 1, apagadas: 1, linhas: 1 };
const JA_ERA_DONA = { acao: "ja_era_dona", donos: 1, apagadas: 0, linhas: 0 };

/** A 88c executada como está no arquivo (pelo superusuário, que enxerga tudo): item -> ok. */
async function consulta88c(c) {
  const r = await c.query(CONSULTA_88C);
  assert.equal(r.rows.length, 9, "a 88c tem um rol fechado de 9 linhas");
  return Object.fromEntries(r.rows.map((l) => [l.item, l.ok]));
}
const reprovadosNa88c = (itens) =>
  Object.keys(itens)
    .filter((k) => !itens[k])
    .sort();

/** Quem chama definir_cargo como o PostgREST chamaria, na conexão `c` (a transação NÃO é fechada aqui). */
async function comoAutenticada(c, uid) {
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [
      uid,
      JSON.stringify({
        sub: uid,
        role: "authenticated",
        app_metadata: { role: "admin" },
      }),
    ],
  );
}

/** definir_cargo numa transação sempre desfeita: só para ver quem pode. */
async function definirCargoComo(c, uid, alvo, cargo) {
  await c.query("BEGIN");
  try {
    await comoAutenticada(c, uid);
    try {
      const r = await c.query(
        "SELECT public.definir_cargo($1::uuid, $2::text) AS r",
        [alvo, cargo],
      );
      return { ok: true, r: r.rows[0].r };
    } catch (e) {
      return { ok: false, code: e.code, message: e.message };
    }
  } finally {
    await c.query("ROLLBACK");
  }
}

async function esperarTravados(c, nomes, n, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = await c.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ANY ($1::text[]) AND wait_event_type = 'Lock'",
      [nomes],
    );
    if (r.rows[0].n >= n) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

// As fixtures que mexem na FORMA do banco (só neste clone), sempre desfeitas no fim da sonda que as usa.
const relaxarAChaveDoDono = (c) =>
  c.query("ALTER TABLE public.dono_da_loja DROP CONSTRAINT dono_da_loja_pkey");
async function restaurarAChaveDoDono(c) {
  await c.query("DELETE FROM public.dono_da_loja");
  await c.query(
    "ALTER TABLE public.dono_da_loja ADD CONSTRAINT dono_da_loja_pkey PRIMARY KEY (loja)",
  );
}
// Um gatilho de prova que tira o admin da nova em auth.users logo depois do INSERT: a conferência pelo critério da 88c,
// DEPOIS do DELETE e do INSERT, tem de recusar e desfazer os dois (transação interrompida no meio). O WHEN restringe o
// gatilho ao INSERT da NOVA (o da troca): o INSERT da dona de hoje que o preparar faz depois dele não dispara nada.
const sabotarAConferencia = (c) =>
  c.query(`
    CREATE OR REPLACE FUNCTION public.prova_troca_sabota() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = NEW.user_id;
      RETURN NEW;
    END $f$;
    CREATE TRIGGER prova_troca_sabota AFTER INSERT ON public.dono_da_loja
      FOR EACH ROW WHEN (NEW.user_id = '${U_NOVA}'::uuid) EXECUTE FUNCTION public.prova_troca_sabota();`);
const desfazerASabotagem = (c) =>
  c.query(`
    DROP TRIGGER IF EXISTS prova_troca_sabota ON public.dono_da_loja;
    DROP FUNCTION IF EXISTS public.prova_troca_sabota();`);

// ---------------------------------------------------------------------------------------------------------------------
// As sondas: cada uma prepara o estado, manda o texto pela "API" e confere a resposta E o banco depois. Servem ao texto
// do script e a cada mutante (a mesma régua). `gerar(email)` devolve o SQL da escrita (o do script ou o mutante).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Sonda de uma chamada. `espera` (TROCADA ou JA_ERA_DONA) com a `dona` depois, ou `recusa` (SQLSTATE) + `frase` (a
 * mensagem da guarda certa: duas guardas dão IKT05 e duas dão IKT02). Recusa e ja_era_dona = dump byte a byte igual;
 * trocada = só a linha do dono muda. Com `leitura`, a leitura do script (sqlDaTroca + decidirTroca) prevê o mesmo.
 */
const sondaDe =
  ({
    estado,
    email,
    espera = null,
    dona = null,
    recusa = null,
    frase = null,
    leitura = true,
    antes: montar = null,
    depois: desmontar = null,
  }) =>
  async (c, gerar) => {
    if (montar) await montar(c);
    try {
      await preparar(c, estado);
      const antes = await dump(c);
      const lido = leitura
        ? decidirTroca((await c.query(sqlDaTroca(email))).rows)
        : null;
      const r = await pelaApi(gerar(email));
      const depois = await dump(c);
      if (recusa) {
        assert.equal(
          r.ok,
          false,
          `esperava a recusa ${recusa}, veio ${JSON.stringify(r.rows)}`,
        );
        assert.equal(r.code, recusa, r.message);
        if (frase) assert.match(r.message, frase);
        assert.deepEqual(depois, antes, "a recusa mudou alguma linha");
        if (lido) {
          assert.deepEqual(
            [lido.veredito, lido.codigo, lido.gravar],
            [NAO_, recusa, false],
            "a leitura não previu a recusa da escrita",
          );
        }
        return true;
      }
      assert.deepEqual(resultadoDe(r), espera);
      assert.equal(resultadoDaTroca(r.rows), espera.acao);
      if (espera.acao === "ja_era_dona") {
        assert.deepEqual(depois, antes, "ja_era_dona escreveu alguma coisa");
      } else {
        assert.deepEqual(
          { ...depois, dono_da_loja: null },
          { ...antes, dono_da_loja: null },
          "a troca mudou algo além da linha do dono",
        );
        assert.notDeepEqual(depois.dono_da_loja, antes.dono_da_loja);
      }
      assert.deepEqual((await foto(c)).donos, [dona]);
      if (lido) {
        assert.deepEqual(
          [lido.veredito, lido.gravar],
          [SIM_, espera.acao === "trocada"],
          "a leitura não previu o resultado da escrita",
        );
      }
      return true;
    } finally {
      if (desmontar) await desmontar(c);
    }
  };

/**
 * Duas trocas para a MESMA nova ao mesmo tempo, as duas presas (uma terceira conexão segura a linha da nova em profiles
 * com FOR UPDATE) até as duas esperarem uma trava; então a terceira solta. Com as travas do texto a segunda espera a
 * primeira COMITAR e vê a nova dona: {trocada, ja_era_dona}. Sem elas as duas leem a dona antiga, apagam e inserem: a
 * segunda bate na chave (23505).
 */
async function sondaConcorrente(c, gerar) {
  await preparar(c, BASE);
  const sql = gerar(EMAIL(U_NOVA));
  const h = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_troca_trava",
  });
  await h.connect();
  let a;
  let b;
  try {
    await h.query("BEGIN");
    await h.query("SELECT 1 FROM public.profiles WHERE id = $1 FOR UPDATE", [
      U_NOVA,
    ]);
    a = pelaApi(sql, "prova_troca_a");
    b = pelaApi(sql, "prova_troca_b");
    const travados = await esperarTravados(
      c,
      ["prova_troca_a", "prova_troca_b"],
      2,
    );
    await h.query("COMMIT");
    const rs = await Promise.all([a, b]);
    assert.ok(
      travados,
      "as duas trocas não ficaram esperando trava ao mesmo tempo",
    );
    const acoes = rs
      .map((r) =>
        r.ok
          ? (resultadoDaTroca(r.rows) ?? "fora do formato")
          : `erro ${r.code}`,
      )
      .sort();
    assert.deepEqual(acoes, ["ja_era_dona", "trocada"]);
    assert.deepEqual((await foto(c)).donos, [U_NOVA]);
    return true;
  } finally {
    await h.query("ROLLBACK").catch(() => {});
    await h.end().catch(() => {});
    await Promise.allSettled([a, b]);
  }
}

/**
 * (4a) A dona antiga rebaixa a nova pelo definir_cargo e a transação dela ainda não comitou (segura a linha da nova em
 * profiles). A troca começa: tem de ESPERAR a linha (FOR SHARE OF p), e quando o rebaixamento comita ela relê a linha e
 * recusa IKT02. Sem o FOR SHARE a troca lê a nova ainda admin, grava, e o rebaixamento comita depois: dona customer.
 */
async function sondaCargoAntes(c, gerar) {
  await preparar(c, BASE);
  const sql = gerar(EMAIL(U_NOVA));
  const d = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_troca_cargo",
  });
  await d.connect();
  let t;
  try {
    await d.query("BEGIN");
    await comoAutenticada(d, U_DONA);
    const dc = await d.query(
      "SELECT public.definir_cargo($1::uuid, 'customer') AS r",
      [U_NOVA],
    );
    assert.equal(dc.rows[0].r.mudou, true, "o rebaixamento não mudou nada");
    t = pelaApi(sql, "prova_troca_t");
    const esperou = await esperarTravados(c, ["prova_troca_t"], 1, 3000);
    await d.query("COMMIT");
    const rt = await t;
    assert.ok(
      esperou,
      "a troca não esperou a linha da nova que o definir_cargo segurava",
    );
    assert.equal(
      rt.ok,
      false,
      `a troca gravou a nova rebaixada: ${JSON.stringify(rt.rows)}`,
    );
    assert.equal(rt.code, "IKT02", rt.message);
    const f = await foto(c);
    assert.deepEqual(f.donos, [U_DONA], "a dona mudou");
    const nova = f.papeis.find((l) => l.id === U_NOVA);
    assert.deepEqual([nova.a, nova.p], ["customer", "customer"]);
    return true;
  } finally {
    await d.query("ROLLBACK").catch(() => {});
    await d.end().catch(() => {});
    await Promise.allSettled([t]);
  }
}

const SONDAS_DE_RECUSA = {
  sem_dono_IKT01: sondaDe({
    estado: { papeis: { [U_NOVA]: ADMIN } },
    email: EMAIL(U_NOVA),
    recusa: "IKT01",
    frase: /a loja nao tem dono/,
  }),
  dois_donos_IKT05: sondaDe({
    estado: { ...BASE, outroDono: U_CLI },
    email: EMAIL(U_NOVA),
    recusa: "IKT05",
    frase: /mais de um dono/,
    antes: relaxarAChaveDoDono,
    depois: restaurarAChaveDoDono,
  }),
  conta_inexistente_IKT04: sondaDe({
    estado: BASE,
    email: "ninguem@troca.teste",
    recusa: "IKT04",
  }),
  duas_contas_IKT04: sondaDe({
    estado: { ...BASE, emails: { [U_GEMEA]: EMAIL(U_NOVA).toUpperCase() } },
    email: EMAIL(U_NOVA),
    recusa: "IKT04",
  }),
  dona_nao_admin_IKT02: sondaDe({
    estado: { papeis: { [U_NOVA]: ADMIN }, dono: U_DONA },
    email: EMAIL(U_DONA),
    recusa: "IKT02",
    frase: /a dona nao e mais admin/,
  }),
  nova_cliente_IKT02: sondaDe({
    estado: { papeis: { [U_DONA]: ADMIN }, dono: U_DONA },
    email: EMAIL(U_NOVA),
    recusa: "IKT02",
    frase: /a nova nao e admin/,
  }),
  nova_so_em_profiles_IKT02: sondaDe({
    estado: {
      papeis: { [U_DONA]: ADMIN, [U_SO_PERFIL]: SO_PERFIL },
      dono: U_DONA,
    },
    email: EMAIL(U_SO_PERFIL),
    recusa: "IKT02",
    frase: /a nova nao e admin/,
  }),
  nova_so_em_auth_IKT02: sondaDe({
    estado: {
      papeis: { [U_DONA]: ADMIN, [U_SO_LOGIN]: SO_LOGIN },
      dono: U_DONA,
    },
    email: EMAIL(U_SO_LOGIN),
    recusa: "IKT02",
    frase: /a nova nao e admin/,
  }),
  nao_confirmada_IKT03: sondaDe({
    estado: { ...BASE, semConfirmar: [U_NOVA] },
    email: EMAIL(U_NOVA),
    recusa: "IKT03",
  }),
  // A leitura não enxerga o gatilho (ela prevê SIM): só a escrita o dispara, no INSERT da nova.
  conferencia_IKT05: sondaDe({
    estado: BASE,
    email: EMAIL(U_NOVA),
    recusa: "IKT05",
    frase: /conferencia da 88c falhou/,
    leitura: false,
    antes: sabotarAConferencia,
    depois: desfazerASabotagem,
  }),
};

// IKT06 (decisão do sócio, 26/11 ~15h): só a conta do E-MAIL é olhada, logo depois do IKT04 e antes do ja_era_dona.
const SONDAS_DO_BLOQUEIO = {
  nova_banida_IKT06: sondaDe({
    estado: { ...BASE, bloqueio: { [U_NOVA]: "banida" } },
    email: EMAIL(U_NOVA),
    recusa: "IKT06",
    frase: /a conta nova esta banida ou apagada/,
  }),
  nova_apagada_IKT06: sondaDe({
    estado: { ...BASE, bloqueio: { [U_NOVA]: "apagada" } },
    email: EMAIL(U_NOVA),
    recusa: "IKT06",
    frase: /a conta nova esta banida ou apagada/,
  }),
  // A conta que já é a dona (admin nas duas fontes: sem o ban seria ja_era_dona), banida: IKT06, nada gravado.
  ja_era_dona_banida_IKT06: sondaDe({
    estado: { ...BASE, bloqueio: { [U_DONA]: "banida" } },
    email: EMAIL(U_DONA),
    recusa: "IKT06",
    frase: /a conta nova esta banida ou apagada/,
  }),
  // A dona de HOJE bloqueada não impede: a troca para uma conta nova sem bloqueio é aceita.
  dona_atual_banida_troca: sondaDe({
    estado: { ...BASE, bloqueio: { [U_DONA]: "banida" } },
    email: EMAIL(U_NOVA),
    espera: TROCADA,
    dona: U_NOVA,
  }),
  dona_atual_apagada_troca: sondaDe({
    estado: { ...BASE, bloqueio: { [U_DONA]: "apagada" } },
    email: EMAIL(U_NOVA),
    espera: TROCADA,
    dona: U_NOVA,
  }),
  // Duas contas com o e-mail, AS DUAS banidas: dispara IKT04 e IKT06; vale o IKT04 (vem antes).
  duas_contas_banidas_IKT04: sondaDe({
    estado: {
      ...BASE,
      emails: { [U_GEMEA]: EMAIL(U_NOVA).toUpperCase() },
      bloqueio: { [U_NOVA]: "banida", [U_GEMEA]: "banida" },
    },
    email: EMAIL(U_NOVA),
    recusa: "IKT04",
    frase: /nenhuma ou mais de uma conta/,
  }),
  // banned_until no PASSADO: o ban venceu, a conta não está bloqueada.
  ban_vencido_troca: sondaDe({
    estado: { ...BASE, bloqueio: { [U_NOVA]: "ban_vencido" } },
    email: EMAIL(U_NOVA),
    espera: TROCADA,
    dona: U_NOVA,
  }),
};

const SONDAS = {
  ...SONDAS_DE_RECUSA,
  ...SONDAS_DO_BLOQUEIO,
  troca_grava: sondaDe({
    estado: BASE,
    email: EMAIL(U_NOVA),
    espera: TROCADA,
    dona: U_NOVA,
  }),
  ja_era_dona: sondaDe({
    estado: BASE,
    email: EMAIL(U_DONA),
    espera: JA_ERA_DONA,
    dona: U_DONA,
  }),
  email_em_maiusculas: sondaDe({
    estado: BASE,
    email: EMAIL(U_NOVA).toUpperCase(),
    espera: TROCADA,
    dona: U_NOVA,
  }),
  email_com_aspa_e_dollar: sondaDe({
    estado: {
      papeis: { [U_DONA]: ADMIN, [U_GEMEA]: ADMIN },
      dono: U_DONA,
      emails: { [U_GEMEA]: EMAIL_ESTRANHO },
    },
    email: EMAIL_ESTRANHO,
    espera: TROCADA,
    dona: U_GEMEA,
  }),
  concorrente: sondaConcorrente,
  cargo_antes_IKT02: sondaCargoAntes,
};

async function rodarSondas(c, gerar, quais = SONDAS) {
  const out = {};
  for (const [nome, sonda] of Object.entries(quais)) {
    try {
      out[nome] = Boolean(await sonda(c, gerar));
    } catch (_e) {
      out[nome] = false;
    }
  }
  return out;
}
const falhas = (s) =>
  Object.keys(s)
    .filter((k) => !s[k])
    .sort();

function mutar(sql, de, para) {
  assert.equal(
    sql.split(de).length,
    2,
    `o trecho do mutante tem de aparecer UMA vez: ${de.slice(0, 60)}`,
  );
  return sql.replace(de, para);
}
/** O gerador de um mutante: o SQL do script para o e-mail, com UM trecho trocado. */
const mutante = (de, para) => (email) => mutar(sqlTrocarDono(email), de, para);

// Os trechos do DO que os mutantes do IKT06 trocam: o texto exato de sqlTrocarDono (o mutar confere que cada um aparece
// UMA vez, então se o script mudar o mutante quebra alto em vez de virar mutante nulo).
const GUARDA_IKT06 =
  "IF EXISTS (SELECT 1 FROM auth.users u\n              WHERE u.id = v_id AND (u.banned_until > now() OR u.deleted_at IS NOT NULL)) THEN";
const BLOCO_IKT04 =
  "  IF v_contas <> 1 THEN\n    RAISE EXCEPTION 'trocar-dono: nenhuma ou mais de uma conta com o e-mail' USING ERRCODE = 'IKT04';\n  END IF;\n";
const BLOCO_IKT06 = `  SELECT u.id INTO v_id FROM auth.users u WHERE lower(u.email) = v_email;\n  ${GUARDA_IKT06}\n    RAISE EXCEPTION 'trocar-dono: a conta nova esta banida ou apagada' USING ERRCODE = 'IKT06';\n  END IF;\n`;

const MUTANTES = [
  {
    nome: "M1 sem SET LOCAL ROLE postgres (a sessão da API escreveria com o papel dela)",
    reprova: "troca_grava",
    gerar: mutante("SET LOCAL ROLE postgres;\n", ""),
  },
  {
    nome: "M2 sem a guarda da loja sem dona (IKT01)",
    reprova: "sem_dono_IKT01",
    gerar: mutante("IF v_donos = 0 THEN", "IF false THEN"),
  },
  {
    nome: "M3 sem a guarda de mais de um dono (IKT05)",
    reprova: "dois_donos_IKT05",
    gerar: mutante("IF v_donos > 1 THEN", "IF false THEN"),
  },
  {
    nome: "M4 sem a guarda de exatamente uma conta com o e-mail (IKT04)",
    reprova: "conta_inexistente_IKT04",
    gerar: mutante("IF v_contas <> 1 THEN", "IF false THEN"),
  },
  {
    nome: "M5 a dona de hoje conta como ja_era_dona mesmo sem ser admin nas duas fontes",
    reprova: "dona_nao_admin_IKT02",
    gerar: mutante(
      "WHERE u.id = v_id AND p.role = 'admin' AND u.raw_app_meta_data ->> 'role' = 'admin') THEN",
      "WHERE u.id = v_id) THEN",
    ),
  },
  {
    nome: "M6 sem a guarda da nova admin nas duas fontes (IKT02)",
    reprova: "nova_cliente_IKT02",
    gerar: mutante("IF NOT FOUND THEN", "IF false THEN"),
  },
  {
    nome: "M7 sem a guarda do e-mail confirmado (IKT03)",
    reprova: "nao_confirmada_IKT03",
    gerar: mutante("IF NOT v_confirmada THEN", "IF false THEN"),
  },
  {
    nome: "M8 sem a recusa da conferência pelo critério da 88c depois do DELETE e do INSERT",
    reprova: "conferencia_IKT05",
    gerar: mutante(
      "RAISE EXCEPTION 'trocar-dono: conferencia da 88c falhou' USING ERRCODE = 'IKT05';",
      "NULL;",
    ),
  },
  {
    nome: "M9 sem as travas (advisory locks e LOCK TABLE): a segunda troca simultânea bate na chave",
    reprova: "concorrente",
    gerar: mutante(
      "  PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));\n  PERFORM pg_advisory_xact_lock(hashtext('ikcous.definir_dono'));\n  LOCK TABLE public.dono_da_loja IN SHARE ROW EXCLUSIVE MODE;\n",
      "",
    ),
  },
  {
    nome: "M10 sem o lower do e-mail (maiúsculas viram conta inexistente)",
    reprova: "email_em_maiusculas",
    gerar: mutante(
      "v_email text := lower(current_setting('ikcous.trocar_dono_email'));",
      "v_email text := current_setting('ikcous.trocar_dono_email');",
    ),
  },
  {
    nome: "M11 sem o FOR SHARE da linha da nova (o rebaixamento em curso passa por baixo da troca)",
    reprova: "cargo_antes_IKT02",
    gerar: mutante("\n     FOR SHARE OF p;", ";"),
  },
  {
    nome: "M12 sem a guarda IKT06 (a conta nova banida ou apagada no Auth viraria dona)",
    reprova: "nova_banida_IKT06",
    gerar: mutante(GUARDA_IKT06, "IF false THEN"),
  },
  {
    nome: "M13 a guarda IKT06 antes da do IKT04 (duas contas banidas dariam IKT06)",
    reprova: "duas_contas_banidas_IKT04",
    gerar: mutante(BLOCO_IKT04 + BLOCO_IKT06, BLOCO_IKT06 + BLOCO_IKT04),
  },
  {
    nome: "M14 o ban VENCIDO contando como bloqueio (banned_until IS NOT NULL no lugar de > now())",
    reprova: "ban_vencido_troca",
    gerar: mutante(
      "u.banned_until > now() OR u.deleted_at",
      "u.banned_until IS NOT NULL OR u.deleted_at",
    ),
  },
  {
    nome: "M15 a guarda IKT06 olhando também a dona de hoje (a dona bloqueada impediria a troca)",
    reprova: "dona_atual_banida_troca",
    gerar: mutante(
      "WHERE u.id = v_id AND (u.banned_until",
      "WHERE (u.id = v_id OR u.id IN (SELECT d.user_id FROM public.dono_da_loja d)) AND (u.banned_until",
    ),
  },
];

/**
 * (4b) SONDA do achado A1. Uma conexão segura a linha do dono (FOR UPDATE) para a troca parar no DELETE, já com a linha
 * da nova travada FOR SHARE; então a dona antiga chama definir_cargo(nova, 'customer'): as guardas dele (o chamador é
 * dona, a nova não é dona) leem ANTES do COMMIT da troca, e ele para na linha da nova. Solta-se a conexão: a troca
 * comita e o definir_cargo segue. Nunca lança: devolve o que aconteceu.
 */
async function sondaJanelaA1(c) {
  const obs = { janela: null };
  await preparar(c, BASE);
  const h = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_troca_a1_h",
  });
  const d = new Client({
    connectionString: URL_EFEMERA,
    application_name: "prova_troca_a1_cargo",
  });
  await h.connect();
  await d.connect();
  let t;
  let dc;
  try {
    await h.query("BEGIN");
    await h.query("SELECT 1 FROM public.dono_da_loja FOR UPDATE");
    t = pelaApi(sqlTrocarDono(EMAIL(U_NOVA)), "prova_troca_a1_t");
    obs.trocaParouNoDelete = await esperarTravados(c, ["prova_troca_a1_t"], 1);
    await d.query("BEGIN");
    await d.query("SET LOCAL lock_timeout = '15s'");
    await comoAutenticada(d, U_DONA);
    dc = d
      .query("SELECT public.definir_cargo($1::uuid, 'customer') AS r", [U_NOVA])
      .then(
        (r) => ({ ok: true, r: r.rows[0].r }),
        (e) => ({ ok: false, code: e.code, message: e.message }),
      );
    obs.cargoParouNaNova = await esperarTravados(
      c,
      ["prova_troca_a1_cargo"],
      1,
      3000,
    );
    await h.query("ROLLBACK");
    const rt = await t;
    const rdc = await dc;
    await d.query(rdc.ok ? "COMMIT" : "ROLLBACK");
    obs.troca = rt.ok
      ? (resultadoDaTroca(rt.rows) ?? "fora do formato")
      : `erro ${rt.code}`;
    obs.cargo = rdc.ok
      ? `mudou=${rdc.r.mudou} de=${rdc.r.de}`
      : `erro ${rdc.code}`;
    const f = await foto(c);
    obs.donos = f.donos.map((u) =>
      u === U_NOVA ? "nova" : u === U_DONA ? "antiga" : u,
    );
    const nova = f.papeis.find((l) => l.id === U_NOVA);
    obs.papelDaNova = `${nova.a}/${nova.p}`;
    obs.reprovadosNa88c = reprovadosNa88c(await consulta88c(c));
    obs.janela =
      f.donos.length === 1 &&
      f.donos[0] === U_NOVA &&
      !(nova.a === "admin" && nova.p === "admin");
  } catch (e) {
    obs.erro = e.message;
  } finally {
    await h.query("ROLLBACK").catch(() => {});
    await h.end().catch(() => {});
    await Promise.allSettled([t, dc]);
    await d.query("ROLLBACK").catch(() => {});
    await d.end().catch(() => {});
  }
  return obs;
}

/** Nada da troca ficou no servidor: nenhuma trava consultiva neste banco e nenhuma sessão de prova em transação. */
async function nadaPendurado(c, prefixo, ms = 5000) {
  const fim = Date.now() + ms;
  let ultimo = null;
  while (Date.now() < fim) {
    const r = await c.query(
      `SELECT (SELECT count(*)::int FROM pg_locks l
                WHERE l.locktype = 'advisory'
                  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS travas,
              (SELECT count(*)::int FROM pg_stat_activity a
                WHERE a.application_name LIKE $1 AND a.state LIKE 'idle in transaction%') AS penduradas`,
      [`${prefixo}%`],
    );
    ultimo = r.rows[0];
    if (ultimo.travas === 0 && ultimo.penduradas === 0) return ultimo;
    await new Promise((res) => setTimeout(res, 50));
  }
  return ultimo;
}

const PROVAS = [];
const OBSERVACOES = [];

// ---------------------------------------------------------------------------------------------------------------------
// (0) fixtures e o controle da sessão da API
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(0) fixtures (6 pessoas, e-mail confirmado) e a sessão da API: NÃO é superusuário, não escreve em dono_da_loja, e só vira postgres pelo SET LOCAL ROLE",
  corpo: async (c) => {
    // O texto do script é o de uma transação com o papel preso: a forma que esta prova supõe.
    const SQL = sqlTrocarDono(EMAIL(U_NOVA));
    assert.ok(SQL.startsWith("BEGIN ISOLATION LEVEL READ COMMITTED;\n"));
    assert.ok(SQL.includes("\nSET LOCAL ROLE postgres;\n"));
    assert.ok(
      SQL.endsWith(
        "\nCOMMIT;\nSELECT current_setting('ikcous.trocar_dono_resultado', true) AS resultado;",
      ),
    );
    // O clone vem das migrations: nenhum dono e nenhuma admin de outra prova.
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.dono_da_loja"))
        .rows[0].n,
      0,
      "o clone já tinha dono cadastrado",
    );
    assert.equal(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM (SELECT p.id FROM public.profiles p WHERE p.role = 'admin'
             UNION SELECT u.id FROM auth.users u WHERE u.raw_app_meta_data ->> 'role' = 'admin') a`,
        )
      ).rows[0].n,
      0,
      "o clone já tinha admin fora das fixtures",
    );

    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    // O auth.role() REAL (lê o 'role' do JWT), como na prova da migration 20261383000000.
    await c.query(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text $$`);
    // As colunas da plataforma que o SQL lê (o auth.users emulado do provisionar não as tem): a confirmação do e-mail e
    // o bloqueio no Auth (IKT06: banned_until no futuro ou deleted_at preenchido).
    await c.query(
      `ALTER TABLE auth.users
         ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
         ADD COLUMN IF NOT EXISTS banned_until timestamptz,
         ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
    );
    for (const id of TODOS) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data, email_confirmed_at)
         VALUES ($1::uuid, $1::text || '@troca.teste', '{}'::jsonb, now())`,
        [id],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Dona', 'customer'), ($2, 'Nova', 'customer'), ($3, 'So perfil', 'customer'),
         ($4, 'So login', 'customer'), ($5, 'Cliente', 'customer'), ($6, 'Gemea', 'customer')`,
      TODOS,
    );
    await preparar(c, {});

    // O papel da "API": sem superusuário, sem BYPASSRLS, membro de postgres só para o SET (não herda nada dele).
    await c.query(`DROP ROLE IF EXISTS ${PAPEL_API}`);
    await c.query(
      `CREATE ROLE ${PAPEL_API} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    await c.query(
      `GRANT postgres TO ${PAPEL_API} WITH INHERIT FALSE, SET TRUE`,
    );
    const quem = await pelaApi(
      `SELECT current_setting('is_superuser') AS su, session_user::text AS s, current_user::text AS u,
              (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user) AS forte;`,
    );
    assert.ok(quem.ok, quem.message);
    assert.deepEqual(quem.rows, [
      { su: "off", s: PAPEL_API, u: PAPEL_API, forte: false },
    ]);
    // Sem o SET LOCAL ROLE a sessão não lê nem trava a tabela do dono.
    const semPapel = await pelaApi("SELECT count(*) FROM public.dono_da_loja;");
    assert.equal(semPapel.ok, false);
    assert.equal(semPapel.code, "42501", semPapel.message);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (1) as recusas, byte a byte
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(1) cada recusa IKT01..IKT05 (sem dona, dois donos, e-mail sem conta ou com duas, dona sem admin, nova sem admin numa ou nas duas fontes, e-mail não confirmado, conferência da 88c sabotada depois do DELETE e do INSERT) volta com o seu SQLSTATE, as 4 tabelas ficam byte a byte iguais e a leitura prevê o mesmo código",
  corpo: async (c) => {
    const gerar = sqlTrocarDono;
    const s = await rodarSondas(c, gerar, SONDAS_DE_RECUSA);
    // a sonda reprovada roda de novo, agora lançando: a mensagem dela vai para o log
    for (const nome of falhas(s)) await SONDAS_DE_RECUSA[nome](c, gerar);
    assert.deepEqual(falhas(s), [], `sondas reprovadas: ${falhas(s)}`);
    // A fixture que mexe na forma voltou: a chave do dono e nenhum gatilho de prova.
    const forma = await c.query(
      `SELECT (SELECT count(*)::int FROM pg_constraint WHERE conname = 'dono_da_loja_pkey'
                 AND conrelid = 'public.dono_da_loja'::regclass AND contype = 'p') AS chave,
              (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'prova_troca_sabota') AS gatilho`,
    );
    assert.deepEqual(forma.rows[0], { chave: 1, gatilho: 0 });
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (1b) IKT06: a conta bloqueada no Auth (decisão do sócio de 26/11 ~15h)
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(1b) IKT06: a conta nova banida ou apagada no Auth recusa IKT06 sem gravar nada; a que já é a dona, banida, também (antes do ja_era_dona); a dona de hoje banida ou apagada não impede a troca; duas contas banidas com o e-mail = IKT04 (vem antes); ban vencido troca; a leitura prevê cada um",
  corpo: async (c) => {
    const s = await rodarSondas(c, sqlTrocarDono, SONDAS_DO_BLOQUEIO);
    // a sonda reprovada roda de novo, agora lançando: a mensagem dela vai para o log
    for (const nome of falhas(s)) {
      await SONDAS_DO_BLOQUEIO[nome](c, sqlTrocarDono);
    }
    assert.deepEqual(falhas(s), [], `sondas reprovadas: ${falhas(s)}`);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (2) trocada, depois ja_era_dona; a 88c verde nos dois
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(2) `trocada` e depois `ja_era_dona` (sem escrita, xmin igual) com a 88c verde antes e depois dos dois; a nova manda pelo definir_cargo, a antiga não manda mais e segue admin; e-mail em maiúsculas e com aspa/$$/$trocar_dono$/; chegam inteiros",
  corpo: async (c) => {
    await preparar(c, BASE);
    assert.deepEqual(reprovadosNa88c(await consulta88c(c)), []);
    const sql = sqlTrocarDono(EMAIL(U_NOVA));
    const antes = await dump(c);
    const r1 = await pelaApi(sql);
    assert.deepEqual(resultadoDe(r1), TROCADA);
    assert.equal(resultadoDaTroca(r1.rows), "trocada");
    const meio = await dump(c);
    assert.deepEqual(
      { ...meio, dono_da_loja: null },
      { ...antes, dono_da_loja: null },
    );
    const f = await foto(c);
    assert.deepEqual(f.donos, [U_NOVA]);
    const antiga = f.papeis.find((l) => l.id === U_DONA);
    assert.deepEqual(
      [antiga.a, antiga.p],
      ["admin", "admin"],
      "a dona antiga perdeu o cargo de admin na troca",
    );
    assert.deepEqual(reprovadosNa88c(await consulta88c(c)), []);

    const r2 = await pelaApi(sql);
    assert.deepEqual(resultadoDe(r2), JA_ERA_DONA);
    assert.equal(resultadoDaTroca(r2.rows), "ja_era_dona");
    assert.deepEqual(await dump(c), meio, "repetir a troca escreveu");
    assert.deepEqual(reprovadosNa88c(await consulta88c(c)), []);

    // Quem manda agora: a nova nomeia, a antiga recebe 42501.
    const nova = await definirCargoComo(c, U_NOVA, U_CLI, "admin");
    assert.ok(nova.ok, `${nova.code} ${nova.message}`);
    assert.equal(nova.r.mudou, true);
    const velha = await definirCargoComo(c, U_DONA, U_CLI, "admin");
    assert.equal(velha.ok, false, "a dona antiga ainda nomeia");
    assert.equal(velha.code, "42501", velha.message);

    const s = await rodarSondas(c, sqlTrocarDono, {
      troca_grava: SONDAS.troca_grava,
      ja_era_dona: SONDAS.ja_era_dona,
      email_em_maiusculas: SONDAS.email_em_maiusculas,
      email_com_aspa_e_dollar: SONDAS.email_com_aspa_e_dollar,
    });
    for (const nome of falhas(s)) await SONDAS[nome](c, sqlTrocarDono);
    assert.deepEqual(falhas(s), []);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (3) duas trocas simultâneas
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(3) duas trocas SIMULTÂNEAS em duas conexões (presas na linha da nova até as duas esperarem): uma troca, a outra espera e vê a nova dona (ja_era_dona); nunca 23505 nem 40P01; um dono só",
  corpo: async (c) => {
    await sondaConcorrente(c, sqlTrocarDono);
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (4) a troca e o definir_cargo da dona antiga
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(4a) a dona antiga rebaixa a nova pelo definir_cargo ANTES (transação aberta, linha travada): a troca espera a linha, relê e recusa IKT02; a dona continua a antiga",
  corpo: async (c) => {
    await sondaCargoAntes(c, sqlTrocarDono);
  },
});

PROVAS.push({
  nome: `(4b) SONDA do achado A1: a troca primeiro, o definir_cargo da dona antiga passa as guardas antes do COMMIT dela (${A1_VIRA_TRAVA ? "TRAVA: a janela tem de estar fechada" : "registra, não reprova"})`,
  corpo: async (c) => {
    const obs = await sondaJanelaA1(c);
    const texto =
      obs.janela === true
        ? "JANELA ABERTA: a troca gravou a nova dona e o definir_cargo da dona antiga, que leu as guardas antes do COMMIT da troca, a rebaixou logo depois (dono_da_loja aponta para quem não é admin)"
        : obs.janela === false
          ? "JANELA FECHADA: o definir_cargo da dona antiga não rebaixou a nova dona"
          : `INDETERMINADO: ${obs.erro ?? "a sonda não chegou ao fim"}`;
    const linha = `A1 ${texto}. Observado: ${JSON.stringify(obs)}`;
    console.log(`    ${linha}`);
    OBSERVACOES.push(linha);
    if (A1_VIRA_TRAVA) {
      assert.equal(obs.janela, false, linha);
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (5) a conexão depois de uma recusa
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: "(5) depois de uma recusa nada fica pendurado no caminho real (conexão por requisição): nenhuma trava, nenhuma sessão em transação, a troca seguinte roda na hora; numa conexão REUSADA o Postgres deixa a transação abortada (25P02) e ela recusa comandos até um ROLLBACK, sem segurar trava nenhuma (outra conexão troca enquanto isso); depois do ROLLBACK ela volta a servir",
  corpo: async (c) => {
    // (a) o caminho real: o pg-meta abre e fecha uma conexão por requisição.
    await preparar(c, { papeis: { [U_NOVA]: ADMIN } });
    const recusa = await pelaApi(
      sqlTrocarDono(EMAIL(U_NOVA)),
      "prova_troca_recusa",
    );
    assert.equal(recusa.ok, false);
    assert.equal(recusa.code, "IKT01", recusa.message);
    assert.deepEqual(await nadaPendurado(c, "prova_troca_"), {
      travas: 0,
      penduradas: 0,
    });
    await preparar(c, BASE);
    const t0 = Date.now();
    const seguinte = await pelaApi(sqlTrocarDono(EMAIL(U_NOVA)));
    assert.deepEqual(resultadoDe(seguinte), TROCADA);
    assert.ok(
      Date.now() - t0 < 5000,
      "a troca seguinte esperou trava da recusa",
    );

    // (b) a MESMA conexão (o que o passo do comando nunca pode fazer sem ROLLBACK).
    const k = new Client({
      connectionString: URL_EFEMERA,
      application_name: "prova_troca_reusada",
    });
    await k.connect();
    try {
      await k.query(`SET SESSION AUTHORIZATION ${PAPEL_API}`);
      const pid = (await k.query("SELECT pg_backend_pid() AS p")).rows[0].p;
      await preparar(c, { papeis: { [U_NOVA]: ADMIN } });
      let codigo = null;
      try {
        await k.query(sqlTrocarDono(EMAIL(U_NOVA)));
      } catch (e) {
        codigo = e.code;
      }
      assert.equal(codigo, "IKT01");
      let depois = "ok";
      try {
        await k.query("SELECT 1");
      } catch (e) {
        depois = e.code;
      }
      const presas = async () =>
        (
          await c.query(
            `SELECT count(*) FILTER (WHERE l.locktype = 'advisory')::int AS consultivas,
                    count(*) FILTER (WHERE l.locktype = 'relation' AND l.relation = 'public.dono_da_loja'::regclass
                                       AND l.mode = 'ShareRowExclusiveLock')::int AS tabela
               FROM pg_locks l WHERE l.pid = $1 AND l.granted`,
            [pid],
          )
        ).rows[0];
      const durante = await presas();
      OBSERVACOES.push(
        `(5b) conexão reusada depois de IKT01: a consulta seguinte deu ${depois}; travas da conexão abortada ${JSON.stringify(durante)}`,
      );
      assert.equal(
        depois,
        "25P02",
        "a consulta simples parou no erro e deixou a transação abortada (doc 53.2.2.1)",
      );
      // O aborto (AbortTransaction) já soltou as travas da transação, as consultivas inclusive: o 25P02 é o único efeito.
      assert.deepEqual(durante, { consultivas: 0, tabela: 0 });
      // A prova de que ela não segura nada: outra conexão troca a dona enquanto esta continua abortada.
      await preparar(c, BASE);
      assert.deepEqual(
        resultadoDe(await pelaApi(sqlTrocarDono(EMAIL(U_NOVA)))),
        TROCADA,
      );
      await k.query("ROLLBACK");
      assert.deepEqual((await k.query("SELECT 1 AS um")).rows, [{ um: 1 }]);
      assert.deepEqual(await presas(), { consultivas: 0, tabela: 0 });
      await preparar(c, BASE);
      const r = await k.query(sqlTrocarDono(EMAIL(U_NOVA)));
      const todas = (Array.isArray(r) ? r : [r]).map((x) => x.rows);
      assert.equal(resultadoDaTroca(todas[todas.length - 1]), "trocada");
    } finally {
      await k.query("ROLLBACK").catch(() => {});
      await k.end().catch(() => {});
    }
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// (6) os controles: cada guarda tirada reprova a sua sonda
// ---------------------------------------------------------------------------------------------------------------------
PROVAS.push({
  nome: `(6) ${MUTANTES.length} mutantes textuais do SQL (sem SET LOCAL ROLE, sem cada guarda, sem as travas, sem o FOR SHARE, sem o lower, sem o IKT06, o IKT06 antes do IKT04, o ban vencido contando, a dona de hoje olhada) reprovam AO MENOS a sonda que declaram`,
  corpo: async (c) => {
    for (const m of MUTANTES) {
      const s = await rodarSondas(c, m.gerar);
      assert.ok(
        falhas(s).includes(m.reprova),
        `${m.nome}: a sonda ${m.reprova} deveria reprovar, falhas = ${falhas(s).join(",") || "(nenhuma)"}`,
      );
    }
    // M1 em detalhe: a sessão da API sem o SET LOCAL ROLE é recusada por permissão e nada fica gravado.
    await preparar(c, BASE);
    const antes = await dump(c);
    const r = await pelaApi(MUTANTES[0].gerar(EMAIL(U_NOVA)));
    assert.equal(r.ok, false);
    assert.equal(r.code, "42501", r.message);
    assert.deepEqual(await dump(c), antes);
  },
});

async function main() {
  URL_EFEMERA = lerDatabaseUrlEfemera();
  const m = await import(pathToFileURL(SCRIPT).href);
  ({ sqlTrocarDono, sqlDaTroca, decidirTroca, resultadoDaTroca } = m);
  SIM_ = m.SIM;
  NAO_ = m.NAO;
  for (const [nome, f] of Object.entries({
    sqlTrocarDono,
    sqlDaTroca,
    decidirTroca,
    resultadoDaTroca,
  })) {
    assert.equal(typeof f, "function", `${nome} não é exportada`);
  }
  const cliente = new Client({ connectionString: URL_EFEMERA });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva: o nova-loja troca o dono da loja (rpc-ci)";
  let falhou = false;
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        falhou = true;
        break;
      }
    }
  } finally {
    await cliente.query(`DROP ROLE IF EXISTS ${PAPEL_API}`).catch(() => {});
    await cliente.end().catch(() => {});
  }
  const observado = OBSERVACOES.length
    ? `\n\n**Observado (não reprova):**\n${OBSERVACOES.map((o) => `- ${o}`).join("\n")}`
    : "";
  if (falhou) {
    anexarAoSummary(titulo, `${linhas.join("\n")}${observado}`);
    falhar("FALHOU", "Uma regra do trocar-dono foi quebrada — ver acima qual.");
  }
  console.log(
    `\n[trocar-dono] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}${observado}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
