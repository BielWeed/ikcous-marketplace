// @ts-nocheck
// A REEMISSAO DO REEMBOLSO CONSULTA O MERCADO PAGO ANTES DE PAGAR DE NOVO — prova offline do par 20261226000000 +
// rollback (dinheiro; decisao do dono de 14/10/2026). O COMPORTAMENTO (so cria chave nova quando o MP provou que
// nada saiu, so adota linha incerta, devolucao pelo painel do MP bloqueia, saldo da funcao unica, duplo clique e
// duas conexoes, ator admin atual, ACL, "por fora", diagnostico atomico, pre-voo, conferencia, mutantes) e'
// provado em tests/banco/reemissao-do-reembolso-viva.cjs e o portao da release em
// tests/banco/reemissao-do-reembolso-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a reemissao e' a unica funcao de banco que cria linha de reembolso (dinheiro SAI): ela nao pode confiar em
// is_admin()/is_admin_atual() (verdadeiros para service_role: dentro dela nao conferem nada), a ordem de travas e'
// devolucao -> linhas do pedido (por id) -> pedido; ela decide "adotar OU criar" sob essa trava e nunca as duas; o
// saldo vem da funcao unica; a tabela de diagnostico e' so do servidor; nada existente e' redefinido.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261226000000_a_reemissao_do_reembolso_consulta_o_mercado_pago_antes_de_pagar_de_novo.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const corpoDaTag = (sql, tag) => {
  const a = sql.indexOf(`AS $${tag}$`) + `AS $${tag}$`.length;
  return sql.slice(a, sql.indexOf(`$${tag}$;`, a));
};
const CORPO_DIAG = corpoDaTag(migration, "registrar_diagnostico");
const CORPO_REEM = corpoDaTag(migration, "reemitir");
const CORPO_FORA = corpoDaTag(migration, "por_fora");
const NOMES = {
  registrar_diagnostico_do_estorno: CORPO_DIAG,
  reemitir_reembolso_da_devolucao: CORPO_REEM,
  admin_devolucao_reembolso_por_fora: CORPO_FORA,
};

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
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

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("os tres corpos tem md5 conhecido e diferente; o pre-voo e a conferencia declaram os mesmos hashes e o rollback tambem", () => {
  const hashes = Object.entries(NOMES).map(([nome, corpo]) => [
    nome,
    md5(corpo),
  ]);
  assert.equal(new Set(hashes.map(([, h]) => h)).size, 3);
  for (const [nome, h] of hashes) {
    assert.equal(
      migration.split(`('${nome}', '${h}')`).length - 1,
      2,
      `${nome}: pre-voo e conferencia`,
    );
    assert.equal(
      rollback.split(`('${nome}', '${h}')`).length - 1,
      1,
      `${nome}: rollback`,
    );
  }
  // as funcoes que a migration CHAMA tem o hash conhecido no pre-voo
  for (const h of [
    "9579d2b56b57cf948659936a928dd7dc", // pedido__saldo_a_estornar (20261198000000)
    "769267b826e4629b91da056c28b393da", // devolucao__avisar_reembolso (20261225000000)
  ])
    assert.ok(migration.includes(`'${h}'`), h);
});

Deno.test("so objetos NOVOS: tres CREATE OR REPLACE FUNCTION (os nomes desta migration) e uma CREATE TABLE IF NOT EXISTS; nenhum DROP, nenhum ALTER de objeto existente, nenhum INSERT/UPDATE/DELETE fora dos corpos; nenhuma funcao existente e' redefinida", () => {
  const nomes = [
    ...limpo(migration).matchAll(
      /CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/g,
    ),
  ].map((m) => m[1]);
  assert.deepEqual(nomes.sort(), Object.keys(NOMES).sort());
  assert.equal(
    (limpo(migration).match(/CREATE TABLE/g) || []).length,
    1,
    "uma tabela",
  );
  assert.ok(
    migration.includes(
      "CREATE TABLE IF NOT EXISTS public.order_refund_diagnostico (",
    ),
  );
  const fora = limpo(
    migration
      .replace(CORPO_DIAG, "")
      .replace(CORPO_REEM, "")
      .replace(CORPO_FORA, "")
      .replace(
        /DO \$preflight_20261226\$[\s\S]*?END \$preflight_20261226\$;/,
        "",
      )
      .replace(
        /DO \$conferencia_20261226\$[\s\S]*?END \$conferencia_20261226\$;/,
        "",
      ),
  );
  assert.doesNotMatch(fora, /\bDROP\b/i);
  assert.doesNotMatch(
    fora.replace(
      /ALTER TABLE public\.order_refund_diagnostico ENABLE ROW LEVEL SECURITY/g,
      "",
    ),
    /\bALTER\b/i,
  );
  assert.doesNotMatch(
    fora.replace(/ON DELETE CASCADE/g, ""),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
  // nenhuma funcao que ja existia e' redefinida
  for (const intocada of [
    "admin_devolucao_reemitir_reembolso",
    "solicitar_estorno",
    "concluir_estorno",
    "admin_devolucao_concluir",
    "pedido__saldo_a_estornar",
    "devolucao__avisar_reembolso",
    "devolucao_avisa_o_cliente",
    "cancelar_pedido_com_cobranca",
  ])
    assert.ok(
      !limpo(migration).includes(`FUNCTION public.${intocada}(`),
      `${intocada} redefinida`,
    );
  assert.doesNotMatch(migration, /RAISE\s+(NOTICE|INFO|LOG|DEBUG)/i);
});

Deno.test("a reemissao NAO usa is_admin()/is_admin_atual() (verdadeiros para service_role), confere o role, o ator nas DUAS fontes e a consulta; o 'por fora' usa as duas e exige auth.uid()", () => {
  assert.doesNotMatch(removerRuido(CORPO_REEM), /is_admin(_atual)?\s*\(/);
  assert.ok(
    CORPO_REEM.includes(
      "IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN",
    ),
  );
  assert.ok(CORPO_REEM.includes("FROM auth.users u"));
  assert.ok(CORPO_REEM.includes("FROM public.profiles pr"));
  assert.ok(CORPO_REEM.includes("(u.raw_app_meta_data ->> 'role') = 'admin'"));
  assert.ok(CORPO_REEM.includes("pr.role = 'admin'"));
  assert.ok(
    CORPO_DIAG.includes(
      "IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN",
    ),
  );
  assert.ok(CORPO_FORA.includes("IF auth.uid() IS NULL THEN"));
  assert.ok(CORPO_FORA.includes("IF NOT public.is_admin() THEN"));
  assert.ok(CORPO_FORA.includes("IF NOT public.is_admin_atual() THEN"));
  assert.doesNotMatch(removerRuido(CORPO_FORA), /current_setting\('role'/);
});

Deno.test("ORDEM DE TRAVAS na reemissao e no 'por fora': devolucao FOR UPDATE -> linhas de order_refunds do pedido ORDER BY id FOR UPDATE -> pedido FOR UPDATE; o gatilho de aviso nao trava devolucao", () => {
  for (const [nome, corpo] of [
    ["reemissao", CORPO_REEM],
    ["por fora", CORPO_FORA],
  ]) {
    const d = corpo.indexOf(
      "FROM public.devolucoes WHERE id = p_devolucao_id FOR UPDATE;",
    );
    const l = corpo.indexOf("ORDER BY r.id\n      FOR UPDATE;");
    const p = corpo.indexOf("FROM public.marketplace_orders");
    assert.ok(
      d > 0 && l > d && p > l,
      `${nome}: ordem devolucao < linhas < pedido`,
    );
    assert.ok(
      corpo.slice(p, p + 140).includes("FOR UPDATE"),
      `${nome}: o pedido e' travado`,
    );
  }
});

Deno.test("a reemissao decide ADOTAR ou CRIAR sob a trava, nunca os dois: o INSERT de linha nova so existe depois do ramo de adocao, que sempre retorna; concluir_estorno so e' chamada no ramo de linha incerta; a lista de 'nada saiu' tem exatamente os dois codigos", () => {
  const corpo = CORPO_REEM;
  assert.equal(corpo.split("INSERT INTO public.order_refunds").length - 1, 1);
  assert.equal(corpo.split("PERFORM public.concluir_estorno(").length - 1, 1);
  const ramoIncerto = corpo.indexOf("  ELSE\n");
  const adocao = corpo.indexOf("PERFORM public.concluir_estorno(");
  const retornoAdocao = corpo.indexOf("'ja_existia'");
  const insert = corpo.indexOf("INSERT INTO public.order_refunds");
  assert.ok(ramoIncerto > 0 && ramoIncerto < adocao, "adocao so no ELSE");
  assert.ok(
    adocao < retornoAdocao && retornoAdocao < insert,
    "a adocao retorna antes do INSERT",
  );
  assert.ok(
    corpo.includes(
      "v_diag.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund')",
    ),
  );
  // a linha 'recusado' so e' "sem POST" com post_autorizado_em NULL e sem id do MP
  assert.ok(corpo.includes("v_r.mp_refund_id IS NULL"));
  assert.ok(
    corpo.includes(
      "(v_r.status = 'recusado' AND v_r.post_autorizado_em IS NULL)",
    ),
  );
  // a consulta so tem dois valores; indeterminado nem chega
  assert.ok(corpo.includes("v_consulta NOT IN ('achou', 'nao_achou')"));
  // um reembolso achado para linha que nunca teve POST nunca e' adotado nem cria
  assert.ok(corpo.includes("'detalhe', 'reembolso_do_mp_sem_dono'"));
  // a captura do 23505 e do acima-do-total bloqueia (nunca segue para criar)
  assert.ok(
    corpo.includes(
      "WHEN unique_violation THEN\n        RETURN jsonb_build_object('resultado', 'indeterminado'",
    ),
  );
  assert.ok(corpo.includes("IF SQLERRM LIKE 'estorno_acima_do_total%' THEN"));
});

Deno.test("o saldo vem da funcao unica (nenhuma copia da conta de saldo no corpo) e a devolucao pelo painel do MP bloqueia a criacao", () => {
  assert.ok(
    CORPO_REEM.includes("v_saldo := public.pedido__saldo_a_estornar(v_o.id);"),
  );
  assert.doesNotMatch(CORPO_REEM, /sum\(\s*r\.amount\s*\)/i);
  assert.doesNotMatch(CORPO_REEM, /valor_estornado\s*[-+]/);
  assert.ok(CORPO_REEM.includes("s.solicitado_por = 'sistema'"));
  assert.ok(CORPO_REEM.includes("s.status = 'concluido'"));
  assert.ok(CORPO_REEM.includes("s.mp_chargeback_id IS NULL"));
  assert.ok(
    CORPO_REEM.includes(
      "s.created_at >= COALESCE(v_d.concluida_em, v_d.updated_at)",
    ),
  );
});

Deno.test("ACL explicita: as duas de servidor fechadas a PUBLIC/anon/authenticated e abertas so ao service_role; a do lojista fechada a PUBLIC/anon e aberta ao authenticated; a tabela com RLS ligada, nenhuma policy e REVOKE de todos os papeis de API", () => {
  for (const sig of [
    "public.registrar_diagnostico_do_estorno(uuid, text, boolean, boolean)",
    "public.reemitir_reembolso_da_devolucao(uuid, uuid, uuid, jsonb)",
  ]) {
    assert.ok(
      migration.includes(
        `REVOKE ALL ON FUNCTION ${sig}\n  FROM PUBLIC, anon, authenticated;`,
      ),
      sig,
    );
    assert.ok(
      migration.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`),
      sig,
    );
  }
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.admin_devolucao_reembolso_por_fora(uuid, uuid) FROM PUBLIC, anon;",
    ),
  );
  assert.ok(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.admin_devolucao_reembolso_por_fora(uuid, uuid) TO authenticated;",
    ),
  );
  assert.ok(
    migration.includes(
      "ALTER TABLE public.order_refund_diagnostico ENABLE ROW LEVEL SECURITY;",
    ),
  );
  assert.ok(
    migration.includes(
      "REVOKE ALL ON TABLE public.order_refund_diagnostico FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.doesNotMatch(limpo(migration), /CREATE POLICY/i);
  assert.equal(
    (limpo(migration).match(/\bGRANT\b/g) || []).length,
    3,
    "so os tres GRANT EXECUTE",
  );
  // tres SECURITY DEFINER com search_path=public
  assert.equal(
    migration.split("SECURITY DEFINER\nSET search_path = public").length - 1,
    3,
  );
});

Deno.test("o rollback so apaga o que a migration criou, recusa perder diagnostico sem declaracao e cai as funcoes antes da tabela", () => {
  for (const drop of [
    "DROP FUNCTION IF EXISTS public.admin_devolucao_reembolso_por_fora(uuid, uuid);",
    "DROP FUNCTION IF EXISTS public.reemitir_reembolso_da_devolucao(uuid, uuid, uuid, jsonb);",
    "DROP FUNCTION IF EXISTS public.registrar_diagnostico_do_estorno(uuid, text, boolean, boolean);",
    "DROP TABLE IF EXISTS public.order_refund_diagnostico;",
  ])
    assert.ok(rollback.includes(drop), drop);
  assert.ok(
    rollback.indexOf("DROP FUNCTION IF EXISTS public.reemitir") <
      rollback.indexOf("DROP TABLE IF EXISTS public.order_refund_diagnostico"),
  );
  assert.ok(rollback.includes("ROLLBACK_PERDERIA_DADO"));
  assert.ok(rollback.includes("app.rollback_aceita_perder_diagnostico"));
  assert.equal((limpo(rollback).match(/\bDROP\b/g) || []).length, 4);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE|ALTER)\b/i,
  );
});

Deno.test("a tabela de diagnostico: PK em refund_id com FK em order_refunds ON DELETE CASCADE, contadores nao negativos e nenhuma coluna de texto livre do MP (so o codigo)", () => {
  const i = migration.indexOf(
    "CREATE TABLE IF NOT EXISTS public.order_refund_diagnostico (",
  );
  const t = migration.slice(i, migration.indexOf(");", i));
  assert.ok(
    t.includes(
      "refund_id uuid PRIMARY KEY REFERENCES public.order_refunds (id) ON DELETE CASCADE",
    ),
  );
  assert.ok(
    t.includes(
      "transitorios integer NOT NULL DEFAULT 0 CHECK (transitorios >= 0)",
    ),
  );
  const colunas = [...t.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]);
  assert.deepEqual(colunas, [
    "refund_id",
    "mp_codigo",
    "post_incerto_em",
    "transitorios",
    "criado_em",
    "atualizado_em",
  ]);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261226000000 (sem ela a migration sai PULADA, codigo 2), uma por funcao, todas com contagem exata 1, e os marcadores existem UMA vez nos corpos", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  // o Biome quebra a chave longa em duas linhas (`"nome.sql":\n    [`): aceita as duas formas
  const inicio = new RegExp(`"${NOME}":\\s*\\[`).exec(src);
  assert.ok(inicio, "sem entrada em VERIFICACOES");
  const i = inicio.index;
  const fim = src.slice(i).search(/\n {2,4}\],\n {2}(?:"|\/\/)/);
  assert.ok(fim > 0, "nao achei o fim da entrada");
  const entrada = src.slice(i, i + fim);
  for (const funcao of Object.keys(NOMES))
    assert.ok(entrada.includes(`funcao: "${funcao}"`), funcao);
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  // marcadores POR FUNCAO: cada bloco `funcao: "x"` conta no corpo da propria funcao
  const blocos = entrada.split(/funcao:\s*"/).slice(1);
  assert.equal(blocos.length, 3);
  let total = 0;
  for (const bloco of blocos) {
    const nome = bloco.slice(0, bloco.indexOf('"'));
    // eslint-disable-next-line security/detect-object-injection -- `nome` sai de `funcao: "..."` do db-apply.cjs lido por este teste e e conferido contra as 3 chaves de NOMES logo abaixo.
    const corpo = NOMES[nome];
    assert.ok(corpo, nome);
    const marcadores = [
      ...bloco.matchAll(/texto:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g),
    ].map((m) => m[1]);
    assert.ok(marcadores.length >= 2, `${nome}: marcadores`);
    for (const m of marcadores) {
      total += 1;
      assert.equal(
        corpo.split(m).length - 1,
        1,
        `${nome}: marcador fora do corpo ou repetido: ${m}`,
      );
    }
  }
  assert.equal(total, 8, `8 marcadores, achei ${total}`);
});

Deno.test("a lista L8 de portas do visitante: so a funcao do lojista entra (logado, so authenticated); as duas de servidor nao; a funcao antiga de reemissao nao muda", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
    ),
  );
  const f = lista.funcoes.filter((x) =>
    /admin_devolucao_reembolso_por_fora|registrar_diagnostico_do_estorno|reemitir_reembolso_da_devolucao/.test(
      x.funcao,
    ),
  );
  assert.equal(f.length, 1);
  assert.equal(
    f[0].funcao,
    "public.admin_devolucao_reembolso_por_fora(p_devolucao_id uuid, p_refund_esperado uuid)",
  );
  assert.deepEqual(f[0].executa, ["authenticated"]);
  assert.equal(f[0].situacao, "logado");
  assert.equal(f[0].secdef, true);
  assert.equal(f[0].tipo, "volatil");
  assert.ok(
    lista.funcoes.some((x) =>
      x.funcao.startsWith("public.admin_devolucao_reemitir_reembolso("),
    ),
    "a antiga continua na lista (nao e' redefinida aqui)",
  );
});
