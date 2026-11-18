// A OBSERVAÇÃO DA INSPEÇÃO É SÓ DA LOJA -- prova offline do par 20261404000000 + rollback (decisão do sócio, 17/11/2026).
// O COMPORTAMENTO (a cliente dona não recebe a nota pela RPC nem lê a coluna direto; o admin atual recebe; outra cliente, rebaixado, service_role,
// reaplicar, rollback, pré-voo, pós-voo, atomicidade sem BEGIN e os mutantes) é provado em
// tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs. Aqui fica o que se prova só lendo o texto.
//
// Riscos: o corpo novo tem de ser o vigente (20261399992000) com SÓ a troca declarada; o rollback tem de ser o vigente BYTE A BYTE; as 34 colunas do
// GRANT têm de ser as da tabela (20261175000000) menos a observação; sem BEGIN/COMMIT de nível superior; nenhuma linha lida para escrita.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const NOME = "20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql";
const ORIGEM =
  "20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
const TABELA = "20261175000000_a_devolucao_nasce_no_pedido.sql";
const ler = (n: string) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r\n/g, "\n");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "a439e320641d553e3a21883c6606c6f2";
const H_NOVO = "b4eb7a928f8a6ff04c34e93f4f56188c";

const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const origem = ler(ORIGEM);

/** O corpo (entre os `$$`) do UM `CREATE OR REPLACE FUNCTION public.devolucao_detalhe(` do arquivo. */
function corpoDe(sql: string): string {
  const marca = "CREATE OR REPLACE FUNCTION public.devolucao_detalhe(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao");
  const ab = sql.indexOf("$$", sql.indexOf(marca)) + 2;
  return sql.slice(ab, sql.indexOf("$$", ab));
}
const VIGENTE = corpoDe(origem);
const NOVO = corpoDe(migration);
const ROLLBACK = corpoDe(rollback);

const TROCA_DE = "  RETURN to_jsonb(v_d) || jsonb_build_object(\n";
const TROCA_PARA =
  '  -- 20261404000000: a "Observação da inspeção" é INTERNA da loja; só o admin ATUAL a recebe (a cliente dona da devolução recebe o resto, sem a chave).\n' +
  "  RETURN CASE WHEN public.is_admin_atual() THEN to_jsonb(v_d) ELSE to_jsonb(v_d) - 'observacao_inspecao' END || jsonb_build_object(\n";

/** Só o código, sem as linhas de comentário (os comentários do cabeçalho citam palavras como BEGIN e GRANT). */
const semComentarios = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

Deno.test("404: o corpo vigente e' o da 3992; o novo e' o pinado e e' o vigente com SO a troca; o rollback devolve o vigente byte a byte", () => {
  assert.equal(md5(VIGENTE), H_VIGENTE);
  assert.equal(md5(NOVO), H_NOVO);
  assert.equal(NOVO.split(TROCA_PARA).length - 1, 1, "a troca aparece uma vez");
  assert.equal(
    NOVO.replace(TROCA_PARA, () => TROCA_DE),
    VIGENTE,
  );
  assert.equal(ROLLBACK, VIGENTE);
  // A declaracao (assinatura, atributos) nao muda; o CREATE OR REPLACE preserva OID, dono e ACL.
  const cabeca = (sql: string) =>
    sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.devolucao_detalhe("),
      sql.indexOf(
        "$$",
        sql.indexOf("CREATE OR REPLACE FUNCTION public.devolucao_detalhe("),
      ),
    );
  assert.equal(cabeca(migration), cabeca(origem));
  assert.equal(cabeca(rollback), cabeca(origem));
  // As duas travas do topo seguem como estao (inclusive a de is_admin() que a 20261199 manteve).
  for (const trava of [
    "NOT public.is_admin())",
    "NOT public.is_admin_atual())",
  ])
    assert.ok(NOVO.includes(trava), `a trava ${trava} sumiu`);
});

Deno.test("404: o GRANT por coluna lista as 34 colunas da tabela (20261175) menos observacao_inspecao, e o REVOKE e' de tabela", () => {
  const criar = ler(TABELA);
  const ini = criar.indexOf("CREATE TABLE IF NOT EXISTS public.devolucoes (");
  const fim = criar.indexOf("\n);", ini);
  const colunas = criar
    .slice(ini, fim)
    .split("\n")
    .map((l) => /^ {2}([a-z_]+) /.exec(l)?.[1])
    .filter((c): c is string => !!c && c !== "CREATE");
  assert.equal(colunas.length, 35, "a tabela tem 35 colunas na 20261175");
  assert.ok(colunas.includes("observacao_inspecao"));

  const cod = semComentarios(migration);
  const m =
    /GRANT SELECT \(([^)]*)\) ON public\.devolucoes TO authenticated;/.exec(
      cod,
    );
  assert.ok(m, "o GRANT por coluna existe");
  const granted = m[1].split(",").map((c) => c.trim());
  assert.equal(granted.length, 34);
  assert.ok(!granted.includes("observacao_inspecao"));
  assert.deepEqual(
    [...granted].sort(),
    colunas.filter((c) => c !== "observacao_inspecao").sort(),
    "as 34 colunas do GRANT sao as da tabela menos a observacao",
  );
  // O pre-voo e o pos-voo conhecem as mesmas 35 / 34 colunas.
  for (const c of colunas)
    assert.ok(cod.includes(`'${c}'`), `pre-voo sem ${c}`);
  assert.ok(
    cod.includes("REVOKE SELECT ON public.devolucoes FROM authenticated;"),
  );
  // A conferencia mede o privilegio EFETIVO (um REVOKE que nao revoga completa com WARNING).
  assert.ok(
    cod.includes(
      "has_column_privilege('authenticated', 'public.devolucoes', 'observacao_inspecao', 'SELECT')",
    ),
  );
  // O rollback devolve a tabela inteira e nenhum grant de coluna.
  const rb = semComentarios(rollback);
  assert.ok(
    rb.includes("REVOKE SELECT ON public.devolucoes FROM authenticated;"),
  );
  assert.ok(rb.includes("GRANT SELECT ON public.devolucoes TO authenticated;"));
});

Deno.test("404: aditiva, sem BEGIN/COMMIT de nivel superior, com pre/pos-voo, sem escrever dado e sem tocar a funcao do dinheiro", () => {
  for (const [nome, sql] of [
    [NOME, migration],
    [`rollback-manual-${NOME}`, rollback],
  ] as const) {
    const cod = semComentarios(sql);
    assert.ok(
      !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(cod),
      `${nome}: transacao de topo`,
    );
    assert.ok(
      !/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|DROP\s+(TABLE|COLUMN|FUNCTION)|TRUNCATE\s+(TABLE\s+)?public|ALTER\s+TABLE)\b/i.test(
        cod,
      ),
      `${nome}: escreve dado ou apaga objeto`,
    );
    assert.ok(
      cod.includes("SET LOCAL lock_timeout"),
      `${nome}: sem lock_timeout`,
    );
  }
  assert.ok(migration.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(migration.includes("POSVOO_20261404000000"));
  // So devolucao_detalhe e' redefinida (a funcao que conclui a devolucao e paga nao e' tocada).
  assert.equal(
    (semComentarios(migration).match(/CREATE OR REPLACE FUNCTION/g) ?? [])
      .length,
    1,
  );
  assert.ok(!semComentarios(migration).includes("admin_devolucao_concluir"));
  // O hash do preflight (a tupla que tests/banco/sucessoras-da-99.cjs le) e' o par vigente/novo.
  assert.ok(
    migration.includes(
      `('public.devolucao_detalhe(uuid)', '${H_VIGENTE}', '${H_NOVO}')`,
    ),
  );
});
