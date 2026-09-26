// @ts-nocheck
// A LISTA DE PEDIDOS FILTRA POR CANAL — prova offline do par 20261163000000 +
// rollback (LOTE C1 da venda presencial/PDV, tarefa C1.4; desenho em
// docs/superpowers/plans/2026-09-15-super-atualizacao-do-app.md §5.2).
//
// O DEFEITO QUE ESTE TESTE FIXA: `get_admin_orders_paged` devolve `o.*`, então
// a coluna `canal` (criada em C1.1) já aparece sozinha no retorno — o que
// falta é o FILTRO. Sem ele o chip "Balcão" do painel teria de cortar a página
// em memória, exatamente o achado 10 do laudo que o filtro de pagamento já
// fechou. E como a função ganha um oitavo parâmetro, deixar a sobrecarga de 7
// argumentos viva ao lado da nova faz TODA chamada nomeada do painel explodir
// com «function get_admin_orders_paged(...) is not unique» — foi o defeito de
// 20261034000000:6-13, que custou um aviso amarelo em produção.
//
// Esta prova é ESTÁTICA (texto do par migration+rollback): não há gate de CI
// para SQL neste repositório. O comportamento contra um Postgres de verdade é
// assunto das invariantes de tests/banco/.
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
const NOME = "20261163000000_a_lista_de_pedidos_filtra_por_canal.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

// O corpo da função, sem o cabeçalho de 8 seções: contagem de ocorrência só
// vale aqui — no cabeçalho o mesmo predicado aparece em prosa, explicando o
// porquê, e contá-lo ali daria um número falso.
const corpoEntreDollarQuotes = (sql) => {
  const abre = sql.indexOf("$function$");
  const fecha = sql.lastIndexOf("$function$");
  if (abre === -1 || fecha === abre) return "";
  return sql.slice(abre + "$function$".length, fecha);
};
const corpoN = norm(corpoEntreDollarQuotes(migration));
const corpoRollbackN = norm(corpoEntreDollarQuotes(rollback));

// Só os COMANDOS, sem comentário nem corpo entre dollar-quotes: é aqui que se
// mede ordem (DROP antes de CREATE) e ACL. No cabeçalho o mesmo DROP e o mesmo
// CREATE aparecem em prosa, explicando o porquê — medir o texto cru diria que
// o DROP vem depois do CREATE só porque o cabeçalho cita os dois.
const comandosMigration = norm(removerRuido(migration));
const comandosRollback = norm(removerRuido(rollback));

const ASSINATURA_7 =
  "public.get_admin_orders_paged(text, text, text, text, integer, integer, text)";
const ASSINATURA_8 =
  "public.get_admin_orders_paged(text, text, text, text, integer, integer, text, text)";

// Marcadores do corpo original (20261068000000:126-337). Eles não estão aqui
// por enfeite: a tarefa manda COPIAR o corpo, não reescrevê-lo, porque os
// comentários longos são a memória dos achados do laudo de 29/08. Se algum
// sumir, alguém digitou o corpo de novo em vez de copiá-lo.
const MARCADORES_DO_CORPO = [
  "p_status = 'open' AND o.status NOT IN ('cancelled', 'delivered')",
  "p_payment_status = 'sem_cobranca' AND o.payment_status IS NULL",
  "length(v_search_digitos) >= 4",
  norm(`jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    )`),
];

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

Deno.test("a sobrecarga de 7 args e' derrubada ANTES do CREATE da de 8", () => {
  const drop = `DROP FUNCTION IF EXISTS ${ASSINATURA_7};`;
  assertStringIncludes(comandosMigration, drop);
  const posDrop = comandosMigration.indexOf(drop);
  const posCreate = comandosMigration.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(",
  );
  assert(posCreate !== -1, "CREATE da função não encontrado");
  assert(
    posDrop < posCreate,
    "o DROP da sobrecarga de 7 args tem de vir ANTES do CREATE da de 8 — " +
      "com as duas vivas, toda chamada nomeada do painel explode com 'is not unique'",
  );
});

Deno.test("a assinatura de 8 args tem p_canal por ultimo, com DEFAULT 'all'", () => {
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text, p_canal text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER`,
    ),
  );
});

Deno.test("o filtro de canal aparece UMA vez na contagem e UMA na consulta paginada", () => {
  const predicado = "AND (p_canal = 'all' OR o.canal = p_canal)";
  // A contagem (SELECT COUNT(o.id) INTO v_total_count) vem antes do primeiro
  // jsonb_agg; dali em diante é a consulta paginada. Contar no corpo inteiro
  // aceitaria duas ocorrências na MESMA consulta (ressalva da revisão).
  const corte = corpoN.indexOf("jsonb_agg(");
  assert(
    corte > 0,
    "a consulta paginada monta a página com jsonb_agg — sem ele o corpo não é o de 20261068000000",
  );
  const contagem = corpoN.slice(0, corte);
  const paginada = corpoN.slice(corte);
  assertStringIncludes(contagem, "SELECT COUNT(o.id) INTO v_total_count");
  assertEquals(
    contagem.split(predicado).length - 1,
    1,
    "sem o filtro na contagem o total_count mente e o painel acende o aviso de lista incompleta",
  );
  assertEquals(
    paginada.split(predicado).length - 1,
    1,
    "sem o filtro na consulta paginada o chip 'Balcão' devolve pedidos de todos os canais",
  );
});

Deno.test("o resto do corpo continua sendo o de 20261068000000, comentarios inclusive", () => {
  for (const marcador of MARCADORES_DO_CORPO) {
    assertStringIncludes(corpoN, marcador);
  }
  assertStringIncludes(migrationN, "SET search_path TO 'public', 'extensions'");
});

Deno.test("os grants sao refeitos com a assinatura de 8 args (o DROP derruba o ACL)", () => {
  assertStringIncludes(
    comandosMigration,
    `REVOKE ALL ON FUNCTION ${ASSINATURA_8} FROM PUBLIC, anon;`,
  );
  assertStringIncludes(
    comandosMigration,
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA_8} TO authenticated;`,
  );
  assertStringIncludes(
    comandosMigration,
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA_8} TO service_role;`,
  );
});

Deno.test("o rollback volta a de 7 args com o corpo verbatim e refaz os grants dela", () => {
  const drop = `DROP FUNCTION IF EXISTS ${ASSINATURA_8};`;
  assertStringIncludes(comandosRollback, drop);
  const posDrop = comandosRollback.indexOf(drop);
  const posCreate = comandosRollback.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(",
  );
  assert(posCreate !== -1, "CREATE do rollback não encontrado");
  assert(posDrop < posCreate, "o rollback também derruba antes de criar");
  assertStringIncludes(
    rollbackN,
    norm(
      `CREATE OR REPLACE FUNCTION public.get_admin_orders_paged(p_search text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_start_date text DEFAULT ''::text, p_end_date text DEFAULT ''::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_payment_status text DEFAULT 'all'::text)
 RETURNS jsonb`,
    ),
  );
  // Nenhum resquício do parâmetro novo: o rollback é o estado ANTERIOR.
  assert(
    !corpoRollbackN.includes("p_canal"),
    "o corpo do rollback não pode mencionar p_canal — ele é a versão de antes",
  );
  for (const marcador of MARCADORES_DO_CORPO) {
    assertStringIncludes(corpoRollbackN, marcador);
  }
  assertStringIncludes(
    comandosRollback,
    `REVOKE ALL ON FUNCTION ${ASSINATURA_7} FROM PUBLIC, anon;`,
  );
  assertStringIncludes(
    comandosRollback,
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA_7} TO authenticated;`,
  );
  assertStringIncludes(
    comandosRollback,
    `GRANT EXECUTE ON FUNCTION ${ASSINATURA_7} TO service_role;`,
  );
});
