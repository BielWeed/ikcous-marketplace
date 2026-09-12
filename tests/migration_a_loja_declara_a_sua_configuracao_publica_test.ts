// @ts-nocheck
// A LOJA DECLARA A SUA CONFIGURAÇÃO PÚBLICA — prova offline do par
// 20261150000000 + rollback (brief
// equipe/entregas/20260911-brief-escala-etapa3-uma-publicacao-para-todas.md,
// tarefa T1; spec equipe/entregas/20260911-spec-escala-etapa3-uma-publicacao-para-todas.md,
// bloco A + ADENDO A.4).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem esta migration, `mp_public_key`,
// `vapid_public_key`, `pagamento_online` e `manutencao` continuam ASSADOS no
// build (import.meta.env), e um único build compartilhado por N lojas
// tokenizaria cartão / assinaria push com a chave ERRADA para qualquer loja
// que não seja a principal (fato medido na spec, bloco A, item 1). Cada
// asserção abaixo está amarrada a essa ameaça: sabotar qualquer uma reabre
// esse furo, ou reabre o furo do domínio ("loja A com dado de loja B") que a
// 20261140 já fechava.
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
const NOME = "20261150000000_a_loja_declara_a_sua_configuracao_publica.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
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

Deno.test("as 4 colunas nascem com ADD COLUMN IF NOT EXISTS e os tipos exatos do contrato entre pecas", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS mp_public_key text;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS vapid_public_key text;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS pagamento_online boolean NOT NULL DEFAULT false;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS manutencao boolean NOT NULL DEFAULT false;",
    ),
  );
});

Deno.test("v_store_config e recriada com security_invoker=on, as 30 colunas atuais + as 4 novas, filtrada por id=1", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "CREATE OR REPLACE VIEW public.v_store_config WITH (security_invoker=on) AS",
    ),
  );
  // As 30 colunas já existentes (a 20261140 já tem 29 + dominio_publico = 30),
  // na MESMA ordem que a 20261140 deixou — CREATE OR REPLACE VIEW só aceita
  // coluna nova no FIM, nunca reordenar as que já existem.
  const colunasExistentesEmOrdem = [
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
  ];
  assertEquals(colunasExistentesEmOrdem.length, 34, "30 atuais + 4 novas");
  const inicioView = migration.indexOf(
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  assert(inicioView !== -1, "CREATE OR REPLACE VIEW não encontrada");
  const fimView = migration.indexOf("WHERE id = 1;", inicioView);
  assert(fimView !== -1, "fim da view (WHERE id = 1;) não encontrado");
  const blocoView = norm(
    migration.slice(inicioView, fimView + "WHERE id = 1;".length),
  );
  let cursor = 0;
  for (const coluna of colunasExistentesEmOrdem) {
    const idx = blocoView.indexOf(coluna, cursor);
    assert(
      idx !== -1 && idx >= cursor,
      `coluna "${coluna}" ausente ou fora de ordem na view (a partir da posição ${cursor})`,
    );
    cursor = idx + coluna.length;
  }
});

Deno.test("a funcao dominio_publico_so_muda_pela_frota NAO muda de corpo nesta migration (so os WHEN das triggers mudam)", () => {
  assert(
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Mesmo formato do `CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b` já usado (e já
     * medido) em scripts/db-prove-rollback.cjs (`detectarCreateFunctionCru`).
     * Entrada é sempre um arquivo .sql local desta bancada (poucos KB), nunca
     * rede. */
    !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.dominio_publico_so_muda_pela_frota/i.test(
      removerRuido(migration),
    ),
    "esta migration não deve recriar a função — ela já existe desde a 20261140 e só as triggers mudam de WHEN",
  );
});

Deno.test("trigger de UPDATE cobre as 5 colunas (dominio_publico + as 4 novas) com IS DISTINCT FROM", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE TRIGGER dominio_publico_so_muda_pela_frota
        BEFORE UPDATE ON public.store_config
        FOR EACH ROW
        WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico
          OR OLD.mp_public_key IS DISTINCT FROM NEW.mp_public_key
          OR OLD.vapid_public_key IS DISTINCT FROM NEW.vapid_public_key
          OR OLD.pagamento_online IS DISTINCT FROM NEW.pagamento_online
          OR OLD.manutencao IS DISTINCT FROM NEW.manutencao)
        EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();`,
    ),
  );
});

Deno.test("trigger de INSERT cobre as 5 colunas (dominio_publico + as 4 novas), booleanos com IS DISTINCT FROM false (ADENDO A.4)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      `CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert
        BEFORE INSERT ON public.store_config
        FOR EACH ROW
        WHEN (NEW.dominio_publico IS NOT NULL
          OR NEW.mp_public_key IS NOT NULL
          OR NEW.vapid_public_key IS NOT NULL
          OR NEW.pagamento_online IS DISTINCT FROM false
          OR NEW.manutencao IS DISTINCT FROM false)
        EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();`,
    ),
  );
});

Deno.test("nenhuma linha de seed (INSERT/UPDATE de dado) na migration — a semente e' fora, por scripts/db-prove-configuracao-publica ou pela hub", () => {
  const limpo = removerRuido(migration);
  assert(
    !/INSERT\s+INTO\s+public\.store_config/i.test(limpo),
    "migration contém INSERT em store_config — a semente é fora desta migration",
  );
  assert(
    !/UPDATE\s+public\.store_config/i.test(limpo),
    "migration contém UPDATE em store_config — a semente é fora desta migration",
  );
});

Deno.test("rollback: view volta a ter SO as 30 colunas atuais (sem as 4 novas), triggers voltam ao WHEN da 20261140, e DROP COLUMN IF EXISTS x4", () => {
  // O rollback usa DROP VIEW + CREATE VIEW (nunca CREATE OR REPLACE VIEW):
  // o Postgres recusa OR REPLACE quando a lista de colunas do REPLACE tem
  // MENOS colunas que a view existente ("cannot drop columns from view") —
  // mesmo motivo já documentado no rollback da 20261140.
  assertStringIncludes(rollbackN, norm("DROP VIEW public.v_store_config;"));
  assertStringIncludes(
    rollbackN,
    norm("CREATE VIEW public.v_store_config WITH (security_invoker=on) AS"),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
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
  for (const colunaNova of [
    "mp_public_key",
    "vapid_public_key",
    "pagamento_online",
    "manutencao",
  ]) {
    assert(
      !blocoViewRollback.includes(colunaNova),
      `a view do rollback não pode listar "${colunaNova}" — o rollback volta às 30 colunas da 20261140`,
    );
  }
  assertStringIncludes(blocoViewRollback, "dominio_publico");

  // Triggers voltam ao WHEN estreito da 20261140 (só dominio_publico).
  assertStringIncludes(
    rollbackN,
    norm(
      `CREATE TRIGGER dominio_publico_so_muda_pela_frota
        BEFORE UPDATE ON public.store_config
        FOR EACH ROW
        WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico)
        EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();`,
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      `CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert
        BEFORE INSERT ON public.store_config
        FOR EACH ROW
        WHEN (NEW.dominio_publico IS NOT NULL)
        EXECUTE FUNCTION public.dominio_publico_so_muda_pela_frota();`,
    ),
  );

  for (const coluna of [
    "mp_public_key",
    "vapid_public_key",
    "pagamento_online",
    "manutencao",
  ]) {
    assertStringIncludes(
      rollbackN,
      norm(`ALTER TABLE public.store_config DROP COLUMN IF EXISTS ${coluna};`),
    );
  }
});

Deno.test("rollback NAO recria nem derruba a funcao dominio_publico_so_muda_pela_frota (ela continua servindo a 20261140)", () => {
  const limpoRollback = removerRuido(rollback);
  assert(
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Mesmo formato já medido em scripts/db-prove-rollback.cjs
     * (`detectarCreateFunctionCru`). Entrada é sempre um arquivo .sql local
     * desta bancada (poucos KB), nunca rede. */
    !/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.dominio_publico_so_muda_pela_frota/i.test(
      limpoRollback,
    ),
    "o rollback não deve recriar a função — ela pertence à 20261140",
  );
  assert(
    /* eslint-disable-next-line security/detect-unsafe-regex --
     * Mesmo raciocínio do bloco acima: grupo opcional curto sobre um arquivo
     * .sql local pequeno, nunca entrada de rede. */
    !/DROP\s+FUNCTION\s+(IF\s+EXISTS\s+)?public\.dominio_publico_so_muda_pela_frota/i.test(
      limpoRollback,
    ),
    "o rollback não deve derrubar a função — a 20261140 continua viva e usando ela",
  );
});
