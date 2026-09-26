"use strict";

/**
 * PROVA VIVA da migration 20261182000000_o_cpf_da_janela_sai_do_endereco.sql
 * (revisão de risco, rodada 2, achado 2 — "medium, test") contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero.
 *
 * NÃO testa "a 82 acerta o CPF" isoladamente — o contrato desta migration é
 * REPRODUZIR a mesma decisão que `create_marketplace_order_v24` já toma
 * (mesmos 11 dígitos, mesma rejeição de sequência repetida, mesmo dígito
 * verificador módulo 11). Esta prova extrai o BLOCO DE VALIDAÇÃO/GRAVAÇÃO de
 * CPF direto do `pg_proc.prosrc` VIVO da v24 (a fonte da verdade), monta uma
 * função de referência com ele VERBATIM, roda os dois lado a lado sobre
 * milhares de entradas — válidas, aleatórias, DV1/DV2 errados, sequência
 * repetida, formatadas, tamanho errado, tipos malformados (número, string
 * com lixo, `null`, vazio) — e exige 0 divergências. Qualquer mutação na
 * fórmula da 82 (dígito verificador invertido, peso errado, limiar errado —
 * achados M2b/c/d/e da revisão) muda a fronteira de aceitação para MILHARES
 * dessas entradas e faz a comparação divergir em massa, não só num caso.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cpf-da-janela-viva.cjs
 * (depois de provisionar.cjs e aplicar-migrations.cjs, como no rpc-ci.yml)
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O único caminho lido é MIGRATION_PATH, montado com `path.join(__dirname,
 * ...)` a partir de segmentos FIXOS deste arquivo (o próprio repositório) —
 * nunca de entrada de rede nem de terceiro. Mesma convenção de
 * tests/banco/aplicar-migrations.cjs. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "20261182000000_o_cpf_da_janela_sai_do_endereco.sql",
);
const corpoMigracao = fs.readFileSync(MIGRATION_PATH, "utf8");

// Mesmo algoritmo (módulo 11, Receita Federal) que create_marketplace_
// order_v24 e a 82 implementam — usado SÓ para GERAR CPFs fictícios
// válidos/quase válidos para a bateria. Quem DECIDE o resultado, nos dois
// lados da comparação, é sempre o Postgres — nunca este gerador.
function digitoVerificador(base) {
  const d = base.split("").map(Number);
  const soma = d.reduce(
    (acc, digito, i) => acc + digito * (d.length + 1 - i),
    0,
  );
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
function cpfFicticio(base9) {
  const d1 = digitoVerificador(base9);
  const d2 = digitoVerificador(base9 + String(d1));
  return `${base9}${d1}${d2}`;
}
const digitosAleatorios = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

const PROVAS = [];

PROVAS.push({
  nome: "cpf_ok/gravação da 82 bate com o bloco de CPF vivo de create_marketplace_order_v24, 0 divergências em milhares de entradas fictícias",
  corpo: async (cliente) => {
    const src = (
      await cliente.query(
        `select prosrc from pg_proc where oid = to_regprocedure('public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)')`,
      )
    ).rows[0]?.prosrc;
    assert.ok(
      src,
      "create_marketplace_order_v24 não existe no banco efêmero -- migrations não foram aplicadas?",
    );

    const ini = src.indexOf(
      "IF v_opcao NOT IN ('local-delivery', 'store-pickup') AND v_customer_cpf_digits IS NOT NULL THEN",
    );
    const fim = src.indexOf("-- 3. Validation Loop", ini);
    assert.ok(
      ini !== -1 && fim !== -1 && fim > ini,
      "bloco de validação de CPF não encontrado no prosrc vivo da v24 -- a v24 mudou de forma que esta prova não acompanha; revise o anchor acima",
    );
    const bloco = src.slice(ini, fim);
    const decl = src.match(/v_customer_cpf_digits text := [^;]+;/)?.[0];
    const optDecl = src.match(/v_opcao text := [^;]+;/)?.[0];
    const grava = src.match(
      /\|\| CASE WHEN v_opcao NOT IN \('local-delivery', 'store-pickup'\) AND v_customer_cpf_digits IS NOT NULL\s+THEN jsonb_build_object\('cpf', v_customer_cpf_digits\)\s+ELSE '\{\}'::jsonb END/,
    )?.[0];
    assert.ok(
      decl && optDecl && grava,
      "declarações/gravação de CPF não encontradas no prosrc vivo da v24",
    );

    await cliente.query(`CREATE OR REPLACE FUNCTION public._cpf_janela_ref(p_address_data jsonb, p_shipping_option_id text) RETURNS text LANGUAGE plpgsql AS $ref$
DECLARE
  ${optDecl}
  ${decl}
  v_cpf_digitos int[]; v_cpf_soma1 integer; v_cpf_soma2 integer; v_cpf_dv1 integer; v_cpf_dv2 integer;
BEGIN
  ${bloco}
  RETURN ('{}'::jsonb ${grava}) ->> 'cpf';
EXCEPTION WHEN raise_exception THEN RETURN 'RECUSA';
END $ref$`);

    const cpfs = [];
    for (let i = 0; i < 2000; i++) {
      cpfs.push(cpfFicticio(digitosAleatorios(9)));
    } // válidos
    for (let i = 0; i < 2000; i++) cpfs.push(digitosAleatorios(11)); // aleatórios
    for (let i = 0; i < 500; i++) {
      const c = cpfFicticio(digitosAleatorios(9));
      cpfs.push(
        c.slice(0, 10) +
          String((Number(c[10]) + 1 + Math.floor(Math.random() * 9)) % 10),
      );
    } // DV2 errado
    for (let i = 0; i < 500; i++) {
      const c = cpfFicticio(digitosAleatorios(9));
      cpfs.push(
        c.slice(0, 9) +
          String((Number(c[9]) + 1 + Math.floor(Math.random() * 9)) % 10) +
          c[10],
      );
    } // DV1 errado
    for (let k = 0; k < 10; k++) cpfs.push(String(k).repeat(11)); // repetidos
    for (let i = 0; i < 200; i++) {
      const s = cpfFicticio(digitosAleatorios(9));
      cpfs.push(
        `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`,
      );
    } // formatados
    for (let i = 0; i < 200; i++) {
      const s = cpfFicticio(digitosAleatorios(9));
      cpfs.push(s.slice(1)); // 10 dígitos
      cpfs.push(s + digitosAleatorios(1)); // 12 dígitos
      cpfs.push(` ${s} `); // espaços de sobra
    }
    const especiais = [
      null,
      11144477735,
      1114447773,
      "",
      "abc",
      "11144477735a",
      ["11144477735"],
      { x: "11144477735" },
      true,
    ];
    const linhas = cpfs.concat(especiais).map((x) => ({ cpf: x }));

    await cliente.query(
      `insert into marketplace_orders(customer_name, customer_data, total, subtotal)
       select 'bat_cpf_janela', jsonb_build_object('address', x, 'shipping_option_id', 'correios-pac'), 1, 1
         from jsonb_array_elements($1::jsonb) x`,
      [JSON.stringify(linhas)],
    );
    await cliente.query(
      `create temp table _cpf_janela_bat as
       select id, public._cpf_janela_ref(customer_data->'address', customer_data->>'shipping_option_id') as ref
         from marketplace_orders where customer_name = 'bat_cpf_janela'`,
    );

    // Roda a MIGRATION VERBATIM (o mesmo arquivo do repositório) sobre a
    // bateria — inclui o preflight (deve passar, migrations aplicadas do
    // zero) e a verificação final (deve passar, nada mais no banco tem cpf
    // no endereço).
    await cliente.query(corpoMigracao);

    const cmp = (
      await cliente.query(
        `select
            count(*)::int total,
            count(*) filter (where (o.customer_data->>'cpf') is distinct from (case when b.ref = 'RECUSA' then null else b.ref end))::int divergencias
          from marketplace_orders o join _cpf_janela_bat b using (id)`,
      )
    ).rows[0];
    console.log(
      `    bateria: ${cmp.total} entradas fictícias, ${cmp.divergencias} divergências`,
    );
    if (cmp.divergencias > 0) {
      // RODADA 4, achado D (LGPD, repositório PÚBLICO): a versão anterior
      // devolvia `b.ref`/`customer_data->>'cpf'` CRUS para o log do CI — os
      // dois são, na maioria dos casos, CPFs FICTÍCIOS mas com dígito
      // verificador VÁLIDO (gerados por `cpfFicticio` acima só para exercer
      // a fronteira de aceitação) — um CPF válido aleatório PODE coincidir
      // com o de uma pessoa real, mesmo nascido de um gerador sintético.
      // Nunca sai CPF inteiro daqui: só os 2 últimos dígitos (o suficiente
      // para notar SE o dígito verificador é o problema) e um hash (o
      // suficiente para notar que duas linhas divergentes são, de fato,
      // ENTRADAS diferentes, sem reconstituir o valor).
      const div = (
        await cliente.query(
          `select
              (case when b.ref = 'RECUSA' then 'RECUSA'
                    when b.ref is null then null
                    else '***' || right(b.ref, 2) end) as ref_mascarado,
              (case when (o.customer_data->>'cpf') is null then null
                    else '***' || right(o.customer_data->>'cpf', 2) end) as mig_mascarado,
              md5(coalesce(b.ref, '') || '|' || coalesce(o.customer_data->>'cpf', '')) as hash_da_entrada
             from marketplace_orders o join _cpf_janela_bat b using (id)
            where (o.customer_data->>'cpf') is distinct from (case when b.ref = 'RECUSA' then null else b.ref end)
            limit 5`,
        )
      ).rows;
      console.log(
        "    exemplos de divergência, MASCARADOS (v24-ref | 82 | hash):",
        JSON.stringify(div),
      );
    }
    assert.equal(
      cmp.divergencias,
      0,
      `${cmp.divergencias} divergência(s) entre a 82 e o bloco vivo da v24 -- ver exemplos acima`,
    );
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva do CPF da janela (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "cpf_ok/gravação da 82 divergiu do bloco vivo da v24 -- ver acima.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[cpf-da-janela] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do CPF da janela (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
