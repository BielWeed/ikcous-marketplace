-- ============================================================================
-- Migration 20261391000000 — a foto da devolução e a pergunta do produto têm teto
-- (abuso de armazenamento e de tamanho por quem só tem a chave pública + uma conta;
-- caçada de segurança de 26/10/2026, itens A e B)
-- ============================================================================
--
-- ⚠️ RESTRITIVA (não é aditiva no sentido estrito): passa a RECUSAR gravações que hoje passam. Não
-- apaga tabela, coluna, linha nem objeto do bucket; nenhum DROP. Cria UMA função nova (a contagem do
-- teto). Tudo se desfaz pelo rollback-manual desta migration.
--
-- 1. O QUE ESTA MIGRATION CORRIGE
--
-- A) Fotos de devolução sem limite. A política `devolucoes_cliente_insert_policy` em storage.objects
--    (20261175000000) deixa QUALQUER conta logada gravar no bucket privado `devolucoes` qualquer
--    quantidade de arquivos na própria pasta ('<uid>/…'; 5 MB cada, só imagem). Sem pedido, sem
--    devolução: uma conta criada de graça enche o storage da loja (cobrado por GB) em laço.
-- B) Pergunta do produto sem teto de tamanho. A tela limita a 500 caracteres
--    (src/components/ui/custom/ProductQA.tsx, maxLength={500}), mas `public.questions.question` é só
--    `text NOT NULL` e a `questions_insert_policy` (20261036000000) não olha tamanho: pela API direta
--    uma conta grava pergunta de megabytes, que vai para a vitrine pública do produto
--    (vw_questions_public) e para o painel.
--
-- 2. O QUE MUDA
--
-- A) `ALTER POLICY devolucoes_cliente_insert_policy` (sem DROP: nome, comando INSERT, PERMISSIVE e o papel
--    `authenticated` ficam) acrescenta ao WITH CHECK de sempre (bucket `devolucoes` + primeira pasta =
--    auth.uid(), intactos) um TETO: a conta só grava se tiver MENOS DE 30 fotos SOLTAS no bucket — foto
--    solta é a da pasta dela que NENHUMA devolução referencia (`NOT EXISTS … name = ANY (d.fotos)`, a
--    mesma régua da política de DELETE da 20261216000000).
--    POR QUE "SOLTAS" E NÃO O TOTAL: o app sobe as fotos ANTES de a devolução existir
--    (useDevolucaoCliente.enviarFoto → só depois solicitar_devolucao com os caminhos), então o teto
--    NÃO pode exigir devolução aberta. E a foto que já é evidência de uma devolução nunca pode ser
--    apagada pela cliente (20261216): um teto sobre o TOTAL travaria para sempre a cliente fiel que
--    já fez umas dez devoluções com 6 fotos cada, sem conserto do lado dela. Contando só as soltas:
--      * fluxo legítimo: no máximo 6 soltas de cada vez (solicitar_devolucao aceita até 6 fotos,
--        CHECK cardinality(fotos) <= 6), e o app apaga as que não usou (descartarFotos, 20261216).
--        30 = cinco envios completos abandonados sem limpeza — folga de 5x sobre o pior caso real;
--      * abuso: as soltas ficam presas em 30 por conta (≤ 150 MB com o limite de 5 MB do bucket); foto
--        referenciada só nasce por solicitar_devolucao, que exige pedido entregue da própria conta e
--        aceita até 6 fotos por devolução — não é fábrica de armazenamento.
--    POR QUE UMA FUNÇÃO: uma subconsulta em storage.objects DENTRO de uma política de storage.objects é
--    recusada pelo Postgres ("infinite recursion detected in policy for relation objects", medido no
--    efêmero). A contagem mora em `public.devolucao__fotos_soltas_da_conta(p_uid uuid, p_teto integer)`:
--    LANGUAGE sql STABLE, SECURITY INVOKER (roda com a RLS de QUEM grava — a cliente enxerga a própria
--    pasta do bucket pela devolucoes_dono_ou_admin_select_policy e as próprias devoluções; nenhum
--    privilégio a mais), search_path fixo, EXECUTE só para authenticated e service_role. Ela para de
--    contar no teto (LIMIT p_teto): nunca varre mais que 30 linhas da conta. A política passa
--    auth.uid() como p_uid (a função não lê o schema auth); quem a chama direto com o uid de OUTRA conta
--    recebe 0, porque a RLS de quem chama esconde a pasta alheia — nada que a cliente já não pudesse
--    contar lendo a própria pasta.
--    LIMITE CONHECIDO: envios SIMULTÂNEOS da mesma conta enxergam a contagem de antes uns dos outros
--    (READ COMMITTED) e podem passar um pouco do teto — o excesso é limitado ao número de envios em voo
--    (o app manda um por vez). É um freio de abuso, não um contador exato.
--    Mensagem ao usuário: o Storage recusa com "new row violates row-level security policy"; o app já
--    mostra "Não foi possível enviar a foto." (mensagemDoErro). Nenhuma tela muda.
-- B) CHECK `questions_question_ate_500_caracteres` (char_length(question) <= 500, o mesmo teto da tela)
--    criado NOT VALID: vale para TODA pergunta nova e para todo UPDATE a partir daqui, e NÃO reprova as
--    linhas antigas. char_length conta caracteres (pontos de código); o maxLength do HTML conta unidades
--    UTF-16, que são sempre ≥ — nada que a tela aceita é recusado aqui. O VALIDATE CONSTRAINT só pode ser
--    rodado depois de MEDIR em cada loja que nenhuma pergunta viva passa de 500
--    (SELECT count(*) FROM public.questions WHERE char_length(question) > 500; esperado 0) — esta
--    migration não o roda: não há banco vivo medido neste lote.
--    PERGUNTA VAZIA OU SÓ DE ESPAÇOS: hoje NADA no banco a recusa (só NOT NULL); quem barra é a tela
--    (o botão fica desligado com !newQuestion.trim()). Fora do escopo desta migration — registrado.
--
-- 3. DADOS EXISTENTES
--
-- Nenhuma linha é lida para decidir nem reescrita, nenhum objeto do bucket é apagado. A) Conta que JÁ
-- tem 30 ou mais fotos soltas: tudo o que tem continua lá (leitura e DELETE das soltas iguais); só o
-- PRÓXIMO envio é recusado até ela (ou o app) apagar soltas. B) Pergunta antiga com mais de 500
-- caracteres continua lá e legível; só um UPDATE nela passaria a exigir o teto.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- A) A política tem de existir como INSERT, PERMISSIVE, só para authenticated, com a condição EXATA da
--    20261175000000 ou a desta (comparada sem espaços); NENHUMA outra política de INSERT/ALL em
--    storage.objects pode alcançar o bucket `devolucoes` (políticas permissivas se somam por OR: uma
--    mais larga anularia o teto); a função, se já existir, tem de ser exatamente a desta (md5 e
--    atributos); o que ela lê tem de existir.
-- B) `questions.question` tem de existir como text; o CHECK, se já existir, tem de ser exatamente este.
--
-- 5. IDEMPOTÊNCIA E TRANSAÇÃO
--
-- CREATE OR REPLACE da função com o mesmo texto, ALTER POLICY com a mesma condição e o CHECK só criado
-- se ainda não existe: rodar duas vezes deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra
-- da casa): o aplicador dá a transação; pré-voo, as mudanças e a conferência caem juntos ou não caem.
-- lock_timeout de 5s: o ALTER POLICY tranca storage.objects e o ADD CONSTRAINT tranca questions por um
-- instante; com a loja em uso, falha limpa em vez de travar o upload — repetir depois.
--
-- 6. ORDEM E ROLLBACK
--
-- Depois da 20261175000000, da 20261216000000 (régua da foto solta), da 20261360000000 (leitura da
-- própria pasta) e da 20261036000000. Banco antes do front (nenhum front muda aqui). ROLLBACK MANUAL:
-- rollback-manual-20261391000000_a_foto_da_devolucao_e_a_pergunta_tem_teto.sql devolve a condição da
-- 20261175000000 byte a byte, tira a função (criada aqui) e tira o CHECK.
--
-- 7. FICHA DE VERIFICAÇÃO: consultas 98a (depois) / 98b (antes).
--   PROVA VIVA: tests/banco/a-foto-da-devolucao-e-a-pergunta-tem-teto-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261391000000$
DECLARE
  -- pg_get_expr sem espaços, sem o prefixo "public." (o search_path de quem aplica varia).
  v_antes CONSTANT text := '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text))';
  v_desta CONSTANT text := '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)AND((SELECTdevolucao__fotos_soltas_da_conta((SELECTauth.uid()ASuid),30)ASdevolucao__fotos_soltas_da_conta)<30))';
  v_fn oid := to_regprocedure('public.devolucao__fotos_soltas_da_conta(uuid, integer)');
  v_pol record;
  v_def text;
BEGIN
  -- A) a política de INSERT do cliente
  IF to_regclass('storage.objects') IS NULL OR to_regclass('public.devolucoes') IS NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: storage.objects ou public.devolucoes não existe — aplique a 20261175000000 antes.';
  END IF;
  SELECT p.polcmd, p.polpermissive, p.polroles,
         regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') AS chk,
         p.polqual
    INTO v_pol
    FROM pg_policy p
   WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'devolucoes_cliente_insert_policy';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucoes_cliente_insert_policy não existe em storage.objects.';
  END IF;
  IF v_pol.polcmd <> 'a' OR NOT v_pol.polpermissive OR v_pol.polroles <> ARRAY['authenticated'::regrole::oid]
     OR v_pol.polqual IS NOT NULL THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucoes_cliente_insert_policy não é INSERT PERMISSIVE só para authenticated — meça a loja e revise.';
  END IF;
  IF v_pol.chk IS DISTINCT FROM v_antes AND v_pol.chk IS DISTINCT FROM v_desta THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: a condição viva de devolucoes_cliente_insert_policy (%) não é a da 20261175000000 nem a desta — capture-a e revise.', v_pol.chk;
  END IF;
  -- Nenhuma OUTRA política de INSERT/ALL pode alcançar o bucket (somaria por OR e anularia o teto):
  -- só se aceitam as presas a um bucket de uma lista fechada, sem OR no topo.
  IF EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = 'storage.objects'::regclass
          AND p.polcmd IN ('a', '*')
          AND p.polpermissive
          AND p.polname <> 'devolucoes_cliente_insert_policy'
          AND NOT (COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '^[(]+bucket_id = ''(banners|products|produtos|branding)''::text[)] AND '
                   AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ '[)] OR '
                   AND position('devolucoes' IN COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) = 0)
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: outra política de INSERT/ALL em storage.objects pode alcançar o bucket devolucoes — o teto seria anulado; meça a loja e revise.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.devolucoes'::regclass
                    AND a.attname = 'fotos' AND a.atttypid = 'text[]'::regtype AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.devolucoes.fotos (text[]) não existe.';
  END IF;
  -- A função da contagem: ausente (aplica) ou exatamente a desta (reaplicar é no-op).
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname = 'devolucao__fotos_soltas_da_conta') > (CASE WHEN v_fn IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao__fotos_soltas_da_conta existe com outra assinatura — revise.';
  END IF;
  IF v_fn IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_fn
          AND md5(replace(p.prosrc, E'\r', '')) = '0becd6ad09d4fad564a6622654cf0bc6'
          AND l.lanname = 'sql' AND p.prokind = 'f' AND NOT p.prosecdef AND p.provolatile = 's'
          AND p.proconfig = ARRAY['search_path=public']::text[]
          AND pg_get_function_result(p.oid) = 'integer'
     ) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: devolucao__fotos_soltas_da_conta(uuid, integer) já existe com outro corpo ou atributos — revise.';
  END IF;

  -- B) a coluna e o CHECK da pergunta
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.questions')
                    AND a.attname = 'question' AND a.atttypid = 'text'::regtype AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.questions.question (text) não existe.';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.questions'::regclass AND c.conname = 'questions_question_ate_500_caracteres';
  IF FOUND AND v_def NOT IN ('CHECK ((char_length(question) <= 500)) NOT VALID',
                             'CHECK ((char_length(question) <= 500))') THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: questions_question_ate_500_caracteres já existe com outra regra (%) — revise.', v_def;
  END IF;
END $preflight_20261391000000$;

-- A) A contagem das fotos SOLTAS da pasta p_uid, até p_teto (SECURITY INVOKER: a RLS de quem grava). A política
-- passa auth.uid(); chamada direta com outro uid só enxerga o que a RLS de quem chama deixa (a pasta alheia: nada).
CREATE OR REPLACE FUNCTION public.devolucao__fotos_soltas_da_conta(p_uid uuid, p_teto integer)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT count(*)::integer
    FROM (
      SELECT o.id
        FROM storage.objects o
       WHERE o.bucket_id = 'devolucoes'
         AND split_part(o.name, '/', 1) = p_uid::text
         AND NOT EXISTS (SELECT 1 FROM public.devolucoes d WHERE o.name = ANY (d.fotos))
       LIMIT p_teto
    ) soltas
$$;

REVOKE ALL ON FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.devolucao__fotos_soltas_da_conta(uuid, integer) IS
  'Teto das fotos de devolução (20261391000000): quantas fotos SOLTAS (na pasta p_uid, visíveis a quem chama, no bucket devolucoes, sem devolução que as referencie) a conta tem, contando até p_teto. SECURITY INVOKER: roda com a RLS de quem chama. Usada pela política devolucoes_cliente_insert_policy.';

-- O teto, por conta: menos de 30 soltas. Nome, comando, PERMISSIVE e papel ficam (ALTER, sem DROP).
ALTER POLICY devolucoes_cliente_insert_policy ON storage.objects
  WITH CHECK (
    bucket_id = 'devolucoes'
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND (SELECT public.devolucao__fotos_soltas_da_conta((SELECT auth.uid()), 30)) < 30
  );

-- B) O teto da pergunta: o mesmo da tela. NOT VALID — as linhas antigas não são reprovadas.
DO $teto_da_pergunta_20261391000000$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.questions'::regclass
                    AND c.conname = 'questions_question_ate_500_caracteres') THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_question_ate_500_caracteres CHECK (char_length(question) <= 500) NOT VALID;
  END IF;
END $teto_da_pergunta_20261391000000$;

-- CONFERÊNCIA no instante do apply.
DO $conferencia_20261391000000$
DECLARE
  v_desta CONSTANT text := '((bucket_id=''devolucoes''::text)AND(split_part(name,''/''::text,1)=((SELECTauth.uid()ASuid))::text)AND((SELECTdevolucao__fotos_soltas_da_conta((SELECTauth.uid()ASuid),30)ASdevolucao__fotos_soltas_da_conta)<30))';
  v_fn oid := to_regprocedure('public.devolucao__fotos_soltas_da_conta(uuid, integer)');
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_policy p
        WHERE p.polrelid = 'storage.objects'::regclass AND p.polname = 'devolucoes_cliente_insert_policy'
          AND p.polcmd = 'a' AND p.polpermissive AND p.polroles = ARRAY['authenticated'::regrole::oid]
          AND p.polqual IS NULL
          AND regexp_replace(replace(pg_get_expr(p.polwithcheck, p.polrelid), 'public.', ''), '[[:space:]]', '', 'g') = v_desta
     ) THEN
    RAISE EXCEPTION 'conferencia 20261391000000: devolucoes_cliente_insert_policy não ficou com o teto das fotos soltas';
  END IF;
  IF v_fn IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_proc p WHERE p.oid = v_fn AND md5(replace(p.prosrc, E'\r', '')) = '0becd6ad09d4fad564a6622654cf0bc6'
          AND NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'conferencia 20261391000000: devolucao__fotos_soltas_da_conta não ficou com o corpo desta migration';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                 WHERE p.oid = v_fn AND g.privilege_type = 'EXECUTE' AND g.grantee = 0) THEN
    RAISE EXCEPTION 'conferencia 20261391000000: EXECUTE de devolucao__fotos_soltas_da_conta não é só authenticated e service_role';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.questions'::regclass AND c.conname = 'questions_question_ate_500_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(question) <= 500)) NOT VALID',
                                              'CHECK ((char_length(question) <= 500))')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261391000000: o CHECK de 500 caracteres de questions não ficou';
  END IF;
END $conferencia_20261391000000$;
