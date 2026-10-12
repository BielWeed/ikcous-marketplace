// @ts-nocheck
/**
 * AVISO AO LOJISTA (push aos admins inscritos) — as duas peças que o webhook,
 * a reconciliação (cron) e a confirmação imediata compartilham. FASE 2 da
 * confirmação (04/10/2026): antes, cada caminho tinha a própria cópia do
 * mecanismo, e a reconciliação nem avisava venda 'pago'.
 *
 * 1. `dispararPushContadoReal` — o mecanismo: lê os admins e as inscrições,
 *    monta o VAPID, envia, e devolve QUANTAS inscrições receberam. 0 quando não
 *    há admin, não há inscrição, nenhuma entrega deu certo ou algo lançou
 *    (logado, NUNCA sobe): o pedido já está pago no banco quando isto roda, e
 *    um push fora do ar não pode mudar a resposta de quem confirmou.
 *
 * 2. `avisarAdminUmaVez` — o aviso UMA vez por chave, com a reserva com prazo
 *    da C-P (`reservar_/confirmar_/liberar_aviso_ao_lojista`, migration
 *    20261191000000), sem a espera "singleflight": quem encontra 'em_envio' ou
 *    'enviado' não avisa (a dona avisa; se o push dela não chegar a ninguém,
 *    ela libera e a próxima tentativa tenta de novo). Falha da reserva → avisa
 *    mesmo assim (falha aberta: perder um aviso de dinheiro é pior que repetir
 *    um). Nunca lança. Usado pela contestação que o app não consegue registrar
 *    sozinho (sem CBK, conflito, decisão revertida), pelo webhook E pela
 *    reconsulta periódica do cron.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { carregarChavesVapid, enviarParaInscritos, resumir } from "./webpush.ts";

type Supabase = ReturnType<typeof createClient>;
export type Aviso = { title: string; body: string; url: string };

export async function dispararPushContadoReal(args: {
  supabase: Supabase;
  aviso: Aviso;
  /** Prefixo dos logs ("webhook-mercadopago", "reconciliar-pagamentos"…). */
  rotulo?: string;
}): Promise<number> {
  const { supabase, aviso } = args;
  const rotulo = args.rotulo ?? "efeitos-do-pagamento";
  try {
    const { data: admins, error: erroAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (erroAdmins) throw erroAdmins;
    const ids = (admins ?? []).map((a: { id: string }) => a.id);
    if (ids.length === 0) {
      console.warn(`${rotulo}: nenhum admin cadastrado, aviso de pagamento sem destino`);
      return 0;
    }
    const { data: inscricoes, error: erroInscricoes } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (erroInscricoes) throw erroInscricoes;
    if (!inscricoes || inscricoes.length === 0) {
      console.warn(`${rotulo}: nenhum admin inscrito para push`);
      return 0;
    }
    const vapidKeys = await carregarChavesVapid(
      Deno.env.get("VAPID_PUBLIC_KEY"),
      Deno.env.get("VAPID_PRIVATE_KEY"),
    );
    const servidor = await webpush.ApplicationServer.new({
      contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.org",
      vapidKeys,
    });
    const itens = await enviarParaInscritos({
      servidor,
      inscricoes,
      mensagem: JSON.stringify(aviso),
      rotulo,
      aoDetectarMorta: (endpoint: string) =>
        supabase.from("push_subscriptions").delete().eq("endpoint", endpoint),
    });
    const resumo = resumir(itens);
    console.log(`${rotulo}: aviso de pagamento → ${resumo.enviados} entregues, ${resumo.falharam} falharam`);
    return resumo.enviados;
  } catch (erro) {
    console.error(`${rotulo}: falha ao disparar push de pagamento`, erro);
    return 0;
  }
}

export type AvisarAdminUmaVez = (chave: string, aviso: Aviso) => Promise<void>;

export async function avisarAdminUmaVez(args: {
  supabase: Supabase;
  enviarPushContado: (a: { supabase: Supabase; aviso: Aviso }) => Promise<number>;
  chave: string;
  aviso: Aviso;
  /** Prefixo dos logs. */
  rotulo?: string;
}): Promise<void> {
  const { supabase, enviarPushContado, chave, aviso } = args;
  const rotulo = args.rotulo ?? "efeitos-do-pagamento";
  let estado: string | null = null;
  try {
    const { data, error } = await supabase.rpc("reservar_aviso_ao_lojista", { p_chave: chave });
    if (error) throw error;
    estado = typeof data === "string" ? data : null;
  } catch (erro) {
    console.error(`${rotulo}: reservar_aviso_ao_lojista falhou — avisa mesmo assim (falha aberta)`, { chave, erro });
  }
  if (estado === "enviado" || estado === "em_envio") return;

  let entregues = 0;
  try {
    entregues = await enviarPushContado({ supabase, aviso });
  } catch (erro) {
    console.error(`${rotulo}: push ao admin falhou`, { chave, erro });
  }
  if (estado !== "reservado") return;
  const rpc = entregues > 0 ? "confirmar_aviso_ao_lojista" : "liberar_aviso_ao_lojista";
  try {
    const { error } = await supabase.rpc(rpc, { p_chave: chave });
    if (error) throw error;
  } catch (erro) {
    console.error(`${rotulo}: ${rpc} falhou — a reserva expira sozinha em 2 minutos`, { chave, erro });
  }
}
