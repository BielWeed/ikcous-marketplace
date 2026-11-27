"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do próprio teste (os nomes das consultas 194a/194b); os únicos caminhos de arquivo são os da
 * migration 20261570, dos rollbacks dela e das consultas 194a/194b, dentro do repositório. */
/**
 * PROVA VIVA da migration 20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real).
 *
 * O DEFEITO: quando uma loja troca de endereço, o endereço antigo (link no Instagram, favorito, app instalado) fica para sempre em
 * "manutenção", porque a caderneta só conhece o endereço principal. A tabela nova public.frota_enderecos_que_encaminham guarda os
 * endereços que encaminham para a loja (a loja, não o destino: o 308 sempre lê o endereço atual).
 *
 * O QUE SE PROVA:
 *   (a) a tabela: existe, fechada (RLS ligada, nenhuma política, nenhum privilégio para PUBLIC, anon, authenticated nem service_role,
 *       nem em coluna); o gatilho recusa host que já é o endereço principal de alguma loja; o CHECK de formato do host e o de motivo;
 *       apagar a loja apaga os endereços dela;
 *   (b) reaplicar (LF, CRLF, LF) não muda catálogo nem linha;
 *   (c) o arquivo não tem BEGIN/COMMIT de nível superior, e aplicar dentro de uma transação desfeita não deixa nada;
 *   (d) o pré-voo recusa sem a 20261490 (e com a tabela de outra forma), sem escrever; o destrutivo exige a confirmação;
 *   (e) a porta de leitura resolver_encaminhamento, como anon (o PostgREST): chave errada, NULL ou vazia = zero linhas; a chave certa
 *       devolve o endereço ATUAL da loja (duas mudanças seguidas não viram corrente); o host principal e a loja com ativa = false dão
 *       zero linhas; transação só de leitura responde sem gravar; só o anon executa; o bloco da chave é, texto por texto, o da v2;
 *   (f) o rollback comum (2x) tira as funções e preserva a tabela com as linhas, também depois do apply com CRLF; recusa corpo
 *       divergente; o destrutivo exige o comum;
 *   (g) a porta de troca frota_trocar_dominio (só o dono executa): as três escritas numa transação (o preparado sai da tabela, vira o
 *       principal, o principal antigo entra com motivo antigo); cada recusa sem escrever nada (validade vencida ou maior que 1 h, de
 *       diferente do atual, para que não é apelido desta loja — nem de outra —, de = para, host malformado, motivo vazio, loja que não
 *       existe); a troca invertida volta o roteamento ao de antes; uma falha no meio desfaz tudo;
 *   (h) duas conexões: duas trocas iguais ao mesmo tempo — a segunda espera a primeira e é recusada pelo endereço já trocado;
 *   (i) consultas 194a/194b EXECUTADAS no catálogo real (como authenticated, sem privilégio de tabela): depois do apply, depois do comum e
 *       depois do destrutivo, e com defeitos plantados — cada uma reprova exatamente o item certo.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-endereco-antigo-encaminha-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const {
  desfazerChaveSemBcryptNaTransacao,
} = require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs");
const {
  ENDERECO_ANTIGO,
  desfazerEnderecoAntigoNaTransacao,
} = require("./o-endereco-antigo-encaminha-posterior.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = ENDERECO_ANTIGO.nome;
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);

const TABELA = "public.frota_enderecos_que_encaminham";
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A194 = "194a-conferir-o-endereco-antigo-encaminha-aplicado";
const B194 = "194b-antes-o-endereco-antigo-encaminha-ausente";
const LEITURA = "public.resolver_encaminhamento(text, text)";
const TROCA =
  "public.frota_trocar_dominio(text, text, text, text, text, timestamptz)";
const SQL_TROCA =
  "SELECT * FROM public.frota_trocar_dominio($1, $2, $3, $4, $5, now() + $6::interval)";
const V2 = "public.resolver_loja_com_estado(text, text)";
const CHAVE = "chave-da-prova-1570";
const SEM_ATALHO = { hash_rapido: null, hash_rapido_de: null };
const PAPEIS = ["anon", "authenticated", "service_role"];
const LOJA_A = {
  id: "l1570-a",
  nome: "Loja A da prova 1570",
  dominio_publico: "loja-a.l1570.teste",
  project_ref: "aaaaaaaaaaaaaaaa1570",
};
const LOJA_B = {
  id: "l1570-b",
  nome: "Loja B da prova 1570",
  dominio_publico: "loja-b.l1570.teste",
  project_ref: "bbbbbbbbbbbbbbbb1570",
};

// ---------------------------------------------------------------------------
// apoio
// ---------------------------------------------------------------------------
let contaSavepoint = 0;
/** Roda `fn` num SAVEPOINT sempre desfeito; devolve o erro (ou null). */
async function tentar(c, fn) {
  const sp = `sp_1570_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `fn` numa transação SEMPRE desfeita. */
async function desfeita(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function semente(c) {
  for (const l of [LOJA_A, LOJA_B])
    await c.query(
      "INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (id) DO NOTHING",
      [
        l.id,
        l.nome,
        l.dominio_publico,
        l.project_ref,
        `https://${l.project_ref}.supabase.co`,
        `pk_${l.id}`,
      ],
    );
}
/** O segredo da frota com a CHAVE (bcrypt custo 4: o custo não muda o que se prova), sem o atalho da 20261490. */
async function segredo(c) {
  await c.query(
    "INSERT INTO public.frota_segredo (id, hash) VALUES (1, extensions.crypt($1, extensions.gen_salt('bf', 4))) ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash",
    [CHAVE],
  );
  await c.query(
    "UPDATE public.frota_segredo SET hash_rapido = NULL, hash_rapido_de = NULL WHERE id = 1",
  );
}
const atalho = async (c) =>
  (
    await c.query(
      "SELECT hash_rapido, hash_rapido_de FROM public.frota_segredo WHERE id = 1",
    )
  ).rows[0];
/** Chama a porta de leitura como anon (o PostgREST); o que ela grava FICA na transação do chamador. */
async function comoAnon(c, host, chave) {
  const sp = `sp_1570_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    await c.query("SET LOCAL ROLE anon");
    const linhas = (
      await c.query("SELECT * FROM public.resolver_encaminhamento($1, $2)", [
        host,
        chave,
      ])
    ).rows;
    await c.query("RESET ROLE");
    await c.query(`RELEASE SAVEPOINT ${sp}`);
    return linhas;
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
    throw e;
  }
}
const destinos = (linhas) => linhas.map((l) => l.destino);
const prosrc = async (c, fn) =>
  (
    await c.query(
      "SELECT replace(prosrc, E'\\r', '') AS s FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.s ?? null;
const FIM_DO_BLOCO_DA_CHAVE = "\n  END IF;\n";
/** O começo do corpo até o END IF de nível 1 que fecha a conferência da chave (os de dentro têm 4 ou 6 espaços). */
function blocoDaChave(corpo) {
  const i = corpo.indexOf(FIM_DO_BLOCO_DA_CHAVE);
  assert(i > 0, "o corpo tem o END IF que fecha a conferência da chave");
  return corpo.slice(0, i + FIM_DO_BLOCO_DA_CHAVE.length);
}
const encaminhar = (c, host, lojaId, motivo = "antigo") =>
  c.query(`INSERT INTO ${TABELA} (host, loja_id, motivo) VALUES ($1, $2, $3)`, [
    host,
    lojaId,
    motivo,
  ]);
const enderecos = async (c) =>
  (
    await c.query(
      `SELECT host, loja_id, motivo, quem FROM ${TABELA} ORDER BY host`,
    )
  ).rows;
const existe = async (c) =>
  (await c.query("SELECT to_regclass($1) IS NOT NULL AS sim", [TABELA])).rows[0]
    .sim;
/** O catálogo do que a migration cria e do que ela não pode tocar (frota_lojas). */
async function foto(c) {
  const r = await c.query(
    `SELECT c.relname, c.oid::int AS oid, c.relowner::int AS dono, c.relacl::text AS acl, c.relrowsecurity, c.relforcerowsecurity,
            (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(a.attacl::text, '-'), ',' ORDER BY a.attnum)
               FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
            (SELECT string_agg(k.conname || '=' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid = c.oid) AS restricoes,
            (SELECT string_agg(t.tgname || ':' || t.tgfoid::int || ':' || t.tgtype || ':' || t.tgenabled::text, ',' ORDER BY t.tgname)
               FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS gatilhos,
            (SELECT string_agg(i.indexrelid::int::text, ',' ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid = c.oid) AS indices,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
       FROM pg_class c WHERE c.oid IN ('public.frota_lojas'::regclass, to_regclass('${TABELA}')) ORDER BY 1`,
  );
  const fn = await c.query(
    `SELECT p.proname, p.oid::int AS oid, md5(replace(p.prosrc, E'\\r', '')) AS h, p.proacl::text AS acl, p.proowner::int AS dono,
            p.prosecdef, p.provolatile, p.proconfig::text AS config
       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('frota_enderecos_que_encaminham_nao_e_principal', 'resolver_encaminhamento', 'frota_trocar_dominio') ORDER BY 1`,
  );
  return { tb: r.rows, fn: fn.rows };
}

// ---------------------------------------------------------------------------
// (a) a tabela
// ---------------------------------------------------------------------------
async function tabela(c) {
  assert.equal(await existe(c), true, "a tabela existe");
  const cat = (
    await c.query(
      "SELECT relrowsecurity, (SELECT count(*)::int FROM pg_policy WHERE polrelid = c.oid) AS politicas FROM pg_class c WHERE c.oid = $1::regclass",
      [TABELA],
    )
  ).rows[0];
  assert.deepEqual(
    cat,
    { relrowsecurity: true, politicas: 0 },
    "RLS ligada e nenhuma política",
  );
  // Nenhum privilégio para PUBLIC (o grantee 0 do ACL) nem para os três papéis da API, na tabela e em coluna.
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g WHERE c.oid = $1::regclass AND g.grantee <> c.relowner",
        [TABELA],
      )
    ).rows[0].n,
    0,
    "a ACL da tabela é só do dono",
  );
  for (const papel of PAPEIS) {
    for (const p of [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER",
    ])
      assert.equal(
        (
          await c.query(
            "SELECT has_table_privilege($1::name, $2::regclass, $3::text) AS x",
            [papel, TABELA, p],
          )
        ).rows[0].x,
        false,
        `${papel} sem ${p} na tabela`,
      );
    assert.equal(
      (
        await c.query(
          "SELECT has_any_column_privilege($1::name, $2::regclass, 'SELECT, INSERT, UPDATE, REFERENCES') AS x",
          [papel, TABELA],
        )
      ).rows[0].x,
      false,
      `${papel} sem privilégio em coluna`,
    );
  }
  // Como anon (o PostgREST): nem ler.
  const e = await tentar(c, async () => {
    await c.query("SET LOCAL ROLE anon");
    await c.query(`SELECT * FROM ${TABELA}`);
  });
  assert.equal(e?.code, "42501", "anon não lê a tabela");

  await semente(c);
  // O caminho feliz: um endereço antigo e um www da loja A; quem = session_user.
  await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id, "antigo");
  await encaminhar(c, "www.loja-a.l1570.teste", LOJA_A.id, "www");
  await encaminhar(c, "novo-a.l1570.teste", LOJA_A.id, "novo-em-preparo");
  const quem = (await c.query("SELECT session_user::text AS q")).rows[0].q;
  assert.deepEqual(
    await enderecos(c),
    [
      {
        host: "antigo-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "antigo",
        quem,
      },
      {
        host: "novo-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "novo-em-preparo",
        quem,
      },
      {
        host: "www.loja-a.l1570.teste",
        loja_id: LOJA_A.id,
        motivo: "www",
        quem,
      },
    ],
    "três endereços gravados, quem = session_user",
  );

  // O gatilho: o endereço principal de QUALQUER loja não encaminha (nem como alias da própria loja nem de outra).
  for (const [rotulo, host, loja] of [
    ["o principal da própria loja", LOJA_A.dominio_publico, LOJA_A.id],
    ["o principal de outra loja", LOJA_B.dominio_publico, LOJA_A.id],
  ]) {
    const erro = await tentar(c, () => encaminhar(c, host, loja));
    assert.match(
      erro?.message ?? "(gravou)",
      /FROTA_ENDERECO_JA_E_PRINCIPAL/,
      `o gatilho recusa ${rotulo}`,
    );
  }
  // ... também quando o host muda por UPDATE.
  const erroUpdate = await tentar(c, () =>
    c.query(`UPDATE ${TABELA} SET host = $1 WHERE host = $2`, [
      LOJA_B.dominio_publico,
      "antigo-a.l1570.teste",
    ]),
  );
  assert.match(
    erroUpdate?.message ?? "(gravou)",
    /FROTA_ENDERECO_JA_E_PRINCIPAL/,
    "o gatilho recusa UPDATE para o principal de outra loja",
  );
  // Controle: UPDATE de outra coluna não esbarra no gatilho.
  assert.equal(
    await tentar(c, () =>
      c.query(`UPDATE ${TABELA} SET motivo = 'antigo' WHERE host = $1`, [
        "novo-a.l1570.teste",
      ]),
    ),
    null,
    "UPDATE do motivo passa",
  );

  // O CHECK de formato (o mesmo de frota_lojas.dominio_publico) e o de motivo.
  for (const host of [
    "Maiuscula.l1570.teste",
    "sem-ponto",
    "com espaco.l1570.teste",
    "-hifen.l1570.teste",
    "porta.l1570.teste:8080",
    "barra.l1570.teste/x",
    "",
  ]) {
    const erro = await tentar(c, () => encaminhar(c, host, LOJA_B.id));
    assert.equal(erro?.code, "23514", `o CHECK de formato recusa "${host}"`);
    assert.match(erro.message, /frota_enderecos_que_encaminham_host_check/);
  }
  for (const motivo of ["", "Antigo", "principal", null]) {
    const erro = await tentar(c, () =>
      encaminhar(c, "motivo.l1570.teste", LOJA_B.id, motivo),
    );
    assert.equal(
      erro?.code,
      motivo === null ? "23502" : "23514",
      `motivo ${JSON.stringify(motivo)} recusado`,
    );
  }
  // Host repetido (a chave) e loja que não existe.
  assert.equal(
    (await tentar(c, () => encaminhar(c, "antigo-a.l1570.teste", LOJA_B.id)))
      ?.code,
    "23505",
    "o mesmo host não encaminha para duas lojas",
  );
  assert.equal(
    (await tentar(c, () => encaminhar(c, "orfao.l1570.teste", "nao-existe")))
      ?.code,
    "23503",
    "endereço de loja que não existe é recusado",
  );

  // Apagar a loja apaga os endereços dela (e só os dela).
  await encaminhar(c, "antigo-b.l1570.teste", LOJA_B.id);
  await c.query("DELETE FROM public.frota_lojas WHERE id = $1", [LOJA_A.id]);
  assert.deepEqual(
    (await enderecos(c)).map((r) => [r.host, r.loja_id]),
    [["antigo-b.l1570.teste", LOJA_B.id]],
    "apagar a loja A apaga os endereços dela; os da B ficam",
  );
}

// ---------------------------------------------------------------------------
// (b) reaplicar
// ---------------------------------------------------------------------------
async function reaplicar(c) {
  await desfeita(c, async () => {
    await semente(c);
    await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id);
    const antes = await foto(c);
    const linhas = await enderecos(c);
    await c.query(MIGRATION);
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    await c.query(MIGRATION);
    assert.deepEqual(
      await foto(c),
      antes,
      "reaplicar (LF, CRLF, LF) não muda tabela, gatilho, função nem frota_lojas",
    );
    assert.deepEqual(await enderecos(c), linhas, "reaplicar não toca linha");
  });
}

// ---------------------------------------------------------------------------
// (c) transação
// ---------------------------------------------------------------------------
async function transacao(c) {
  // O texto: nenhum BEGIN/COMMIT/ROLLBACK/END/START TRANSACTION de nível superior. Fora os comentários e os corpos entre $tag$ (o
  // BEGIN/END de um bloco DO ou de uma função é plpgsql, não controle de transação), nenhuma dessas palavras pode sobrar.
  const nivelSuperior = (sql) =>
    sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\$([A-Za-z_0-9]*)\$[\s\S]*?\$\1\$/g, " ");
  for (const [rotulo, sql] of [
    ["migration", MIGRATION],
    ["destrutivo", DESTRUTIVO],
  ])
    assert.equal(
      /\b(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(
        nivelSuperior(sql),
      ),
      false,
      `${rotulo} sem BEGIN/COMMIT de nível superior`,
    );
  // Controle do detector: um COMMIT de nível superior plantado é visto.
  assert.equal(
    /\b(BEGIN|COMMIT|ROLLBACK|END|START\s+TRANSACTION)\b/i.test(
      nivelSuperior(`${MIGRATION}\nCOMMIT;\n`),
    ),
    true,
    "controle: o detector vê um COMMIT plantado",
  );
  // O comportamento: aplicar numa transação desfeita, a partir da base de antes, não deixa nada.
  await desfeita(c, async () => {
    await desfazerEnderecoAntigoNaTransacao(c);
    await c.query("SAVEPOINT antes_1570");
    const antes = await foto(c);
    await c.query(MIGRATION);
    assert.equal(await existe(c), true, "a migration criou a tabela");
    await c.query("ROLLBACK TO SAVEPOINT antes_1570");
    assert.deepEqual(
      await foto(c),
      antes,
      "aplicar e desfazer não deixa nada: não há COMMIT dentro da migration",
    );
  });
}

// ---------------------------------------------------------------------------
// (d) pré-voo e destrutivo
// ---------------------------------------------------------------------------
async function preVoo(c) {
  await desfeita(c, async () => {
    // A base de antes desta migration.
    assert.equal(
      await desfazerEnderecoAntigoNaTransacao(c),
      true,
      "a migration estava no ar",
    );
    assert.equal(await existe(c), false, "o destrutivo tirou a tabela");
    const base = await foto(c);
    const sabotagens = [
      [
        "a 20261490 ausente (rollback comum e destrutivo dela)",
        async () => {
          assert.equal(await desfazerChaveSemBcryptNaTransacao(c), true);
        },
      ],
      [
        "a tabela já existe com outra forma",
        () =>
          c.query(
            `CREATE TABLE ${TABELA} (host text PRIMARY KEY, loja_id text, motivo text, criado_em timestamptz, quem text)`,
          ),
      ],
      [
        "a tabela já existe aberta ao anon",
        async () => {
          await c.query(MIGRATION);
          await c.query(`GRANT SELECT ON ${TABELA} TO anon`);
        },
      ],
      [
        "a função do gatilho existe com outro corpo",
        () =>
          c.query(
            "CREATE FUNCTION public.frota_enderecos_que_encaminham_nao_e_principal() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN NEW; END $f$",
          ),
      ],
      [
        "a porta de leitura já existe com outro corpo",
        () =>
          c.query(
            "CREATE FUNCTION public.resolver_encaminhamento(p_host text, p_chave text) RETURNS TABLE (destino text) LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
          ),
      ],
      [
        "a porta de troca já existe com outro corpo",
        () =>
          c.query(
            "CREATE FUNCTION public.frota_trocar_dominio(p_id text, p_ref text, p_de text, p_para text, p_motivo text, p_valido_ate timestamptz) RETURNS TABLE (id text, nome text, dominio_publico text, dominio_anterior text) LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
          ),
      ],
      [
        "a porta de troca aberta ao service_role (reaplicação)",
        async () => {
          await c.query(MIGRATION);
          await c.query(
            "GRANT EXECUTE ON FUNCTION public.frota_trocar_dominio(text, text, text, text, text, timestamptz) TO service_role",
          );
        },
      ],
      [
        "a porta de leitura aberta ao authenticated (reaplicação)",
        async () => {
          await c.query(MIGRATION);
          await c.query(
            "GRANT EXECUTE ON FUNCTION public.resolver_encaminhamento(text, text) TO authenticated",
          );
        },
      ],
      [
        "frota_lojas ausente",
        () => c.query("DROP TABLE public.frota_lojas CASCADE"),
      ],
    ];
    for (const [nome, sabotar] of sabotagens) {
      const e = await tentar(c, async () => {
        await sabotar();
        await c.query(MIGRATION);
      });
      assert.match(
        e?.message ?? "(aplicou)",
        /B1_BASELINE_DIVERGENT/,
        `pré-voo deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base, "nenhuma recusa escreveu nada");
    assert.equal(
      await tentar(c, () => c.query(MIGRATION)),
      null,
      "controle: sem sabotagem, a mesma base aplica",
    );
  });
  // O destrutivo (depois do comum): sem a confirmação recusa; com a tabela com linha recusa sem a segunda confirmação; com as duas
  // apaga, 2x.
  await desfeita(c, async () => {
    await semente(c);
    await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id);
    await c.query(ROLLBACK);
    let e = await tentar(c, () => c.query(DESTRUTIVO));
    assert.match(
      e?.message ?? "(apagou)",
      /ENDERECOS_QUE_ENCAMINHAM_SO_COM_O_DONO/,
      "destrutivo sem confirmação",
    );
    e = await tentar(c, async () => {
      await c.query(
        "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      );
      await c.query(DESTRUTIVO);
    });
    assert.match(
      e?.message ?? "(apagou)",
      /CADERNETA_SEMEADA/,
      "destrutivo com endereço gravado e sem a confirmação da caderneta",
    );
    assert.equal((await enderecos(c)).length, 1, "a recusa não apagou nada");
    await c.query(
      "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
    );
    await c.query("SET LOCAL ikcous.apagar_caderneta = 'sim'");
    await c.query(DESTRUTIVO);
    await c.query(DESTRUTIVO);
    assert.equal(await existe(c), false, "o destrutivo tira a tabela");
    assert.equal(
      (await foto(c)).fn.length,
      0,
      "o destrutivo tira a função do gatilho",
    );
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.frota_lojas"))
        .rows[0].n >= 2,
      true,
      "as lojas ficam",
    );
    await c.query(MIGRATION);
    assert.equal(await existe(c), true, "reaplicar depois do destrutivo");
    assert.deepEqual(await enderecos(c), [], "a tabela recomeça vazia");
  });
}

// ---------------------------------------------------------------------------
// (e) a porta de leitura
// ---------------------------------------------------------------------------
async function portaDeLeitura(c) {
  await semente(c);
  await segredo(c);
  await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id, "antigo");
  await encaminhar(c, "www.loja-a.l1570.teste", LOJA_A.id, "www");

  // Catálogo: só o anon executa (nem PUBLIC, nem authenticated, nem service_role); SECURITY DEFINER, search_path vazio, volátil.
  const cat = (
    await c.query(
      `SELECT p.prosecdef, p.provolatile, p.proconfig::text AS config, pg_get_function_result(p.oid) AS r,
              (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee = 0) AS publico,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [LEITURA],
    )
  ).rows[0];
  assert.deepEqual(
    cat,
    {
      prosecdef: true,
      provolatile: "v",
      config: '{"search_path=\\"\\""}',
      r: "TABLE(destino text)",
      publico: 0,
      anon: true,
      autenticado: false,
      servico: false,
    },
    "catálogo da porta de leitura: SECURITY DEFINER, volátil, search_path vazio, só o anon executa",
  );

  // O bloco da chave é, texto por texto, o da v2 (os dois corpos VIVOS): as duas portas não se afastam.
  const bloco = blocoDaChave(await prosrc(c, LEITURA));
  assert.equal(
    bloco,
    blocoDaChave(await prosrc(c, V2)),
    "o bloco da chave é igual, letra por letra, ao de resolver_loja_com_estado",
  );
  assert.match(bloco, /extensions\.crypt\(p_chave, v_hash\)/);
  assert.match(bloco, /FOR UPDATE SKIP LOCKED/);

  // Chave errada, NULL e vazia: zero linhas, sem erro, nada gravado.
  for (const [rotulo, chave] of [
    ["errada", "errada"],
    ["NULL", null],
    ["vazia", ""],
  ]) {
    assert.deepEqual(
      await comoAnon(c, "antigo-a.l1570.teste", chave),
      [],
      `chave ${rotulo}: zero linhas`,
    );
    assert.deepEqual(
      await atalho(c),
      SEM_ATALHO,
      `chave ${rotulo}: nada gravado`,
    );
  }

  // Transação só de leitura (GET do PostgREST, réplica): a chave certa resolve e NÃO grava o atalho.
  let lido = null;
  let gravado = null;
  const eLeitura = await tentar(c, async () => {
    await c.query("SET LOCAL transaction_read_only = on");
    await c.query("SET LOCAL ROLE anon");
    lido = (
      await c.query("SELECT * FROM public.resolver_encaminhamento($1, $2)", [
        "antigo-a.l1570.teste",
        CHAVE,
      ])
    ).rows;
    await c.query("RESET ROLE");
    gravado = await atalho(c);
  });
  assert.equal(eLeitura?.message ?? "ok", "ok", "só leitura: sem erro");
  assert.deepEqual(
    destinos(lido),
    [LOJA_A.dominio_publico],
    "só leitura: a chave certa resolve",
  );
  assert.deepEqual(gravado, SEM_ATALHO, "só leitura: o atalho não é gravado");

  // A chave certa: o endereço ATUAL da loja; o www também; host em maiúsculas resolve igual (o porteiro manda como chega).
  assert.deepEqual(
    destinos(await comoAnon(c, "antigo-a.l1570.teste", CHAVE)),
    [LOJA_A.dominio_publico],
    "o endereço antigo devolve o principal atual",
  );
  assert.notDeepEqual(
    await atalho(c),
    SEM_ATALHO,
    "a chave certa numa transação de escrita grava o atalho (o bloco da v2)",
  );
  assert.deepEqual(
    destinos(await comoAnon(c, "www.loja-a.l1570.teste", CHAVE)),
    [LOJA_A.dominio_publico],
    "o www devolve o principal atual",
  );
  assert.deepEqual(
    destinos(await comoAnon(c, "ANTIGO-A.l1570.teste", CHAVE)),
    [LOJA_A.dominio_publico],
    "host em maiúsculas resolve igual",
  );
  assert.deepEqual(
    await comoAnon(c, "antigo-a.l1570.teste", "errada"),
    [],
    "com o atalho, chave errada: zero linhas",
  );

  // O host principal e o desconhecido: zero linhas.
  for (const host of [
    LOJA_A.dominio_publico,
    LOJA_B.dominio_publico,
    "nao-existe.l1570.teste",
  ])
    assert.deepEqual(
      await comoAnon(c, host, CHAVE),
      [],
      `${host}: zero linhas`,
    );

  // Encaminhamento dos Correios: a loja muda de endereço de novo; o antigo segue para o ATUAL (nunca para o intermediário).
  await c.query(
    "UPDATE public.frota_lojas SET dominio_publico = $1 WHERE id = $2",
    ["terceiro-a.l1570.teste", LOJA_A.id],
  );
  assert.deepEqual(
    destinos(await comoAnon(c, "antigo-a.l1570.teste", CHAVE)),
    ["terceiro-a.l1570.teste"],
    "duas mudanças seguidas: o antigo vai direto ao atual",
  );

  // Loja com ativa = false: zero linhas (a caderneta a trata como desconhecida).
  await c.query("UPDATE public.frota_lojas SET ativa = false WHERE id = $1", [
    LOJA_A.id,
  ]);
  assert.deepEqual(
    await comoAnon(c, "antigo-a.l1570.teste", CHAVE),
    [],
    "loja com ativa = false: zero linhas",
  );
  await c.query("UPDATE public.frota_lojas SET ativa = true WHERE id = $1", [
    LOJA_A.id,
  ]);

  // Os outros papéis não executam.
  for (const papel of ["authenticated", "service_role"]) {
    const e = await tentar(c, async () => {
      await c.query(`SET LOCAL ROLE ${papel}`);
      await c.query("SELECT * FROM public.resolver_encaminhamento($1, $2)", [
        "antigo-a.l1570.teste",
        CHAVE,
      ]);
    });
    assert.equal(e?.code, "42501", `${papel} não executa a porta de leitura`);
  }
}

// ---------------------------------------------------------------------------
// (f) rollback comum
// ---------------------------------------------------------------------------
async function rollbackComum(c) {
  await desfeita(c, async () => {
    await semente(c);
    await encaminhar(c, "antigo-a.l1570.teste", LOJA_A.id);
    const depois = await foto(c);
    const linhas = await enderecos(c);
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.equal(
        await prosrc(c, LEITURA),
        null,
        `rollback ${vez}: a porta de leitura sai`,
      );
      assert.equal(
        await prosrc(c, TROCA),
        null,
        `rollback ${vez}: a porta de troca sai`,
      );
    }
    const desfeito = await foto(c);
    assert.deepEqual(
      desfeito.tb,
      depois.tb,
      "o rollback comum não toca a tabela nem frota_lojas",
    );
    assert.deepEqual(
      desfeito.fn.map((f) => f.proname),
      ["frota_enderecos_que_encaminham_nao_e_principal"],
      "sobra só a função do gatilho (que guarda a tabela)",
    );
    assert.deepEqual(
      await enderecos(c),
      linhas,
      "o rollback comum preserva as linhas",
    );
    await c.query(MIGRATION);
    const semOid = (f) => ({ ...f, fn: f.fn.map(({ oid, ...r }) => r) });
    assert.deepEqual(
      semOid(await foto(c)),
      semOid(depois),
      "reaplicar depois do comum (a porta volta com OID novo e o resto igual)",
    );
    // O destrutivo exige o comum antes.
    const e = await tentar(c, async () => {
      await c.query(
        "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
      );
      await c.query("SET LOCAL ikcous.apagar_caderneta = 'sim'");
      await c.query(DESTRUTIVO);
    });
    assert.match(
      e?.message ?? "(apagou)",
      /ENDERECOS_QUE_ENCAMINHAM_ROLLBACK_COMUM_PRIMEIRO/,
      "destrutivo com a porta no ar",
    );
  });
  // A migration aplicada com CRLF (o arquivo vindo de um checkout Windows): o corpo guardado tem \r, e o rollback comum mede sem
  // \r — reconhece o corpo da 20261570 e tira as duas portas (2x), sem B1_BASELINE_DIVERGENT. O replace do pré-voo é E'\r'
  // escrito com a barra: um CR cru dentro do literal some no ler() (e em qualquer editor que normalize o fim de linha).
  await desfeita(c, async () => {
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    for (const fn of [LEITURA, TROCA])
      assert.equal(
        (
          await c.query(
            "SELECT strpos(prosrc, E'\\r') > 0 AS cr FROM pg_proc WHERE oid = to_regprocedure($1)",
            [fn],
          )
        ).rows[0]?.cr,
        true,
        `controle: o corpo de ${fn} aplicado com CRLF guarda o \\r`,
      );
    for (const vez of [1, 2]) {
      await c.query(ROLLBACK);
      assert.equal(
        await prosrc(c, LEITURA),
        null,
        `rollback ${vez} depois do apply com CRLF: a porta de leitura sai`,
      );
      assert.equal(
        await prosrc(c, TROCA),
        null,
        `rollback ${vez} depois do apply com CRLF: a porta de troca sai`,
      );
    }
  });
  // O rollback comum recusa corpo divergente (sucessora no ar?) sem tirar nada.
  await desfeita(c, async () => {
    const base = await foto(c);
    for (const [nome, sabotagem] of [
      [
        "porta de leitura com outro corpo",
        "CREATE OR REPLACE FUNCTION public.resolver_encaminhamento(p_host text, p_chave text) RETURNS TABLE (destino text) LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
      ],
      [
        "porta de troca com outro corpo",
        "CREATE OR REPLACE FUNCTION public.frota_trocar_dominio(p_id text, p_ref text, p_de text, p_para text, p_motivo text, p_valido_ate timestamptz) RETURNS TABLE (id text, nome text, dominio_publico text, dominio_anterior text) LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
      ],
    ]) {
      const r = await tentar(c, async () => {
        await c.query(sabotagem);
        await c.query(ROLLBACK);
      });
      assert.match(
        r?.message ?? "(desfez)",
        /B1_BASELINE_DIVERGENT/,
        `rollback deveria recusar: ${nome}`,
      );
    }
    assert.deepEqual(await foto(c), base);
  });
}

// ---------------------------------------------------------------------------
// (g) a porta de troca
// ---------------------------------------------------------------------------
const ANTIGO = LOJA_A.dominio_publico;
const NOVO = "novo-a.l1570.teste";
const WWW_NOVO = "www.novo-a.l1570.teste";
/** O preparo (P1 do roteiro): o endereço novo e o www dele encaminham para a loja A. */
async function preparo(c) {
  await semente(c);
  await encaminhar(c, NOVO, LOJA_A.id, "novo-em-preparo");
  await encaminhar(c, WWW_NOVO, LOJA_A.id, "www");
}
/** As duas tabelas que a troca escreve, lidas como o dono. */
async function retrato(c) {
  const l = await c.query(
    "SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.id)) AS h FROM public.frota_lojas f",
  );
  const e = await c.query(
    `SELECT md5(string_agg(to_jsonb(f)::text, '|' ORDER BY f.host)) AS h FROM ${TABELA} f`,
  );
  return { lojas: l.rows[0].h, enderecos: e.rows[0].h };
}
const principal = async (c, id) =>
  (
    await c.query(
      "SELECT dominio_publico FROM public.frota_lojas WHERE id = $1",
      [id],
    )
  ).rows[0]?.dominio_publico;
const trocar = (c, de, para, extra = {}) =>
  c.query(SQL_TROCA, [
    extra.id ?? LOJA_A.id,
    extra.ref ?? LOJA_A.project_ref,
    de,
    para,
    "motivo" in extra ? extra.motivo : "a loja ganhou dominio proprio",
    "validade" in extra ? extra.validade : "30 minutes",
  ]);
async function portaDeTroca(c) {
  // Catálogo: SECURITY INVOKER, search_path vazio; ninguém além do dono executa.
  const cat = (
    await c.query(
      `SELECT p.prosecdef, p.proconfig::text AS config, pg_get_function_result(p.oid) AS r,
              (SELECT count(*)::int FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g WHERE g.grantee <> p.proowner) AS outros,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autenticado,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico
         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
      [TROCA],
    )
  ).rows[0];
  assert.deepEqual(
    cat,
    {
      prosecdef: false,
      config: '{"search_path=\\"\\""}',
      r: "TABLE(id text, nome text, dominio_publico text, dominio_anterior text)",
      outros: 0,
      anon: false,
      autenticado: false,
      servico: false,
    },
    "catálogo da porta de troca: SECURITY INVOKER, search_path vazio, só o dono executa",
  );
  await preparo(c);
  for (const papel of PAPEIS) {
    const e = await tentar(c, async () => {
      await c.query(`SET LOCAL ROLE ${papel}`);
      await trocar(c, ANTIGO, NOVO);
    });
    assert.equal(e?.code, "42501", `${papel} não executa a porta de troca`);
  }

  // Cada recusa: o código certo e NADA escrito.
  await encaminhar(c, "outra.l1570.teste", LOJA_B.id, "antigo");
  const antes = await retrato(c);
  const recusas = [
    [
      "validade vencida",
      ANTIGO,
      NOVO,
      { validade: "-1 second" },
      /FROTA_DOMINIO_INSTRUCAO_VENCIDA/,
    ],
    [
      "validade NULL",
      ANTIGO,
      NOVO,
      { validade: null },
      /FROTA_DOMINIO_INSTRUCAO_VENCIDA/,
    ],
    [
      "validade de mais de 1 h",
      ANTIGO,
      NOVO,
      { validade: "61 minutes" },
      /FROTA_DOMINIO_VALIDADE_LONGA/,
    ],
    [
      "de diferente do atual",
      "outro.l1570.teste",
      NOVO,
      {},
      /FROTA_DOMINIO_DIVERGENTE/,
    ],
    [
      "para que não encaminha",
      ANTIGO,
      "nada.l1570.teste",
      {},
      /FROTA_DOMINIO_SEM_PREPARO/,
    ],
    [
      "para que encaminha para OUTRA loja",
      ANTIGO,
      "outra.l1570.teste",
      {},
      /FROTA_DOMINIO_SEM_PREPARO/,
    ],
    [
      "para que é o principal de outra loja",
      ANTIGO,
      LOJA_B.dominio_publico,
      {},
      /FROTA_DOMINIO_SEM_PREPARO/,
    ],
    ["de = para", ANTIGO, ANTIGO, {}, /FROTA_DOMINIO_SEM_MUDANCA/],
    [
      "para malformado (maiúscula)",
      ANTIGO,
      "Novo-a.l1570.teste",
      {},
      /FROTA_DOMINIO_HOST_INVALIDO/,
    ],
    [
      "para malformado (porta)",
      ANTIGO,
      "novo-a.l1570.teste:8080",
      {},
      /FROTA_DOMINIO_HOST_INVALIDO/,
    ],
    [
      "para malformado (caminho)",
      ANTIGO,
      "evil.com/x",
      {},
      /FROTA_DOMINIO_HOST_INVALIDO/,
    ],
    ["para vazio", ANTIGO, "", {}, /FROTA_DOMINIO_HOST_INVALIDO/],
    ["para NULL", ANTIGO, null, {}, /FROTA_DOMINIO_HOST_INVALIDO/],
    ["de malformado", "sem-ponto", NOVO, {}, /FROTA_DOMINIO_HOST_INVALIDO/],
    ["motivo vazio", ANTIGO, NOVO, { motivo: "   " }, /FROTA_DOMINIO_MOTIVO/],
    ["motivo NULL", ANTIGO, NOVO, { motivo: null }, /FROTA_DOMINIO_MOTIVO/],
    [
      "motivo de mais de 200",
      ANTIGO,
      NOVO,
      { motivo: "m".repeat(201) },
      /FROTA_DOMINIO_MOTIVO/,
    ],
    [
      "loja que não existe",
      ANTIGO,
      NOVO,
      { id: "nao-existe" },
      /FROTA_DOMINIO_LOJA_NAO_ENCONTRADA/,
    ],
    [
      "ref de outra loja",
      ANTIGO,
      NOVO,
      { ref: LOJA_B.project_ref },
      /FROTA_DOMINIO_LOJA_NAO_ENCONTRADA/,
    ],
  ];
  for (const [nome, de, para, extra, esperado] of recusas) {
    const e = await tentar(c, () => trocar(c, de, para, extra));
    assert.match(e?.message ?? "(trocou)", esperado, `recusa: ${nome}`);
    assert.deepEqual(await retrato(c), antes, `recusa sem escrever: ${nome}`);
  }

  // A troca: o preparado sai da tabela, vira o principal; o antigo entra como antigo; o www do novo e o endereço da B ficam.
  const r = (await trocar(c, ANTIGO, NOVO)).rows;
  assert.deepEqual(
    r,
    [
      {
        id: LOJA_A.id,
        nome: LOJA_A.nome,
        dominio_publico: NOVO,
        dominio_anterior: ANTIGO,
      },
    ],
    "a troca devolve a loja com o endereço novo e o anterior",
  );
  assert.equal(await principal(c, LOJA_A.id), NOVO, "o principal é o novo");
  assert.deepEqual(
    (await enderecos(c)).map((l) => [l.host, l.loja_id, l.motivo]),
    [
      [ANTIGO, LOJA_A.id, "antigo"],
      ["outra.l1570.teste", LOJA_B.id, "antigo"],
      [WWW_NOVO, LOJA_A.id, "www"],
    ],
    "o antigo entra como antigo; o novo sai da tabela; o www do novo e o da outra loja ficam",
  );
  // O porteiro: o antigo e o www do novo encaminham para o novo; o novo não encaminha (é o principal).
  await segredo(c);
  assert.deepEqual(destinos(await comoAnon(c, ANTIGO, CHAVE)), [NOVO]);
  assert.deepEqual(destinos(await comoAnon(c, WWW_NOVO, CHAVE)), [NOVO]);
  assert.deepEqual(await comoAnon(c, NOVO, CHAVE), []);

  // A troca invertida (o desfazer do roteiro): o roteamento volta ao de antes. O motivo do novo passa a ser antigo (não guarda o
  // "em preparo") e criado_em/quem são os do momento da volta — o que importa ao porteiro é a mesma resposta para cada host.
  const r2 = (await trocar(c, NOVO, ANTIGO, { motivo: "volta por prova" }))
    .rows;
  assert.deepEqual(
    r2.map((l) => [l.dominio_publico, l.dominio_anterior]),
    [[ANTIGO, NOVO]],
  );
  assert.equal(await principal(c, LOJA_A.id), ANTIGO, "o principal volta");
  assert.deepEqual(
    (await enderecos(c)).map((l) => [l.host, l.loja_id]),
    [
      [NOVO, LOJA_A.id],
      ["outra.l1570.teste", LOJA_B.id],
      [WWW_NOVO, LOJA_A.id],
    ],
    "os mesmos hosts encaminham para a mesma loja de antes da troca",
  );
  assert.deepEqual(destinos(await comoAnon(c, NOVO, CHAVE)), [ANTIGO]);
  assert.deepEqual(destinos(await comoAnon(c, WWW_NOVO, CHAVE)), [ANTIGO]);
  assert.deepEqual(await comoAnon(c, ANTIGO, CHAVE), []);
}

/** Uma falha no meio (depois de apagar o preparado, o UPDATE esbarra no UNIQUE de dominio_publico) desfaz as três escritas. */
async function falhaNoMeio(c) {
  await preparo(c);
  // A outra loja passa a ter o NOVO como principal por UPDATE direto (a tabela nova não vigia frota_lojas): o preparado continua lá.
  await c.query(
    "UPDATE public.frota_lojas SET dominio_publico = $1 WHERE id = $2",
    [NOVO, LOJA_B.id],
  );
  const antes = await retrato(c);
  const e = await tentar(c, () => trocar(c, ANTIGO, NOVO));
  assert.equal(
    e?.code,
    "23505",
    "o UPDATE esbarra no UNIQUE de dominio_publico",
  );
  assert.deepEqual(
    await retrato(c),
    antes,
    "nada ficou: o preparado não sumiu e o principal não mudou",
  );
  assert.deepEqual(
    (await enderecos(c)).map((l) => l.host),
    [NOVO, WWW_NOVO],
  );
}

// ---------------------------------------------------------------------------
// (h) duas conexões: a mesma troca duas vezes ao mesmo tempo
// ---------------------------------------------------------------------------
async function concorrencia(c, url) {
  // A semente é COMITADA (a outra conexão precisa vê-la) e sai no fim: o clone é exclusivo desta prova.
  await c.query("BEGIN");
  await preparo(c);
  await c.query("COMMIT");
  const outro = new Client({ connectionString: url });
  await outro.connect();
  try {
    await c.query("BEGIN");
    await trocar(c, ANTIGO, NOVO);
    // A segunda troca espera a linha da loja (FOR UPDATE) presa pela primeira.
    await outro.query("SET statement_timeout = '20s'");
    const segunda = outro.query(SQL_TROCA, [
      LOJA_A.id,
      LOJA_A.project_ref,
      ANTIGO,
      NOVO,
      "a mesma troca, de novo",
      "30 minutes",
    ]);
    const resultado = segunda.then(
      () => null,
      (e) => e,
    );
    await new Promise((r) => setTimeout(r, 500));
    const esperando = (
      await c.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%frota_trocar_dominio%'",
      )
    ).rows[0].n;
    assert.equal(esperando, 1, "a segunda troca espera a primeira");
    await c.query("COMMIT");
    const e = await resultado;
    assert.match(
      e?.message ?? "(trocou duas vezes)",
      /FROTA_DOMINIO_DIVERGENTE/,
      "a segunda troca relê o endereço já trocado e é recusada",
    );
    assert.equal(await principal(c, LOJA_A.id), NOVO);
    assert.deepEqual(
      (await enderecos(c)).map((l) => [l.host, l.motivo]),
      [
        [ANTIGO, "antigo"],
        [WWW_NOVO, "www"],
      ],
      "uma troca só ficou",
    );
  } finally {
    await outro.end();
    await c.query("ROLLBACK").catch(() => {});
    await c.query(`DELETE FROM ${TABELA} WHERE loja_id IN ($1, $2)`, [
      LOJA_A.id,
      LOJA_B.id,
    ]);
    await c.query("DELETE FROM public.frota_lojas WHERE id IN ($1, $2)", [
      LOJA_A.id,
      LOJA_B.id,
    ]);
  }
}

// ---------------------------------------------------------------------------
// (i) consultas 194a/194b, EXECUTADAS no catálogo real
// ---------------------------------------------------------------------------
/** Roda a consulta como authenticated (sem privilégio de tabela) e devolve os itens que NÃO deram ok, em ordem. */
async function consulta(c, nome) {
  const sql = fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
  assert.equal(CONF.contarStatements(sql), 1);
  await c.query("SAVEPOINT leitura_catalogo");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const rows = (await c.query(sql)).rows;
    assert.equal(
      CONF.estruturaDoRolFechado(rows, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
      null,
      `${nome}: rol fechado`,
    );
    return rows
      .filter((r) => r.ok !== true)
      .map((r) => r.item)
      .sort();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT leitura_catalogo");
  }
}
async function portao(c) {
  const item = (rol, inicio) => {
    const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
      i.startsWith(inicio),
    );
    assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
    return x[0];
  };
  const FORMA = "frota_enderecos_que_encaminham: as 5 colunas";
  const FECHADA = "frota_enderecos_que_encaminham: fechada";
  const GATILHO = "frota_enderecos_que_encaminham_nao_e_principal: o gatilho";
  const LEITURA_ = "resolver_encaminhamento: uma so";
  const TROCA_ = "frota_trocar_dominio: uma so";
  const B_TABELA = "frota_enderecos_que_encaminham e a funcao do gatilho";
  const B_PORTAS = "resolver_encaminhamento e frota_trocar_dominio ainda NAO";
  const B_1490 = "a 20261490000000 esta aplicada";
  const B_LOJAS = "frota_lojas: a chave em id";
  let defeitos = 0;
  const plantar = async (rol, sabotagem, esperados) => {
    await c.query("SAVEPOINT defeito");
    try {
      for (const x of [].concat(sabotagem)) await c.query(x);
      assert.deepEqual(
        await consulta(c, rol),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${[].concat(sabotagem).join("; ").slice(0, 90)}" reprova exatamente o item certo`,
      );
      defeitos++;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT defeito");
    }
  };
  await desfeita(c, async () => {
    await preparo(c); // linhas não mudam o veredito (as consultas não leem linha)
    assert.deepEqual(
      await consulta(c, A194),
      [],
      "194a positiva depois do apply",
    );
    assert.deepEqual(
      await consulta(c, B194),
      [item(B194, B_TABELA), item(B194, B_PORTAS)].sort(),
      "194b reprova só o que a migration criou",
    );
    for (const [sabotagem, esperados] of [
      [`GRANT SELECT ON ${TABELA} TO anon`, [FECHADA]],
      [`GRANT SELECT (host) ON ${TABELA} TO service_role`, [FECHADA]],
      [
        [
          "CREATE POLICY p1570 ON public.frota_enderecos_que_encaminham FOR SELECT TO anon USING (true)",
        ],
        [FECHADA],
      ],
      [`ALTER TABLE ${TABELA} DISABLE ROW LEVEL SECURITY`, [FECHADA]],
      [
        `ALTER TABLE ${TABELA} DROP CONSTRAINT frota_enderecos_que_encaminham_motivo_check`,
        [FORMA],
      ],
      [
        `ALTER TABLE ${TABELA} DROP CONSTRAINT frota_enderecos_que_encaminham_loja_id_fkey, ADD CONSTRAINT frota_enderecos_que_encaminham_loja_id_fkey FOREIGN KEY (loja_id) REFERENCES public.frota_lojas (id)`,
        [FORMA],
      ],
      [
        `ALTER TABLE ${TABELA} DISABLE TRIGGER frota_enderecos_que_encaminham_nao_e_principal`,
        [GATILHO],
      ],
      [
        "GRANT EXECUTE ON FUNCTION public.resolver_encaminhamento(text, text) TO authenticated",
        [LEITURA_],
      ],
      [
        "REVOKE EXECUTE ON FUNCTION public.resolver_encaminhamento(text, text) FROM anon",
        [LEITURA_],
      ],
      [
        "ALTER FUNCTION public.resolver_encaminhamento(text, text) SECURITY INVOKER",
        [LEITURA_],
      ],
      [
        "GRANT EXECUTE ON FUNCTION public.frota_trocar_dominio(text, text, text, text, text, timestamptz) TO service_role",
        [TROCA_],
      ],
      [
        "CREATE OR REPLACE FUNCTION public.frota_trocar_dominio(p_id text, p_ref text, p_de text, p_para text, p_motivo text, p_valido_ate timestamptz) RETURNS TABLE (id text, nome text, dominio_publico text, dominio_anterior text) LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RETURN; END $f$",
        [TROCA_],
      ],
    ])
      await plantar(A194, sabotagem, esperados);
  });
  // Depois do comum: a 194a reprova as duas portas; a 194b ainda reprova a tabela (de propósito: só o destrutivo a tira).
  await desfeita(c, async () => {
    await c.query(ROLLBACK);
    assert.deepEqual(
      await consulta(c, A194),
      [item(A194, LEITURA_), item(A194, TROCA_)].sort(),
      "194a depois do comum: só as duas portas",
    );
    assert.deepEqual(
      await consulta(c, B194),
      [item(B194, B_TABELA)],
      "194b depois do comum: só a tabela (fica de propósito)",
    );
  });
  // Depois do destrutivo: a 194b positiva; com a 20261490 desfeita ou com frota_lojas sem o CHECK, a linha certa reprova.
  await desfeita(c, async () => {
    assert.equal(await desfazerEnderecoAntigoNaTransacao(c), true);
    assert.deepEqual(
      await consulta(c, B194),
      [],
      "194b positiva na base de antes",
    );
    assert.deepEqual(
      await consulta(c, A194),
      [
        item(A194, FORMA),
        item(A194, FECHADA),
        item(A194, GATILHO),
        item(A194, LEITURA_),
        item(A194, TROCA_),
      ].sort(),
      "194a na base de antes: tudo menos o controle",
    );
    await c.query("SAVEPOINT sem1490");
    assert.equal(await desfazerChaveSemBcryptNaTransacao(c), true);
    assert.deepEqual(
      await consulta(c, B194),
      [item(B194, B_1490)],
      "194b sem a 20261490: só a linha dela",
    );
    defeitos++;
    await c.query("ROLLBACK TO SAVEPOINT sem1490");
    await plantar(
      B194,
      "ALTER TABLE public.frota_lojas DROP CONSTRAINT frota_lojas_dominio_publico_check",
      [B_LOJAS],
    );
  });
  return defeitos;
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    await provar(
      "a tabela: fechada, gatilho do principal, CHECK de host e motivo, apagar a loja apaga os endereços",
      () => desfeita(c, () => tabela(c)),
    );
    await provar("reaplicar (LF, CRLF, LF) não muda nada", () => reaplicar(c));
    await provar(
      "sem BEGIN/COMMIT; aplicar numa transação desfeita não deixa nada",
      () => transacao(c),
    );
    await provar(
      "pré-voo recusa sem a 20261490 e com objeto de outra forma, sem escrever; destrutivo com as confirmações",
      () => preVoo(c),
    );
    await provar(
      "porta de leitura: chave, endereço atual sem corrente, principal, ativa = false, só leitura, só o anon, bloco da chave da v2",
      () => desfeita(c, () => portaDeLeitura(c)),
    );
    await provar(
      "rollback comum (2x) tira as funções e preserva a tabela; recusa corpo divergente; destrutivo exige o comum",
      () => rollbackComum(c),
    );
    await provar(
      "porta de troca: só o dono; 19 recusas sem escrever; as três escritas; a troca invertida volta o roteamento",
      () => desfeita(c, () => portaDeTroca(c)),
    );
    await provar("falha no meio da troca desfaz as três escritas", () =>
      desfeita(c, () => falhaNoMeio(c)),
    );
    await provar(
      "duas conexões: a segunda troca igual espera e é recusada pelo endereço já trocado",
      () => concorrencia(c, url),
    );
    const defeitos = await provar(
      "consultas 194a/194b: catálogo real, depois do apply, do comum e do destrutivo, defeitos plantados",
      () => portao(c),
    );
    console.log(
      `\no-endereco-antigo-encaminha-viva: ${provas} provas ok; ${defeitos} defeitos plantados nas consultas`,
    );
    anexarAoSummary(
      "O endereço antigo encaminha para o novo (PG17)",
      `${provas} provas.`,
    );
  } finally {
    await c.end();
  }
}
main().catch((e) =>
  falhar("O_ENDERECO_ANTIGO_ENCAMINHA", e.stack || e.message),
);
