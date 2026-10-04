// @ts-nocheck
/**
 * EFEITOS DO PAGAMENTO CONFIRMADO — o módulo ÚNICO dos avisos que saem quando
 * um pedido vira 'pago', qualquer que seja o caminho que o confirmou: a
 * confirmação NA HORA pela consulta do cliente (`criar-pagamento`,
 * 04/10/2026), o webhook do MP (`webhook-mercadopago`) e a reconciliação
 * (`reconciliar-pagamentos`, o cron). FASE 2 (04/10/2026): até aqui só a
 * confirmação imediata usava este módulo; o webhook e o cron faziam os efeitos
 * por conta própria — e o cron não mandava o push "Pedido pago" ao lojista
 * (medido em `_shared/efeitos-por-caminho_test.ts`; o pedido c35ce4dd foi
 * fechado por esse caminho).
 *
 * DUAS PEÇAS:
 *
 * 1. `confirmarPagamentoProvado` — chama a RPC `confirmar_pagamento` (a
 *    ÚNICA escrita de 'pago' do sistema, `FOR UPDATE`, transição única) com
 *    `{ p_order_id, p_payment_id: <vaga>, p_status: "pago" }`. Só é chamada
 *    depois de `provarPagamentoPelaConsulta` (`prova-de-pagamento.ts`)
 *    aprovar. Erro e exceção viram `{ ok: false }` — nunca lança: quem chama
 *    segue o contrato de antes (a confirmação fica para webhook/reconciliação).
 *
 * 2. `aplicarEfeitosDoPagamentoConfirmado` — 'pago' → push "Pedido pago" ao
 *    lojista + comprovante ao cliente; 'pago_apos_expirar' → push "Pagamento
 *    fora do fluxo" + o aviso HONESTO de pagamento atrasado. QUALQUER outro
 *    desfecho ('ja_pago', 'divergente', 'inexistente', 'ignorado', erro) →
 *    nada, nem a leitura do pedido.
 *
 * POR QUE OS EFEITOS NÃO SAEM EM DOBRO com dois caminhos chegando juntos:
 * a RPC devolve 'pago'/'pago_apos_expirar' para UMA chamada só — a que fez a
 * transição sob `FOR UPDATE`; a outra espera o lock e lê 'ja_pago'
 * (`tests/banco/pagamentos-rpc-viva.cjs`, prova (14)). Quem recebeu
 * 'ja_pago' não dispara nada, seja o webhook, o cron ou a confirmação
 * imediata. O comprovante tem ainda a reserva própria
 * (`reivindicar_email_de_confirmacao`). O push NÃO tem reserva própria: a
 * garantia dele é só essa transição única — por isso a regra "efeito só
 * depois de a RPC dizer que ESTE chamador confirmou" não tem exceção.
 *
 * O TEXTO MORA AQUI, UMA VEZ: `webhook-mercadopago/index.ts` e
 * `reconciliar-pagamentos/index.ts` chamam `serve()` no import (guardado só
 * contra o runner de teste), então um não pode importar do outro; a solução
 * é este módulo `_shared`. Os dois reexportam `htmlDoAvisoDePagamentoAtrasado`
 * e `assuntoDoAvisoDePagamentoAtrasado` só para os testes antigos.
 *
 * NADA AQUI LANÇA para quem chama: o pedido já está pago no banco quando os
 * efeitos rodam, e uma falha de push/e-mail não pode mudar a resposta ao
 * cliente nem virar "falha" do candidato da reconciliação. Cada efeito tem o
 * próprio `try/catch` — um push que lança não impede o comprovante.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispararPushContadoReal } from "./aviso-ao-lojista.ts";
import { enviarComprovantePedido } from "./comprovante.ts";
import { escaparHtml, formatarBRL, numeroDoPedido } from "./pedido.ts";
import { enviarEmail, remetenteConfigurado } from "./smtp.ts";
import { comTempoLimite } from "./webpush.ts";

type Supabase = ReturnType<typeof createClient>;
type Aviso = { title: string; body: string; url: string };

/** O teto de espera que o cron usa (`tetoDoPushMs`): o push continua em voo e,
 * no Edge Runtime, `comTempoLimite` mantém o isolado vivo. */
export const TETO_DO_PUSH_MS = 5000;

export type DepsDosEfeitos = {
  enviarPush?: (args: { supabase: Supabase; aviso: Aviso }) => Promise<void>;
  enviarComprovante?: (args: { supabase: Supabase; orderId: string }) => Promise<void>;
  enviarAvisoAtrasado?: (args: { supabase: Supabase; orderId: string }) => Promise<void>;
};

/** Os dois desfechos da RPC que são a transição DESTA chamada. */
export function desfechoComEfeito(resultado: unknown): resultado is "pago" | "pago_apos_expirar" {
  return resultado === "pago" || resultado === "pago_apos_expirar";
}

export async function confirmarPagamentoProvado(args: {
  supabase: Supabase;
  pedidoId: string;
  vaga: string;
}): Promise<{ ok: true; resultado: string } | { ok: false }> {
  const { supabase, pedidoId, vaga } = args;
  try {
    const { data, error } = await supabase.rpc("confirmar_pagamento", {
      p_order_id: pedidoId,
      p_payment_id: vaga,
      p_status: "pago",
    });
    if (error) {
      // Só ids e o código do erro — nada do pagador.
      console.error("efeitos-do-pagamento: confirmar_pagamento falhou na confirmação imediata", {
        orderId: pedidoId,
        paymentId: vaga,
        codigo: (error as Record<string, unknown>)?.code ?? null,
      });
      return { ok: false };
    }
    if (typeof data !== "string") {
      console.error("efeitos-do-pagamento: confirmar_pagamento devolveu valor ilegível", {
        orderId: pedidoId,
        paymentId: vaga,
      });
      return { ok: false };
    }
    return { ok: true, resultado: data };
  } catch (_erro) {
    console.error("efeitos-do-pagamento: confirmar_pagamento lançou na confirmação imediata", {
      orderId: pedidoId,
      paymentId: vaga,
    });
    return { ok: false };
  }
}

/**
 * O texto do push ao lojista — O ÚNICO, dos três caminhos. "fora do fluxo",
 * não "fora do prazo": a RPC devolve 'pago_apos_expirar' tanto para o pedido
 * EXPIRADO quanto para o CANCELADO pelo app e pago depois; "estoque já
 * devolvido" é verdade nas duas rotas.
 */
export function avisoAoLojista(orderId: string, resultado: string, valor: unknown): Aviso | null {
  if (resultado === "pago_apos_expirar") {
    return {
      title: "Pagamento fora do fluxo",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)} · estoque já devolvido`,
      url: "/admin-orders",
    };
  }
  if (resultado === "pago") {
    return {
      title: "Pedido pago",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)}`,
      url: "/admin-orders",
    };
  }
  return null;
}

export async function aplicarEfeitosDoPagamentoConfirmado(args: {
  supabase: Supabase;
  orderId: string;
  resultado: unknown;
  /** Teto de espera pelo push ao lojista. Ausente = sem teto (o que cada
   * chamador já fazia antes da FASE 2: a confirmação imediata tem o próprio
   * teto em volta de TUDO, `dispararSemEsperarCliente`; o cron passa
   * `TETO_DO_PUSH_MS`). Opção da chamada, não dublê de teste. */
  tetoDoPushMs?: number;
} & DepsDosEfeitos): Promise<void> {
  const { supabase, orderId, resultado } = args;
  if (!desfechoComEfeito(resultado)) return;
  try {
    // Leitura cosmética: o valor do push. A RPC devolve só um texto — nome,
    // número e valor vêm desta leitura. Falhou → push sem o valor (deixar o
    // lojista sem aviso é pior).
    let pedido: Record<string, unknown> | null = null;
    try {
      const { data } = await supabase
        .from("marketplace_orders")
        .select("id, customer_name, total, total_amount")
        .eq("id", orderId)
        .maybeSingle();
      pedido = (data as Record<string, unknown> | null) ?? null;
    } catch (_erro) {
      console.error("efeitos-do-pagamento: leitura do pedido para o push falhou", { orderId });
    }
    const aviso = avisoAoLojista(orderId, resultado, pedido?.total ?? pedido?.total_amount);

    const enviarPush = args.enviarPush ?? dispararPushAoLojistaReal;
    try {
      // A rejeição de um `enviarPush` injetado cai no catch abaixo, como a de
      // qualquer efeito. Com teto (o cron: um push service lento não pode
      // prender o laço de candidatos), a espera é limitada por `comTempoLimite`.
      if (aviso) {
        const emVoo = enviarPush({ supabase, aviso });
        await (args.tetoDoPushMs ? comTempoLimite(emVoo, args.tetoDoPushMs) : emVoo);
      }
    } catch (_erro) {
      console.error("efeitos-do-pagamento: push ao lojista falhou", { orderId, resultado });
    }

    try {
      if (resultado === "pago") {
        const enviarComprovante = args.enviarComprovante ?? dispararComprovanteReal;
        await enviarComprovante({ supabase, orderId });
      } else {
        const enviarAvisoAtrasado = args.enviarAvisoAtrasado ?? dispararAvisoDePagamentoAtrasadoReal;
        await enviarAvisoAtrasado({ supabase, orderId });
      }
    } catch (_erro) {
      console.error("efeitos-do-pagamento: aviso ao cliente falhou", { orderId, resultado });
    }
  } catch (_erro) {
    console.error("efeitos-do-pagamento: efeitos do pagamento confirmado falharam", { orderId, resultado });
  }
}

/**
 * Push aos admins inscritos (`aviso-ao-lojista.ts`, o mecanismo único — as
 * mesmas leituras, a mesma montagem VAPID, o mesmo `enviarParaInscritos`).
 * Nunca lança.
 */
export async function dispararPushAoLojistaReal(args: { supabase: Supabase; aviso: Aviso }): Promise<void> {
  await dispararPushContadoReal({ supabase: args.supabase, aviso: args.aviso, rotulo: "efeitos-do-pagamento" });
}

/**
 * Comprovante ao cliente — `_shared/comprovante.ts`, o miolo de
 * `send-order-confirmation`, chamado DIRETO (sem a porta HTTP pública, que
 * foi consertada três vezes: faltava a chamada, o texto mentia no pagamento
 * atrasado, a chave JWT nova x legada). Reserva única por pedido:
 * `reivindicar_email_de_confirmacao`, um UPDATE condicional atômico em que só
 * a primeira chamada ganha — repetição não precisa de trava aqui.
 *
 * SÓ PARA 'pago' (achado de revisão de contexto limpo, 25/08/2026):
 * `enviarComprovantePedido` só sabe ler o literal 'pago' (`aguardandoPagamento`
 * compara `payment_status !== 'pago'`, e 'pago_apos_expirar' cai nesse
 * `true`). Para 'pago_apos_expirar' o comprovante mentiria DUAS vezes — diria
 * "aguardando confirmação" (já foi confirmado) e "entra na fila de separação"
 * (o pedido segue `cancelled`, estoque já devolvido) — e, como a reserva é
 * única e definitiva, o e-mail certo nunca poderia ser mandado depois. Esse
 * retorno recebe `dispararAvisoDePagamentoAtrasadoReal`, abaixo.
 *
 * Nunca lança: nem a exceção inesperada, nem o `{ ok: false, motivo }` que
 * `enviarComprovantePedido` devolve sem lançar (SMTP não configurado, pedido
 * sem e-mail, reserva já gasta por outro chamador).
 */
export async function dispararComprovanteReal(args: { supabase: Supabase; orderId: string }): Promise<void> {
  const { supabase, orderId } = args;
  try {
    const desfecho = await enviarComprovantePedido({ supabase, orderId });
    if (!desfecho.ok) {
      console.error("efeitos-do-pagamento: comprovante ao cliente não enviado", { orderId, motivo: desfecho.motivo });
    }
  } catch (_erro) {
    console.error("efeitos-do-pagamento: falha ao disparar comprovante ao cliente", { orderId });
  }
}

/**
 * O texto HONESTO de 'pago_apos_expirar' (PEÇA 5, 12/09/2026) — nunca o HTML
 * do comprovante padrão. Nunca afirmar "prazo" nem "automaticamente": a RPC
 * devolve 'pago_apos_expirar' por DOIS caminhos (a varredura de 30 min, e o
 * cliente que CANCELA pelo app com o QR na mão e paga o PIX segundos depois)
 * — só "já estava cancelado" e "estoque já tinha voltado" são verdade nos
 * dois. Não promete estoque nem reenvio automático: diz só o que é fato — o
 * pagamento chegou, o pedido foi cancelado antes, e a loja vai resolver.
 */
export function htmlDoAvisoDePagamentoAtrasado(args: {
  orderId: string;
  nomeDaLoja: string;
}): string {
  const { orderId, nomeDaLoja } = args;
  const loja = String(nomeDaLoja ?? "").trim();
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
      <p style="margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa;">
        Pedido ${escaparHtml(numeroDoPedido(orderId))}
      </p>
      ${loja ? `<p style="margin: 0 0 20px; font-size: 18px; font-weight: 800;">${escaparHtml(loja)}</p>` : ""}
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #3f3f46;">
        Recebemos a confirmação do seu pagamento para este pedido, mas ele já estava cancelado e o estoque já tinha voltado para a loja quando o pagamento foi confirmado — por isso não entrou na fila de separação.
      </p>
      <p style="margin: 0; font-size: 14px; line-height: 20px; color: #3f3f46;">
        A loja já foi avisada do pagamento e vai entrar em contato para resolver (reenvio, se ainda houver estoque, ou devolução do valor pago).
      </p>
    </div>
  `;
}

export function assuntoDoAvisoDePagamentoAtrasado(orderId: string, nomeDaLoja: string): string {
  const loja = String(nomeDaLoja ?? "").trim();
  const numero = numeroDoPedido(orderId);
  return loja ? `Pedido ${numero} · ${loja}` : `Pedido ${numero}`;
}

/**
 * Aviso de pagamento atrasado ao cliente: falha fechada antes de reservar,
 * e-mail do pedido e depois o da conta, MESMA reserva do comprovante
 * (`reivindicar_email_de_confirmacao` — um pedido nunca recebe os dois
 * textos), devolve a reserva se o SMTP recusar. Nunca lança.
 */
export async function dispararAvisoDePagamentoAtrasadoReal(args: {
  supabase: Supabase;
  orderId: string;
}): Promise<void> {
  const { supabase, orderId } = args;
  try {
    if (!remetenteConfigurado()) {
      console.error("efeitos-do-pagamento: SMTP não configurado — aviso de pagamento atrasado não enviado", orderId);
      return;
    }
    const { data: pedido, error: erroPedido } = await supabase
      .from("marketplace_orders")
      .select("id, user_id, customer_data")
      .eq("id", orderId)
      .maybeSingle();
    if (erroPedido) throw erroPedido;
    if (!pedido) {
      console.warn("efeitos-do-pagamento: pedido do aviso de pagamento atrasado não encontrado", orderId);
      return;
    }
    const linha = pedido as Record<string, unknown>;
    let destinatario = String(
      linha.customer_data ? (linha.customer_data as Record<string, unknown>).email ?? "" : "",
    ).trim();
    if (!destinatario && linha.user_id) {
      const { data: conta } = await supabase.auth.admin.getUserById(String(linha.user_id));
      destinatario = String(conta?.user?.email ?? "").trim();
    }
    if (!destinatario) {
      console.warn("efeitos-do-pagamento: pedido pago_apos_expirar sem e-mail de cliente", orderId);
      return;
    }
    const { data: reservou, error: erroReserva } = await supabase.rpc(
      "reivindicar_email_de_confirmacao",
      { p_order_id: orderId },
    );
    if (erroReserva) throw erroReserva;
    if (reservou !== true) return;

    const { data: config } = await supabase
      .from("store_config")
      .select("store_name")
      .limit(1)
      .maybeSingle();
    const nomeDaLoja = String((config as Record<string, unknown> | null)?.store_name ?? "");
    try {
      await enviarEmail({
        para: destinatario,
        assunto: assuntoDoAvisoDePagamentoAtrasado(orderId, nomeDaLoja),
        html: htmlDoAvisoDePagamentoAtrasado({ orderId, nomeDaLoja }),
      });
    } catch (erroEnvio) {
      await supabase
        .rpc("liberar_email_de_confirmacao", { p_order_id: orderId })
        .then(undefined, () => {
          console.error("efeitos-do-pagamento: liberar reserva do aviso de pagamento atrasado falhou", orderId);
        });
      throw erroEnvio;
    }
    console.log(`efeitos-do-pagamento: aviso de pagamento atrasado enviado para ${orderId}`);
  } catch (_erro) {
    console.error("efeitos-do-pagamento: falha ao enviar aviso de pagamento atrasado ao cliente", orderId);
  }
}
