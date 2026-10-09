// @ts-nocheck
// O INÍCIO CONTA ESTOQUE BAIXO PELA REGRA DA LOJA — prova offline do par
// 20261212000000 + rollback (painel simples, onda I, 09/10/2026). O
// COMPORTAMENTO (os nove produtos da semente, o Início = analytics = front,
// controle com o corpo antigo, reaplicar, preflight e rollback no banco) é
// provado em tests/banco/estoque-baixo-uma-regra-viva.cjs; aqui fica o que se
// prova só lendo o texto, no `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: corpo que não é o vigente apaga em
// silêncio a guarda do admin atual (20261199000000) ou outra correção;
// trecho trocado além do `estoque_baixo` muda número do Início sem ninguém
// pedir; hash de preflight que não é o md5 real recusa num banco correto (ou
// aceita corpo errado); rollback que não volta byte a byte deixa a regra
// presa depois de "revertida"; GRANT/REVOKE/DROP escondido muda ACL.
//
// Asserções por `node:assert/strict` (embutido no Deno): o teste roda sem
// baixar nada da rede.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql";
const NOVENTA_E_NOVE = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const HASH_VIGENTE = "ebcafff0ad5efbb70391a2cc93a14247";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $$"));

const RE_CRIA_O_INICIO =
  /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")painel_inicio"?\(/gm;

// O trecho que sai (20261199000000:1588-1596): por variação, limiar 3.
const TRECHO_ANTIGO = `      'estoque_baixo', (SELECT count(*) FROM public.produtos p
                         WHERE p.deleted_at IS NULL AND COALESCE(p.ativo, true)
                           AND (
                             (NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active)
                              AND COALESCE(p.estoque, 0) <= COALESCE(p.estoque_minimo, 3))
                             OR EXISTS (SELECT 1 FROM public.product_variants pv
                                         WHERE pv.product_id = p.id AND pv.active
                                           AND COALESCE(pv.stock_increment, 0) <= COALESCE(p.estoque_minimo, 3))
                           ))
`;
// O trecho que entra: estoque efetivo (soma das variações ATIVAS, ou a
// coluna) <= COALESCE(estoque_minimo, 5) — a régua de get_admin_analytics_v2.
const TRECHO_NOVO = `      'estoque_baixo', (SELECT count(*)
                          FROM public.produtos p
                          LEFT JOIN LATERAL (
                            SELECT count(*) FILTER (WHERE pv.active) AS qtd_ativas,
                                   sum(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
                              FROM public.product_variants pv
                             WHERE pv.product_id = p.id
                          ) v ON true
                         WHERE p.deleted_at IS NULL AND p.ativo = true
                           AND CASE WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                                    ELSE p.estoque END
                               <= COALESCE(p.estoque_minimo, 5))
`;

const antes = (() => {
  const t = ler(NOVENTA_E_NOVE);
  return corpo(funcao(t, "painel_inicio"));
})();
const depois = funcao(migration, "painel_inicio");
const desfeito = funcao(rollback, "painel_inicio");

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("só painel_inicio é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["painel_inicio"]);
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição de painel_inicio antes desta migration (a 20261199000000), com o md5 citado nas notas", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const re = RE_CRIA_O_INICIO;
  const com = nomes.filter((n) => {
    re.lastIndex = 0;
    return re.test(ler(n));
  });
  assert.equal(com.at(-1), NOVENTA_E_NOVE);
  assert.equal(md5(antes), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261199000000 byte a byte, com SÓ o trecho do estoque_baixo trocado", () => {
  assert.equal(
    antes.split(TRECHO_ANTIGO).length - 1,
    1,
    "o trecho antigo tem de estar UMA vez no corpo vigente",
  );
  assert.equal(corpo(depois), antes.replace(TRECHO_ANTIGO, TRECHO_NOVO));
  assert.equal(
    cabecalho(depois),
    cabecalho(funcao(ler(NOVENTA_E_NOVE), "painel_inicio")),
    "assinatura, RETURNS, STABLE, SECURITY DEFINER e search_path iguais",
  );
  assert.ok(!corpo(depois).includes("$$"), "$$ dentro do corpo");
});

Deno.test("o limiar fixo 3 sumiu; a regra é a da loja: COALESCE(p.estoque_minimo, 5) sobre o estoque efetivo", () => {
  const c = corpo(depois);
  assert.ok(!c.includes("COALESCE(p.estoque_minimo, 3)"), "limiar 3 ficou");
  assert.equal(c.split("COALESCE(p.estoque_minimo, 5)").length - 1, 1);
  // A mesma régua de estoque efetivo de get_admin_analytics_v2 (20261199:1740-1752).
  assert.ok(
    c.includes(
      "WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)",
    ),
  );
  assert.ok(c.includes("WHERE p.deleted_at IS NULL AND p.ativo = true"));
  // A guarda do admin atual (20261199000000) continua, uma vez.
  assert.equal(c.split("public.is_admin_atual()").length - 1, 1);
});

Deno.test("o rollback devolve o corpo da 20261199000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
  assert.equal(corpo(desfeito), antes);
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
  assert.equal(cabecalho(desfeito), cabecalho(depois));
});

Deno.test("os preflights citam o md5 REAL dos dois corpos (vigente e desta) e recusam com B1_BASELINE_DIVERGENT", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261212$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261212$"),
  );
  const novo = md5(corpo(depois));
  assert.notEqual(novo, HASH_VIGENTE);
  assert.ok(
    preflight.includes(
      `('public.painel_inicio()', '${HASH_VIGENTE}', '${novo}')`,
    ),
    "preflight da migration",
  );
  assert.ok(
    preflightRb.includes(`('public.painel_inicio()', '${novo}')`),
    "preflight do rollback",
  );
  assert.ok(
    !preflightRb.includes(`'${HASH_VIGENTE}'`),
    "o rollback só desfaz o corpo NOVO",
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql),
      "preflight que só avisa não recusa",
    );
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261212$"],
    [rollback, "DO $preflight_rollback_20261212$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert.ok(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert.ok(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    const c = semComentarios(sql);
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
    ]) {
      assert.ok(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("os cabeçalhos dizem a ordem do rollback (ANTES do da 20261199000000) e apontam a prova viva", () => {
  for (const sql of [migration, rollback]) {
    assert.match(sql, /ANTES do rollback da 20261199000000/);
  }
  assert.ok(migration.includes("tests/banco/estoque-baixo-uma-regra-viva.cjs"));
  // M1 da revisão de risco: a consulta 8e fixa o corpo da 99; aplicar antes
  // do backfill 92-202 deixaria a 8e sem "tudo true" sem ninguém avisar.
  for (const sql of [migration, rollback]) {
    assert.ok(
      sql.includes(
        "-- Aplicar numa loja SÓ depois do backfill 92-202 (consulta 8e positiva)",
      ),
      "o cabeçalho não declara a ordem com a consulta 8e",
    );
  }
  assert.ok(migration.includes("painel_inicio da 20261199"));
  assert.ok(
    migration.includes(`rollback-manual-${NOME}`),
    "o cabeçalho nomeia o rollback",
  );
});
