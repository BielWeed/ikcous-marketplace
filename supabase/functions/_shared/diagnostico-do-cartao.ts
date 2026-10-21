// @ts-nocheck
import { extrairValorDaOrder, orderEhDeCartao, parcelasDaOrder } from "./mercadopago.ts";
import { comTempoLimite } from "./webpush.ts";

const TETO_DO_DIAGNOSTICO_MS = 1500;

const ESTADOS = new Set(["failed", "rejected", "processing", "in_process", "pending", "action_required"]);
const RECUSAS = new Set(["failed", "rejected"]);
const codigo = (v: unknown) => typeof v === "string" && /^[a-z][a-z0-9_]{0,119}$/.test(v) ? v : null;
const identificador = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null;

/**
 * Só recebe a resposta do MP (POST ou GET autenticados), nunca o webhook cru.
 * Projeção fechada: nenhum objeto de pagador, token ou dado de cartão sai daqui.
 * A UNIQUE no banco deduplica criação/notificação/reenvio. Análise usa DO NOTHING:
 * um evento de análise atrasado não apaga o motivo de uma recusa já registrada;
 * recusa faz DO UPDATE para substituir uma análise anterior.
 * Falha de diagnóstico jamais altera a decisão financeira. Não logar erro cru:
 * mensagens do PostgREST/MP podem ecoar corpo, credencial ou dado pessoal.
 */
export async function registrarDiagnosticoDoCartao(args: {
  supabase: { from: (tabela: string) => unknown };
  pedidoId: string;
  order: unknown;
  cartaoConhecido?: boolean;
}): Promise<void> {
  try {
    const o = args.order;
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    if (!args.cartaoConhecido && !orderEhDeCartao(o)) return;
    const pagamentos = o.transactions?.payments;
    if (!Array.isArray(pagamentos)) return;
    for (const p of pagamentos) {
      if (!p || typeof p !== "object" || Array.isArray(p)) continue;
      const status = codigo(p.status) ?? codigo(o.status);
      if (!ESTADOS.has(status)) continue;
      const mpOrderId = identificador(o.id);
      const mpPaymentId = identificador(p.id);
      const valor = typeof p.amount === "string" || typeof p.amount === "number"
        ? Number(p.amount) : extrairValorDaOrder(o);
      if (!mpOrderId || !mpPaymentId || !Number.isFinite(valor) || valor <= 0) {
        console.warn("diagnostico-do-cartao: tentativa sem identificadores/valor válidos; registro omitido");
        continue;
      }
      const linha = {
        pedido_id: args.pedidoId,
        mp_order_id: mpOrderId,
        mp_payment_id: mpPaymentId,
        status,
        status_detail: codigo(p.status_detail) ?? codigo(o.status_detail),
        parcelas: parcelasDaOrder({ transactions: { payments: [p] } }),
        valor,
        registrado_em: new Date().toISOString(),
      };
      const gravacao = Promise.resolve(args.supabase.from("tentativas_cartao_diagnostico").upsert(linha, {
        onConflict: "mp_order_id,mp_payment_id",
        ignoreDuplicates: !RECUSAS.has(status),
      }));
      // O diagnóstico não pode consumir a janela inteira da edge. O helper
      // existente mantém a gravação em waitUntil quando o runtime oferece.
      const resultado = await comTempoLimite(gravacao, TETO_DO_DIAGNOSTICO_MS);
      if (!resultado || resultado.error) console.warn("diagnostico-do-cartao: falha/timeout ao guardar tentativa; fluxo mantido");
    }
  } catch {
    console.warn("diagnostico-do-cartao: falha ao guardar tentativa; fluxo mantido");
  }
}
