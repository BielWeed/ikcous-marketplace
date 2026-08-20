// @ts-nocheck
/**
 * send-otp-email — manda o codigo de verificacao de pedido de convidado.
 *
 * QUEM CHAMA, E POR QUE MUDOU (#161 + #86)
 *   Ate 19/08/2026: tela -> RPC -> INSERT -> gatilho -> net.http_post -> aqui.
 *   O `net.http_post` ENFILEIRA e envia DEPOIS do commit, entao a RPC voltava
 *   antes de qualquer coisa acontecer e a tela dizia "codigo enviado" sem que
 *   ninguem jamais tivesse sabido o resultado. Nao era descuido: o banco era
 *   incapaz de saber.
 *
 *   Agora: tela -> aqui -> RPC v2 (service role) -> SMTP -> resposta.
 *   A resposta desta funcao e' o que a tela usa para decidir o que dizer.
 *
 * O QUE PROTEGE ESTA FUNCAO
 *   O portao de JWT do Supabase (`verify_jwt = true` no config.toml). A chave
 *   anon do app passa por ele — medido em 19/08/2026 — e e' isso que filtra
 *   trafego de fora do projeto. O segredo compartilhado do caminho antigo
 *   (OTP_TRIGGER_SECRET, lido do Vault pelo gatilho) deixou de existir junto
 *   com o gatilho, e com ele saiu a aceitacao de service_role no header, que
 *   era uma chave do projeto inteiro trafegando para mandar um e-mail.
 *
 *   Contra abuso de cota, o freio esta' na propria RPC v2: uma mensagem por
 *   PEDIDO a cada 60 segundos. Sem ele, um laco esgota as ~100 mensagens
 *   diarias da conta de Gmail da loja e nenhum cliente recebe codigo no resto
 *   do dia.
 *
 * POR QUE OS CODIGOS HTTP SAO ESTES
 *   200 -> a tela pode agir: ou os dados nao conferem (a pessoa corrige), ou o
 *          codigo saiu ha pouco (a pessoa espera). Nenhum dos dois e' falha.
 *   502 -> a loja falhou. Nao ha nada que quem compra possa corrigir.
 *   400 -> o corpo da requisicao veio malformado. Nao e' caso de cliente.
 *   Enfiar os tres num 400 obrigaria a tela a ler texto de erro para adivinhar
 *   qual foi.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enviarEmail, remetenteConfigurado } from "../_shared/smtp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Mascara para log. O endereco inteiro de quem compra nunca vai para o log. */
export function mascarar(email: string): string {
  const partes = String(email ?? "").split("@");
  if (partes.length !== 2) return "***";
  const [nome, dominio] = partes;
  const mascarado =
    nome.length > 2 ? `${nome[0]}***${nome[nome.length - 1]}` : "***";
  return `${mascarado}@${dominio}`;
}

/**
 * O corpo do e-mail. Sem nome de loja e sem cidade de proposito: este
 * repositorio e' o molde que se clona por cliente, e qualquer coisa cravada
 * aqui viaja para toda loja que existir. Quando a identidade da loja precisar
 * aparecer no e-mail, ela vem do banco (store_config), nunca daqui.
 */
export function htmlDoCodigo(codigo: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="font-size: 14px; line-height: 20px; color: #3f3f46; margin: 0 0 24px; font-weight: 500;">
        Voce pediu para acompanhar seu pedido. Use o codigo abaixo para continuar:
      </p>
      <div style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 20px; text-align: center; border-radius: 16px; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b; font-family: monospace; margin-bottom: 24px;">
        ${codigo}
      </div>
      <p style="font-size: 11px; line-height: 16px; color: #a1a1aa; text-align: center; margin: 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
        Este codigo expira em 15 minutos. Se nao foi voce, ignore este e-mail.
      </p>
    </div>
  `;
}

export function montarResposta(desfecho): Response {
  const status = desfecho.ok
    ? 200
    : desfecho.motivo === "envio_falhou" || desfecho.motivo === "sem_remetente"
      ? 502
      : desfecho.motivo === "pedido_invalido"
        ? 400
        : 200;
  return new Response(JSON.stringify(desfecho), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) {
  serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const corpo = await req.json().catch(() => null);
    const email = corpo?.email;
    const whatsapp = corpo?.whatsapp;
    const orderFragment = corpo?.orderFragment;
    if (!email || !whatsapp || !orderFragment) {
      return montarResposta({ ok: false, motivo: "pedido_invalido" });
    }

    // Falha fechada ANTES de gravar codigo nenhum. Gerar um codigo que nao vai
    // ser enviado deixaria a pessoa esperando um e-mail que nao existe, e ainda
    // queimaria a janela de 60 s do freio — ela sairia daqui sem codigo E sem
    // poder tentar de novo.
    if (!remetenteConfigurado()) {
      console.error("send-otp-email: SMTP nao configurado nesta loja");
      return montarResposta({ ok: false, motivo: "sem_remetente" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data, error } = await supabase.rpc("generate_order_otp_v2", {
      p_email: email,
      p_whatsapp: whatsapp,
      p_order_fragment: orderFragment,
    });

    if (error) {
      console.error("send-otp-email: RPC falhou:", error.message);
      return montarResposta({ ok: false, motivo: "envio_falhou" });
    }

    if (!data?.ok) {
      if (data?.motivo === "muito_recente") {
        return montarResposta({
          ok: false,
          motivo: "muito_recente",
          espereSegundos: Number(data.espere_segundos ?? 60),
        });
      }
      return montarResposta({ ok: false, motivo: "nao_confere" });
    }

    try {
      await enviarEmail({
        para: data.email,
        assunto: "Seu codigo de verificacao",
        html: htmlDoCodigo(data.otp_code),
      });
    } catch (e) {
      // O codigo ja esta gravado e vale 15 minutos. Nao apagamos: se o envio
      // falhou por intermitencia, uma segunda tentativa depois da janela de
      // 60 s gera outro codigo, e o antigo expira sozinho.
      console.error(
        `send-otp-email: envio falhou para ${mascarar(data.email)}: ${e?.message}`,
      );
      return montarResposta({ ok: false, motivo: "envio_falhou" });
    }

    console.log(`send-otp-email: enviado para ${mascarar(data.email)}`);
    return montarResposta({ ok: true });
  });
}
