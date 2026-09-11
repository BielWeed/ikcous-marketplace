-- ============================================================================
-- Migration 20261141000000 — a caderneta da frota (brief
-- equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md, tarefa T5,
-- 11/09/2026)
-- ============================================================================
--
-- O QUE ESTA MIGRATION FAZ: cria, no banco da PRINCIPAL, o cadastro central
-- que o porteiro (T3, `middleware.ts` estendido) e o `frota-estado.cjs`
-- (fora do repositório, `C:/Users/Gabriel/equipe/ferramentas/`) passam a
-- consultar para saber quais lojas existem e qual banco cada uma usa —
-- sem essa caderneta, "um build para toda a frota" não tem de onde ler a
-- lista de lojas.
--   - `public.frota_lojas`: uma linha por loja (id, nome, o host público
--     que ela atende, o `project_ref` do Supabase, a URL e a chave
--     publicável do banco dela, se está ativa).
--   - `public.frota_segredo`: uma linha única (`id = 1`) com o HASH do
--     segredo que autoriza a leitura da caderneta — nunca o segredo em
--     texto puro.
--   - `public.resolver_loja(p_host, p_chave)`: a única porta de entrada.
--     Sem a chave certa, devolve ZERO linhas SEM ERRO (não existe oráculo
--     "chave errada" vs. "host inexistente" — as duas respostas são
--     idênticas de fora). Com a chave certa, devolve a loja cujo
--     `dominio_publico` bate (case-insensitive) com o host pedido E que
--     está `ativa`.
--
-- POR QUE A CADERNETA E NÃO UMA LISTA NO CÓDIGO: o código é o mesmo para
-- toda a frota (a promessa da etapa 2); a lista de lojas muda quando um
-- cliente novo entra, e isso não pode exigir uma nova publicação.
--
-- RISCO — "loja A com dado de loja B" nasce exatamente aqui se qualquer
-- papel sem a chave conseguir listar `frota_lojas` (devolveria o
-- `project_ref` e o endpoint REST de TODOS os clientes — varredura de
-- dicionário, item 6 do parecer do sócio). Por isso:
--   1. `frota_lojas`/`frota_segredo` têm RLS ligado, NENHUMA policy, e
--      `REVOKE ALL ... FROM PUBLIC, anon, authenticated` logo depois de
--      criadas. **Achado confirmado no banco vivo, 11/09/2026** (leitura,
--      `pg_default_acl`): o schema `public` deste projeto tem um
--      `ALTER DEFAULT PRIVILEGES` gravado para o role `postgres` que
--      concede automaticamente TODOS os privilégios de tabela
--      (`arwdDxtm`) e `EXECUTE` de função a `anon`, `authenticated` E
--      `service_role` em QUALQUER objeto novo criado por `postgres` no
--      schema `public` — é o mesmo mecanismo, não documentado em nenhuma
--      migration, que explica os grants de `store_config` encontrados no
--      parecer do sócio (item 5). Sem o REVOKE explícito logo após o
--      CREATE, esta tabela nasceria de graça com INSERT/SELECT/UPDATE/
--      DELETE para `anon` e `authenticated` — o REVOKE não é defesa
--      decorativa, é a ÚNICA coisa que fecha essa porta.
--   2. `resolver_loja` é `SECURITY DEFINER` (ignora a RLS por dentro, de
--      propósito — é o único caminho de leitura) mas `REVOKE ALL ...
--      FROM PUBLIC, authenticated, service_role` e só `GRANT EXECUTE ...
--      TO anon` — pelo MESMO `ALTER DEFAULT PRIVILEGES` acima, a função
--      nasceria com EXECUTE de graça para os três; o REVOKE fecha
--      `authenticated`/`service_role` e o GRANT restringe a anon (que
--      ainda depende da chave para ver qualquer linha). NUNCA
--      `service_role` no porteiro (decisão do brief) — não ter EXECUTE
--      nesta função é uma segunda trava, não a única.
--   3. `resolver_loja` é `VOLATILE` (achado da revisão 11/09/2026, rodada
--      2 — NÃO `STABLE`), e o que isso compra é MENOS do que a rodada 2
--      escreveu. A versão anterior deste comentário afirmava que o
--      PostgREST "responde 405 a qualquer chamada que não seja
--      POST/OPTIONS" para função VOLATILE. MEDIDO pela hub em 11/09/2026,
--      contra o banco vivo da principal, DEPOIS de aplicar e semear:
--      `GET /rest/v1/rpc/resolver_loja?p_host=a&p_chave=b` (apikey pública)
--      respondeu **200** com `[]` — o GET NÃO é recusado. O que a doc
--      oficial (PostgREST v13, "Transactions > Access Mode on Functions")
--      garante é outra coisa: GET/HEAD rodam SEMPRE em transação READ
--      ONLY, e a lista "VOLATILE = só OPTIONS e POST" é o que o OPTIONS
--      ANUNCIA no cabeçalho `Allow`, não uma recusa. Como esta função só
--      lê, ela executa normalmente por GET. Logo `VOLATILE` NÃO tira o GET
--      da mesa; quem impede o segredo de viajar na querystring (log da
--      Vercel, log do gateway do Supabase, `Referer`) é a CONVENÇÃO DE
--      CHAMADA abaixo — o chamador (T3, `src/hospedagem/porteiro.ts`,
--      coberto por `tests/front/porteiro-caderneta.test.ts`) usa POST com
--      o segredo SÓ no corpo. `VOLATILE` fica por honestidade semântica e
--      pelo READ ONLY implícito, não como trava.
--   4. Sem a chave certa (`frota_segredo`), `resolver_loja` devolve zero
--      linhas para QUALQUER host — não existe forma de descobrir se um
--      host existe na frota sem a chave.
--
-- DADOS EXISTENTES: NADA é semeado aqui. A tabela nasce vazia em TODA
-- loja que receber esta migration (inclusive a Savy — ela recebe o
-- mesmo esquema, mas `frota_lojas` só é útil no banco que o porteiro
-- consulta via `IKCOUS_FROTA_URL`, que é o da principal). Os dados da
-- frota (as lojas e o segredo de produção) entram DEPOIS, pela hub, fora
-- desta migration — ver "Depois do lote" no brief.
--
-- CONVENÇÃO DE CHAMADA (decisão da hub, rodada B, 11/09/2026 — vale para
-- QUEM CHAMA `resolver_loja`, hoje o porteiro T3b, `src/hospedagem/
-- porteiro.ts`): SEMPRE `POST` (nunca `GET` — é para isso que a função é
-- `VOLATILE`, item 3 acima), em `/rest/v1/rpc/resolver_loja`, com:
--   - cabeçalhos `apikey` e `Authorization: Bearer` = a chave PÚBLICA
--     (publishable/anon) do projeto da PRINCIPAL (`IKCOUS_FROTA_APIKEY`)
--     — é o que o PostgREST exige em `apikey` para alcançar QUALQUER RPC,
--     mesmo uma que `anon` pode chamar sem JWT de usuário;
--   - corpo JSON `{ "p_host": "<host>", "p_chave": "<segredo>" }` — o
--     segredo (`IKCOUS_FROTA_CHAVE`) viaja SÓ no corpo, NUNCA em cabeçalho
--     nem em querystring: log da Vercel, log do gateway do Supabase e
--     cabeçalho `Referer` não veem o corpo de um POST.
-- Três variáveis no hospedeiro: `IKCOUS_FROTA_URL` (`https://<ref da
-- PRINCIPAL>.supabase.co`), `IKCOUS_FROTA_APIKEY` (a chave pública acima)
-- e `IKCOUS_FROTA_CHAVE` (o segredo cujo hash mora em `frota_segredo`).
--
-- CUSTO DO HASH (`gen_salt('bf', <custo>)`) — esta migration NÃO chama
-- `gen_salt` (o segredo é semeado DEPOIS, pela hub, fora daqui — ver
-- "DADOS EXISTENTES" acima); esta seção documenta o custo que a hub DEVE
-- usar ao semear, e por quê. Custo escolhido: **10**
-- (`extensions.crypt(segredo, extensions.gen_salt('bf', 10))`), medido em
-- 11/09/2026 (duas rodadas) contra o banco vivo da principal por
-- `scripts/db-prove-caderneta.cjs` (seção "2.5", dentro de transação com
-- ROLLBACK — nada gravado):
--   - N=20 chamadas de `resolver_loja` com CHAVE ERRADA (pior caso: o
--     `WHERE` sempre computa `crypt()` inteiro, bata ou não a chave)
--     deram média=1058,5–1088,8ms / máximo=1064–1091ms nas duas rodadas —
--     MUITO acima do alvo de 150ms do brief.
--   - MAS um baseline de `SELECT 1` (SEM bcrypt nenhum), pela MESMA
--     conexão/pooler/savepoint, já mediu mínimo=982–1011ms nas mesmas
--     rodadas — ou seja, o round-trip desta máquina de desenvolvimento
--     até o pooler da Supabase, SOZINHO, já é maior que o alvo de 150ms,
--     antes de qualquer hash. O número bruto acima mede a rede desta
--     máquina, não o custo de `gen_salt`.
--   - Isolando o bcrypt (máximo bruto − mínimo do baseline, NA MESMA
--     rodada): **80–82ms** — dentro do alvo de 150ms com folga. É esse
--     delta, não o bruto, que `CUSTO_BF` controla, e o que decide se o
--     porteiro (rodando na borda, com RTT até o Supabase provavelmente
--     bem menor que o desta máquina) fica lento por causa do hash.
--   - DIVERGÊNCIA registrada (não resolvida em silêncio): o alvo "< 150ms
--     no máximo" do brief, medido em NÚMERO BRUTO nesta rede, é
--     estruturalmente inalcançável a partir desta máquina — mesmo em
--     `gen_salt('bf', 4)` (o mínimo do pgcrypto) o baseline sozinho já
--     passaria de 150ms. A hub deve remedir o número BRUTO a partir de um
--     ambiente mais próximo do banco (a própria borda da Vercel, ou o
--     editor SQL do Supabase) se o alvo absoluto de 150ms for uma trava
--     de produto, não apenas do custo do hash.
--
-- IDEMPOTÊNCIA: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE
-- FUNCTION`, `ENABLE ROW LEVEL SECURITY` (reaplicar em RLS já ligado é
-- no-op) e `REVOKE`/`GRANT` (revogar o que já está revogado, ou conceder
-- o que já está concedido, é no-op) deixam o mesmo estado se este arquivo
-- for reaplicado. Reaplicar depois que a hub já inseriu lojas não apaga
-- nem sobrescreve nenhuma linha — `CREATE TABLE IF NOT EXISTS` não toca
-- em dado de tabela que já existe.
--
-- FORA DO ESCOPO: o front/porteiro que CHAMA `resolver_loja` (T3, arquivo
-- separado da mesma bancada); a trava `dominio_publico` em `store_config`
-- (T4, migration irmã `20261140000000`, aplicada em CADA loja — a
-- caderneta central e a trava por loja são mecanismos distintos: a
-- caderneta diz "quais lojas existem e onde", a trava por loja diz "este
-- host pode falar com este banco"); semear `frota_lojas`/`frota_segredo`
-- (hub, fora da migration, ver brief).
--
-- COMO APLICAR: exclusivamente em transação externa, via
-- node scripts/db-apply.cjs (uma transação por arquivo) ou psql -1. O
-- corpo de `resolver_loja` é PL/pgSQL (`LANGUAGE plpgsql`, com
-- `BEGIN`/`END` DENTRO do dollar-quote `$$...$$` da função — não é
-- controle de transação de nível superior) e não há `BEGIN`/`COMMIT` de
-- nível superior neste arquivo (regra da casa).
--
-- FICHA DE VERIFICAÇÃO pós-aplicação (rodar contra o banco; não rodada
-- por este agente fora da transação de prova abaixo):
--
--   1. SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid =
--      c.relnamespace WHERE n.nspname = 'public' AND relname IN
--      ('frota_lojas', 'frota_segredo');
--      -- esperado: 2 linhas.
--
--   2. SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid =
--      p.pronamespace WHERE n.nspname = 'public' AND proname =
--      'resolver_loja';
--      -- esperado: 1 linha.
--
--   3. SELECT grantee, privilege_type FROM information_schema.
--      role_table_grants WHERE table_name IN ('frota_lojas',
--      'frota_segredo');
--      -- esperado: 0 linhas para anon/authenticated/PUBLIC (só o dono
--      -- tem privilégio, e o dono não aparece nesta view por não ser
--      -- concedido explicitamente).
--
--   4. SELECT has_function_privilege('anon',
--      'public.resolver_loja(text,text)', 'EXECUTE'),
--      has_function_privilege('authenticated',
--      'public.resolver_loja(text,text)', 'EXECUTE'),
--      has_function_privilege('service_role',
--      'public.resolver_loja(text,text)', 'EXECUTE');
--      -- esperado: true, false, false.
--
--   5. SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid =
--      p.pronamespace WHERE n.nspname = 'public' AND p.proname =
--      'resolver_loja';
--      -- esperado: 'v' (VOLATILE) — é isso que fecha o caminho GET do
--      -- PostgREST (achado da revisão 11/09/2026, rodada 2).
--
--   6. Prova completa: node scripts/db-prove-caderneta.cjs (roda dentro
--      de transação, ROLLBACK no fim — nada gravado).
--
-- ROLLBACK: rollback-manual-20261141000000_*.sql versionado junto — dropa
-- a função e as duas tabelas. Reverter PRIMEIRO o porteiro (T3) e
-- `frota-estado.cjs` (que passam a depender desta caderneta); removê-la
-- antes disso faz o porteiro cair no caminho (b) do brief (ambiente do
-- próprio projeto) e o `frota-estado.cjs` responder `CADASTRO NAO
-- MEDIDO`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.frota_lojas (
  id text PRIMARY KEY,
  nome text NOT NULL,
  dominio_publico text NOT NULL UNIQUE
    CHECK (dominio_publico ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  project_ref text NOT NULL,
  supabase_url text NOT NULL,
  publishable_key text NOT NULL,
  ativa boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.frota_lojas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.frota_lojas FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.frota_segredo (
  id int PRIMARY KEY CHECK (id = 1),
  hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.frota_segredo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.frota_segredo FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolver_loja(p_host text, p_chave text)
RETURNS TABLE (
  id text,
  nome text,
  dominio_publico text,
  project_ref text,
  supabase_url text,
  publishable_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.frota_segredo fs
     WHERE fs.id = 1
       AND fs.hash = extensions.crypt(p_chave, fs.hash)
  ) THEN
    RETURN; -- zero linhas, sem erro — sem oráculo "chave errada" vs. "host inexistente"
  END IF;

  RETURN QUERY
  SELECT fl.id, fl.nome, fl.dominio_publico, fl.project_ref, fl.supabase_url, fl.publishable_key
    FROM public.frota_lojas fl
   WHERE lower(fl.dominio_publico) = lower(p_host)
     AND fl.ativa;
END;
$$;

REVOKE ALL ON FUNCTION public.resolver_loja(text, text) FROM PUBLIC, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_loja(text, text) TO anon;
