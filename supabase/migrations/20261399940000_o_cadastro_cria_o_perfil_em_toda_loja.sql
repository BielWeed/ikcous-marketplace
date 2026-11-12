-- ============================================================================
-- Migration 20261399940000 — o cadastro cria o perfil em TODA loja
-- (a loja da Savy, clonada do baseline, nunca teve o gatilho de cadastro; medido em 07/11/2026, só leitura nas duas lojas)
-- ============================================================================
--
-- 1. O DEFEITO
--
-- A loja principal (IKCOUS) tem o gatilho `on_auth_user_created` em `auth.users`:
--   CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()
-- Ele é quem cria a linha de `public.profiles` quando alguém se cadastra. O baseline `20260806000000_baseline_do_schema_vivo.sql`
-- despeja só o schema `public`: a FUNÇÃO `public.handle_new_user()` veio, o GATILHO (que mora em `auth`) não — ele só aparece numa
-- migration arquivada (`_arquivadas/20260227000000_fix_admin_profile_and_trigger.sql`, que ninguém aplica). Toda loja nascida do
-- baseline (a Savy, cliente real) cadastra a pessoa em `auth.users` e NÃO cria o perfil.
--
-- Para quem usa a Savy: cadastra-se, confirma o e-mail e ENTRA SEM PERFIL. Em Perfil > Segurança e conta a tela mostra "Não conseguimos
-- carregar seus dados de perfil." e o CPF digitado no cadastro não grava ("Não foi possível salvar o CPF do cadastro"), porque
-- `set_my_cpf` atualiza uma linha que não existe. Medido na Savy: 2 usuários e 1 perfil (o faltante é um cadastro do dia).
--
-- 2. O QUE MUDA (só objeto NOVO e linha NOVA; nenhuma linha existente é alterada ou apagada)
--
-- (a) Cria o gatilho `on_auth_user_created` (AFTER INSERT ON auth.users, FOR EACH ROW, EXECUTE FUNCTION public.handle_new_user()) SÓ SE
--     AUSENTE. Na IKCOUS ele já existe e esta etapa é no-op. A função `handle_new_user` NÃO é tocada (corpo igual nas duas lojas,
--     medido; não é redefinida aqui).
-- (b) Conserta quem já se cadastrou sem perfil: insere em `public.profiles` a MESMA linha que o gatilho teria inserido (mesma expressão
--     do corpo de `handle_new_user`: nome do metadado `full_name`, senão `name`, senão 'Usuário'; `phone` vira `whatsapp`; `cpf`;
--     papel 'customer'), `ON CONFLICT (id) DO NOTHING`. O gatilho de cópia `sync_public_profile` preenche `public_profiles` e
--     `tr_sync_profile_role_to_auth` grava `role = customer` em `auth.users.raw_app_meta_data` desses usuários (efeito normal de
--     toda linha nova de `profiles`).
--
-- 3. ⚠️ OS DADOS QUE JÁ EXISTEM — o que o reparo toca e o que ele NUNCA toca
--
--  * Usuário que JÁ TEM perfil: não é lido para decidir nada além do `NOT EXISTS`, e nada é escrito (a linha de `profiles` não muda).
--  * Usuário sem perfil e SEM papel definido, ou com papel 'customer' em `auth.users.raw_app_meta_data`: ganha o perfil.
--  * Usuário sem perfil com OUTRO papel no metadado (admin, gerente, vendedor): NÃO ganha perfil por aqui. O gatilho de papel grava o
--    papel de `profiles` em `raw_app_meta_data`; um perfil 'customer' criado à força REBAIXARIA um administrador que perdeu o perfil.
--    Esse caso é decisão de gente (a lojista), não de migration; sai no NOTICE.
--  * Usuário sem perfil cujo nome (metadado) passa de 120 caracteres ou cujo telefone passa de 20: NÃO ganha perfil por aqui e sai no
--    NOTICE. São os tetos da 20261399100000 (nome 120, WhatsApp 20); inserir acima deles abortaria a migration inteira por causa de UM
--    cadastro fora do normal (a tela limita nome a 120 e telefone a 15). Esse usuário segue sem perfil até alguém decidir o nome dele.
--  * O reparo NÃO acrescenta e NÃO apaga linha em outra tabela de forma direta; os efeitos em `public_profiles` e em
--    `raw_app_meta_data` vêm dos gatilhos que toda linha nova de `profiles` já dispara.
--
-- 4. GRANTS (medido nas migrations vigentes; nada é afrouxado)
--
-- A 20261090500000 tirou EXECUTE de `public.handle_new_user()` de PUBLIC, anon e authenticated na loja clonada. Isso NÃO impede o
-- gatilho: o Postgres confere EXECUTE da função do gatilho UMA vez, na criação do gatilho (por quem cria, aqui o dono, que executa), e
-- nunca na hora em que ele dispara; e a função é SECURITY DEFINER com `search_path` fixo em `public`, então o INSERT em `profiles`
-- roda com o dono da função, não com `supabase_auth_admin`. A IKCOUS tem a mesma ACL e o gatilho funciona lá. Nenhum GRANT/REVOKE aqui.
--
-- 5. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- `auth.users` tem de ter `id`, `raw_user_meta_data` e `raw_app_meta_data`; `public.profiles` tem de ter `id`, `full_name`, `whatsapp`,
-- `cpf` e `role`; `public.handle_new_user()` tem de existir, devolver `trigger` e ser SECURITY DEFINER (sem isso o INSERT em
-- `profiles` rodaria como `supabase_auth_admin`, que não tem acesso: o cadastro inteiro falharia). Se já existir um gatilho de nome
-- `on_auth_user_created` em `auth.users`, ele tem de ser EXATAMENTE o desenhado, comparado pela estrutura do catálogo (não pelo texto
-- de `pg_get_triggerdef`, que muda com o `search_path` da sessão): função `public.handle_new_user()`, AFTER INSERT, por linha, sem
-- condição WHEN, sem lista de colunas, sem argumentos. Um gatilho homônimo diferente (outra função, BEFORE, com WHEN) NÃO passa em
-- silêncio: a migration recusa e nada muda. O estado ligado/desligado do gatilho existente não é julgado aqui (a ficha 129a o mostra).
--
-- 6. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- Reaplicar é no-op: o gatilho só nasce se ausente e o reparo só insere quem ainda não tem perfil. Sem BEGIN/COMMIT de nível superior
-- (regra da casa): o aplicador dá a transação; pré-voo, gatilho, reparo e conferência caem juntos ou não caem. `CREATE TRIGGER` em
-- `auth.users` pede SHARE ROW EXCLUSIVE (bloqueia escrita em `auth.users` — entrar e cadastrar — enquanto dura): `lock_timeout = 5s`
-- faz a loja em uso falhar limpo em vez de travar quem entra; repetir depois. `SET LOCAL` vale só até o fim da transação do aplicador,
-- então não há nada a restaurar (nenhum RESET). O reparo escreve `profiles` e, pelo gatilho de papel, UPDATE nas linhas de `auth.users`
-- reparadas: poucas linhas (loja pequena), dentro de `statement_timeout = 30s`.
--
-- 7. O QUE ISSO MUDA PARA QUEM USA (e o que fica de fora)
--
-- Depois de aplicar: quem se cadastra na Savy passa a ter perfil na hora (como na IKCOUS), a tela Perfil carrega e o CPF do cadastro
-- grava; quem já tinha se cadastrado sem perfil passa a ter. ATENÇÃO, mudança de comportamento do cadastro: com o gatilho ativo
-- e os tetos da 20261399100000, um cadastro com nome acima de 120 caracteres ou WhatsApp acima de 20 é RECUSADO pelo banco ("Database
-- error saving new user"), em vez de entrar sem perfil. É o comportamento que a IKCOUS já tem; a tela já impede (conferido no código:
-- `AuthView` tem `maxLength={120}` no nome e a máscara `mascaraTelefoneDoCadastro` limita o telefone a 15 caracteres). Nenhuma mudança
-- de front. Nenhuma edge function muda.
--
-- 8. ORDEM E ROLLBACK
--
-- Depende só das tabelas e da função já existentes (baseline). Banco antes ou depois do front dá no mesmo. Vale IKCOUS e Savy; na
-- IKCOUS a migration é no-op (gatilho já existe, nenhum usuário sem perfil esperado). ROLLBACK MANUAL:
-- rollback-manual-20261399940000_o_cadastro_cria_o_perfil_em_toda_loja.sql tira SÓ o gatilho. ⚠️ Os perfis criados pelo reparo e o
-- `role = customer` gravado em `raw_app_meta_data` desses usuários ficam (dado legítimo). ⚠️ NUNCA rodar o rollback na IKCOUS: o
-- gatilho dela já existia ANTES desta migration (ela não o criou lá) e tirá-lo quebraria o cadastro da loja principal.
--
-- 9. FICHA DE VERIFICAÇÃO: consultas 129a (depois) / 129b (antes).
--   PROVA VIVA: tests/banco/o-cadastro-cria-o-perfil-em-toda-loja-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399940000$
DECLARE
  v_gatilho record;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: auth.users não existe — meça a loja e revise antes de aplicar.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'auth.users'::regclass AND NOT a.attisdropped
         AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype)
              OR (a.attname = 'raw_user_meta_data' AND a.atttypid = 'jsonb'::regtype)
              OR (a.attname = 'raw_app_meta_data' AND a.atttypid = 'jsonb'::regtype))) <> 3 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: auth.users sem id (uuid), raw_user_meta_data (jsonb) ou raw_app_meta_data (jsonb) — revise antes de aplicar.';
  END IF;
  IF to_regclass('public.profiles') IS NULL
     OR (SELECT count(*) FROM pg_attribute a
          WHERE a.attrelid = 'public.profiles'::regclass AND NOT a.attisdropped
            AND a.attname IN ('id', 'full_name', 'whatsapp', 'cpf', 'role')) <> 5 THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.profiles sem id, full_name, whatsapp, cpf ou role — revise antes de aplicar.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.handle_new_user()')
                    AND p.prorettype = 'trigger'::regtype AND p.prosecdef) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.handle_new_user() não existe, não devolve trigger ou não é SECURITY DEFINER — revise antes de aplicar.';
  END IF;

  -- Gatilho homônimo: tem de ser exatamente o desenhado (AFTER INSERT, por linha, sem WHEN, sem colunas, sem argumentos).
  SELECT t.tgfoid, t.tgtype, t.tgnargs, t.tgqual IS NOT NULL AS tem_quando, cardinality(t.tgattr::int2[]) AS n_colunas
    INTO v_gatilho
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal;
  IF FOUND AND (v_gatilho.tgfoid IS DISTINCT FROM to_regprocedure('public.handle_new_user()')::oid
                OR v_gatilho.tgtype <> 5
                OR v_gatilho.tgnargs <> 0
                OR v_gatilho.tem_quando
                OR v_gatilho.n_colunas <> 0) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: já existe um gatilho on_auth_user_created em auth.users que NÃO é o desenhado (função, momento, condição ou colunas diferentes) — revise antes de aplicar.';
  END IF;
END $preflight_20261399940000$;

-- (a) O gatilho, só se ausente.
DO $gatilho_20261399940000$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $gatilho_20261399940000$;

-- (b) O reparo: quem já se cadastrou sem perfil ganha a mesma linha que o gatilho teria criado. Só INSERT de linha ausente.
DO $reparo_20261399940000$
DECLARE
  v_inseridos bigint;
  v_outro_papel bigint;
  v_acima_do_teto bigint;
BEGIN
  SELECT count(*) INTO v_outro_papel
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
     AND COALESCE(u.raw_app_meta_data->>'role', 'customer') <> 'customer';

  SELECT count(*) INTO v_acima_do_teto
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
     AND COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'
     AND (char_length(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuário')) > 120
          OR char_length(u.raw_user_meta_data->>'phone') > 20);

  INSERT INTO public.profiles (id, full_name, whatsapp, cpf, role)
  SELECT u.id,
         COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuário'),
         u.raw_user_meta_data->>'phone',
         u.raw_user_meta_data->>'cpf',
         'customer'
    FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
     AND COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'
     AND char_length(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuário')) <= 120
     AND COALESCE(char_length(u.raw_user_meta_data->>'phone'), 0) <= 20
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inseridos = ROW_COUNT;

  RAISE NOTICE '20261399940000: % perfil(is) criado(s) para quem se cadastrou sem perfil; % usuário(s) sem perfil com outro papel (admin/gerente/vendedor) e % com nome ou telefone acima do teto NÃO foram tocados.',
    v_inseridos, v_outro_papel, v_acima_do_teto;
END $reparo_20261399940000$;

-- CONFERÊNCIA no instante do apply.
DO $conferencia_20261399940000$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
          AND t.tgfoid = to_regprocedure('public.handle_new_user()')::oid
          AND t.tgtype = 5 AND t.tgnargs = 0 AND t.tgqual IS NULL AND cardinality(t.tgattr::int2[]) = 0
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399940000: o gatilho on_auth_user_created não ficou como desenhado';
  END IF;
  IF EXISTS (
       SELECT 1 FROM auth.users u
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
          AND COALESCE(u.raw_app_meta_data->>'role', 'customer') = 'customer'
          AND char_length(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Usuário')) <= 120
          AND COALESCE(char_length(u.raw_user_meta_data->>'phone'), 0) <= 20
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399940000: ainda há usuário de cliente sem perfil depois do reparo';
  END IF;
END $conferencia_20261399940000$;
