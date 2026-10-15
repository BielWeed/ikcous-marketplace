// @ts-nocheck
// O LUCRO USA O CUSTO DO DIA DA VENDA — prova offline do trio 20261242000000 + rollback-manual + rollback-manual-destrutivo
// (dinheiro e dado de cliente; decisao do dono de 15/10/2026). O COMPORTAMENTO (a venda da loja e a do balcao gravam, o lucro
// novo nao muda e o antigo segue o custo de hoje, o custo nao vaza, o gatilho com falha nao derruba a compra, a devolucao com o
// custo trocado, cmv_estimado, os dois degraus do rollback, a trava do apply, a venda de 200 itens, mutantes, corrida) e'
// provado em tests/banco/custo-do-dia-viva.cjs e o portao da release (consultas 45a/45b/45m, e a 8e/35a/17a aceitando o corpo
// novo) em tests/banco/custo-do-dia-portao-viva.cjs. Aqui fica o que se prova so lendo o texto: hashes (md5 REAL dos corpos),
// nenhum BEGIN/COMMIT de topo, a migration so ADITIVA (nenhuma escrita em dado), o rollback comum NAO apaga a tabela e o
// destrutivo e' um arquivo a parte com a confirmacao, a trava NOWAIT, os REVOKE e o desenho da tabela.
/* eslint-disable security/detect-object-injection --
 * As chaves vêm de constantes FIXAS deste arquivo (nomes de função e md5 conhecidos), nunca de entrada externa. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const CONF = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql";
const lerArq = (caminho) =>
  Deno.readTextFileSync(new URL(caminho, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArq(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const destrutivo = ler(`rollback-manual-destrutivo-${NOME}`);
const md5 = (s) => createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

/** O corpo (prosrc) de `public.<nome>(` no texto: entre `AS $tag$` e o `$tag$;` seguinte. */
function corpoDe(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `sem CREATE OR REPLACE FUNCTION public.${nome}(`);
  const m = /\n\s*AS (\$[a-z_]*\$)/.exec(sql.slice(i));
  assert.ok(m, `sem AS $tag$ em ${nome}`);
  const a = i + m.index + m[0].length;
  const b = sql.indexOf(`${m[1]};`, a);
  assert.ok(b > a, `sem o fecho ${m[1]}; em ${nome}`);
  return sql.slice(a, b);
}

/** So os comentarios saem (removerRuido tira tambem literais e corpos entre $$, que aqui sao justamente o que se confere). */
const semComentarios = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

const ANALYTICS = "get_admin_analytics_v2";
const DRE = "fin_dre";
const GATILHO = "marketplace_order_item__guarda_o_custo_do_dia";
const DESTA = {
  [ANALYTICS]: "dceb62881ebf8fa404ba3ac295041691",
  [DRE]: "afc3e13805ce37819cfdcd094043087c",
  [GATILHO]: "b9be9cba9794deb2c1700bfbc3578454",
};
const VIGENTE = {
  [ANALYTICS]: "05eac70f6bd4360c1f71fd373747ad0e",
  [DRE]: "e58ac49d3881a459b929064a3acb470a",
};

Deno.test("20261242 — o md5 do corpo de cada uma das tres funcoes e o do pre-voo, o da conferencia final e o da 45a", () => {
  const a45 = lerArq(
    "scripts/publicacao/consultas/45a-conferir-custo-do-dia-aplicado.sql",
  );
  for (const [fn, h] of Object.entries(DESTA)) {
    assert.equal(
      md5(corpoDe(migration, fn)),
      h,
      `${fn}: md5 do corpo no arquivo`,
    );
    assert.ok(a45.includes(`'${h}'`), `a 45a cita o md5 de ${fn}`);
    assert.ok(
      migration.split(`'${h}'`).length - 1 >= 2 ||
        fn === GATILHO ||
        migration.includes(h),
      `a migration cita o md5 de ${fn}`,
    );
  }
  // pre-voo e conferencia final: cada hash novo aparece em pelo menos 2 pontos do arquivo (pre-voo e conferencia)
  for (const fn of [ANALYTICS, DRE])
    assert.ok(
      migration.split(DESTA[fn]).length - 1 >= 3,
      `${fn}: o md5 novo aparece no cabecalho, no pre-voo e na conferencia final`,
    );
});

Deno.test("20261242 — os corpos VIGENTES (que o rollback devolve e o pre-voo aceita) sao os md5 reais da 20261234000000 (analytics) e da 20261199000000 (fin_dre)", () => {
  const m34 = ler("20261234000000_o_lucro_so_conta_produto_com_custo.sql");
  const m99 = ler("20261199000000_portas_do_painel_exigem_admin_atual.sql");
  assert.equal(md5(corpoDe(m34, ANALYTICS)), VIGENTE[ANALYTICS]);
  assert.equal(md5(corpoDe(m99, DRE)), VIGENTE[DRE]);
  // o rollback RECRIA os dois corpos byte a byte: o md5 do corpo dentro dele e o vigente
  assert.equal(md5(corpoDe(rollback, ANALYTICS)), VIGENTE[ANALYTICS]);
  assert.equal(md5(corpoDe(rollback, DRE)), VIGENTE[DRE]);
  // os dois arquivos citam os dois md5 de cada funcao (vigente e desta) nos pre-voos
  for (const sql of [migration, rollback])
    for (const fn of [ANALYTICS, DRE]) {
      assert.ok(sql.includes(VIGENTE[fn]), `${fn}: o vigente consta`);
      assert.ok(sql.includes(DESTA[fn]), `${fn}: o novo consta`);
    }
  // 45b: os vigentes
  const b45 = lerArq(
    "scripts/publicacao/consultas/45b-antes-custo-do-dia-base-vigente.sql",
  );
  for (const fn of [ANALYTICS, DRE]) {
    assert.ok(
      b45.includes(`'${VIGENTE[fn]}'`),
      `a 45b cita o vigente de ${fn}`,
    );
    assert.ok(!b45.includes(DESTA[fn]), `a 45b nao cita o corpo novo de ${fn}`);
  }
  assert.ok(!b45.includes(DESTA[GATILHO]));
});

Deno.test("20261242 — sem BEGIN/COMMIT de topo nos tres arquivos (o aplicador abre a transacao) e so objetos novos ou CREATE OR REPLACE de corpo conhecido", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback-manual", rollback],
    ["rollback-manual-destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assert.equal(t.begin, false, `${rotulo}: tem BEGIN de topo`);
    assert.equal(t.commit, false, `${rotulo}: tem COMMIT de topo`);
  }
  const limpo = semComentarios(migration);
  // ADITIVA: nenhuma escrita em dado (a tabela nasce VAZIA, sem backfill) — o unico INSERT e' o do corpo do gatilho
  assert.ok(!/\bDELETE\s+FROM\b/i.test(limpo), "a migration nao apaga dado");
  assert.ok(!/\bTRUNCATE\b/i.test(limpo), "a migration nao trunca");
  assert.ok(
    !/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i.test(limpo),
    "a migration nao apaga tabela nem coluna",
  );
  assert.ok(
    !/\bUPDATE\s+public\./i.test(limpo),
    "a migration nao reescreve linha",
  );
  const inserts = [...limpo.matchAll(/\bINSERT\s+INTO\s+([a-z_.]+)/gi)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    inserts,
    ["public.marketplace_order_item_custo"],
    "o unico INSERT e o do gatilho (nada de backfill)",
  );
  // o INSERT e' o do corpo do gatilho: idempotente e com tratamento de erro que NAO leva a mensagem do erro
  const corpo = corpoDe(migration, GATILHO);
  assert.ok(corpo.includes("ON CONFLICT (item_id) DO NOTHING"));
  assert.ok(corpo.includes("EXCEPTION WHEN OTHERS THEN"));
  assert.ok(
    /RAISE WARNING '[^']*SQLSTATE %[^']*', NEW\.id, SQLSTATE;/.test(corpo),
    "o aviso leva SO o id do item e o SQLSTATE",
  );
  assert.ok(
    !/SQLERRM/.test(corpo),
    "o aviso nunca leva a mensagem do erro (ela pode citar valor)",
  );
  assert.ok(
    corpo.includes("IF NEW.product_id IS NULL THEN"),
    "item sem produto sai antes do bloco (sem subtransacao)",
  );
  assert.ok(
    corpo.includes("AND p.custo IS NOT NULL"),
    "custo ausente nao e gravado",
  );
});

Deno.test("20261242 — a tabela lateral: so do servidor (RLS ligada, SEM FORCE, nenhuma politica, REVOKE ALL dos quatro papeis) e o desenho certo; a funcao do gatilho fechada a todos", () => {
  assert.ok(
    /CREATE TABLE IF NOT EXISTS public\.marketplace_order_item_custo \(\s*item_id uuid PRIMARY KEY REFERENCES public\.marketplace_order_items \(id\) ON DELETE CASCADE,\s*custo numeric NOT NULL,\s*registrado_em timestamptz NOT NULL DEFAULT now\(\)\s*\);/.test(
      migration,
    ),
    "o desenho da tabela",
  );
  assert.ok(
    migration.includes(
      "ALTER TABLE public.marketplace_order_item_custo ENABLE ROW LEVEL SECURITY;",
    ),
  );
  assert.ok(
    !/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(removerRuido(migration)),
    "FORCE RLS faria o INSERT do gatilho falhar em silencio",
  );
  assert.ok(
    !/CREATE\s+POLICY/i.test(removerRuido(migration)),
    "nenhuma politica",
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON TABLE public.marketplace_order_item_custo FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.marketplace_order_item__guarda_o_custo_do_dia() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  // nenhum GRANT em lugar nenhum (a migration so fecha)
  assert.ok(
    !/\bGRANT\b/i.test(removerRuido(migration)),
    "a migration nao concede nada",
  );
  assert.ok(
    !/\bGRANT\b/i.test(removerRuido(rollback)),
    "o rollback nao concede nada (nunca abre EXECUTE)",
  );
  // o pos-voo mede por aclexplode, PUBLIC (grantee 0) e os tres papeis
  assert.ok(
    migration.includes(
      "aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))",
    ),
  );
  assert.ok(
    migration.includes(
      "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    ),
  );
  assert.ok(
    migration.includes("relforcerowsecurity"),
    "o pos-voo recusa FORCE RLS",
  );
  // o gatilho: AFTER INSERT por linha
  assert.ok(
    /CREATE TRIGGER tr_marketplace_order_items_guarda_o_custo_do_dia\s+AFTER INSERT ON public\.marketplace_order_items\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.marketplace_order_item__guarda_o_custo_do_dia\(\);/.test(
      migration,
    ),
  );
});

Deno.test("20261242 — a TRAVA do apply: LOCK ... NOWAIT em laco (4 s), lock_timeout e statement_timeout, na migration e no rollback comum", () => {
  for (const [rotulo, sql, modo] of [
    ["migration", migration, "SHARE ROW EXCLUSIVE"],
    ["rollback-manual", rollback, "ACCESS EXCLUSIVE"],
  ]) {
    assert.ok(
      sql.includes("SET LOCAL lock_timeout = '5s';"),
      `${rotulo}: lock_timeout`,
    );
    assert.ok(
      sql.includes("SET LOCAL statement_timeout = '30s';"),
      `${rotulo}: statement_timeout`,
    );
    assert.ok(
      sql.includes(
        `LOCK TABLE public.marketplace_order_items IN ${modo} MODE NOWAIT;`,
      ),
      `${rotulo}: o LOCK e NOWAIT`,
    );
    assert.ok(sql.includes("WHEN lock_not_available THEN"));
    assert.ok(
      sql.includes("v_tentativa >= 40"),
      `${rotulo}: 40 tentativas de 100 ms (4 s)`,
    );
    assert.ok(sql.includes("pg_sleep(0.1)"));
    assert.ok(
      sql.includes("USING ERRCODE = 'lock_not_available'"),
      `${rotulo}: recusa com 55P03`,
    );
    // a trava vem ANTES de qualquer decisao: o LOCK precede a primeira consulta ao catalogo de funcoes
    const codigo = semComentarios(sql);
    assert.ok(
      codigo.indexOf("LOCK TABLE") < codigo.indexOf("to_regprocedure"),
      `${rotulo}: o LOCK vem antes do pre-voo das funcoes`,
    );
  }
  // nunca um LOCK que espera na fila
  for (const sql of [migration, rollback])
    assert.ok(
      ![...removerRuido(sql).matchAll(/\bLOCK TABLE [^;]*;/gi)].some(
        (m) => !/NOWAIT/i.test(m[0]),
      ),
      "todo LOCK TABLE e NOWAIT",
    );
  assert.ok(
    migration.toLowerCase().includes("fora do horario") ||
      migration.includes("FORA DO HORÁRIO DE PICO"),
    "o cabecalho manda aplicar fora do pico",
  );
});

Deno.test("20261242 — ROLLBACK EM DOIS DEGRAUS: o comum DEIXA a tabela (nenhum DROP TABLE, nenhuma recusa por linhas); o destrutivo e' arquivo a parte, so com o dono e so depois do comum", () => {
  const rb = removerRuido(rollback);
  assert.ok(!/DROP\s+TABLE/i.test(rb), "o rollback comum nao apaga a tabela");
  assert.ok(
    !/CUSTO_DO_DIA_NAO_SE_APAGA_SEM_QUERER/.test(rollback),
    "nao ha mais recusa: a tabela fica, entao nao ha o que recusar",
  );
  assert.ok(
    /DROP TRIGGER IF EXISTS tr_marketplace_order_items_guarda_o_custo_do_dia/.test(
      rb,
    ),
  );
  assert.ok(
    /DROP FUNCTION IF EXISTS public\.marketplace_order_item__guarda_o_custo_do_dia\(\)/.test(
      rb,
    ),
  );
  assert.ok(
    rollback.includes("A TABELA marketplace_order_item_custo FICA"),
    "o cabecalho diz que a tabela fica",
  );
  assert.ok(
    rollback.includes("rollback-manual-destrutivo-20261242000000"),
    "e aponta o segundo degrau",
  );
  // o destrutivo
  const d = removerRuido(destrutivo);
  assert.ok(
    /DROP\s+TABLE\s+IF\s+EXISTS\s+public\.marketplace_order_item_custo/i.test(
      d,
    ),
  );
  assert.ok(destrutivo.includes("SÓ COM O DONO"));
  assert.ok(destrutivo.includes("CUSTO_DO_DIA_SO_COM_O_DONO"));
  assert.ok(destrutivo.includes("app.confirmo_apagar_o_custo_do_dia"));
  assert.ok(destrutivo.includes("'APAGAR'"));
  assert.ok(
    destrutivo.includes("CUSTO_DO_DIA_ROLLBACK_COMUM_PRIMEIRO"),
    "recusa se o gatilho ainda existe",
  );
  // a confirmacao e a recusa vem ANTES do DROP
  assert.ok(
    destrutivo.indexOf("CUSTO_DO_DIA_SO_COM_O_DONO") <
      destrutivo.indexOf("DROP TABLE IF EXISTS"),
  );
  // o destrutivo e' o unico lugar do repositorio que apaga a tabela (e e' rastreado pelo git, como todo rollback-manual-*)
  assert.ok(!/\bDROP\s+TABLE\b/i.test(removerRuido(migration)));
});

Deno.test("20261242 — fin_dre: a devolucao credita o custo do ITEM ORIGINAL (join por order_item_id), sem copiar custo para devolucoes; cmv_estimado e' calculado; os seis usos do analytics decidem item a item", () => {
  const dre = corpoDe(migration, DRE);
  assert.ok(
    dre.includes(
      "LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = di.order_item_id",
    ),
    "a devolucao le o custo do item que saiu",
  );
  assert.equal(
    dre.split("COALESCE(oic.custo, p.custo, 0)").length - 1,
    2,
    "venda e devolucao: o custo do dia, o de hoje e 0",
  );
  assert.ok(
    dre.includes("'cmv_estimado', v_cmv_estimado,"),
    "cmv_estimado e' calculado, nao constante",
  );
  assert.ok(!dre.includes("'cmv_estimado', true"));
  assert.ok(dre.includes("v_cmv_estimado boolean;"));
  assert.ok(
    dre.includes("oic.item_id IS NULL"),
    "estimado = algum item sem o custo do dia",
  );
  // nenhuma coluna de custo nas tabelas da devolucao (devolucao_detalhe devolve to_jsonb da linha ao cliente)
  assert.ok(
    !/ALTER\s+TABLE\s+public\.devolucao/i.test(removerRuido(migration)),
  );
  assert.ok(
    !/ALTER\s+TABLE\s+public\.marketplace_order_items/i.test(
      removerRuido(migration),
    ),
    "o custo nao vai para o item (a cliente le o proprio)",
  );
  const an = corpoDe(migration, ANALYTICS);
  assert.equal(
    an.split(
      "LEFT JOIN public.marketplace_order_item_custo oic ON oic.item_id = oi.id",
    ).length - 1,
    3,
    "lucro por dia, ranking e contador",
  );
  assert.ok(
    an.includes("COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold") ||
      an.includes(
        "COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold",
      ),
  );
  assert.ok(
    an.includes("AND COALESCE(oic.custo, p.custo) IS NULL;"),
    "o contador de produtos sem custo decide por item",
  );
  assert.ok(
    an.includes("AND COALESCE(oic.custo, p.custo) IS NOT NULL"),
    "o filtro do ranking decide por item",
  );
  // o valor de ESTOQUE segue com o custo de hoje (inventario, alertas): nenhuma juncao nova ali
  const estoque = an.slice(0, an.indexOf("daily_items"));
  assert.ok(
    !estoque.includes("oic."),
    "o estoque (inventory) nao usa o custo do dia",
  );
});

Deno.test("45a/45b/45m — no menu e no rpc-ci, rol fechado de 13 e 6 itens no codigo, e a 45m e' UM SELECT so leitura de rol aberto, sem dado pessoal, id nem valor de custo", () => {
  const yaml = lerArq(".github/workflows/conferir-banco-da-loja.yml");
  const rpc = lerArq(".github/workflows/rpc-ci.yml");
  for (const n of [
    "45a-conferir-custo-do-dia-aplicado",
    "45b-antes-custo-do-dia-base-vigente",
    "45m-medir-itens-sem-custo-do-dia",
  ]) {
    assert.ok(yaml.includes(`- ${n}\n`), `${n}: no menu`);
    assert.equal(
      rpc.split(`scripts/publicacao/consultas/${n}.sql`).length - 1,
      2,
      `${n}: nos dois gatilhos de path do rpc-ci`,
    );
    const sql = lerArq(`scripts/publicacao/consultas/${n}.sql`);
    assert.equal(CONF.contarStatements(sql), 1, `${n}: UM statement`);
    const limpo = removerRuido(sql);
    assert.ok(/^\s*WITH\b/i.test(limpo));
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|LOCK)\b/i.test(
        limpo.replace(/'[^']*'/g, "''"),
      ),
      `${n}: palavra de escrita`,
    );
  }
  assert.equal(CONF.ROL_DA_45A.length, 13);
  assert.equal(CONF.ROL_DA_45B.length, 6);
  assert.equal(new Set(CONF.ROL_DA_45A).size, 13);
  assert.equal(new Set(CONF.ROL_DA_45B).size, 6);
  assert.equal(
    CONF.ROL_FECHADO_POR_CONSULTA["45a-conferir-custo-do-dia-aplicado"],
    CONF.ROL_DA_45A,
  );
  assert.equal(
    CONF.ROL_FECHADO_POR_CONSULTA["45b-antes-custo-do-dia-base-vigente"],
    CONF.ROL_DA_45B,
  );
  for (const item of CONF.ROL_DA_45A)
    assert.ok(
      lerArq(
        "scripts/publicacao/consultas/45a-conferir-custo-do-dia-aplicado.sql",
      ).includes(`'${item}'`),
      `45a: "${item}" fora do .sql`,
    );
  for (const item of CONF.ROL_DA_45B)
    assert.ok(
      lerArq(
        "scripts/publicacao/consultas/45b-antes-custo-do-dia-base-vigente.sql",
      ).includes(`'${item}'`),
      `45b: "${item}" fora do .sql`,
    );
  // a 45m: rol ABERTO (tipo/objeto/detalhe, sem coluna ok), nenhum id nem nome nem custo na lista de saida
  const m = lerArq(
    "scripts/publicacao/consultas/45m-medir-itens-sem-custo-do-dia.sql",
  );
  const mm = semComentarios(m);
  assert.ok(!/\bAS ok\b/i.test(mm), "a 45m e medicao: nao tem coluna ok");
  assert.ok(/'controle' AS tipo,\s*'quem leu' AS objeto/.test(mm));
  assert.ok(
    mm.includes("row_security_active"),
    "a guarda de visibilidade da 8j: com RLS valendo o numero e INCONCLUSIVO",
  );
  assert.ok(mm.includes("INCONCLUSIVO"));
  const saida = mm.slice(mm.indexOf("SELECT 'controle' AS tipo"));
  assert.ok(
    !/\boi\.id\b|\bk\.item_id\b|\bk\.custo\b|\bp\.nome\b|\bp\.custo\b.*\|\|/.test(
      saida.replace(/p\.custo IS NOT NULL/g, ""),
    ),
    "a saida nao concatena id, nome ou valor de custo",
  );
});

Deno.test("45a/35a/17a/8e — a 45a e a 35a/17a/8e citam os mesmos tres md5 e a 8e tem as DUAS linhas novas na cadeia de sucessoras", () => {
  const e8 = lerArq(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    e8.includes(`('${ANALYTICS}', '${DESTA[ANALYTICS]}', '20261242000000')`),
  );
  assert.ok(e8.includes(`('${DRE}', '${DESTA[DRE]}', '20261242000000')`));
  const a35 = lerArq(
    "scripts/publicacao/consultas/35a-conferir-lucro-so-com-custo-aplicado.sql",
  );
  assert.ok(
    a35.includes(`'${DESTA[ANALYTICS]}'`),
    "a 35a aceita o corpo da 42",
  );
  assert.ok(
    a35.includes(
      "FILTER (WHERE COALESCE(oic.custo, p.custo) IS NOT NULL), 0) AS profit",
    ),
    "e o marcador novo",
  );
  assert.ok(
    a35.includes("FILTER (WHERE p.custo IS NOT NULL), 0) AS profit"),
    "sem perder o da 34",
  );
  const corpoAn = corpoDe(migration, ANALYTICS);
  const lf = createHash("sha256").update(corpoAn, "utf8").digest("hex");
  const crlf = createHash("sha256")
    .update(corpoAn.replace(/\n/g, "\r\n"), "utf8")
    .digest("hex");
  const a17 = lerArq(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  assert.ok(
    a17.includes(`'${lf}'`) && a17.includes(`'${crlf}'`),
    "a 17a aceita o corpo da 42 (LF e CRLF)",
  );
});
