import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261384000000_o_pedido_pelo_app_exige_conta_e_nao_prende_estoque_de_visitante.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$function$";
const definicao = (sql: string, fn = "create_marketplace_order_v24") => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string) => {
  const d = definicao(sql);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_350 = "e3c124d25632aaa9bcf1995153bc5a7e";
const ANCORA_PASSO_1 =
  "    -- 1. Address Ownership Check (Only if user is logged in)\n";
const COND = "IF p_payment_method = 'online' AND v_user_id IS NULL THEN";
const FRASE =
  "Para pagar pelo app é preciso entrar na sua conta. Sem conta, escolha pagar na retirada ou na entrega.";

const anterior = ler(
  "supabase/migrations/20261350000000_a_compra_online_trava_o_preco_e_espera_a_mesma_chave.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("384: o corpo anterior e' o da 350 e esta migration muda UM bloco (0-ter), antes do passo 1; o rollback devolve a 350 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_350);
  const bloco = corpo(sql).slice(
    corpo(sql).indexOf("    -- 0-ter."),
    corpo(sql).indexOf(ANCORA_PASSO_1),
  );
  assert.ok(bloco.length > 0);
  // Tira o bloco e sobra a 350, byte a byte; o cabecalho da funcao e' o mesmo.
  assert.equal(corpo(sql).replace(bloco, ""), corpo(anterior));
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(md5(corpo(rb)), H_350);
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(definicao(sql, "create_marketplace_order_v23"), "");
  // A condicao e a recusa aparecem uma vez, sem ERRCODE (P0001, como as demais recusas) e com a frase em portugues.
  assert.equal(corpo(sql).split(COND).length - 1, 1);
  assert.ok(bloco.includes(`RAISE EXCEPTION '${FRASE}'`));
  assert.ok(bloco.includes("USING DETAIL = 'pedido_pelo_app_exige_conta:"));
  assert.doesNotMatch(bloco, /ERRCODE/);
  // So 'online' e so quem nao tem sessao.
  assert.ok(bloco.includes(COND));
});

Deno.test("384: a posicao da recusa — depois da idempotencia (passo 0) e do 0-bis, antes de qualquer leitura de carrinho, trava, INSERT, baixa de estoque ou cupom", () => {
  const c = corpo(sql);
  const pos = (trecho: string) => {
    const i = c.indexOf(trecho);
    assert.ok(i >= 0, `trecho ausente: ${trecho.slice(0, 50)}`);
    return i;
  };
  const trava = pos(COND);
  // Depois: a idempotencia (devolve o pedido que ja existe) e a forma de pagamento aceita pela loja.
  assert.ok(trava > pos("    -- 0. IDEMPOTÊNCIA DA CRIAÇÃO"));
  assert.ok(trava > pos("RETURN v_order_id;"));
  assert.ok(
    trava >
      pos("IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN"),
  );
  // Antes: tudo o que le o carrinho, tranca, grava ou baixa.
  for (const depois of [
    ANCORA_PASSO_1,
    "SELECT * INTO v_store_config",
    "FOR NO KEY UPDATE",
    "INSERT INTO public.marketplace_orders",
    "UPDATE public.produtos",
    "UPDATE public.product_variants",
    "UPDATE public.coupons",
    "INSERT INTO public.marketplace_order_items",
  ])
    assert.ok(trava < pos(depois), `a recusa tem de vir antes de: ${depois}`);
});

Deno.test("384: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado", () => {
  const hNovo = md5(corpo(sql));
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
    assert.ok(texto.includes(H_350));
    assert.ok(texto.includes(hNovo));
    // Uma assinatura so, atributos de sempre (SECURITY DEFINER, VOLATILE, search_path), sem PUBLIC e com os tres papeis.
    assert.ok(
      texto.includes("p.proname = 'create_marketplace_order_v24') <> 1"),
    );
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(
      texto.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(
      texto.includes(
        "has_function_privilege('service_role', v_oid, 'EXECUTE')",
      ),
    );
  }
  assert.ok(
    sql.includes(
      "v_hash IS DISTINCT FROM r.hash_vigente AND v_hash IS DISTINCT FROM r.hash_desta",
    ),
  );
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${hNovo}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.pedido384_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.pedido384_rb_atributos')::jsonb"),
  );
  // A v23 (pagar na entrega) nao e tocada: fotografia do hash e comparacao no pos-voo.
  assert.ok(sql.includes("current_setting('ikcous.pedido384_v23')"));
  assert.ok(!definicao(sql).includes("\r"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
});

Deno.test("384: so a 20261394000000 (o pedido de visitante na entrega tem freio) redefine create_marketplace_order_v24 depois dela; db-apply exige as guardas; a lista das sucessoras da 99 fecha", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  // A 394 e' a SUCESSORA da v24 desta migration (o mesmo corpo mais o trecho 0-quater); nenhuma outra vem depois.
  assert.deepEqual(
    fontes.slice(-2),
    [nome, "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql"],
    "outra migration redefine create_marketplace_order_v24 depois da 384 (e da 394)",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.length, 1);
  assert.equal(checagem[0].funcao, "create_marketplace_order_v24");
  assert.equal(avaliarChecagem(corpo(sql), checagem[0]).situacao, "verificada");
  // Sem a recusa (o corpo da 350) a verificacao falha: o marcador pega a regressao.
  assert.equal(
    avaliarChecagem(corpo(anterior), checagem[0]).situacao,
    "falhou",
  );
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registro = SUCESSORAS_DA_99.find(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(
    registro.assinatura,
    "public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
  );
  assert.equal(registro.hashVigente, H_350);
  assert.equal(registro.hashDesta, md5(corpo(sql)));
});

Deno.test("384: 31a, 37a, 47a e 81a aceitam o corpo novo como sucessor; as consultas 89a/89b sao so de catalogo, seis linhas fechadas, e estao registradas", async () => {
  const hNovo = md5(corpo(sql));
  for (const arquivo of [
    "31a-conferir-endereco-da-compra-fica-no-pedido.sql",
    "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado.sql",
    "81a-conferir-compra-online-trava-preco-e-chave-aplicado.sql",
  ])
    assert.ok(
      ler(`scripts/publicacao/consultas/${arquivo}`).includes(`'${hNovo}'`),
      `${arquivo} nao aceita o corpo da 384`,
    );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    ["89a-conferir-o-pedido-pelo-app-exige-conta-aplicado", hNovo],
    ["89b-antes-o-pedido-pelo-app-exige-conta-base-vigente", H_350],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de pedido, produto ou cliente e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config)|public\.create_marketplace_order_v2[34]\(\s*[^j]/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 6);
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
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261384000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.deepEqual(entrada.versoes, ["20261384000000"]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/pedido-pelo-app-exige-conta-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "pedido-pelo-app-exige-conta-viva.cjs",
    ),
  );
});
