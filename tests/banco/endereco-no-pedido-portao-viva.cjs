"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 31 (o endereco da compra fica no pedido) -- a
 * migration 20261229000000 --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   31a-conferir-endereco-da-compra-fica-no-pedido.sql      (DEPOIS do apply: 9 linhas)
 *   31b-antes-endereco-da-compra-so-no-ponteiro.sql         (ANTES do apply: 7 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada consulta
 * DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da consulta contra o
 * ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/endereco-no-pedido-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore pode ou nao
 * ja ter a 20261229, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK:
 * o DEPOIS e' a migration aplicada na transacao (idempotente) e o ANTES e' o rollback-manual dela. As consultas rodam
 * nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_31A e ROL_DA_31B), sem
 *             repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 31a POSITIVA e 31b reprova SO as quatro linhas dos corpos (md5 e copia, das duas funcoes); antes
 *             (rollback): 31b POSITIVA e 31a reprova SO essas quatro; aplicar DE NOVO, ida e volta e os arquivos em
 *             CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais no corpo, copia DEPOIS do pedido, sem copia, STABLE, SECURITY INVOKER,
 *             EXECUTE por papel e PUBLIC, funcao ausente), em CADA uma das duas funcoes, reprova EXATAMENTE as linhas
 *             certas. A 31b NAO mede a ACL: ACL aberta ou sem anon nao a reprova (a ACL e' da 31a).
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (31a) ou o da 20261174000000 (31b)
 *             carrega, e o que o banco mede e' o mesmo.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a ACL real e
 * o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/endereco-no-pedido-portao-viva.cjs
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
const {
  desfazerEntregaNaCidadeNaTransacao,
} = require("./a-loja-escolhe-como-entrega-posterior.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "31a-conferir-endereco-da-compra-fica-no-pedido";
const B = "31b-antes-endereco-da-compra-so-no-ponteiro";
const ARQ = "20261229000000_o_endereco_da_compra_fica_no_pedido.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_31A, [B]: CONF.ROL_DA_31B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const VIVA_174 = fs.readFileSync(
  path.join(MIGRATIONS, "20261174000000_formas_de_pagamento_por_loja.sql"),
  "utf8",
);
// A SUCESSORA da v24 (20261236000000: a recusa do total zero pelo app): so o rollback-manual dela entra aqui.
const ROLLBACK_DA_SUCESSORA = fs.readFileSync(
  path.join(
    MIGRATIONS,
    "rollback-manual-20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql",
  ),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const FNS = [V23, V24];
const ASSINATURA =
  "(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)";
const FN = (fn) => `public.${fn}${ASSINATURA}`;

/** Do `CREATE OR REPLACE FUNCTION public.<fn>(` ao `$function$;`: { cabeca (ate o `AS $function$`), corpo }. */
function funcaoDe(sql, fn) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const ab = sql.indexOf("$function$", ini);
  const corpoIni = ab + "$function$".length;
  const fim = sql.indexOf("$function$", corpoIni);
  return { cabeca: sql.slice(ini, corpoIni), corpo: sql.slice(corpoIni, fim) };
}
const NOVA = {
  [V23]: funcaoDe(MIGRATION, V23),
  [V24]: funcaoDe(MIGRATION, V24),
};
const ANTIGA = {
  [V23]: funcaoDe(VIVA_174, V23),
  [V24]: funcaoDe(VIVA_174, V24),
};
const H_NOVO = { [V23]: md5(NOVA[V23].corpo), [V24]: md5(NOVA[V24].corpo) };
const H_ANTIGO = {
  [V23]: md5(ANTIGA[V23].corpo),
  [V24]: md5(ANTIGA[V24].corpo),
};
/** Recria a funcao `fn` com `corpo` (mesma declaracao da migration). */
const recriar = (fn, corpo) => `${NOVA[fn].cabeca + corpo}$function$;`;

const L = (fn, resto) => `${fn}: ${resto}`;
const L_MD5_A = (fn) =>
  L(fn, "corpo e o da 20261229000000, com a copia do endereco (md5)");
const L_COPIA_A = (fn) =>
  L(fn, "o corpo copia o endereco da conta antes de gravar o pedido");
const L_ATRIB = (fn) =>
  L(fn, "atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)");
const L_ACL_A = (fn) =>
  L(
    fn,
    "EXECUTE de sempre (anon, authenticated e service_role sim; PUBLIC nao)",
  );
const L_MD5_B = (fn) =>
  L(fn, "corpo e o da 20261174000000, sem a copia do endereco (md5)");
const L_COPIA_B = (fn) => L(fn, "o corpo ainda NAO copia o endereco da conta");
const CORPOS_A = FNS.flatMap((fn) => [L_MD5_A(fn), L_COPIA_A(fn)]);
const CORPOS_B = FNS.flatMap((fn) => [L_MD5_B(fn), L_COPIA_B(fn)]);

const PAPEL_RO = `portao31_ro_${process.pid}`;
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false } = {}) {
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
      const r = await C.query(SQL[nome]);
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

const depois = (c) => c.query(MIGRATION);
const antes = (c) => c.query(ROLLBACK);

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

/** Guarda: a mutacao tem de ter aplicado; sem ela um mutante que nao faz nada vira falso verde. */
async function guarda(sql) {
  const r = await C.query(sql);
  assert.equal(r.rows[0].aplicou, true, `a mutacao nao aplicou: ${sql}`);
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova(
  "HASH: o md5 literal de cada consulta e' o do corpo que o arquivo carrega (das duas funcoes)",
  async () => {
    assert.deepEqual(H_ANTIGO, {
      [V23]: "59cbccc4aa8762a26cf98f2acf1c721a",
      [V24]: "8381691b7a03a9b232d21de8d756991d",
    });
    for (const fn of FNS) {
      assert.notEqual(H_NOVO[fn], H_ANTIGO[fn]);
      assert.ok(
        SQL[A].includes(`'${H_NOVO[fn]}'`),
        `31a: md5 do corpo novo de ${fn}`,
      );
      assert.ok(
        SQL[B].includes(`'${H_ANTIGO[fn]}'`),
        `31b: md5 do corpo da 20261174 de ${fn}`,
      );
      assert.ok(!SQL[A].includes(H_ANTIGO[fn]) && !SQL[B].includes(H_NOVO[fn]));
      assert.equal(md5(funcaoDe(ROLLBACK, fn).corpo), H_ANTIGO[fn]);
      assert.ok(
        MIGRATION.includes(`'${H_NOVO[fn]}'`) &&
          MIGRATION.includes(`'${H_ANTIGO[fn]}'`),
      );
    }
  },
);

prova(
  "ROL: as 9 linhas da 31a e as 7 da 31b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 9);
    assert.equal(ROL[B].length, 7);
  },
);

prova(
  "DEPOIS (migration aplicada): 31a POSITIVA; 31b reprova SO as quatro linhas dos corpos (md5 e copia, v23 e v24)",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "31a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [...CORPOS_B].sort());
    for (const fn of FNS) {
      assert.equal(s[A].find((l) => l.item === L_MD5_A(fn)).vivo, H_NOVO[fn]);
      assert.equal(s[A].find((l) => l.item === L_COPIA_A(fn)).vivo, "sim");
      assert.equal(
        s[A].find((l) => l.item === L_ACL_A(fn)).vivo,
        "PUBLIC=nao anon=sim authenticated=sim service_role=sim",
      );
    }
  },
);

prova(
  "ANTES (rollback-manual): 31b POSITIVA; 31a reprova SO as quatro linhas dos corpos (md5 e copia, v23 e v24)",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "31b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [...CORPOS_A].sort());
    for (const fn of FNS) {
      assert.equal(s[B].find((l) => l.item === L_MD5_B(fn)).vivo, H_ANTIGO[fn]);
      assert.equal(s[B].find((l) => l.item === L_COPIA_B(fn)).vivo, "nao");
    }
  },
);

prova("IDEMPOTENCIA, IDA E VOLTA e CRLF: o mesmo veredito", async () => {
  const dobro = await noEstado(
    async (c) => {
      await c.query(MIGRATION);
      await c.query(MIGRATION);
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), [...CORPOS_B].sort());
  const idaEVolta = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(MIGRATION);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  const crlf = await noEstado(
    async (c) => {
      await c.query(emCRLF(ROLLBACK));
      await c.query(emCRLF(MIGRATION));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await c.query(emCRLF(ROLLBACK));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
  const dois = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(ROLLBACK);
    },
    [B],
  );
  assert.deepEqual(reprovadas(dois[B]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes]) {
      const comoDono = await noEstado(montar, [A, B], { comoDono: true });
      const comoLeitura = await noEstado(montar, [A, B]);
      assert.deepEqual(comoLeitura[A], comoDono[A]);
      assert.deepEqual(comoLeitura[B], comoDono[B]);
    }
  },
);

/** Um negativo: a mutacao (com guarda) reprova EXATAMENTE `esperadas` na consulta. */
async function negativo(
  consulta,
  { estado = depois, mutar, guardaSql },
  esperadas,
) {
  const s = await noEstado(
    async (c) => {
      await estado(c);
      await c.query(mutar);
      await guarda(guardaSql);
    },
    [consulta],
  );
  assert.deepEqual(reprovadas(s[consulta]), [...esperadas].sort(), mutar);
}

const _exec = (fn, papel) =>
  `SELECT has_function_privilege('${papel}', '${FN(fn)}'::regprocedure, 'EXECUTE') AS aplicou`;
const semExec = (fn, papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${FN(fn)}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (fn) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${FN(fn)}'::regprocedure AND a.grantee = 0) AS aplicou`;
const ausente = (fn) =>
  `SELECT to_regprocedure('${FN(fn)}') IS NULL AS aplicou`;
const doCatalogo = (fn, expr) =>
  `SELECT ${expr} AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN(fn)}')`;

// a mesma copia, mas DEPOIS do pedido gravado: o corpo antigo com a leitura da conta depois do INSERT
const copiaTarde = (fn) => {
  const ancora =
    "    -- 8. Atomic Inventory Update and Order Items Insertion\n";
  assert.equal(ANTIGA[fn].corpo.split(ancora).length, 2);
  return ANTIGA[fn].corpo.replace(
    ancora,
    `    PERFORM 1 FROM public.user_addresses ua WHERE ua.id = p_address_id AND false;\n${ancora}`,
  );
};

prova(
  "NEGATIVO 31a: em CADA funcao, corpo com 1 byte a mais, copia DEPOIS do pedido, sem copia, STABLE, SECURITY INVOKER, ACL por papel e PUBLIC e funcao ausente reprovam SO as linhas certas",
  async () => {
    for (const fn of FNS) {
      const casos = [
        [
          recriar(fn, `${NOVA[fn].corpo} `),
          doCatalogo(fn, "right(prosrc, 1) = ' '"),
          [L_MD5_A(fn)],
        ],
        [
          recriar(fn, copiaTarde(fn)),
          doCatalogo(
            fn,
            "position('FROM public.user_addresses ua' IN prosrc) > position('INSERT INTO public.marketplace_orders' IN prosrc)",
          ),
          [L_MD5_A(fn), L_COPIA_A(fn)],
        ],
        [
          recriar(fn, ANTIGA[fn].corpo),
          doCatalogo(
            fn,
            "position('FROM public.user_addresses ua' IN prosrc) = 0",
          ),
          [L_MD5_A(fn), L_COPIA_A(fn)],
        ],
        [
          `ALTER FUNCTION ${FN(fn)} STABLE`,
          doCatalogo(fn, "provolatile = 's'"),
          [L_ATRIB(fn)],
        ],
        [
          `ALTER FUNCTION ${FN(fn)} SECURITY INVOKER`,
          doCatalogo(fn, "NOT prosecdef"),
          [L_ATRIB(fn)],
        ],
        [
          `ALTER FUNCTION ${FN(fn)} SET search_path TO public, extensions`,
          doCatalogo(
            fn,
            "proconfig = ARRAY['search_path=public, extensions']::text[]",
          ),
          [L_ATRIB(fn)],
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN(fn)} FROM anon`,
          semExec(fn, "anon"),
          [L_ACL_A(fn)],
        ],
        [
          `GRANT EXECUTE ON FUNCTION ${FN(fn)} TO PUBLIC`,
          execPublic(fn),
          [L_ACL_A(fn)],
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN(fn)} FROM authenticated`,
          semExec(fn, "authenticated"),
          [L_ACL_A(fn)],
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN(fn)} FROM service_role`,
          semExec(fn, "service_role"),
          [L_ACL_A(fn)],
        ],
        [
          `DROP FUNCTION ${FN(fn)}`,
          ausente(fn),
          [L_MD5_A(fn), L_COPIA_A(fn), L_ATRIB(fn), L_ACL_A(fn)],
        ],
      ];
      for (const [mutar, guardaSql, esperadas] of casos)
        await negativo(A, { mutar, guardaSql }, esperadas);
    }
  },
);

prova(
  "NEGATIVO 31b: em CADA funcao, corpo novo, corpo antigo com 1 byte a mais, STABLE, SECURITY INVOKER e funcao ausente reprovam SO as linhas certas; ACL aberta ou sem anon NAO reprova (a ACL e' da 31a)",
  async () => {
    for (const fn of FNS) {
      const casos = [
        [
          recriar(fn, `${ANTIGA[fn].corpo} `),
          doCatalogo(fn, "right(prosrc, 1) = ' '"),
          [L_MD5_B(fn)],
        ],
        [
          recriar(fn, NOVA[fn].corpo),
          doCatalogo(
            fn,
            "position('FROM public.user_addresses ua' IN prosrc) > 0",
          ),
          [L_MD5_B(fn), L_COPIA_B(fn)],
        ],
        [
          `ALTER FUNCTION ${FN(fn)} STABLE`,
          doCatalogo(fn, "provolatile = 's'"),
          [L_ATRIB(fn)],
        ],
        [
          `ALTER FUNCTION ${FN(fn)} SECURITY INVOKER`,
          doCatalogo(fn, "NOT prosecdef"),
          [L_ATRIB(fn)],
        ],
        [
          `DROP FUNCTION ${FN(fn)}`,
          ausente(fn),
          [L_MD5_B(fn), L_COPIA_B(fn), L_ATRIB(fn)],
        ],
        // a 31b nao mede a ACL: estes nao a reprovam
        [`GRANT EXECUTE ON FUNCTION ${FN(fn)} TO PUBLIC`, execPublic(fn), []],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN(fn)} FROM anon`,
          semExec(fn, "anon"),
          [],
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${FN(fn)} FROM authenticated`,
          semExec(fn, "authenticated"),
          [],
        ],
      ];
      for (const [mutar, guardaSql, esperadas] of casos)
        await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
    }
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 4)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=9 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=7 ok_false=4 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=9 ok_false=4 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=7 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    // Uma linha a menos nao e' o rol: o portao nunca a le como positiva.
    assert.match(veredito(A, d[A].slice(1)), / rol=invalido$/);
    assert.match(veredito(B, a[B].slice(1)), / rol=invalido$/);
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  C.on("error", () => {});
  await C.connect();
  const falhas = [];
  try {
    // SUCESSORA: a 20261236000000 redefine a v24 em cima do corpo da 20261229. Esta prova mede a 20261229
    // isolada, entao desfaz a sucessora (pelo rollback-manual dela, que so reescreve o corpo e aceita os dois
    // corpos) no clone descartavel antes da primeira prova.
    // SUCESSORA: a 20261244000000 (a loja escolhe como entrega na cidade) redefine a v23 e a v24 em cima do corpo
    // desta migration. Esta prova mede a migration dela ISOLADA, entao desfaz a sucessora (pelo rollback-manual dela, que
    // so reescreve corpos, apaga a trigger e refaz a view) no clone descartavel antes da primeira prova.
    await desfazerEntregaNaCidadeNaTransacao(C);
    await C.query(ROLLBACK_DA_SUCESSORA);
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
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
    await C.query(`DROP OWNED BY ${PAPEL_RO}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do portao 31 falharam.`,
    );
  }
  console.log(
    `\n[endereco-no-pedido-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
