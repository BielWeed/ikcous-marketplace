// @ts-nocheck
// A VENDA NO BALCÃO NASCE INTEIRA — prova offline do par 20261162000000 +
// rollback (LOTE C1 da venda presencial/PDV, tarefa C1.3; desenho em
// docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.1-5.2,
// decisões do dono D1, D2, D3 e D4).
//
// O DEFEITO QUE ESTE TESTE FIXA: a venda de balcão é a ÚNICA escrita de
// dinheiro que ainda não tem dono no servidor. Sem a RPC, a tela do PDV só
// poderia montar a venda com N idas ao banco pelo cliente — pedido, itens,
// baixa de estoque e os dois históricos —, e qualquer uma delas falhando
// deixaria estoque debitado sem pedido (ou pedido sem baixa). Pior: o preço e
// o total viriam do navegador. Cada asserção abaixo está amarrada a uma
// dessas ameaças; sabotar qualquer uma reabre o buraco correspondente.
//
// Esta prova é ESTÁTICA (texto do par migration+rollback). O comportamento —
// baixa XOR, idempotência, históricos e recusa sem admin — é provado contra
// um Postgres de verdade na invariante (d) de tests/banco/invariantes-dinheiro.cjs,
// que o job rpc-ci roda com as migrations aplicadas do zero.
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
const NOME = "20261162000000_a_venda_no_balcao_nasce_inteira.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

// O corpo da função, sem o cabeçalho de 8 seções: contagem de ocorrência
// (quantas travas de linha, quantos UPDATEs de estoque) só vale aqui —
// no cabeçalho essas mesmas palavras aparecem em prosa, explicando o porquê.
const corpoDaFuncao = (() => {
  const abre = migration.indexOf("$function$");
  const fecha = migration.lastIndexOf("$function$");
  if (abre === -1 || fecha === abre) return "";
  return migration.slice(abre + "$function$".length, fecha);
})();
const corpoN = norm(corpoDaFuncao);

// A assinatura COMPLETA é o contrato com C3 (a tela do PDV) e com o job
// "Código x banco" do CI: mudar a ordem ou o tipo de um parâmetro quebra
// quem chama, em silêncio, porque o Postgres resolve sobrecarga por posição.
const ASSINATURA =
  "public.registrar_venda_presencial(jsonb, text, uuid, text, text, numeric, text, uuid)";

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

Deno.test("a assinatura tem os 8 parametros na ordem do desenho, RETURNS jsonb, SECURITY DEFINER", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE OR REPLACE FUNCTION public.registrar_venda_presencial(p_itens jsonb, p_pagamento text, p_cliente_user_id uuid DEFAULT NULL, p_cliente_nome text DEFAULT NULL, p_cliente_whatsapp text DEFAULT NULL, p_desconto numeric DEFAULT 0, p_observacao text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL)
       RETURNS jsonb
       LANGUAGE plpgsql
       SECURITY DEFINER`,
    ),
  );
});

Deno.test("search_path fechado em pg_catalog, pg_temp (nada resolve sem qualificar)", () => {
  assertStringIncludes(migrationN, "SET search_path = pg_catalog, pg_temp");
});

Deno.test("o gate de admin e' a PRIMEIRA instrucao do corpo, com 42501 e a mensagem exata", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `IF public.is_admin() IS DISTINCT FROM true THEN
         RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja registra venda no balcão.';
       END IF;`,
    ),
  );
  // "PRIMEIRA instrução" medida de verdade: entre o BEGIN do corpo e o gate
  // não pode haver nenhum comando (nem um SELECT de sondagem) — é o que
  // impede a função de revelar qualquer coisa a quem não é da loja.
  const corpo = migration.slice(migration.indexOf("$function$"));
  const posBegin = corpo.indexOf("\nBEGIN");
  const posGate = corpo.indexOf("public.is_admin()");
  assert(posBegin !== -1, "BEGIN do corpo não encontrado");
  assert(posGate > posBegin, "o gate de admin tem de vir depois do BEGIN");
  const entreBeginEGate = norm(
    removerRuido(corpo.slice(posBegin + "\nBEGIN".length, posGate)),
  );
  assertEquals(
    entreBeginEGate,
    "IF",
    `há instrução entre o BEGIN e o gate de admin: "${entreBeginEGate}"`,
  );
});

Deno.test("o pedido nasce presencial, delivered e recebido_na_entrega — os tres literais no INSERT", () => {
  const inicio = migration.indexOf("INSERT INTO public.marketplace_orders");
  assert(inicio !== -1, "INSERT do pedido não encontrado");
  const fim = migration.indexOf("RETURNING id INTO v_order_id", inicio);
  assert(fim !== -1, "fim do INSERT do pedido não encontrado");
  const bloco = norm(migration.slice(inicio, fim));
  for (const literal of [
    "'presencial'",
    "'delivered'",
    "'recebido_na_entrega'",
  ]) {
    assertStringIncludes(bloco, literal);
  }
  // shipping = 0 no balcão (não há entrega) e expires_at FORA do INSERT (a
  // reserva de 30 min é do PIX; venda de balcão já está paga e entregue).
  assert(
    !bloco.includes("expires_at"),
    "expires_at não pode entrar no INSERT — fica NULL por default, é o desenho",
  );
});

Deno.test("vendedor_id e pagamento_recebido_por saem de auth.uid(), e nao existe parametro de vendedor/total/preco", () => {
  assertStringIncludes(migrationN, norm("v_vendedor := auth.uid();"));
  // A correspondência coluna x valor é POSICIONAL no INSERT: estas duas
  // sequências, lado a lado, são o que prova que as duas colunas recebem o
  // balconista da sessão e não um parâmetro.
  assertStringIncludes(
    migrationN,
    norm("pagamento_recebido_por, vendedor_id, canal"),
  );
  assertStringIncludes(
    migrationN,
    norm("v_vendedor, v_vendedor, 'presencial'"),
  );
  // Nenhum parâmetro de dinheiro nem de vendedor na ASSINATURA (o corpo some
  // no removerRuido junto com o dollar-quote; a assinatura, não).
  const limpo = removerRuido(migration);
  for (const proibido of ["p_vendedor", "p_total", "p_preco", "p_subtotal"]) {
    assert(
      /* eslint-disable-next-line security/detect-non-literal-regexp --
       * O "não literal" é um nome de parâmetro desta MESMA lista, escrita duas
       * linhas acima: nada aqui vem de rede, de arquivo nem de argumento. */
      !new RegExp(`\\b${proibido}\\b`, "i").test(limpo),
      `a RPC não pode ter parâmetro ${proibido} — total e vendedor saem do servidor`,
    );
  }
});

Deno.test("a lista de formas de pagamento e' FECHADA na RPC (nao ha CHECK de payment_method no banco)", () => {
  assertStringIncludes(migrationN, norm("('cash','pix','card')"));
});

Deno.test("a baixa de estoque e' XOR e guardada por ROW_COUNT, na forma literal da v23", () => {
  assertStringIncludes(
    migrationN,
    norm("stock_increment = stock_increment - v_quantity"),
  );
  assertStringIncludes(migrationN, norm("AND stock_increment >= v_quantity"));
  assertStringIncludes(migrationN, norm("estoque = estoque - v_quantity"));
  assertStringIncludes(migrationN, norm("AND estoque >= v_quantity"));
  assertStringIncludes(migrationN, "GET DIAGNOSTICS");
  // Os dois UPDATEs têm de estar em ramos EXCLUSIVOS do mesmo IF: debitar nos
  // dois lugares infla o catálogo para sempre (20261060000000:154-158).
  const updates = (
    corpoN.match(/UPDATE public\.(product_variants|produtos) SET/g) || []
  ).length;
  assertEquals(updates, 2, "exatamente dois UPDATEs de estoque, um por ramo");
});

Deno.test("o primeiro laco TRAVA a linha nas duas leituras (FOR NO KEY UPDATE), como a v23", () => {
  const travas = (corpoN.match(/FOR NO KEY UPDATE/g) || []).length;
  assertEquals(travas, 2, "as duas leituras do primeiro laço travam a linha");
  assertStringIncludes(corpoN, "FOR NO KEY UPDATE OF v");
});

Deno.test("nascem os DOIS historicos: status (NULL -> delivered) e pagamento (recebido)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes, created_by)
       VALUES (v_order_id, NULL, 'delivered', 'Venda no balcão', v_vendedor);`,
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      `INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois, created_by)
       VALUES (v_order_id, 'recebido', NULL, 'recebido_na_entrega', v_vendedor);`,
    ),
  );
});

Deno.test("a migration NAO toca nas vizinhas do dinheiro (v23/v24, registrar_pagamento_recebido)", () => {
  const limpo = removerRuido(migration);
  assert(
    !/create_marketplace_order_v2/i.test(limpo),
    "a migration não pode recriar nem mencionar as RPCs do checkout online fora de comentário",
  );
  assert(
    !/registrar_pagamento_recebido/i.test(limpo),
    "a migration não pode tocar em registrar_pagamento_recebido",
  );
  // Reforço sobre o texto CRU (o removerRuido apaga o corpo inteiro junto com
  // o dollar-quote): nenhuma outra função de dinheiro é recriada aqui.
  for (const vizinha of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
    "registrar_pagamento_recebido",
    "registrar_estorno_manual",
    "update_order_status_atomic",
    "devolver_estoque",
  ]) {
    assert(
      /* eslint-disable-next-line security/detect-non-literal-regexp --
       * O "não literal" é um nome de função desta MESMA lista, logo acima —
       * nunca entrada de rede. O grupo opcional é o mesmo formato já medido
       * em scripts/db-prove-rollback.cjs (`detectarCreateFunctionCru`), e a
       * entrada é um .sql local desta bancada, de poucos KB. */
      !new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${vizinha}\\b`,
        "i",
      ).test(migration),
      `a migration recria public.${vizinha} — ela é de outra tarefa`,
    );
  }
});

Deno.test("e' so' funcao: nenhum ALTER TABLE, nenhuma coluna nova (o esquema e' da C1.1)", () => {
  const limpo = removerRuido(migration);
  assert(
    !/ALTER\s+TABLE/i.test(limpo),
    "a migration não pode alterar tabela — canal e vendedor_id nascem na 20261160000000",
  );
});

Deno.test("grants: REVOKE ALL de todo mundo e EXECUTE so' para authenticated", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon, authenticated, service_role;`,
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated;`),
  );
  // service_role fica de fora de propósito: nenhuma edge function registra
  // venda de balcão, e porta que não existe não é arrombada.
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*registrar_venda_presencial[^;]*service_role/i.test(
      migrationN,
    ),
    "service_role não pode receber EXECUTE nesta RPC",
  );
  assert(
    !/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*registrar_venda_presencial[^;]*\banon\b/i.test(
      migrationN,
    ),
    "anon não pode receber EXECUTE nesta RPC",
  );
});

Deno.test("rollback: derruba a funcao pela assinatura completa e nao recria nada", () => {
  assertStringIncludes(
    rollbackN,
    norm(`DROP FUNCTION IF EXISTS ${ASSINATURA};`),
  );
  const limpoRollback = removerRuido(rollback);
  assert(
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Mesmo formato de `CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b` já usado (e já
     * medido) em scripts/db-prove-rollback.cjs. Entrada é sempre um arquivo
     * .sql local desta bancada (poucos KB), nunca rede. */
    !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(limpoRollback),
    "o rollback de uma função NOVA só derruba — nada renasce aqui",
  );
  assert(
    !/ALTER\s+TABLE/i.test(limpoRollback),
    "o rollback não pode desfazer o esquema da C1.1",
  );
});
