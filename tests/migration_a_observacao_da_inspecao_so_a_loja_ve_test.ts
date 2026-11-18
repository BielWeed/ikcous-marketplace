// A OBSERVAÇÃO DA INSPEÇÃO É SÓ DA LOJA -- prova offline do par 20261404000000 + rollback (decisão do sócio, 17/11/2026).
// O COMPORTAMENTO (a cliente dona não recebe a nota pela RPC nem lê a coluna direto; o admin atual recebe; outra cliente, rebaixado, service_role,
// reaplicar, rollback, pré-voo, pós-voo, atomicidade sem BEGIN e os mutantes) é provado em
// tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs. Aqui fica o que se prova só lendo o texto.
//
// Riscos: o corpo novo tem de ser o vigente (20261399992000) com SÓ a troca declarada; o rollback tem de ser o vigente BYTE A BYTE; as 34 colunas do
// GRANT têm de ser as da tabela (20261175000000) menos a observação; sem BEGIN/COMMIT de nível superior; nenhuma linha lida para escrita.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

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

Deno.test("404 (fora da release, NAO aditiva: REVOKE por coluna): sem BEGIN/COMMIT de nivel superior, com pre/pos-voo, sem escrever dado e sem tocar a funcao do dinheiro", () => {
  for (const [nome, sql] of [
    [NOME, migration],
    [`rollback-manual-${NOME}`, rollback],
  ] as const) {
    const cod = semComentarios(sql);
    assert.ok(
      !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(cod),
      `${nome}: transacao de topo`,
    );
    // A mesma lista de antes, uma expressao por forma (cada uma simples, sem grupo opcional repetido).
    const escreveOuApaga = [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bDROP\s+(?:TABLE|COLUMN|FUNCTION)\b/i,
      /\bTRUNCATE\s+public\b/i,
      /\bTRUNCATE\s+TABLE\s+public\b/i,
      /\bALTER\s+TABLE\b/i,
    ];
    assert.ok(
      !escreveOuApaga.some((re) => re.test(cod)),
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

// ---- Publicacao: o lote 156 (consultas 156a/156b), registrado em TODOS os lugares que o portao da release le ----
const require = createRequire(import.meta.url);
const lerRepo = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r\n/g,
    "\n",
  );
const A = "156a-conferir-a-observacao-da-inspecao-so-a-loja-ve-aplicado";
const B = "156b-antes-a-observacao-da-inspecao-so-a-loja-ve-base-vigente";
const PROVA_VIVA = "tests/banco/a-observacao-da-inspecao-so-a-loja-ve-viva.cjs";

Deno.test("404: FORA da release (politica) e sem lote no canais; as consultas 156a/156b seguem no menu, de rol fechado de 8 linhas, so catalogo, citam os md5 certos", () => {
  // A 404 tira o SELECT da tabela devolucoes (REVOKE): nao e aditiva, entao se aplica a parte,
  // como a 400. Estar em migrationsForaDaRelease E num lote do canais daria duas decisoes.
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p: { versoes: string[] }) =>
    p.versoes.includes("20261404000000"),
  );
  assert.equal(lote.length, 0, "a 20261404000000 nao tem lote no canais");
  const politica = JSON.parse(lerRepo("scripts/frota/politica.json"));
  const fora = politica.migrationsForaDaRelease.filter(
    (m: { versao: string }) => m.versao === "20261404000000",
  );
  assert.equal(
    fora.length,
    1,
    "a 20261404000000 esta em migrationsForaDaRelease",
  );
  const a = lerRepo(`scripts/publicacao/consultas/${A}.sql`);
  const b = lerRepo(`scripts/publicacao/consultas/${B}.sql`);
  assert.ok(a.includes(`'${H_NOVO}'`) && !b.includes(`'${H_NOVO}'`));
  assert.ok(b.includes(`'${H_VIGENTE}'`) && !a.includes(`'${H_VIGENTE}'`));
  // A observacao: depois nao le, antes le (a unica linha que muda de esperado alem do md5).
  assert.ok(
    a.includes("'devolucoes: authenticated le observacao_inspecao', 'nao'"),
  );
  assert.ok(
    b.includes("'devolucoes: authenticated le observacao_inspecao', 'sim'"),
  );
  for (const sql of [a, b]) {
    const codigo = semComentarios(sql);
    assert.doesNotMatch(
      codigo,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    // so catalogo: nenhuma linha de devolucao (nem a nota de ninguem) e lida
    assert.doesNotMatch(
      codigo,
      /\b(FROM|JOIN)\s+(public\.)?(devolucoes|devolucao_itens|devolucao_eventos|marketplace_orders|profiles)\b/i,
    );
    assert.ok(sql.includes("md5(replace(p.prosrc, chr(13), ''))"));
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [A, B]) {
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 8, `${nome}: rol fechado de 8 linhas`);
    for (const item of rol)
      assert.ok(
        (nome.startsWith("156a") ? a : b).includes(`'${item}'`),
        `${nome}: falta a linha ${item}`,
      );
  }
});

Deno.test("404: registrada nos dois workflows, na lista de rol fechado da release e com UM passo de prova viva no rpc-ci", () => {
  for (const wf of [
    ".github/workflows/conferir-banco-da-loja.yml",
    ".github/workflows/rpc-ci.yml",
  ])
    for (const nome of [A, B])
      assert.ok(lerRepo(wf).includes(nome), `${wf} nao registra ${nome}`);
  const liberacao = lerRepo("scripts/frota/publicar-release.mjs");
  assert.ok(liberacao.includes(`"${A}"`) && liberacao.includes(`"${B}"`));
  const rpc = lerRepo(".github/workflows/rpc-ci.yml");
  // As duas listas de caminhos do rpc-ci (os dois gatilhos) citam as duas consultas.
  for (const nome of [A, B])
    assert.equal(
      rpc.split(`scripts/publicacao/consultas/${nome}.sql`).length - 1,
      2,
      `${nome}: as duas listas de caminhos do rpc-ci`,
    );
  assert.equal(
    rpc.split(PROVA_VIVA).length - 1,
    1,
    "a prova viva tem de ter UM passo no rpc-ci",
  );
});

Deno.test("404: scripts/db-apply.cjs tem entrada NOVA, cada marcador aparece UMA vez no corpo novo e o de antes nao tem a troca", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.ok(
    entrada,
    "sem entrada em VERIFICACOES o apply da migration nao confere o corpo",
  );
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].funcao, "devolucao_detalhe");
  for (const m of entrada[0].esperado) {
    assert.equal(
      NOVO.split(m.texto).length - 1,
      m.vezes,
      `marcador no corpo novo: ${m.texto}`,
    );
  }
  // O marcador da troca nao existe no corpo de antes: o apply distingue "aplicou" de "nao aplicou".
  assert.equal(
    VIGENTE.split("to_jsonb(v_d) - 'observacao_inspecao'").length - 1,
    0,
  );
});

Deno.test("404: a consulta 144a aceita o corpo de antes e o de depois da 404 (normaliza para o antigo)", () => {
  const sql = lerRepo(
    "scripts/publicacao/consultas/144a-conferir-o-item-que-nao-veio-pode-ser-devolvido-de-novo-aplicado.sql",
  );
  assert.ok(sql.includes(`'${H_VIGENTE}', '${H_NOVO}'`));
  assert.ok(sql.includes(`THEN '${H_VIGENTE}' ELSE h END`));
});
