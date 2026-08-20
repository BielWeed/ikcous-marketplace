-- Desfaz 20260820000100_otp_sem_fila_nem_gatilho.sql
--
-- ⚠️ ESTE ROLLBACK SOZINHO NAO REVERTE O SISTEMA. Ele recria o gatilho, mas a
--    edge function publicada ja sera a NOVA, que recebe {email, whatsapp,
--    orderFragment} do navegador e NAO entende o payload {record} que o gatilho
--    manda. Reverter de verdade e:
--
--      1. rodar este arquivo;
--      2. republicar a versao ANTERIOR da send-otp-email
--         (`git show <commit-anterior>:supabase/functions/send-otp-email/index.ts`);
--      3. republicar o front antigo na Vercel.
--
--    Escrito aqui para quem precisar nao descobrir sozinho, no meio do
--    incidente.
--
-- O corpo de handle_new_otp_verification e' copia literal do baseline
-- 20260806000000_baseline_do_schema_vivo.sql, linhas 2907-2942.

CREATE OR REPLACE FUNCTION public.handle_new_otp_verification() RETURNS "trigger"
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_chave text;
BEGIN
    SELECT decrypted_secret
      INTO v_chave
      FROM vault.decrypted_secrets
     WHERE name = 'otp_trigger_secret';

    -- Nao postar com Bearer vazio: a edge function devolveria 401 e o convidado
    -- veria "enviamos o codigo" sem receber nada.
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

CREATE TRIGGER "on_otp_created_send_email"
    AFTER INSERT ON public.otp_verifications
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_otp_verification();

GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.generate_order_otp_v1(text, text, text) TO authenticated;
