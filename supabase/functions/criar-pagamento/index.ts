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
 * por isso que esta função grava só `gateway_payment_id` (e, desde a Fase
 * 3.5, `metodo_online`/`parcelas`) e devolve o que a tela precisa desenhar.
 * Nem o cartão aprovado na hora muda isso: a resposta diz "pago" para a tela
 * seguir, e quem grava é o webhook/reconciliação (`confirmar_pagamento`).
 *
 * CARTÃO (Fase 3.5, 26/09/2026 — spec `2026-09-26-cartao-online-design.md`)
 *
 * Crédito e débito pela MESMA Orders API do PIX (`montarCorpoCartaoOrders`):
 * o Card Payment Brick tokeniza no navegador e só o token passa por aqui.
 * Três regras novas, todas nesta função:
 *
 * 1. A loja liga cada forma (`config_pagamento_cartao`) — desligada, ausente
 *    ou ilegível, o cartão não é cobrado (409 recuperável: o cliente escolhe
 *    PIX).
 * 2. Recusa de cartão NÃO mata o pedido: `liberar_cobranca_do_pedido` solta a
 *    vaga (ou só conta a tentativa, quando a recusa veio na hora) e a
 *    resposta é 200 `recusado` com o motivo — o cliente tenta outro cartão ou
 *    PIX dentro da mesma reserva de 30 min.
 * 3. A chave de idempotência passa a ser POR TENTATIVA
 *    (`chaveDeIdempotencia`): reusar a do pedido depois de uma recusa faria o
 *    MP devolver a cobrança morta em vez de criar a nova.
 *
 * Com a vaga ocupada (`gateway_payment_id` gravado), o que decide é a
 * cobrança que está lá — ver o bloco "reconsultar" do handler: paga devolve
 * 'pago'; cartão morto é liberado; PIX aberto é CANCELADO no MP antes de
 * virar cartão; cartão em análise nunca ganha uma segunda cobrança.
 *
 * MIGRAÇÃO PARA A ORDERS API (CHECKOUT-070, Tarefa 2 de 4) — NÃO VAI SOZINHA
 *
 * `POST /v1/payments` com `payment_method_id: "pix"` passou a devolver 500 no
 * Mercado Pago; o caminho que continua funcionando é `POST /v1/orders`. Esta
 * function já fala com a Orders API (montarCorpoPixOrders/criarOrder/
 * extrairQrCode/consultarOrder), e `gateway_payment_id` agora guarda o id da
 * ORDER (prefixo ORD), não o de um pagamento (prefixo PAY).
 *
 * `webhook-mercadopago/index.ts` e `reconciliar-pagamentos/index.ts` AINDA
 * NÃO foram migradas (Tarefas 3 e 4). Hoje o webhook descarta com 200 OK
 * qualquer notificação cujo `type` não seja "payment" — e a Orders API notifica
 * com `type: "order"`. Sem as Tarefas 3 e 4, uma order paga não confirma
 * (200 OK engana o MP, que não reenvia), o pg_cron expira o pedido em 30 min
 * e devolve o estoque, e a reconciliação busca por `GET /v1/payments/{id}`
 * com um id de order (404, pula) — dinheiro que entra e nenhum registro
 * sobra. As três tarefas vão no MESMO PR, de propósito: esta function não
 * pode ir a produção sem as outras duas.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buscarOrdersDoPedido,
  cancelarOrder,
  chaveDoCartaoDaTentativa,
  consultarOrder,
  consultarPagamento,
  criarOrder,
  deviceIdValido,
  erro400EhDeDadoDoCartao,
  extrairDataExpiracaoOrder,
  extrairDesafio3ds,
  extrairQrCode,
  idEhClassico,
  idempotencyKeyJaUsado,
  limiteInferiorDoSentinela,
  mapearStatus,
  mapearStatusOrder,
  metodoDeCartaoValido,
  minutosDaExpiracaoPix,
  montarCorpoCartaoOrders,
  montarCorpoPixOrders,
  montarSentinela,
  MOTIVO_RECUSA_DADOS_DO_CARTAO,
  motivoDaRecusa,
  motivoDaRecusaDoErro,
  normalizarDocumento,
  orderCancelada,
  orderEhDeCartao,
  parcelasDaOrder,
  parcelasValidas,
  resolverSentinela,
  sentinelaDaChave,
  tipoDeCartaoValido,
  tipoDoPagamentoDaOrder,
  tokenDeCartaoValido,
  vagaEmVerificacao,
} from "../_shared/mercadopago.ts";
import { lerDadosDoComprador } from "../_shared/dados-antifraude.ts";
import { lerNomeNaFatura } from "../_shared/nome-na-fatura.ts";
import { criarOrderDeCartao } from "../_shared/order-cartao-repeticao.ts";
// PEDIDO-07 (INFRA-260, #126): mesma migração que webhook-mercadopago,
// reconciliar-pagamentos, notify-new-order e send-push já fizeram — lê a
// chave NOVA (SUPABASE_SECRET_KEYS) e cai para a LEGADA
// (SUPABASE_SERVICE_ROLE_KEY) enquanto as duas coexistirem. Sem isto, no dia
// em que a legada for desligada, esta function (a do checkout) para junto.
//
// `carregarChavesVapid`/`enviarParaInscritos`/`resumir` (Achado A1 (3),
// revisão de risco 26/09/2026): a MESMA peça que `webhook-mercadopago` já usa
// para avisar o admin de 'pago'/'pago_apos_expirar' — ver
// `alertarAdminCartaoOrfaoReal`, mais abaixo, para o motivo de não importar o
// orquestrador de lá em vez de montar de novo aqui.
import {
  carregarChavesVapid,
  comTempoLimite,
  dispararSemEsperarCliente,
  enviarParaInscritos,
  readKey,
  resumir,
} from "../_shared/webpush.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
// Tarefa mp-2 (15/09/2026): a chave do Mercado Pago pode ser a do LOJISTA
// (cofre em app_settings) ou a da plataforma (env) — quem decide, e quem
// fecha a porta quando não dá para decidir com segurança, é este módulo.
import { type CredenciaisMp, resolverCredenciaisMp } from "../_shared/credenciais-mp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Margem de latência de rede entre esta function e o MP, somada ao prazo
 * pedido ao MP (`expiracaoPix`) para formar o teto da janela sã de
 * `expiracaoRealinhavel`. Módulo, não local à função — o log de recusa
 * (mais abaixo, no handler) usa o MESMO valor para interpolar o teto na
 * mensagem, em vez de reintroduzir a duplicação que o Achado 1 (comentário
 * grande de `expiracaoRealinhavel`) já fechou. */
const MARGEM_LATENCIA_MINUTOS_PIX = 5;

/**
 * Teto (minutos) da extensão de `expires_at` quando o cartão que ACABOU de
 * ser criado volta com um desafio 3-D Secure pendente (Achado A2, revisão
 * de risco 26/09/2026). O desafio vive por volta de 40 min no banco emissor
 * (fonte: doc de 3DS da Orders API, citada em
 * `docs/superpowers/specs/2026-09-26-cartao-online-design.md`) contra uma
 * reserva de estoque de só 30 min
 * (`20260807000000_reserva_com_expiracao.sql`, pg_cron a cada 5 min) — sem
 * estender, a reserva podia morrer ANTES de o banco emissor sequer terminar
 * de perguntar ao cliente, e um cartão aprovado no desafio cairia no MESMO
 * cenário que a Política P1 existe para honrar (Achado A1 (2)), só que por
 * um caminho evitável: a corrida contra o pg_cron começaria ANTES da
 * resposta do banco, não durante ela.
 *
 * 40 min, não um valor maior "para garantir": é o teto MEDIDO do próprio
 * mecanismo que isto protege (o tempo que o BANCO promete levar) — dar mais
 * do que isso prenderia estoque por um tempo que nada aqui precisa.
 */
export const MINUTOS_DESAFIO_3DS = 40;

/**
 * Decide o NOVO `expires_at` quando a order de cartão volta com desafio 3DS
 * pendente — irmã mais simples de `expiracaoRealinhavel` (acima): aquela
 * VALIDA um valor de TERCEIRO (o `date_of_expiration` que o MP devolve para
 * o PIX); esta CALCULA (a Orders API não devolve um vencimento do desafio),
 * porque não há valor de terceiro para validar.
 *
 * Só ESTENDE, nunca encolhe: se o `expires_at` atual do pedido já vai além
 * do teto de `MINUTOS_DESAFIO_3DS` a partir de agora, devolve `null` — quem
 * chama mantém o valor de hoje.
 *
 * Achado R4 (2ª revisão de risco, 26/09/2026): o comentário acima ("roda UMA
 * VEZ só... o teto não compõe a cada nova chamada") só era verdade enquanto
 * se olhava UMA tentativa. Um cartão recusado/abandonado no desafio libera a
 * vaga (ver o ramo (f) da reconsulta, acima) e o cliente pode tentar de novo
 * com outro cartão — cada tentativa nova que também volta com desafio 3DS
 * chama esta função de novo, e cada chamada somava `MINUTOS_DESAFIO_3DS` a
 * partir de "agora": um cliente insistindo (ou um script automatizando
 * tentativas) empurrava `expires_at` para sempre mais longe, prendendo
 * estoque por um tempo sem teto real. `pedidoCriadoEm` fecha isso: a
 * extensão nunca passa de `MINUTOS_DESAFIO_3DS` minutos depois da CRIAÇÃO do
 * PEDIDO (não da tentativa) — o mesmo orçamento de "o banco emissor promete
 * responder em ~40 min", só que contado uma única vez, na origem, e não
 * reiniciado a cada retry. `null`/inválido (defensivo — não deveria
 * acontecer, `created_at` é `NOT NULL` na tabela) cai para o comportamento de
 * antes, sem teto absoluto.
 */
export function expiracaoParaDesafio3ds(
  expiresAtAtual: string | null,
  agora: Date,
  pedidoCriadoEm?: string | null,
): Date | null {
  const porAgora = new Date(agora.getTime() + MINUTOS_DESAFIO_3DS * 60_000);
  const criadoEm = pedidoCriadoEm ? new Date(pedidoCriadoEm) : null;
  const tetoAbsoluto =
    criadoEm && !Number.isNaN(criadoEm.getTime())
      ? new Date(criadoEm.getTime() + MINUTOS_DESAFIO_3DS * 60_000)
      : null;
  const novo = tetoAbsoluto && tetoAbsoluto.getTime() < porAgora.getTime() ? tetoAbsoluto : porAgora;
  if (!expiresAtAtual) return novo;
  const atual = new Date(expiresAtAtual);
  if (Number.isNaN(atual.getTime())) return novo;
  return novo.getTime() > atual.getTime() ? novo : null;
}

/** Frase pública do 401/403 do Mercado Pago: diz o que o cliente pode fazer,
 * sem conta, token nem o corpo cru do gateway. Exportada para o teste. */
export const MENSAGEM_CREDENCIAL_RECUSADA =
  "O pagamento pelo app está indisponível nesta loja agora. Fale com a loja para concluir o pedido.";

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
    // Achado B (revisão de risco da migration 80, 26/09/2026 — prova X):
    // opcional só para não quebrar chamadores/dublês antigos que ainda não
    // leem esta coluna — `undefined` NUNCA bate `=== "cancelled"`, então o
    // comportamento sem ela é EXATAMENTE o de antes (nunca um palpite).
    status?: string | null;
  },
  agora: Date,
): { acao: "criar" } | { acao: "reconsultar" } | { acao: "recusar"; motivo: string } {
  if (pedido.payment_status !== "aguardando") {
    return { acao: "recusar", motivo: "Este pedido não está aguardando pagamento." };
  }
  // Achado B (revisão de risco da migration 80, 26/09/2026 — prova X): o
  // cancelamento do PRÓPRIO cliente (`update_order_status_atomic`) grava
  // `status = 'cancelled'` sem tocar `payment_status` (fica 'aguardando') —
  // o cheque acima não pega essa corrida. Terminal, mesma categoria de
  // "não está aguardando pagamento": um pedido cancelado nunca volta a ser
  // cobrável, então não há retry que resolva.
  if (pedido.status === "cancelled") {
    return { acao: "recusar", motivo: "Este pedido foi cancelado." };
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

/**
 * Decide se `date_of_expiration` (Orders API, ver `extrairDataExpiracaoOrder`
 * em `_shared/mercadopago.ts`) pode REALINHAR `expires_at` do pedido —
 * decisão do dono (14/08/2026): a reserva de estoque nasce com
 * `expires_at = criação do PEDIDO + 30 min`, mas o QR do PIX vale 30 min a
 * partir da criação da COBRANÇA, que acontece depois. Se o cliente demora
 * escolhendo, o QR fica pagável bem depois de o pg_cron já ter devolvido o
 * estoque — o cliente paga um produto que já pode ter sido vendido para
 * outra pessoa. Realinhar os dois prazos para o mesmo instante fecha essa
 * janela; o custo aceito é estoque preso por mais tempo em carrinho parado.
 *
 * TETO DE SEGURANÇA: `date_of_expiration` vem de TERCEIRO (o MP), e a doc
 * oficial diz que o default é 24 HORAS quando `expiration_time` é omitido —
 * gravar um valor assim em `expires_at` prenderia estoque por um dia inteiro
 * por um bug de configuração alheio. Só aceita o valor dentro de uma janela
 * sã em relação ao instante da REQUISIÇÃO (`agora`, injetado — mesmo padrão
 * de `podeCobrar` acima, para o teste não depender do relógio real):
 * estritamente no FUTURO, e não além do prazo REALMENTE PEDIDO ao MP
 * (`expiracaoPix`, ex.: "PT30M" — o MESMO valor que o chamador manda para
 * `montarCorpoPixOrders`) + 5 min de margem para a latência de rede entre
 * esta function e o MP. Fora disso — ausente, não-parseável, no passado, ou
 * longe demais — devolve `null`: quem chama mantém o `expires_at` de hoje e
 * registra por log, nunca lança.
 *
 * `expiracaoPix` é PARÂMETRO, não um `30` embutido aqui, de propósito
 * (Achado 1 da revisão do realinhamento, 14/08/2026): antes disso o "30
 * minutos" morava em dois lugares que não se falavam — a literal mandada ao
 * MP (`criar-pagamento/index.ts`, hoje "PT30M") e esta janela sã, hardcoded.
 * Mudar só a literal deixaria a janela presa no valor antigo, e o
 * realinhamento passaria a recusar TODO PIX em silêncio — o mesmo bug que
 * esta função existe para fechar, reintroduzido sem alarme. Com o parâmetro,
 * o CHAMADOR usa a MESMA variável nos dois lugares (ver o comentário grande
 * onde o corpo do PIX é montado, mais abaixo), e a janela acompanha qualquer
 * mudança de prazo automaticamente. `minutosDaExpiracaoPix`
 * (`_shared/mercadopago.ts`) é o MESMO parser que valida o valor antes de
 * mandá-lo ao MP — fonte única, não uma segunda regex divergente aqui.
 */
export function expiracaoRealinhavel(
  dataExpiracaoBruta: string | null,
  agora: Date,
  expiracaoPix: string,
): Date | null {
  if (!dataExpiracaoBruta) return null;

  const data = new Date(dataExpiracaoBruta);
  if (Number.isNaN(data.getTime())) return null;

  const minutosPix = minutosDaExpiracaoPix(expiracaoPix);
  // Defensivo: por aqui `expiracaoPix` já passou por montarCorpoPixOrders,
  // que teria lançado ANTES se a sintaxe fosse inválida — mas `null` aqui
  // também recusa, nunca uma janela adivinhada.
  if (minutosPix === null) return null;

  const minimo = agora.getTime();
  const maximo = agora.getTime() + (minutosPix + MARGEM_LATENCIA_MINUTOS_PIX) * 60_000;
  if (data.getTime() <= minimo || data.getTime() > maximo) return null;

  return data;
}

function payloadDoToken(authorization: string | null): any | null {
  // Lê o payload sem validar assinatura DE PROPÓSITO: o gateway do Supabase
  // já validou (verify_jwt = true). Aqui só se extrai identidade.
  try {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
    // JWT usa base64URL (RFC 4648 §5), não base64 puro: `-` no lugar de `+` e
    // `_` no lugar de `/`. `atob` só entende o alfabeto puro e estoura
    // DOMException nos dois — achado da revisão: nome brasileiro acentuado
    // empurra bytes >= 0x80 para esses índices em ~0,18% dos payloads do
    // GoTrue. Sem normalizar, cliente LOGADO cai no catch, vira `sub: null`,
    // e leva 404 "Pedido não encontrado." no próprio pedido.
    const base64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

export function subDoToken(authorization: string | null): string | null {
  // Com a chave anon não há `sub`, e o resultado é null — o caso do
  // convidado.
  const payload = payloadDoToken(authorization);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

/**
 * LAUDO 31/08 (menor E5): o e-mail do PAGADOR. A corrente de cima
 * (`body.email` → `customer_data.email`) terminava no fallback
 * `sem-email@ikcous.com.br` — que ia ao Mercado Pago como identidade de
 * quem paga. Para cliente LOGADO existe um e-mail melhor, dentro do próprio
 * token de sessão (claim `email` do GoTrue — a assinatura já foi validada
 * pelo gateway). O fallback continua para a ponta que sobra (sessão sem
 * claim de e-mail), mas deixou de ser o caminho normal.
 */
export function emailDoToken(authorization: string | null): string | null {
  const payload = payloadDoToken(authorization);
  // Ressalva 1 da revisão do PR #371: `includes("@")` deixava passar lixo
  // tipo "a@" — e um e-mail esquisito vira 400 do MP onde antes ia o
  // fallback. Formato mínimo com ponto no domínio.
  const email = payload?.email;
  return emailValido(email) ? email : null;
}

/** Formato mínimo de e-mail (com ponto no domínio) — a MESMA regra que
 * `emailDoToken` já usava, agora também para o e-mail do corpo do cartão. */
function emailValido(email: unknown): email is string {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

/** As colunas do pedido que esta função lê — UMA lista para a leitura
 * inicial e para a releitura depois de liberar a vaga (Fase 3.5): duas
 * listas divergiriam, e a releitura decidiria com um pedido pela metade.
 * `created_at` (Achado R4, 2ª revisão de risco, 26/09/2026): o teto absoluto
 * de `expiracaoParaDesafio3ds`, abaixo, precisa da CRIAÇÃO do pedido — nunca
 * do instante da tentativa atual; é também o `desde` que `resolverVagaEm
 * Verificacao`, abaixo, manda para `buscarOrdersDoPedido` (Ponto 1, 4ª
 * revisão de risco, 26/09/2026) — mesma coluna, dois usos. `updated_at`
 * (achado B1, 5ª revisão de risco, 26/09/2026): `limiteInferiorDaTentativa`,
 * abaixo, precisa do último instante conhecido em que a vaga esteve livre —
 * a MESMA coluna que `liberar_cobranca_do_pedido` grava com `now()` toda vez
 * que solta a vaga (20261176000000_o_cartao_online_nasce.sql:183/196).
 * `metodo_online` (achado da 7ª revisão de risco, 26/09/2026): a reconsulta
 * da vaga (ramo comum a PIX e cartão) precisa saber SE a cobrança que já
 * está gravada é de cartão antes de decidir se `cartaoEmAnalise` entra na
 * resposta de uma falha — ver o comentário grande no `!r.ok` de
 * `consultarOrder`, mais abaixo. `status` (achado B da revisão de risco da
 * migration 80, 26/09/2026 — prova X): o CANCELAMENTO do próprio cliente
 * (`update_order_status_atomic`) grava `status = 'cancelled'` SEM mexer em
 * `payment_status` (fica 'aguardando') — `podeCobrar`, abaixo, só olhava
 * `payment_status`/`expires_at`/`gateway_payment_id`, e um pedido cancelado
 * com PIX aberto continuava "cobrável": a troca para cartão cancelava o PIX
 * e criava a cobrança nova numa reserva que o estoque já esqueceu. */
/**
 * Frente 7 (29/09/2026) — recuperação da order PIX num 409 de idempotência.
 *
 * O 409 `idempotency_key_already_used` no PIX significa: a PRIMEIRA chamada
 * com esta chave CHEGOU ao MP e criou a order (a resposta é que se perdeu, ou
 * o retry veio com corpo divergente — cliente editou o documento entre
 * tentativas); a order PIX está VIVA (action_required, PT30M) e o MP não vai
 * devolvê-la enquanto o corpo divergir. Antes deste helper o ramo PIX não
 * tratava o 409: 502 genérico em loop até `expires_at`, cliente sem QR e uma
 * cobrança viva órfã (o cartão já tratava o 409 pela sentinela, outro
 * mecanismo — lá a order é ambígua por natureza; aqui ela é um PIX esperando
 * pagamento).
 *
 * A saída certa NÃO é liberar a tentativa (`liberar_cobranca` avançaria a
 * chave e a próxima chamada criaria uma SEGUNDA order viva — duas cobranças
 * para um pedido é exatamente o que a vaga existe para impedir): é
 * RECUPERAR a order que o MP já tem, pela busca por `external_reference`
 * (funcional desde o fix do campo `data` da resposta, frente 2), e devolvê-la
 * como se fosse a resposta da criação — o MESMO QR, a vaga gravada com o id
 * dela, UMA order viva no total. Sem order PIX viva na busca: falha honesta
 * (502 de sempre) — nada inventado, nada liberado; um retry com o corpo
 * ORIGINAL da 1ª chamada ainda acha o replay em cache do MP pela mesma chave.
 */
async function recuperarOrderPixDoIdempotencia(args: {
  token: string;
  pedidoId: string;
  desde: string;
  fetchImpl?: typeof fetch;
}): Promise<
  { ok: true; order: Record<string, unknown> } | { ok: false; erro: string; status: number }
> {
  const busca = await buscarOrdersDoPedido({
    token: args.token,
    pedidoId: args.pedidoId,
    desde: args.desde,
    fetchImpl: args.fetchImpl,
  });
  if (!busca.ok) {
    return { ok: false, erro: "Não foi possível gerar a cobrança.", status: 0 };
  }
  const viva = busca.orders.find((order) => {
    if (String((order as Record<string, unknown>).status ?? "") !== "action_required") {
      return false;
    }
    const transacoes = (order as { transactions?: unknown }).transactions;
    const pagamentos = Array.isArray((transacoes as { payments?: unknown })?.payments)
      ? ((transacoes as { payments: unknown[] }).payments)
      : [];
    const tipo = String(
      (pagamentos[0] as { payment_method?: { type?: unknown } } | undefined)
        ?.payment_method?.type ?? "",
    );
    return tipo === "bank_transfer";
  });
  if (!viva) {
    return { ok: false, erro: "Não foi possível gerar a cobrança.", status: 0 };
  }
  // Garantia de QR (achado MÉDIO da revisão de 29/09): o nível de detalhe da
  // BUSCA é UNVERIFIED (`_shared/mercadopago.ts` marca que ela pode não
  // devolver o mesmo corpo do GET por id) — a order pode vir com o
  // payment_method incompleto, sem o qr_code. Devolver 200 SEM QR prende o
  // cliente com nada a pagar (a única guarda do fluxo é o orderId). Se a
  // order recuperada não trouxer QR legível, reconsulta POR ID
  // (`consultarOrder` — GET que devolve o corpo completo, medido 14/08/2026)
  // e usa ESSA; se nem a reconsulta trouxer QR, não recupera: 502 honesto.
  const comQr = (o: Record<string, unknown>) =>
    typeof extrairQrCode(o)?.qrCode === "string" ? o : null;
  let order = comQr(viva);
  if (!order) {
    const consulta = await consultarOrder({
      token: args.token,
      orderId: String((viva as Record<string, unknown>).id ?? ""),
      fetchImpl: args.fetchImpl,
    });
    if (consulta.ok) {
      order = comQr(consulta.order);
    }
  }
  if (!order) {
    return { ok: false, erro: "Não foi possível gerar a cobrança.", status: 0 };
  }
  console.log(
    "criar-pagamento: 409 de idempotência no PIX — order anterior recuperada pela busca e devolvida com o mesmo QR",
    { pedidoId: args.pedidoId, orderId: String((order as Record<string, unknown>).id ?? "") },
  );
  return { ok: true, order };
}

const COLUNAS_DO_PEDIDO =
  "id, user_id, total, payment_status, expires_at, gateway_payment_id, customer_data, customer_name, tentativas_de_pagamento, created_at, updated_at, metodo_online, status, payment_method";

/**
 * O LIMITE INFERIOR (epoch ms) que vai gravado no sentinela — achado B1, 5ª
 * revisão de risco, 26/09/2026. Uma order de CARTÃO desta tentativa só pode
 * ter sido criada DEPOIS do último instante em que a vaga esteve livre: para
 * a tentativa `n > 0`, isso é `updated_at` (a RPC `liberar_cobranca_do_
 * pedido` grava `now()` ali toda vez que solta a vaga — a tentativa seguinte
 * só existe DEPOIS disso); para a tentativa 0 (nunca houve liberação), é
 * `created_at`. Sem NENHUM dos dois (teste com um dublê incompleto, nunca em
 * produção — as duas colunas são NOT NULL), cai para `Date.now()`: mais
 * ESTREITO que o correto, nunca mais largo — errar para o lado de NUNCA
 * liberar é seguro; errar para o lado de liberar demais é o buraco que B1
 * fecha.
 */
/**
 * BLINDAGEM (02/10/2026, crítica de desenho — achado 1): CARIMBO único de
 * cada POST de cartão. Duas chamadas podem fazer POST com a MESMA chave de
 * idempotência (a reserva desta e o retry de outra aba sobre o mesmo
 * sentinela); cada uma troca o sentinela pelo seu carimbo, por CAS, ANTES do
 * POST. Assim, quem solta o sentinela num 4xx que não prova nada sobre a
 * chave (`liberar_cobranca_do_pedido` exige o valor EXATO) só solta se
 * ninguém fez POST depois dele — o carimbo de outra aba faz o seu soltar
 * virar nada. Vai DENTRO da chave do sentinela (`<chave>:<carimbo>:<limite>`):
 * `sentinelaDaChave` continua casando pelo prefixo `<chave>:` e
 * `limiteInferiorDoSentinela` continua lendo o ÚLTIMO pedaço. Começa por
 * letra para nunca ser lido como o limite num sentinela sem limite.
 */
function carimboDoPost(): string {
  return `p${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function limiteInferiorDaTentativa(pedido: { updated_at?: unknown; created_at?: unknown }): number {
  const bruto = pedido.updated_at ?? pedido.created_at;
  const ms = typeof bruto === "string" ? Date.parse(bruto) : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
}

// C3 (02/10/2026): `expires_at + 24 h` — a janela em que a
// 20261186000000_cartao_em_analise_segura_a_expiracao.sql segura um pedido
// com cartão em verificação antes de o relógio cancelá-lo. É a data que o
// contrato `sem_registro` (desenho A1, 4.2) devolve em
// `canceladoAutomaticamenteAte`.
const JANELA_DO_CARTAO_EM_VERIFICACAO_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve um SENTINELA (`vagaEmVerificacao`) por FATO, nunca por relógio
 * (Ponto 1, 4ª revisão de risco, 26/09/2026 — substitui `sentinelaExpirado`/
 * `MINUTOS_SENTINELA_PRESO`, que o 4º revisor mediu abrindo uma janela de
 * DUAS cobranças capturadas para o mesmo pedido: um cartão em `processing`
 * pode levar DIAS em análise antifraude — e um teto de minutos, fixo,
 * liberava a vaga bem antes de a cobrança da tentativa anterior estar
 * morta de verdade, deixando o PIX (ou outro cartão) criado por cima virar
 * uma SEGUNDA cobrança quando o banco emissor finalmente aprovava a
 * primeira).
 *
 * Busca as orders de CARTÃO do pedido na Orders API
 * (`buscarOrdersDoPedido`/`resolverSentinela`, `_shared/mercadopago.ts`) e
 * devolve:
 *   - `{ ok: true, order }` — encontrou uma order de cartão APROVADA ou
 *     ainda VIVA: quem chama grava `order.id` na vaga (substitui o
 *     sentinela) e trata como qualquer cartão reconsultado por id (os ramos
 *     (a)/(d)/(f), mais abaixo, já sabem);
 *   - `{ ok: true, order: null }` — todas as orders de cartão encontradas
 *     estão mortas (recusada/cancelada/expirada) E pelo menos uma foi criada
 *     dentro da janela do LIMITE INFERIOR gravado no sentinela (achado B1,
 *     5ª revisão de risco, 26/09/2026 — `resolverSentinela`,
 *     `_shared/mercadopago.ts`, decide isso): a vaga pode ser liberada;
 *   - `{ ok: false }` — a busca falhou, o corpo veio ilegível, NENHUMA order
 *     de cartão foi encontrada ainda (pode ser atraso de indexação entre a
 *     Orders API e esta busca — UNVERIFIED, ver o comentário grande de
 *     `buscarOrdersDoPedido`), OU a lista só mostra orders mortas de fora da
 *     janela (Q3 do 5º revisor: uma lista PARCIALMENTE indexada, com só a
 *     order MORTA de uma tentativa ANTERIOR): o sentinela NUNCA é liberado
 *     por isto — continua ocupando a vaga, exatamente como antes de
 *     qualquer notícia chegar. O ÚNICO teto de tempo que continua valendo é
 *     a própria RESERVA (`pedido.expires_at`) — e esse teto já fecha a porta
 *     antes de `podeCobrar`, no topo do handler, sequer deixar chegar aqui;
 *     uma aprovação que só aparece DEPOIS disso é resolvida pela ADOÇÃO do
 *     webhook (Achado B2) + o ramo `pago_apos_expirar` (P1) de
 *     `confirmar_pagamento`, nunca por este handler.
 */
async function resolverVagaEmVerificacao(args: {
  token: string;
  pedidoId: string;
  desde: string;
  // O sentinela ATUALMENTE na vaga — `limiteInferiorDoSentinela`
  // (`_shared/mercadopago.ts`) lê dele o limite inferior gravado na hora da
  // escrita (achado B1). NUNCA recalculado aqui: o limite é fixado no
  // INSTANTE em que o sentinela nasce (a reserva antes do POST do cartão),
  // não a cada reconsulta.
  idSentinela: string;
  fetchImpl?: typeof fetch;
}): Promise<
  // `ordens` (P7, 02/10/2026): a lista da busca, para quem chama conferir as
  // IRMÃS da order escolhida (`estornadaComIrmaNaoMorta`, mais abaixo).
  | { ok: true; order: Record<string, unknown> | null; ordens: Record<string, unknown>[] }
  | { ok: false; buscaFalhou: boolean }
> {
  const busca = await buscarOrdersDoPedido({
    token: args.token,
    pedidoId: args.pedidoId,
    desde: args.desde,
    fetchImpl: args.fetchImpl,
  });
  // `buscaFalhou` (C3, 02/10/2026): separa "o MP não respondeu" (contrato
  // `verificacao: "indisponivel"`) de "respondeu e nada decide" (`sem_registro`).
  if (!busca.ok) return { ok: false, buscaFalhou: true };
  const limiteInferiorMs = limiteInferiorDoSentinela(args.idSentinela);
  const resolucao = resolverSentinela(busca.orders, limiteInferiorMs);
  if (resolucao === null) return { ok: false, buscaFalhou: false };
  if (resolucao.acao === "liberar") return { ok: true, order: null, ordens: busca.orders };
  return { ok: true, order: resolucao.order, ordens: busca.orders };
}

/**
 * A chave de idempotência (`X-Idempotency-Key`) da cobrança — POR TENTATIVA
 * (Fase 3.5, spec decisão 3).
 *
 * Até o cartão, a chave era sempre o id do pedido: um pedido tinha UMA
 * cobrança na vida. Agora a vaga pode ser liberada (cartão recusado, PIX
 * cancelado na troca para cartão) e o pedido ganha uma nova — e o MP, ao ver
 * a MESMA chave, devolveria a cobrança MORTA em vez de criar a nova.
 * `tentativas_de_pagamento` (somada por `liberar_cobranca_do_pedido`) muda a
 * chave a cada vaga liberada.
 *
 * - PIX: `<pedido>` na tentativa 0 — BYTE A BYTE a chave de antes, então um
 *   retry de um PIX criado antes deste deploy converge na mesma cobrança —
 *   e `<pedido>:<n>` depois.
 * - Cartão: `<pedido>:c<n>` — SEM o hash do token (correção do Achado A1,
 *   revisão de risco 26/09/2026; `token` continua parâmetro só para não
 *   quebrar quem chama esta função, embora não entre mais na chave).
 *   A versão original desta chave (`<pedido>:c<n>:<12 hex do sha256 do
 *   token>`) separava dois cartões na MESMA tentativa de propósito — e foi
 *   exatamente esse hash que abriu o buraco: duas abas (ou um duplo submit)
 *   com tokens DIFERENTES na mesma tentativa geravam DUAS chaves diferentes,
 *   e o MP criava DUAS orders — as duas podiam aprovar, e só uma cabia na
 *   vaga (`UNIQUE` em `gateway_payment_id`); a outra ficava com o cartão do
 *   cliente cobrado e NENHUM registro no pedido (Achado A1a). O mesmo hash
 *   também impedia o AUTOCONSERTO do Achado A1b: se a resposta do MP se
 *   perdesse por timeout/rede DEPOIS de o MP aprovar, o retry do front manda
 *   um token NOVO (o Brick não reusa token) — com o hash, isso virava uma
 *   chave nova, e portanto uma SEGUNDA cobrança pelo mesmo cartão.
 *
 *   Sem o hash, a chave passa a ser IGUAL à do PIX (por tentativa, não por
 *   token): duas abas na mesma tentativa disputam a MESMA chave no MP —
 *   nunca duas cobranças vivas. O que a chave SOZINHA garante depende do
 *   CORPO da segunda chamada:
 *   - MESMO corpo (duas abas com o MESMO token, ou um duplo submit real): a
 *     Orders API devolve a resposta em CACHE da primeira chamada — replay
 *     de verdade, sem processar de novo.
 *   - Corpo DIFERENTE (o caso comum: o Brick nunca reusa token, então um
 *     RETRY depois de uma resposta perdida manda um token NOVO com a MESMA
 *     chave): a doc da Orders API promete 409
 *     `idempotency_key_already_used` — achado da 2ª revisão de risco
 *     (26/09/2026) que corrigiu a suposição original desta função (achada
 *     por medição indireta, nunca por doc citada) de que a MESMA chave
 *     sempre devolvia a cobrança em cache, corpo qualquer. `criarOrder`
 *     nunca lançava esse 409 como recusa — o handler (`respostaCartaoEm
 *     Verificacao`, mais abaixo) trata esse código à parte: a cobrança da
 *     PRIMEIRA chamada PODE estar aprovada, sem id para reconsultar, e a
 *     saída é ocupar a vaga com um SENTINELA até o webhook resolver a
 *     ambiguidade (Achado B2) — nunca criar uma segunda cobrança.
 *   Recusa (402/400 de dado do cartão) continua exatamente como a spec
 *   decisão 3 previa: a idempotência devolve a MESMA recusa para a segunda
 *   aba, ela conta a tentativa nela mesma (`liberar_cobranca_do_pedido` com
 *   `p_gateway_payment_id: null`) e segue para a tentativa seguinte, com
 *   chave nova — isso NÃO depende da ressalva acima, porque a Orders API
 *   processa e responde (402/400), nunca fica ambígua.
 *
 * `tentativas` fora de inteiro ≥ 0 (coluna ausente, lixo) vale 0 — a chave
 * de antes, nunca um erro que trave o pagamento.
 */
export async function chaveDeIdempotencia(
  pedido: { id: string; tentativas_de_pagamento?: unknown },
  metodo: "pix" | "cartao",
  token?: string,
): Promise<string> {
  const bruto = Number(pedido.tentativas_de_pagamento);
  const tentativas = Number.isInteger(bruto) && bruto >= 0 ? bruto : 0;
  const id = String(pedido.id);
  if (metodo === "pix") return tentativas === 0 ? id : `${id}:${tentativas}`;
  // `token` não entra mais na chave (Achado A1) — ver o comentário grande
  // acima. `void token` só para o parâmetro continuar documentado na
  // assinatura sem o lint acusar variável não usada.
  void token;
  return chaveDoCartaoDaTentativa(id, tentativas);
}

export type DadosDoCartao = {
  token: string;
  paymentMethodId: string;
  paymentTypeId: "credit_card" | "debit_card";
  parcelas: number;
  documento: { type: "CPF" | "CNPJ"; number: string };
  email: string | null;
  // Device ID do comprador (03/10/2026) — opcional: `null` quando ausente ou
  // fora do formato (ver `deviceIdValido`). Nunca recusa o cartão.
  deviceId: string | null;
};

/**
 * Valida o corpo do CARTÃO antes de tocar o banco ou o MP:
 * `{token, paymentMethodId, paymentTypeId, parcelas, documento, email?}`.
 * As regras de formato são as MESMAS de `montarCorpoCartaoOrders` (importadas
 * de `_shared/mercadopago.ts`, nunca uma segunda regex aqui).
 *
 * Débito sem `parcelas` vale 1 (débito não parcela, e o Brick pode nem
 * mandar); crédito exige. Toda recusa é recuperável: o cliente corrige o
 * dado (ou o Brick gera um token novo) e tenta de novo — as mensagens dizem
 * O QUE corrigir, sem ecoar o valor recebido.
 */
export function validarCorpoDoCartao(
  body: Record<string, unknown>,
): { ok: true; dados: DadosDoCartao } | { ok: false; erro: string } {
  if (!tokenDeCartaoValido(body.token) || !metodoDeCartaoValido(body.paymentMethodId)) {
    return { ok: false, erro: "Dados do cartão incompletos. Digite o cartão de novo." };
  }
  if (!tipoDeCartaoValido(body.paymentTypeId)) {
    return { ok: false, erro: "Escolha crédito ou débito para pagar com cartão." };
  }
  const debito = body.paymentTypeId === "debit_card";
  // Número, ou string só de dígitos (1-2) — tolerância para um front que
  // serialize o número como texto; qualquer outra coisa recusa.
  const parcelasBrutas = typeof body.parcelas === "string" && /^\d{1,2}$/.test(body.parcelas)
    ? Number(body.parcelas)
    : body.parcelas;
  let parcelas: number;
  if (debito && (parcelasBrutas === undefined || parcelasBrutas === null)) {
    parcelas = 1;
  } else if (parcelasValidas(parcelasBrutas)) {
    parcelas = debito ? 1 : parcelasBrutas;
  } else {
    return { ok: false, erro: "Número de parcelas inválido." };
  }
  const documento = normalizarDocumento(body.documento);
  if (!documento) {
    return { ok: false, erro: "Informe um CPF ou CNPJ válido do titular do cartão." };
  }
  if (body.email !== undefined && body.email !== null && body.email !== "" && !emailValido(body.email)) {
    return { ok: false, erro: "E-mail inválido." };
  }
  return {
    ok: true,
    dados: {
      token: body.token,
      paymentMethodId: body.paymentMethodId,
      paymentTypeId: body.paymentTypeId,
      parcelas,
      documento,
      email: emailValido(body.email) ? body.email : null,
      // `device_id` (snake_case, como o front manda) fora do formato é IGNORADO,
      // não recusado: sem ele o antifraude do MP perde um sinal, mas o cliente
      // paga — e front novo e edge velha/nova convivem em qualquer ordem.
      deviceId: deviceIdValido(body.device_id) ? body.device_id : null,
    },
  };
}

/**
 * O que a loja liga no cartão (`config_pagamento_cartao`, linha `id = 1`,
 * lida com o client de service role). `null` = cartão indisponível: linha
 * ausente, erro de leitura ou exceção — fechado, nunca "liga por padrão"
 * (a linha nasce desligada; ver a decisão 7 da spec). `parcelas_max` fora de
 * 1..12 vale 1: o teto mais seguro, não um palpite generoso.
 */
async function lerConfigDoCartao(
  supabase: ReturnType<typeof createClient>,
): Promise<{ credito: boolean; debito: boolean; parcelasMax: number } | null> {
  try {
    const { data, error } = await supabase
      .from("config_pagamento_cartao")
      .select("credito, debito, parcelas_max")
      .eq("id", 1)
      .maybeSingle();
    if (error) {
      console.error("criar-pagamento: falha ao ler config_pagamento_cartao", error);
      return null;
    }
    if (!data) return null;
    const maximo = Number(data.parcelas_max);
    return {
      credito: data.credito === true,
      debito: data.debito === true,
      parcelasMax: Number.isInteger(maximo) && maximo >= 1 && maximo <= 12 ? maximo : 1,
    };
  } catch (erro) {
    console.error("criar-pagamento: exceção ao ler config_pagamento_cartao", erro);
    return null;
  }
}

/**
 * `liberar_cobranca_do_pedido` (RPC, só service role): com `idGateway`, solta
 * a vaga SE ela ainda for dessa cobrança e o pedido ainda estiver
 * 'aguardando' (e soma a tentativa); com `null`, só soma a tentativa — a
 * recusa imediata que nunca ocupou a vaga. Nunca lança: `{ok:false}` é falha
 * de banco, e cada chamador decide o que ela significa.
 */
async function liberarCobranca(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  idGateway: string | null,
): Promise<{ ok: true; liberou: boolean } | { ok: false }> {
  // Achado R3 (2ª revisão de risco, 26/09/2026): uma falha de banco aqui
  // (timeout, deadlock passageiro) deixa `tentativas_de_pagamento` PARADA —
  // e a PRÓXIMA cobrança de cartão reusaria a MESMA chave de idempotência,
  // batendo numa `idempotency_key_already_used` que não precisava acontecer.
  // UMA retentativa imediata (sem espera: um soluço passageiro de conexão
  // já passou no tempo desta própria chamada) reduz a janela sem precisar
  // mexer na RPC (migration, fora do escopo desta correção) — não elimina
  // o risco de uma falha PERSISTENTE, mas cobre o caso comum.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const { data, error } = await supabase.rpc("liberar_cobranca_do_pedido", {
        p_order_id: orderId,
        p_gateway_payment_id: idGateway,
      });
      if (error) throw error;
      return { ok: true, liberou: data === true };
    } catch (erro) {
      if (tentativa === 1) {
        console.error("criar-pagamento: liberar_cobranca_do_pedido falhou (2 tentativas)", orderId, idGateway, erro);
        return { ok: false };
      }
      console.warn("criar-pagamento: liberar_cobranca_do_pedido falhou, tentando mais uma vez", orderId, idGateway, erro);
    }
  }
  return { ok: false };
}

/**
 * Corpo do estado `sem_registro` (desenho A1, 4.2): a vaga guarda um
 * sentinela que a busca da chave não resolveu — não há order confirmada, e
 * nada desta function faz POST sobre ele (C3). O MESMO corpo para o cartão
 * pedido sobre o sentinela (C3) e para o modo `verificar` (C2), que o front
 * consome do mesmo jeito. `canceladoAutomaticamenteAte` é a data real do
 * cancelamento pelo relógio (`expires_at + 24 h`, 20261186).
 */
function corpoSemRegistro(expiresAt: unknown): Record<string, unknown> {
  const prazoMs = Date.parse(String(expiresAt ?? ""));
  return {
    verificacao: "sem_registro",
    paymentId: null,
    expiraEm: expiresAt ?? null,
    canceladoAutomaticamenteAte: Number.isFinite(prazoMs)
      ? new Date(prazoMs + JANELA_DO_CARTAO_EM_VERIFICACAO_MS).toISOString()
      : undefined,
  };
}

/**
 * Corpo `pago` do `verificar` quando o BANCO já confirmou o pagamento
 * (`payment_status` 'pago'/'pago_apos_expirar' — a RPC do webhook decidiu,
 * não é palpite sobre a order). Decisão do coordenador (revisão do C2,
 * 02/10/2026): vale na ENTRADA e na RELEITURA — o cliente que pagou nunca lê
 * o 409 "não está aguardando", e duas chamadas seguidas respondem o mesmo.
 * `paymentId` é o id da vaga, ou `null` se ela guarda um sentinela. `null` =
 * não está pago.
 */
function corpoDePagoConfirmado(linha: Record<string, unknown>): Record<string, unknown> | null {
  if (linha.payment_status !== "pago" && linha.payment_status !== "pago_apos_expirar") return null;
  const vaga = linha.gateway_payment_id;
  const idPago = typeof vaga === "string" && vaga.length > 0 && !vagaEmVerificacao(vaga) ? vaga : null;
  return { verificacao: "pago", paymentId: idPago, expiraEm: linha.expires_at ?? null };
}

/**
 * C2 (02/10/2026): quando a consulta `verificar` RECUSA — o espelho de
 * `podeCobrar`, com as MESMAS mensagens terminais, e uma diferença só: o
 * prazo. A consulta continua valendo depois de `expires_at` enquanto a
 * 20261186 segura o pedido (`expires_at + 24 h`) — é o que deixa um 3DS ou
 * uma aprovação que chegam depois do prazo serem vistos. `null` = pode
 * verificar.
 */
function motivoParaNaoVerificar(
  pedido: { payment_status?: unknown; status?: unknown; expires_at?: unknown },
  agora: Date,
): string | null {
  if (pedido.payment_status !== "aguardando") return "Este pedido não está aguardando pagamento.";
  if (pedido.status === "cancelled") return "Este pedido foi cancelado.";
  if (pedido.expires_at === null || pedido.expires_at === undefined) {
    return "Este pedido não tem prazo de pagamento.";
  }
  const prazoMs = Date.parse(String(pedido.expires_at));
  if (!Number.isFinite(prazoMs) || prazoMs + JANELA_DO_CARTAO_EM_VERIFICACAO_MS <= agora.getTime()) {
    return "O prazo para pagar este pedido acabou.";
  }
  return null;
}

/**
 * Order MORTA pelo PAR (`mapearStatusOrder` → recusado/expirado). Par
 * desconhecido NUNCA é morto.
 *
 * Revisão do C2 (revisor financeiro, 02/10/2026, bloqueio): quando nem todas
 * as orders da busca estão mortas e nenhuma é viva CONHECIDA,
 * `resolverSentinela` (`_shared/mercadopago.ts` — publicado, o webhook e a
 * reconciliação dependem dele; não se toca) devolve `cartao[0]`, que pode
 * ser a MORTA, com uma order de status desconhecido ao lado. Adotar essa
 * morta transformava "status não mapeado" em recusa — a próxima chamada
 * soltava a vaga e fazia POST com chave nova enquanto a desconhecida podia
 * estar viva. Quem chama `resolverVagaEmVerificacao` e recebe uma order
 * morta NÃO adota (e não libera): o sentinela fica, e a resposta é
 * `sem_registro`.
 */
function orderMortaPeloPar(ordem: Record<string, unknown>): boolean {
  const mapeado = mapearStatusOrder(String(ordem.status ?? ""), String(ordem.status_detail ?? ""));
  return mapeado === "recusado" || mapeado === "expirado";
}

/**
 * Os dois `status` raiz de `STATUS_ORDER_MORTOS` (`_shared/mercadopago.ts`)
 * que são dinheiro DEVOLVIDO (estorno, contestação), não recusa — os outros
 * quatro (failed/canceled/cancelled/expired) já são `orderMortaPeloPar`.
 */
const STATUS_ORDER_ESTORNADA = new Set(["refunded", "charged_back"]);

/**
 * Order morta por ESTORNO ou CONTESTAÇÃO: `status` raiz em
 * `STATUS_ORDER_ESTORNADA`, ou o par `processed:partially_refunded` — raiz
 * `processed`, que `resolverSentinela` escolhe como "aprovada".
 */
function orderMortaPorEstorno(ordem: Record<string, unknown>): boolean {
  return STATUS_ORDER_ESTORNADA.has(String(ordem.status ?? "")) ||
    String(ordem.status_detail ?? "") === "partially_refunded";
}

/**
 * P7 (revisor Opus, 02/10/2026): `resolverSentinela` pode devolver uma order
 * ESTORNADA/CONTESTADA (`orderMortaPorEstorno`) — por ser `processed`
 * (`partially_refunded`) ou por ser `cartao[0]` ao lado de uma de status
 * desconhecido — com uma IRMÃ de cartão NÃO-morta na mesma busca (viva, paga
 * ou desconhecida; morta = a régua de `STATUS_ORDER_MORTOS`). Adotar a
 * estornada tirava a vaga da irmã: quando ela aprovava, o webhook já não
 * adotava (`cartao_divergente`, `webhook-mercadopago`) e o pedido não se
 * confirmava. Quem chama NÃO adota nem libera: o sentinela fica, e a resposta
 * é `sem_registro` — o mesmo desfecho de `orderMortaPeloPar`.
 */
function estornadaComIrmaNaoMorta(
  ordem: Record<string, unknown>,
  ordens: Record<string, unknown>[],
): boolean {
  if (!orderMortaPorEstorno(ordem)) return false;
  const idDaEstornada = String(ordem.id ?? "");
  return ordens.some((irma) =>
    orderEhDeCartao(irma) &&
    String(irma.id ?? "") !== idDaEstornada &&
    !orderMortaPeloPar(irma) &&
    !orderMortaPorEstorno(irma)
  );
}

/**
 * Troca o SENTINELA pela order que a busca da chave encontrou (Ponto 1,
 * Achado S3: a forma e as parcelas vêm da order ENCONTRADA, nunca de um
 * corpo de cartão). CAS pelo sentinela EXATO — se a vaga mudou (webhook,
 * outra aba), não grava nada. Fonte única: a reconsulta do fluxo de
 * cobrança e o modo `verificar` (C2) usam este mesmo CAS.
 */
async function adotarOrderNoSentinela(
  supabase: ReturnType<typeof createClient>,
  pedidoId: string,
  sentinela: string,
  ordem: Record<string, unknown>,
): Promise<{ idResolvido: string; metodoResolvido: string | null; gravou: boolean; erro: unknown }> {
  const idResolvido = String(ordem.id ?? "");
  const tipoResolvido = tipoDoPagamentoDaOrder(ordem);
  const metodoResolvido = tipoResolvido === "credit_card"
    ? "credito"
    : tipoResolvido === "debit_card"
      ? "debito"
      : null;
  if (idResolvido.length === 0) return { idResolvido, metodoResolvido, gravou: false, erro: null };
  const { data, error } = await supabase
    .from("marketplace_orders")
    .update({
      gateway_payment_id: idResolvido,
      metodo_online: metodoResolvido,
      parcelas: parcelasDaOrder(ordem),
      updated_at: new Date().toISOString(),
    })
    .eq("id", pedidoId)
    .eq("gateway_payment_id", sentinela)
    .select("id")
    .maybeSingle();
  return { idResolvido, metodoResolvido, gravou: Boolean(data), erro: error ?? null };
}

/**
 * C2 (desenho A1 §3/§4, corrigido pelo veredito A2, 02/10/2026): o modo
 * `metodo: "verificar"` — a ÚNICA recuperação de um pedido de cartão em
 * dúvida, sem cobrança nenhuma. Chamado depois de `donoConfere` e da trava
 * de conta, ANTES de `podeCobrar` (vale depois do prazo, dentro das 24 h).
 *
 * O que ele faz com a vaga lida:
 * - `null`: nada (nem consulta o MP).
 * - id clássico (PIX legado): nada.
 * - id real: GET por id. Cartão MORTO por prova (recusado/cancelado/
 *   expirado) -> `liberar_cobranca_do_pedido` com o id EXATO. PIX (vivo ou
 *   morto): nada — nunca grava por cima de PIX.
 * - sentinela: a busca da chave (`resolverVagaEmVerificacao`). Order viva/
 *   aprovada -> CAS sentinela -> id real. Todas mortas na janela, sentinela
 *   da chave ATUAL -> RPC com a string EXATA. Busca vazia ou sem decisão ->
 *   nada (nunca libera).
 *
 * NUNCA: POST, cancelamento no MP, chave/token/tentativa mudados fora da
 * RPC. A única escrita que zera a vaga continua sendo a RPC (invariante do
 * revisor: qualquer outra reabre o H1d).
 *
 * Depois de agir, RELÊ a linha e responde sobre a vaga ATUAL — se o webhook
 * trocou o sentinela pelo id real no meio, a resposta é pelo id real.
 */
async function verificarVagaDoPedido(args: {
  supabase: ReturnType<typeof createClient>;
  mpToken: string;
  fetchImpl?: typeof fetch;
  pedido: Record<string, unknown>;
  json: (corpo: unknown, status: number) => Response;
  respostaIndisponivel: () => Response;
}): Promise<Response> {
  const { supabase, mpToken, fetchImpl, pedido, json, respostaIndisponivel } = args;
  const pedidoId = String(pedido.id);
  const pagoNaEntrada = corpoDePagoConfirmado(pedido);
  if (pagoNaEntrada !== null) return json(pagoNaEntrada, 200);
  const motivo = motivoParaNaoVerificar(pedido, new Date());
  if (motivo !== null) return json({ error: motivo, terminal: true }, 409);

  const consultarPorId = async (id: string): Promise<Record<string, unknown> | null> => {
    const consulta = await consultarOrder({ token: mpToken, orderId: id, fetchImpl, corpoNoLog: false });
    if (!consulta.ok || String(consulta.order?.id ?? "") !== id) return null;
    return consulta.order as Record<string, unknown>;
  };

  const vagaLida = typeof pedido.gateway_payment_id === "string" && pedido.gateway_payment_id.length > 0
    ? pedido.gateway_payment_id
    : null;
  const ordensJaConsultadas = new Map<string, Record<string, unknown>>();
  // A ocupante LIDA no início está morta por PROVA (GET por id ou busca na
  // janela) — é o que distingue "recusado" de "livre" quando a vaga relida
  // está vazia (por esta RPC ou pela da notificação).
  let ocupanteMortaPorProva = false;

  if (vagaLida !== null && vagaEmVerificacao(vagaLida)) {
    const resolucao = await resolverVagaEmVerificacao({
      token: mpToken,
      pedidoId,
      desde: String(pedido.created_at ?? ""),
      idSentinela: vagaLida,
      fetchImpl,
    });
    if (!resolucao.ok && resolucao.buscaFalhou) return respostaIndisponivel();
    if (resolucao.ok && resolucao.order === null) {
      // Morta por prova. Sentinela de chave ANTERIOR nunca libera (revisão
      // de 30/09, MENOR 1): a janela pode trazer só a order morta de uma
      // tentativa posterior enquanto a `c<n>` ambígua não foi indexada.
      if (sentinelaDaChave(vagaLida, await chaveDeIdempotencia(pedido as { id: string }, "cartao"))) {
        const liberacao = await liberarCobranca(supabase, pedidoId, vagaLida);
        if (!liberacao.ok) return respostaIndisponivel();
        ocupanteMortaPorProva = true;
      }
    } else if (resolucao.ok && resolucao.order !== null) {
      if (orderMortaPeloPar(resolucao.order)) {
        // Morta com uma desconhecida ao lado (`orderMortaPeloPar`, acima):
        // nem adota nem libera — a releitura responde `sem_registro`.
        console.warn("criar-pagamento: verificar — busca devolveu order morta com status desconhecido ao lado; sentinela mantido", {
          orderId: pedidoId,
        });
      } else if (estornadaComIrmaNaoMorta(resolucao.order, resolucao.ordens)) {
        // P7: estornada com irmã não-morta ao lado (`estornadaComIrmaNaoMorta`,
        // acima): nem adota nem libera — a releitura responde `sem_registro`.
        console.warn("criar-pagamento: verificar — busca devolveu order estornada com irmã não-morta ao lado; sentinela mantido", {
          orderId: pedidoId,
        });
      } else {
        const adocao = await adotarOrderNoSentinela(supabase, pedidoId, vagaLida, resolucao.order);
        if (adocao.erro) {
          console.error("criar-pagamento: verificar — falha ao gravar a order resolvida do sentinela", pedidoId, adocao.erro);
          return respostaIndisponivel();
        }
      }
    }
  } else if (vagaLida !== null && !idEhClassico(vagaLida)) {
    const ordem = await consultarPorId(vagaLida);
    if (ordem === null) return respostaIndisponivel();
    ordensJaConsultadas.set(vagaLida, ordem);
    if (orderEhDeCartao(ordem) && orderMortaPeloPar(ordem)) {
      // 3DS vencido (`canceled:expired`), recusa, cancelamento: libera pela
      // RPC com o id EXATO da vaga. PIX nunca entra aqui.
      const liberacao = await liberarCobranca(supabase, pedidoId, vagaLida);
      if (!liberacao.ok) return respostaIndisponivel();
      ocupanteMortaPorProva = true;
    }
  }

  // Responde sobre a vaga ATUAL.
  const { data: relida, error: erroRelida } = await supabase
    .from("marketplace_orders")
    .select("payment_status, status, expires_at, gateway_payment_id")
    .eq("id", pedidoId)
    .maybeSingle();
  if (erroRelida || !relida) return respostaIndisponivel();
  const atual = relida as Record<string, unknown>;
  // Revisão do C2 (recomendação 1): a notificação confirmou o pagamento
  // DURANTE esta consulta — ver `corpoDePagoConfirmado`.
  const pagoNaReleitura = corpoDePagoConfirmado(atual);
  if (pagoNaReleitura !== null) return json(pagoNaReleitura, 200);
  const motivoAgora = motivoParaNaoVerificar(atual, new Date());
  if (motivoAgora !== null) return json({ error: motivoAgora, terminal: true }, 409);
  const expiraEm = atual.expires_at ?? null;
  const vagaAtual = typeof atual.gateway_payment_id === "string" && atual.gateway_payment_id.length > 0
    ? atual.gateway_payment_id
    : null;
  if (vagaAtual === null) {
    return json({ verificacao: ocupanteMortaPorProva ? "recusado" : "livre", paymentId: null, expiraEm }, 200);
  }
  if (vagaEmVerificacao(vagaAtual)) return json(corpoSemRegistro(expiraEm), 200);
  if (idEhClassico(vagaAtual)) return json({ verificacao: "pix", paymentId: vagaAtual, expiraEm }, 200);
  const ordemAtual = ordensJaConsultadas.get(vagaAtual) ?? await consultarPorId(vagaAtual);
  if (ordemAtual === null) return respostaIndisponivel();
  if (!orderEhDeCartao(ordemAtual)) return json({ verificacao: "pix", paymentId: vagaAtual, expiraEm }, 200);
  if (orderMortaPeloPar(ordemAtual)) return json({ verificacao: "recusado", paymentId: null, expiraEm }, 200);
  const statusAtual = mapearStatusOrder(String(ordemAtual.status ?? ""), String(ordemAtual.status_detail ?? ""));
  if (statusAtual === "pago") return json({ verificacao: "pago", paymentId: vagaAtual, expiraEm }, 200);
  const urlDoDesafio = statusAtual === "aguardando" ? extrairDesafio3ds(ordemAtual) : null;
  if (urlDoDesafio) {
    return json({ verificacao: "desafio3ds", paymentId: vagaAtual, desafio3ds: { url: urlDoDesafio }, expiraEm }, 200);
  }
  // `processing`, outro `action_required`, par desconhecido: a order existe
  // e não está morta — "em análise" aqui é verdade.
  return json({ verificacao: "em_analise", paymentId: vagaAtual, expiraEm }, 200);
}

/**
 * Dedup do aviso de "status de cartão desconhecido" (branch (d) da
 * reconsulta, mais abaixo — adendo 2 à 8ª rodada de risco, 26/09/2026):
 * chave `${pedidoId}:${status}:${statusDetail}` -> já avisado. MODULE-LEVEL
 * de propósito — sobrevive ENTRE requisições no MESMO isolate do Edge
 * Runtime, o que impede um cliente parado esperando o cartão resolver (a
 * reserva vive 30-40 min) de fazer esta function avisar o admin de novo a
 * cada "Tentar de novo"/poll. MELHOR ESFORÇO, não garantia: um cold start
 * limpa o Set e o próximo poll avisa de novo — nunca pior que avisar demais
 * uma vez a mais, nunca perde o aviso de vez. `deps.statusesCartaoDesconhecidos
 * Avisados` (abaixo, na assinatura de `handler`) troca este Set em teste,
 * para a suíte não vazar estado entre casos que reusam o mesmo `UUID`.
 */
const statusesCartaoDesconhecidosAvisadosReal = new Set<string>();

/**
 * Achado A1 (3) — revisão de risco, 26/09/2026: quando a vaga da cobrança é
 * perdida na corrida (mais abaixo, no handler) e a order de CARTÃO que ESTA
 * chamada acabou de criar no MP não é cancelável nem é a que ficou gravada,
 * ela vira "órfã" — dinheiro que o MP pode ter aprovado de verdade, sem
 * NENHUMA linha do banco apontando para ela. Sem aviso, ela só aparece
 * batendo o extrato do MP na mão.
 *
 * Mesmo mecanismo de aviso ao admin que `webhook-mercadopago` já usa
 * (`disparoPushReal`, para 'pago'/'pago_apos_expirar') — não é importável
 * daqui (aquele arquivo chama `serve()` no próprio import, e esta function
 * também chama; importar um do outro subiria um segundo servidor HTTP no
 * meio do runner de teste). As MESMAS primitivas de `_shared/webpush.ts`
 * (a peça pensada para isso — ver o cabeçalho dela) montam o mesmo tipo de
 * aviso uma terceira vez, para um terceiro chamador.
 *
 * Nunca lança: uma cobrança órfã já é o pior caso deste handler, e uma falha
 * de push não pode virar um 500 que esconde do cliente que o cartão FOI
 * cobrado — a resposta HTTP desta requisição não depende deste aviso.
 */
async function alertarAdminCartaoOrfaoReal(args: {
  supabase: ReturnType<typeof createClient>;
  orderId: string;
  idOrderOrfa: string;
  // S5(b) (achado da 4ª revisão de risco, 26/09/2026): o título/corpo do
  // aviso, quando quem chama tem uma mensagem PRÓPRIA — a gravação do
  // sentinela (`respostaCartaoEmVerificacao`, mais abaixo) NÃO é o mesmo
  // fato que uma cobrança órfã de verdade (Achado A1): o sentinela pode se
  // resolver sozinho quando o webhook adotar, e reusar "Cobrança de cartão
  // sem registro" (o default, abaixo) alarmava o admin para algo que ainda
  // pode não ser problema nenhum. Default AUSENTE — os dois chamadores de
  // órfã de verdade continuam com o título de sempre.
  aviso?: { title: string; body: string };
}): Promise<void> {
  const { supabase, orderId, idOrderOrfa } = args;
  try {
    const { data: admins, error: erroAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin");
    if (erroAdmins) throw erroAdmins;

    const ids = (admins ?? []).map((a: { id: string }) => a.id);
    if (ids.length === 0) {
      console.error(
        "criar-pagamento: cartao_orfao — nenhum admin cadastrado para avisar",
        { orderId, idOrderOrfa },
      );
      return;
    }

    const { data: inscricoes, error: erroInscricoes } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .in("user_id", ids);
    if (erroInscricoes) throw erroInscricoes;

    if (!inscricoes || inscricoes.length === 0) {
      console.error(
        "criar-pagamento: cartao_orfao — nenhum admin inscrito para push",
        { orderId, idOrderOrfa },
      );
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

    const aviso = args.aviso
      ? { ...args.aviso, url: "/admin-orders" }
      : {
          title: "Cobrança de cartão sem registro",
          body: `${descricaoDoPedido(orderId)} · confira o painel do Mercado Pago`,
          url: "/admin-orders",
        };
    const itens = await enviarParaInscritos({
      servidor,
      inscricoes,
      mensagem: JSON.stringify(aviso),
      rotulo: "criar-pagamento",
      aoDetectarMorta: (endpoint: string) =>
        supabase.from("push_subscriptions").delete().eq("endpoint", endpoint),
    });

    const resumo = resumir(itens);
    console.error(
      "criar-pagamento: cartao_orfao — aviso disparado ao admin",
      { orderId, idOrderOrfa, enviados: resumo.enviados, falharam: resumo.falharam },
    );
  } catch (erro) {
    console.error("criar-pagamento: cartao_orfao — falha ao avisar o admin", { orderId, idOrderOrfa }, erro);
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
  deps: {
    supabase?: ReturnType<typeof createClient>;
    fetchImpl?: typeof fetch;
    // Tarefa 2 (CHECKOUT-070): mesma costura de `fetchImpl` acima, para o
    // catch do throw de `montarCorpoPixOrders` (expiração fora da faixa)
    // ser alcançável em teste sem depender de um bug de verdade neste
    // arquivo. Em produção nunca é passado — default "PT30M" abaixo.
    expiracaoPix?: string;
    // Achado A1 (3): ponto de injeção do aviso de cartão órfão — mesmo
    // padrão de `deps.enviarPush` em `webhook-mercadopago`. Em produção
    // nunca é passado — cai no `alertarAdminCartaoOrfaoReal` de verdade.
    alertarAdminCartaoOrfao?: (args: {
      supabase: ReturnType<typeof createClient>;
      orderId: string;
      idOrderOrfa: string;
      aviso?: { title: string; body: string };
    }) => Promise<void>;
    // Achado (adendo 2 à 8ª rodada de risco, 26/09/2026): dedup do aviso de
    // "status de cartão desconhecido" (branch (d), mais abaixo) — em
    // produção nunca é passado, cai no Set MODULE-LEVEL de verdade
    // (`statusesCartaoDesconhecidosAvisadosReal`), que sobrevive ENTRE
    // requisições no MESMO isolate — é o que impede um cliente parado 30-40
    // min de fazer esta function avisar o admin a cada poll. Testes SEMPRE
    // passam o próprio (fresco a cada teste), para não vazar estado entre
    // eles (o mesmo `UUID` de pedido é reusado por toda a suíte).
    statusesCartaoDesconhecidosAvisados?: Set<string>;
    // POLÍTICA DO PIX (29/09/2026): costura de credenciais para TESTES DE
    // CORRIDA. O resolver de verdade faz esperas reais de crypto.subtle por
    // chamada quando a origem é lojista, e a ORDEM dessas tarefas entre dois
    // handlers paralelos não é determinística — nenhum truque de stub congela
    // código de produção, e as corridas da vaga ficavam flaky. Injetando as
    // credenciais PRONTAS (mesma semântica lojista-com-chave, sem a cripto no
    // caminho), as corridas testam a VAGA/idempotência de forma
    // determinística. Em produção nunca é passado — cai no
    // `resolverCredenciaisMp` de verdade.
    credenciaisMp?: CredenciaisMp;
  } = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (corpo: unknown, status: number) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // Pagamento online exige conta — ver o comentário grande no ponto onde o
  // PIX aplica esta regra, mais abaixo. Uma resposta só, usada também pelo
  // cartão (Fase 3.5), que precisa da trava ANTES de mexer na vaga.
  const respostaExigeConta = () =>
    json(
      {
        error:
          "Pagar pelo site exige conta. Entre ou crie uma conta para continuar.",
        code: "PAGAMENTO_ONLINE_EXIGE_CONTA",
        terminal: true,
      },
      403,
    );

  // Contrato `verificacao: "indisponivel"` (desenho A1, 4.2): o MP (busca ou
  // GET) ou o banco não responderam — nada foi decidido nem gravado, e
  // "Verificar de novo" é seguro. Uma resposta só, para o cartão sobre
  // sentinela (C3) e para o `verificar` (C2).
  const respostaIndisponivel = () =>
    json({ error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" }, 503);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  if (!pareceUuid(body.orderId)) return json({ error: "Pedido inválido." }, 400);
  // Fase 3.5 (26/09/2026): PIX ou cartão. Até aqui o cartão era recusado
  // nesta linha ("No momento aceitamos apenas PIX.") por causa da herança nº
  // 2 da Fase 2 — depois da primeira recusa o pedido ficava impagável até
  // expirar. `liberar_cobranca_do_pedido` fechou essa herança (ver o topo do
  // arquivo). Forma desconhecida continua recuperável: "Tentar de novo"
  // remonta a escolha de forma, e o próprio retry troca de método.
  const metodo = body.metodo;
  // C2 (02/10/2026): `"verificar"` é a consulta SEM cobrança (só GET no MP e
  // CAS no banco) — ver `verificarVagaDoPedido`.
  if (metodo !== "pix" && metodo !== "cartao" && metodo !== "verificar") {
    return json({ error: "Forma de pagamento inválida." }, 400);
  }
  // Corpo do cartão validado ANTES de qualquer leitura de banco ou chamada
  // ao MP — dado malformado não gasta pedido, config nem gateway.
  let dadosCartao: DadosDoCartao | null = null;
  if (metodo === "cartao") {
    const validacaoCartao = validarCorpoDoCartao(body);
    if (!validacaoCartao.ok) return json({ error: validacaoCartao.erro }, 400);
    dadosCartao = validacaoCartao.dados;
  }

  // PEDIDO-07 (auditoria de 26/08/2026): este createClient PRECISA ficar
  // dentro de um try — readKey nunca lança (devolve "" quando nenhuma das
  // duas variáveis existe, ver o comentário dela em _shared/webpush.ts), mas
  // createClient sim: "supabaseKey is required." Antes desta correção essa
  // chamada ficava fora de qualquer try/catch, e o throw escapava o handler
  // inteiro — 500 cru, sem JSON nenhum que o front reconheça.
  //
  // O QUE ESTA CORREÇÃO NÃO MUDA, DE PROPÓSITO: o laço de "Tentar de novo"
  // do cliente continua existindo depois dela, igual a antes. useOrders.ts
  // só para de tentar quando o CORPO da resposta traz `terminal: true`, e
  // este 503 NÃO traz — DIFERENTE do "sem credencial do Mercado Pago"
  // (D1, logo abaixo), que virou terminal, porque os dois têm escalas de
  // conserto diferentes:
  // chave de service role é ajuste de operador em MINUTOS (dentro da
  // janela de 30 min do PIX, retentar é o comportamento certo); chaves do
  // Mercado Pago numa loja nova são cadastro na aplicação MP do lojista —
  // DIAS, não minutos, e ninguém avisa o cliente de nada enquanto isso.
  // Falta de env var no servidor nunca é problema DO PEDIDO — a diferença
  // é só o prazo de quem conserta. O que esta correção resolve é só o
  // throw cru escapando sem mensagem nenhuma; o cliente sempre continuou
  // (e deve continuar) tentando de novo depois deste 503 de service role.
  let supabase: ReturnType<typeof createClient>;
  if (deps.supabase) {
    supabase = deps.supabase;
  } else {
    try {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
      );
    } catch (err) {
      console.error("criar-pagamento: falha ao criar o client do Supabase", err);
      return json({ error: "Pagamento indisponível." }, 503);
    }
  }

  // Tarefa mp-2 (15/09/2026): QUEM cobra este cliente — a chave do LOJISTA
  // (cadastrada em Ajustes > Pagamentos > Mercado Pago, guardada cifrada em
  // app_settings) ou, só quando não existe cadastro nenhum, o MP_ACCESS_TOKEN
  // da plataforma. A regra fechada mora em `_shared/credenciais-mp.ts`: com
  // chave do lojista cadastrada e cofre fora do ar, ninguém cobra — cair no
  // token da plataforma aqui é cobrar o cliente na conta ERRADA.
  //
  // POR QUE ESTA CHECAGEM DESCEU para depois do client: ela dependia só do
  // `Deno.env` e ficava lá em cima, antes da leitura do pedido; agora ela
  // precisa do client de service role para ler o registro do lojista. A
  // ordem relativa que isso troca é só uma — falha ao montar o client
  // (503 recuperável) passa a vir ANTES de "sem credencial do MP" (503
  // terminal). Nenhuma das duas depende do pedido, as duas continuam
  // acontecendo antes de qualquer chamada ao MP, e um servidor sem chave de
  // service role não tem como saber de quem é o token do Mercado Pago.
  const credenciaisMp = deps.credenciaisMp ?? await resolverCredenciaisMp(supabase);
  const mpToken = credenciaisMp.token;
  if (!mpToken) {
    // Só origem e motivo — token nenhum, de ninguém, entra em log.
    console.error(
      `criar-pagamento: sem credencial do Mercado Pago (origem: ${credenciaisMp.origem}, motivo: ${credenciaisMp.motivo ?? "sem_token"})`,
    );
    // Laudo 0109 (D1): sem chave, TENTAR DE NOVO bate na mesma recusa —
    // é falha de configuração do operador, não do cliente. `terminal: true`
    // tira o cliente do loop de "Tentar de novo" pelo contrato do
    // CHECKOUT-050 (a categoria viaja no corpo, NUNCA por comparação de
    // mensagem no front).
    return json({ error: "Pagamento indisponível.", terminal: true }, 503);
  }

  // POLÍTICA DO PIX (Gabriel, 29/09/2026 — app de assinatura, uma loja por
  // banco): o PIX só existe para loja com a CHAVE DE ASSINATURA DO WEBHOOK
  // DO MERCADO PAGO CADASTRADA PELA PRÓPRIA LOJA (registro cifrado em
  // app_settings). A chave global do ambiente (MP_WEBHOOK_SECRET da
  // plataforma) NÃO substitui o cadastro da loja. (Dizia "CARTÃO e demais
  // meios NÃO são afetados por esta regra — deliberação do dono". A decisão
  // do dono de 30/09/2026 — pagamento pelo app só com as 3 chaves — superou
  // essa: ver a trava do CARTÃO logo abaixo, S2 de 04/10/2026.)
  //
  // O PORQUÊ: sem a chave própria, as notificações de pagamento da loja não
  // têm como ser validadas com o segredo DELA — a confirmação cairia no
  // reconciliador (atraso de até 10 min) ou numa chave que não é da loja.
  // Bloquear a OFERTA/criação do PIX na origem é mais honesto do que vender
  // um PIX que confirma tarde.
  //
  // `terminal: true`: cadastrar a chave é conserto de DIAS (painel do MP →
  // cadastro na tela Ajustes), não de minutos — o cliente não fica em loop
  // de "Tentar de novo" num PIX que não vai nascer. A flag
  // `pixSemChaveDeAssinatura` é um MARCADOR para o front (tela do Gabriel):
  // HOJE nenhum código em src/ a lê — o comprador vê o texto de operador
  // acima na caixa terminal genérica do CHECKOUT-050 (sem loop, sem oferta
  // de trocar para cartão). Quando a tela do lojista orientar o comprador,
  // ela decide consumir a flag — nunca comparação de texto (mesmo contrato
  // de sempre).
  // C2 (02/10/2026): `metodo === "pix"`, não `!dadosCartao` — a consulta
  // `verificar` (sem cartão e sem PIX) não passa por esta trava (desenho A1,
  // 4.3): loja sem chave de webhook ainda precisa resolver um cartão em dúvida.
  if (metodo === "pix") {
    if (credenciaisMp.origem !== "lojista" || !credenciaisMp.segredoWebhook) {
      // Só origem e motivo em log — nenhum segredo, jamais.
      console.error(
        `criar-pagamento: PIX recusado — loja sem chave de assinatura do webhook cadastrada (origem: ${credenciaisMp.origem}, motivo: ${credenciaisMp.motivo ?? "sem_chave_de_assinatura"})`,
      );
      return json({
        error:
          "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.",
        terminal: true,
        pixSemChaveDeAssinatura: true,
      }, 409);
    }
  }
  // S2 (travas onde a cobrança nasce, 04/10/2026): o CARTÃO do LOJISTA sem a
  // chave de assinatura do webhook para no MESMO 409 terminal do PIX —
  // decisão do dono de 30/09/2026 (pagamento pelo app só com as 3 chaves
  // cadastradas). O caso é mais restrito que o
  // do PIX, de propósito: loja nas chaves da PLATAFORMA (`origem` diferente
  // de "lojista") continua cobrando cartão como sempre — a regra é sobre o
  // cadastro que a loja fez pela metade, não sobre quem ainda não cadastrou.
  // Flag própria, mesmo contrato da `pixSemChaveDeAssinatura` (marcador para
  // o front, nunca texto).
  //
  // ONDE ela vale (revisão externa do S2, 04/10/2026): SÓ onde a decisão já é
  // CRIAR cobrança nova ou TROCAR a forma (POST ou cancelamento no MP) — nunca
  // aqui em cima, antes de ler o pedido. A outra aba que já tem um cartão
  // vivo, em análise ou em desafio 3DS tem de continuar recebendo o MESMO
  // estado pela consulta (GET), sem POST e sem ouvir que a cobrança acabou; o
  // sentinela sem desfecho continua no acompanhamento de sempre. Os três
  // pontos de uso: o portão do cartão (vaga livre), a troca PIX→cartão ANTES
  // de cancelar o PIX, e a liberação da vaga morta ANTES de liberar.
  // `verificar` nunca passa por nenhum deles.
  const cartaoSemChaveDeAssinatura = metodo === "cartao" && credenciaisMp.origem === "lojista" &&
    !credenciaisMp.segredoWebhook;
  const respostaCartaoSemChaveDeAssinatura = () => {
    // Só origem e motivo em log — nenhum segredo, jamais.
    console.error(
      `criar-pagamento: cartão recusado — loja sem chave de assinatura do webhook cadastrada (origem: ${credenciaisMp.origem}, motivo: ${credenciaisMp.motivo ?? "sem_chave_de_assinatura"})`,
    );
    return json({
      error:
        "Para pagar com cartão, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.",
      terminal: true,
      cartaoSemChaveDeAssinatura: true,
    }, 409);
  };

  // `let`, não `const` (Fase 3.5): quando a vaga ocupada é liberada, o
  // pedido é RELIDO (tentativas novas) e o resto do handler cobra a partir
  // da releitura.
  const { data: pedidoLido, error } = await supabase
    .from("marketplace_orders")
    .select(COLUNAS_DO_PEDIDO)
    .eq("id", body.orderId)
    .maybeSingle();
  let pedido = pedidoLido;

  // CHECKOUT-050 (#194), achado da revisão: `error` truthy é FALHA DE
  // LEITURA — statement timeout, pool esgotado, fetch caindo — nunca
  // "pedido não existe". Verificado no postgrest-js instalado: zero linhas
  // devolve `{data: null, error: null}`, então `error` truthy só acontece
  // quando a leitura em si falhou. Recuperável, com status e mensagem
  // PRÓPRIOS: reaproveitar "Pedido não encontrado." (e seu `terminal: true`)
  // aqui matava um pedido vivo por um soluço passageiro do banco — o
  // cliente perdia o "Tentar de novo" e o pedido morria no pg_cron 20
  // minutos depois. Mensagem própria também não vaza quais ids existem: a
  // falha de leitura acontece igual para id existente e inexistente.
  if (error) {
    console.error("criar-pagamento: falha ao ler pedido", body.orderId, error);
    return json({ error: "Não foi possível verificar o pedido." }, 503);
  }

  // Mensagem igual para "não existe" e "não é seu": responder diferente
  // transformaria esta função em oráculo de quais ids existem.
  //
  // CHECKOUT-050 (#194): os dois 404 abaixo são PERMANENTES. Se a sessão do
  // cliente cai no meio dos 30 minutos de reserva, `subDoToken` devolve
  // `null`, `donoConfere` reprova, e o mesmo 404 se repete para sempre — sem
  // `terminal`, "Tentar de novo" nunca teria efeito nenhum.
  if (!pedido) return json({ error: "Pedido não encontrado.", terminal: true }, 404);

  const sub = subDoToken(req.headers.get("Authorization"));
  if (!donoConfere(pedido, sub)) {
    return json({ error: "Pedido não encontrado.", terminal: true }, 404);
  }

  // C2 (02/10/2026): a consulta `verificar` entra DEPOIS do dono e ANTES de
  // `podeCobrar` (vale depois do prazo, dentro das 24 h da 20261186) e de
  // qualquer leitura de config do cartão. Convidado: a mesma trava do cartão
  // (pagamento online exige conta; o cartão nunca nasce sem conta).
  if (metodo === "verificar") {
    if (pedido.user_id === null) return respostaExigeConta();
    return await verificarVagaDoPedido({
      supabase,
      mpToken,
      fetchImpl: deps.fetchImpl,
      pedido: pedido as Record<string, unknown>,
      json,
      respostaIndisponivel,
    });
  }

  const decisao = podeCobrar(pedido, new Date());
  // CHECKOUT-050 (#194): os três ramos de "recusar" de podeCobrar são
  // permanentes PARA ESTE PEDIDO. `terminal: true` é DADO, não texto: antes
  // disso o front reconhecia só a mensagem exata de prazo vencido, e assim
  // que o pg_cron (a cada 5 min) marca o pedido 'expirado', a MESMA reserva
  // morta passa a cair no ramo 1 (payment_status !== 'aguardando') com uma
  // mensagem que o front nunca soube reconhecer — o cliente ganhava "Tentar
  // de novo" para uma recusa que nunca muda. A releitura pós-UPDATE-falho,
  // mais abaixo, tem seu próprio ramo 'expirado' — mesma categoria, mesmo
  // campo — porque é a MESMA condição vista por um caminho diferente.
  if (decisao.acao === "recusar") {
    return json({ error: decisao.motivo, terminal: true }, 409);
  }

  // Portão do CARTÃO (Fase 3.5), ANTES de qualquer coisa na vaga: se o
  // pedido tem um PIX aberto e o cliente pede cartão, o PIX é CANCELADO no MP
  // mais abaixo — cancelar e só DEPOIS descobrir que o cartão não podia ser
  // cobrado deixaria o cliente sem cobrança nenhuma na mão.
  //
  // 1. Convidado não paga online (P6) — a mesma trava que o PIX aplica na
  //    criação, aqui adiantada porque o cartão mexe na vaga antes de criar.
  // 2. A loja precisa ter ligado ESTA forma (crédito ou débito). Linha
  //    ausente, erro de leitura ou forma desligada: 409 recuperável — o
  //    cliente continua podendo pagar com PIX; nada foi tocado.
  // 3. Crédito acima do teto de parcelas da loja: 400 recuperável — o Brick
  //    já limita, isto é a defesa do servidor.
  if (dadosCartao) {
    if (pedido.user_id === null) return respostaExigeConta();
    // S2: vaga LIVRE — a única saída daqui é um POST novo.
    if (cartaoSemChaveDeAssinatura && decisao.acao === "criar") return respostaCartaoSemChaveDeAssinatura();
    const configCartao = await lerConfigDoCartao(supabase);
    const formaLigada = configCartao !== null &&
      (dadosCartao.paymentTypeId === "credit_card" ? configCartao.credito : configCartao.debito);
    if (!formaLigada) {
      return json(
        { error: "Esta forma de pagamento não está disponível nesta loja.", codigo: "CARTAO_FORMA_DESLIGADA" },
        409,
      );
    }
    if (dadosCartao.parcelas > configCartao.parcelasMax) {
      return json({ error: "Esse parcelamento não está disponível nesta loja." }, 400);
    }
  }

  // O valor que a gravação final da vaga tem que ENCONTRAR para poder
  // escrever: `null` até a reserva do cartão (mais abaixo) gravar o
  // sentinela DESTA chamada. C3 (veredito A2, achado H1d, 02/10/2026): a
  // reconsulta nunca mais o preenche com um sentinela pré-existente — o
  // re-POST sobre ele foi removido (ver o ramo do sentinela, abaixo).
  let vagaEsperadaNaGravacao: string | null = null;

  if (decisao.acao === "reconsultar") {
    // Aqui é onde a tela recupera o MESMO QR sem criar uma segunda cobrança
    // — nenhum UPDATE, porque nada mudou no pedido, só a consulta. MEDIDO em
    // 14/08/2026 contra a API real: o GET /v1/orders/{id} devolve o QR
    // idêntico ao da criação, então este ramo basta. (Dizia "o QR só existe
    // na resposta da CRIAÇÃO" — era suposição, e a medição a derrubou.)
    //
    // Fase 3.5: o cartão também chega aqui. O que decide é a COBRANÇA QUE
    // OCUPA A VAGA, lida no MP (nunca o que o pedido "acha" que ela é):
    //   (a) paga → 'pago', sem cobrança nova;
    //   (b) cartão recusado/cancelado/expirado → libera a vaga e cria a nova;
    //   (c) pedido de cartão com PIX aberto → cancela o PIX no MP, libera e
    //       cria o cartão (cancelamento negado → 409 recuperável);
    //   (d) cartão em análise/3DS e pedido de cartão → devolve o estado atual
    //       (com o desafio 3DS, se houver) — NUNCA uma segunda cobrança;
    //   (e) PIX aberto e pedido de PIX → o MESMO QR, como sempre;
    //   (f) cartão em 3DS (`action_required`/`created`) e pedido de PIX →
    //       cancela o cartão no MP, libera e cria o PIX (Achado A2, 26/09/
    //       2026); cartão `processing` (sem desafio pendente, o MP não
    //       cancela) ou cancelamento negado → 409 recuperável, como antes.
    //
    // Correção pós-revisão (BLOQUEIO 3, achado de revisão da Tarefa 3):
    // discrimina pela FORMA do `gateway_payment_id` (`idEhClassico`,
    // `_shared/mercadopago.ts`), não pelo código de erro HTTP que a Orders
    // API devolvia. A versão anterior deste comentário afirmava que "o
    // Orders API nunca reconhece esse id e devolve 404, SEMPRE, para todo
    // pedido legado" — o MP não devolve 404 para um id sem forma de order:
    // devolve 400 `invalid_path_param` ("must begin with the prefix
    // 'ORD'..."); 404 só existe quando a FORMA já é de order, mas a order
    // não existe. Um id clássico (numérico) nunca tem forma de order, então
    // batia 400, nunca 404 — o fallback nunca disparava de verdade: o
    // cliente legado que perdia a aba e voltava recebia 502 (não o 404 que
    // o comentário antigo previa), e "Tentar de novo" repetia o mesmo 502
    // até o pg_cron expirar o pedido em 30 min. Decidir pela forma, como o
    // `webhook-mercadopago` já fazia, não depende de o MP manter essa
    // taxonomia de erro — e poupa a chamada à Orders API para todo pedido
    // legado, que nunca vai ser reconhecido por ela.
    let idGatewayReconsulta = String(pedido.gateway_payment_id);

    // Achado B2 (2ª revisão de risco, 26/09/2026): a vaga pode estar ocupada
    // por um SENTINELA (`vagaEmVerificacao`, acima) — um cartão cuja
    // resposta do MP veio 409 `idempotency_key_already_used`. Não é um id de
    // verdade: não existe endpoint para reconsultar "por chave de
    // idempotência" na Orders API — por isso `resolverVagaEmVerificacao`,
    // acima, busca as ORDERS do pedido em vez de tentar reconsultar a chave.
    // QUALQUER forma pedida aqui — cartão novo OU PIX — enquanto o sentinela
    // não é resolvido devolve o MESMO "aguardando" sem tocar o MP: um cartão
    // novo abriria uma SEGUNDA cobrança ambígua; um PIX pagaria por fora
    // enquanto a primeira ainda pode cair aprovada.
    let sentinelaNaVaga = vagaEmVerificacao(idGatewayReconsulta);
    // Ponto 1 (4ª revisão de risco, 26/09/2026): só um sentinela RESOLVIDO
    // PARA LIBERAR (todas as orders de cartão encontradas estão mortas) pula
    // direto para a liberação comum ("Daqui para baixo chegam (b), (c)...",
    // abaixo) SEM passar pelo bloco de reconsulta por id — `idGatewayReconsulta`
    // continua sendo a STRING do sentinela nesse caso (`liberarCobranca`
    // solta pela MESMA string que está gravada). Um sentinela resolvido para
    // um id REAL (aprovado ou ainda vivo) troca `idGatewayReconsulta` pelo
    // id de verdade e ENTRA no bloco de reconsulta — os ramos (a)/(d)/(f) já
    // sabem tratar um cartão vivo ou aprovado encontrado por id.
    let sentinelaResolvidoParaLiberar = false;
    if (sentinelaNaVaga) {
      const resolucao = await resolverVagaEmVerificacao({
        token: mpToken,
        pedidoId: pedido.id,
        desde: String(pedido.created_at ?? ""),
        idSentinela: idGatewayReconsulta,
        fetchImpl: deps.fetchImpl,
      });
      if (resolucao.ok && resolucao.order === null) {
        // Revisão de risco de 30/09/2026 (MENOR 1 da 3ª rodada): um sentinela
        // com a chave de uma tentativa ANTERIOR (`c<n>` com a tentativa atual
        // já em `n+1`, ver IMPORTANTE 1 mais abaixo) nunca libera pela
        // busca. O limite inferior dele é o instante da tentativa n, e a
        // janela pode trazer só a order MORTA de uma tentativa POSTERIOR
        // enquanto a `c<n>` ambígua ainda não foi indexada — liberar aqui
        // levaria a um POST com chave nova e a duas capturas. Só a adoção
        // (order viva/aprovada) ou `expires_at` resolvem esse sentinela.
        if (sentinelaDaChave(idGatewayReconsulta, await chaveDeIdempotencia(pedido, "cartao"))) {
          sentinelaResolvidoParaLiberar = true;
        } else {
          console.warn(
            "criar-pagamento: busca mandaria liberar um sentinela de chave anterior — mantido até adoção ou expiração",
            { orderId: pedido.id },
          );
        }
      } else if (resolucao.ok && resolucao.order !== null && orderMortaPeloPar(resolucao.order)) {
        // Revisão do C2 (02/10/2026, bloqueio): order MORTA devolvida com uma
        // de status desconhecido ao lado (`orderMortaPeloPar`) — não adota e
        // não libera. `sentinelaNaVaga` continua `true` e o bloco do C3, logo
        // abaixo, responde `sem_registro` (cartão) ou `cartaoEmAnalise` (PIX):
        // ZERO POST.
        console.warn(
          "criar-pagamento: busca devolveu order morta com status desconhecido ao lado — sentinela mantido, nenhum POST",
          { orderId: pedido.id },
        );
      } else if (
        resolucao.ok && resolucao.order !== null && estornadaComIrmaNaoMorta(resolucao.order, resolucao.ordens)
      ) {
        // P7: order ESTORNADA com uma irmã não-morta ao lado
        // (`estornadaComIrmaNaoMorta`) — não adota e não libera; o bloco do
        // C3, logo abaixo, responde `sem_registro` (cartão) ou
        // `cartaoEmAnalise` (PIX): ZERO POST.
        console.warn(
          "criar-pagamento: busca devolveu order estornada com irmã não-morta ao lado — sentinela mantido, nenhum POST",
          { orderId: pedido.id },
        );
      } else if (resolucao.ok && resolucao.order !== null) {
        // Achado S3 (3ª revisão de risco, 26/09/2026): grava `metodo_online`/
        // `parcelas` JUNTO do id real — a partir daqui a vaga deixa de estar
        // "null/sentinela", a condição que a ADOÇÃO do webhook
        // (`webhook-mercadopago/index.ts`) exige para gravar os dois; sem
        // isto aqui, trocar o sentinela por um id real apagaria a ÚNICA
        // chance de o comprovante/Financeiro saberem que é cartão.
        const ordemResolvida = resolucao.order;
        const idResolvido = String(ordemResolvida.id ?? "");
        if (idResolvido.length > 0) {
          // C2 (02/10/2026): o MESMO CAS que o `verificar` usa
          // (`adotarOrderNoSentinela`) — uma cópia só.
          const {
            metodoResolvido,
            gravou: gravouResolucao,
            erro: erroGravarResolucao,
          } = await adotarOrderNoSentinela(supabase, pedido.id, idGatewayReconsulta, ordemResolvida);
          if (erroGravarResolucao) {
            console.error(
              "criar-pagamento: falha ao gravar a order resolvida do sentinela (Ponto 1)",
              pedido.id,
              erroGravarResolucao,
            );
            return json({ error: "Não foi possível verificar o pedido." }, 503);
          }
          if (gravouResolucao) {
            idGatewayReconsulta = idResolvido;
            // Achado #4a (8ª rodada de risco, 26/09/2026): mantém `pedido.
            // metodo_online` (em MEMÓRIA) sincronizado com o que ACABOU de
            // gravar. O resto do handler decide por ESTE campo — a falha da
            // reconsulta por id, logo abaixo, escolhe a flag `cartaoEm
            // Analise` por ele. Sem isto, `pedido` continuava com o valor
            // lido no INÍCIO da chamada (sempre `null` para quem chega
            // aqui, antes de o sentinela resolver) — uma falha na
            // reconsulta por id de um cartão que ACABOU de se provar vivo
            // saía sem a flag, e um cliente com cartão em análise via
            // "Cancelar pedido" quando não devia.
            pedido = { ...pedido, metodo_online: metodoResolvido };
          } else {
            // Perdeu a corrida (o webhook resolveu ao mesmo tempo, por
            // exemplo) — relê o estado REAL, mesmo padrão do resto do
            // handler: nunca inventa causa. `metodo_online` (resto do
            // achado #4, 8ª rodada de risco, revisão de risco da 9ª rodada,
            // 26/09/2026, prova R8-4): o VENCEDOR da corrida (o webhook)
            // grava o método/parcelas de verdade — sem reler aqui, `pedido.
            // metodo_online` continuava o valor de ANTES de resolver (quase
            // sempre `null`), e uma reconsulta por id que falhasse logo
            // abaixo (`consultarOrder`) saía sem `cartaoEmAnalise` mesmo com
            // um cartão vivo recém-adotado na vaga.
            const { data: relido } = await supabase
              .from("marketplace_orders")
              .select("gateway_payment_id, metodo_online")
              .eq("id", pedido.id)
              .maybeSingle();
            const relidoObj = relido as Record<string, unknown> | null;
            if (relidoObj) {
              const idRelido = relidoObj.gateway_payment_id;
              if (typeof idRelido === "string") idGatewayReconsulta = idRelido;
              pedido = { ...pedido, metodo_online: relidoObj.metodo_online };
            }
          }
        }
        sentinelaNaVaga = vagaEmVerificacao(idGatewayReconsulta);
      }
      // `resolucao.ok === false` (busca falhou, corpo ilegível, ou nenhuma
      // order de cartão encontrada ainda): não muda nada — `sentinelaNaVaga`
      // continua `true`, `sentinelaResolvidoParaLiberar` continua `false`.

      // C3 (veredito A2 do revisor financeiro, item 1 — achado H1d,
      // 02/10/2026): sentinela que a busca não resolveu NUNCA leva a um POST
      // — nem PIX nem cartão. O antigo re-POST "carimbado" (mesma chave,
      // token novo) contava com o MP reter a chave e devolver 409 para corpo
      // diferente; a doc online da Orders API não promete janela nenhuma de
      // retenção. Se o MP já esqueceu a chave, o token novo virava uma
      // SEGUNDA cobrança válida ao lado da 1ª (duas capturas). Custo aceito
      // pelo revisor: a 1ª chamada que nunca chegou ao MP (zero orders) deixa
      // o pedido em `sem_registro` até o admin agir ou o cancelamento
      // automático da 20261186 — nunca libera por busca vazia.
      if (sentinelaNaVaga && !sentinelaResolvidoParaLiberar) {
        if (metodo === "pix") {
          // Achado B3 (revisão do checkout front, 26/09/2026): `cartaoEmAnalise`
          // diz ao FRONT que este 409 não é "erro recuperável comum" — é uma
          // cobrança de cartão ainda EM ANÁLISE, sem desfecho, e a tela não
          // pode oferecer "Cancelar pedido" aqui: se o cliente cancelar e o
          // banco aprovar depois, ele paga por um pedido cancelado. Mensagem,
          // status e `terminal` continuam os mesmos — só um campo A MAIS.
          return json(
            { error: "Há um pagamento com cartão em análise para este pedido.", cartaoEmAnalise: true },
            409,
          );
        }
        // Cartão: o contrato `verificacao` do desenho A1 (4.2) — o mesmo que
        // o modo `verificar` (C2) e o front reutilizam. Nada de
        // `statusPagamento: "aguardando"`: sem order confirmada, "em análise
        // pelo banco" seria promessa falsa. Vale também para o sentinela de
        // uma chave ANTERIOR (revisão de 30/09, IMPORTANTE 1: recriar com a
        // chave atual não deduplica contra a `c<n>` ambígua).
        if (!resolucao.ok && resolucao.buscaFalhou) {
          console.warn(
            "criar-pagamento: cartão sobre sentinela com a busca do MP falhando — nenhum POST",
            { orderId: pedido.id },
          );
          return respostaIndisponivel();
        }
        console.warn(
          "criar-pagamento: cartão sobre sentinela sem desfecho na busca — nenhum POST, sem_registro",
          { orderId: pedido.id, chaveAtual: sentinelaDaChave(idGatewayReconsulta, await chaveDeIdempotencia(pedido, "cartao")) },
        );
        return json(corpoSemRegistro(pedido.expires_at), 200);
      }
    }

    // Um sentinela RESOLVIDO PARA LIBERAR (`sentinelaResolvidoParaLiberar`,
    // acima) cai direto na liberação de "Daqui para baixo chegam (b),
    // (c)...", mais abaixo — nada aqui embaixo sabe reconsultar um sentinela
    // pela Orders API (não é um id de order de verdade, e não existe
    // endpoint de consulta por chave de idempotência).
    if (!sentinelaNaVaga) {
    if (idEhClassico(idGatewayReconsulta)) {
      // Pedido criado ANTES da migração para a Orders API — vai DIRETO para
      // o endpoint clássico (GET /v1/payments/{id}), sem gastar uma consulta
      // na Orders API que nunca vai reconhecer este id.
      const classico = await consultarPagamento({
        token: mpToken,
        paymentId: idGatewayReconsulta,
        fetchImpl: deps.fetchImpl,
      });
      if (!classico.ok) return json({ error: classico.erro }, 502);

      // Fase 3.5: cobrança clássica é sempre PIX legado — e ela não se
      // cancela pela Orders API. Pedido de CARTÃO com um PIX legado ainda
      // não pago na vaga não troca de forma (nunca duas cobranças vivas); a
      // resposta com QR de PIX também não serve para a tela do cartão. Na
      // prática inalcançável (id clássico é de antes de agosto/2026, e a
      // reserva vive 30 min), mas fechado, não aberto.
      const statusClassico = mapearStatus(classico.status) ?? classico.status;
      if (metodo === "cartao" && statusClassico !== "pago") {
        return json({ error: "Não foi possível trocar para cartão agora. Tente de novo em instantes." }, 409);
      }

      return json(
        {
          paymentId: classico.id,
          // CHECKOUT-080 (#213): antes desta tarefa isto devolvia
          // `classico.status` CRU, sem tradução nenhuma — o front agora só
          // conhece o conjunto fechado do banco ('aguardando'/'pago'/
          // 'recusado'/'expirado'/'estornado'), então um pedido com cobrança
          // LEGADA (id clássico, numérico) cairia em terminal para todo
          // status que não fosse cru-igual a um valor do banco por
          // coincidência de nome. `mapearStatus` é o MESMO tradutor que
          // `webhook-mercadopago`/`reconciliar-pagamentos` já usam para o
          // vocabulário clássico — `?? classico.status` é só a rede de
          // segurança para um status que nem esse mapa conhece (nunca um
          // palpite: o front trata como desconhecido e recusa fechado).
          statusPagamento: statusClassico,
          expiraEm: pedido.expires_at,
          qrCode: classico.qrCode,
          qrCodeBase64: classico.qrCodeBase64,
          ticketUrl: classico.ticketUrl,
        },
        200,
      );
    }

    // `gateway_payment_id` é um id de ORDER (prefixo ORD/ORDTST) — a
    // reconsulta é GET /v1/orders/{id} (`consultarOrder`), não GET
    // /v1/payments/{id}.
    // N1 (3ª revisão de risco, 26/09/2026): a vaga reconsultada aqui pode ser
    // de CARTÃO (payer com e-mail e CPF do titular) — `corpoNoLog: false`
    // troca o corpo cru por um resumo sem dado pessoal no log de erro,
    // mesma proteção que os outros pontos do cartão já usam.
    const r = await consultarOrder({
      token: mpToken,
      orderId: idGatewayReconsulta,
      fetchImpl: deps.fetchImpl,
      corpoNoLog: false,
    });
    // Achado da 6ª rodada (revisão do checkout front, 26/09/2026), ESCOPO
    // corrigido na 7ª (achado R6-P5b do 6º revisor): `idGatewayReconsulta` já
    // é um id REAL de order (passou pelo `if (sentinelaNaVaga)`/`idEhClassico`,
    // acima), e esta falha (rede/timeout/5xx) não deixa SABER se ela está
    // morta — mas `pedido.metodo_online` (gravado na criação, `COLUNAS_DO_
    // PEDIDO`) já diz se é cartão OU PIX, sem precisar da reconsulta. Antes,
    // a flag ia para QUALQUER falha aqui — um cliente SÓ-PIX (cartão
    // desligado) via "Seu cartão está em análise" e perdia "Cancelar
    // pedido" para uma reconsulta de PIX que nem tem cartão nenhum. Só
    // credito/debito levam a flag.
    if (!r.ok) {
      // Sem chaves aninhadas no literal — o teste "cartaoEmAnalise: true
      // aparece só..." (mais abaixo no arquivo de teste) enumera por regex
      // todo `json({...}, status)` e não entende objeto aninhado.
      if (pedido.metodo_online === "credito" || pedido.metodo_online === "debito") {
        return json({ error: r.erro, cartaoEmAnalise: true }, 502);
      }
      return json({ error: r.erro }, 502);
    }

    const orderNaVaga = r.order as Record<string, unknown>;
    const statusNaVaga = mapearStatusOrder(
      String(orderNaVaga.status ?? ""),
      String(orderNaVaga.status_detail ?? ""),
    );
    const statusCruNaVaga = `${String(orderNaVaga.status ?? "")}:${String(orderNaVaga.status_detail ?? "")}`;
    const tipoNaVaga = tipoDoPagamentoDaOrder(orderNaVaga);
    // PIX = `bank_transfer`, o tipo que o próprio `montarCorpoPixOrders`
    // manda e o MP devolve. Tipo ausente NÃO é tratado como PIX: no pedido
    // de cartão isso fecha (409), nunca cancela às cegas.
    const pixNaVaga = tipoNaVaga === "bank_transfer";
    const cobrancaMorta = statusNaVaga === "recusado" || statusNaVaga === "expirado";

    if (orderEhDeCartao(orderNaVaga)) {
      // (b) Cartão recusado, cancelado ou expirado (desafio 3DS abandonado):
      // a vaga é liberada logo abaixo e a nova cobrança segue — seja PIX ou
      // outro cartão. É a herança nº 2 da Fase 2 fechada: recusa não trava
      // o pedido até expirar.
      if (!cobrancaMorta) {
        const paymentIdNaVaga = String(orderNaVaga.id ?? idGatewayReconsulta);
        // (a) Já pago: nada a cobrar de novo — a tela segue; quem grava
        // 'pago' no banco é o webhook/reconciliação.
        if (statusNaVaga === "pago") {
          return json(
            { paymentId: paymentIdNaVaga, statusPagamento: "pago", expiraEm: pedido.expires_at },
            200,
          );
        }
        // (f) Pedido de PIX com um cartão ainda em análise/3DS.
        //
        // Achado A2 (revisão de risco, 26/09/2026): manter isto SEMPRE em
        // 409 prendia o cliente atrás de um desafio 3DS que ele já pode ter
        // ABANDONADO — o desafio vive ~40 min no banco emissor contra uma
        // reserva de 30 min (`expirar_pedidos_vencidos`, pg_cron a cada 5
        // min): o cliente ficava sem cartão (preso no 3DS) E sem PIX (409)
        // até a reserva morrer sozinha. A Orders API só CANCELA order em
        // `action_required`/`created` (`cancelarOrder`,
        // `_shared/mercadopago.ts`) — `processing` (em análise pelo emissor/
        // antifraude, sem desafio pendente) o MP recusa cancelar, e gastar
        // uma chamada que se sabe de antemão que vai falhar não ajuda
        // ninguém: esse continua 409, sem tentar cancelar.
        //
        // Cancelável: MESMA manobra do ramo (c), duas linhas abaixo —
        // cancela o cartão no MP e cai para a liberação da vaga, que cria o
        // PIX pedido. Cancelamento negado (desafio resolvido no meio do
        // caminho, rede, 5xx): 409, a vaga fica como está — o próximo
        // "Tentar de novo" relê e decide de novo pelo estado real.
        if (metodo === "pix" && (statusNaVaga === "aguardando" || statusNaVaga === null)) {
          const statusBrutoNaVaga = String(orderNaVaga.status ?? "");
          const cartaoCancelavelParaPix =
            statusBrutoNaVaga === "action_required" || statusBrutoNaVaga === "created";
          let cartaoCanceladoParaPix = false;
          if (cartaoCancelavelParaPix) {
            const cancelamento3ds = await cancelarOrder({
              token: mpToken,
              orderId: idGatewayReconsulta,
              chaveIdempotencia: `cancelar:${idGatewayReconsulta}`,
              fetchImpl: deps.fetchImpl,
            });
            cartaoCanceladoParaPix = cancelamento3ds.ok && orderCancelada(cancelamento3ds.order);
            if (!cartaoCanceladoParaPix) {
              console.warn(
                "criar-pagamento: MP não cancelou o cartão em 3DS na troca para PIX",
                idGatewayReconsulta,
                cancelamento3ds.ok ? String(cancelamento3ds.order.status ?? "") : cancelamento3ds.status,
              );
            }
          }
          if (!cartaoCanceladoParaPix) {
            // Achado B3 (revisão do checkout front, 26/09/2026): mesmo campo
            // `cartaoEmAnalise` do outro 409 idêntico, acima — o cartão
            // `processing` (sem desafio pendente, não cancelável) ou o
            // cancelamento negado (o desafio pode ter sido resolvido no meio
            // do caminho) são, os dois, "ainda sem desfecho conhecido": a
            // tela não pode oferecer "Cancelar pedido" aqui.
            return json(
              { error: "Há um pagamento com cartão em análise para este pedido.", cartaoEmAnalise: true },
              409,
            );
          }
          // Cancelado — cai para a liberação da vaga (mesmo caminho de
          // (b)/(c), logo abaixo), que cria o PIX pedido.
        } else {
          // (d) Pedido de cartão com um cartão já em análise/3DS: o estado
          // atual, com o desafio se o banco pediu — NUNCA uma segunda
          // cobrança, mesmo que o Brick tenha mandado um token novo. Par
          // desconhecido devolve o par cru, igual à reconsulta do PIX.
          //
          // Achado (adendo 2 à 8ª rodada de risco, 26/09/2026, revisão do
          // front): um par que `mapearStatusOrder` não reconhece cai aqui
          // (`statusNaVaga === null`) — o front, corretamente, trata como
          // "em análise" (nunca "morto": `mapearStatusOrder` só afirma
          // 'recusado'/'expirado' para um par CONHECIDO — ver o comentário
          // grande dela, `_shared/mercadopago.ts`). Sem um sinal para fora
          // desta function, o cliente fica preso "em análise" até a reserva
          // expirar (30-40 min), sem conseguir trocar para PIX. Loga (só
          // status/orderId, nunca dado do pagador) e avisa o admin — UMA VEZ
          // por par, `statusesCartaoDesconhecidosAvisados` acima — para um
          // humano decidir (mapear o status novo, ou confirmar à mão pelo
          // painel do MP).
          if (statusNaVaga === null) {
            console.warn(
              "criar-pagamento: status de cartão desconhecido na vaga — tratado como 'em análise', NUNCA como morto",
              { orderId: pedido.id, status: statusCruNaVaga },
            );
            const avisos = deps.statusesCartaoDesconhecidosAvisados ?? statusesCartaoDesconhecidosAvisadosReal;
            const chaveAviso = `${pedido.id}:${statusCruNaVaga}`;
            if (!avisos.has(chaveAviso)) {
              avisos.add(chaveAviso);
              const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
              await dispararSemEsperarCliente(
                alertarAdmin({
                  supabase,
                  orderId: pedido.id,
                  idOrderOrfa: idGatewayReconsulta,
                  aviso: {
                    title: "Cartão com status novo do Mercado Pago",
                    body: `${descricaoDoPedido(pedido.id)} · status "${statusCruNaVaga}" não reconhecido — confira o painel do Mercado Pago`,
                  },
                }),
                5000,
              );
            }
          }
          const urlDesafioNaVaga = extrairDesafio3ds(orderNaVaga);
          const desafio3dsNaVaga = urlDesafioNaVaga ? { url: urlDesafioNaVaga } : undefined;
          return json(
            {
              paymentId: paymentIdNaVaga,
              statusPagamento: statusNaVaga ?? statusCruNaVaga,
              expiraEm: pedido.expires_at,
              desafio3ds: desafio3dsNaVaga,
            },
            200,
          );
        }
      }
    } else if (metodo === "cartao" && statusNaVaga !== "pago") {
      // (c) Pedido de CARTÃO com um PIX (ou algo que não é cartão) na vaga.
      // Só se mexe no que se reconhece como PIX: cobrança de tipo
      // desconhecido fica como está (409 recuperável), nunca é cancelada às
      // cegas. PIX já morto (recusado/expirado/cancelado) só precisa ser
      // liberado; PIX aberto é CANCELADO no MP antes — duas cobranças vivas
      // para o mesmo pedido é o cliente pagando duas vezes.
      //
      // S2: ANTES de qualquer cancelamento — sem a chave de assinatura o
      // cartão novo é impossível, e cancelar o PIX primeiro deixaria o
      // cliente sem cobrança nenhuma na mão.
      if (cartaoSemChaveDeAssinatura) return respostaCartaoSemChaveDeAssinatura();
      if (!pixNaVaga) {
        console.warn(
          "criar-pagamento: vaga com cobrança de tipo desconhecido — troca para cartão recusada",
          idGatewayReconsulta,
          tipoNaVaga,
        );
        return json({ error: "Não foi possível trocar para cartão agora. Tente de novo em instantes." }, 409);
      }
      if (!cobrancaMorta) {
        const cancelamento = await cancelarOrder({
          token: mpToken,
          orderId: idGatewayReconsulta,
          chaveIdempotencia: `cancelar:${idGatewayReconsulta}`,
          fetchImpl: deps.fetchImpl,
        });
        // Cancelamento negado (o PIX foi pago no meio do caminho, rede,
        // 5xx) ou resposta que não diz "cancelada": a vaga fica como está.
        // O próximo "Tentar de novo" relê a vaga — se o PIX foi pago, cai no
        // ramo (a)/(e) e o cliente vê 'pago'.
        if (!cancelamento.ok || !orderCancelada(cancelamento.order)) {
          console.warn(
            "criar-pagamento: MP não cancelou o PIX na troca para cartão",
            idGatewayReconsulta,
            cancelamento.ok ? String(cancelamento.order.status ?? "") : cancelamento.status,
          );
          return json({ error: "Não foi possível trocar para cartão agora. Tente de novo em instantes." }, 409);
        }
      }
    } else {
      // (e) Pedido de PIX com PIX na vaga — ou (a) PIX já pago, para
      // qualquer forma pedida: o comportamento de sempre, o MESMO QR.
      const extraido = extrairQrCode(orderNaVaga);
      return json(
        {
          paymentId: extraido?.orderId ?? idGatewayReconsulta,
          // CHECKOUT-080 (#213): traduzido para o conjunto fechado que este
          // banco já usa ('aguardando'/'pago'/'recusado'/'expirado'/
          // 'estornado' — mapearStatusOrder, `_shared/mercadopago.ts`), não
          // mais para o vocabulário clássico do MP. Igual ao ramo de criação,
          // abaixo. Se a cobrança existente foi recusada, o cliente vê
          // 'recusado' e PagamentoOnline.tsx decide o que mostrar. Par
          // desconhecido devolve o par CRU "status:status_detail" por
          // padrão — igual a hoje — o que NÃO bate em nenhum valor do
          // conjunto fechado, e o front trata como terminal: é o desfecho
          // certo para um status que o MP inventou depois desta migração.
          statusPagamento: statusNaVaga ?? statusCruNaVaga,
          // O prazo sai da LINHA DO BANCO, igual ao ramo de criação.
          expiraEm: pedido.expires_at,
          // AUSÊNCIA (order legível, sem QR ainda) não é ERRO — extrairQrCode
          // distingue os dois; aqui só se converte null em undefined para não
          // serializar `null` explícito onde o front espera campo ausente.
          qrCode: extraido?.qrCode ?? undefined,
          qrCodeBase64: extraido?.qrCodeBase64 ?? undefined,
          ticketUrl: extraido?.ticketUrl ?? undefined,
        },
        200,
      );
    }
    } // fecha `if (!sentinelaNaVaga)` (Achado S1)

    // Achado da 7ª rodada de risco (26/09/2026, item R6-P5):
    // `vagaEsperadaNaGravacao !== null` significa que a `if` acima (sentinela
    // NÃO resolvido, metodo === "cartao") optou por RETENTAR a criação sobre
    // o PRÓPRIO sentinela, em vez de liberar — pular a liberação inteira (a
    // vaga não está morta; só não foi possível confirmar o que ela é) e
    // seguir direto para "decisao.acao === 'criar' a partir daqui", abaixo,
    // com a MESMA `pedido` (nada mudou nela) e a chave de idempotência
    // continuando a mesma (`tentativas_de_pagamento` só avança quando a vaga
    // É liberada de verdade).
    if (vagaEsperadaNaGravacao === null) {
    // Daqui para baixo chegam (b), (c) e o sentinela RESOLVIDO PARA LIBERAR
    // (Ponto 1, 4ª revisão de risco, 26/09/2026): a cobrança da vaga está
    // morta (recusada/cancelada/expirada) — para o sentinela, "morta" quer
    // dizer que a BUSCA (`resolverVagaEmVerificacao`, acima) confirmou que
    // TODAS as orders de cartão do pedido já morreram, nunca um palpite por
    // relógio — e a vaga é LIBERADA para a nova. Um convidado nunca chega
    // aqui para cobrar: o cartão parou no portão lá em cima, e o PIX para na
    // trava de criação logo abaixo — mas a liberação em si é inofensiva (a
    // RPC só solta a vaga desta cobrança/sentinela, pela MESMA string que
    // está gravada nela).
    //
    // S2: daqui o cartão só sai com um POST novo — sem a chave de assinatura,
    // recusa ANTES de liberar (a vaga fica como está; nada foi tocado).
    if (cartaoSemChaveDeAssinatura) return respostaCartaoSemChaveDeAssinatura();
    const liberacao = await liberarCobranca(supabase, pedido.id, idGatewayReconsulta);
    if (!liberacao.ok) {
      // Falha de banco: nada foi cobrado ainda, e o próximo retry reencontra
      // a cobrança morta (ou cancelada) e tenta liberar de novo.
      return json({ error: "Não foi possível liberar a cobrança anterior. Tente de novo em instantes." }, 503);
    }

    // RELEITURA: a vaga pode ter sido liberada por OUTRA porta ao mesmo tempo
    // (o webhook da própria recusa, uma segunda aba) — `liberou: false` não
    // é erro. Quem decide o próximo passo é o estado REAL, pela MESMA
    // `podeCobrar` do começo: vaga livre → cria com a tentativa nova; vaga
    // ocupada de novo → a corrida já gerou outra cobrança; pedido que deixou
    // de estar 'aguardando' → recusa definitiva, como sempre.
    const { data: pedidoRelido, error: erroReleitura } = await supabase
      .from("marketplace_orders")
      .select(COLUNAS_DO_PEDIDO)
      .eq("id", pedido.id)
      .maybeSingle();
    if (erroReleitura || !pedidoRelido) {
      console.error("criar-pagamento: falha ao reler o pedido depois de liberar a vaga", pedido.id, erroReleitura);
      return json({ error: "Não foi possível verificar o pedido." }, 503);
    }
    const decisaoDepoisDeLiberar = podeCobrar(pedidoRelido, new Date());
    if (decisaoDepoisDeLiberar.acao === "recusar") {
      return json({ error: decisaoDepoisDeLiberar.motivo, terminal: true }, 409);
    }
    if (decisaoDepoisDeLiberar.acao === "reconsultar") {
      // Achado #4b (8ª rodada de risco, 26/09/2026): a corrida encheu a vaga
      // de novo ENTRE a liberação e esta releitura — `pedidoRelido` já é a
      // FOTO fresca dela (`COLUNAS_DO_PEDIDO` inclui `metodo_online`, sem
      // reconsulta nenhuma precisar rodar). Sentinela OU cartão vivo: a
      // flag entra para o front nunca oferecer "Cancelar pedido" aqui.
      if (
        vagaEmVerificacao(pedidoRelido.gateway_payment_id) ||
        pedidoRelido.metodo_online === "credito" ||
        pedidoRelido.metodo_online === "debito"
      ) {
        return json({ error: "Este pedido já tem uma cobrança gerada.", cartaoEmAnalise: true }, 409);
      }
      return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
    }
    pedido = pedidoRelido;
    } // fecha `if (vagaEsperadaNaGravacao === null)`
  }

  // Pagamento online exige conta — decisão do Gabriel, 16/08/2026: quem paga
  // pelo site precisa acompanhar o pedido e receber a confirmação, e a RLS
  // de `marketplace_orders` é `TO authenticated` com `auth.uid() = user_id`
  // — um pedido de convidado (`user_id` NULL) nunca aparece pro próprio
  // comprador, nem depois de pago (medido em 16/08/2026 com um PIX real). A
  // trava no front (CheckoutView) já impede escolher "Pagar agora com PIX"
  // sem sessão, mas `verify_jwt` não identifica cliente (ver o comentário do
  // topo deste arquivo) — a chave anon passa por aqui igual à de um cliente
  // logado, e esta é a trava que vale de verdade.
  //
  // SÓ bloqueia CRIAÇÃO — nunca a RECONSULTA: o `if (decisao.acao ===
  // "reconsultar")` acima já devolveu antes de chegar aqui (só passa por
  // ele, desde a Fase 3.5, quem acabou de liberar a vaga para CRIAR — e
  // esse caminho precisa mesmo desta trava). Sem essa ordem,
  // um convidado com o QR na tela ANTES desta mudança que recarregasse a
  // página DEPOIS dela perderia acesso a um PIX que já pode ter pago — o
  // dinheiro entraria e nem o cliente nem a loja teriam como saber pela tela.
  if (pedido.user_id === null) return respostaExigeConta();

  // S5 (travas onde a cobrança nasce, 04/10/2026): a FORMA do pedido. Desde a
  // 20261174000000 a v24 grava 'aguardando' para QUALQUER forma que a loja
  // aceita (online e pix/card/cash na entrega) — quem garantia que só o
  // 'online' chegava aqui era o front, e uma requisição montada à mão com o
  // id de um pedido "pagar na entrega" virava cobrança online. Mesmo lugar da
  // trava de conta, e pelo mesmo motivo: SÓ a criação passa por aqui (a
  // reconsulta de uma cobrança que já existe devolveu lá em cima, e o
  // `verificar` nem chega em `podeCobrar`). Terminal: a forma do pedido não
  // muda com "Tentar de novo".
  if (pedido.payment_method !== "online") {
    console.warn("criar-pagamento: cobrança recusada — o pedido não é de pagamento online", {
      pedidoId: pedido.id,
      formaDoPedido: pedido.payment_method ?? null,
    });
    return json({ error: "Este pedido não é de pagamento online.", terminal: true }, 409);
  }

  // R8 (travas onde a cobrança nasce, 04/10/2026): pedido online de R$ 0,00.
  // A v24 calcula o total com GREATEST(0, ...) — cupom maior que a compra
  // zera o pedido —, e o montador do corpo do PIX em _shared não guarda
  // valor > 0: o MP recusava, saía 502 recuperável e o cliente ficava num
  // laço de "Tentar de novo" até a reserva vencer. Recusa ANTES de qualquer
  // chamada ao MP, para PIX e cartão, e terminal: o total do pedido não muda
  // com outra tentativa. `!(> 0)`, não `<= 0`: total ilegível (NaN) também
  // não vira cobrança.
  if (!(Number(pedido.total) > 0)) {
    console.warn("criar-pagamento: cobrança recusada — pedido online sem valor a cobrar", {
      pedidoId: pedido.id,
    });
    return json({ error: "Este pedido não tem valor a pagar online.", terminal: true }, 409);
  }

  // decisao.acao === "criar" a partir daqui.
  // LAUDO 31/08 (menor E5): o e-mail da sessão entra na corrente antes do
  // fallback genérico — o MP passa a ver quem de verdade paga.
  const email =
    (body.email as string) ??
    (pedido.customer_data as Record<string, unknown>)?.email ??
    emailDoToken(req.headers.get("Authorization")) ??
    "sem-email@ikcous.com.br";

  // Os valores que os dois caminhos (PIX e cartão, os dois pela Orders API)
  // precisam produzir para a gravação e a resposta abaixo, que são IGUAIS
  // nos dois — só a CHAMADA ao gateway diverge.
  let idGateway: string;
  let statusCru: string;
  let qrCode: string | undefined;
  let qrCodeBase64: string | undefined;
  let ticketUrl: string | undefined;
  // Realinhamento de expires_at (decisão do dono, 14/08/2026): o PIX
  // preenche isto com o vencimento REAL do QR (`expiracaoRealinhavel`).
  // Achado A2 (26/09/2026): o cartão também preenche, mas só quando a order
  // volta com desafio 3DS pendente — ver `expiracaoParaDesafio3ds`, acima.
  // `undefined` = não mexe em expires_at, que é o comportamento de hoje.
  let expiresAtNovo: string | undefined;
  // Fase 3.5: o desafio 3DS que o banco pediu (só cartão) e as duas colunas
  // que a gravação da vaga passa a carimbar — `metodo_online` diz ao
  // painel/e-mail QUAL forma online foi, `parcelas` o parcelamento do crédito.
  let desafio3ds: { url: string } | undefined;
  let metodoOnline: "pix" | "credito" | "debito";
  let parcelasGravadas: number | null;
  // Achado A1 (3) — revisão de risco 26/09/2026: SÓ cartão preenche isto, com
  // o `status` CRU da order (não o traduzido) — é o que decide, se a vaga for
  // perdida na corrida logo abaixo, se a cobrança órfã ainda dá para
  // CANCELAR (`action_required`/`created`) ou se já é dinheiro capturado que
  // só sobra avisar o admin.
  let statusBrutoDaOrderCriada: string | undefined;

  // 401/403 do POST /v1/orders (incidente 25/09/2026, "invalid access
  // token"): o MP recusou a CREDENCIAL da loja, não este pedido. Mesma escala
  // de conserto do D1 lá em cima — token revogado ou sem permissão se
  // resolve no cadastro do lojista, em horas ou dias, e "Tentar de novo"
  // dentro dos 30 min da reserva só bate na mesma recusa. `terminal: true`
  // tira o cliente do loop. A frase é fixa: o corpo do MP (conta, detalhe da
  // credencial) continua só no log de criarOrder. Vale igual para PIX e
  // cartão (uma resposta só, as duas chamam daqui).
  const respostaCredencialRecusada = (status: number) => {
    console.error(
      `criar-pagamento: Mercado Pago recusou a credencial da loja (status: ${status}, origem: ${credenciaisMp.origem})`,
    );
    return json({ error: MENSAGEM_CREDENCIAL_RECUSADA, terminal: true }, 503);
  };

  // BLOQUEIO 1 da revisão (CHECKOUT-070): a detecção de ambiente pelo
  // PREFIXO do MP_ACCESS_TOKEN ("TEST-") era NÃO-DISCRIMINANTE — medido
  // contra o painel do MP que a aplicação criada escolhendo "API de
  // Orders" dá um Access Token de TESTE com prefixo "APP_USR" (75 chars),
  // igual ao de produção. A heurística por prefixo era `false` em TODO
  // ambiente da Orders API, e o e-mail real do cliente sempre ia para o
  // MP em sandbox → 400 invalid_email_for_sandbox → 502 sem `terminal` →
  // "Tentar de novo" que erra igual, para sempre. Nenhum PIX de teste
  // ficava criável.
  //
  // Ambiente é CONFIGURAÇÃO, não dedução do formato da credencial —
  // nenhum formato de credencial do MP carrega isso de forma confiável.
  // MP_SANDBOX_PAYER_EMAIL é explícita e opcional: presente, usa esse
  // e-mail como pagador (sandbox); ausente, usa o e-mail real do cliente
  // (produção). Quem configura declara o ambiente, ninguém adivinha.
  // `|| undefined` (não `??`): achado da revisão — a MESMA variável era
  // lida com duas semânticas de vazio a 5 linhas de distância. Aqui era
  // truthy ("" contava como AUSENTE, não ligava 'APRO'); em `email:` logo
  // abaixo era nullish ("" contava como PRESENTE, `?? String(email)` não
  // trocava por nada) — e o resultado era `payer.email: ""`, o e-mail REAL
  // do cliente descartado em toda venda PIX. Realista porque, mesmo
  // documentada (DEPLOYMENT.md §5.2), quem quiser DESLIGAR o sandbox pelo
  // painel do Supabase pode limpar o campo em vez de apagar o secret — e
  // limpar produz "". Com `|| undefined` as duas leituras concordam: "" é
  // ausente, igual a nunca ter sido definida.
  // `.trim()`: achado da revisão seguinte, mesma família — "   ", "\t" e
  // "email@testuser.com\n" são todos truthy e sobreviviam ao `|| undefined`
  // de cima. O e-mail real do cliente era descartado do mesmo jeito, só
  // que o lixo (não uma string vazia) ia para `payer.email`.
  const emailPagadorSandbox = Deno.env.get("MP_SANDBOX_PAYER_EMAIL")?.trim() || undefined;
  // 'APRO' é o valor mágico que a doc oficial de teste de PIX exige
  // (checkout-api-orders/integration-test/pix, context7, 13/08/2026) para
  // a order de TESTE responder como esperado. montarCorpoPixOrders já
  // aceita `nome` desde a Tarefa 1 — só ninguém ligava o parâmetro.
  //
  // Fase 3.5: o e-mail de sandbox vale para o CARTÃO também (a regra do
  // e-mail de teste é da Orders API, não do PIX); o 'APRO' em `first_name`
  // fica só no PIX — no cartão, o desfecho de teste é escolhido pelo nome do
  // TITULAR digitado no formulário do Brick, e forçar o pagador aqui
  // misturaria as duas coisas.
  const nomePagadorSandbox = emailPagadorSandbox ? "APRO" : undefined;
  if (emailPagadorSandbox) {
    // ANOTADO 1 da revisão: sem log, ligar esta variável num deploy de
    // PRODUÇÃO troca o e-mail do cliente em SILÊNCIO — nada quebra alto,
    // só fica errado (e-mail real nunca chega ao MP, 'APRO' vira o
    // primeiro nome nos registros do gateway). O gatilho real é o
    // primeiro clone que copiar env de um deploy de desenvolvimento.
    console.warn(
      `criar-pagamento: MP_SANDBOX_PAYER_EMAIL definida — e-mail do pagador substituído por "${emailPagadorSandbox}" (ambiente de sandbox).`,
    );
  }

  if (metodo === "pix") {
    // "PT30M": mínimo aceito pelo MP, e o valor que casa com a reserva de
    // estoque de 30 minutos (20260807000000_reserva_com_expiracao.sql) — ver
    // o comentário grande de montarCorpoPixOrders. `deps.expiracaoPix` só
    // existe para teste (ver comentário de `deps` acima); em produção é
    // sempre "PT30M".
    //
    // UMA VARIÁVEL SÓ (Achado 1 da revisão do realinhamento, 14/08/2026): o
    // mesmo valor alimenta `montarCorpoPixOrders` (abaixo, o que é mandado ao
    // MP) E `expiracaoRealinhavel` (mais abaixo, a janela sã que decide se o
    // realinhamento é aceito). Antes, os dois liam o "30" de lugares
    // diferentes que não se falavam — mudar só a literal aqui deixava a
    // janela presa no valor antigo e o realinhamento morria em silêncio.
    const expiracaoPix = deps.expiracaoPix ?? "PT30M";

    let corpo: Record<string, unknown>;
    try {
      corpo = montarCorpoPixOrders({
        orderId: pedido.id,
        valor: Number(pedido.total),
        email: emailPagadorSandbox ?? String(email),
        nome: nomePagadorSandbox,
        expiracao: expiracaoPix,
        documento: body.documento as { type: string; number: string } | undefined,
      });
    } catch (err) {
      // montarCorpoPixOrders LANÇA se a expiração faltar ou for inválida.
      // Ela nasce de uma constante controlada por ESTE arquivo — um throw
      // aqui só acontece por bug de configuração deste servidor, nunca por
      // entrada do cliente (mesma categoria de "Pagamento indisponível."
      // abaixo). Sem este catch o throw escaparia inteiro do handler e
      // viraria 500 cru — o comentário desta função já avisava que "nenhum
      // caminho aqui pode rejeitar", e isso deixou de ser verdade com a
      // Orders API. Recuperável: nada foi cobrado nem gravado ainda.
      console.error("criar-pagamento: montarCorpoPixOrders rejeitou", err);
      return json({ error: "Não foi possível gerar a cobrança." }, 502);
    }

    let r = await criarOrder({
      token: mpToken,
      corpo,
      // Chave POR TENTATIVA (Fase 3.5, `chaveDeIdempotencia`): na tentativa
      // 0 é o id do pedido, byte a byte a de sempre — um retry do front
      // sobre o MESMO pedido não cria uma segunda cobrança no MP; depois de
      // uma vaga liberada, a chave muda e o MP cria a cobrança nova em vez
      // de devolver a morta.
      chaveIdempotencia: await chaveDeIdempotencia(pedido, "pix"),
      fetchImpl: deps.fetchImpl,
      // R9 (04/10/2026): o corpo da recusa do MP traz `data.payer` (e-mail
      // e CPF do pagador) — no log, só o resumo sem dado pessoal, igual ao
      // cartão. O `corpoDoErro` continua voltando no resultado (o 409 de
      // idempotência, logo abaixo, decide por ele).
      corpoNoLog: false,
    });
    if (!r.ok) {
      // 401/403: credencial da loja (`respostaCredencialRecusada`, acima).
      // Qualquer outro status (0 = rede, 5xx, 4xx de corpo) segue 502
      // recuperável, como sempre foi — MENOS o 409 de idempotência, tratado
      // logo abaixo (o `let` acima existe para isto).
      if (r.status === 401 || r.status === 403) return respostaCredencialRecusada(r.status);
      // Frente 7 (29/09/2026): 409 `idempotency_key_already_used` — a
      // PRIMEIRA chamada com esta chave criou a order PIX e a resposta se
      // perdeu (ou o retry veio com corpo divergente: cliente editou o
      // documento). A order está VIVA no MP; este retry não pode criar
      // outra, e devolver 502 em loop deixava o cliente sem QR até
      // `expires_at` (era o comportamento). Recupera a order pela busca e a
      // devolve como resposta — MESMO QR, UMA order viva (o `let` permite
      // trocar o `r` falho pelo recuperado e seguir o fluxo normal de
      // gravar a vaga com o id dela). Sem order PIX viva na busca: cai no
      // 502 de sempre, sem liberar a tentativa — ver o comentário do helper
      // `recuperarOrderPixDoIdempotencia`.
      if (r.status === 409 && idempotencyKeyJaUsado(r.corpoDoErro)) {
        r = await recuperarOrderPixDoIdempotencia({
          token: mpToken,
          pedidoId: String(pedido.id),
          desde: String(pedido.created_at ?? ""),
          fetchImpl: deps.fetchImpl,
        });
      }
      if (!r.ok) return json({ error: r.erro }, 502);
    }

    const extraido = extrairQrCode(r.order);
    if (!extraido?.orderId) {
      // Defensivo: criarOrder já garante `id` presente numa resposta 2xx, e
      // isto só dispararia se a ORDER em si viesse ilegível — praticamente
      // inalcançável, mas sem esta guarda um formato inesperado gravaria
      // gateway_payment_id = "null" (String(null)) em vez de recusar.
      console.error("criar-pagamento: order sem id utilizável", JSON.stringify(r.order));
      return json({ error: "Resposta inválida do gateway." }, 502);
    }

    idGateway = extraido.orderId;
    // gateway_payment_id = o id da ORDER (prefixo ORD), NUNCA o do pagamento
    // (extraido.paymentId, prefixo PAY) — a Orders API não expõe reconsulta
    // por id de pagamento; quem sobrevive e se reconsulta é a order (ver
    // consultarOrder, e o comentário de extrairQrCode em
    // _shared/mercadopago.ts).
    //
    // BLOQUEIO 2 da revisão (CHECKOUT-070), vocabulário atualizado na
    // CHECKOUT-080 (#213): default `"aguardando"` SÓ neste ramo (o de
    // reconsulta continua com o default cru, ver acima). O MP acabou de
    // responder 201 — a cobrança EXISTE e tem QR. O default cru deste
    // arquivo (o par "status:status_detail") não bate em nenhum valor do
    // conjunto fechado que PagamentoOnline.tsx conhece, e ela trata QUALQUER
    // status desconhecido como terminal ("Não foi possível confirmar o
    // pagamento."). Devolver isso aqui prenderia o cliente com um QR válido
    // na mão e nenhum jeito de tentar de novo — exatamente o problema que
    // esta migração existe para resolver, reintroduzido. 'aguardando' é o
    // default honesto: o pedido fica 'aguardando' no banco de qualquer
    // jeito, e quem decide a verdade depois é o webhook/reconciliação
    // (Tarefas 3-4), não esta resposta.
    statusCru = mapearStatusOrder(
      String((r.order as Record<string, unknown>).status ?? ""),
      String((r.order as Record<string, unknown>).status_detail ?? ""),
    ) ?? "aguardando";
    qrCode = extraido.qrCode ?? undefined;
    qrCodeBase64 = extraido.qrCodeBase64 ?? undefined;
    ticketUrl = extraido.ticketUrl ?? undefined;

    // Realinhamento de expires_at (decisão do dono, 14/08/2026) — ver o
    // comentário grande de expiracaoRealinhavel, acima. Não `now() + 30min`
    // calculado aqui: o relógio desta function não é o relógio do MP, e a
    // divergência produziria de novo o desalinhamento que isto conserta.
    const dataExpiracaoBruta = extrairDataExpiracaoOrder(r.order);
    // `expiracaoPix`: a MESMA variável usada para montar o corpo mandado ao
    // MP, poucas linhas acima — é o que faz a janela sã acompanhar o prazo
    // real, em vez de um "30" congelado aqui (ver o comentário grande de
    // expiracaoRealinhavel).
    const dataRealinhada = expiracaoRealinhavel(dataExpiracaoBruta, new Date(), expiracaoPix);
    if (dataRealinhada) {
      expiresAtNovo = dataRealinhada.toISOString();
    } else {
      // Cobre os três casos de recusa (ausente, não-parseável, fora da
      // janela sã) com o MESMO log — quem lê o log distingue pelo valor
      // impresso. `expires_at` continua com o comportamento de hoje.
      //
      // Ressalva da revisão (14/08/2026): a janela sã é DERIVADA de
      // `expiracaoPix` (comentário grande de `expiracaoRealinhavel`, acima),
      // então a frase que a explica também precisa ser — um "30-35 min"
      // hardcoded aqui ficaria mentindo assim que `expiracaoPix` mudasse
      // (ex.: "PT45M" vira janela de 50 min, e o log continuaria acusando
      // "fora de 30-35" para uma data que foi ACEITA). `tetoMinutos` usa o
      // MESMO parser (`minutosDaExpiracaoPix`) e a MESMA margem
      // (`MARGEM_LATENCIA_MINUTOS_PIX`) que `expiracaoRealinhavel` usou para
      // decidir — nunca uma segunda conta que possa divergir da primeira.
      const tetoMinutosPix = minutosDaExpiracaoPix(expiracaoPix);
      const janelaSa =
        tetoMinutosPix === null
          ? "indeterminada — expiracaoPix não é uma duração válida"
          : `até ${tetoMinutosPix + MARGEM_LATENCIA_MINUTOS_PIX} min a partir de agora`;
      console.warn(
        "criar-pagamento: date_of_expiration não realinhou expires_at " +
          `(ausente, não-parseável, no passado, ou fora da janela sã: ${janelaSa}) — ` +
          `valor recebido: ${JSON.stringify(dataExpiracaoBruta)}`,
      );
    }
    metodoOnline = "pix";
    // `null` de propósito: se uma tentativa anterior de CRÉDITO ocupou e
    // soltou a vaga, as parcelas dela não podem sobrar grudadas num PIX.
    parcelasGravadas = null;
  } else {
    // CARTÃO (Fase 3.5) — Orders API, a MESMA do PIX. `dadosCartao` já foi
    // validado no começo do handler e o portão (conta, forma ligada, teto de
    // parcelas) já passou antes de a vaga ser tocada.
    const dados = dadosCartao as DadosDoCartao;
    // BLINDAGEM (02/10/2026): `true` quando o sentinela na vaga foi gravado
    // por ESTA chamada (reserva antes do POST, mais abaixo). Só ele pode ser
    // solto por um desfecho que prova "nada criado por esta chave" (400/401/
    // 403/4xx definitivo): um sentinela PRÉ-EXISTENTE (retry) guarda a
    // ambiguidade de uma chamada anterior, e essa regra continua a de antes.
    let sentinelaDestaChamada = false;
    const soltarReservaDestaChamada = async () => {
      if (sentinelaDestaChamada) await liberarCobranca(supabase, pedido.id, vagaEsperadaNaGravacao);
    };

    // Recusa de cartão: a vaga nunca foi ocupada por ESTA cobrança — a RPC
    // solta pelo valor que REALMENTE está na vaga agora
    // (`vagaEsperadaNaGravacao`: `null` no fluxo normal; o SENTINELA quando
    // isto é um retry sobre ele, achado da 7ª rodada — `liberar_cobranca_do_
    // pedido` só soma a tentativa quando o valor bate, então soltar com
    // `null` de propósito numa vaga que ainda guarda o sentinela nunca
    // avançaria a tentativa, e o sentinela ficaria preso mesmo com a recusa
    // CONFIRMADA agora). A resposta é 200 com o motivo: não é erro do
    // sistema, é o banco dizendo não, e o cliente segue com outro cartão ou
    // PIX na MESMA reserva. NUNCA chega a `confirmar_pagamento`, cujo ramo
    // 'recusado' cancela o pedido e devolve o estoque. Falha da RPC não muda
    // a resposta: a recusa é verdade de qualquer jeito, e a próxima
    // tentativa tem token novo (chave nova).
    //
    // BLOQUEIO (achado #3, 8ª rodada de risco, 26/09/2026): quando isto é um
    // RETRY sobre um sentinela JÁ existente (`vagaEsperadaNaGravacao !==
    // null` — a c0 ambígua da tentativa ANTERIOR pode estar viva por baixo),
    // só é seguro soltar a vaga quando o MP de fato CRIOU uma order agora
    // (`ordemCriada`: 201 recusada na hora, ou 402) — a criação em si prova
    // que a Orders API tratou esta chave como livre (o contrato de
    // idempotência não deixaria criar duas orders pela MESMA chave), então
    // não existe mais ambiguidade nenhuma sobre a c0. Um 400 (a Orders API
    // recusou a REQUISIÇÃO, sem criar nada) NÃO prova nada sobre a c0 — se o
    // MP valida o corpo ANTES de olhar a idempotência (não verificado em
    // produção), o 400 pode vir com a c0 ainda viva, e soltar a vaga aqui
    // abriria espaço para um PIX (ou outro cartão) virar uma SEGUNDA
    // cobrança quando a c0 aprovar depois (achado R7-V). Sem soltar, o
    // sentinela intacto continua bloqueando até a busca (Ponto 1/B1)
    // resolver de verdade — a resposta ao cliente é a MESMA recusa.
    const respostaRecusaDoCartao = async (motivo: string, ordemCriada: boolean) => {
      if (vagaEsperadaNaGravacao === null || sentinelaDestaChamada || ordemCriada) {
        await liberarCobranca(supabase, pedido.id, vagaEsperadaNaGravacao);
      }
      return json(
        {
          paymentId: null,
          statusPagamento: "recusado",
          motivoRecusa: motivo,
          podeTentarDeNovo: true,
          expiraEm: pedido.expires_at,
        },
        200,
      );
    };

    // A AMBIGUIDADE do cartão — DOIS motivos de chegar aqui:
    //   1. Achado B2 (2ª revisão de risco) — a Orders API respondeu 409
    //      `idempotency_key_already_used`: a MESMA chave, um corpo DIFERENTE
    //      (o Brick nunca reusa token). A cobrança da chamada ANTERIOR com
    //      esta chave PODE estar aprovada, sem id para reconsultar.
    //   2. Achado da 6ª rodada — a PRÓPRIA criação terminou em rede/timeout/
    //      5xx/408/409 sem código: o MP pode ter processado a order antes de a
    //      resposta se perder.
    // BLINDAGEM (02/10/2026): o SENTINELA já ocupa a vaga desde ANTES do POST
    // (reserva durável, mais abaixo) — nada a gravar aqui, e por isso não
    // existe mais o caminho em que a gravação pós-POST falhava e o cartão
    // ambíguo ficava sem registro no pedido, com um PIX de outra aba vivo
    // ao lado (o antigo `trocarPixAbertoPeloSentinela`, removido: o cartão
    // nunca chega ao POST sem possuir a vaga). O webhook (adoção, Achado
    // B2), a busca do Ponto 1/B1 e a reconciliação resolvem o sentinela;
    // sem desfecho, a reserva expira.
    //
    // Aviso ao admin (Achado S5) SÓ quando o sentinela é desta chamada — a
    // ambiguidade acabou de nascer. Retry sobre um sentinela pré-existente
    // não avisa de novo (achado #1 da 8ª rodada: nada mudou desde o aviso).
    const registrarCartaoEmVerificacao = async (motivoLog: string): Promise<void> => {
      // Rede de segurança (crítica de desenho, achado 1): confere que a vaga
      // AINDA guarda o sentinela desta CHAVE (desta chamada ou de quem
      // carimbou depois — mesma chave = mesma order no MP). Vaga LIVRE: volta
      // a ocupá-la com o carimbo desta chamada. Qualquer outra coisa — id
      // real, falha de leitura, falha em reocupar — nunca vira "registro
      // garantido": avisa o admin, nunca em silêncio.
      const chaveDaChamada = await chaveDeIdempotencia(pedido, "cartao");
      const { data: vagaAgora, error: erroVagaAgora } = await supabase
        .from("marketplace_orders")
        .select("gateway_payment_id")
        .eq("id", pedido.id)
        .maybeSingle();
      const idNaVaga = (vagaAgora as Record<string, unknown> | null)?.gateway_payment_id ?? null;
      let registroGarantido = !erroVagaAgora && sentinelaDaChave(idNaVaga, chaveDaChamada);
      // Id REAL na vaga (revisões do coordenador, 02/10/2026): NUNCA prova o
      // registro desta tentativa. A order do MP não carrega a chave de
      // idempotência, então nem "cartão deste MESMO pedido" distingue a order
      // desta chave (adotada pela notificação) de um cartão de OUTRA
      // tentativa (`c1` depois de o sentinela `c0` ter sido solto) que agora
      // esconde esta, ambígua. A consulta só escolhe QUAL alerta sai: cartão
      // do mesmo pedido pede conferência de cobrança em dobro; PIX rival, id
      // alheio, id clássico ou consulta que falhou, "sem registro".
      let cartaoDoMesmoPedidoNaVaga = false;
      if (
        !erroVagaAgora && typeof idNaVaga === "string" && idNaVaga.length > 0 &&
        !vagaEmVerificacao(idNaVaga) && !idEhClassico(idNaVaga) && mpToken
      ) {
        const consultaDaVaga = await consultarOrder({
          token: mpToken,
          orderId: idNaVaga,
          fetchImpl: deps.fetchImpl,
          corpoNoLog: false,
        });
        const ordemDaVaga = consultaDaVaga.ok ? consultaDaVaga.order as Record<string, unknown> : null;
        cartaoDoMesmoPedidoNaVaga = ordemDaVaga !== null && orderEhDeCartao(ordemDaVaga) &&
          String(ordemDaVaga.external_reference ?? "") === pedido.id;
      }
      if (!erroVagaAgora && idNaVaga === null) {
        // Revisão financeira (02/10/2026, achado 1): só reocupa se a vaga foi
        // anulada SEM a tentativa avançar. Quem solta pela RPC
        // (`liberar_cobranca_do_pedido`, por prova da busca/notificação) soma
        // a tentativa — ressuscitar ali o sentinela da chave ANTIGA prendia o
        // pedido sem cobrança viva até a expiração (o PIX ficava bloqueado e a
        // busca nunca solta sentinela de chave anterior). Perdeu: alerta
        // conservador abaixo, nunca trava.
        const tentativaDaChamada = Number(pedido.tentativas_de_pagamento);
        const { data: reocupou } = await supabase
          .from("marketplace_orders")
          .update({ gateway_payment_id: vagaEsperadaNaGravacao })
          .eq("id", pedido.id)
          .eq("payment_status", "aguardando")
          .neq("status", "cancelled")
          .eq(
            "tentativas_de_pagamento",
            Number.isInteger(tentativaDaChamada) && tentativaDaChamada >= 0 ? tentativaDaChamada : 0,
          )
          .is("gateway_payment_id", null)
          .select("id")
          .maybeSingle();
        registroGarantido = Boolean(reocupou);
      }
      if (!registroGarantido) {
        console.error(
          "criar-pagamento: cartão ambíguo sem registro desta chave na vaga — conferir no painel do MP",
          { orderId: pedido.id, idNaVaga, cartaoDoMesmoPedidoNaVaga, erro: erroVagaAgora },
        );
        const alertarSemRegistro = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
        await dispararSemEsperarCliente(
          alertarSemRegistro({
            supabase,
            orderId: pedido.id,
            idOrderOrfa: String(vagaEsperadaNaGravacao),
            aviso: cartaoDoMesmoPedidoNaVaga
              ? {
                title: "Cartão em verificação — conferir cobrança em dobro",
                body: `${descricaoDoPedido(pedido.id)} · o pedido já tem um cartão registrado; confira no painel do Mercado Pago se esta outra tentativa também foi cobrada`,
              }
              : {
                title: "Cartão em verificação sem registro no pedido",
                body: `${descricaoDoPedido(pedido.id)} · confira no painel do Mercado Pago se o cartão foi cobrado`,
              },
          }),
          5000,
        );
        return;
      }
      if (!sentinelaDestaChamada) return;
      console.error(
        `criar-pagamento: cartao_em_verificacao — ${motivoLog}; a cobrança desta tentativa PODE ter sido aprovada`,
        { orderId: pedido.id, vagaOcupada: true },
      );
      // S5(b) (4ª revisão de risco): título/corpo PRÓPRIOS, nunca "Cobrança
      // de cartão sem registro" — o sentinela pode se resolver sozinho.
      // `dispararSemEsperarCliente`: com `EdgeRuntime.waitUntil` o push segue
      // depois da resposta; sem ele (runner de teste), espera até 5 s.
      const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
      const avisoSentinela = alertarAdmin({
        supabase,
        orderId: pedido.id,
        idOrderOrfa: String(vagaEsperadaNaGravacao),
        aviso: {
          title: "Cartão em verificação — pode se resolver sozinho",
          body: `${descricaoDoPedido(pedido.id)} · confira o painel do Mercado Pago se persistir`,
        },
      });
      await dispararSemEsperarCliente(avisoSentinela, 5000);
    };

    // A resposta ao cliente é a MESMA que um cartão em análise já usa
    // (`statusPagamento: "aguardando"`, sem `desafio3ds`) —
    // `PagamentoComCartao.tsx` já trata isso como "em análise pelo banco",
    // sem oferecer novo cartão nem PIX.
    const respostaCartaoEmVerificacao = async () => {
      await registrarCartaoEmVerificacao(
        "409 idempotency_key_already_used (chave repetida com corpo diferente)",
      );
      return json(
        { paymentId: null, statusPagamento: "aguardando", expiraEm: pedido.expires_at },
        200,
      );
    };

    // Achado da 6ª rodada de achados de risco (26/09/2026, revisão do
    // checkout front): a criação em si (rede, timeout ou 5xx — ver o `!r.ok`
    // mais abaixo) respondia 502 SEM tocar a vaga, como se nada tivesse sido
    // cobrado. O MP pode ter processado a order antes de a resposta se
    // perder — o revisor reproduziu duas cobranças VIVAS ao mesmo tempo
    // (`credit_card:processed` + `bank_transfer:action_required`) quando um
    // PIX era pedido logo depois, na vaga que ficou vazia à toa. `cartao
    // EmAnalise: true` avisa o front para NUNCA oferecer PIX nem "Cancelar
    // pedido" enquanto a ambiguidade não se resolve — o MESMO contrato que
    // os outros 409 de "cartão em análise" já usam.
    const respostaCartaoAmbiguoNaCriacao = async (erroOriginal: string) => {
      await registrarCartaoEmVerificacao(
        "falha ao falar com o gateway na criação (rede/timeout/5xx) — resposta nunca confirmada",
      );
      return json({ error: erroOriginal, cartaoEmAnalise: true }, 502);
    };

    // E-mail do pagador: o primeiro VÁLIDO da mesma corrente do PIX — um
    // `customer_data.email` torto não pode travar o cartão no construtor
    // (que valida o formato); o fallback genérico fecha a corrente.
    const emailDoCartao = [
      dados.email,
      (pedido.customer_data as Record<string, unknown> | null)?.email,
      emailDoToken(req.headers.get("Authorization")),
    ].find(emailValido) ?? "sem-email@ikcous.com.br";

    // Itens, telefone e endereço do comprador para o antifraude do MP (duas
    // compras reais foram recusadas com a venda aparecendo como "Produto sem
    // nome"). MELHOR ESFORÇO por construção: três leituras à parte do SELECT
    // do pedido, com teto de tempo; erro, exceção ou demora devolvem `{}` e a
    // cobrança segue com o corpo de sempre. Nunca lança e nunca loga o dado.
    // Só o CARTÃO: o PIX não passa por aqui.
    //
    // O nome da loja para a FATURA do cartão (`statement_descriptor`) vem da
    // mesma forma — melhor esforço, com teto de tempo, `undefined` em qualquer
    // falha — e as duas leituras andam JUNTAS: o pior caso soma o MAIOR dos
    // tetos, não os dois. Só o cartão; o PIX não lê nem manda.
    const [comprador, nomeDaLojaNaFatura] = await Promise.all([
      lerDadosDoComprador(supabase, pedido),
      lerNomeNaFatura(supabase),
    ]);

    let corpo: Record<string, unknown>;
    try {
      corpo = montarCorpoCartaoOrders({
        comprador,
        nomeNaFatura: nomeDaLojaNaFatura,
        orderId: pedido.id,
        valor: Number(pedido.total),
        email: emailPagadorSandbox ?? emailDoCartao,
        // Nome do comprador no pedido -> first_name + last_name (o antifraude
        // compara com o titular). Em sandbox NÃO: o desfecho de teste do cartão
        // é o nome do titular no Brick (ver `nomePagadorSandbox`). Nome ausente
        // ou imprestável não manda nada e nunca derruba a cobrança
        // (`dividirNomeDoPagador`).
        nome: emailPagadorSandbox ? undefined : (pedido.customer_name as string | null | undefined) ?? undefined,
        documento: dados.documento,
        token: dados.token,
        paymentMethodId: dados.paymentMethodId,
        paymentTypeId: dados.paymentTypeId,
        parcelas: dados.parcelas,
      });
    } catch (err) {
      // Só o que sobra depois da validação do corpo: total do pedido
      // imprestável (≤ 0, não numérico) ou e-mail de sandbox malformado —
      // configuração/dado do servidor, não do cliente. A mensagem do
      // construtor nunca carrega token, CPF ou e-mail. Nada foi cobrado.
      console.error(
        "criar-pagamento: montarCorpoCartaoOrders rejeitou",
        err instanceof Error ? err.message : "erro desconhecido",
      );
      return json({ error: "Não foi possível gerar a cobrança." }, 502);
    }

    // BLINDAGEM (02/10/2026): RESERVA DURÁVEL ANTES DO POST. O cartão saía
    // para o MP com a vaga LIVRE e só depois tentava gravar — toda corrida
    // (PIX de outra aba gravado no meio do POST) e toda resposta perdida
    // nasciam disso, e o remendo pós-POST falhava no pior caso: cartão
    // possivelmente aprovado SEM registro no pedido, com PIX vivo ao lado.
    // Agora o SENTINELA desta tentativa (mesma chave e mesmo limite inferior
    // de sempre) ocupa a vaga ANTES do POST, com o WHERE que só ganha de
    // vaga livre num pedido ainda 'aguardando'. Quem chega depois (PIX ou
    // outro cartão) cai no sentinela da reconsulta — bloqueado até a busca,
    // o webhook ou a reconciliação convergirem na MESMA order. Sem reserva,
    // NENHUM POST: nada foi cobrado. Sobre um sentinela já existente não
    // há POST nenhum (C3, achado H1d): a reconsulta responde antes.
    if (vagaEsperadaNaGravacao === null) {
      const sentinelaDaReserva = montarSentinela(
        `${await chaveDeIdempotencia(pedido, "cartao")}:${carimboDoPost()}`,
        limiteInferiorDaTentativa(pedido),
      );
      // O WHERE é um CAS sobre TUDO que a decisão de criar leu do pedido:
      // vaga livre, 'aguardando', não cancelado pelo cliente (o cancelamento
      // grava `status` e deixa `payment_status`), e a MESMA tentativa — se
      // outra aba soltou uma vaga e somou a tentativa depois da nossa
      // leitura, a chave `c<n>` desta chamada já é velha, e um POST com ela
      // nasceria preso num sentinela de chave anterior (que a busca nunca
      // libera). Perdeu qualquer um: nenhum POST, e o retry relê tudo.
      const tentativaLida = Number(pedido.tentativas_de_pagamento);
      const { data: reservou, error: erroReserva } = await supabase
        .from("marketplace_orders")
        .update({
          // Só a vaga: o sentinela nunca carimba forma nem parcelas (Achado
          // S3) — quem grava a forma é a gravação final ou a adoção.
          gateway_payment_id: sentinelaDaReserva,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pedido.id)
        .eq("payment_status", "aguardando")
        .neq("status", "cancelled")
        .eq("tentativas_de_pagamento", Number.isInteger(tentativaLida) && tentativaLida >= 0 ? tentativaLida : 0)
        .is("gateway_payment_id", null)
        .select("id")
        .maybeSingle();
      if (erroReserva) {
        console.error(
          "criar-pagamento: falha ao reservar a vaga antes do POST do cartão — nada foi enviado ao MP",
          { orderId: pedido.id, erro: erroReserva },
        );
        return json({ error: "Não foi possível iniciar o pagamento. Tente de novo em instantes." }, 503);
      }
      if (!reservou) {
        // Outra aba ocupou a vaga (ou o pedido saiu de 'aguardando') entre a
        // leitura e a reserva. Nada foi ao MP: a resposta segue a da corrida
        // perdida, pelo estado REAL relido — o retry converge pela reconsulta.
        const { data: ocupante } = await supabase
          .from("marketplace_orders")
          .select("payment_status, gateway_payment_id, metodo_online, status, expires_at")
          .eq("id", pedido.id)
          .maybeSingle();
        const ocupanteObj = (ocupante as Record<string, unknown> | null) ?? null;
        if (ocupanteObj) {
          const decisaoOcupante = podeCobrar(
            ocupanteObj as Parameters<typeof podeCobrar>[0],
            new Date(),
          );
          if (decisaoOcupante.acao === "recusar") {
            return json({ error: decisaoOcupante.motivo, terminal: true }, 409);
          }
        }
        if (
          vagaEmVerificacao(ocupanteObj?.gateway_payment_id) ||
          ocupanteObj?.metodo_online === "credito" ||
          ocupanteObj?.metodo_online === "debito"
        ) {
          return json({ error: "Este pedido já tem uma cobrança gerada.", cartaoEmAnalise: true }, 409);
        }
        // Vaga ainda LIVRE: a reserva perdeu só pela foto velha — outra aba
        // avançou a tentativa (recusa/liberação) entre a leitura e a reserva.
        // Não existe cobrança nenhuma; dizer "já tem cobrança" seria mentira.
        // O retry relê a tentativa atual e reserva com a chave nova.
        if (ocupanteObj && (ocupanteObj.gateway_payment_id ?? null) === null) {
          return json({ error: "O pagamento deste pedido mudou em outra aba. Tente de novo." }, 409);
        }
        return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
      }
      vagaEsperadaNaGravacao = sentinelaDaReserva;
      sentinelaDestaChamada = true;
    } else {
      // C3 (veredito A2, item 1 — achado H1d, 02/10/2026): inalcançável. O
      // re-POST "carimbado" sobre o sentinela foi removido — a reconsulta,
      // acima, responde `sem_registro`/`indisponivel` sem POST e nunca
      // preenche `vagaEsperadaNaGravacao`. Fica como trava: sem a reserva
      // desta chamada, NENHUM POST.
      return json({ error: "Há um pagamento com cartão em análise para este pedido.", cartaoEmAnalise: true }, 409);
    }

    // `criarOrderDeCartao`: a MESMA chamada de `criarOrder`, com UMA repetição
    // sem os campos OPCIONAIS de antifraude quando o MP responde 400 de
    // validação apontando SÓ para eles (03/10/2026: `items[0].external_code`
    // derrubou o cartão inteiro). Chave de idempotência nova na repetição,
    // nunca em timeout/5xx/402/409/423 — tudo em `_shared/order-cartao-
    // repeticao.ts`. O que esta function faz com o desfecho da repetição é
    // exatamente o que fazia com o da primeira chamada: o resultado
    // devolvido é o da ÚLTIMA chamada, e a reserva da vaga cobre as duas.
    const r = await criarOrderDeCartao({
      token: mpToken,
      corpo,
      chaveIdempotencia: await chaveDeIdempotencia(pedido, "cartao", dados.token),
      fetchImpl: deps.fetchImpl,
      // Device ID do comprador -> `X-meli-session-id` (só no cartão; o PIX não).
      deviceId: dados.deviceId,
      // O corpo da recusa traz o pagador (e-mail, CPF): no log, só o resumo.
      corpoNoLog: false,
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        // Credencial recusada: o MP não processou nada desta chave — a
        // reserva desta chamada sai, para o pedido não ficar preso.
        await soltarReservaDestaChamada();
        return respostaCredencialRecusada(r.status);
      }
      // 409 (Achado B2, 2ª revisão de risco, 26/09/2026): ver o comentário
      // grande de `respostaCartaoEmVerificacao`, acima.
      if (r.status === 409 && idempotencyKeyJaUsado(r.corpoDoErro)) {
        return await respostaCartaoEmVerificacao();
      }
      // 402: o MP processou e RECUSOU o pagamento (a order recusada vem no
      // corpo do erro, com o motivo) — `ordemCriada: true` (achado #3, 8ª
      // rodada de risco): a Orders API só devolve 402 depois de CRIAR a
      // order (é ela que vem no corpo do erro), então soltar aqui é seguro
      // mesmo sobre um sentinela.
      if (r.status === 402) return await respostaRecusaDoCartao(motivoDaRecusaDoErro(r.corpoDoErro), true);
      // 400 (Achado A4, revisão de risco 26/09/2026): NEM todo 400 da Orders
      // API é sobre o dado do cartão — a doc de erros também lista causas
      // como `total_amount` que não bate com a soma dos pagamentos, ou o
      // `order_id` do path malformado (ver o comentário grande de
      // `erro400EhDeDadoDoCartao`, `_shared/mercadopago.ts`): essas são bug
      // de integração DESTE servidor, e mandar o cliente "conferir o cartão"
      // para um bug nosso é mentira, além de esconder o defeito. Só quando o
      // corpo traz um código CURADO de dado do cartão (token vencido/já
      // usado, corpo do cartão malformado) é que vale a mesma saída do 402:
      // o cliente corrige e tenta de novo, com um token novo. Fora disso,
      // 502 recuperável — o log já guarda os códigos sem dado pessoal
      // (`resumoSemDadoPessoal`, `corpoNoLog: false` acima).
      if (r.status === 400) {
        // BLOQUEIO (achado #3, 8ª rodada de risco, 26/09/2026):
        // `ordemCriada: false` nos dois ramos abaixo — um 400 significa que
        // a Orders API recusou a REQUISIÇÃO antes de criar qualquer coisa
        // (nenhuma order acompanha o corpo do erro, ao contrário do 402,
        // acima). Isso não é ambíguo sobre ESTA chamada (o corpo/o dado do
        // cartão é mesmo inválido), mas não prova NADA sobre uma order
        // ambígua de uma tentativa ANTERIOR que ainda pode estar viva
        // (`vagaEsperadaNaGravacao !== null`) — ver o comentário grande de
        // `respostaRecusaDoCartao`, acima.
        if (erro400EhDeDadoDoCartao(r.corpoDoErro)) {
          return await respostaRecusaDoCartao(MOTIVO_RECUSA_DADOS_DO_CARTAO, false);
        }
        // Achado R3 (2ª revisão de risco, 26/09/2026): um 400 que NÃO é
        // sobre o cartão ainda CONSOME a chave de idempotência no MP (a doc
        // não promete "só sucesso/402 conta" — um 400 pode ficar em cache do
        // mesmo jeito). Sem avançar a tentativa, o PRÓXIMO cartão (token
        // novo, MESMA chave) bateria num 409 à toa. Diferente do Achado B2:
        // um 400 NÃO é ambíguo (a Orders API recusou a REQUISIÇÃO inteira —
        // não existe order para o webhook adotar depois), então a saída
        // certa é liberar a tentativa (como uma recusa imediata), não
        // "aguarde verificação" — MAS só quando a vaga não guarda uma
        // ambiguidade ANTERIOR (`vagaEsperadaNaGravacao === null`): soltar
        // um sentinela por causa de um 400 que não prova nada sobre a order
        // que ele protege é o mesmo furo do achado #3. Falha da RPC não
        // muda a resposta: o bug de integração é verdade de qualquer jeito.
        // BLINDAGEM (02/10/2026): com a reserva antes do POST, "vaga livre"
        // virou "sentinela desta chamada" — é ele que sai aqui.
        await soltarReservaDestaChamada();
        return json({ error: r.erro }, 502);
      }
      // Achado R6-P5 (7ª revisão de risco, 26/09/2026): só REDE (status 0) e
      // 5xx são AMBÍGUOS — a Orders API pode ter processado a order antes de
      // a resposta se perder (achado da 6ª rodada, `respostaCartaoAmbiguo
      // NaCriacao`, acima), então ocupa a vaga com um SENTINELA em vez de
      // deixá-la vazia. Um 4xx DEFINITIVO que sobra até aqui (429
      // `too_many_requests`, 404, 422, ...) significa que a Orders API
      // respondeu DE VERDADE e recusou a REQUISIÇÃO inteira — nunca criou
      // nada, não é ambíguo, e tratá-lo como sentinela prendia um retry
      // LEGÍTIMO (o cliente digitando o cartão de novo) atrás de "cartão em
      // análise" até `expires_at`, mesmo com ZERO orders no MP (o 6º revisor
      // mediu isso: rede que falha ANTES de chegar ao MP e um 429 tratados
      // do mesmo jeito).
      //
      // Achado #5 (8ª rodada de risco, 26/09/2026, conservador): 408
      // (timeout DO LADO do MP) e um 409 que sobra até aqui — chegou vivo
      // porque `idempotencyKeyJaUsado`, acima, já tirou o único 409
      // CONHECIDO como definitivo (`idempotency_key_already_used`) — entram
      // como AMBÍGUOS também. Um 408 pode ser o MESMO caso do rede/5xx (o MP
      // começou a processar e não terminou a tempo); um 409 SEM o código de
      // idempotência é um formato de erro que este servidor não reconhece —
      // não dá para AFIRMAR que a requisição não criou nada, e o lado seguro
      // (nunca duas cobranças vivas) é tratar como ambíguo, mesmo pagando o
      // preço de um sentinela a mais para o Ponto 1/B1 resolver depois.
      //
      // 423 `resource_locked` (blindagem, 02/10/2026 — referência create-order
      // da Orders API e o CHANGELOG 0.1.0b2 do commerce-agents-checkout do
      // próprio MP): OUTRA requisição com a MESMA chave ainda está em
      // andamento, e ela pode já ter criado uma order pagável. Não é recusa:
      // é resultado desconhecido, então nunca solta a reserva.
      if (r.status === 0 || r.status >= 500 || r.status === 408 || r.status === 409 || r.status === 423) {
        return await respostaCartaoAmbiguoNaCriacao(r.erro);
      }
      // 4xx definitivo (429, 404, 422...): o MP respondeu e recusou a
      // REQUISIÇÃO inteira — nada criado. Sem soltar a reserva, o pedido
      // ficaria preso em "cartão em análise" sem cobrança nenhuma.
      await soltarReservaDestaChamada();
      return json({ error: r.erro }, 502);
    }

    const orderCartao = r.order as Record<string, unknown>;
    const statusCartao = mapearStatusOrder(
      String(orderCartao.status ?? ""),
      String(orderCartao.status_detail ?? ""),
    );
    // Order criada, mas já recusada (`failed`) — ou, por defesa, cancelada/
    // expirada na própria criação: mesma recusa do 402. A vaga não é
    // ocupada por uma cobrança morta. `ordemCriada: true` (achado #3, 8ª
    // rodada de risco): `r.ok` já confirmou 201 — a order EXISTE, com id.
    if (statusCartao === "recusado" || statusCartao === "expirado") {
      return await respostaRecusaDoCartao(motivoDaRecusa(orderCartao), true);
    }

    // Aprovado na hora, em análise ou esperando o desafio 3DS: a vaga é
    // OCUPADA por esta order (gravação logo abaixo, a mesma do PIX). Quem
    // escreve 'pago' continua sendo o webhook/reconciliação. Par
    // desconhecido vira 'aguardando', pelo mesmo motivo do PIX: a cobrança
    // EXISTE, e a verdade chega pelo webhook.
    idGateway = String(orderCartao.id);
    statusCru = statusCartao ?? "aguardando";
    // Achado A1 (3): o status CRU (não o mapeado) da order que ACABOU de ser
    // criada — usado só se a vaga for perdida na corrida, logo abaixo.
    statusBrutoDaOrderCriada = String(orderCartao.status ?? "");
    const urlDesafio = extrairDesafio3ds(orderCartao);
    desafio3ds = urlDesafio ? { url: urlDesafio } : undefined;
    // Achado A2 (revisão de risco, 26/09/2026): SÓ quando o banco pediu o
    // desafio 3DS — não para "em análise" sem desafio (`processing`), que a
    // spec não mede prazo nenhum de sobra — estende `expires_at` para o
    // desafio não perder a corrida contra o pg_cron. Ver o comentário grande
    // de `expiracaoParaDesafio3ds`, acima, para a fonte do teto e por que
    // corre só aqui, uma vez.
    if (desafio3ds) {
      const prazoDoDesafio = expiracaoParaDesafio3ds(
        pedido.expires_at as string | null,
        new Date(),
        pedido.created_at as string | null,
      );
      if (prazoDoDesafio) expiresAtNovo = prazoDoDesafio.toISOString();
    }
    metodoOnline = dados.paymentTypeId === "credit_card" ? "credito" : "debito";
    parcelasGravadas = dados.paymentTypeId === "credit_card" ? dados.parcelas : 1;
  }

  // Grava a cobrança. O WHERE repete a condição de podeCobrar porque entre a
  // leitura e agora o pg_cron pode ter expirado o pedido: se expirou, o
  // update não acha linha e a cobrança fica órfã no MP — que é o caso que a
  // reconciliação da Fase 3 resolve. Sobrescrever seria pior.
  //
  // Achado A1 (2) — revisão de risco, 26/09/2026, Política P1 ("pago após
  // expirar": HONRAR). Para CARTÃO, `payment_status = 'aguardando'` SAI do
  // WHERE — fica só `id` + vaga livre. A chamada ao MP leva segundos; o
  // pg_cron varre a cada 5 min — se ele expirar o pedido NO MEIO da chamada,
  // o filtro de antes fazia este UPDATE não achar linha, e a cobrança —
  // de verdade aprovada no MP — ficava ÓRFÃ: sem `gateway_payment_id`
  // gravado, a guarda (d) de `confirmar_pagamento`
  // (20260810000000_confirmar_pagamento_guarda_status.sql:52-55) reprova o
  // `p_payment_id` contra um `gateway_payment_id` NULO e devolve
  // 'divergente' — nunca 'pago_apos_expirar' — quando o webhook confirmar.
  // Gravar o id MESMO com o pedido já 'expirado' faz essa MESMA guarda casar,
  // e o ramo próprio da RPC (linhas 118-124 da mesma migration) devolve
  // 'pago_apos_expirar' — a política do dono, honrada, em vez de dinheiro
  // que entra sem registro. `expirar_pedidos_vencidos`
  // (20260807000000_reserva_com_expiracao.sql:113-117) nunca toca
  // `gateway_payment_id` (só `payment_status`/`status`), então este UPDATE
  // não risca gravar por cima de nada que o pg_cron já tenha escrito ali.
  // `liberar_cobranca_do_pedido` exige `payment_status = 'aguardando'` para
  // soltar a vaga — uma recusa que chegue DEPOIS de o pedido expirar não
  // solta mais, mas é inofensivo: `podeCobrar` já recusa QUALQUER nova
  // tentativa num pedido que não está 'aguardando', e a vaga presa num
  // pedido morto nunca mais é disputada.
  //
  // ALTERNATIVA CONSIDERADA E DESCARTADA: recusar abrir a cobrança de cartão
  // quando sobra pouco tempo de reserva (ex.: < 1 min) evitaria a corrida na
  // ORIGEM, mas trocaria um problema por outro — o cliente com o cartão na
  // mão, dentro do prazo que a TELA dele mostrava, seria barrado por uma
  // margem arbitrária que ele não vê. Honrar (P1) é a política que o dono já
  // declarou para exatamente este cenário; usá-la aqui aplica a MESMA regra,
  // não inventa uma nova.
  //
  // PIX fica byte a byte como antes: o filtro `payment_status = 'aguardando'`
  // continua no WHERE dele — um PIX que perca esta corrida cai no MESMO
  // "cobrança criada mas não gravada" de sempre, sem mudança nenhuma.
  //
  // `expires_at` só entra no SET quando o realinhamento (decisão do dono,
  // 14/08/2026, ver expiracaoRealinhavel acima) aprovou o valor do MP — sem
  // isto, TODO pedido teria a coluna tocada, mesmo quando o comportamento
  // certo é deixá-la como está.
  //
  // Fase 3.5: `metodo_online` ('pix' | 'credito' | 'debito') e `parcelas`
  // entram na MESMA gravação atômica da vaga — nunca num UPDATE separado que
  // pudesse gravar a forma de uma cobrança que perdeu a corrida.
  const valoresUpdate: Record<string, unknown> = {
    gateway_payment_id: idGateway,
    metodo_online: metodoOnline,
    parcelas: parcelasGravadas,
    updated_at: new Date().toISOString(),
  };
  if (expiresAtNovo) valoresUpdate.expires_at = expiresAtNovo;

  // Frente B (02/10/2026, auditoria "estados A"): a tentativa que gerou a
  // chave de idempotência do PIX desta chamada (`pedido` não muda entre
  // `chaveDeIdempotencia(pedido, "pix")` e aqui) — mesma normalização da
  // chave e da reserva do cartão.
  const tentativaBrutaDoPix = Number(pedido.tentativas_de_pagamento);
  const tentativaDaChavePix = Number.isInteger(tentativaBrutaDoPix) && tentativaBrutaDoPix >= 0 ? tentativaBrutaDoPix : 0;

  let updateDaVaga = supabase
    .from("marketplace_orders")
    .update(valoresUpdate)
    .eq("id", pedido.id);
  if (metodo !== "cartao") {
    // Frente B (02/10/2026, auditoria "estados A"): o PIX grava por CAS sobre
    // TUDO que a decisão de criar leu — o mesmo WHERE da reserva do cartão.
    // `status <> 'cancelled'`: o cancelamento (cliente OU admin, pela
    // `update_order_status_atomic`) grava só `status` e deixa
    // `payment_status = 'aguardando'`; sem este filtro, um cancelamento
    // durante o POST gravava o PIX e entregava QR pagável de pedido
    // cancelado. A tentativa: se `liberar_cobranca_do_pedido` avançou a
    // tentativa durante o POST, a chave desta order já é velha — gravá-la
    // poria na vaga uma cobrança de uma tentativa que o pedido abandonou.
    // Perdeu por qualquer um: o tratamento da corrida perdida, abaixo,
    // cancela este PIX no MP e o QR nunca sai.
    updateDaVaga = updateDaVaga
      .eq("payment_status", "aguardando")
      .neq("status", "cancelled")
      .eq("tentativas_de_pagamento", tentativaDaChavePix);
  }
  // Achado da 7ª rodada de risco (26/09/2026): o WHERE da vaga segue
  // `vagaEsperadaNaGravacao` — `.is(null)` no fluxo normal; `.eq(sentinela)`
  // quando esta criação é um RETRY sobre o PRÓPRIO sentinela (a vaga não
  // está livre, está OCUPADA por ele, e é exatamente essa ocupação que
  // autoriza a troca pelo id real).
  updateDaVaga = vagaEsperadaNaGravacao === null
    ? updateDaVaga.is("gateway_payment_id", null)
    : updateDaVaga.eq("gateway_payment_id", vagaEsperadaNaGravacao);
  const { data: gravado, error: erroUpdate } = await updateDaVaga
    // `expires_at` além de `id`: a resposta abaixo precisa do prazo
    // EFETIVAMENTE gravado, não do que `pedido` (lido ANTES deste UPDATE)
    // guardava em memória — sem isto a tela mostraria "Vence às HH:MM" do
    // prazo ANTIGO mesmo com o banco já realinhado ao novo. `payment_status`
    // (Achado R1, 2ª revisão de risco, 26/09/2026): só o CARTÃO precisa dele
    // — ver o bloco logo abaixo. `status` (achado A da revisão de risco da
    // migration 80, 26/09/2026 — prova W): o CANCELAMENTO do cliente grava
    // `status = 'cancelled'` sem tocar `payment_status` (fica 'aguardando')
    // — o WHERE do cartão (que não filtra por `payment_status`, Política P1)
    // grava a cobrança do mesmo jeito numa reserva cujo estoque já voltou.
    .select("id, expires_at, payment_status, status")
    .maybeSingle();

  // Achado R1 (2ª revisão de risco, 26/09/2026): o WHERE do cartão (acima)
  // não filtra por `payment_status` de propósito (Achado A1 (2), Política
  // P1) — mas isso também gravava um desafio 3DS (`action_required`/
  // `created`, NENHUM dinheiro capturado ainda) num pedido que já estava
  // 'expirado'/'cancelled' quando o UPDATE rodou: a reserva já foi devolvida
  // ao estoque, o cliente já saiu da tela, e a order fica presa viva no MP —
  // sem ninguém para completar o desafio, e cancelável de graça (nada foi
  // cobrado). P1 existe para HONRAR dinheiro que JÁ ENTROU — não para
  // reservar uma vaga para um desafio que nunca vai ser respondido. Diferença
  // do que decide: `statusBrutoDaOrderCriada` — `processed`/`processing`
  // (dinheiro capturado ou podendo capturar, a Orders API não cancela mais
  // nenhum dos dois) avisa o ADMIN (abaixo, achado A da 8ª rodada — nunca
  // silenciava antes: P1 só valia para `expirado`/relógio, nunca para um
  // CANCELAMENTO explícito do cliente); `action_required`/`created`
  // (REVERSÍVEL, nada capturado) só grava se o pedido REALMENTE estava
  // 'aguardando' no instante do UPDATE — se não estava, desfaz: cancela a
  // order no MP (o cliente nunca vai completá-la mesmo) e devolve o MESMO
  // 409 terminal que `podeCobrar` já devolve para todo pedido fora de
  // 'aguardando'.
  //
  // Achado A (revisão de risco da migration 80, 26/09/2026 — prova W): o
  // gatilho `payment_status !== "aguardando"` sozinho NUNCA via a corrida do
  // cancelamento — `update_order_status_atomic` grava `status = 'cancelled'`
  // sem mexer em `payment_status` (fica 'aguardando'). `pedidoJaMorto` junta
  // os dois sinais.
  //
  // BLOQUEIO (achado #1, revisão de risco da 9ª rodada, 26/09/2026, prova
  // R8-3a): `pedidoCancelado`, abaixo, exige `payment_status === "aguardando"`
  // JUNTO de `status === "cancelled"` — sem isso, o `expirar_pedidos_
  // vencidos` REAL (que grava os DOIS, `payment_status = 'expirado'` E
  // `status = 'cancelled'`, nunca só o primeiro) batia aqui igualzinho a um
  // cancelamento de verdade: o cliente que só teve a reserva expirada pelo
  // relógio (cartão aprovado por baixo) recebia "Seu cartão pode ter sido
  // cobrado" (409) em vez do 'pago' de sempre (Política P1), e o admin
  // levava um push falso de "cobrança sem registro" — a vaga TINHA
  // registro, só que a reserva morreu de vez enquanto o MP processava.
  // `payment_status` só fica 'aguardando' quando é o CLIENTE cancelando —
  // toda outra saída de 'aguardando' (inclusive a expiração) já muda esse
  // campo também.
  const pedidoCancelado = Boolean(
    gravado && gravado.status === "cancelled" && gravado.payment_status === "aguardando",
  );
  const pedidoJaMorto = Boolean(
    gravado && metodo === "cartao" && (gravado.payment_status !== "aguardando" || pedidoCancelado),
  );
  if (pedidoJaMorto && (statusBrutoDaOrderCriada === "action_required" || statusBrutoDaOrderCriada === "created")) {
    console.warn(
      "criar-pagamento: desafio 3DS gravado num pedido que já não estava 'aguardando' — cancelando a order (nada foi capturado) e recusando",
      {
        orderId: pedido.id,
        idOrder: idGateway,
        paymentStatusNaGravacao: gravado?.payment_status,
        statusNaGravacao: gravado?.status,
      },
    );
    const cancelamentoPorExpiracao = await cancelarOrder({
      token: mpToken,
      orderId: idGateway,
      chaveIdempotencia: `cancelar:${idGateway}`,
      fetchImpl: deps.fetchImpl,
    });
    if (!cancelamentoPorExpiracao.ok || !orderCancelada(cancelamentoPorExpiracao.order)) {
      // O MP não cancelou (raro: rede, 5xx, ou a order avançou entre a
      // gravação e agora) — nada capturado ainda, mas sem cancelamento
      // confirmado a vaga fica ocupada por uma order que ninguém vai
      // completar. Loga para o admin investigar; a resposta ao cliente
      // continua a mesma (o pedido morreu de qualquer jeito).
      console.error(
        "criar-pagamento: MP não cancelou o desafio 3DS de um pedido já morto",
        { orderId: pedido.id, idOrder: idGateway },
      );
    }
    // Achado #4 (nit, revisão de risco da 9ª rodada, 26/09/2026, prova
    // R8-3b): a mensagem distingue as duas causas — "cancelado" é verdade
    // só quando o CLIENTE cancelou; a expiração pelo relógio mantém a
    // mensagem de sempre. Nunca chave aninhada (o teste de enumeração por
    // regex não entende objeto aninhado), por isso os dois `json(...)`
    // aparecem separados.
    if (pedidoCancelado) {
      return json({ error: "Este pedido foi cancelado.", terminal: true }, 409);
    }
    return json({ error: "O prazo para pagar este pedido acabou.", terminal: true }, 409);
  }
  // Achado A (revisão de risco da migration 80, 26/09/2026 — prova W),
  // continuação: SÓ para um CANCELAMENTO explícito do cliente
  // (`pedidoCancelado`, achado #1 da 9ª rodada — NUNCA `gravado.status ===
  // "cancelled"` sozinho, que também é verdade para uma reserva apenas
  // EXPIRADA) — NUNCA para a mera expiração de `payment_status`, que a
  // Política P1 já manda HONRAR em silêncio, sem avisar ninguém (controle
  // negativo do Achado R1: "order APROVADA (processed) gravada num pedido
  // que já não estava 'aguardando' -> HONRA (P1)"). `processed`/
  // `processing`: a Orders API não cancela mais nenhum dos dois — dinheiro
  // CAPTURADO (ou podendo capturar) numa reserva que o cliente já cancelou
  // e cujo estoque já voltou. Sem como desfazer por aqui (mesma regra que
  // `cancelavel`, mais abaixo, já usa para a corrida da vaga perdida): avisa
  // o admin, mesma categoria de `cartao_orfao` — a loja decide manualmente
  // (reembolso, ou repõe o pedido).
  if (metodo === "cartao" && pedidoCancelado) {
    console.error(
      "criar-pagamento: cobrança de cartão gravada num pedido que o cliente CANCELOU durante a criação — dinheiro pode ter sido capturado",
      { orderId: pedido.id, idOrder: idGateway, status: statusBrutoDaOrderCriada },
    );
    const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
    await comTempoLimite(alertarAdmin({ supabase, orderId: pedido.id, idOrderOrfa: idGateway }), 5000);
    return json(
      {
        error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
        terminal: true,
        cartaoEmAnalise: true,
      },
      409,
    );
  }

  if (erroUpdate || !gravado) {
    console.error("criar-pagamento: cobrança criada mas não gravada", idGateway, erroUpdate);
    // A mensagem de prazo só é verdade na corrida com o pg_cron — e, com o
    // ajuste acima, só é alcançável de verdade para PIX (cartão grava mesmo
    // com o pedido já expirado). Duas abas (ou duplo submit) na MESMA janela
    // também caem aqui: as duas leituras veem gateway_payment_id null, as
    // duas chamam o MP com a mesma chave de idempotência, a primeira grava —
    // e a segunda não pode dizer "acabou o prazo" com o prazo intacto. Reler
    // o estado real distingue os dois.
    // Achado da 7ª rodada de risco (26/09/2026): `error` desta releitura
    // ficava ignorado — o efeito já era seguro (`atual` vira `undefined`, e
    // os `?.` abaixo tratam como "não sei", igual ao resto do arquivo), mas
    // o log não distinguia "banco falhou" de "reservou e é null de verdade".
    // `metodo_online` (achado #4b, 8ª rodada de risco, 26/09/2026): o 409
    // "já tem uma cobrança gerada", mais abaixo, precisa saber se o
    // OCUPANTE desta corrida é um cartão vivo — mesmo quando `metodo` desta
    // chamada é PIX (`cartaoAmbiguoAposCorrida`, abaixo, só existe para
    // `metodo === "cartao"`).
    // `status` e `tentativas_de_pagamento` (Frente B, 02/10/2026): dizem POR
    // QUE o CAS do PIX perdeu — pedido cancelado durante o POST, ou tentativa
    // avançada por outra aba (ver `pixDePedidoCanceladoNoMeio`, abaixo).
    const { data: atual, error: erroReleituraAposCorrida } = await supabase
      .from("marketplace_orders")
      .select("payment_status, gateway_payment_id, metodo_online, status, tentativas_de_pagamento")
      .eq("id", pedido.id)
      .maybeSingle();
    if (erroReleituraAposCorrida) {
      console.error(
        "criar-pagamento: falha ao reler o pedido depois de perder a corrida da vaga",
        { orderId: pedido.id, erro: erroReleituraAposCorrida },
      );
    }
    // Achado da 7ª rodada de risco (26/09/2026): rastreia se, depois desta
    // corrida, ainda pode existir uma cobrança de CARTÃO sem desfecho — só
    // quando `metodo === "cartao"` E (a releitura falhou — não dá para saber
    // o que está na vaga — OU a nossa order perdida NÃO foi cancelada no MP,
    // mais abaixo). Quando o cancelamento tem sucesso, a ambiguidade do
    // CARTÃO se fecha ali mesmo — mesmo que a vaga segure um PIX de outra
    // aba, este cliente não tem mais cartão pendente nenhum.
    let cartaoAmbiguoAposCorrida = metodo === "cartao" && Boolean(erroReleituraAposCorrida);

    // BLINDAGEM (02/10/2026): o PIX que PERDEU a vaga para OUTRA cobrança
    // (o sentinela de um cartão, ou o cartão/PIX de outra aba) nunca teve o
    // QR entregue — este handler responde 409 sem QR logo abaixo. Deixá-lo
    // vivo no MP é uma segunda cobrança pagável ao lado de um cartão que
    // pode estar aprovado: cancela (idempotente). Mesma order na vaga (duas
    // abas PIX convergindo pela chave) → nada. Vaga LIVRE (o UPDATE falhou
    // por erro de banco) → também nada: o retry com a MESMA chave devolve
    // esta MESMA order e a grava. Releitura que falhou → não sabe → nada.
    // Cancelamento negado/sem resposta: o QR nunca saiu daqui e o PIX
    // expira sozinho no prazo pedido ao MP (30 min) — fica no log com o id.
    //
    // Frente B (02/10/2026, auditoria "estados A"): duas causas a mais, as
    // duas com a vaga LIVRE (o "retry com a MESMA chave grava" de cima não
    // vale para elas):
    // - pedido CANCELADO durante o POST (`status = 'cancelled'` com
    //   `payment_status` ainda 'aguardando' — a escrita do cliente e a do
    //   admin): nenhum retry vai gravar este PIX, e vivo ele é um QR pagável
    //   de pedido cancelado. Cancela e responde 409 terminal.
    // - tentativa AVANÇADA durante o POST (`liberar_cobranca_do_pedido` de
    //   outra aba): a chave desta order é de uma tentativa abandonada — o
    //   retry usa a chave nova e nunca a reencontra. Cancela e responde
    //   409 recuperável.
    // A MESMA order já gravada na vaga (outra aba convergiu antes do
    // cancelamento) é cobrança REGISTRADA: não é desta chamada desfazer.
    const pixDePedidoCanceladoNoMeio = metodo === "pix" &&
      !erroReleituraAposCorrida &&
      atual?.payment_status === "aguardando" &&
      atual?.status === "cancelled";
    const tentativaNoBanco = Number(atual?.tentativas_de_pagamento);
    const pixDeTentativaAbandonada = metodo === "pix" &&
      !erroReleituraAposCorrida &&
      !pixDePedidoCanceladoNoMeio &&
      atual?.payment_status === "aguardando" &&
      (atual?.gateway_payment_id ?? null) === null &&
      (Number.isInteger(tentativaNoBanco) && tentativaNoBanco >= 0 ? tentativaNoBanco : 0) !== tentativaDaChavePix;
    const vagaComOutraCobranca = typeof atual?.gateway_payment_id === "string" &&
      atual.gateway_payment_id.length > 0 &&
      atual.gateway_payment_id !== idGateway;
    if (
      metodo === "pix" &&
      !erroReleituraAposCorrida &&
      (vagaComOutraCobranca ||
        ((pixDePedidoCanceladoNoMeio || pixDeTentativaAbandonada) && (atual?.gateway_payment_id ?? null) === null))
    ) {
      const cancelamentoDoPixPerdedor = await cancelarOrder({
        token: mpToken,
        orderId: idGateway,
        chaveIdempotencia: `cancelar:${idGateway}`,
        fetchImpl: deps.fetchImpl,
      });
      const causaDaPerda = pixDePedidoCanceladoNoMeio
        ? "pedido cancelado durante a criação"
        : pixDeTentativaAbandonada
        ? "tentativa avançou durante a criação"
        : "outra cobrança na vaga";
      if (cancelamentoDoPixPerdedor.ok && orderCancelada(cancelamentoDoPixPerdedor.order)) {
        console.warn(
          vagaComOutraCobranca && !pixDePedidoCanceladoNoMeio
            ? "criar-pagamento: PIX que perdeu a vaga para outra cobrança foi cancelado no MP (QR nunca entregue)"
            : `criar-pagamento: PIX que perdeu a vaga (${causaDaPerda}) foi cancelado no MP (QR nunca entregue)`,
          { orderId: pedido.id, idPixCancelado: idGateway, ocupante: atual?.gateway_payment_id ?? null },
        );
      } else {
        console.error(
          "criar-pagamento: PIX que perdeu a vaga NÃO foi cancelado no MP — QR nunca entregue, expira no prazo do MP",
          { orderId: pedido.id, idPix: idGateway, ocupante: atual?.gateway_payment_id ?? null, causa: causaDaPerda },
        );
      }
    }
    // Frente B (02/10/2026): o pedido foi cancelado (cliente ou admin)
    // enquanto o POST deste PIX estava no ar — a MESMA resposta terminal que
    // `podeCobrar` dá quando o cancelamento vem antes. QR nunca sai, com ou
    // sem o cancelamento no MP ter dado certo (a falha fica no log acima).
    if (pixDePedidoCanceladoNoMeio) {
      return json({ error: "Este pedido foi cancelado.", terminal: true }, 409);
    }
    // Frente B (02/10/2026): a tentativa avançou durante o POST e a vaga
    // está livre — a MESMA resposta recuperável da reserva do cartão que
    // perde pela tentativa: o retry relê a tentativa e cria com a chave nova.
    if (pixDeTentativaAbandonada) {
      return json({ error: "O pagamento deste pedido mudou em outra aba. Tente de novo." }, 409);
    }

    // BLINDAGEM (02/10/2026): o CARTÃO desta chamada perdeu a gravação, mas a
    // vaga ainda guarda o registro DESTA chave (o carimbo de outra aba que
    // fez retry por cima — a order é a MESMA, pela idempotência) ou ficou
    // LIVRE: adota esta order ali, por CAS, num pedido ainda 'aguardando' e
    // não cancelado — a MESMA gravação da vaga, nunca uma segunda cobrança.
    // Fora disso, segue o tratamento de corrida perdida de antes.
    if (metodo === "cartao" && !erroReleituraAposCorrida && idGateway !== (atual?.gateway_payment_id ?? null)) {
      const idOcupanteAgora =
        typeof atual?.gateway_payment_id === "string" && atual.gateway_payment_id.length > 0
          ? atual.gateway_payment_id
          : null;
      const vagaDestaChave = idOcupanteAgora === null ||
        sentinelaDaChave(idOcupanteAgora, await chaveDeIdempotencia(pedido, "cartao"));
      // A3.2 (auditoria "estados B", 02/10/2026): vaga LIVRE não prova que é
      // desta chave. Quem solta pela RPC (`liberar_cobranca_do_pedido`, por
      // recusa/morte provada na notificação) SOMA a tentativa — a order desta
      // chamada é de uma tentativa que o pedido já abandonou, e adotá-la
      // gravava uma order RECUSADA com `metodo_online` de cartão: "em
      // análise" para um cartão já recusado, sem cancelar nem pagar PIX. O
      // mesmo filtro da reserva e da rede de segurança
      // (`registrarCartaoEmVerificacao`, revisão financeira achado 1).
      const tentativaBrutaDoCartao = Number(pedido.tentativas_de_pagamento);
      const tentativaDaChaveDoCartao = Number.isInteger(tentativaBrutaDoCartao) && tentativaBrutaDoCartao >= 0
        ? tentativaBrutaDoCartao
        : 0;
      // Veredito A2 (8b): o pedido CANCELADO com a tentativa avançada também
      // entra aqui — o GET decide a resposta, e a adoção nunca roda nele.
      const tentativaAvancouComVagaLivre = (linha: Record<string, unknown> | null | undefined): boolean => {
        if (!linha || linha.payment_status !== "aguardando") return false;
        if ((linha.gateway_payment_id ?? null) !== null) return false;
        const tentativaNaLinha = Number(linha.tentativas_de_pagamento);
        return (Number.isInteger(tentativaNaLinha) && tentativaNaLinha >= 0 ? tentativaNaLinha : 0) !==
          tentativaDaChaveDoCartao;
      };
      let linhaComTentativaAvancada: Record<string, unknown> | null =
        tentativaAvancouComVagaLivre(atual as Record<string, unknown> | null)
          ? atual as Record<string, unknown>
          : null;
      if (!linhaComTentativaAvancada && vagaDestaChave && atual?.payment_status === "aguardando") {
        const valoresAdocao: Record<string, unknown> = {
          gateway_payment_id: idGateway,
          metodo_online: metodoOnline,
          parcelas: parcelasGravadas,
          updated_at: new Date().toISOString(),
        };
        if (expiresAtNovo) valoresAdocao.expires_at = expiresAtNovo;
        let adocao = supabase
          .from("marketplace_orders")
          .update(valoresAdocao)
          .eq("id", pedido.id)
          .eq("payment_status", "aguardando")
          .neq("status", "cancelled")
          // A3.2: a notificação pode soltar e somar a tentativa ENTRE a
          // releitura e este CAS — perdeu, relê abaixo.
          .eq("tentativas_de_pagamento", tentativaDaChaveDoCartao);
        adocao = idOcupanteAgora === null
          ? adocao.is("gateway_payment_id", null)
          : adocao.eq("gateway_payment_id", idOcupanteAgora);
        const { data: adotadaAgora } = await adocao.select("id, expires_at").maybeSingle();
        if (adotadaAgora) {
          console.warn(
            "criar-pagamento: cartão adotado na vaga desta mesma chave depois de perder a gravação (blindagem 02/10)",
            { orderId: pedido.id, idOrder: idGateway, ocupanteAnterior: idOcupanteAgora },
          );
          return json(
            { paymentId: idGateway, statusPagamento: statusCru, expiraEm: adotadaAgora.expires_at, desafio3ds },
            200,
          );
        }
        // A3.2: perdeu o CAS — relê para saber se foi a tentativa que avançou
        // no meio. Releitura que falha não decide nada: segue o tratamento de
        // corrida perdida de antes (conservador).
        const { data: depoisDoCas, error: erroDepoisDoCas } = await supabase
          .from("marketplace_orders")
          .select("payment_status, gateway_payment_id, status, tentativas_de_pagamento")
          .eq("id", pedido.id)
          .maybeSingle();
        if (!erroDepoisDoCas && tentativaAvancouComVagaLivre(depoisDoCas as Record<string, unknown> | null)) {
          linhaComTentativaAvancada = depoisDoCas as Record<string, unknown>;
        }
      }
      if (linhaComTentativaAvancada) {
        // A3.2: nunca solta a vaga, nunca mexe na tentativa, nunca cria order
        // nova. O GET (leitura) da order desta chamada decide; o 201 é a foto
        // de antes da notificação.
        const consultaDaOrder = await consultarOrder({
          token: mpToken,
          orderId: idGateway,
          fetchImpl: deps.fetchImpl,
          corpoNoLog: false,
        });
        const ordemConsultada = consultaDaOrder.ok && String(consultaDaOrder.order?.id ?? "") === idGateway
          ? consultaDaOrder.order as Record<string, unknown>
          : null;
        const statusConsultado = ordemConsultada
          ? mapearStatusOrder(String(ordemConsultada.status ?? ""), String(ordemConsultada.status_detail ?? ""))
          : null;
        const orderMorta = statusConsultado === "recusado" || statusConsultado === "expirado";
        // Sem registro no pedido e sem prova de morte: avisa o admin e
        // responde a MESMA coisa que `cartao_orfao`, mais abaixo — "pode ter
        // sido cobrado" é verdade para `processing`, `action_required` e
        // `processed`, e `terminal` + `cartaoEmAnalise` impedem uma segunda
        // cobrança (novo cartão ou PIX) por cima de uma que ainda pode
        // capturar.
        const respostaSemRegistro = async (motivoLog: string) => {
          console.error(
            `criar-pagamento: cartão desta chamada sem registro no pedido — ${motivoLog}`,
            { orderId: pedido.id, idOrder: idGateway, statusConsultado, consultaOk: consultaDaOrder.ok },
          );
          const alertarSemRegistro = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
          await comTempoLimite(
            alertarSemRegistro({
              supabase,
              orderId: pedido.id,
              idOrderOrfa: idGateway,
              aviso: {
                title: "Cartão em verificação sem registro no pedido",
                body: `${descricaoDoPedido(pedido.id)} · confira no painel do Mercado Pago se o cartão foi cobrado`,
              },
            }),
            5000,
          );
          return json(
            {
              error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
              terminal: true,
              cartaoEmAnalise: true,
            },
            409,
          );
        };
        // Veredito A2 (8b): pedido cancelado — nunca adota. Morta: a mesma
        // resposta terminal de `podeCobrar` para pedido cancelado, sem
        // alerta (nada foi cobrado). Viva ou desconhecida: alerta.
        if (linhaComTentativaAvancada.status === "cancelled") {
          if (orderMorta) {
            console.warn(
              "criar-pagamento: pedido cancelado e cartão recusado durante a criação — nada adotado",
              { orderId: pedido.id, idOrder: idGateway },
            );
            return json({ error: "Este pedido foi cancelado.", terminal: true }, 409);
          }
          return await respostaSemRegistro("pedido cancelado com a tentativa avançada durante a criação");
        }
        if (orderMorta) {
          // Morta no MP: a MESMA resposta da recusa do cartão, recuperável e
          // sem `cartaoEmAnalise` — a vaga já está livre (a notificação
          // soltou) e o próximo cartão sai com a chave nova.
          console.warn(
            "criar-pagamento: cartão recusado depois do 201 — a notificação já soltou a vaga e avançou a tentativa; nada adotado",
            { orderId: pedido.id, idOrder: idGateway },
          );
          return json(
            {
              paymentId: null,
              statusPagamento: "recusado",
              motivoRecusa: motivoDaRecusa(ordemConsultada),
              podeTentarDeNovo: true,
              expiraEm: pedido.expires_at,
            },
            200,
          );
        }
        // Veredito A2 (8 e 8a): VIVA pelo GET — ou o GET não provou nada, mas
        // o 201 já provou que a order existe. O registro é recuperável:
        // adota na vaga LIVRE por CAS, SEM o filtro de tentativa (ele existe
        // para não adotar order morta, e a morte já foi descartada acima).
        const valoresAdocaoVerificada: Record<string, unknown> = {
          gateway_payment_id: idGateway,
          metodo_online: metodoOnline,
          parcelas: parcelasGravadas,
          updated_at: new Date().toISOString(),
        };
        if (expiresAtNovo) valoresAdocaoVerificada.expires_at = expiresAtNovo;
        const { data: adotadaPeloGet } = await supabase
          .from("marketplace_orders")
          .update(valoresAdocaoVerificada)
          .eq("id", pedido.id)
          .eq("payment_status", "aguardando")
          .neq("status", "cancelled")
          .is("gateway_payment_id", null)
          .select("id, expires_at")
          .maybeSingle();
        if (adotadaPeloGet) {
          // Status e desafio do GET (a verdade de agora); sem GET legível,
          // os da criação.
          const urlDoDesafioConsultado = ordemConsultada ? extrairDesafio3ds(ordemConsultada) : null;
          const desafioDaResposta = ordemConsultada
            ? (urlDoDesafioConsultado ? { url: urlDoDesafioConsultado } : undefined)
            : desafio3ds;
          console.warn(
            "criar-pagamento: cartão vivo adotado na vaga livre depois de a tentativa avançar durante a criação (veredito A2)",
            { orderId: pedido.id, idOrder: idGateway, statusConsultado, consultaOk: consultaDaOrder.ok },
          );
          return json(
            {
              paymentId: idGateway,
              statusPagamento: statusConsultado ?? statusCru,
              expiraEm: adotadaPeloGet.expires_at,
              desafio3ds: desafioDaResposta,
            },
            200,
          );
        }
        // Veredito A2 (8c): perdeu o CAS (outra cobrança na vaga, ou o pedido
        // saiu de 'aguardando'/foi cancelado). Desafio 3DS CONFIRMADO pelo
        // GET (`action_required`/`created`, nada capturado): a mesma lógica
        // do ramo `cancelavel`, mais abaixo — cancela; sucesso não acorda o
        // admin. Fora disso (ou o MP não cancelou): alerta.
        const statusBrutoConsultado = ordemConsultada ? String(ordemConsultada.status ?? "") : "";
        if (statusBrutoConsultado === "action_required" || statusBrutoConsultado === "created") {
          const cancelamentoDoDesafio = await cancelarOrder({
            token: mpToken,
            orderId: idGateway,
            chaveIdempotencia: `cancelar:${idGateway}`,
            fetchImpl: deps.fetchImpl,
          });
          if (cancelamentoDoDesafio.ok && orderCancelada(cancelamentoDoDesafio.order)) {
            console.warn(
              "criar-pagamento: cartao_orfao evitado — o desafio 3DS que perdeu a vaga depois de a tentativa avançar foi cancelado no MP",
              { orderId: pedido.id, idOrderOrfa: idGateway },
            );
            return json({ error: "Não foi possível confirmar a cobrança." }, 409);
          }
          return await respostaSemRegistro("o desafio 3DS perdeu a vaga e o MP não o cancelou");
        }
        return await respostaSemRegistro("a cobrança viva perdeu a vaga depois de a tentativa avançar");
      }
    }

    // Achado A1 (3): perdeu a corrida da vaga. `atual.gateway_payment_id ===
    // idGateway` significa que a cobrança que ficou gravada é ESTA MESMA
    // (a outra chamada concorrente convergiu na mesma order — a chave de
    // idempotência por tentativa, sem o hash do token, Achado A1 (1), faz
    // isso de propósito) — nada a cancelar, nada a avisar. Só quando o
    // gravado é OUTRA cobrança (ou nenhuma) é que `idGateway` ficou órfão de
    // verdade: dinheiro que o MP pode ter aprovado sem NENHUM registro
    // apontando para ele.
    if (metodo === "cartao" && idGateway !== (atual?.gateway_payment_id ?? null)) {
      const cancelavel =
        statusBrutoDaOrderCriada === "action_required" || statusBrutoDaOrderCriada === "created";
      if (cancelavel) {
        const cancelamentoOrfao = await cancelarOrder({
          token: mpToken,
          orderId: idGateway,
          chaveIdempotencia: `cancelar:${idGateway}`,
          fetchImpl: deps.fetchImpl,
        });
        if (cancelamentoOrfao.ok && orderCancelada(cancelamentoOrfao.order)) {
          console.warn(
            "criar-pagamento: cartao_orfao evitado — a cobrança que perdeu a corrida da vaga foi cancelada no MP",
            { orderId: pedido.id, idOrderOrfa: idGateway },
          );
        } else {
          console.error(
            "criar-pagamento: cartao_orfao — perdeu a corrida da vaga e o MP não cancelou a cobrança",
            { orderId: pedido.id, idOrderOrfa: idGateway },
          );
          const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
          await comTempoLimite(alertarAdmin({ supabase, orderId: pedido.id, idOrderOrfa: idGateway }), 5000);
          // Achado da 7ª rodada de risco (26/09/2026): o MP não confirmou o
          // cancelamento — a order pode ainda virar aprovada, e a vaga
          // (ocupada por outra cobrança) não tem onde registrar isso.
          cartaoAmbiguoAposCorrida = true;
        }
      } else {
        // Aprovada (ou em qualquer estado que o MP não cancela mais): não dá
        // para desfazer o CARTÃO por aqui — dinheiro cobrado de verdade, sem
        // registro.
        //
        // Achado R2 (2ª revisão de risco, 26/09/2026): antes deste ajuste a
        // resposta caía direto no 409 recuperável logo abaixo ("Este pedido
        // já tem uma cobrança gerada") — e um "Tentar de novo" reconsultava a
        // vaga, via o ramo (c) da reconsulta (acima), achava o PIX que ganhou
        // a corrida, CANCELAVA e criava um cartão NOVO. Quem já tinha o
        // cartão aprovado (dinheiro capturado, IRREVERSÍVEL) acabava com uma
        // SEGUNDA cobrança se as duas caíssem aprovadas. Se a vaga ainda
        // segura um PIX ABERTO (não pago), a manobra certa é a INVERSA da
        // (c): cancela o PIX e ADOTA o cartão que já está aprovado na vaga —
        // nunca cria uma cobrança nova. PIX já pago (ou qualquer coisa no
        // meio do caminho que impeça o cancelamento) não tem como desfazer
        // por aqui: dinheiro dos dois lados, resposta TERMINAL explícita — um
        // retry não pode tentar de novo, só o admin decide à mão.
        const idOcupante =
          typeof atual?.gateway_payment_id === "string" && atual.gateway_payment_id.length > 0
            ? atual.gateway_payment_id
            : null;
        let vagaAdotada: { id: string; expires_at: string } | null = null;
        // Revisão de 30/09/2026 (MENOR 4): o ocupante pode ser o SENTINELA
        // desta MESMA tentativa — outra aba recebeu 409 de idempotência (ou
        // criação ambígua) enquanto este POST ainda estava em andamento e
        // gravou `verificando:<chave>:...` (desde a auditoria de 30/09, até
        // trocando um PIX aberto por ele). A chave é a mesma deste POST, então
        // a cobrança ambígua que o sentinela guarda É esta order aprovada
        // (idempotência do MP): troca o sentinela pelo id real, por comparação,
        // em vez de responder "pode ter sido cobrado" a quem pagou e avisar o
        // admin de um órfão que não existe.
        const sentinelaDestaTentativa = sentinelaDaChave(idOcupante, await chaveDeIdempotencia(pedido, "cartao"));
        if (sentinelaDestaTentativa) {
          const { data: adotado } = await supabase
            .from("marketplace_orders")
            .update({
              gateway_payment_id: idGateway,
              metodo_online: dadosCartao.paymentTypeId === "credit_card" ? "credito" : "debito",
              parcelas: dadosCartao.paymentTypeId === "credit_card" ? dadosCartao.parcelas : 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pedido.id)
            .eq("gateway_payment_id", idOcupante)
            .select("id, expires_at")
            .maybeSingle();
          vagaAdotada = adotado ?? null;
        } else if (idOcupante && !idEhClassico(idOcupante) && !vagaEmVerificacao(idOcupante)) {
          // N1 (3ª revisão de risco, 26/09/2026): o corretor achou este
          // chamador SEM `corpoNoLog: false`, ao contrário do que o relatório
          // da 2ª revisão afirmava — sem isto, um 4xx/5xx aqui logaria o
          // corpo cru do ocupante (que pode ser PIX com e-mail do pagador).
          const consultaOcupante = await consultarOrder({
            token: mpToken,
            orderId: idOcupante,
            fetchImpl: deps.fetchImpl,
            corpoNoLog: false,
          });
          if (consultaOcupante.ok) {
            const ordemOcupante = consultaOcupante.order as Record<string, unknown>;
            // Achado S2 (3ª revisão de risco, 26/09/2026): "created" NUNCA
            // acontece de verdade — o PIX recém-criado da Orders API vem
            // `action_required:waiting_transfer` (doc do MP e o próprio
            // `MAPA_STATUS_ORDER`, `_shared/mercadopago.ts:242-243`), então
            // esta adoção nunca rodava no MP real: todo PIX concorrente caía
            // no `else` de baixo (resposta terminal + aviso ao admin), mesmo
            // com o PIX ainda pagável e o cartão já aprovado. `mapearStatusOrder`
            // é o MESMO tradutor que o resto do arquivo usa — "aguardando"
            // cobre `action_required`/`processing`, qualquer par que a Orders
            // API mande para um PIX ainda não pago.
            const statusMapeadoOcupante = mapearStatusOrder(
              String(ordemOcupante.status ?? ""),
              String(ordemOcupante.status_detail ?? ""),
            );
            const pixOcupanteAberto =
              tipoDoPagamentoDaOrder(ordemOcupante) === "bank_transfer" &&
              statusMapeadoOcupante === "aguardando";
            if (pixOcupanteAberto) {
              const cancelamentoDoPix = await cancelarOrder({
                token: mpToken,
                orderId: idOcupante,
                chaveIdempotencia: `cancelar:${idOcupante}`,
                fetchImpl: deps.fetchImpl,
              });
              if (cancelamentoDoPix.ok && orderCancelada(cancelamentoDoPix.order)) {
                const { data: adotado } = await supabase
                  .from("marketplace_orders")
                  .update({
                    gateway_payment_id: idGateway,
                    // `dados` (o cast local de `dadosCartao`) só existe DENTRO
                    // do ramo de criação do cartão, lá em cima — aqui, no
                    // fallback de "não gravado", só `dadosCartao` (declarado
                    // no topo do handler) continua no escopo.
                    metodo_online: dadosCartao.paymentTypeId === "credit_card" ? "credito" : "debito",
                    parcelas: dadosCartao.paymentTypeId === "credit_card" ? dadosCartao.parcelas : 1,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", pedido.id)
                  .eq("gateway_payment_id", idOcupante)
                  .select("id, expires_at")
                  .maybeSingle();
                vagaAdotada = adotado ?? null;
              } else {
                console.warn(
                  "criar-pagamento: MP não cancelou o PIX concorrente para adotar o cartão já aprovado (Achado R2)",
                  { orderId: pedido.id, idPixOcupante: idOcupante },
                );
              }
            }
          }
        }
        if (vagaAdotada) {
          console.warn(
            sentinelaDestaTentativa
              ? "criar-pagamento: cartao_orfao evitado — o sentinela desta mesma tentativa foi trocado pelo cartão já aprovado"
              : "criar-pagamento: cartao_orfao evitado — PIX concorrente ainda aberto foi cancelado e a vaga foi trocada pelo cartão já aprovado (Achado R2)",
            { orderId: pedido.id, idOrderAprovado: idGateway, ocupanteAnterior: idOcupante },
          );
          return json(
            {
              paymentId: idGateway,
              statusPagamento: statusCru,
              expiraEm: vagaAdotada.expires_at,
              desafio3ds: undefined,
            },
            200,
          );
        }
        console.error(
          "criar-pagamento: cartao_orfao — cobrança aprovada (ou irreversível) sem registro no pedido, perdeu a corrida da vaga",
          { orderId: pedido.id, idOrderOrfa: idGateway, status: statusBrutoDaOrderCriada },
        );
        const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
        await comTempoLimite(alertarAdmin({ supabase, orderId: pedido.id, idOrderOrfa: idGateway }), 5000);
        // Achado N7 (3ª revisão de risco, 26/09/2026): "foi cobrado" é
        // afirmação categórica — verdadeira para `processed` (dinheiro
        // CAPTURADO), mas `statusBrutoDaOrderCriada` também chega aqui como
        // `processing` (em análise pelo emissor/antifraude, sem captura
        // ainda). "pode ter sido cobrado" é verdade nos dois casos, sem
        // prometer o que ainda não aconteceu. `cartaoEmAnalise: true`
        // (achado da 6ª rodada de risco, 26/09/2026): o cartão pode ter sido
        // cobrado e a vaga não tem o registro — o front não pode oferecer
        // PIX nem "Cancelar pedido" aqui, mesmo sendo `terminal`.
        return json(
          {
            error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
            terminal: true,
            cartaoEmAnalise: true,
          },
          409,
        );
      }
    } else if (metodo === "cartao") {
      // Achado S3 (R3-H7, 3ª revisão de risco, 26/09/2026): `idGateway ===
      // atual.gateway_payment_id` — a MESMA order que este POST acabou de
      // criar já está gravada, porque o WEBHOOK adotou (ou confirmou) essa
      // cobrança antes do UPDATE desta chamada rodar (a Orders API pode
      // notificar em milissegundos). Não é um cartão órfão nem uma segunda
      // cobrança: é a cobrança que o CLIENTE ACABOU DE PAGAR. Responder "Este
      // pedido já tem uma cobrança gerada." (o 409 recuperável logo abaixo)
      // mentia para quem pagou — e um "Tentar de novo" caía num 409 TERMINAL
      // ("Este pedido não está aguardando pagamento.") assim que
      // `confirmar_pagamento` marcasse o pedido 'pago'. 200 com o status
      // desta MESMA order (`statusCru`, computado da resposta que o MP
      // ACABOU de dar a este POST) é a verdade, sem precisar reconsultar de
      // novo.
      console.warn(
        "criar-pagamento: cartão convergiu com a adoção do webhook antes do próprio UPDATE — respondendo com o status da MESMA order, não 409",
        { orderId: pedido.id, idOrder: idGateway },
      );
      return json(
        { paymentId: idGateway, statusPagamento: statusCru, expiraEm: pedido.expires_at, desafio3ds },
        200,
      );
    }

    // Achado da 7ª rodada de risco (26/09/2026): os três pontos de retorno
    // abaixo levam `cartaoEmAnalise: true` quando `cartaoAmbiguoAposCorrida`
    // (definido acima) diz que uma cobrança de CARTÃO desta chamada ainda
    // pode existir sem desfecho — nunca por linha aninhada no literal (o
    // teste de enumeração por regex não entende objeto aninhado), por isso
    // os dois ramos aparecem separados.
    if (atual?.payment_status === "expirado") {
      // Definitivo, mesma categoria dos três ramos de podeCobrar acima: o
      // pedido já está 'expirado', e qualquer nova tentativa cai no ramo 1
      // de podeCobrar (payment_status !== 'aguardando') e é recusada de
      // novo, para sempre.
      if (cartaoAmbiguoAposCorrida) {
        return json({ error: "O prazo para pagar este pedido acabou.", terminal: true, cartaoEmAnalise: true }, 409);
      }
      return json({ error: "O prazo para pagar este pedido acabou.", terminal: true }, 409);
    }
    if (atual?.gateway_payment_id !== null && atual?.gateway_payment_id !== undefined) {
      // Recuperável: a OUTRA chamada concorrente já gravou a cobrança —
      // nova tentativa converge pelo caminho `reconsultar`, sem `terminal`.
      // Achado #4b (8ª rodada de risco, 26/09/2026): `cartaoAmbiguoAposCorrida`
      // só existe para `metodo === "cartao"` — um PIX que perdeu ESTA
      // corrida contra um cartão (sentinela ou já vivo) também não pode
      // oferecer "Cancelar pedido" aqui, mesmo sem cartão nenhum NESTA
      // chamada: o OCUPANTE (`atual`, lido acima com `metodo_online`) é
      // quem decide.
      if (
        cartaoAmbiguoAposCorrida ||
        vagaEmVerificacao(atual?.gateway_payment_id) ||
        atual?.metodo_online === "credito" ||
        atual?.metodo_online === "debito"
      ) {
        return json({ error: "Este pedido já tem uma cobrança gerada.", cartaoEmAnalise: true }, 409);
      }
      return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
    }
    // Estado que a releitura não explicou (ex.: ela também falhou) — sem
    // inventar causa. Recuperável: sem causa conhecida, tentar de novo é
    // razoável, e a chave de idempotência protege contra cobrança duplicada.
    if (cartaoAmbiguoAposCorrida) {
      return json({ error: "Não foi possível confirmar a cobrança.", cartaoEmAnalise: true }, 409);
    }
    return json({ error: "Não foi possível confirmar a cobrança." }, 409);
  }

  return json(
    {
      paymentId: idGateway,
      statusPagamento: statusCru,
      // O prazo sai da LINHA GRAVADA pelo UPDATE acima (`gravado.expires_at`),
      // NUNCA de `pedido.expires_at` — `pedido` foi lido ANTES do UPDATE, e o
      // realinhamento (decisão do dono, 14/08/2026) pode ter mudado o prazo
      // no banco nesta MESMA chamada. Usar a variável antiga mentiria o
      // prazo velho para o cliente mesmo com o banco já certo.
      expiraEm: gravado.expires_at,
      qrCode,
      qrCodeBase64,
      ticketUrl,
      // Só cartão, só quando o banco pediu o desafio 3-D Secure: a tela abre
      // a URL num iframe e espera a confirmação pelo webhook. Ausente no PIX
      // (`undefined` some do JSON).
      desafio3ds,
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
