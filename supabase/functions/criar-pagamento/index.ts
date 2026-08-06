// @ts-nocheck
/**
 * criar-pagamento — cria a cobrança no Mercado Pago para um pedido já criado
 * (CHECKOUT-010 #109, CHECKOUT-050 #111).
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *
 * Ela roda com `verify_jwt` PADRÃO (true), então o Supabase já recusa quem não
 * manda um JWT válido do projeto. Atenção: a chave anon É um JWT válido — o
 * checkout de convidado passa por aqui, e é assim que tem que ser. Ou seja,
 * `verify_jwt` filtra tráfego de fora do projeto, e NÃO identifica o cliente.
 *
 * Quem identifica são as três checagens abaixo, nesta ordem:
 *
 * 1. `pareceUuid` — corta varredura antes de tocar o banco.
 * 2. `donoConfere` — pedido com `user_id` só é cobrado pelo próprio dono, lido
 *    do JWT. Pedido de convidado (`user_id` NULL) não tem dono a conferir.
 * 3. `podeCobrar` — decide CRIAR (pedido 'aguardando', no prazo, sem cobrança
 *    anterior), RECONSULTAR (mesmo estado, mas já tem `gateway_payment_id` —
 *    devolve a MESMA cobrança em vez de criar outra, porque o QR do PIX só
 *    existe na resposta da criação e o navegador mobile some com a aba
 *    enquanto o cliente paga) ou RECUSAR (não está 'aguardando', sem prazo,
 *    ou prazo vencido — checado ANTES da checagem de cobrança existente, de
 *    propósito: pedido expirado com cobrança recusa, não reconsulta).
 *
 * O QUE ELA NÃO FAZ
 *
 * Não confirma pagamento. Nunca. Quem escreve 'pago' é o webhook (Fase 3), e é
 * por isso que esta função grava só `gateway_payment_id` e devolve o que o
 * Brick precisa desenhar.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  consultarPagamento,
  criarPagamento,
  formatarExpiracao,
  montarCorpoCartao,
  montarCorpoPix,
} from "../_shared/mercadopago.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function pareceUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function descricaoDoPedido(orderId: string): string {
  // Mesmo formato que o painel usa para falar de pedido com o lojista.
  return `Pedido ${orderId.slice(0, 8)}`;
}

export function donoConfere(
  pedido: { user_id: string | null },
  sub: string | null,
): boolean {
  if (pedido.user_id === null) return true;
  return pedido.user_id === sub;
}

/**
 * Decide o que FAZER com o pedido, não só se pode ou não. Rodada 2
 * (CHECKOUT-050): o QR do PIX só existe na resposta da criação, e o
 * navegador mobile descarta a aba enquanto o cliente paga pelo app do banco.
 * Recusar todo pedido que já tem `gateway_payment_id` (como a rodada 1
 * fazia) matava um pedido que ainda dava para pagar assim que a tela
 * remontasse — com 63 dos 64 pedidos da loja em PIX, esse é o caminho
 * principal, não a exceção.
 *
 * A ORDEM IMPORTA: prazo vencido é checado ANTES de `gateway_payment_id`, de
 * propósito — um pedido expirado com cobrança tem que RECUSAR, nunca
 * reconsultar uma cobrança de um pedido que a expiração já matou.
 */
export function podeCobrar(
  pedido: {
    payment_status: string | null;
    expires_at: string | null;
    gateway_payment_id: string | null;
  },
  agora: Date,
): { acao: "criar" } | { acao: "reconsultar" } | { acao: "recusar"; motivo: string } {
  if (pedido.payment_status !== "aguardando") {
    return { acao: "recusar", motivo: "Este pedido não está aguardando pagamento." };
  }
  if (pedido.expires_at === null) {
    return { acao: "recusar", motivo: "Este pedido não tem prazo de pagamento." };
  }
  if (new Date(pedido.expires_at) <= agora) {
    return { acao: "recusar", motivo: "O prazo para pagar este pedido acabou." };
  }
  if (pedido.gateway_payment_id !== null) {
    return { acao: "reconsultar" };
  }
  return { acao: "criar" };
}

export function subDoToken(authorization: string | null): string | null {
  // Lê o `sub` sem validar assinatura DE PROPÓSITO: o gateway do Supabase já
  // validou (verify_jwt = true). Aqui só se extrai a identidade. Com a chave
  // anon não há `sub`, e o resultado é null — que é o caso do convidado.
  try {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
    // JWT usa base64URL (RFC 4648 §5), não base64 puro: `-` no lugar de `+` e
    // `_` no lugar de `/`. `atob` só entende o alfabeto puro e estoura
    // DOMException nos dois — achado da revisão: nome brasileiro acentuado
    // empurra bytes >= 0x80 para esses índices em ~0,18% dos payloads do
    // GoTrue. Sem normalizar, cliente LOGADO cai no catch, vira `sub: null`,
    // e leva 404 "Pedido não encontrado." no próprio pedido.
    const base64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * `deps` é a mesma costura que a Task 1 já provou com `fetchImpl` em
 * `criarPagamento`: sem ela, o handler só é alcançável fazendo requisição HTTP
 * de verdade contra Postgres e Mercado Pago reais, e a fiação onde a
 * autorização e o dinheiro de fato acontecem (não só os decisores puros)
 * fica sem teste algum. Em produção o `serve()` lá embaixo chama
 * `handler(req)` com um único argumento — de propósito, e não
 * `serve(handler)` direto: o `serve` do std passa um segundo argumento
 * (`ConnInfo`, com `localAddr`/`remoteAddr`) que NÃO é `deps`, e cairia no
 * parâmetro por acidente. Com um único argumento, `deps` sempre usa o
 * default `{}` em produção: client real a partir do ambiente.
 */
async function handler(
  req: Request,
  deps: { supabase?: ReturnType<typeof createClient>; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (corpo: unknown, status: number) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  if (!pareceUuid(body.orderId)) return json({ error: "Pedido inválido." }, 400);
  if (body.metodo !== "pix" && body.metodo !== "cartao") {
    return json({ error: "Meio de pagamento inválido." }, 400);
  }

  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    console.error("criar-pagamento: MP_ACCESS_TOKEN ausente no ambiente");
    return json({ error: "Pagamento indisponível." }, 503);
  }

  const supabase =
    deps.supabase ??
    createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

  const { data: pedido, error } = await supabase
    .from("marketplace_orders")
    .select("id, user_id, total, payment_status, expires_at, gateway_payment_id, customer_data")
    .eq("id", body.orderId)
    .maybeSingle();

  // Mensagem igual para "não existe" e "não é seu": responder diferente
  // transformaria esta função em oráculo de quais ids existem.
  if (error || !pedido) return json({ error: "Pedido não encontrado." }, 404);

  const sub = subDoToken(req.headers.get("Authorization"));
  if (!donoConfere(pedido, sub)) return json({ error: "Pedido não encontrado." }, 404);

  const decisao = podeCobrar(pedido, new Date());
  if (decisao.acao === "recusar") return json({ error: decisao.motivo }, 409);

  if (decisao.acao === "reconsultar") {
    // O QR só existe na resposta da CRIAÇÃO. Aqui é onde a tela recupera o
    // MESMO QR sem criar uma segunda cobrança — nenhum UPDATE, porque nada
    // mudou no pedido, só a consulta.
    const r = await consultarPagamento({
      token: mpToken,
      paymentId: String(pedido.gateway_payment_id),
      fetchImpl: deps.fetchImpl,
    });
    if (!r.ok) return json({ error: r.erro }, 502);
    return json(
      {
        paymentId: r.id,
        // Cru, não traduzido — igual ao ramo de criação. Se a cobrança
        // existente é de cartão recusado, o cliente vê 'rejected' e a
        // Task 5 decide o que mostrar. Reagir a isso (nova tentativa com
        // idempotência versionada) é trabalho da Fase 3, de propósito não
        // implementado aqui.
        status: r.status,
        // O prazo sai da LINHA DO BANCO, igual ao ramo de criação.
        expiraEm: pedido.expires_at,
        qrCode: r.qrCode,
        qrCodeBase64: r.qrCodeBase64,
        ticketUrl: r.ticketUrl,
      },
      200,
    );
  }

  // decisao.acao === "criar" a partir daqui.
  const email =
    (body.email as string) ??
    (pedido.customer_data as Record<string, unknown>)?.email ??
    "sem-email@ikcous.com.br";

  const corpo =
    body.metodo === "pix"
      ? montarCorpoPix({
          orderId: pedido.id,
          valor: Number(pedido.total),
          descricao: descricaoDoPedido(pedido.id),
          email: String(email),
          expiraEm: formatarExpiracao(pedido.expires_at),
        })
      : montarCorpoCartao({
          orderId: pedido.id,
          valor: Number(pedido.total),
          descricao: descricaoDoPedido(pedido.id),
          email: String(email),
          token: String(body.token),
          parcelas: Number(body.parcelas ?? 1),
          metodo: String(body.paymentMethodId),
          emissor: body.issuerId ? String(body.issuerId) : undefined,
          documento: body.documento as { type: string; number: string } | undefined,
        });

  const r = await criarPagamento({
    token: mpToken,
    corpo,
    // O id do pedido como chave: um retry do front sobre o MESMO pedido não
    // cria uma segunda cobrança no MP.
    chaveIdempotencia: String(pedido.id),
    fetchImpl: deps.fetchImpl,
  });

  if (!r.ok) return json({ error: r.erro }, 502);

  // Grava a cobrança. O WHERE repete a condição de podeCobrar porque entre a
  // leitura e agora o pg_cron pode ter expirado o pedido: se expirou, o
  // update não acha linha e a cobrança fica órfã no MP — que é o caso que a
  // reconciliação da Fase 3 resolve. Sobrescrever seria pior.
  const { data: gravado, error: erroUpdate } = await supabase
    .from("marketplace_orders")
    .update({ gateway_payment_id: r.id, updated_at: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("payment_status", "aguardando")
    .is("gateway_payment_id", null)
    .select("id")
    .maybeSingle();

  if (erroUpdate || !gravado) {
    console.error("criar-pagamento: cobrança criada mas não gravada", r.id, erroUpdate);
    // A mensagem de prazo só é verdade na corrida com o pg_cron. Duas abas
    // (ou duplo submit) na MESMA janela também caem aqui: as duas leituras
    // veem gateway_payment_id null, as duas chamam o MP com a mesma chave de
    // idempotência, a primeira grava — e a segunda não pode dizer "acabou o
    // prazo" com o prazo intacto. Reler o estado real distingue os dois.
    const { data: atual } = await supabase
      .from("marketplace_orders")
      .select("payment_status, gateway_payment_id")
      .eq("id", pedido.id)
      .maybeSingle();

    if (atual?.payment_status === "expirado") {
      return json({ error: "O prazo para pagar este pedido acabou." }, 409);
    }
    if (atual?.gateway_payment_id !== null && atual?.gateway_payment_id !== undefined) {
      return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
    }
    // Estado que a releitura não explicou (ex.: ela também falhou) — sem
    // inventar causa.
    return json({ error: "Não foi possível confirmar a cobrança." }, 409);
  }

  return json(
    {
      paymentId: r.id,
      status: r.status,
      // O prazo sai da LINHA DO BANCO, não de um cálculo no navegador: é o
      // mesmo instante que o pg_cron vai usar para cancelar.
      expiraEm: pedido.expires_at,
      qrCode: r.qrCode,
      qrCodeBase64: r.qrCodeBase64,
      ticketUrl: r.ticketUrl,
    },
    200,
  );
}

// O guard do runner de teste é COPIADO da notify-new-order (`:138-143`), e tem
// que ser esse mesmo: sem ele, `npm run test:edge` importa este módulo e sobe
// um servidor HTTP no meio da suíte. Não invente variável de ambiente — o
// repositório decide isso por `Deno.mainModule`.
const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

// (req) => handler(req), não serve(handler) direto: ver o comentário em
// :124-135 sobre o segundo argumento (ConnInfo) que o serve() passaria.
if (!emTeste) serve((req) => handler(req));

export { handler };
