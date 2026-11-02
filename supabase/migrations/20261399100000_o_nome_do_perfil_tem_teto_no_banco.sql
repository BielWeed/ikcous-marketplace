-- ============================================================================
-- Migration 20261399100000 — o nome do perfil (e o WhatsApp) têm teto no banco
-- (abuso de tamanho por quem só tem a chave pública + uma conta; caçada de segurança de 02/11/2026 — a irmã que
-- faltou depois da 20261391000000 (pergunta), da 20261396200000 (avaliação) e da 20261218000000 (foto do perfil))
-- ============================================================================
--
-- 1. O DEFEITO
--
-- `public.profiles.full_name` é só `text` e nada no banco olha o tamanho. O gatilho `sync_public_profile`
-- (`handle_public_profile_sync`, AFTER INSERT/UPDATE/DELETE em `profiles`) copia o nome para `public.public_profiles`, e as
-- views `vw_questions_public` e `vw_reviews_public` devolvem esse nome como `author_name` ao visitante sem login. Uma conta
-- qualquer chama `update_my_profile_secure(repeat('A', 2000000), …)` (ou faz UPDATE direto na própria linha) e o banco aceita
-- 2.000.000 de caracteres; depois cada pergunta ou avaliação dessa conta faz a página do produto baixar megabytes para TODO
-- visitante (o front lê as perguntas sem paginação, `src/hooks/useQuestions.ts`). `profiles.whatsapp` tem o mesmo buraco
-- (`update_my_profile_secure` e o cadastro gravam o que vier), embora não chegue à vitrine.
--
-- 2. O QUE MUDA (só objeto NOVO; nenhuma linha lida para decidir nem reescrita)
--
-- Três CHECKs, todos criados NOT VALID (valem para TODO INSERT e TODO UPDATE a partir daqui e NÃO reprovam, no ADD, as linhas
-- antigas): `profiles_full_name_ate_120_caracteres` (`char_length(full_name) <= 120`), `public_profiles_full_name_ate_120_caracteres`
-- (a mesma regra na cópia pública, que o gatilho preenche e que o visitante lê) e `profiles_whatsapp_ate_20_caracteres`
-- (`char_length(whatsapp) <= 20`). `char_length` conta caracteres (pontos de código). NULL e vazio passam (CHECK com NULL não
-- reprova): o nome é opcional no banco e o WhatsApp também.
--
-- Os tetos têm folga sobre o que a tela produz: o WhatsApp sai das máscaras de `src/utils/telefone.ts` e
-- `src/lib/telefone-br.ts` com no máximo 15 caracteres ("(11) 91234-5678"; fora de 11 dígitos o cadastro corta em 15); 20 deixa
-- espaço para "+55 (11) 91234-5678" (19). 120 caracteres para um nome é folga larga (não medida em loja: veja a consulta da seção 3). As telas NÃO têm
-- `maxLength` no campo de nome (`AccountSettingsView`, `AuthView`): quem digitar mais de 120 leva a recusa do banco (veja 6).
--
-- QUEM GRAVA ESSAS COLUNAS HOJE (conferido no código e nas migrations): `handle_new_user` (cadastro; lê `full_name`/`name` e
-- `phone` do metadado do usuário), `update_my_profile_secure`, `handle_public_profile_sync` (copia o nome para `public_profiles`;
-- é o único escritor dessa tabela). `set_my_cpf` e `definir_cargo` atualizam OUTRAS colunas de `profiles` (e por isso reavaliam
-- o CHECK da linha inteira — veja 3).
--
-- 3. ⚠️ A GUARDA: A MIGRATION SE RECUSA A APLICAR SE JÁ HOUVER VALOR ACIMA DO TETO (leia antes de aplicar)
--
-- NOT VALID só dispensa a conferência das linhas existentes NO MOMENTO do ADD. O Postgres confere o CHECK em TODO INSERT e em
-- TODO UPDATE da linha, mesmo que a coluna do CHECK não mude. Logo, um perfil antigo com nome acima de 120 (ou WhatsApp acima de
-- 20) travaria QUALQUER alteração dele: trocar a foto, `set_my_cpf`, `definir_cargo`, e até o gatilho de cópia para
-- `public_profiles`. É a mesma armadilha da 20261396200000 (lá, o pagamento do pedido falhava via `tr_compra_verifica_avaliacoes`;
-- aqui nenhum gatilho de pedido atualiza `profiles`, mas a conta ficaria impossível de editar).
--
-- Por isso a migration TEM UMA GUARDA: logo depois dos ADD CONSTRAINT (as tabelas já estão trancadas, então nenhum perfil novo
-- entra entre a conferência e o fim), ela procura valor acima do teto e, se achar, ABORTA com `B1_BASELINE_DIVERGENT` — a
-- transação inteira desfaz, nenhum CHECK fica e nada muda. Nesse caso NÃO aplicar nessa loja sem decidir o que fazer com essas
-- linhas (encurtar o nome à mão é decisão da lojista/do dono; esta migration não faz). A guarda só varre a coluna cujo CHECK
-- foi criado NESTA aplicação (reaplicar com os CHECKs já presentes é no-op e não varre).
--
-- ⚠️ MEDIÇÃO PRÉVIA, SÓ LEITURA, EM CADA LOJA, ANTES DE APLICAR (esperado: tudo 0). Não lê o conteúdo, só conta e mede:
--
--   SELECT count(*) AS profiles_nome_acima_de_120, max(char_length(full_name)) AS maior
--     FROM public.profiles WHERE char_length(full_name) > 120;
--   SELECT count(*) AS public_profiles_nome_acima_de_120, max(char_length(full_name)) AS maior
--     FROM public.public_profiles WHERE char_length(full_name) > 120;
--   SELECT count(*) AS profiles_whatsapp_acima_de_20, max(char_length(whatsapp)) AS maior
--     FROM public.profiles WHERE char_length(whatsapp) > 20;
--
-- Custo da guarda: até três varreduras (`profiles`, `public_profiles`, `profiles`) com as tabelas trancadas, dentro do
-- `statement_timeout` de 30 s (tabelas pequenas numa loja). O `VALIDATE CONSTRAINT` fica de fora de propósito: esta migration
-- não o roda.
--
-- 4. PRÉ-VOO (B1_BASELINE_DIVERGENT, ANTES de qualquer escrita)
--
-- As três colunas (`profiles.full_name`, `profiles.whatsapp`, `public_profiles.full_name`) têm de existir como text; cada CHECK,
-- se já existir, tem de ser exatamente o desenhado (NOT VALID ou já validado). Estados aceitos por CHECK: não existe (cria) ou
-- existe como desenhado (reaplicar é no-op).
--
-- 5. IDEMPOTÊNCIA, TRANSAÇÃO E TRAVA
--
-- Cada CHECK só é criado se ainda não existe: rodar duas vezes deixa o mesmo estado. Sem BEGIN/COMMIT de nível superior (regra
-- da casa): o aplicador dá a transação; pré-voo, criação, guarda e conferência caem juntos ou não caem. `ADD CONSTRAINT … CHECK`
-- tranca a tabela por um instante (ACCESS EXCLUSIVE): com `lock_timeout = 5s`, loja em uso falha limpo em vez de travar quem
-- entra ou edita o perfil — repetir depois. A ordem de trava é `profiles` e depois `public_profiles`, a MESMA do gatilho de
-- cópia (grava `profiles`, que dispara a escrita em `public_profiles`): nenhum deadlock novo. Nenhum GRANT/REVOKE; nenhuma
-- função nova.
--
-- 6. O QUE ISSO MUDA PARA QUEM USA (e o que fica de fora)
--
-- Nome com mais de 120 caracteres passa a ser recusado (23514): em "Salvar" da conta a tela mostra o aviso genérico de que não
-- foi possível atualizar o perfil; no CADASTRO, `handle_new_user` (a função está nas migrations; o gatilho em `auth.users`
-- é do Supabase Auth e não está) grava o perfil dentro do INSERT da conta: nome ou telefone acima do teto recusado ali derruba o
-- cadastro inteiro com a mensagem genérica de cadastro, em vez de gravar um perfil impossível. Ninguém legítimo digita 120
-- caracteres de nome; a correção na tela (`maxLength` e aviso de "nome muito longo") é trabalho de front, FORA desta migration
-- (o banco é o chão de segurança, a tela é a cortesia).
--
-- 7. ORDEM E ROLLBACK
--
-- Nenhuma dependência de outra migration além das tabelas `profiles` e `public_profiles`. Nenhum front e nenhuma edge function
-- mudam: banco antes ou depois do front dá no mesmo. ROLLBACK MANUAL: rollback-manual-20261399100000_o_nome_do_perfil_tem_teto_no_banco.sql
-- tira os três CHECKs (únicos objetos criados aqui; não há estado anterior a restaurar, o esquema volta byte a byte ao de
-- antes). Nenhuma linha muda.
--
-- 8. FICHA DE VERIFICAÇÃO: consultas 118a (depois) / 118b (antes).
--   PROVA VIVA: tests/banco/o-nome-do-perfil-tem-teto-no-banco-viva.cjs (rpc-ci).
-- ============================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_20261399100000$
DECLARE
  v_item record;
  v_def text;
BEGIN
  FOR v_item IN
    SELECT * FROM (VALUES
      ('profiles', 'full_name'),
      ('profiles', 'whatsapp'),
      ('public_profiles', 'full_name')
    ) AS t(tabela, coluna)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = to_regclass('public.' || v_item.tabela)
                      AND a.attname = v_item.coluna AND a.atttypid = 'text'::regtype AND NOT a.attisdropped) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: public.%.% (text) não existe — meça a loja e revise antes de aplicar.', v_item.tabela, v_item.coluna;
    END IF;
  END LOOP;

  FOR v_item IN
    SELECT * FROM (VALUES
      ('profiles', 'profiles_full_name_ate_120_caracteres', 'CHECK ((char_length(full_name) <= 120))'),
      ('public_profiles', 'public_profiles_full_name_ate_120_caracteres', 'CHECK ((char_length(full_name) <= 120))'),
      ('profiles', 'profiles_whatsapp_ate_20_caracteres', 'CHECK ((char_length(whatsapp) <= 20))')
    ) AS t(tabela, nome, definicao)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('public.' || v_item.tabela) AND c.conname = v_item.nome;
    IF FOUND AND v_def NOT IN (v_item.definicao || ' NOT VALID', v_item.definicao) THEN
      RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: % já existe com outra regra (%) — revise antes de aplicar.', v_item.nome, v_def;
    END IF;
  END LOOP;
END $preflight_20261399100000$;

-- Os tetos: nome até 120 (profiles e a cópia pública) e WhatsApp até 20. NOT VALID — as linhas antigas não são reprovadas no ADD.
DO $teto_do_perfil_20261399100000$
DECLARE
  v_criou_nome boolean := false;
  v_criou_nome_publico boolean := false;
  v_criou_whatsapp boolean := false;
  v_n bigint;
  v_maior integer;
  v_achados text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.profiles'::regclass
                    AND c.conname = 'profiles_full_name_ate_120_caracteres') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_full_name_ate_120_caracteres CHECK (char_length(full_name) <= 120) NOT VALID;
    v_criou_nome := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.public_profiles'::regclass
                    AND c.conname = 'public_profiles_full_name_ate_120_caracteres') THEN
    ALTER TABLE public.public_profiles
      ADD CONSTRAINT public_profiles_full_name_ate_120_caracteres CHECK (char_length(full_name) <= 120) NOT VALID;
    v_criou_nome_publico := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.profiles'::regclass
                    AND c.conname = 'profiles_whatsapp_ate_20_caracteres') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_whatsapp_ate_20_caracteres CHECK (char_length(whatsapp) <= 20) NOT VALID;
    v_criou_whatsapp := true;
  END IF;

  -- A GUARDA (cabeçalho, seção 3): com o CHECK ativo, perfil antigo acima do teto trava qualquer alteração dele.
  -- As tabelas já estão trancadas pelos ADD. Só varre a coluna cujo CHECK nasceu agora.
  IF v_criou_nome THEN
    SELECT count(*), max(char_length(full_name)) INTO v_n, v_maior
      FROM public.profiles WHERE char_length(full_name) > 120;
    IF v_n > 0 THEN
      v_achados := v_achados || format(' profiles.full_name: %s linha(s) acima de 120 (a maior tem %s);', v_n, v_maior);
    END IF;
  END IF;
  IF v_criou_nome_publico THEN
    SELECT count(*), max(char_length(full_name)) INTO v_n, v_maior
      FROM public.public_profiles WHERE char_length(full_name) > 120;
    IF v_n > 0 THEN
      v_achados := v_achados || format(' public_profiles.full_name: %s linha(s) acima de 120 (a maior tem %s);', v_n, v_maior);
    END IF;
  END IF;
  IF v_criou_whatsapp THEN
    SELECT count(*), max(char_length(whatsapp)) INTO v_n, v_maior
      FROM public.profiles WHERE char_length(whatsapp) > 20;
    IF v_n > 0 THEN
      v_achados := v_achados || format(' profiles.whatsapp: %s linha(s) acima de 20 (a maior tem %s);', v_n, v_maior);
    END IF;
  END IF;
  IF v_achados <> '' THEN
    RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: há perfil com valor acima do teto —% a migration NÃO foi aplicada (a transação desfaz tudo e nenhum CHECK fica). Com o CHECK ativo essas linhas travariam qualquer alteração delas (foto, CPF, cargo, a cópia para public_profiles). Decida o que fazer com esses perfis (encurtar é decisão da lojista) e aplique de novo.', v_achados;
  END IF;
END $teto_do_perfil_20261399100000$;

-- CONFERÊNCIA no instante do apply.
DO $conferencia_20261399100000$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.profiles'::regclass AND c.conname = 'profiles_full_name_ate_120_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(full_name) <= 120)) NOT VALID',
                                              'CHECK ((char_length(full_name) <= 120))')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399100000: o CHECK de 120 caracteres do nome em profiles não ficou';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.public_profiles'::regclass AND c.conname = 'public_profiles_full_name_ate_120_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(full_name) <= 120)) NOT VALID',
                                              'CHECK ((char_length(full_name) <= 120))')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399100000: o CHECK de 120 caracteres do nome em public_profiles não ficou';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.profiles'::regclass AND c.conname = 'profiles_whatsapp_ate_20_caracteres'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) IN ('CHECK ((char_length(whatsapp) <= 20)) NOT VALID',
                                              'CHECK ((char_length(whatsapp) <= 20))')
     ) THEN
    RAISE EXCEPTION 'conferencia 20261399100000: o CHECK de 20 caracteres do WhatsApp em profiles não ficou';
  END IF;
END $conferencia_20261399100000$;
