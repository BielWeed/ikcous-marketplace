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
 *    nada, nem a leitura do pedido (exceção única descrita abaixo).
 *
 * POR QUE OS EFEITOS NÃO SAEM EM DOBRO com dois caminhos chegando juntos:
 * a RPC devolve 'pago'/'pago_apos_expirar' para UMA chamada só — a que fez a
 * transição sob `FOR UPDATE`; a outra espera o lock e lê 'ja_pago'
 * (`tests/banco/pagamentos-rpc-viva.cjs`, prova (14)). Quem recebeu
 * 'ja_pago' não dispara nada, seja o webhook, o cron ou a confirmação
 * imediata. O comprovante tem ainda a reserva própria
 * (`reivindicar_email_de_confirmacao`), e o push ao lojista também
 * (`avisos_ao_lojista`: `pago_fora_do_fluxo:<pedido>` desde o r210-h,
 * `pedido_pago:<pedido>` desde o lote-582). A regra "efeito só depois de a RPC
 * dizer que ESTE chamador confirmou" vale para o push e o comprovante. ÚNICAS
 * exceções, todas do webhook em 'ja_pago' e todas decididas por reserva
 * atômica: o push ao lojista que a transição entregou a 0
 * (`reavisarLojistaNaReentrega`), e o e-mail ao cliente que ainda não saiu —
 * aviso de 'pago_apos_expirar' ou comprovante de 'pago' online e recente
 * (`reenviarEmailPendenteDoPagamento`).
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
import { avisarAdminUmaVez, dispararPushContadoReal } from "./aviso-ao-lojista.ts";
import {
  devolverReserva,
  enviarComprovantePedido,
  lerEmailDaConta,
  ORCAMENTO_DO_ENVIO_MS,
} from "./comprovante.ts";
import { escaparHtml, formatarBRL, numeroDoPedido } from "./pedido.ts";
import { resolverRemetente } from "./email-da-loja.ts";
import { enviarEmail } from "./smtp.ts";
import { comTempoLimite } from "./webpush.ts";

type Supabase = ReturnType<typeof createClient>;
type Aviso = { title: string; body: string; url: string };

/** O teto de espera que o cron usa (`tetoDoPushMs`): o push continua em voo e,
 * no Edge Runtime, `comTempoLimite` mantém o isolado vivo. */
export const TETO_DO_PUSH_MS = 5000;

/** O teto de espera pelo e-mail (comprovante ou aviso atrasado) de quem espera os
 * efeitos — o webhook responde ao Mercado Pago e o cron segue para o próximo
 * pagamento. Acima do orçamento do próprio envio (`ORCAMENTO_DO_ENVIO_MS`), que é
 * quem estoura de verdade; este cobre o resto (leituras do banco, consulta da
 * conta). Passado o teto o e-mail segue em voo (`comTempoLimite` mantém o isolado
 * vivo); só quem espera deixa de esperar. */
export const TETO_DO_EMAIL_MS = ORCAMENTO_DO_ENVIO_MS + 5000;

export type DepsDosEfeitos = {
  enviarPush?: (args: { supabase: Supabase; aviso: Aviso }) => Promise<void>;
  /** Como `enviarPush`, mas DIZ quantas inscrições receberam (0 = ninguém). É o que o
   * push ao lojista ('pago' e 'pago_apos_expirar') usa para reservar/liberar
   * (`avisarAdminUmaVez`).
   * `enviarPush`, quando injetado, tem precedência (o seam antigo, sem contagem: um
   * envio que não lançou conta como entregue). Sem nenhum dos dois: o push real. */
  enviarPushContado?: (args: { supabase: Supabase; aviso: Aviso }) => Promise<number>;
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
  const temValor = (typeof valor === "number" || (typeof valor === "string" && valor.trim() !== "")) &&
    Number.isFinite(Number(valor));
  const trechoDoValor = temValor ? ` · ${formatarBRL(valor)}` : "";
  if (resultado === "pago_apos_expirar") {
    return {
      title: "Pagamento fora do fluxo",
      body: `${numeroDoPedido(orderId)}${trechoDoValor} · estoque já devolvido`,
      url: `/admin-orders?id=${encodeURIComponent(orderId)}`,
    };
  }
  if (resultado === "pago") {
    return {
      title: "Pedido pago",
      body: `${numeroDoPedido(orderId)}${trechoDoValor}`,
      url: `/admin-orders?id=${encodeURIComponent(orderId)}`,
    };
  }
  return null;
}

/** A chave da reserva do aviso "Pagamento fora do fluxo": uma por pedido. Mora na
 * MESMA tabela e nas MESMAS RPCs dos irmãos (`valor_divergente`, `cartao_duplicado`). */
export function chaveDoAvisoForaDoFluxo(orderId: string): string {
  return `pago_fora_do_fluxo:${orderId}`;
}

/** A chave da reserva do aviso "Pedido pago" (lote-582): uma por pedido, na MESMA
 * tabela `avisos_ao_lojista`. Separada da de 'pago_apos_expirar': são dois fatos. */
export function chaveDoAvisoDePedidoPago(orderId: string): string {
  return `pedido_pago:${orderId}`;
}

/**
 * O push ao lojista do pagamento confirmado ("Pedido pago" ou "Pagamento fora do
 * fluxo") com reserva e nova tentativa (`avisarAdminUmaVez`): entregue a 1+
 * inscrição → a chave fica 'enviado' e NUNCA se repete; entrega 0 (sem admin
 * inscrito, VAPID falhou, push service 5xx ou lento, push lançou) → a reserva é
 * liberada e a próxima entrega do MP ('ja_pago', `reavisarLojistaNaReentrega`)
 * tenta de novo. Nunca lança.
 */
async function avisarLojistaComReserva(args: {
  supabase: Supabase;
  orderId: string;
  resultado: "pago" | "pago_apos_expirar";
  aviso: Aviso;
  enviarPush?: DepsDosEfeitos["enviarPush"];
  enviarPushContado?: DepsDosEfeitos["enviarPushContado"];
}): Promise<void> {
  const { supabase, orderId, resultado, aviso } = args;
  const injetado = args.enviarPush;
  const empurrar = injetado
    ? async (a: { supabase: Supabase; aviso: Aviso }) => {
      await injetado(a);
      return 1;
    }
    : args.enviarPushContado ??
      ((a: { supabase: Supabase; aviso: Aviso }) =>
        dispararPushContadoReal({ supabase: a.supabase, aviso: a.aviso, rotulo: "efeitos-do-pagamento" }));
  const enviarPushContado = async (a: { supabase: Supabase; aviso: Aviso }): Promise<number> => {
    try {
      return await empurrar(a);
    } catch (_erro) {
      // Push que lança = entrega zero (a reserva é liberada). O MESMO registro de
      // antes, para quem vigia o log: o aviso de dinheiro que não saiu.
      console.error("efeitos-do-pagamento: push ao lojista falhou", { orderId, resultado });
      return 0;
    }
  };
  await avisarAdminUmaVez({
    supabase,
    enviarPushContado,
    chave: resultado === "pago_apos_expirar" ? chaveDoAvisoForaDoFluxo(orderId) : chaveDoAvisoDePedidoPago(orderId),
    aviso,
    rotulo: "efeitos-do-pagamento",
  });
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
  /** Teto de espera pelo e-mail ao cliente (webhook e cron passam
   * `TETO_DO_EMAIL_MS`). Ausente = sem teto, como o push: a confirmação imediata
   * tem o próprio teto em volta de TUDO (`dispararSemEsperarCliente`), e um
   * `comTempoLimite` aninhado registraria um segundo `waitUntil`. O e-mail é o
   * último efeito e nenhum outro depende dele. */
  tetoDoEmailMs?: number;
} & DepsDosEfeitos): Promise<void> {
  const { supabase, orderId, resultado } = args;
  if (!desfechoComEfeito(resultado)) return;
  try {
    // Leitura cosmética: o valor do push. A RPC devolve só um texto — nome,
    // número e valor vêm desta leitura. Falhou → push sem o valor (deixar o
    // lojista sem aviso é pior).
    let pedido: Record<string, unknown> | null = null;
    try {
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select("id, customer_name, total, total_amount")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      pedido = (data as Record<string, unknown> | null) ?? null;
    } catch (_erro) {
      console.error("efeitos-do-pagamento: leitura do pedido para o push falhou", { orderId });
    }
    const aviso = avisoAoLojista(orderId, resultado, pedido?.total ?? pedido?.total_amount);

    try {
      // Com teto (o cron: um push service lento não pode prender o laço de
      // candidatos), a espera é limitada por `comTempoLimite`.
      if (aviso) {
        // Os dois avisos têm reserva e nova tentativa: a entrega a 0 libera a
        // chave e a reentrega 'ja_pago' do webhook tenta de novo. 'pago_apos_expirar'
        // desde o r210-h; 'pago' desde o lote-582 (antes era tiro único, e um push
        // service fora do ar calava a venda paga).
        const emVoo = avisarLojistaComReserva({
          supabase,
          orderId,
          resultado,
          aviso,
          enviarPush: args.enviarPush,
          enviarPushContado: args.enviarPushContado,
        });
        await (args.tetoDoPushMs ? comTempoLimite(emVoo, args.tetoDoPushMs) : emVoo);
      }
    } catch (_erro) {
      console.error("efeitos-do-pagamento: push ao lojista falhou", { orderId, resultado });
    }

    try {
      // O e-mail não pode prender quem espera (webhook, cron): com teto, como o
      // push do cron. Estourou o teto, o envio segue em voo e a reserva do
      // e-mail volta pelo prazo do próprio envio.
      let emVoo: Promise<void>;
      if (resultado === "pago") {
        const enviarComprovante = args.enviarComprovante ?? dispararComprovanteReal;
        emVoo = enviarComprovante({ supabase, orderId });
      } else {
        const enviarAvisoAtrasado = args.enviarAvisoAtrasado ?? dispararAvisoDePagamentoAtrasadoReal;
        emVoo = enviarAvisoAtrasado({ supabase, orderId });
      }
      await (args.tetoDoEmailMs ? comTempoLimite(emVoo, args.tetoDoEmailMs) : emVoo);
    } catch (_erro) {
      console.error("efeitos-do-pagamento: aviso ao cliente falhou", { orderId, resultado });
    }
  } catch (_erro) {
    console.error("efeitos-do-pagamento: efeitos do pagamento confirmado falharam", { orderId, resultado });
  }
}

/**
 * Comprovante ao cliente — `_shared/comprovante.ts`, o miolo de
 * `send-order-confirmation`, chamado DIRETO (sem a porta HTTP pública, que
 * foi consertada três vezes: faltava a chamada, o texto mentia no pagamento
 * atrasado, a chave JWT nova x legada). Reserva única por pedido:
 * `reivindicar_email_de_confirmacao`, um UPDATE condicional atômico em que só
 * a primeira chamada ganha — repetição não precisa de trava aqui.
 *
 * SÓ PARA 'pago': `enviarComprovantePedido` recusa online em qualquer outro
 * estado ANTES de reservar o e-mail. 'pago_apos_expirar' precisa do aviso
 * próprio, não do comprovante comum: o pedido segue `cancelled`, com estoque
 * já devolvido. Esse retorno recebe `dispararAvisoDePagamentoAtrasadoReal`,
 * abaixo, usando a mesma reserva única.
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
 * pagamento chegou, o pedido foi cancelado antes, e a loja vai resolver. NÃO
 * diz "a loja já foi avisada": o push ao lojista pode ter entregue a ninguém
 * (sem inscrito, chave inválida) e essa contagem não chega até aqui.
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
        A loja vai entrar em contato para resolver (reenvio, se ainda houver estoque, ou devolução do valor pago).
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
  /** Costura de teste: em produção, o resolvedor e o envio reais. */
  deps?: {
    resolverRemetente?: typeof resolverRemetente;
    enviarEmail?: typeof enviarEmail;
    /** Só o teste encurta; em produção vale `ORCAMENTO_DO_ENVIO_MS`. */
    orcamentoDoEnvioMs?: number;
  };
}): Promise<void> {
  const { supabase, orderId } = args;
  const resolver = args.deps?.resolverRemetente ?? resolverRemetente;
  const enviar = args.deps?.enviarEmail ?? enviarEmail;
  try {
    // Falha fechada ANTES de reservar (mesma regra do comprovante).
    const remetente = await resolver(supabase);
    if (remetente.origem === "nenhum") {
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
      // Duas tentativas, como o comprovante. Falha de LEITURA não é "sem e-mail":
      // para ANTES de reservar (a reserva fica livre para a reentrega do webhook)
      // e o log não mente dizendo que o pedido não tem e-mail.
      const conta = await lerEmailDaConta(supabase, String(linha.user_id), "efeitos-do-pagamento");
      if (conta.falhou) {
        console.error("efeitos-do-pagamento: leitura do e-mail da conta falhou — aviso de pagamento atrasado não enviado", orderId);
        return;
      }
      destinatario = String(conta.email ?? "").trim();
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
      // Prazo TOTAL contado daqui: só o SMTP gasta o orçamento. Estourou ->
      // ETIMEDOUT -> o `catch` abaixo devolve a reserva.
      const prazoFinalMs = performance.now() + (args.deps?.orcamentoDoEnvioMs ?? ORCAMENTO_DO_ENVIO_MS);
      await enviar({
        para: destinatario,
        assunto: assuntoDoAvisoDePagamentoAtrasado(orderId, nomeDaLoja),
        html: htmlDoAvisoDePagamentoAtrasado({ orderId, nomeDaLoja }),
      }, remetente, { prazoFinalMs });
    } catch (erroEnvio) {
      // EST-EDGE-DIN-3: o cliente do Supabase NÃO rejeita em falha — resolve
      // com `{ error }`, que o `.then(undefined, …)` de antes jamais via: a
      // reserva ficava presa e a reentrega do MP já não reenviava o aviso.
      // `devolverReserva` (a MESMA do comprovante) lê o resultado, registra e
      // tenta mais uma vez.
      await devolverReserva(supabase, orderId, "efeitos-do-pagamento");
      throw erroEnvio;
    }
    console.log(`efeitos-do-pagamento: aviso de pagamento atrasado enviado para ${orderId}`);
  } catch (_erro) {
    console.error("efeitos-do-pagamento: falha ao enviar aviso de pagamento atrasado ao cliente", orderId);
  }
}

/**
 * r210-h + lote-582 — a REENTREGA do push ao lojista. O push da transição é um
 * tiro: se ele entregou a 0 (nenhum admin com push inscrito, VAPID falhou, push
 * service fora do ar ou lento), a reentrega do MP chega como 'ja_pago' e, pela
 * regra "efeito só para quem fez a transição", não avisava de novo. Agora o
 * webhook chama isto no 'ja_pago' e pede a MESMA reserva da transição:
 * `pago_fora_do_fluxo:<pedido>` para o pedido que ESTÁ 'pago_apos_expirar' (r210-h)
 * e `pedido_pago:<pedido>` para o que ESTÁ 'pago' com `paid_at` dentro de 24 h
 * (lote-582). Na reserva: 'enviado' → não repete (sem spam); 'em_envio' → quem
 * está enviando é a outra entrega; 'reservado' (a transição entregou a 0 e
 * liberou) → tenta o push de novo. O texto é o de sempre.
 *
 * Pedidos que viraram 'pago_apos_expirar' (ou 'pago', dentro da janela) ANTES da
 * versão que reserva a chave deles não têm linha de reserva: a primeira reentrega
 * do MP que chegar depois da publicação avisa UMA vez a mais (e confirma a chave);
 * daí em diante, nunca mais. A janela do 'pago' existe para isso não alcançar a
 * notificação tardia de um pedido antigo (o lojista receberia "Pedido pago" de uma
 * venda de semanas atrás).
 *
 * Nada de e-mail, estoque, status ou dinheiro (o e-mail ao cliente é de
 * `reenviarEmailPendenteDoPagamento`). Nunca lança.
 */
export async function reavisarLojistaNaReentrega(args: {
  supabase: Supabase;
  orderId: string;
  enviarPush?: DepsDosEfeitos["enviarPush"];
  enviarPushContado?: DepsDosEfeitos["enviarPushContado"];
  /** Teto de espera pelo push (o webhook passa o dele); ausente = sem teto. */
  tetoDoPushMs?: number;
  /** Só o teste fixa o relógio; em produção vale `Date.now()`. */
  agoraMs?: number;
}): Promise<void> {
  const { supabase, orderId } = args;
  try {
    const { data, error } = await supabase
      .from("marketplace_orders")
      .select("payment_status, total, total_amount, paid_at")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    const pedido = data as Record<string, unknown> | null;
    // Falha FECHADA: só o estado lido reavisa — 'pago_apos_expirar' sempre, 'pago'
    // só com `paid_at` legível dentro da janela.
    let resultado: "pago" | "pago_apos_expirar";
    if (pedido?.payment_status === "pago_apos_expirar") {
      resultado = "pago_apos_expirar";
    } else if (pedido?.payment_status === "pago" && pagoDentroDaJanela(pedido.paid_at, args.agoraMs ?? Date.now())) {
      resultado = "pago";
    } else {
      return;
    }
    const aviso = avisoAoLojista(orderId, resultado, pedido.total ?? pedido.total_amount);
    if (!aviso) return;
    const emVoo = avisarLojistaComReserva({
      supabase,
      orderId,
      resultado,
      aviso,
      enviarPush: args.enviarPush,
      enviarPushContado: args.enviarPushContado,
    });
    await (args.tetoDoPushMs ? comTempoLimite(emVoo, args.tetoDoPushMs) : emVoo);
  } catch (_erro) {
    console.error("efeitos-do-pagamento: reaviso do push ao lojista falhou", { orderId });
  }
}

/** A janela em que o comprovante de um pedido 'pago' ainda pode ser reenviado pela
 * reentrega do MP: 24 h a partir do `paid_at`. Cobre o caso que motivou o reenvio
 * (o SMTP caiu e voltou em minutos ou horas; as notificações irmãs do MP chegam em
 * segundos ou minutos) e deixa de fora o pedido antigo: `confirmation_email_sent_at`
 * nasceu em 21/08/2026 SEM preenchimento retroativo, então todo pedido pago antes
 * disso tem a reserva nula sem nunca ter sido "esquecido". A MESMA janela vale para
 * o reaviso do push "Pedido pago" (lote-582). */
export const JANELA_DO_REENVIO_DO_COMPROVANTE_MS = 24 * 60 * 60 * 1000;

/** Quanto um `paid_at` pode estar à frente do relógio desta função (relógios de máquinas diferentes). */
const TOLERANCIA_DE_RELOGIO_MS = 5 * 60 * 1000;

/** `paid_at` legível e dentro da janela de reentrega. Ausente, nulo, ilegível,
 * antigo ou do futuro (além da tolerância de relógio) é "não". */
function pagoDentroDaJanela(paidAt: unknown, agoraMs: number): boolean {
  if (typeof paidAt !== "string") return false;
  const idadeMs = agoraMs - Date.parse(paidAt);
  if (!Number.isFinite(idadeMs)) return false;
  return idadeMs <= JANELA_DO_REENVIO_DO_COMPROVANTE_MS && idadeMs >= -TOLERANCIA_DE_RELOGIO_MS;
}

/**
 * Falha FECHADA: só vale o que a leitura afirma. Pago pelo site (`online` no
 * método E no canal — venda de balcão e pagamento na entrega nunca chegam
 * aqui) e com `paid_at` legível dentro da janela. Qualquer campo ausente,
 * nulo ou fora do formato é "não sei" e na dúvida não se manda e-mail.
 */
function comprovanteDeReentregaPermitido(pedido: Record<string, unknown>, agoraMs: number): boolean {
  if (pedido.payment_method !== "online" || pedido.canal !== "online") return false;
  return pagoDentroDaJanela(pedido.paid_at, agoraMs);
}

/**
 * EST-EDGE-DIN-3 (16/10/2026) — a REENTREGA do e-mail que não saiu. Nasceu só
 * para o aviso de 'pago_apos_expirar'; desde 12/11/2026 cobre também o
 * comprovante do pedido 'pago'.
 *
 * O buraco: o pedido vira 'pago' (ou 'pago_apos_expirar'), o SMTP falha, a
 * reserva do e-mail é devolvida e o webhook responde 200. A notificação
 * seguinte do MP recebe 'ja_pago' da RPC e, pela regra "efeito só para quem
 * fez a transição", não fazia NADA; o cron também não ajuda (exclui pedido com
 * `paid_at`). O cliente que pagou ficava sem e-mail e sem saber.
 *
 * O que faz: só quando a reserva do e-mail está livre (`confirmation_email_sent_at`
 * nulo — ninguém enviou nem está enviando), repete UM efeito, o e-mail ao
 * cliente: o aviso para 'pago_apos_expirar'; o comprovante para 'pago', este
 * só dentro de `comprovanteDeReentregaPermitido`. Nada de push (o reaviso ao
 * lojista é de `reavisarLojistaNaReentrega`, com a reserva própria), nada de
 * estoque, status ou dinheiro. Qualquer outro `payment_status` não faz nada.
 *
 * SÓ É CHAMADA no caminho 'ja_pago' do webhook, nunca na primeira confirmação
 * (que tem o efeito normal em `aplicarEfeitosDoPagamentoConfirmado`).
 *
 * IDEMPOTENTE e à prova de corrida pela MESMA reserva do comprovante: a leitura
 * daqui é só um filtro barato (poupa o SMTP e a leitura do remetente nas
 * reentregas comuns); quem decide de verdade é `reivindicar_email_de_confirmacao`,
 * um UPDATE condicional atômico dentro do próprio envio — duas reentregas
 * simultâneas com a reserva livre mandam UM e-mail. Nunca lança.
 */
export async function reenviarEmailPendenteDoPagamento(args: {
  supabase: Supabase;
  orderId: string;
  enviarAvisoAtrasado?: DepsDosEfeitos["enviarAvisoAtrasado"];
  enviarComprovante?: DepsDosEfeitos["enviarComprovante"];
  /** Teto de espera pelo e-mail (o webhook passa `TETO_DO_EMAIL_MS`); ausente = sem teto. */
  tetoDoEmailMs?: number;
  /** Só o teste fixa o relógio; em produção vale `Date.now()`. */
  agoraMs?: number;
}): Promise<void> {
  const { supabase, orderId } = args;
  try {
    const { data, error } = await supabase
      .from("marketplace_orders")
      .select("payment_status, confirmation_email_sent_at, paid_at, payment_method, canal")
      .eq("id", orderId)
      .maybeSingle();
    if (error) throw error;
    const pedido = data as Record<string, unknown> | null;
    if (!pedido) return;
    // Falha FECHADA: só o `null` explícito do banco é "reserva livre". Coluna
    // ausente na resposta (`undefined`) é "não sei" — e na dúvida não se manda
    // um e-mail que talvez já tenha saído.
    if (pedido.confirmation_email_sent_at !== null) return;
    let emVoo: Promise<void>;
    if (pedido.payment_status === "pago_apos_expirar") {
      const enviarAvisoAtrasado = args.enviarAvisoAtrasado ?? dispararAvisoDePagamentoAtrasadoReal;
      emVoo = enviarAvisoAtrasado({ supabase, orderId });
    } else if (
      pedido.payment_status === "pago" && comprovanteDeReentregaPermitido(pedido, args.agoraMs ?? Date.now())
    ) {
      const enviarComprovante = args.enviarComprovante ?? dispararComprovanteReal;
      emVoo = enviarComprovante({ supabase, orderId });
    } else {
      return;
    }
    await (args.tetoDoEmailMs ? comTempoLimite(emVoo, args.tetoDoEmailMs) : emVoo);
  } catch (_erro) {
    console.error("efeitos-do-pagamento: reenvio do e-mail pendente do pagamento falhou", { orderId });
  }
}
