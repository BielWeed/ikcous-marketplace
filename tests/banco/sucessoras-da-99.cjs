"use strict";

/**
 * As SUCESSORAS da 20261199000000_portas_do_painel_exigem_admin_atual.sql: as
 * migrations posteriores que redefinem um dos 42 corpos que a 99 deixa.
 *
 * POR QUE ISTO EXISTE: as provas que fixam os corpos da 99 (admin-atual-portas-
 * viva, admin-atual-viva, pagamentos-rpc-viva) medem o estado "99 no ar" — o
 * hash de cada corpo, reaplicar a 99, o rollback dela. O rollback-manual da 99
 * RECUSA (B1_BASELINE_DIVERGENT, rollback-manual-20261199000000…:93) enquanto
 * uma redefinição posterior estiver no ar, e é o comportamento CERTO. Então,
 * antes de medir a 99 isolada, a prova desfaz as sucessoras — cada uma pelo
 * próprio rollback-manual, na ordem INVERSA da aplicação, e só se o corpo
 * "desta" dela estiver no ar.
 *
 * A LISTA É FECHADA E VIGIADA: `conferirLista()` varre supabase/migrations e
 * falha se uma migration mais nova que a 99 redefinir um dos 42 sem estar
 * aqui (a próxima sucessora entra sozinha na falha, não no silêncio).
 *
 * Os hashes vêm do PREFLIGHT de cada sucessora — `('public.f(...)', 'vigente',
 * 'desta')`; a prova de texto de cada uma amarra os dois ao md5 real.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos são montados de literais deste arquivo (a pasta de migrations do
 * repositório e os nomes da lista), nunca de entrada de rede nem de terceiro. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";

// Na ordem de APLICAÇÃO (a de nome de arquivo).
const NOMES = [
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql",
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql",
];

const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const RE_PAR_DE_HASHES =
  /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g;

/** As 42 assinaturas que a 99 redefine (as do preflight dela, com dois hashes). */
function assinaturasDa99() {
  return [...ler(NOME_99).matchAll(RE_PAR_DE_HASHES)].map((m) => m[1]);
}

const SUCESSORAS_DA_99 = NOMES.map((nome) => {
  const pares = [...ler(nome).matchAll(RE_PAR_DE_HASHES)];
  assert.equal(
    pares.length,
    1,
    `${nome}: o preflight tem de citar UM par (vigente, desta)`,
  );
  const [, assinatura, hashVigente, hashDesta] = pares[0];
  return {
    nome,
    rollback: `rollback-manual-${nome}`,
    assinatura,
    hashVigente,
    hashDesta,
    // "No ar" = o corpo vivo é exatamente o que a sucessora deixa.
    noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc
                             WHERE oid = to_regprocedure('${assinatura}')) = '${hashDesta}', false) AS sim`,
  };
});

/** Falha se uma migration mais nova que a 99 redefine um dos 42 sem estar na lista. */
function conferirLista() {
  const nomes42 = assinaturasDa99().map((a) =>
    a.slice("public.".length, a.indexOf("(")),
  );
  assert.equal(nomes42.length, 42, "a 99 deixou de listar 42 corpos");
  const foraDaLista = [];
  for (const arquivo of fs.readdirSync(DIR_MIGRATIONS).sort()) {
    if (!/^\d{14}_.*\.sql$/.test(arquivo)) continue;
    if (arquivo.slice(0, 14) <= NOME_99.slice(0, 14)) continue;
    const semComentarios = ler(arquivo)
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    const criadas = [
      ...semComentarios.matchAll(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-z_0-9]+)\(/gi,
      ),
      ...semComentarios.matchAll(
        /CREATE\s+FUNCTION\s+public\.([a-z_0-9]+)\(/gi,
      ),
    ].map((m) => m[1].toLowerCase());
    const redefine = nomes42.filter((n) => criadas.includes(n));
    if (redefine.length > 0 && !NOMES.includes(arquivo)) {
      foraDaLista.push(`${arquivo} (${redefine.join(", ")})`);
    }
  }
  assert.deepEqual(
    foraDaLista,
    [],
    `migration posterior à 99 redefine corpo dela e não está em tests/banco/sucessoras-da-99.cjs: ${foraDaLista.join("; ")}`,
  );
  for (const s of SUCESSORAS_DA_99) {
    assert.ok(
      fs.existsSync(path.join(DIR_MIGRATIONS, s.rollback)),
      `${s.rollback} ausente`,
    );
  }
}

async function hashVivo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] ? r.rows[0].h : null;
}

/**
 * Desfaz as sucessoras no ar, na ordem inversa da aplicação, cada uma pelo
 * rollback-manual dela (que tem preflight próprio). Devolve os nomes desfeitos.
 * Quem chama decide a transação: dentro de BEGIN/ROLLBACK o estado volta; no
 * clone do rodar-isolado.cjs, fica.
 */
async function desfazerSucessorasDa99(c) {
  conferirLista();
  const desfeitas = [];
  for (const s of [...SUCESSORAS_DA_99].reverse()) {
    if ((await hashVivo(c, s.assinatura)) !== s.hashDesta) continue;
    await c.query(ler(s.rollback));
    assert.equal(
      await hashVivo(c, s.assinatura),
      s.hashVigente,
      `${s.rollback} não devolveu o corpo da 99`,
    );
    desfeitas.push(s.nome);
  }
  return desfeitas;
}

/** Reaplica as sucessoras por cima, na ordem da aplicação (o estado da árvore). */
async function reaplicarSucessorasDa99(c) {
  for (const s of SUCESSORAS_DA_99) {
    await c.query(ler(s.nome));
    assert.equal(
      await hashVivo(c, s.assinatura),
      s.hashDesta,
      `${s.nome}: reaplicar não deixou o corpo dela`,
    );
  }
}

module.exports = {
  SUCESSORAS_DA_99,
  conferirLista,
  desfazerSucessorasDa99,
  reaplicarSucessorasDa99,
};
