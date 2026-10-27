import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261394200000_a_v23_recusa_o_pagamento_pelo_app.sql";
const nome394 = "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$function$";
const FN = "create_marketplace_order_v23";
const V = "20261394200000";
const definicao = (sql: string, fn = FN) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string, fn = FN) => {
  const d = definicao(sql, fn);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ANTES = "89c99662346d47a4d6b3d13612ca4acb";
const H_DEPOIS = "86a30fe3502bbafd1a507ce03189bc2d";
const FRASE =
  "O pagamento pelo app é feito em outra etapa. Para este pedido, escolha pagar na retirada ou na entrega.";
const MARCA = "USING DETAIL = 'pedido_online_so_na_v24:";
const INI = "    -- 0-ter. O PAGAMENTO PELO APP NÃO ENTRA POR ESTA PORTA";
const FIM = "    -- 0-quater. O FREIO DO PEDIDO DE VISITANTE";

/** O inverso, escrito a parte: tira o 0-ter (do cabecalho ate o 0-quater). */
const inverso = (c: string) => {
  const ini = c.indexOf(INI);
  assert.ok(ini > 0);
  const fim = c.indexOf(FIM, ini);
  assert.ok(fim > ini);
  return c.slice(0, ini) + c.slice(fim);
};

const anterior = ler(`supabase/migrations/${nome394}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("394200: o corpo anterior e' o da 20261394000000; esta migration so acrescenta o 0-ter; o rollback devolve o corpo byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_DEPOIS);
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  // O cabecalho (assinatura, SECURITY DEFINER, search_path, retorno) e' o mesmo.
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  // Desfeito o trecho (inverso escrito a parte), sobra o corpo anterior, byte a byte.
  assert.equal(inverso(corpo(sql)), corpo(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  // A v24 NAO e' tocada por esta migration.
  assert.ok(!sql.includes("create_marketplace_order_v24("));
});

Deno.test("394200: o trecho 0-ter esta onde deve (depois da idempotencia e do 0-bis, antes do 0-quater e de qualquer leitura/baixa) e e' uma recusa unica para todo mundo", () => {
  const c = corpo(sql);
  assert.equal(c.split(MARCA).length - 1, 1);
  assert.equal(c.split("IF p_payment_method = 'online' THEN").length - 1, 1);
  assert.equal(c.split(FRASE).length - 1, 1);
  const pos = (t: string) => {
    const i = c.indexOf(t);
    assert.ok(i >= 0, `nao achei: ${t.slice(0, 50)}`);
    assert.equal(c.split(t).length - 1, 1, `nao e' unico: ${t.slice(0, 50)}`);
    return i;
  };
  const idem = pos("    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO");
  const retornoIdem = pos(
    "            RETURN v_order_id;\n        END IF;\n    END IF;\n",
  );
  const bis = pos("    -- 0-bis. FORMA DE PAGAMENTO DESLIGADA NA LOJA");
  const bisRecusa = pos(
    "RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';",
  );
  const ter = pos(INI);
  const recusa = pos(MARCA);
  const quater = pos(FIM);
  const passo1 = pos(
    "    -- 1. Address Ownership Check (Only if user is logged in)",
  );
  const passo7 = pos("    -- 7. Create Order Header");
  assert.ok(idem < retornoIdem && retornoIdem < bis && bis < bisRecusa);
  assert.ok(
    bisRecusa < ter && ter < recusa && recusa < quater && quater < passo1,
  );
  assert.ok(passo1 < passo7);
  // Antes de QUALQUER leitura de carrinho, trava de linha, INSERT, baixa de estoque ou uso de cupom: o trecho vem antes do primeiro de cada um.
  for (const t of [
    "FOR UPDATE",
    "INSERT INTO public.marketplace_orders",
    "UPDATE public.produtos",
    "UPDATE public.product_variants",
    "UPDATE public.coupons",
    "INSERT INTO public.marketplace_order_items",
    "FROM public.store_config",
  ])
    assert.ok(c.indexOf(t) > recusa, `${t} vem antes da recusa`);
  // A recusa e' simples: sem ERRCODE (P0001, como as demais), sem condicao de sessao (vale para todo mundo), a frase e o identificador.
  const bloco = c.slice(ter, quater).replace(/--[^\n]*/g, "");
  assert.ok(bloco.includes("IF p_payment_method = 'online' THEN"));
  assert.ok(!/ERRCODE/.test(bloco));
  assert.ok(!/v_user_id/.test(bloco));
  assert.ok(bloco.includes(`RAISE EXCEPTION '${FRASE}'`));
  // O resto do corpo nao mudou: o 0-quater (freio do visitante) segue igual.
  assert.equal(c.split("visitante_teto_unidades:").length - 1, 1);
  assert.equal(c.split("visitante_teto_da_loja:").length - 1, 1);
});

Deno.test("394200: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
  for (const texto of [sql, rb]) {
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes("p.proname = 'create_marketplace_order_v23') <> 1"),
    );
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(texto.includes("AND p.pronargs = 13"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(texto.includes("AND pg_get_function_result(p.oid) = 'uuid'"));
    // A ACL: anon, authenticated e service_role sim; PUBLIC nao.
    for (const papel of ["anon", "authenticated", "service_role"])
      assert.ok(
        texto.includes(
          `NOT has_function_privilege('${papel}', v_oid, 'EXECUTE')`,
        ),
      );
    assert.ok(texto.includes("g.privilege_type = 'EXECUTE' AND g.grantee = 0"));
  }
  assert.ok(sql.includes(H_ANTES) && sql.includes(H_DEPOIS));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(sql.includes("v_hash NOT IN (v_vigente, v_desta)"));
  assert.ok(sql.includes(`', '${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.v23online3942_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.v23online3942_rb_atributos')::jsonb"),
  );
  assert.ok(
    sql.includes(
      "a recusa do pagamento pelo app não aparece exatamente uma vez",
    ),
  );
  // O pre-voo manda aplicar as anteriores quando a 394000 nao esta no ar.
  assert.ok(sql.includes("aplique as anteriores antes"));
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("394200: so a 20261397000000 (o desconto do cupom e' arredondado ao centavo) redefine create_marketplace_order_v23 depois dela (a anterior e' a 394000); db-apply exige os marcadores", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  // A 397 e' a SUCESSORA da v23 desta migration (o mesmo corpo com UMA linha trocada); nenhuma outra vem depois.
  assert.deepEqual(
    fontes.slice(-2),
    [nome, "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql"],
    "outra migration redefine create_marketplace_order_v23 depois desta (e da 397)",
  );
  assert.equal(fontes.at(-3), nome394);
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 1);
  assert.equal(checagens[0].funcao, FN);
  assert.equal(
    avaliarChecagem(corpo(sql), checagens[0]).situacao,
    "verificada",
  );
  // Sem o trecho (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
  assert.equal(
    avaliarChecagem(corpo(anterior), checagens[0]).situacao,
    "falhou",
  );
  for (const m of checagens[0].esperado as Array<{ texto: string }>)
    assert.equal(
      avaliarChecagem(corpo(sql).replace(m.texto, "XX"), checagens[0]).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
    );
});

Deno.test("394200: as consultas 111a/111b tem cinco linhas fechadas (a ultima so conta), registradas, e as consultas antigas aceitam o corpo novo", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A = "111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado";
  const B = "111b-antes-a-v23-recusa-o-pagamento-pelo-app-base-vigente";
  for (const [nomeConsulta, hash] of [
    [A, H_DEPOIS],
    [B, H_ANTES],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo, com UMA excecao declarada: a linha informativa CONTA pedidos (count(*), nenhuma linha lida) e a RPC nao e' chamada.
    const semComentarios = consulta.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      semComentarios,
      /FROM public\.(?:produtos|profiles|coupons|store_config|devolucoes|devolucao_itens|product_variants|marketplace_order_items|user_addresses)/,
    );
    assert.equal(
      semComentarios.split("FROM public.marketplace_orders").length - 1,
      2,
      "a unica tabela de dado e' marketplace_orders, so na linha informativa (esperado e vivo)",
    );
    assert.doesNotMatch(
      semComentarios,
      /public\.create_marketplace_order_v2[34]\(/,
    );
    assert.doesNotMatch(
      semComentarios,
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE)\b/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 5);
    assert.ok(rol[4].startsWith("informativo:"));
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) => p.versoes.includes(V));
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, [V]);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/a-v23-recusa-o-pagamento-pelo-app-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-v23-recusa-o-pagamento-pelo-app-viva.cjs",
    ),
  );
  // As consultas antigas que medem o corpo da v23 aceitam o corpo desta migration como sucessor (uma vez cada).
  for (const antiga of [
    "31a-conferir-endereco-da-compra-fica-no-pedido",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
    "81a-conferir-compra-online-trava-preco-e-chave-aplicado",
    "89a-conferir-o-pedido-pelo-app-exige-conta-aplicado",
    "106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado",
  ])
    assert.equal(
      ler(`scripts/publicacao/consultas/${antiga}.sql`).split(H_DEPOIS).length -
        1,
      1,
      `${antiga} nao aceita o corpo da ${V} (uma vez)`,
    );
});

Deno.test("394200: a frase do banco e a regra do front concordam (recusaDoPedido.ts) e a migration ancora a frase", () => {
  const front = ler("src/lib/recusaDoPedido.ts");
  assert.ok(
    front.includes(
      "/^O pagamento pelo app é feito em outra etapa\\. Para este pedido, escolha pagar na retirada ou na entrega\\.$/",
    ),
  );
  assert.ok(sql.includes(FRASE));
  // A mesma frase, so no corpo da v23 (a v24 tem a sua, da 20261384000000).
  assert.equal(corpo(sql).split(FRASE).length - 1, 1);
});
