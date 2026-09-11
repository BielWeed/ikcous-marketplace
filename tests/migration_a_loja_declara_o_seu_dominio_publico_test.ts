// @ts-nocheck
// A LOJA DECLARA O SEU DOMÍNIO PÚBLICO — prova offline do par
// 20261140000000 + rollback (T4 do brief
// equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md).
//
// O DEFEITO QUE ESTE TESTE FIXA: a partir da etapa 2 um único build serve
// toda a frota; o porteiro (T3, mesma bancada) resolve o banco pelo HOST da
// requisição. Sem a coluna `dominio_publico` (o que a loja DECLARA aceitar)
// e sem a trava que impede QUALQUER visitante de mudar essa declaração, um
// porteiro com bug ou um cache envenenado montaria a ficha da loja A no
// host da loja B. Cada asserção abaixo está amarrada a esse risco: sabotar
// qualquer uma reabre "loja A com dado de loja B", ou destrava a coluna
// para quem não devia escrever nela.
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
const NOME = "20261140000000_a_loja_declara_o_seu_dominio_publico.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);
// SQL de verdade, sem comentário — o cabeçalho desta migration CITA "TRUNCATE"
// e "REVOKE UPDATE (dominio_publico)" em prosa (a lista de GRANTs vivos
// medida, e o exemplo do que NÃO se escreve), então checar essas duas
// ausências no texto CRU acusaria o próprio comentário explicativo. Usa o
// mesmo `removerRuido` que a Fase 0 do db-prove-rollback.cjs usa para
// distinguir SQL real de comentário/string.
const migrationSqlSemComentario = norm(removerRuido(migration));

// As 29 colunas ATUAIS de v_store_config, na MESMA ordem medida no banco
// vivo da principal (pg_get_viewdef, 11/09/2026) — é essa ordem que o
// `CREATE OR REPLACE VIEW` tem de preservar, porque `OR REPLACE` só aceita
// coluna nova NO FIM: reordenar qualquer uma das 29 quebraria a view.
const COLUNAS_ORIGINAIS_V_STORE_CONFIG = [
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
];

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  // A prova em transação (db-prove-dominio-publico.cjs) e a aplicação real
  // (db-apply.cjs) dependem de UMA transação externa sem interrupção — um
  // BEGIN/COMMIT escondido aqui grava direto no banco e invalida o ROLLBACK
  // da prova (regra da casa, sem exceção).
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

Deno.test("migration acrescenta a coluna dominio_publico de forma ADITIVA e IDEMPOTENTE", () => {
  // Sem "IF NOT EXISTS", reaplicar o arquivo (segunda tentativa depois de
  // uma falha parcial, por exemplo) derrubaria a migration inteira com
  // "column already exists" — quebrando a idempotência que a casa exige.
  assertStringIncludes(
    migrationN,
    norm(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS dominio_publico text;",
    ),
  );
});

Deno.test("migration NAO contem DROP TABLE, DROP COLUMN nem TRUNCATE (aditiva de verdade)", () => {
  // O contrato da carta branca (aplicar sem perguntar) exige migration
  // ADITIVA: nada que apague tabela, coluna ou dado. `DROP` só é permitido
  // para função/trigger recriados NA MESMA migration (que é o único DROP
  // que este arquivo usa, sobre o próprio trigger que ele acabou de criar).
  assert(
    !/DROP\s+TABLE/i.test(migrationSqlSemComentario),
    "migration contém DROP TABLE",
  );
  assert(
    !/DROP\s+COLUMN/i.test(migrationSqlSemComentario),
    "migration contém DROP COLUMN",
  );
  assert(
    !/TRUNCATE/i.test(migrationSqlSemComentario),
    "migration contém TRUNCATE",
  );
});

Deno.test("o CHECK do host so e criado se ainda nao existir (pg_constraint IF NOT EXISTS), nunca ADD CONSTRAINT cru", () => {
  // Um "ALTER TABLE ... ADD CONSTRAINT" sem a guarda de pg_constraint
  // falharia com "constraint already exists" na segunda aplicação — a
  // guarda é o que torna o arquivo inteiro reaplicável sem erro.
  assertStringIncludes(
    migrationN,
    norm(
      "IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conrelid = 'public.store_config'::regclass AND conname = 'store_config_dominio_publico_host_check' )",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("ADD CONSTRAINT store_config_dominio_publico_host_check CHECK ("),
  );
});

Deno.test("o CHECK aceita NULL ou host minusculo sem esquema/porta/caminho (com pelo menos um ponto)", () => {
  // A REGRA do CHECK vem do brief, byte a byte: sem ela, um valor como
  // "https://a.exemplo" ou "A.EXEMPLO" (maiúscula) passaria e a comparação
  // de host do porteiro (T3, string exata) nunca bateria — travando a
  // frota inteira em 503 por um valor mal formatado, não por má-fé.
  assertStringIncludes(migrationN, norm("dominio_publico IS NULL"));
  assertStringIncludes(
    migrationN,
    norm(
      "dominio_publico ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'",
    ),
  );
});

Deno.test("v_store_config e recriada com as 29 colunas ATUAIS intactas, na MESMA ordem, e dominio_publico so no FIM", () => {
  // `CREATE OR REPLACE VIEW` só aceita coluna nova NO FIM da lista — mover,
  // remover ou reordenar qualquer uma das 29 colunas originais QUEBRA a
  // view para todo consumidor existente (build, admin, porteiro). Este
  // teste ancora a ORDEM inteira, não só a presença de cada nome solto.
  const inicio = migration.indexOf(
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  assert(
    inicio !== -1,
    "CREATE OR REPLACE VIEW public.v_store_config não encontrado",
  );
  const fimSelect = migration.indexOf("FROM store_config", inicio);
  assert(
    fimSelect !== -1,
    "FROM store_config não encontrado depois do CREATE VIEW",
  );
  const listaColunas = migration.slice(inicio, fimSelect);
  const colunas = listaColunas
    .replace(/CREATE OR REPLACE VIEW public\.v_store_config[^\n]*\n/, "")
    .replace(/SELECT/, "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  assertEquals(
    colunas,
    [...COLUNAS_ORIGINAIS_V_STORE_CONFIG, "dominio_publico"],
    `ordem de colunas da view diverge: ${colunas.join(", ")}`,
  );
  assertStringIncludes(migrationN, norm("WITH (security_invoker=on)"));
  assertStringIncludes(migrationN, norm("WHERE id = 1"));
});

Deno.test("a trigger recusa por CLAIM de quem pediu (anon/authenticated), nunca pelo papel em que a funcao roda", () => {
  // Este é o achado que a frente inteira existe para fechar: se a checagem
  // olhasse `current_user`/`session_user` em vez do claim do JWT,
  // `upsert_store_config` (SECURITY DEFINER, roda como `postgres`) chamada
  // por QUALQUER admin autenticado passaria batido pela trava.
  assertStringIncludes(
    migrationN,
    norm(
      "v_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA';",
    ),
  );
});

Deno.test("rodada 2 — a condicao e LISTA DE PERMISSAO (recusa por padrao), nunca lista de negacao", () => {
  // Achado 2 do revisor: `IF v_role IN ('anon','authenticated')` é lista de
  // NEGAÇÃO e falha ABERTA quando o claim não tem a chave `role` (v_role
  // fica NULL, `NULL IN (...)` é NULL, o IF não dispara) ou traz um `role`
  // desconhecido — medido passando no banco vivo. A regra nova só libera
  // DOIS casos (service_role, ou ausência de claim com o papel de banco
  // fora de anon/authenticated) e RECUSA tudo o mais por padrão — não há
  // mais nenhum `IF v_role IN ('anon', 'authenticated')` no arquivo.
  assert(
    !/IF\s+v_role\s+IN\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)/i.test(
      migrationSqlSemComentario,
    ),
    "migration ainda contém a lista de NEGAÇÃO antiga (IF v_role IN ('anon','authenticated'))",
  );
  assertStringIncludes(migrationN, norm("IF v_role = 'service_role' THEN"));
  assertStringIncludes(
    migrationN,
    norm(
      "IF v_role IS NULL AND current_setting('role', true) NOT IN ('anon', 'authenticated') THEN",
    ),
  );
});

Deno.test("rodada 2 — a condicao usa current_setting('role', true), NUNCA current_user (SECURITY DEFINER troca current_user pelo dono da funcao)", () => {
  // Medido contra o banco vivo (função pg_temp temporária, SECURITY
  // DEFINER, chamada com SET LOCAL ROLE authenticated): current_user
  // devolveu o DONO da função ("postgres"), não "authenticated". Usar
  // current_user aqui faria QUALQUER chamador sem role reconhecido no
  // claim passar pela trava — o oposto do que o achado 2 pede.
  assert(
    !/current_user/i.test(migrationSqlSemComentario),
    "migration usa current_user na condição — dentro de SECURITY DEFINER isso sempre reflete o DONO da função, não quem chamou",
  );
});

Deno.test("a trigger NAO faz cast para jsonb quando o claim e ausente/vazio (evita 'invalid input syntax for type json')", () => {
  // MEDIDO rodando a prova contra o banco vivo: request.jwt.claims já
  // existe como GUC nesta base mesmo numa conexão direta, com valor ''
  // (string vazia) — não NULL. ''::jsonb lança um erro REAL do Postgres
  // ("invalid input syntax for type json"), que aconteceria em TODA
  // conexão direta da hub sem esta guarda — o mesmo cuidado que
  // public.is_admin() já toma (current_setting(...) IS NOT NULL AND <> '').
  assertStringIncludes(
    migrationN,
    norm(
      "IF current_setting('request.jwt.claims', true) IS NOT NULL AND current_setting('request.jwt.claims', true) <> '' THEN",
    ),
  );
});

Deno.test("a trigger de UPDATE so dispara quando dominio_publico MUDA (WHEN IS DISTINCT FROM) — outro UPDATE de anon/authenticated continua passando", () => {
  // Sem o WHEN, QUALQUER UPDATE de store_config por anon/authenticated
  // (trocar share_text, primary_color etc — comportamento de hoje, usado
  // pela tela de admin) passaria a ser recusado, mesmo sem tocar a coluna
  // nova — uma regressão bem maior que o que esta migration promete.
  assertStringIncludes(
    migrationN,
    norm("WHEN (OLD.dominio_publico IS DISTINCT FROM NEW.dominio_publico)"),
  );
  assertStringIncludes(
    migrationN,
    norm("BEFORE UPDATE ON public.store_config"),
  );
  assertStringIncludes(migrationN, norm("FOR EACH ROW"));
});

Deno.test("rodada 2 — existe uma SEGUNDA trigger, BEFORE INSERT, que fecha o ataque DELETE+INSERT (achado 1 do revisor)", () => {
  // Só BEFORE UPDATE deixava um admin autenticado apagar a linha id=1 e
  // inserir outra com o dominio_publico que quisesse, sem disparar trigger
  // nenhum — DELETE e INSERT são eventos diferentes de UPDATE. Esta trigger
  // dispara só quando a linha NASCE com a coluna preenchida, e reusa a
  // MESMA função (dominio_publico_so_muda_pela_frota) — o caminho legítimo
  // de INSERT (upsert_store_config) nunca escreve essa coluna, então
  // insere sempre NULL e não aciona a trava.
  assertStringIncludes(
    migrationN,
    norm(
      "DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("CREATE TRIGGER dominio_publico_so_muda_pela_frota_no_insert"),
  );
  assertStringIncludes(
    migrationN,
    norm("BEFORE INSERT ON public.store_config"),
  );
  assertStringIncludes(
    migrationN,
    norm("WHEN (NEW.dominio_publico IS NOT NULL)"),
  );
  // As DUAS triggers chamam a MESMA função — não uma cópia divergente.
  const ocorrenciasDaFuncaoNoExecute = (
    migrationN.match(
      /EXECUTE FUNCTION public\.dominio_publico_so_muda_pela_frota\(\);/g,
    ) || []
  ).length;
  assertEquals(
    ocorrenciasDaFuncaoNoExecute,
    2,
    "esperava exatamente 2 triggers (UPDATE e INSERT) chamando a mesma função",
  );
});

Deno.test("a funcao da trigger fecha EXECUTE de PUBLIC/anon/authenticated/service_role (o trigger dispara sozinho, nao por chamada direta)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE ALL ON FUNCTION public.dominio_publico_so_muda_pela_frota() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
});

Deno.test("migration NAO escreve REVOKE UPDATE (dominio_publico) — o GRANT vivo e de TABELA, REVOKE de coluna seria NO-OP com cara de protecao", () => {
  // Medido no banco vivo (ver cabeçalho da migration): information_schema.
  // role_table_grants devolve GRANT de TABELA INTEIRA para anon/
  // authenticated. Um REVOKE de COLUNA sobre um GRANT de TABELA não
  // restringe nada no Postgres — escrever essa linha teria a cara de
  // proteção sem proteger (check-ausente-tem-a-cara-de-check-verde). A
  // trava real é só o trigger.
  assert(
    !/REVOKE\s+UPDATE\s*\(\s*dominio_publico\s*\)/i.test(
      migrationSqlSemComentario,
    ),
    "migration contém REVOKE UPDATE (dominio_publico) — deveria confiar só no trigger",
  );
});

Deno.test("o rollback desfaz na ordem inversa: as DUAS triggers, funcao, view (sem a coluna), constraint, coluna", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota ON public.store_config;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP TRIGGER IF EXISTS dominio_publico_so_muda_pela_frota_no_insert ON public.store_config;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "DROP FUNCTION IF EXISTS public.dominio_publico_so_muda_pela_frota();",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP CONSTRAINT IF EXISTS store_config_dominio_publico_host_check;",
    ),
  );
  assertStringIncludes(
    rollbackN,
    norm(
      "ALTER TABLE public.store_config DROP COLUMN IF EXISTS dominio_publico;",
    ),
  );
  // O Postgres recusa `CREATE OR REPLACE VIEW` quando a lista de colunas do
  // REPLACE é MENOR que a view existente ("cannot drop columns from view",
  // medido rodando a prova contra o banco vivo) — só DROP+CREATE remove
  // uma coluna. `DROP VIEW` apaga o ACL junto, por isso o `GRANT ALL`
  // explícito logo depois (medido: os quatro papéis tinham ALL PRIVILEGES
  // na view antes desta migration).
  assertStringIncludes(rollbackN, norm("DROP VIEW public.v_store_config;"));
  assertStringIncludes(
    rollbackN,
    norm(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
  );

  // Ordem textual: trigger antes da função, função antes do DROP VIEW, DROP
  // VIEW antes do CREATE VIEW, CREATE VIEW antes do GRANT e do DROP COLUMN
  // (a view não pode referenciar coluna já apagada, e precisa existir antes
  // de receber o GRANT).
  const idxTrigger = rollbackN.indexOf("DROP TRIGGER IF EXISTS");
  const idxFuncao = rollbackN.indexOf("DROP FUNCTION IF EXISTS");
  const idxDropView = rollbackN.indexOf("DROP VIEW public.v_store_config;");
  const idxCreateView = rollbackN.indexOf("CREATE VIEW public.v_store_config");
  const idxGrant = rollbackN.indexOf(
    "GRANT ALL ON TABLE public.v_store_config",
  );
  const idxDropColuna = rollbackN.indexOf(
    "DROP COLUMN IF EXISTS dominio_publico",
  );
  assert(
    idxTrigger !== -1 &&
      idxFuncao !== -1 &&
      idxDropView !== -1 &&
      idxCreateView !== -1 &&
      idxGrant !== -1 &&
      idxDropColuna !== -1,
  );
  assert(
    idxTrigger < idxFuncao,
    "trigger deveria ser derrubada antes da função",
  );
  assert(
    idxFuncao < idxDropView,
    "função deveria ser derrubada antes do DROP VIEW",
  );
  assert(
    idxDropView < idxCreateView,
    "DROP VIEW precisa vir antes do CREATE VIEW",
  );
  assert(idxCreateView < idxGrant, "CREATE VIEW precisa vir antes do GRANT");
  assert(
    idxCreateView < idxDropColuna,
    "view precisa ser recriada SEM a coluna antes do DROP COLUMN",
  );
});

Deno.test("o rollback recria v_store_config com as 29 colunas ORIGINAIS, sem dominio_publico", () => {
  const inicio = rollback.indexOf("CREATE VIEW public.v_store_config");
  assert(
    inicio !== -1,
    "CREATE VIEW public.v_store_config não encontrado no rollback",
  );
  const fimSelect = rollback.indexOf("FROM store_config", inicio);
  assert(fimSelect !== -1);
  const listaColunas = rollback.slice(inicio, fimSelect);
  const colunas = listaColunas
    .replace(/CREATE VIEW public\.v_store_config[^\n]*\n/, "")
    .replace(/SELECT/, "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  assertEquals(
    colunas,
    COLUNAS_ORIGINAIS_V_STORE_CONFIG,
    `rollback deveria recriar a view com as 29 colunas originais, sem dominio_publico: ${colunas.join(", ")}`,
  );
  assert(
    !colunas.includes("dominio_publico"),
    "rollback recriou a view ainda com dominio_publico",
  );
});
