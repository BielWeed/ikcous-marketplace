"use strict";

/**
 * Prova VIVA das consultas do PORTAO DA RELEASE para o lote 39 (a cliente pede a exclusao da conta e a correcao do e-mail;
 * DADO DE CLIENTE) -- a migration 20261238000000 (a tabela public.pedidos_de_privacidade, a funcao do gatilho e o
 * gatilho) --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   39a-conferir-pedidos-de-privacidade-aplicado.sql          (DEPOIS do apply: 19 linhas)
 *   39b-antes-pedidos-de-privacidade-objetos-ausentes.sql     (ANTES do apply: 9 linhas)
 *   39m-medir-privilegios-do-roteiro-de-privacidade.sql       (medicao de ROL ABERTO, so catalogo: nao e portao)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada consulta DECIDE
 * certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da consulta contra o ref de cada
 * loja diz). O COMPORTAMENTO e' de tests/banco/pedidos-de-privacidade-viva.cjs; o ensaio do roteiro manual, de
 * tests/banco/anonimizar-conta-ensaio-viva.cjs (e o roteiro NAO roda aqui).
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore ja tem a
 * migration, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK: o DEPOIS e' a
 * migration aplicada e o ANTES e' o DEPOIS seguido do rollback-manual (que recusa se houver pedido: a tabela do clone esta
 * vazia). As consultas rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente
 * leitura. A migration NAO e' reaplicavel (o pre-voo recusa): a prova mostra isso tambem.
 *
 *  HASH       o md5 literal da 39a e' o do corpo que o ARQUIVO da migration carrega, e o que o banco mede e' o mesmo.
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_39A e ROL_DA_39B), sem repetir
 *             nem faltar, em todos os estados.
 *  ESTADOS    depois: 39a POSITIVA e a 39b reprova SO as quatro linhas dos objetos; antes: 39b POSITIVA e a 39a reprova
 *             tudo menos o controle; o arquivo em CRLF, ida e volta e reaplicar (que recusa): o mesmo veredito.
 *  NEGATIVOS  cada defeito (coluna a mais, default trocado, CHECK solta ou fraca, chave com cascata, indice sem o filtro, RLS
 *             desligada, politica a menos, a mais, aberta ou com a expressao frouxa, cada privilegio a mais ou a menos
 *             para PUBLIC, anon, authenticated e service_role, corpo com 1 byte a mais, atributos, EXECUTE aberto, outra
 *             sobrecarga, gatilho desligado, de outro tipo, a mais ou com WHEN) reprova EXATAMENTE as linhas certas.
 *  ANTES      cada resto de uma meia migration (tabela, indice, funcao ou gatilho homonimos) e cada dependencia que falta
 *             reprova a SUA linha da 39b; o REFERENCES e' provado trocando o papel alvo por um papel de teste.
 *  MEDICAO    a 39m devolve tipo/objeto/detalhe, sem coluna `ok`, so catalogo, com os privilegios de UM papel de teste
 *             lidos certo por tabela (e `tabela ausente` para a que nao existe).
 *  PAPEL      as consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL, onde `postgres` e' SUPERUSUARIO (o REFERENCES dele e' sempre `sim`); o papel de
 * leitura real da loja (supabase_read_only_user), a ACL real e os objetos vivos das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/pedidos-de-privacidade-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "39a-conferir-pedidos-de-privacidade-aplicado";
const B = "39b-antes-pedidos-de-privacidade-objetos-ausentes";
const M = "39m-medir-privilegios-do-roteiro-de-privacidade";
const ARQ =
  "20261238000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B), [M]: lerConsulta(M) };
const ROL = { [A]: CONF.ROL_DA_39A, [B]: CONF.ROL_DA_39B };
const MIG = lerMig(ARQ);
const RB = lerMig(`rollback-manual-${ARQ}`);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo (entre as aspas de dolar) da UMA `CREATE FUNCTION public.pedidos_de_privacidade__carimbar(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE FUNCTION public.pedidos_de_privacidade__carimbar(";
  assert.equal(sql.split(marca).length - 1, 1, "mais de uma definicao");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const H_CORPO = md5(corpoDe(MIG));

const T = "public.pedidos_de_privacidade";
const FN = "public.pedidos_de_privacidade__carimbar()";
const TRG = "tr_pedidos_de_privacidade_carimbar";
const UQ = "public.uq_pedidos_de_privacidade_um_aberto";
const IDX = "public.idx_pedidos_de_privacidade_situacao_criado";
const PAPEL_RO = `portao39_ro_${process.pid}`;
const PAPEL_SEM_REF = `portao39_semref_${process.pid}`;
const PAPEL_M = `portao39_m_${process.pid}`;
const PAPEL_CEGO = `portao39_cego_${process.pid}`;
let C;

/** A UNICA linha do rol cujo texto traz `trecho` (falha se nao achar ou se achar mais de uma). */
function linha(nome, trecho) {
  const achadas = ROL[nome].filter((i) => i.includes(trecho));
  assert.equal(
    achadas.length,
    1,
    `${nome}: "${trecho}" acha ${achadas.length}`,
  );
  return achadas[0];
}
const A_CONTROLE = ROL[A][0];
const A_COLUNAS = linha(A, "colunas (nome, tipo, NOT NULL, default)");
const A_CONSTR = linha(A, "as 8 constraints pelo nome");
const A_REGRAS = linha(A, "a regra de cada CHECK");
const A_FK = linha(A, "chave user_id -> auth.users");
const A_UQ = linha(A, "uq_pedidos_de_privacidade_um_aberto");
const A_IDX = linha(A, "idx_pedidos_de_privacidade_situacao_criado");
const A_RLS = linha(A, "seguranca por linha (RLS)");
const A_POLS = linha(A, "as tres politicas");
const A_EXPR = linha(A, "a expressao de cada politica");
const A_PUBANON = linha(A, "PUBLIC e anon sem nenhum privilegio");
const A_AUTH_TAB = linha(A, "authenticated, privilegios de tabela");
const A_AUTH_COL = linha(A, "authenticated, colunas que escreve");
const A_SVC = linha(A, "service_role le, grava e decide");
const A_SOBRE = linha(A, "pedidos_de_privacidade__carimbar: sobrecargas");
const A_MD5 = linha(A, "corpo e o da 20261238000000 (md5)");
const A_ATRIB = linha(A, "carimbar: atributos");
const A_EXEC = linha(A, "carimbar: EXECUTE fechado ao visitante");
const A_TRG = linha(A, "o unico gatilho, BEFORE UPDATE por linha");
const B_TABELA = linha(B, "tabela ausente");
const B_INDICES = linha(B, "os dois indices ausentes");
const B_FUNCAO = linha(B, "funcao ausente");
const B_GATILHO = linha(B, "gatilho ausente");
const B_USERS = linha(B, "dependencia auth.users");
const B_UID = linha(B, "dependencia auth.uid()");
const B_RLS = linha(B, "dependencia public.rls_admin_atual()");
const B_REF = linha(B, "tem REFERENCES");

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(
  montar,
  consultas,
  { comoDono = false, sql = SQL } = {},
) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    if (!comoDono) {
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      assert.equal(
        (await C.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
    }
    const saidas = {};
    for (const nome of consultas) {
      const r = await C.query(sql[nome]);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

// DEPOIS: a migration (a arvore ja a tem; se a tabela sumiu, aplica o arquivo).
const depois = async (c) => {
  const r = await c.query(
    "SELECT to_regclass('public.pedidos_de_privacidade') IS NOT NULL AS tem",
  );
  if (!r.rows[0].tem) await c.query(MIG);
};
// ANTES: parte do DEPOIS e desfaz com o rollback-manual.
const antes = async (c) => {
  await depois(c);
  await c.query(RB);
};

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();

/** O rol da consulta: as linhas sao exatamente o contrato, cada uma UMA vez. */
function confereRol(nome, linhas) {
  assert.deepEqual(
    linhas.map((l) => l.item).sort(),
    [...ROL[nome]].sort(),
    `${nome}: as linhas nao sao exatamente o rol`,
  );
  assert.equal(new Set(linhas.map((l) => l.item)).size, linhas.length);
  for (const l of linhas)
    assert.equal(
      typeof l.ok,
      "boolean",
      `${nome}: ok nao booleano em ${l.item}`,
    );
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Roda a consulta no estado mutado e confere as linhas reprovadas. */
async function negativo(consulta, { estado, mutar }, esperadas) {
  const s = await noEstado(
    async (c) => {
      await estado(c);
      for (const comando of [].concat(mutar)) await c.query(comando);
    },
    [consulta],
  );
  confereRol(consulta, s[consulta]);
  assert.deepEqual(
    reprovadas(s[consulta]),
    [...esperadas].sort(),
    `${consulta}: ${[].concat(mutar).join(" ; ").slice(0, 110)}`,
  );
}

const quote = (s) => `'${s.replace(/'/g, "''")}'`;
const trocaCorpo = (de, para) =>
  `DO $mut$ DECLARE v text; BEGIN
     SELECT prosrc INTO v FROM pg_proc WHERE oid = to_regprocedure('${FN}');
     IF position(${quote(de)} IN v) = 0 THEN RAISE EXCEPTION 'mutacao nao aplica'; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION ${FN.replace("()", "")}() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS %L', replace(v, ${quote(de)}, ${quote(para)}));
   END $mut$`;

prova(
  "HASH: o md5 literal da 39a e' o do corpo que o arquivo carrega, e o banco mede o mesmo",
  async () => {
    assert.ok(SQL[A].includes(`'${H_CORPO}'`), "39a: md5 do corpo");
    const r = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    );
    assert.equal(
      r.rows[0].h,
      H_CORPO,
      "o clone nao esta com o corpo da migration",
    );
    // o corpo muda com UM byte: o md5 e' sensivel
    assert.notEqual(md5(`${corpoDe(MIG)} `), H_CORPO);
  },
);

prova(
  "ROL: as 19 linhas da 39a e as 9 da 39b sao exatamente o rol, em todos os estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 19);
    assert.equal(ROL[B].length, 9);
  },
);

prova(
  "DEPOIS (a migration): 39a POSITIVA; 39b reprova SO as quatro linhas dos objetos",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "39a toda ok no depois");
    assert.deepEqual(
      reprovadas(s[B]),
      [B_TABELA, B_INDICES, B_FUNCAO, B_GATILHO].sort(),
    );
    const por = Object.fromEntries(s[A].map((l) => [l.item, l.vivo]));
    assert.equal(por[A_MD5], H_CORPO);
    assert.equal(por[A_AUTH_TAB], "SELECT");
    assert.equal(
      por[A_AUTH_COL],
      "INSERT(email_novo, tipo, user_id) UPDATE(observacao, situacao)",
    );
    assert.equal(por[A_SVC], "INSERT,SELECT,UPDATE");
    assert.equal(por[A_PUBANON], "PUBLIC=nenhum anon=nenhum");
    assert.equal(por[A_EXEC], "PUBLIC=nao anon=nao authenticated=nao");
  },
);

prova(
  "ANTES (o rollback-manual): 39b POSITIVA; 39a reprova tudo menos o controle",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "39b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      ROL[A].filter((i) => i !== A_CONTROLE).sort(),
    );
    // objeto ausente vira AUSENTE na propria linha (so a contagem de sobrecargas diz 0)
    for (const l of s[A].filter(
      (x) => x.item !== A_CONTROLE && x.item !== A_SOBRE,
    ))
      assert.equal(l.vivo, "AUSENTE", l.item);
    assert.equal(s[A].find((l) => l.item === A_SOBRE).vivo, "0");
  },
);

prova(
  "IDA E VOLTA, CRLF e REAPLICAR: o mesmo veredito (e a migration NAO e' reaplicavel)",
  async () => {
    const idaEVolta = await noEstado(
      async (c) => {
        await antes(c);
        await depois(c);
      },
      [A, B],
    );
    assert.deepEqual(reprovadas(idaEVolta[A]), []);
    assert.equal(reprovadas(idaEVolta[B]).length, 4);
    // o arquivo em CRLF (Windows): o md5 ignora o \r, o veredito e' o mesmo
    const crlf = await noEstado(
      async (c) => {
        await antes(c);
        await c.query(emCRLF(MIG));
      },
      [A],
    );
    assert.deepEqual(reprovadas(crlf[A]), []);
    const crlfAntes = await noEstado(
      async (c) => {
        await depois(c);
        await c.query(emCRLF(RB));
      },
      [B],
    );
    assert.deepEqual(reprovadas(crlfAntes[B]), []);
    // reaplicar a migration inteira sobre ela mesma ABORTA no pre-voo (por isso a consulta de ausencia existe)
    await C.query("BEGIN");
    try {
      await depois(C);
      await assert.rejects(
        () => C.query(MIG),
        /B1_BASELINE_DIVERGENT: public\.pedidos_de_privacidade ja existe|B1_BASELINE_DIVERGENT: public\.pedidos_de_privacidade já existe/,
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

prova(
  "CONTROLE: sem mutacao a 39a passa no depois e a 39b no antes",
  async () => {
    await negativo(A, { estado: depois, mutar: "SELECT 1" }, []);
    await negativo(B, { estado: antes, mutar: "SELECT 1" }, []);
  },
);

prova(
  "NEGATIVO 39a, a tabela: colunas, CHECK, chave, indices e RLS reprovam SO as linhas certas",
  async () => {
    const casos = [
      [`ALTER TABLE ${T} ADD COLUMN extra text`, [A_COLUNAS]],
      [
        `ALTER TABLE ${T} ALTER COLUMN situacao SET DEFAULT 'atendido'`,
        [A_COLUNAS],
      ],
      [`ALTER TABLE ${T} ALTER COLUMN observacao SET NOT NULL`, [A_COLUNAS]],
      // CHECK: sumir reprova o nome e a regra; trocar por outra de mesmo nome reprova SO a regra
      [
        `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_observacao_check`,
        [A_CONSTR, A_REGRAS],
      ],
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_email_formato_check`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_email_formato_check CHECK (true)`,
        ],
        [A_REGRAS],
      ],
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_carimbo_check`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_carimbo_check CHECK (situacao IN ('aberto', 'atendido', 'recusado'))`,
        ],
        [A_REGRAS],
      ],
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_tipo_check`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_tipo_check CHECK (tipo IN ('excluir_conta', 'corrigir_email', 'outro'))`,
        ],
        [A_REGRAS],
      ],
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_observacao_check`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_observacao_check CHECK (observacao IS NULL OR char_length(observacao) <= 100000)`,
        ],
        [A_REGRAS],
      ],
      // a chave: com cascata reprova SO a chave; sumir reprova o nome e a chave
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_user_id_fkey`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE`,
        ],
        [A_FK],
      ],
      [
        [
          `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_user_id_fkey`,
          `ALTER TABLE ${T} ADD CONSTRAINT pedidos_de_privacidade_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON UPDATE CASCADE`,
        ],
        [A_FK],
      ],
      [
        `ALTER TABLE ${T} DROP CONSTRAINT pedidos_de_privacidade_user_id_fkey`,
        [A_CONSTR, A_FK],
      ],
      // os indices
      [`DROP INDEX ${UQ}`, [A_UQ]],
      [
        [
          `DROP INDEX ${UQ}`,
          `CREATE UNIQUE INDEX uq_pedidos_de_privacidade_um_aberto ON ${T} (user_id, tipo)`,
        ],
        [A_UQ],
      ],
      [
        [
          `DROP INDEX ${UQ}`,
          `CREATE UNIQUE INDEX uq_pedidos_de_privacidade_um_aberto ON ${T} (user_id) WHERE situacao = 'aberto'`,
        ],
        [A_UQ],
      ],
      [
        [
          `DROP INDEX ${UQ}`,
          `CREATE INDEX uq_pedidos_de_privacidade_um_aberto ON ${T} (user_id, tipo) WHERE situacao = 'aberto'`,
        ],
        [A_UQ],
      ],
      [`DROP INDEX ${IDX}`, [A_IDX]],
      [
        [
          `DROP INDEX ${IDX}`,
          `CREATE INDEX idx_pedidos_de_privacidade_situacao_criado ON ${T} (situacao)`,
        ],
        [A_IDX],
      ],
      // a RLS
      [`ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`, [A_RLS]],
    ];
    for (const [mutar, esperadas] of casos)
      await negativo(A, { estado: depois, mutar }, esperadas);
  },
);

prova(
  "NEGATIVO 39a, as politicas: a menos, a mais, aberta ou frouxa reprovam SO as linhas certas",
  async () => {
    const casos = [
      [
        `DROP POLICY pedidos_de_privacidade_dono_insert_policy ON ${T}`,
        [A_POLS, A_EXPR],
      ],
      [
        `DROP POLICY pedidos_de_privacidade_admin_update_policy ON ${T}`,
        [A_POLS, A_EXPR],
      ],
      [
        `DROP POLICY pedidos_de_privacidade_dono_ou_admin_select_policy ON ${T}`,
        [A_POLS, A_EXPR],
      ],
      // politica a mais de DELETE (e de ALL)
      [
        `CREATE POLICY zz_apaga ON ${T} FOR DELETE TO authenticated USING (true)`,
        [A_POLS],
      ],
      [
        `CREATE POLICY zz_tudo ON ${T} FOR ALL TO authenticated USING (true)`,
        [A_POLS],
      ],
      // o mesmo nome e comando, para outro papel
      [
        `ALTER POLICY pedidos_de_privacidade_admin_update_policy ON ${T} TO PUBLIC`,
        [A_POLS],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_dono_insert_policy ON ${T} TO anon, authenticated`,
        [A_POLS],
      ],
      // a expressao frouxa: o nome, o comando e o papel ficam, so a expressao reprova
      [
        `ALTER POLICY pedidos_de_privacidade_dono_ou_admin_select_policy ON ${T} USING (true)`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_dono_ou_admin_select_policy ON ${T} USING (user_id = (SELECT auth.uid()))`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_admin_update_policy ON ${T} USING (true) WITH CHECK (true)`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_admin_update_policy ON ${T} WITH CHECK (true)`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_dono_insert_policy ON ${T} WITH CHECK (user_id = (SELECT auth.uid()))`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_dono_insert_policy ON ${T} WITH CHECK (user_id = (SELECT auth.uid()) AND situacao = 'aberto' AND atendido_em IS NULL AND atendido_por IS NULL)`,
        [A_EXPR],
      ],
      [
        `ALTER POLICY pedidos_de_privacidade_dono_insert_policy ON ${T} WITH CHECK (true)`,
        [A_EXPR],
      ],
    ];
    for (const [mutar, esperadas] of casos)
      await negativo(A, { estado: depois, mutar }, esperadas);
  },
);

prova(
  "NEGATIVO 39a, os privilegios: cada um a mais ou a menos, para cada papel, reprova SO as linhas certas",
  async () => {
    const casos = [
      // authenticated
      [`GRANT DELETE ON ${T} TO authenticated`, [A_AUTH_TAB]],
      [`GRANT TRUNCATE ON ${T} TO authenticated`, [A_AUTH_TAB]],
      [`GRANT REFERENCES ON ${T} TO authenticated`, [A_AUTH_TAB, A_AUTH_COL]],
      [`GRANT TRIGGER ON ${T} TO authenticated`, [A_AUTH_TAB]],
      [`GRANT UPDATE ON ${T} TO authenticated`, [A_AUTH_TAB, A_AUTH_COL]],
      [`GRANT INSERT ON ${T} TO authenticated`, [A_AUTH_TAB, A_AUTH_COL]],
      [`GRANT UPDATE (atendido_em) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`GRANT UPDATE (atendido_por) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`GRANT UPDATE (user_id) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`GRANT INSERT (situacao) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`GRANT INSERT (id) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`GRANT REFERENCES (id) ON ${T} TO authenticated`, [A_AUTH_COL]],
      [`REVOKE UPDATE (observacao) ON ${T} FROM authenticated`, [A_AUTH_COL]],
      [`REVOKE INSERT (email_novo) ON ${T} FROM authenticated`, [A_AUTH_COL]],
      [`REVOKE SELECT ON ${T} FROM authenticated`, [A_AUTH_TAB]],
      // anon e PUBLIC
      [`GRANT SELECT ON ${T} TO anon`, [A_PUBANON]],
      [`GRANT INSERT ON ${T} TO anon`, [A_PUBANON]],
      [`GRANT SELECT (id) ON ${T} TO anon`, [A_PUBANON]],
      [`GRANT UPDATE (observacao) ON ${T} TO anon`, [A_PUBANON]],
      [`GRANT SELECT ON ${T} TO PUBLIC`, [A_PUBANON]],
      [`GRANT SELECT (id) ON ${T} TO PUBLIC`, [A_PUBANON]],
      // PUBLIC com DELETE chega a todo mundo: authenticated, service_role e a propria linha de PUBLIC
      [`GRANT DELETE ON ${T} TO PUBLIC`, [A_PUBANON, A_AUTH_TAB, A_SVC]],
      // service_role
      [`GRANT DELETE ON ${T} TO service_role`, [A_SVC]],
      [`GRANT TRUNCATE ON ${T} TO service_role`, [A_SVC]],
      [`GRANT REFERENCES ON ${T} TO service_role`, [A_SVC]],
      [`GRANT TRIGGER ON ${T} TO service_role`, [A_SVC]],
      [`REVOKE UPDATE ON ${T} FROM service_role`, [A_SVC]],
      [`REVOKE SELECT ON ${T} FROM service_role`, [A_SVC]],
      [`REVOKE INSERT ON ${T} FROM service_role`, [A_SVC]],
    ];
    for (const [mutar, esperadas] of casos)
      await negativo(A, { estado: depois, mutar }, esperadas);
  },
);

prova(
  "NEGATIVO 39a, a funcao e o gatilho: corpo, atributos, EXECUTE, sobrecarga e gatilho reprovam SO as linhas certas",
  async () => {
    const ladrilho = (gatilho) => [
      `DROP TRIGGER ${TRG} ON ${T}`,
      `CREATE TRIGGER ${TRG} ${gatilho}`,
    ];
    const casos = [
      // o corpo: 1 byte a mais
      [trocaCorpo("RETURN NEW;", "RETURN NEW; -- a mais"), [A_MD5]],
      // o corpo sem a trava da identidade: so o md5 (nenhum atributo muda)
      [
        trocaCorpo("OR NEW.tipo IS DISTINCT FROM OLD.tipo", "OR false"),
        [A_MD5],
      ],
      [`ALTER FUNCTION ${FN} STABLE`, [A_ATRIB]],
      [`ALTER FUNCTION ${FN} SECURITY DEFINER`, [A_ATRIB]],
      [`ALTER FUNCTION ${FN} SET search_path = public, pg_temp`, [A_ATRIB]],
      [`ALTER FUNCTION ${FN} RESET search_path`, [A_ATRIB]],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO anon`, [A_EXEC]],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`, [A_EXEC]],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, [A_EXEC]],
      // outra sobrecarga: so a contagem
      [
        `CREATE FUNCTION public.pedidos_de_privacidade__carimbar(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
        [A_SOBRE],
      ],
      // o gatilho
      [`ALTER TABLE ${T} DISABLE TRIGGER ${TRG}`, [A_TRG]],
      [`ALTER TABLE ${T} ENABLE ALWAYS TRIGGER ${TRG}`, [A_TRG]],
      [`DROP TRIGGER ${TRG} ON ${T}`, [A_TRG]],
      [
        ladrilho(`AFTER UPDATE ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`),
        [A_TRG],
      ],
      [
        ladrilho(
          `BEFORE UPDATE OF situacao ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        ),
        [A_TRG],
      ],
      [
        ladrilho(
          `BEFORE INSERT OR UPDATE ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        ),
        [A_TRG],
      ],
      [
        ladrilho(
          `BEFORE UPDATE ON ${T} FOR EACH STATEMENT EXECUTE FUNCTION ${FN}`,
        ),
        [A_TRG],
      ],
      [
        ladrilho(
          `BEFORE UPDATE ON ${T} FOR EACH ROW WHEN (old.situacao = 'aberto') EXECUTE FUNCTION ${FN}`,
        ),
        [A_TRG],
      ],
      // um gatilho a mais na tabela
      [
        `CREATE TRIGGER zz_extra BEFORE DELETE ON ${T} FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        [A_TRG],
      ],
      // o gatilho de mesmo nome executando OUTRA funcao
      [
        [
          `CREATE FUNCTION public.zz39_outro() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
          ...ladrilho(
            `BEFORE UPDATE ON ${T} FOR EACH ROW EXECUTE FUNCTION public.zz39_outro()`,
          ),
        ],
        [A_TRG],
      ],
    ];
    for (const [mutar, esperadas] of casos)
      await negativo(A, { estado: depois, mutar }, esperadas);
    // tabela com a funcao e o gatilho sumidos: todas as linhas da funcao e do gatilho viram AUSENTE / 0
    const semFuncao = await noEstado(
      async (c) => {
        await depois(c);
        await c.query(`DROP TRIGGER ${TRG} ON ${T}`);
        await c.query(`DROP FUNCTION ${FN}`);
      },
      [A],
    );
    confereRol(A, semFuncao[A]);
    assert.deepEqual(
      reprovadas(semFuncao[A]),
      [A_SOBRE, A_MD5, A_ATRIB, A_EXEC, A_TRG].sort(),
    );
  },
);

prova(
  "VALOR VIVO: a linha reprovada diz QUEM tem o privilegio a mais (PUBLIC e' lido da ACL, nao so deduzido de anon)",
  async () => {
    const vivo = async (mutar, item) => {
      const s = await noEstado(
        async (c) => {
          await depois(c);
          for (const comando of [].concat(mutar)) await c.query(comando);
        },
        [A],
      );
      return s[A].find((l) => l.item === item).vivo;
    };
    // privilegio de COLUNA dado a PUBLIC: a ACL de coluna e' lida (e anon o herda)
    assert.equal(
      await vivo(`GRANT SELECT (id) ON ${T} TO PUBLIC`, A_PUBANON),
      "PUBLIC=SELECT anon=SELECT",
    );
    // privilegio de coluna dado SO a anon: PUBLIC segue nenhum
    assert.equal(
      await vivo(`GRANT SELECT (id) ON ${T} TO anon`, A_PUBANON),
      "PUBLIC=nenhum anon=SELECT",
    );
    // privilegio de TABELA dado a PUBLIC
    assert.equal(
      await vivo(`GRANT INSERT ON ${T} TO PUBLIC`, A_PUBANON),
      "PUBLIC=INSERT anon=INSERT",
    );
    // EXECUTE dado a PUBLIC: os tres ficam `sim` (PUBLIC pela ACL, anon e authenticated por heranca)
    assert.equal(
      await vivo(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, A_EXEC),
      "PUBLIC=sim anon=sim authenticated=sim",
    );
    assert.equal(
      await vivo(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`, A_EXEC),
      "PUBLIC=nao anon=sim authenticated=nao",
    );
    assert.equal(
      await vivo(`GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`, A_EXEC),
      "PUBLIC=nao anon=nao authenticated=sim",
    );
  },
);

prova(
  "NEGATIVO 39b: resto de meia migration e dependencia que falta reprovam SO a SUA linha",
  async () => {
    const mut = async (mutar, esperadas) =>
      negativo(B, { estado: antes, mutar }, esperadas);
    await mut(`CREATE TABLE ${T} (id integer)`, [B_TABELA]);
    await mut(`CREATE VIEW ${T} AS SELECT 1 AS id`, [B_TABELA]);
    await mut(
      [
        "CREATE TABLE public.zz39 (a integer)",
        "CREATE INDEX uq_pedidos_de_privacidade_um_aberto ON public.zz39 (a)",
      ],
      [B_INDICES],
    );
    await mut(
      [
        "CREATE TABLE public.zz39 (a integer)",
        "CREATE INDEX idx_pedidos_de_privacidade_situacao_criado ON public.zz39 (a)",
      ],
      [B_INDICES],
    );
    await mut(
      `CREATE FUNCTION public.pedidos_de_privacidade__carimbar() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
      [B_FUNCAO],
    );
    await mut(
      `CREATE FUNCTION public.pedidos_de_privacidade__carimbar(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`,
      [B_FUNCAO],
    );
    await mut(
      [
        "CREATE TABLE public.zz39 (a integer)",
        `CREATE FUNCTION public.zz39f() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'`,
        `CREATE TRIGGER ${TRG} BEFORE UPDATE ON public.zz39 FOR EACH ROW EXECUTE FUNCTION public.zz39f()`,
      ],
      [B_GATILHO],
    );
    await mut("ALTER FUNCTION auth.uid() RENAME TO uid_zz39", [B_UID]);
    await mut("ALTER FUNCTION public.rls_admin_atual() RENAME TO rls_zz39", [
      B_RLS,
    ]);
    // sem auth.users nao ha o que referenciar: a dependencia e o REFERENCES reprovam juntos
    await mut("ALTER TABLE auth.users RENAME TO users_zz39", [B_USERS, B_REF]);
    // a migration inteira por cima: tudo da migration reprova (as quatro linhas dos objetos)
    await negativo(B, { estado: antes, mutar: [MIG] }, [
      B_TABELA,
      B_INDICES,
      B_FUNCAO,
      B_GATILHO,
    ]);
  },
);

prova(
  "REFERENCES (39b): o papel alvo sem o privilegio reprova SO a linha dele; com o privilegio, passa; papel que nao existe e' dito",
  async () => {
    const comPapel = (nome) => ({
      ...SQL,
      [B]: SQL[B].split("'postgres'").join(`'${nome}'`),
    });
    assert.equal(
      SQL[B].split("'postgres'").length - 1,
      3,
      "3 usos do papel alvo",
    );
    const ref = async (nome, montar) => {
      const s = await noEstado(
        async (c) => {
          await antes(c);
          if (montar) await montar(c);
        },
        [B],
        { sql: comPapel(nome) },
      );
      confereRol(B, s[B]);
      return s[B];
    };
    // sem REFERENCES: so a linha do REFERENCES, com `nao`
    const sem = await ref(PAPEL_SEM_REF);
    assert.deepEqual(reprovadas(sem), [B_REF]);
    assert.equal(sem.find((l) => l.item === B_REF).vivo, "nao");
    // UPDATE e SELECT nao bastam
    const outros = await ref(PAPEL_SEM_REF, (c) =>
      c.query(`GRANT SELECT, UPDATE, DELETE ON auth.users TO ${PAPEL_SEM_REF}`),
    );
    assert.deepEqual(reprovadas(outros), [B_REF]);
    // com REFERENCES, passa (ate a nivel de tabela inteira)
    const com = await ref(PAPEL_SEM_REF, (c) =>
      c.query(`GRANT REFERENCES ON auth.users TO ${PAPEL_SEM_REF}`),
    );
    assert.deepEqual(reprovadas(com), []);
    // papel que nao existe: a linha diz isso
    const nenhum = await ref("portao39_papel_que_nao_existe");
    assert.deepEqual(reprovadas(nenhum), [B_REF]);
    assert.equal(
      nenhum.find((l) => l.item === B_REF).vivo,
      "papel postgres ausente",
    );
    // e o `postgres` de verdade (superusuario aqui) da `sim`
    const real = await noEstado(antes, [B]);
    assert.equal(real[B].find((l) => l.item === B_REF).vivo, "sim");
  },
);

prova(
  "MEDICAO 39m: rol aberto, so catalogo, e os privilegios de UM papel de teste lidos certo por tabela",
  async () => {
    const textoM = SQL[M];
    assert.equal(
      textoM.split("'postgres'").length - 1,
      4,
      "4 usos do papel alvo",
    );
    const comPapel = textoM.split("'postgres'").join(`'${PAPEL_M}'`);
    await C.query("BEGIN");
    try {
      for (const t of [
        "identities",
        "audit_log_entries",
        "sessions",
        "one_time_tokens",
      ])
        await C.query(`CREATE TABLE auth.${t} (user_id uuid)`);
      // mfa_factors fica AUSENTE de proposito
      await C.query(`GRANT UPDATE ON auth.users TO ${PAPEL_M}`);
      await C.query(`GRANT DELETE ON auth.identities TO ${PAPEL_M}`);
      await C.query(`GRANT UPDATE ON auth.audit_log_entries TO ${PAPEL_M}`);
      await C.query(`GRANT DELETE ON auth.sessions TO ${PAPEL_M}`);
      await C.query(`GRANT USAGE ON SCHEMA auth TO ${PAPEL_M}`);
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      const r = await C.query(comPapel);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["tipo", "objeto", "detalhe"],
        "rol aberto: sem coluna ok",
      );
      assert.equal(r.rows.length, 7);
      const por = Object.fromEntries(r.rows.map((l) => [l.objeto, l.detalhe]));
      assert.match(
        por["quem leu"],
        /^superusuario=false\|bypassrls=true\|papel_postgres_existe=true\|usage_no_schema_auth=true$/,
      );
      assert.equal(por["auth.users"], "UPDATE=sim|DELETE=nao|roteiro=UPDATE");
      assert.equal(
        por["auth.identities"],
        "UPDATE=nao|DELETE=sim|roteiro=UPDATE e DELETE",
      );
      assert.equal(
        por["auth.audit_log_entries"],
        "UPDATE=sim|DELETE=nao|roteiro=UPDATE",
      );
      assert.equal(
        por["auth.sessions"],
        "UPDATE=nao|DELETE=sim|roteiro=DELETE",
      );
      assert.equal(
        por["auth.one_time_tokens"],
        "UPDATE=nao|DELETE=nao|roteiro=DELETE",
      );
      assert.equal(
        por["auth.mfa_factors"],
        "UPDATE=tabela ausente|DELETE=tabela ausente|roteiro=DELETE",
      );
      // so agregado: nada alem de sim/nao/ausente, nenhum id, e-mail ou numero de linha
      for (const l of r.rows)
        assert.doesNotMatch(
          l.detalhe,
          /@|[0-9a-f]{8}-[0-9a-f]{4}-|\d/,
          "so catalogo, nenhum dado",
        );
      await C.query("RESET ROLE");
      // papel que nao existe: o controle e as linhas dizem
      const sem = (
        await C.query(
          textoM.split("'postgres'").join("'portao39_papel_que_nao_existe'"),
        )
      ).rows;
      const porSem = Object.fromEntries(sem.map((l) => [l.objeto, l.detalhe]));
      assert.match(
        porSem["quem leu"],
        /papel_postgres_existe=false\|usage_no_schema_auth=papel ausente$/,
      );
      assert.match(
        porSem["auth.users"],
        /^UPDATE=papel ausente\|DELETE=papel ausente\|/,
      );
    } finally {
      await C.query("ROLLBACK");
    }
    // o `postgres` de verdade: o mesmo desenho (aqui e' superusuario: `sim` nas que existem)
    const real = (await C.query(textoM)).rows;
    assert.equal(real.length, 7);
    assert.equal(
      real.find((l) => l.objeto === "auth.users").detalhe,
      "UPDATE=sim|DELETE=sim|roteiro=UPDATE",
    );
  },
);

prova(
  "PAPEL: o dono da conexao e o papel minimo veem o MESMO resultado; sem USAGE em auth a consulta ERRA (nunca vira positiva)",
  async () => {
    for (const montar of [depois, antes]) {
      const ro = await noEstado(montar, [A, B]);
      const dono = await noEstado(montar, [A, B], { comoDono: true });
      assert.deepEqual(dono, ro);
    }
    // um papel de leitura SEM USAGE no schema auth: a 39b nao devolve veredito (erro 42501), nunca um positivo falso
    await C.query("BEGIN");
    try {
      await antes(C);
      await C.query(`SET LOCAL ROLE ${PAPEL_CEGO}`);
      await assert.rejects(
        () => C.query(SQL[B]),
        (e) => e.code === "42501",
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false certo)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=19 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=9 ok_false=4 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=19 ok_false=18 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=9 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    // Uma linha a menos nao e' o rol: o portao nunca a le como positiva.
    assert.match(veredito(A, d[A].slice(1)), / rol=invalido$/);
    assert.match(veredito(B, a[B].slice(1)), / rol=invalido$/);
    // Uma linha repetida no lugar de outra tambem nao.
    assert.match(
      veredito(B, [a[B][0], ...a[B].slice(0, -1)]),
      / rol=invalido$/,
    );
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  C.on("error", () => {});
  await C.connect();
  const falhas = [];
  try {
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    await C.query(`CREATE ROLE ${PAPEL_SEM_REF} NOLOGIN NOSUPERUSER`);
    await C.query(`CREATE ROLE ${PAPEL_M} NOLOGIN NOSUPERUSER`);
    // sem pg_read_all_data e sem USAGE em auth, mas com o catalogo e o USAGE de public
    await C.query(`CREATE ROLE ${PAPEL_CEGO} NOLOGIN NOSUPERUSER`);
    await C.query(`GRANT USAGE ON SCHEMA public TO ${PAPEL_CEGO}`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${e.message.split("\n").join("\n    ")}`,
        );
      }
    }
  } finally {
    for (const papel of [PAPEL_RO, PAPEL_SEM_REF, PAPEL_M, PAPEL_CEGO]) {
      await C.query(`DROP OWNED BY ${papel}`).catch(() => {});
      await C.query(`DROP ROLE IF EXISTS ${papel}`).catch(() => {});
    }
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do portao 39 falharam.`,
    );
  }
  console.log(
    `\n[pedidos-de-privacidade-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
