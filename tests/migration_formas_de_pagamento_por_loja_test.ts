// @ts-nocheck
// FORMAS DE PAGAMENTO POR LOJA — prova offline do par 20261174000000 +
// rollback (brief do dono: lojista quer vender só com pagamento pelo app;
// a solução é genérica: cada loja liga/desliga cada forma de pagamento na
// entrega — pix/card/cash —, com o padrão sendo as três ligadas, comportamento
// idêntico ao de hoje).
//
// O DEFEITO QUE ESTA MIGRATION FECHA: pix/card/cash na entrega eram uma
// lista FIXA no front, sem configuração nenhuma por loja, e o SERVIDOR não
// validava a forma de pagamento (create_marketplace_order_v23/_v24 aceitavam
// qualquer p_payment_method). Cada asserção abaixo está amarrada a um
// comportamento que, se sabotado, reabre esse furo — ou o achado B1 do
// crítico de desenho (INSERT candidato de upsert_store_config travando um
// salvamento legítimo).
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
const NOME = "20261174000000_formas_de_pagamento_por_loja.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

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

Deno.test("a coluna nasce ADITIVA: ADD COLUMN IF NOT EXISTS, NOT NULL, default as tres formas", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS formas_pagamento_entrega text[] NOT NULL DEFAULT ARRAY['pix','card','cash']::text[];",
    ),
  );
});

Deno.test("duas CHECK constraints (elementos validos, sem subquery; sem duplicata, via funcao IMMUTABLE)", () => {
  assertStringIncludes(
    migrationN,
    norm("store_config_formas_pagamento_entrega_check"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CHECK (formas_pagamento_entrega <@ ARRAY['pix','card','cash']::text[]);",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("store_config_formas_pagamento_sem_duplicata_check"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CHECK (public.formas_pagamento_sem_duplicata(formas_pagamento_entrega));",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE FUNCTION public.formas_pagamento_sem_duplicata(arr text[])",
    ),
  );
});

Deno.test("forma_de_pagamento_aceita e a fonte unica: online olha pagamento_online, pix/card/cash olham a lista", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE FUNCTION public.forma_de_pagamento_aceita(p_metodo text)",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("WHEN 'online' THEN v_config.pagamento_online"),
  );
  assertStringIncludes(
    migrationN,
    norm("WHEN 'pix' THEN 'pix' = ANY(v_config.formas_pagamento_entrega)"),
  );
  assertStringIncludes(
    migrationN,
    norm("WHEN 'card' THEN 'card' = ANY(v_config.formas_pagamento_entrega)"),
  );
  assertStringIncludes(
    migrationN,
    norm("WHEN 'cash' THEN 'cash' = ANY(v_config.formas_pagamento_entrega)"),
  );
  assertStringIncludes(migrationN, norm("ELSE false"));
});

Deno.test("a trigger do invariante PULA o disparo BEFORE INSERT quando a linha ja existe (achado B1 do critico)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE FUNCTION public.store_config_exige_forma_de_pagamento()",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "IF TG_OP = 'INSERT' AND EXISTS ( SELECT 1 FROM public.store_config WHERE id = NEW.id ) THEN RETURN NEW; END IF;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "IF cardinality(NEW.formas_pagamento_entrega) = 0 AND NOT NEW.pagamento_online THEN RAISE EXCEPTION 'LOJA_SEM_FORMA_DE_PAGAMENTO';",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE TRIGGER store_config_exige_forma_de_pagamento BEFORE INSERT OR UPDATE ON public.store_config FOR EACH ROW EXECUTE FUNCTION public.store_config_exige_forma_de_pagamento();",
    ),
  );
});

Deno.test("upsert_store_config: o candidato do INSERT usa o valor ATUAL da linha quando o payload nao manda o campo (fix do B1)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "SELECT formas_pagamento_entrega INTO v_formas_pagamento FROM public.store_config WHERE id = 1;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "v_formas_pagamento := COALESCE(v_formas_pagamento, ARRAY['pix','card','cash']::text[]);",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      `formas_pagamento_entrega = CASE WHEN v_has_formas_pagamento
        THEN v_formas_pagamento
        ELSE store_config.formas_pagamento_entrega END,`,
    ),
  );
});

Deno.test("v_store_config e recriada (DROP+CREATE) com as 34 colunas atuais na MESMA ordem + a coluna nova no FIM", () => {
  const colunasEmOrdem = [
    "id",
    "free_shipping_min",
    "shipping_fee",
    "whatsapp_number",
    "share_text",
    "business_hours",
    "enable_reviews",
    "enable_coupons",
    "primary_color",
    "theme_mode",
    "logo_url",
    "real_time_sales_alerts",
    "push_marketing_enabled",
    "min_app_version",
    "origin_cep",
    "shipping_provider",
    "enabled_shipping_methods",
    "shipping_coverage",
    "local_delivery_fee",
    "local_cep_range",
    "created_at",
    "updated_at",
    "store_name",
    "store_city",
    "store_state",
    "home_sections",
    "secondary_color",
    "accent_color",
    "branding_assets",
    "dominio_publico",
    "mp_public_key",
    "vapid_public_key",
    "pagamento_online",
    "manutencao",
    "store_address",
    "store_description",
    "national_shipping_strategy",
    "national_shipping_min",
    "national_discount_type",
    "national_discount_value",
    "national_benefit_scope",
    "formas_pagamento_entrega",
  ];
  assertEquals(
    colunasEmOrdem.length,
    42,
    "41 atuais (a lista inteira que a 20261171000000 deixou) + 1 nova",
  );
  assertStringIncludes(migrationN, norm("DROP VIEW public.v_store_config;"));
  const inicioView = migration.indexOf(
    "CREATE VIEW public.v_store_config WITH (security_invoker=on) AS",
  );
  assert(inicioView !== -1, "CREATE VIEW não encontrada");
  const fimView = migration.indexOf("WHERE id = 1;", inicioView);
  assert(fimView !== -1, "fim da view não encontrado");
  const blocoView = norm(
    migration.slice(inicioView, fimView + "WHERE id = 1;".length),
  );
  let cursor = 0;
  for (const coluna of colunasEmOrdem) {
    const idx = blocoView.indexOf(coluna, cursor);
    assert(
      idx !== -1 && idx >= cursor,
      `coluna "${coluna}" ausente ou fora de ordem na view (a partir da posição ${cursor})`,
    );
    cursor = idx + coluna.length;
  }
  assertStringIncludes(
    migrationN,
    norm(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
  );
});

Deno.test("v23 e v24 chamam forma_de_pagamento_aceita DEPOIS da idempotencia (passo 0) e ANTES da posse do endereco (passo 1) — B3", () => {
  for (const nomeFuncao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const inicioFuncao = migration.indexOf(
      `CREATE OR REPLACE FUNCTION public.${nomeFuncao}(`,
    );
    assert(inicioFuncao !== -1, `${nomeFuncao} não encontrada na migration`);
    const fimFuncao = migration.indexOf("\n$function$;", inicioFuncao);
    assert(fimFuncao !== -1, `fim de ${nomeFuncao} não encontrado`);
    const corpo = migration.slice(inicioFuncao, fimFuncao);

    const idxIdempotencia = corpo.indexOf("p_idempotency_key IS NOT NULL");
    const idxFormaDePagamento = corpo.indexOf(
      "forma_de_pagamento_aceita(p_payment_method)",
    );
    const idxEnderecoOwnership = corpo.indexOf(
      "Address Ownership Check (Only if user is logged in)",
    );
    assert(idxIdempotencia !== -1, `${nomeFuncao}: passo 0 não encontrado`);
    assert(
      idxFormaDePagamento !== -1,
      `${nomeFuncao}: checagem de forma de pagamento não encontrada`,
    );
    assert(
      idxEnderecoOwnership !== -1,
      `${nomeFuncao}: passo 1 não encontrado`,
    );
    assert(
      idxIdempotencia < idxFormaDePagamento &&
        idxFormaDePagamento < idxEnderecoOwnership,
      `${nomeFuncao}: a checagem de forma de pagamento precisa vir DEPOIS da idempotência e ANTES da posse do endereço`,
    );
  }
});

Deno.test("a mensagem de recusa e TEXTO puro (sem prefixo de codigo), casavel por src/lib/recusaDoPedido.ts", () => {
  assertStringIncludes(
    migration,
    "RAISE EXCEPTION 'Esta forma de pagamento não está disponível nesta loja. Escolha outra.';",
  );
});

Deno.test("nenhuma linha de seed (INSERT/UPDATE de dado) na migration", () => {
  const limpo = removerRuido(migration);
  assert(
    !/INSERT\s+INTO\s+public\.store_config/i.test(limpo),
    "migration contém INSERT em store_config",
  );
  assert(
    !/UPDATE\s+public\.store_config/i.test(limpo),
    "migration contém UPDATE em store_config fora do que a RPC já fazia",
  );
});

Deno.test("rollback: view volta a ter SO as 34 colunas atuais (sem formas_pagamento_entrega)", () => {
  assertStringIncludes(rollbackN, norm("DROP VIEW public.v_store_config;"));
  assertStringIncludes(
    rollbackN,
    norm("CREATE VIEW public.v_store_config WITH (security_invoker=on) AS"),
  );
  const inicioViewRollback = rollback.indexOf(
    "CREATE VIEW public.v_store_config",
  );
  assert(inicioViewRollback !== -1, "view do rollback não encontrada");
  const fimViewRollback = rollback.indexOf("WHERE id = 1;", inicioViewRollback);
  assert(fimViewRollback !== -1, "fim da view do rollback não encontrado");
  const blocoViewRollback = norm(
    rollback.slice(
      inicioViewRollback,
      fimViewRollback + "WHERE id = 1;".length,
    ),
  );
  assert(
    !blocoViewRollback.includes("formas_pagamento_entrega"),
    "a view do rollback não pode listar formas_pagamento_entrega",
  );
  assertStringIncludes(blocoViewRollback, "national_benefit_scope");
});

Deno.test("rollback dropa a trigger, as duas funcoes novas, o helper de duplicata e as duas CHECK — mas NAO a coluna", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP TRIGGER IF EXISTS store_config_exige_forma_de_pagamento ON public.store_config;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP FUNCTION IF EXISTS public.store_config_exige_forma_de_pagamento();",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm("DROP FUNCTION IF EXISTS public.forma_de_pagamento_aceita(text);"),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_formas_pagamento_sem_duplicata_check;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_formas_pagamento_entrega_check;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP FUNCTION IF EXISTS public.formas_pagamento_sem_duplicata(text[]);",
    ),
  );
  // Sem regex de propósito (eslint-plugin-security acusa `\s+` encadeado
  // como Unsafe Regular Expression, mesmo aqui, onde não há entrada
  // externa): duas checagens de substring cobrem as duas formas que este
  // repositório escreve um DROP COLUMN (com e sem "IF EXISTS" — a convenção
  // real é sempre COM, ver `_endereco_e_descricao_test.ts`). `norm()` sobre
  // o texto SEM comentário (`removerRuido`) — a mesma dupla normalização
  // que `rollbackN` já usa, aqui aplicada depois de tirar o ruído para não
  // acusar falso positivo numa MENÇÃO em prosa (o cabeçalho explica, em
  // texto, por que a coluna não é dropada).
  const rollbackSemRuidoNorm = norm(removerRuido(rollback));
  assert(
    !rollbackSemRuidoNorm.includes(
      norm("DROP COLUMN IF EXISTS formas_pagamento_entrega"),
    ) &&
      !rollbackSemRuidoNorm.includes(
        norm("DROP COLUMN formas_pagamento_entrega"),
      ),
    "o rollback NÃO pode dropar a coluna — apagaria configuração já salva pela lojista",
  );
});

Deno.test("rollback restaura create_marketplace_order_v23/_v24 e upsert_store_config SEM a checagem nova", () => {
  for (const nomeFuncao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    assertStringIncludes(
      rollbackN,
      norm(`CREATE OR REPLACE FUNCTION public.${nomeFuncao}(`),
    );
  }
  assert(
    !rollback.includes("forma_de_pagamento_aceita(p_payment_method)"),
    "o rollback não pode chamar forma_de_pagamento_aceita — os corpos restaurados são os de ANTES desta migration",
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)",
    ),
  );
  assert(
    !rollback.includes("v_has_formas_pagamento"),
    "o rollback não pode conter a lógica nova de upsert_store_config",
  );
});
