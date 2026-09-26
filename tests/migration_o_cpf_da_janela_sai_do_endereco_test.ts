// @ts-nocheck
// O CPF DA JANELA SAI DO ENDEREÇO — prova offline do par 20261182000000 +
// rollback (migration de DADOS: move `customer_data.address.cpf` para
// `customer_data.cpf` nos pedidos gravados entre a 20261171000000 e a
// 20261172000000, ou apaga a chave quando o CPF é inválido / a modalidade é
// local-delivery/store-pickup).
//
// O DEFEITO QUE ESTE PAR FECHA: sem esta migration, todo pedido nacional de
// cliente logado criado naquela janela continua com
// `customer_data.address = {"cpf": "..."}` — um objeto TRUTHY que vence o
// endereço de verdade na cadeia `||` de `src/lib/mappers.ts` (`addressSource`)
// e deixa o endereço de entrega em branco no painel, no comprovante e em
// "Meus pedidos". Cada asserção abaixo está amarrada a uma peça que, se
// sumir, reabre esse furo ou grava o CPF onde ele não deveria ficar.
//
// A prova COM BANCO (o comportamento real das quatro condições de gravação,
// da opção do dono e da verificação final) está no relatório desta tarefa —
// rodada num Postgres 17 efêmero local, nunca em banco real. Este arquivo é
// só a prova ESTÁTICA (sem banco), no padrão de
// tests/migration_a_loja_declara_a_sua_configuracao_publica_test.ts.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261182000000_o_cpf_da_janela_sai_do_endereco.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("preflight recusa quando v23 ou v24 nao carregam o splice v_address_data_sem_cpf da 20261172000000", () => {
  assertStringIncludes(migrationN, "PREFLIGHT_20261182");
  assertStringIncludes(
    migrationN,
    "v_prosrc_v23 IS NULL OR v_prosrc_v23 !~ 'v_address_data_sem_cpf'",
  );
  assertStringIncludes(
    migrationN,
    "v_prosrc_v24 IS NULL OR v_prosrc_v24 !~ 'v_address_data_sem_cpf'",
  );
  // As duas assinaturas conferidas são as MESMAS 13 posições que a
  // 20261172000000 já usa no preflight dela — sem parâmetro novo.
  assertStringIncludes(
    migrationN,
    norm(
      "to_regprocedure( 'public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)' )",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "to_regprocedure( 'public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)' )",
    ),
  );
});

Deno.test("a CTE alvo trava com FOR UPDATE OF o e filtra so' endereco-objeto com chave cpf", () => {
  assertStringIncludes(migrationN, "FOR UPDATE OF o");
  assertStringIncludes(
    migrationN,
    norm(
      "WHERE jsonb_typeof(o.customer_data -> 'address') = 'object' AND (o.customer_data -> 'address') ? 'cpf'",
    ),
  );
  // shipping_option_id normalizado com o MESMO NULLIF(btrim(...)) que a
  // 20261172000000 aplica em v_opcao antes de comparar contra
  // local-delivery/store-pickup.
  assertStringIncludes(
    migrationN,
    norm(
      "NULLIF(btrim(COALESCE(o.customer_data ->> 'shipping_option_id', '')), '') AS opcao",
    ),
  );
});

Deno.test("cpf_ok reproduz a mesma regra da 20261172000000 (v24): 11 digitos, sem sequencia repetida, digito verificador modulo 11 com pesos 11-i/12-i", () => {
  assertStringIncludes(migrationN, "length(a.digitos) <> 11 THEN false");
  assertStringIncludes(
    migrationN,
    norm("a.digitos ~ '^(\\d)\\1{10}$' THEN false"),
  );
  assertStringIncludes(migrationN, "dig.d[i] * (11 - i)");
  assertStringIncludes(migrationN, "dig.d[i] * (12 - i)");
  assertStringIncludes(migrationN, "dig.d[10]");
  assertStringIncludes(migrationN, "dig.d[11]");
});

Deno.test("a chave cpf SEMPRE sai do endereco, e o objeto vazio vira SQL null (nao '{}')", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CASE WHEN (v.endereco - 'cpf') = '{}'::jsonb THEN 'null'::jsonb ELSE (v.endereco - 'cpf') END",
    ),
  );
});

Deno.test("customer_data.cpf na raiz so' nasce com as 4 condicoes juntas: raiz sem cpf, cpf_ok, opcao fora de local/retirada, e fora do bloqueio da opcao do dono", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `WHEN NOT v.raiz_tem_cpf
                   AND v.cpf_ok
                   AND v.opcao IS NOT NULL
                   AND v.opcao NOT IN ('local-delivery', 'store-pickup')
                   AND NOT (
                     v.apagar_em_vez_de_mover_cancelado_sem_etiqueta
                     AND (v.status = 'cancelled' OR v.payment_status = 'expirado')
                     AND v.shipping_label_id IS NULL
                   )
              THEN jsonb_build_object('cpf', v.digitos)
              ELSE '{}'::jsonb`,
    ),
  );
});

Deno.test("a opcao do dono nasce DESLIGADA (false = MOVE, o padrao desta migration)", () => {
  assertStringIncludes(
    migrationN,
    norm("SELECT false AS apagar_em_vez_de_mover_cancelado_sem_etiqueta"),
  );
});

Deno.test("verificacao final aborta se sobrar algum pedido com cpf dentro do endereco", () => {
  assertStringIncludes(migrationN, "VERIFICACAO_FINAL_20261182");
  assertStringIncludes(
    migrationN,
    norm(
      "IF v_restantes > 0 THEN RAISE EXCEPTION 'VERIFICACAO_FINAL_20261182:",
    ),
  );
});

Deno.test("nenhuma outra coluna e' escrita -- so' customer_data no SET do UPDATE", () => {
  const limpo = removerRuido(migration);
  const inicioUpdate = limpo.indexOf("UPDATE public.marketplace_orders o");
  assert(inicioUpdate !== -1, "UPDATE nao encontrado");
  const fimUpdate = limpo.indexOf(";", inicioUpdate);
  assert(fimUpdate !== -1, "fim do UPDATE nao encontrado");
  const blocoUpdate = limpo.slice(inicioUpdate, fimUpdate);
  const setMatches = blocoUpdate.match(/\bSET\b/gi) || [];
  assertEquals(
    setMatches.length,
    1,
    "o UPDATE deve ter um unico SET (so' customer_data), nunca updated_at ou outra coluna",
  );
});

Deno.test("rollback e' um NO-OP documentado -- nenhuma instrucao SQL executavel", () => {
  const limpo = removerRuido(rollback).trim();
  assertEquals(
    limpo,
    "",
    "o rollback desta migration de dados deve ser só comentário (documentado como no-op) -- devolver o CPF para o endereço recriaria o defeito",
  );
});

Deno.test("rollback explica o motivo do no-op (recriar o defeito) e aponta o backup diario como caminho de volta", () => {
  assertStringIncludes(rollback, "NO-OP");
  assertStringIncludes(rollback, "BACKUP DIÁRIO");
  assertStringIncludes(rollback, "PITR");
});
