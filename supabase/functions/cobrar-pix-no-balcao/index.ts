// @ts-nocheck
/**
 * cobrar-pix-no-balcao — o PIX com QR da tela Vender (frente A,
 * docs/superpowers/plans/2026-09-28-balcao-pix-no-balcao.md).
 *
 * A venda nasce À ESPERA do PIX pela RPC `iniciar_venda_presencial_pix`
 * (migration 20261184000000: pending/aguardando/online/pix, estoque reservado
 * 30 min). Esta edge só fala com o Mercado Pago em nome da LOJA logada:
 *
 *   gerar    — cria a cobrança PIX (Orders API, chave de idempotência = id do
 *              pedido, a MESMA que `criar-pagamento` usaria para esse pedido)
 *              ou, se já existe, reconsulta e devolve o MESMO QR. Grava a vaga
 *              (`gateway_payment_id`) com UPDATE condicional e realinha
 *              `expires_at` com o vencimento real do QR, como o site.
 *   conferir — "Já pagou? Conferir agora": reconsulta a cobrança; aprovada e
 *              com o valor batendo (±R$ 0,05, a mesma régua do webhook e da
 *              reconciliação) → `confirmar_pagamento('pago')`, a ÚNICA escrita
 *              de pagamento. O gatilho da migration marca a entrega.
 *   cancelar — "Trocar forma"/"Cancelar PIX": cancela a cobrança NO MERCADO
 *              PAGO primeiro; só com o cancelamento confirmado (ou a cobrança
 *              já morta lá) cancela o pedido pela `update_order_status_atomic`
 *              com o JWT do lojista (devolve o estoque, grava o histórico com
 *              quem cancelou). Se o MP disser que já foi pago, NÃO cancela:
 *              confirma e responde pago.
 *
 * O QUE ELA NÃO FAZ: não confia no corpo para decidir dinheiro (a situação
 * sai sempre da linha do pedido relida); não mexe em pedido do SITE (só
 * `canal='presencial'` + `payment_method='online'`); não manda e-mail nem push
 * (o comprovante sai pelo `send-order-confirmation` depois do pago, reservado
 * uma vez só; o webhook continua avisando os admins como sempre).
 *
 * PORTA: `verify_jwt = true` no gateway + papel de admin conferido AQUI pela
 * MESMA fonte que `is_admin()` usa no banco (`app_metadata.role`, lido de
 * `auth.getUser` — nunca do corpo). O cartão continua desligado: esta edge só
 * cria PIX.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  cancelarOrder,
  consultarOrder,
  criarOrder,
  extrairDataExpiracaoOrder,
  extrairQrCode,
  extrairValorDaOrder,
  mapearStatusOrder,
  montarCorpoPixOrders,
  orderCancelada,
  TOLERANCIA_DE_VALOR,
} from "../_shared/mercadopago.ts";
import { resolverCredenciaisMp } from "../_shared/credenciais-mp.ts";
import { readKey } from "../_shared/webpush.ts";
import {
  EXPIRACAO_PIX_DO_BALCAO,
  emailDoPagador,
  expiracaoRealinhavel,
  situacaoDoPedido,
} from "../_shared/pix-do-balcao.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const COLUNAS_DO_PEDIDO =
  "id, canal, payment_method, status, payment_status, expires_at, gateway_payment_id, total, customer_data, user_id";

export const MENSAGEM_SEM_CREDENCIAL =
  "O PIX pelo app está indisponível nesta loja agora. Use outra forma de pagamento.";

type Acao = "gerar" | "conferir" | "cancelar";

export type DepsDoPixDoBalcao = {
  /** Client de SERVICE ROLE (leitura do pedido, gravação da vaga, confirmar_pagamento). */
  supabase?: any;
  /** Devolve o id do usuário se ele for admin da loja; `null` caso contrário. */
  verificarAdmin?: (authorization: string | null) => Promise<string | null>;
  /** Client que fala COMO o lojista (a RPC de cancelamento confere is_admin()). */
  clienteDoLojista?: (authorization: string) => any;
  /** Token do MP (lojista ou plataforma) — padrão: `resolverCredenciaisMp`. */
  tokenDoMercadoPago?: (supabase: any) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  agora?: () => Date;
};

const json = (corpo: unknown, status: number): Response =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function verificarAdminReal(authorization: string | null): Promise<string | null> {
  if (!authorization) return null;
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const cliente = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
    });
    const { data, error } = await cliente.auth.getUser();
    if (error || !data?.user) return null;
    // A MESMA fonte de `public.is_admin()` (baseline :3106-3118): o papel no
    // app_metadata, que só o servidor escreve.
    return data.user.app_metadata?.role === "admin" ? data.user.id : null;
  } catch (err) {
    console.error("cobrar-pix-no-balcao: falha ao conferir admin", err);
    return null;
  }
}

function clienteDoLojistaReal(authorization: string): any {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    readKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: authorization } } },
  );
}

async function tokenDoMercadoPagoReal(supabase: any): Promise<string | null> {
  const credenciais = await resolverCredenciaisMp(supabase);
  if (!credenciais.token) {
    console.error(
      `cobrar-pix-no-balcao: sem credencial do Mercado Pago (origem: ${credenciais.origem}, motivo: ${credenciais.motivo ?? "sem_token"})`,
    );
  }
  return credenciais.token;
}

async function lerPedido(supabase: any, id: string) {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select(COLUNAS_DO_PEDIDO)
    .eq("id", id)
    .maybeSingle();
  return { pedido: data, erro: error };
}

function ehVendaDoBalcaoComQr(pedido: any): boolean {
  return pedido?.canal === "presencial" && pedido?.payment_method === "online";
}

export async function handler(req: Request, deps: DepsDoPixDoBalcao = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }
  const acao = body.acao as Acao;
  if (acao !== "gerar" && acao !== "conferir" && acao !== "cancelar") {
    return json({ error: "Ação inválida." }, 400);
  }
  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  if (!UUID_RE.test(orderId)) return json({ error: "Venda inválida." }, 400);

  // Porta ANTES de qualquer leitura: sem ser da loja, nem a existência da
  // venda se revela.
  const authorization = req.headers.get("Authorization");
  const verificarAdmin = deps.verificarAdmin ?? verificarAdminReal;
  const adminId = await verificarAdmin(authorization);
  if (!adminId) {
    return json({ error: "Só a loja cobra venda no balcão.", terminal: true }, 401);
  }

  let supabase: any;
  if (deps.supabase) {
    supabase = deps.supabase;
  } else {
    try {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      );
    } catch (err) {
      console.error("cobrar-pix-no-balcao: falha ao criar o client", err);
      return json({ error: "Pagamento indisponível." }, 503);
    }
  }
  const agora = deps.agora ?? (() => new Date());

  const { pedido, erro } = await lerPedido(supabase, orderId);
  if (erro) {
    console.error("cobrar-pix-no-balcao: falha ao ler a venda", orderId, erro);
    return json({ error: "Não foi possível verificar a venda." }, 503);
  }
  if (!pedido || !ehVendaDoBalcaoComQr(pedido)) {
    return json({ error: "Venda não encontrada.", terminal: true }, 404);
  }

  // O estado da venda, sempre relido do banco — é o que a tela mostra.
  const responderSituacao = async (extra: Record<string, unknown> = {}) => {
    const { pedido: atual, erro: erroReleitura } = await lerPedido(supabase, orderId);
    if (erroReleitura || !atual) {
      return json({ error: "Não foi possível verificar a venda." }, 503);
    }
    return json(
      {
        situacao: situacaoDoPedido(atual, agora()),
        total: Number(atual.total),
        expiraEm: atual.expires_at,
        agoraServidor: agora().toISOString(),
        ...extra,
      },
      200,
    );
  };

  const situacao = situacaoDoPedido(pedido, agora());

  // `conferir` e `gerar` sobre venda que já saiu da espera: só o estado.
  if (situacao !== "aguardando" && acao !== "cancelar") return responderSituacao();

  const tokenDoMp = deps.tokenDoMercadoPago ?? tokenDoMercadoPagoReal;

  // Confirma pela MESMA régua da reconciliação: status aprovado + valor
  // dentro de ±R$ 0,05 do total do pedido. Devolve `true` se confirmou.
  const confirmarSeAprovado = async (orderMp: Record<string, unknown>): Promise<"confirmado" | "divergente" | "nao_pago"> => {
    const mapeado = mapearStatusOrder(
      String(orderMp.status ?? ""),
      String(orderMp.status_detail ?? ""),
    );
    if (mapeado !== "pago") return "nao_pago";
    const valorAprovado = extrairValorDaOrder(orderMp);
    const total = Number(pedido.total);
    if (
      typeof valorAprovado === "number" &&
      Number.isFinite(total) &&
      Math.abs(valorAprovado - total) > TOLERANCIA_DE_VALOR
    ) {
      console.error("cobrar-pix-no-balcao: VALOR aprovado diverge do total — não confirma", {
        orderId,
        valorAprovado,
        total,
      });
      return "divergente";
    }
    const { error: erroRpc } = await supabase.rpc("confirmar_pagamento", {
      p_order_id: orderId,
      p_payment_id: pedido.gateway_payment_id,
      p_status: "pago",
    });
    if (erroRpc) throw erroRpc;
    return "confirmado";
  };

  try {
    if (acao === "conferir") {
      if (!pedido.gateway_payment_id) return responderSituacao();
      const token = await tokenDoMp(supabase);
      if (!token) return json({ error: MENSAGEM_SEM_CREDENCIAL, terminal: true }, 503);
      const consulta = await consultarOrder({
        token,
        orderId: pedido.gateway_payment_id,
        fetchImpl: deps.fetchImpl,
      });
      if (!consulta.ok) {
        return json({ error: "Não consegui falar com o Mercado Pago agora. Tente de novo." }, 502);
      }
      const desfecho = await confirmarSeAprovado(consulta.order);
      if (desfecho === "divergente") {
        return responderSituacao({ valorDivergente: true });
      }
      return responderSituacao();
    }

    if (acao === "cancelar") {
      // Já fora da espera (pago, expirado, cancelado): nada a cancelar — a
      // tela decide pelo estado.
      if (pedido.payment_status !== "aguardando" || pedido.status !== "pending") {
        return responderSituacao();
      }
      if (pedido.gateway_payment_id) {
        const token = await tokenDoMp(supabase);
        if (!token) return json({ error: MENSAGEM_SEM_CREDENCIAL }, 503);
        const cancelamento = await cancelarOrder({
          token,
          orderId: pedido.gateway_payment_id,
          chaveIdempotencia: `cancelar:${pedido.gateway_payment_id}`,
          fetchImpl: deps.fetchImpl,
        });
        let cobrancaMorta = cancelamento.ok && orderCancelada(cancelamento.order);
        if (!cobrancaMorta) {
          // O MP não cancelou: pode ter sido PAGA um instante antes (a
          // Orders API não cancela order processada), ou já estar morta, ou
          // a rede caiu. Só a reconsulta diz qual.
          const consulta = await consultarOrder({
            token,
            orderId: pedido.gateway_payment_id,
            fetchImpl: deps.fetchImpl,
          });
          if (!consulta.ok) {
            return json(
              { error: "Não consegui cancelar o PIX no Mercado Pago agora. Tente de novo." },
              502,
            );
          }
          const desfecho = await confirmarSeAprovado(consulta.order);
          if (desfecho === "confirmado") return responderSituacao({ jaEstavaPago: true });
          if (desfecho === "divergente") return responderSituacao({ valorDivergente: true });
          const mapeado = mapearStatusOrder(
            String(consulta.order.status ?? ""),
            String(consulta.order.status_detail ?? ""),
          );
          cobrancaMorta = mapeado === "recusado" || mapeado === "expirado";
          if (!cobrancaMorta) {
            return json(
              { error: "Não consegui cancelar o PIX no Mercado Pago agora. Tente de novo." },
              502,
            );
          }
        }
      }
      // Cobrança morta no MP (ou nunca criada): cancela a venda COMO o
      // lojista — devolve o estoque e deixa no histórico quem cancelou.
      const clienteDoLojista = (deps.clienteDoLojista ?? clienteDoLojistaReal)(authorization!);
      const { error: erroCancelar } = await clienteDoLojista.rpc("update_order_status_atomic", {
        p_order_id: orderId,
        p_new_status: "cancelled",
        p_notes: "PIX do balcão cancelado pela loja",
        p_silent: true,
      });
      if (erroCancelar) {
        console.error("cobrar-pix-no-balcao: falha ao cancelar a venda", orderId, erroCancelar);
        return json({ error: "O PIX foi cancelado, mas a venda não. Tente de novo." }, 502);
      }
      return responderSituacao();
    }

    // acao === "gerar"
    const token = await tokenDoMp(supabase);
    if (!token) return json({ error: MENSAGEM_SEM_CREDENCIAL, terminal: true }, 503);

    const devolverQr = (orderMp: Record<string, unknown>) => {
      const qr = extrairQrCode(orderMp);
      return responderSituacao({
        qrCode: qr?.qrCode ?? null,
        qrCodeBase64: qr?.qrCodeBase64 ?? null,
        ticketUrl: qr?.ticketUrl ?? null,
      });
    };

    if (pedido.gateway_payment_id) {
      const consulta = await consultarOrder({
        token,
        orderId: pedido.gateway_payment_id,
        fetchImpl: deps.fetchImpl,
      });
      if (!consulta.ok) {
        return json({ error: "Não consegui buscar o PIX no Mercado Pago agora. Tente de novo." }, 502);
      }
      // Aprovado lá e ainda não aqui (webhook atrasado): confirma já.
      const desfecho = await confirmarSeAprovado(consulta.order);
      if (desfecho === "confirmado") return responderSituacao();
      if (desfecho === "divergente") return responderSituacao({ valorDivergente: true });
      return devolverQr(consulta.order);
    }

    let emailDaConta: string | null = null;
    if (pedido.user_id && !(pedido.customer_data as any)?.email) {
      try {
        const { data: conta } = await supabase.auth.admin.getUserById(String(pedido.user_id));
        emailDaConta = conta?.user?.email ?? null;
      } catch {
        emailDaConta = null;
      }
    }
    const emailSandbox = Deno.env.get("MP_SANDBOX_PAYER_EMAIL")?.trim() || undefined;
    const corpo = montarCorpoPixOrders({
      orderId,
      valor: Number(pedido.total),
      email: emailSandbox ?? emailDoPagador(pedido.customer_data, emailDaConta),
      nome: emailSandbox ? "APRO" : undefined,
      expiracao: EXPIRACAO_PIX_DO_BALCAO,
    });
    const criacao = await criarOrder({
      token,
      corpo,
      // A MESMA chave que `criar-pagamento` usa na tentativa 0 de um pedido
      // (o id): um retry — daqui ou do app do cliente — nunca cria duas
      // cobranças para a mesma venda.
      chaveIdempotencia: orderId,
      fetchImpl: deps.fetchImpl,
    });
    if (!criacao.ok) {
      if (criacao.status === 401 || criacao.status === 403) {
        console.error(`cobrar-pix-no-balcao: o MP recusou a credencial da loja (status ${criacao.status})`);
        return json({ error: MENSAGEM_SEM_CREDENCIAL, terminal: true }, 503);
      }
      return json({ error: "Não consegui gerar o PIX agora. Tente de novo." }, 502);
    }
    const idGateway = extrairQrCode(criacao.order)?.orderId;
    if (!idGateway) {
      console.error("cobrar-pix-no-balcao: order sem id utilizável");
      return json({ error: "Resposta inválida do Mercado Pago." }, 502);
    }

    const valores: Record<string, unknown> = {
      gateway_payment_id: idGateway,
      metodo_online: "pix",
      updated_at: agora().toISOString(),
    };
    const realinhada = expiracaoRealinhavel(
      extrairDataExpiracaoOrder(criacao.order),
      agora(),
      EXPIRACAO_PIX_DO_BALCAO,
    );
    if (realinhada) valores.expires_at = realinhada.toISOString();

    const { data: gravado, error: erroGravar } = await supabase
      .from("marketplace_orders")
      .update(valores)
      .eq("id", orderId)
      .eq("payment_status", "aguardando")
      .eq("status", "pending")
      .is("gateway_payment_id", null)
      .select("id")
      .maybeSingle();

    if (erroGravar || !gravado) {
      // Corrida: outra chamada gravou primeiro (a MESMA order, pela chave
      // igual) ou a venda saiu da espera (cancelada/expirada) no meio.
      const { pedido: atual } = await lerPedido(supabase, orderId);
      if (atual?.gateway_payment_id === idGateway) return devolverQr(criacao.order);
      // A venda morreu com a cobrança recém-criada viva: cancela lá (nada foi
      // pago ainda — acabou de nascer) para o QR não ficar pagável.
      const cancelamento = await cancelarOrder({
        token,
        orderId: idGateway,
        chaveIdempotencia: `cancelar:${idGateway}`,
        fetchImpl: deps.fetchImpl,
      });
      if (!cancelamento.ok || !orderCancelada(cancelamento.order)) {
        console.error("cobrar-pix-no-balcao: cobrança criada numa venda que saiu da espera e o MP não cancelou", {
          orderId,
          idGateway,
        });
      }
      return responderSituacao();
    }

    return devolverQr(criacao.order);
  } catch (err) {
    console.error("cobrar-pix-no-balcao: erro inesperado", orderId, err);
    return json({ error: "Não foi possível falar com o pagamento agora. Tente de novo." }, 500);
  }
}

const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");
if (!emTeste) serve((req: Request) => handler(req));
