import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql";
const V = "20261397000000";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );

type Alvo = {
  fn: string;
  delim: string;
  /** A migration que deixa o corpo VIVO antes desta. */
  anterior: string;
  hAntes: string;
  hDepois: string;
  linhaAntes: string;
  linhaDepois: string;
};
const A_PEDIDO =
  "v_discount_amount := (v_calculated_subtotal * v_coupon_val) / 100;";
const D_PEDIDO =
  "v_discount_amount := round((v_calculated_subtotal * v_coupon_val) / 100, 2);";
const ALVOS: Alvo[] = [
  {
    fn: "create_marketplace_order_v23",
    delim: "$function$",
    anterior: "20261394200000_a_v23_recusa_o_pagamento_pelo_app.sql",
    hAntes: "86a30fe3502bbafd1a507ce03189bc2d",
    hDepois: "54b591dc09d67f1abbc9ab3ba5f62f5e",
    linhaAntes: A_PEDIDO,
    linhaDepois: D_PEDIDO,
  },
  {
    fn: "create_marketplace_order_v24",
    delim: "$function$",
    anterior: "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql",
    hAntes: "36c80a107f3ed16853c1c5b2b0cbc911",
    hDepois: "541a210e52ea22fe67e35f2bdd9ef444",
    linhaAntes: A_PEDIDO,
    linhaDepois: D_PEDIDO,
  },
  {
    fn: "validate_coupon_secure_v2",
    delim: "$$",
    anterior: "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql",
    hAntes: "24b35a0fbca43b1f47c7aa940af761af",
    hDepois: "61b90bb7f7c9729abeb94b5596914eb4",
    linhaAntes: "v_discount := (p_subtotal * v_coupon.value) / 100;",
    linhaDepois: "v_discount := round((p_subtotal * v_coupon.value) / 100, 2);",
  },
];
const SHA_VALIDATE_ANTES =
  "c33e930ca389b3568bd256f9363ace8fd3935f0ac73851441e0684a374b11037";
const SHA_VALIDATE_DEPOIS_LF =
  "cd7865bee8797fee5575643f749b56d1e9cc8af852cd74297f9a1f065ac44097";
const SHA_VALIDATE_DEPOIS_CRLF =
  "139fffba24153eff45f66a2885e1eafb92bbffcdc2e6b0203c8b0448b5c267fa";

const definicao = (sql: string, fn: string, delim: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(`AS ${delim}\n`, ini);
  const fim = sql.indexOf(`\n${delim};`, ab);
  return sql.slice(ini, fim + 1 + delim.length);
};
const corpo = (sql: string, a: { fn: string; delim: string }) => {
  const d = definicao(sql, a.fn, a.delim);
  const ab = d.indexOf(`AS ${a.delim}`) + `AS ${a.delim}`.length;
  return d.slice(ab, d.length - a.delim.length);
};
const cabecalho = (sql: string, a: { fn: string; delim: string }) =>
  definicao(sql, a.fn, a.delim).split(`AS ${a.delim}`)[0];
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const anteriores = new Map(
  ALVOS.map((a) => [a.fn, ler(`supabase/migrations/${a.anterior}`)]),
);
const vivo = (a: Alvo) => corpo(anteriores.get(a.fn) as string, a);

Deno.test("397: os tres corpos vigentes sao os das migrations anteriores (hash conferido); esta troca UMA linha em cada; o rollback devolve cada corpo byte a byte", () => {
  for (const a of ALVOS) {
    const antes = vivo(a);
    const depois = corpo(sql, a);
    const volta = corpo(rb, a);
    assert.equal(
      md5(antes),
      a.hAntes,
      `${a.fn}: o corpo vigente nao e o conhecido`,
    );
    assert.equal(md5(depois), a.hDepois, `${a.fn}: hash do corpo novo`);
    assert.equal(
      md5(volta),
      a.hAntes,
      `${a.fn}: o rollback nao devolve o vigente`,
    );
    assert.equal(volta, antes, `${a.fn}: rollback != vigente byte a byte`);
    // O cabecalho (assinatura, SECURITY DEFINER, search_path, retorno) e' o mesmo nos tres arquivos.
    const cab = cabecalho(anteriores.get(a.fn) as string, a);
    assert.equal(cabecalho(sql, a), cab);
    assert.equal(cabecalho(rb, a), cab);
    // UMA linha e' a unica diferenca: o inverso (escrito a parte) devolve o vigente, byte a byte.
    assert.equal(
      depois.split(a.linhaDepois).length - 1,
      1,
      `${a.fn}: a linha nova nao e' unica`,
    );
    assert.equal(
      depois.split(a.linhaAntes).length - 1,
      0,
      `${a.fn}: a conta crua continua no corpo novo`,
    );
    assert.equal(depois.replace(a.linhaDepois, a.linhaAntes), antes);
    assert.equal(
      antes.split(a.linhaAntes).length - 1,
      1,
      `${a.fn}: o vigente nao tem a conta crua exatamente uma vez`,
    );
    // Mesmo numero de linhas e so uma diferente.
    const l1 = antes.split("\n");
    const l2 = depois.split("\n");
    assert.equal(l1.length, l2.length);
    assert.equal(l1.filter((l, i) => l !== l2.at(i)).length, 1);
  }
  assert.equal(sha256(vivo(ALVOS[2])), SHA_VALIDATE_ANTES);
  assert.equal(sha256(corpo(sql, ALVOS[2])), SHA_VALIDATE_DEPOIS_LF);
  assert.equal(
    sha256(corpo(sql, ALVOS[2]).replace(/\n/g, "\r\n")),
    SHA_VALIDATE_DEPOIS_CRLF,
  );
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 3);
});

Deno.test("397: a conta arredondada vem ANTES do teto 'nao passa do subtotal', do total e da conferencia de total; so cupom de porcentagem; valor fixo e frete intactos", () => {
  for (const a of ALVOS) {
    const c = corpo(sql, a);
    const pos = (t: string) => {
      const i = c.indexOf(t);
      assert.ok(i >= 0, `${a.fn}: nao achei ${t.slice(0, 60)}`);
      assert.equal(
        c.split(t).length - 1,
        1,
        `${a.fn}: nao e' unico: ${t.slice(0, 60)}`,
      );
      return i;
    };
    const pedido = a.fn !== "validate_coupon_secure_v2";
    const tipo = pedido
      ? "IF v_coupon_type = 'percentage' THEN"
      : "IF v_coupon.type = 'percentage' THEN";
    const fixo = pedido
      ? "v_discount_amount := v_coupon_val;"
      : "v_discount := v_coupon.value;";
    const teto = pedido
      ? "IF v_discount_amount > v_calculated_subtotal THEN"
      : "IF v_discount > p_subtotal THEN v_discount := p_subtotal; END IF;";
    const iTipo = pos(tipo);
    const iNovo = pos(a.linhaDepois);
    const iFixo = pos(fixo);
    const iTeto = pos(teto);
    assert.ok(
      iTipo < iNovo && iNovo < iFixo && iFixo < iTeto,
      `${a.fn}: ordem tipo -> round -> fixo -> teto`,
    );
    if (pedido) {
      const iTotal = pos(
        "v_calculated_total := GREATEST(0, v_calculated_subtotal + v_shipping_validated - v_discount_amount);",
      );
      const iConf = pos(
        "IF ABS(v_calculated_total - p_total_amount) > 0.05 THEN",
      );
      assert.ok(
        iTeto < iTotal && iTotal < iConf,
        `${a.fn}: teto -> total -> conferencia`,
      );
    }
  }
});

Deno.test("397: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes, fotografia e pos-voo amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
      .split(/\nCREATE OR REPLACE FUNCTION/)
      .map((p, i) => (i === 0 ? p : p.slice(p.search(/\n(?:DO |NOTIFY )/))))
      .join("\n")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    for (const f of ALVOS) assert.ok(texto.includes(`'public.${f.fn}(`));
    assert.ok(texto.includes("p.proname = r.nome) <> 1"));
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(texto.includes("g.privilege_type = 'EXECUTE' AND g.grantee = 0"));
    // A ACL: PUBLIC nao; authenticated sim; nas RPCs do pedido, anon e service_role tambem.
    for (const papel of ["anon", "authenticated", "service_role"])
      assert.ok(
        texto.includes(
          `NOT has_function_privilege('${papel}', v_oid, 'EXECUTE')`,
        ),
      );
  }
  for (const a of ALVOS)
    assert.ok(sql.includes(a.hAntes) && sql.includes(a.hDepois));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(
    sql.includes(
      "v_hash IS DISTINCT FROM r.hash_vigente AND v_hash IS DISTINCT FROM r.hash_desta",
    ),
  );
  assert.ok(rb.includes("IF v_hash IS DISTINCT FROM r.hash_desta THEN"));
  for (const a of ALVOS) {
    assert.ok(rb.includes(`'${a.hDepois}'`));
    assert.ok(rb.includes(`'${a.hAntes}'`));
  }
  assert.ok(
    sql.includes("current_setting('ikcous.cupom397_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.cupom397_rb_atributos')::jsonb"),
  );
  // O pos-voo: a linha nova exatamente uma vez e a conta crua nenhuma.
  assert.ok(sql.includes("nao tem o desconto arredondado exatamente uma vez"));
  assert.ok(sql.includes("ainda tem a conta do desconto sem arredondar"));
  assert.ok(sql.includes("aplique as anteriores antes"));
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("397: e' a ultima redefinicao das tres funcoes da arvore; db-apply exige o marcador de cada uma; a lista das sucessoras da 99 fecha com os tres pares", () => {
  for (const a of ALVOS) {
    const fontes = [...Deno.readDirSync(dir)]
      .map((e) => e.name)
      .filter((n) => /^\d{14}_.*\.sql$/.test(n))
      .sort()
      .filter((n) => definicao(ler(`supabase/migrations/${n}`), a.fn, a.delim));
    assert.equal(
      fontes.at(-1),
      nome,
      `outra migration redefine ${a.fn} depois desta`,
    );
    assert.equal(
      fontes.at(-2),
      a.anterior,
      `${a.fn}: a anterior nao e' a conhecida`,
    );
  }
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 3);
  for (const a of ALVOS) {
    const checagem = checagens.find(
      (c: { funcao: string }) => c.funcao === a.fn,
    );
    assert.ok(checagem, `${a.fn}: sem checagem em db-apply`);
    assert.equal(
      avaliarChecagem(corpo(sql, a), checagem).situacao,
      "verificada",
    );
    // Sem o round (o corpo vigente) a verificacao falha: o marcador pega a regressao.
    assert.equal(avaliarChecagem(vivo(a), checagem).situacao, "falhou");
    for (const m of checagem.esperado as Array<{ texto: string }>)
      assert.equal(
        avaliarChecagem(corpo(sql, a).replace(m.texto, "XX"), checagem)
          .situacao,
        "falhou",
        `${a.fn}: o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registros = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(registros.length, 3);
  for (const a of ALVOS) {
    const r = registros.find((x: { assinatura: string }) =>
      x.assinatura.includes(`.${a.fn}(`),
    );
    assert.ok(r, `${a.fn}: sem entrada nas sucessoras`);
    assert.equal(r.hashVigente, a.hAntes);
    assert.equal(r.hashDesta, a.hDepois);
  }
});

Deno.test("397: as consultas 115a/115b tem treze linhas fechadas, so catalogo, registradas; as consultas antigas aceitam os corpos novos como sucessores (uma vez cada)", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "115a-conferir-o-desconto-do-cupom-e-arredondado-ao-centavo-aplicado";
  const B =
    "115b-antes-o-desconto-do-cupom-e-arredondado-ao-centavo-base-vigente";
  for (const [nomeConsulta, chave] of [
    [A, "hDepois"],
    [B, "hAntes"],
  ] as Array<[string, "hDepois" | "hAntes"]>) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    for (const f of ALVOS) {
      const hash = chave === "hDepois" ? f.hDepois : f.hAntes;
      assert.ok(
        consulta.includes(`'${hash}'`),
        `${nomeConsulta}: sem o hash da ${f.fn}`,
      );
    }
    // So catalogo: nenhuma tabela de dado e nenhuma chamada das RPCs.
    const semComentarios = consulta.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      semComentarios,
      /FROM public\.(?:marketplace_orders|coupons|produtos|profiles|store_config|product_variants|marketplace_order_items)/,
    );
    assert.doesNotMatch(
      semComentarios,
      /public\.(?:create_marketplace_order_v2[34]|validate_coupon_secure_v2)\(\s*(?:p_|\$|')/,
    );
    assert.doesNotMatch(
      semComentarios,
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE)\b/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 13);
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
  // A 115b espera a trinca vigente: "o corpo traz o round" e' 'nao'; a 115a, 'sim'.
  assert.equal(
    ler(`scripts/publicacao/consultas/${A}.sql`).split(
      "arredondado ao centavo (uma vez)', 'sim'",
    ).length - 1,
    3,
  );
  assert.equal(
    ler(`scripts/publicacao/consultas/${B}.sql`).split(
      "arredondado ao centavo (uma vez)', 'nao'",
    ).length - 1,
    3,
  );
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
      "rodar-isolado.cjs tests/banco/o-desconto-do-cupom-e-arredondado-ao-centavo-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "o-desconto-do-cupom-e-arredondado-ao-centavo-viva.cjs",
    ),
  );
  // As consultas antigas que medem o corpo da v23 / v24 aceitam o corpo desta migration como sucessor (uma vez cada).
  const [v23, v24, val] = ALVOS;
  for (const [antiga, alvo] of [
    ["31a-conferir-endereco-da-compra-fica-no-pedido", v23],
    ["47a-conferir-a-loja-escolhe-como-entrega-aplicado", v23],
    ["81a-conferir-compra-online-trava-preco-e-chave-aplicado", v23],
    ["89a-conferir-o-pedido-pelo-app-exige-conta-aplicado", v23],
    ["106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado", v23],
    ["111a-conferir-a-v23-recusa-o-pagamento-pelo-app-aplicado", v23],
    ["31a-conferir-endereco-da-compra-fica-no-pedido", v24],
    ["37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado", v24],
    ["47a-conferir-a-loja-escolhe-como-entrega-aplicado", v24],
    ["81a-conferir-compra-online-trava-preco-e-chave-aplicado", v24],
    ["89a-conferir-o-pedido-pelo-app-exige-conta-aplicado", v24],
    ["106a-conferir-o-pedido-de-visitante-na-entrega-tem-freio-aplicado", v24],
  ] as Array<[string, Alvo]>)
    assert.equal(
      ler(`scripts/publicacao/consultas/${antiga}.sql`).split(alvo.hDepois)
        .length - 1,
      1,
      `${antiga} nao aceita o corpo da ${V} na ${alvo.fn} (uma vez)`,
    );
  // A validacao: 10a e 15a medem o sha256 do corpo (LF | CRLF) e aceitam o desta migration.
  for (const antiga of [
    "10a-conferir-cupons-desligados-aplicado",
    "15a-conferir-cupons-do-checkout-aplicado",
  ]) {
    const t = ler(`scripts/publicacao/consultas/${antiga}.sql`);
    assert.equal(t.split(SHA_VALIDATE_DEPOIS_LF).length - 1, 1, antiga);
    assert.equal(t.split(SHA_VALIDATE_DEPOIS_CRLF).length - 1, 1, antiga);
  }
  assert.ok(val.hDepois.length === 32);
});

Deno.test("397: a conta do desconto em centavos (modelo exato em inteiros do round(numeric,2) do Postgres) fecha a ficha nos casos medidos", () => {
  // round(x, 2) do Postgres em numeric: metade para LONGE do zero, exato (sem ponto flutuante). Aqui em centavos inteiros:
  // desconto = round(subtotal_centavos * pct / 100) com pct em centesimos (10% = 1000); resto >= metade sobe.
  const descontoEmCentavos = (subtotal: number, pctEmCentesimos: number) => {
    const num = subtotal * pctEmCentesimos; // centavos x centesimos de %
    const den = 10000; // 100% em centesimos
    const q = Math.floor(num / den);
    const resto = num - q * den;
    return resto * 2 >= den ? q + 1 : q;
  };
  const casos: Array<[number, number, number, number]> = [
    // subtotal, pct (centesimos), desconto esperado, total esperado (frete 0), todos em centavos
    [2995, 1000, 300, 2695], // 29,95 x 10%  -> 3,00 / 26,95 (antes: 2,995 / 26,96)
    [4995, 1000, 500, 4495], // 49,95 x 10%  -> 5,00 / 44,95 (antes: 5,00 / 44,96)
    [9990, 1500, 1499, 8491], // 99,90 x 15% -> 14,99 / 84,91 (antes: 14,985 -> 14,99 / 84,92)
    [1000, 1500, 150, 850], // 10,00 x 15%  -> 1,50 / 8,50 (sem fracao: nada muda)
    [1000, 10000, 1000, 0], // 100% zera
  ];
  for (const [sub, pct, desconto, total] of casos) {
    const d = descontoEmCentavos(sub, pct);
    assert.equal(d, desconto, `desconto de ${sub} a ${pct}`);
    // O teto: o desconto nunca passa do subtotal.
    assert.ok(Math.min(d, sub) <= sub);
    assert.equal(sub - Math.min(d, sub), total, `total de ${sub} a ${pct}`);
  }
});
