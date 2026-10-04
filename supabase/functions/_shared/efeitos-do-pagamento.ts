// @ts-nocheck
/**
 * EFEITOS DO PAGAMENTO CONFIRMADO — a confirmação NA HORA pela consulta do
 * cliente (`criar-pagamento`, 04/10/2026) e o que ela dispara depois.
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
 * 2. `aplicarEfeitosDoPagamentoConfirmado` — os efeitos DO WEBHOOK
 *    (`webhook-mercadopago/index.ts`, bloco depois de `confirmar_pagamento`),
 *    não os da reconciliação: 'pago' → push "Pedido pago" ao lojista +
 *    comprovante ao cliente; 'pago_apos_expirar' → push "Pagamento fora do
 *    fluxo" + o aviso HONESTO de pagamento atrasado. QUALQUER outro desfecho
 *    ('ja_pago', 'divergente', 'inexistente', 'ignorado', erro) → nada, nem a
 *    leitura do pedido.
 *
 * POR QUE OS EFEITOS NÃO SAEM EM DOBRO com o webhook chegando ao mesmo tempo:
 * a RPC devolve 'pago'/'pago_apos_expirar' para UMA chamada só — a que fez a
 * transição sob `FOR UPDATE`; a outra espera o lock e lê 'ja_pago'
 * (`tests/banco/pagamentos-rpc-viva.cjs`, prova (13)). Quem recebeu
 * 'ja_pago' não dispara nada, seja o webhook, seja esta rota. O comprovante
 * tem ainda a reserva própria (`reivindicar_email_de_confirmacao`).
 *
 * POR QUE TEXTO COPIADO, E NÃO IMPORTADO DO WEBHOOK: `webhook-mercadopago/
 * index.ts` chama `serve()` no import (guardado só contra o runner de teste),
 * e está sendo editado por outro lote. As cópias aqui são presas ao original
 * por TESTE DE PARIDADE (`efeitos-do-pagamento_test.ts` para o e-mail;
 * `criar-pagamento/index_test.ts` roda o handler do webhook e compara o push
 * byte a byte). Mesmo raciocínio do aviso atrasado, que já vivia duplicado no
 * webhook e na reconciliação: esta é a terceira cópia, com prova de que é igual.
 *
 * NADA AQUI LANÇA para quem chama: o pedido já está pago no banco quando os
 * efeitos rodam, e uma falha de push/e-mail não pode mudar a resposta ao
 * cliente. Cada efeito tem o próprio `try/catch` — um push que lança não
 * impede o comprovante.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { enviarComprovantePedido } from "./comprovante.ts";
import { escaparHtml, formatarBRL, numeroDoPedido } from "./pedido.ts";
import { enviarEmail, remetenteConfigurado } from "./smtp.ts";
import { carregarChavesVapid, enviarParaInscritos, resumir } from "./webpush.ts";

type Supabase = ReturnType<typeof createClient>;
type Aviso = { title: string; body: string; url: string };

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
 * O push ao lojista — CÓPIA do texto do webhook (`webhook-mercadopago/
 * index.ts`, bloco `resultado === "pago" || "pago_apos_expirar"`). "fora do
 * fluxo", não "fora do prazo": a RPC devolve 'pago_apos_expirar' tanto para o
 * pedido EXPIRADO quanto para o CANCELADO pelo app e pago depois.
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
} & DepsDosEfeitos): Promise<void> {
  const { supabase, orderId, resultado } = args;
  if (!desfechoComEfeito(resultado)) return;
  try {
    // Mesma leitura cosmética do webhook: o valor do push. Falhou → push sem
    // o valor (deixar o lojista sem aviso é pior).
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
      if (aviso) await enviarPush({ supabase, aviso });
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
 * Push aos admins inscritos — o miolo de `disparoPushContadoReal` do webhook
 * (mesmas leituras, mesma montagem VAPID, mesmo `enviarParaInscritos`). Nunca
 * lança.
 */
export async function dispararPushAoLojistaReal(args: { supabase: Supabase; aviso: Aviso }): Promise<void> {
  const { supabase, aviso } = args;
  try {
    const { data: admins, error: erroAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (erroAdmins) throw erroAdmins;
    const ids = (admins ?? []).map((a: { id: string }) => a.id);
    if (ids.length === 0) {
      console.warn("efeitos-do-pagamento: nenhum admin cadastrado, aviso de pagamento sem destino");
      return;
    }
    const { data: inscricoes, error: erroInscricoes } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (erroInscricoes) throw erroInscricoes;
    if (!inscricoes || inscricoes.length === 0) {
      console.warn("efeitos-do-pagamento: nenhum admin inscrito para push");
      return;
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
      rotulo: "criar-pagamento",
      aoDetectarMorta: (endpoint: string) =>
        supabase.from("push_subscriptions").delete().eq("endpoint", endpoint),
    });
    const resumo = resumir(itens);
    console.log(
      `efeitos-do-pagamento: aviso de pagamento → ${resumo.enviados} entregues, ${resumo.falharam} falharam`,
    );
  } catch (_erro) {
    console.error("efeitos-do-pagamento: falha ao disparar push de pagamento");
  }
}

/** Comprovante ao cliente — a MESMA peça do webhook (`_shared/comprovante.ts`,
 * reserva `reivindicar_email_de_confirmacao`). Só para 'pago' (ver o
 * comentário "SÓ PARA resultado === 'pago'" no webhook). Nunca lança. */
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
 * O texto HONESTO de 'pago_apos_expirar' — CÓPIA de
 * `htmlDoAvisoDePagamentoAtrasado` do webhook (paridade provada em
 * `efeitos-do-pagamento_test.ts`). Nunca afirmar "prazo" nem
 * "automaticamente": a RPC devolve 'pago_apos_expirar' também para o pedido
 * que o cliente CANCELOU pelo app.
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
 * Aviso de pagamento atrasado ao cliente — CÓPIA do
 * `dispararAvisoDePagamentoAtrasadoReal` do webhook: falha fechada antes de
 * reservar, mesma ordem de e-mail (o do pedido, depois o da conta), MESMA
 * reserva do comprovante (`reivindicar_email_de_confirmacao` — um pedido
 * nunca recebe os dois textos), devolve a reserva se o SMTP recusar. Nunca
 * lança.
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
