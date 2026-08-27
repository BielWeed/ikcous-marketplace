// @ts-nocheck
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261020000000_lojista_registra_pagamento_recebido.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-${NOME}`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApply = Deno.readTextFileSync(DB_APPLY_PATH);

// `avaliarFase0` avalia o PAR de uma vez — assinatura conferida no codigo real
// (scripts/db-prove-rollback.cjs:308) e no arquivo-molde
// (tests/migration_vitrine_sabe_que_produto_mudou_test.ts:99). Ela recebe UM
// OBJETO NOMEADO e devolve `{ recusado, motivos }` — nao `{ recusas }`, e nao
// aceita a string solta. Alem de BEGIN/COMMIT escondido, ela ja recusa
// `CREATE FUNCTION` sem `OR REPLACE` nos DOIS arquivos, entao nao existe teste
// separado para isso: seria assercao mais fraca que a que ja esta aqui.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

// 🔴 Toda assercao de guarda daqui para baixo e' BLOCO AMARRADO: a condicao E a
// consequencia, na mesma string. Marcador solto afere que a LINHA existe, nao que
// ela FAZ algo — medido: mantendo `IF NOT public.is_admin() THEN` no lugar e
// trocando so' o `RAISE` por `NULL;`, a guarda vira no-op, qualquer cliente logado
// marca qualquer pedido como pago, e a bateria inteira continua VERDE.
// `norm` existe para a assercao nao depender de indentacao.
const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("a migration alarga a CHECK constraint para aceitar o valor novo", () => {
  // Sem isto a funcionalidade nao funciona UMA vez: a constraint de
  // 20260807000000 tem seis valores e recusa o setimo. Medido em 27/08/2026.
  assertStringIncludes(
    migrationN,
    norm("DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check"),
  );
  assertStringIncludes(migrationN, norm("'recebido_na_entrega'::text"));
  // ADITIVA: os seis originais continuam todos la.
  for (const v of [
    "aguardando",
    "pago",
    "recusado",
    "expirado",
    "estornado",
    "pago_apos_expirar",
  ]) {
    assertStringIncludes(migrationN, norm(`'${v}'::text`));
  }
});

Deno.test("a migration cria as duas colunas e a tabela de historico", () => {
  assertStringIncludes(
    migrationN,
    norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz"),
  );
  assertStringIncludes(
    migrationN,
    norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid"),
  );
  assertStringIncludes(
    migrationN,
    norm("CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history"),
  );
});

Deno.test("as QUATRO recusas da RPC sao blocos amarrados, nao linhas soltas", () => {
  assertStringIncludes(
    migrationN,
    norm(`IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site:`),
  );
  // A palavra do lojista NAO sobrescreve a do gateway.
  assertStringIncludes(
    migrationN,
    norm(`ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado`),
  );
});

Deno.test("os tres pontos que o plano chama de 'a correcao em si' tem assercao", () => {
  // 1. FOR UPDATE: dois cliques simultaneos nao gravam duas linhas de historico.
  assertStringIncludes(migrationN, norm("WHERE id = p_order_id FOR UPDATE;"));
  // 2. O UPDATE grava o valor NOVO — amarrado a atribuicao que o define, porque a
  //    string 'recebido_na_entrega' aparece em 3 lugares do arquivo e so' UMA
  //    decide o que e' gravado.
  assertStringIncludes(
    migrationN,
    norm(`v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,`),
  );
  // 3. Segundo clique nao gera linha de historico fantasma.
  assertStringIncludes(
    migrationN,
    norm(`IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history`),
  );
});

Deno.test("a RPC nasce SECURITY DEFINER, sem privilegio para anon", () => {
  assertStringIncludes(
    migrationN,
    norm("CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido"),
  );
  assertStringIncludes(migrationN, norm("SECURITY DEFINER"));
  assertStringIncludes(migrationN, norm("SET search_path = public"));
  // Funcao nova nasce com EXECUTE para `anon` por default deste banco
  // (pg_default_acl) — o REVOKE e' o que desfaz isso, e sem assercao ninguem nota
  // se ele sumir.
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM anon",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated",
    ),
  );
});

Deno.test("o rollback derruba TUDO que a migration cria — os QUATRO objetos", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean)",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP TABLE IF EXISTS public.marketplace_order_payment_history"),
  );
  // As duas colunas: apagar estas duas linhas do rollback deixava a bateria verde.
  assertStringIncludes(
    rollbackN,
    norm("DROP COLUMN IF EXISTS pagamento_recebido_em"),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP COLUMN IF EXISTS pagamento_recebido_por"),
  );
});

Deno.test("o rollback restaura a constraint com os SEIS — nao so' 'sem o setimo'", () => {
  assertStringIncludes(
    rollbackN,
    norm("ADD CONSTRAINT marketplace_orders_payment_status_check"),
  );
  // 🔴 Contar a AUSENCIA do setimo prova pouco: um rollback que restaurasse a
  // constraint com CINCO valores passava verde. Medido — tirar 'estornado' do
  // rollback nao derrubava nada, enquanto tirar do lado da MIGRATION derrubava,
  // porque la o laco existia. A assimetria era o defeito. Aqui o laco tambem.
  for (const v of [
    "aguardando",
    "pago",
    "recusado",
    "expirado",
    "estornado",
    "pago_apos_expirar",
  ]) {
    assertStringIncludes(
      rollbackN,
      norm(`'${v}'::text`),
      `o rollback tem de restaurar '${v}' na constraint`,
    );
  }
  // E o setimo NAO pode sobrar na constraint restaurada. A busca e' pelo literal
  // COM ::text, que so' aparece dentro da lista da constraint — o portao do
  // bloco 0 cita a string sem o cast, e nao deve derrubar este teste.
  assertEquals(
    (rollbackN.match(/'recebido_na_entrega'::text/g) || []).length,
    0,
    "o rollback nao pode deixar o valor novo na constraint restaurada",
  );
});

Deno.test("o rollback RECUSA antes de destruir, se houver pagamento marcado", () => {
  // Cada comando do rollback confirma sozinho (o db-apply NAO aplica
  // rollback-manual: isto roda a mao). Sem este portao, o DROP CONSTRAINT
  // confirma, o ADD CONSTRAINT falha, e a tabela fica SEM trava nenhuma em
  // payment_status — com o historico que diria quais pedidos causaram a falha
  // ja apagado. Bloco amarrado: a condicao E a recusa.
  assertStringIncludes(
    rollbackN,
    norm(`IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada:`),
  );
  // E o portao vem ANTES de qualquer destruicao — ordem e' a correcao aqui.
  const iPortao = rollbackN.indexOf("Reversao recusada:");
  const iDrop = rollbackN.indexOf("DROP FUNCTION IF EXISTS");
  assert(iPortao > -1, "o portao de recusa nao existe");
  assert(iDrop > -1, "o DROP FUNCTION nao existe");
  assert(
    iPortao < iDrop,
    "o portao de recusa tem de vir ANTES do primeiro DROP — senao ele so avisa depois de destruir",
  );
});

Deno.test("a tabela nova nasce com RLS ligado e policy so' para admin", () => {
  // 🔴 Tabela nova em `public` NASCE com INSERT/SELECT/UPDATE/DELETE para `anon`
  // por pg_default_acl deste banco (medido), e a chave anonima vai no bundle do
  // front. O RLS e' a UNICA coisa entre ela e essa tabela. Medido: apagar o
  // ENABLE ROW LEVEL SECURITY, ou apagar a policy, deixava a bateria verde.
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.marketplace_order_payment_history ENABLE ROW LEVEL SECURITY",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(`CREATE POLICY mkt_order_payment_history_select
    ON public.marketplace_order_payment_history
    FOR SELECT
    USING (public.is_admin())`),
  );
  // Nenhuma policy de ESCRITA: quem escreve e' a RPC, que e' SECURITY DEFINER.
  // Uma policy de INSERT/UPDATE/DELETE aqui abriria a tabela para o cliente.
  for (const verbo of ["FOR INSERT", "FOR UPDATE", "FOR DELETE", "FOR ALL"]) {
    assertEquals(
      migrationN.includes(
        norm(`ON public.marketplace_order_payment_history ${verbo}`),
      ),
      false,
      `a tabela de historico nao pode ter policy de escrita (${verbo})`,
    );
  }
});

Deno.test("a entrada em VERIFICACOES existe e nomeia a funcao", () => {
  assertStringIncludes(dbApply, `"${NOME}"`);
  const i = dbApply.indexOf(`"${NOME}"`);
  assert(i > -1);
  const trecho = dbApply.slice(i, i + 1200);
  assertStringIncludes(trecho, "registrar_pagamento_recebido");
});
