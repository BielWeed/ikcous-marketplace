// @ts-nocheck
// FORMAS DE PAGAMENTO POR LOJA — prova offline de que scripts/db-apply.cjs
// SABE conferir, pós-aplicação real, o que a 20261174000000 prometeu em
// upsert_store_config e em create_marketplace_order_v23/_v24 (padrão de
// tests/upsert_store_config_endereco_e_descricao_test.ts e
// tests/upsert_store_config_frete_gratis_zero_test.ts).
//
// O QUE ESTE TESTE FIXA: a entrada VERIFICACOES["20261174000000_..."] existe,
// tem exatamente as 3 funções esperadas, e cada marcador REPROVA contra um
// corpo sabotado (sem a checagem nova) e VERIFICA contra o corpo real da
// migration. Sem esta prova, uma entrada nova no mapa poderia dizer "ok" para
// qualquer corpo — inclusive um que já perdeu a chamada a
// forma_de_pagamento_aceita() — e ninguém veria a diferença até o incidente.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261174000000_formas_de_pagamento_por_loja.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const migration = Deno.readTextFileSync(MIGRATION_PATH);

/** Extrai o corpo (entre os dollar-quotes) de UMA função pelo nome, do texto
 * real da migration — o mesmo recorte que db-apply.cjs lê do banco depois de
 * aplicar (aqui, do arquivo-fonte, já que não há banco disponível). */
function extrairCorpo(sql, nomeFuncao) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nomeFuncao}(`);
  if (ini === -1) throw new Error(`${nomeFuncao} não encontrada no fonte`);
  const rotulo = /\$\w*\$/g;
  rotulo.lastIndex = ini;
  const abre = rotulo.exec(sql);
  const fim = sql.indexOf(abre[0], abre.index + abre[0].length);
  return sql.slice(abre.index + abre[0].length, fim);
}

Deno.test("VERIFICACOES tem entrada para a 20261174000000, com as 3 funções (v23, v24, upsert_store_config)", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const entrada = VERIFICACOES[NOME];
  assert(entrada !== undefined, "sem entrada em VERIFICACOES para a migration");
  assertEquals(entrada.length, 3);
  assertEquals(entrada.map((c) => c.funcao).sort(), [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
    "upsert_store_config",
  ]);
});

for (const nomeFuncao of [
  "create_marketplace_order_v23",
  "create_marketplace_order_v24",
]) {
  Deno.test(`${nomeFuncao}: contra o corpo REAL da migration, a checagem VERIFICA`, () => {
    // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
    const checagem = VERIFICACOES[NOME].find((c) => c.funcao === nomeFuncao);
    const corpo = extrairCorpo(migration, nomeFuncao);
    const resultado = avaliarChecagem(corpo, checagem);
    assertEquals(resultado.situacao, "verificada");
  });

  Deno.test(`SABOTAGEM ${nomeFuncao}: sem a chamada a forma_de_pagamento_aceita, a checagem REPROVA (não fica muda)`, () => {
    // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
    const checagem = VERIFICACOES[NOME].find((c) => c.funcao === nomeFuncao);
    const corpoSabotado = extrairCorpo(migration, nomeFuncao).replace(
      "IF NOT public.forma_de_pagamento_aceita(p_payment_method) THEN\n        RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';",
      "-- checagem removida por sabotagem do teste",
    );
    const resultado = avaliarChecagem(corpoSabotado, checagem);
    assertEquals(
      resultado.situacao,
      "falhou",
      "entrada que não reprova contra o corpo sem a checagem é pior que ausente",
    );
  });
}

Deno.test("upsert_store_config: contra o corpo REAL da migration, a checagem VERIFICA", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME].find(
    (c) => c.funcao === "upsert_store_config",
  );
  const corpo = extrairCorpo(migration, "upsert_store_config");
  const resultado = avaliarChecagem(corpo, checagem);
  assertEquals(resultado.situacao, "verificada");
});

Deno.test("SABOTAGEM upsert_store_config: com o corpo VELHO (sem o par v_has_formas_pagamento/v_formas_pagamento), a checagem REPROVA", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const checagem = VERIFICACOES[NOME].find(
    (c) => c.funcao === "upsert_store_config",
  );
  // Corpo mínimo plausível de ANTES desta migration — só a assinatura, sem
  // nenhum dos 3 marcadores esperados.
  const corpoVelho = `
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;
  INSERT INTO public.store_config (id) VALUES (1)
  ON CONFLICT (id) DO UPDATE SET updated_at = now()
  RETURNING to_jsonb(public.store_config.*) INTO result;
  RETURN result;
END;
`;
  const resultado = avaliarChecagem(corpoVelho, checagem);
  assertEquals(
    resultado.situacao,
    "falhou",
    "entrada que não reprova contra o corpo velho é pior que ausente",
  );
});
