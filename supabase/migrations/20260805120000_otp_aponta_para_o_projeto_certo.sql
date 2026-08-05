-- =============================================================================
-- O e-mail de OTP volta a apontar para o projeto que hospeda a função
-- (AUTH-020 #41, PEDIDO-050 #85, PEDIDO-080 #86)
-- =============================================================================
--
-- ESTADO MEDIDO NO BANCO E NO PAINEL EM 05/08/2026, não deduzido do repositório:
--
--   Corpo vivo de handle_new_otp_verification faz net.http_post para
--     https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email
--   e traz o comentário "(updated to jvgyjlbjhbfrncwbytls)" — foi edição manual,
--   aplicada por fora do repositório. A string jvgyjlbjhbfrncwbytls não existe em
--   nenhuma migration; o arquivo-base 20260708190000_secure_otp_flow.sql:92
--   sempre apontou para cafkrminfnokvgjqtkle.
--
--   `supabase functions list --project-ref jvgyjlbjhbfrncwbytls` devolve UM
--   function: calculate-shipping v1 (11/07). **send-otp-email não está publicado
--   naquele projeto.** O POST responde 404.
--
--   O send-otp-email de verdade está em cafkrminfnokvgjqtkle, ACTIVE, v6,
--   30/07/2026.
--
--   otp_verifications: 0 linhas. net._http_response: 0 linhas. O fluxo nunca foi
--   exercitado, e é por isso que três semanas de 404 passaram sem sintoma.
--
-- O SEGUNDO DEFEITO — trocar só a URL NÃO resolve
--
--   O corpo vivo busca a credencial em duas etapas:
--     1. public.app_settings where key = 'supabase_service_role_key'
--        → a tabela tem **ZERO linhas** (medido). v_apikey volta NULL.
--     2. fallback: (current_setting('request.headers'))->>'apikey'
--        → numa chamada de convidado via PostgREST isso é a **chave ANON**.
--
--   E send-otp-email/index.ts:35-54 só autoriza `Bearer` igual a
--   SUPABASE_SECRET_KEYS.default ou a SUPABASE_SERVICE_ROLE_KEY do ambiente da
--   edge function. A chave anon não é nenhuma das duas.
--
--   Ou seja: corrigir apenas o endereço trocaria 404 por 401, e o convidado
--   continuaria vendo "enviamos o código" sem receber nada. Por isso esta
--   migration mexe nos dois pontos, não em um.
--
-- O QUE MUDA
--
--   1. A URL volta para cafkrminfnokvgjqtkle — que é o que o arquivo-base já
--      dizia. Esta migration não inventa destino novo, ela desfaz uma edição
--      manual.
--
--   2. A credencial passa a sair do **Vault** (`supabase_vault` 0.3.1, instalado
--      e vazio — medido), no segredo `otp_trigger_secret`. O caminho por
--      `app_settings` e o fallback pelo header **saem**:
--        - `app_settings` está vazia e é lida por policy de admin; guardar
--          segredo de servidor numa tabela de configuração de aplicação foi o
--          que deixou o caminho ambíguo desde o começo;
--        - mandar a chave **anon** de quem chamou como `Bearer` nunca autenticou
--          nada. Era um fallback que só servia para transformar "sem credencial"
--          em "credencial errada", que é mais difícil de diagnosticar.
--
--      **O segredo é criado só para este uso — não é a `service_role`.** 256 bits
--      aleatórios, prefixo `otp_trig_`, instalado como `OTP_TRIGGER_SECRET` no
--      ambiente da edge function e guardado com o mesmo valor no Vault. Quem o
--      obtiver consegue disparar e-mail de OTP e nada mais; a `service_role`
--      abriria o banco inteiro, ignorando RLS. `send-otp-email/index.ts` aceita
--      os três durante a transição (este, o `default` de SUPABASE_SECRET_KEYS e a
--      SUPABASE_SERVICE_ROLE_KEY), mas a intenção é ficar só com este — ver #126.
--
--      O PEDIDO-020 (#89) vai precisar do mesmo mecanismo para chamar
--      send-order-whatsapp: outro segredo, com outro nome, não a reutilização
--      deste. Um segredo por função é o que mantém o raio de estrago pequeno.
--
--   3. Sem segredo, a função **falha alto** em vez de postar com `Bearer ` vazio.
--
-- POR QUE FALHAR ALTO, se o PEDIDO-010 (#115) preferiu retornar em vez de RAISE
--
--   Lá o RAISE reverteria o UPDATE que conta tentativas, e o contador ficaria
--   decorativo — o efeito colateral era o objetivo. Aqui é o contrário: a linha
--   em otp_verifications só tem valor se o código chegar ao cliente. Guardar o
--   código e não conseguir enviá-lo é exatamente o defeito que o PEDIDO-080 (#86)
--   descreve. Se não dá para entregar, é melhor a chamada falhar do que a tela
--   prometer.
--
--   Na prática esse RAISE não deve rodar nunca: o bloco DO abaixo recusa o apply
--   se o segredo não existir.
--
-- PRÉ-REQUISITO — os dois lados do segredo, ANTES de aplicar
--
--   O mesmo valor precisa existir em DOIS lugares, senão a edge function devolve
--   401 e o cliente não recebe o código:
--
--     a) ambiente da edge function, como `OTP_TRIGGER_SECRET`
--            supabase secrets set --env-file <arquivo> --project-ref cafkrminfnokvgjqtkle
--     b) Vault deste banco, no segredo `otp_trigger_secret`
--            SELECT vault.create_secret('<valor>', 'otp_trigger_secret', '<descrição>');
--
--   Feito em 05/08/2026 para o projeto de produção. Para recriar em outro projeto
--   — o staging do INFRA-270 (#131), por exemplo — gere um valor NOVO em vez de
--   copiar este: segredo compartilhado entre ambientes anula o isolamento que o
--   staging existe para dar.
--
--   O valor nunca passa por linha de comando nem por arquivo do repositório: o
--   `--env-file` lê de um arquivo temporário fora do projeto, que é apagado em
--   seguida.
--
--   A `send-otp-email` precisa estar deployada com o código que lê
--   `OTP_TRIGGER_SECRET` (`index.ts:35-44`). Deployada em 05/08/2026.
--
-- ROLLBACK
--
--   rollback-20260805120000_otp_aponta_para_o_projeto_certo.sql — restaura o
--   corpo vivo de 05/08 tal como medido, inclusive o 404. Rollback devolve o
--   estado anterior; ele não é uma segunda correção.
--
-- SEM `BEGIN`/`COMMIT` NESTE ARQUIVO, DE PROPÓSITO
--
--   Quem abre a transação é o chamador: `scripts/db-apply.cjs:204-211` faz
--   BEGIN → arquivo → INSERT no ledger → COMMIT, e os `db-prove-*.cjs` fazem
--   BEGIN → arquivo → asserções → ROLLBACK. Um `COMMIT` dentro do arquivo
--   fecharia a transação do chamador no meio: o ledger ficaria fora da
--   atomicidade no apply, e o ROLLBACK do prove viraria no-op — gravando em
--   produção o que devia ser só ensaio. Aconteceu aqui em 05/08/2026, com este
--   arquivo, porque ele foi escrito copiando o estilo do
--   20260708190000_secure_otp_flow.sql, de julho, que ainda usava BEGIN/COMMIT.
--   As migrations de agosto não usam. Não reintroduza.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Trava de apply: sem segredo, não adianta aplicar
-- -----------------------------------------------------------------------------
-- Sem isto, aplicar esta migration num banco sem o segredo troca um 404 por um
-- 401 e o sintoma continua idêntico do lado do cliente. Melhor recusar.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM vault.decrypted_secrets
         WHERE name = 'otp_trigger_secret'
           AND coalesce(decrypted_secret, '') <> ''
    ) THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Vault sem o segredo "otp_trigger_secret" — migration recusada.',
            HINT    = 'Gere um valor novo, instale como OTP_TRIGGER_SECRET no ambiente da send-otp-email e guarde o MESMO valor aqui: SELECT vault.create_secret(''<valor>'', ''otp_trigger_secret'', ''Bearer do trigger de OTP. Ver 20260805120000.'');';
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. A função do trigger
-- -----------------------------------------------------------------------------
-- `search_path = public` é mantido igual ao corpo vivo. `vault.` e `net.` são
-- qualificados no corpo, então não dependem do caminho de busca.
CREATE OR REPLACE FUNCTION public.handle_new_otp_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_chave text;
BEGIN
    SELECT decrypted_secret
      INTO v_chave
      FROM vault.decrypted_secrets
     WHERE name = 'otp_trigger_secret';

    -- Não postar com Bearer vazio: a edge function devolveria 401 e o convidado
    -- veria "enviamos o código" sem receber nada. Ver o cabeçalho.
    IF coalesce(v_chave, '') = '' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Código de verificação não enviado: segredo "otp_trigger_secret" ausente no Vault.',
            HINT    = 'Restaure o segredo. Enquanto ele faltar, o código não chega ao cliente e por isso a solicitação falha aqui, em vez de prometer entrega.';
    END IF;

    PERFORM net.http_post(
        url := 'https://cafkrminfnokvgjqtkle.functions.supabase.co/send-otp-email',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_chave
        ),
        body := jsonb_build_object(
            'type', 'INSERT',
            'table', 'otp_verifications',
            'record', row_to_json(NEW)::jsonb
        )
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_otp_verification() IS
    'Dispara send-otp-email no projeto cafkrminfnokvgjqtkle. Entre 08/07 e 05/08/2026 '
    'o corpo vivo apontava para jvgyjlbjhbfrncwbytls, onde a função não existe — '
    'todo POST era 404. A credencial sai do Vault (otp_trigger_secret), um segredo '
    'criado só para este uso — não a service_role; app_settings e o header apikey '
    'não são mais consultados. Ver #41, #85, #86.';

-- -----------------------------------------------------------------------------
-- 2. Reafirma o endurecimento de 20260709000000
-- -----------------------------------------------------------------------------
-- `CREATE OR REPLACE` preserva o ACL, mas reafirmar é barato e deixa o arquivo
-- autossuficiente para quem reconstruir este schema em staging (#131).
REVOKE EXECUTE ON FUNCTION public.handle_new_otp_verification()
    FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. O trigger NÃO é recriado
-- -----------------------------------------------------------------------------
-- `on_otp_created_send_email AFTER INSERT ON public.otp_verifications FOR EACH
-- ROW` já existe e está correto (medido em 05/08). `CREATE OR REPLACE FUNCTION`
-- basta: o trigger aponta para a função por OID, que não muda. Um DROP/CREATE
-- aqui abriria uma janela sem trigger sem necessidade.
