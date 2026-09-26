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
  cancelarOrder,
  consultarOrder,
  consultarPagamento,
  criarOrder,
  erro400EhDeDadoDoCartao,
  extrairDataExpiracaoOrder,
  extrairDesafio3ds,
  extrairQrCode,
  idEhClassico,
  idempotencyKeyJaUsado,
  mapearStatus,
  mapearStatusOrder,
  metodoDeCartaoValido,
  minutosDaExpiracaoPix,
  montarCorpoCartaoOrders,
  montarCorpoPixOrders,
  MOTIVO_RECUSA_DADOS_DO_CARTAO,
  motivoDaRecusa,
  motivoDaRecusaDoErro,
  normalizarDocumento,
  orderCancelada,
  orderEhDeCartao,
  parcelasValidas,
  PREFIXO_VAGA_EM_VERIFICACAO,
  tipoDeCartaoValido,
  tipoDoPagamentoDaOrder,
  tokenDeCartaoValido,
  vagaEmVerificacao,
} from "../_shared/mercadopago.ts";
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
  enviarParaInscritos,
  readKey,
  resumir,
} from "../_shared/webpush.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
// Tarefa mp-2 (15/09/2026): a chave do Mercado Pago pode ser a do LOJISTA
// (cofre em app_settings) ou a da plataforma (env) — quem decide, e quem
// fecha a porta quando não dá para decidir com segurança, é este módulo.
import { resolverCredenciaisMp } from "../_shared/credenciais-mp.ts";

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
 * do instante da tentativa atual. `updated_at` (Achado S1, 3ª revisão de
 * risco, 26/09/2026): `sentinelaExpirado`, abaixo, precisa de QUANDO o
 * sentinela foi gravado — é o MESMO carimbo que `respostaCartaoEmVerificacao`
 * grava junto do sentinela, nenhuma coluna nova. */
const COLUNAS_DO_PEDIDO =
  "id, user_id, total, payment_status, expires_at, gateway_payment_id, customer_data, tentativas_de_pagamento, created_at, updated_at";

/**
 * Achado S1 (3ª revisão de risco, 26/09/2026): teto de quanto tempo um
 * SENTINELA (`vagaEmVerificacao`, `_shared/mercadopago.ts`) pode segurar a
 * vaga sem que o webhook o resolva (a ADOÇÃO, `webhook-mercadopago/
 * index.ts`). O webhook de aprovação da Orders API chega tipicamente em
 * segundos — folgado o bastante para não confundir latência normal de rede
 * com sentinela morto, e curto o bastante para não prender a reserva de 30
 * min por muito tempo à toa. Um sentinela mais velho que isto nunca vai ser
 * adotado: ou a cobrança da tentativa anterior nunca existiu de verdade
 * (409 por corpo perdido antes da chave ser usada), ou já foi recusada/
 * cancelada/expirada e a notificação correspondente não bateu o id contra o
 * sentinela (rede de segurança para esse caso — o caminho normal é o
 * webhook liberar pela própria chave do sentinela, ver `liberarAVaga` em
 * `webhook-mercadopago/index.ts`).
 */
export const MINUTOS_SENTINELA_PRESO = 3;

/**
 * `true` quando um sentinela (`vagaEmVerificacao`) na vaga é velho demais
 * para valer a pena esperar o webhook — ver `MINUTOS_SENTINELA_PRESO`,
 * acima. `updatedAt` ilegível (ausente, não-parseável) nunca conta como
 * "expirado": sem saber HÁ QUANTO TEMPO o sentinela está lá, a decisão mais
 * segura é continuar esperando o webhook, não liberar às cegas.
 */
export function sentinelaExpirado(updatedAt: unknown, agora: Date): boolean {
  if (typeof updatedAt !== "string") return false;
  const data = new Date(updatedAt);
  if (Number.isNaN(data.getTime())) return false;
  return agora.getTime() - data.getTime() > MINUTOS_SENTINELA_PRESO * 60_000;
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
  return `${id}:c${tentativas}`;
}

export type DadosDoCartao = {
  token: string;
  paymentMethodId: string;
  paymentTypeId: "credit_card" | "debit_card";
  parcelas: number;
  documento: { type: "CPF" | "CNPJ"; number: string };
  email: string | null;
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

    const aviso = {
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
    }) => Promise<void>;
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
  if (metodo !== "pix" && metodo !== "cartao") {
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
  const credenciaisMp = await resolverCredenciaisMp(supabase);
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
    const configCartao = await lerConfigDoCartao(supabase);
    const formaLigada = configCartao !== null &&
      (dadosCartao.paymentTypeId === "credit_card" ? configCartao.credito : configCartao.debito);
    if (!formaLigada) {
      return json({ error: "Esta forma de pagamento não está disponível nesta loja." }, 409);
    }
    if (dadosCartao.parcelas > configCartao.parcelasMax) {
      return json({ error: "Esse parcelamento não está disponível nesta loja." }, 400);
    }
  }

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
    const idGatewayReconsulta = String(pedido.gateway_payment_id);

    // Achado B2 (2ª revisão de risco, 26/09/2026): a vaga pode estar ocupada
    // por um SENTINELA (`vagaEmVerificacao`, acima) — um cartão cuja
    // resposta do MP veio 409 `idempotency_key_already_used`. Não é um id de
    // verdade: não existe endpoint para reconsultar "por chave de
    // idempotência" na Orders API, então nem tenta — só o WEBHOOK, quando a
    // cobrança de fato resolver, sabe a verdade (ele ADOTA a vaga vazia).
    // QUALQUER forma pedida aqui — cartão novo OU PIX — devolve o MESMO
    // "aguardando" sem tocar o MP: um cartão novo abriria uma SEGUNDA
    // cobrança ambígua; um PIX pagaria por fora enquanto a primeira ainda
    // pode cair aprovada.
    // Achado S1 (3ª revisão de risco, 26/09/2026): o sentinela só saía
    // quando o WEBHOOK adotava uma cobrança aprovada — uma recusa, um
    // cancelamento ou uma order que nunca chegou a existir de verdade (409
    // por corpo perdido antes da chave ser usada, ou uma falha do
    // integrador) nunca soltavam a vaga (ver o fechamento simétrico do lado
    // do webhook, `liberar_cobranca_do_pedido` pela chave do sentinela,
    // `webhook-mercadopago/index.ts`). Sem NENHUM caminho de saída, o pedido
    // ficava preso até a reserva morrer, mesmo sem NENHUMA cobrança
    // aprovada existir. `sentinelaExpirado` é a rede de segurança: o
    // webhook de aprovação da Orders API chega em segundos quando a
    // cobrança existe de verdade — um sentinela mais velho que
    // `MINUTOS_SENTINELA_PRESO` nunca vai ser adotado, e é tratado como
    // qualquer outra cobrança MORTA na vaga (ver "Daqui para baixo só
    // chegam (b) e (c)", abaixo): libera e relê antes de decidir.
    const sentinelaNaVaga = vagaEmVerificacao(idGatewayReconsulta);
    const sentinelaPresoDemais = sentinelaNaVaga &&
      sentinelaExpirado(pedido.updated_at as string | null | undefined, new Date());
    if (sentinelaNaVaga && !sentinelaPresoDemais) {
      // S1: um PIX pedido sobre um cartão AINDA em verificação nunca pode
      // virar um 200 sem QR — o front trataria isso como "recuperável, tente
      // de novo" para sempre (loop de "Não foi possível gerar o QR code do
      // PIX"), quando a verdade é que HÁ uma cobrança de cartão ambígua
      // segurando a vaga. Mesma mensagem do ramo (f), mais abaixo, para quem
      // pede PIX com um cartão em 3DS/análise reconhecível.
      if (metodo === "pix") {
        return json({ error: "Há um pagamento com cartão em análise para este pedido." }, 409);
      }
      return json(
        { paymentId: null, statusPagamento: "aguardando", expiraEm: pedido.expires_at },
        200,
      );
    }

    // S1: um sentinela PRESO DEMAIS (`sentinelaPresoDemais`, acima) cai
    // direto na liberação de "Daqui para baixo só chegam (b) e (c)", mais
    // abaixo — nada aqui embaixo sabe reconsultar um sentinela pela Orders
    // API (não é um id de order de verdade, e não existe endpoint de
    // consulta por chave de idempotência).
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
    if (!r.ok) return json({ error: r.erro }, 502);

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
            return json({ error: "Há um pagamento com cartão em análise para este pedido." }, 409);
          }
          // Cancelado — cai para a liberação da vaga (mesmo caminho de
          // (b)/(c), logo abaixo), que cria o PIX pedido.
        } else {
          // (d) Pedido de cartão com um cartão já em análise/3DS: o estado
          // atual, com o desafio se o banco pediu — NUNCA uma segunda
          // cobrança, mesmo que o Brick tenha mandado um token novo. Par
          // desconhecido devolve o par cru, igual à reconsulta do PIX.
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

    // Daqui para baixo chegam (b), (c) e o sentinela PRESO DEMAIS (Achado
    // S1): a cobrança da vaga está morta (recusada/cancelada/expirada), ou
    // NUNCA existiu de verdade (sentinela sem adoção do webhook depois do
    // teto de tempo) — e a vaga é LIBERADA para a nova. Um convidado nunca
    // chega aqui para cobrar: o cartão parou no portão lá em cima, e o PIX
    // para na trava de criação logo abaixo — mas a liberação em si é
    // inofensiva (a RPC só solta a vaga desta cobrança/sentinela, pela MESMA
    // string que está gravada nela).
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
      return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
    }
    pedido = pedidoRelido;
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

    const r = await criarOrder({
      token: mpToken,
      corpo,
      // Chave POR TENTATIVA (Fase 3.5, `chaveDeIdempotencia`): na tentativa
      // 0 é o id do pedido, byte a byte a de sempre — um retry do front
      // sobre o MESMO pedido não cria uma segunda cobrança no MP; depois de
      // uma vaga liberada, a chave muda e o MP cria a cobrança nova em vez
      // de devolver a morta.
      chaveIdempotencia: await chaveDeIdempotencia(pedido, "pix"),
      fetchImpl: deps.fetchImpl,
    });
    if (!r.ok) {
      // 401/403: credencial da loja (`respostaCredencialRecusada`, acima).
      // Qualquer outro status (0 = rede, 5xx, 4xx de corpo) segue 502
      // recuperável, como sempre foi.
      if (r.status === 401 || r.status === 403) return respostaCredencialRecusada(r.status);
      return json({ error: r.erro }, 502);
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

    // Recusa de cartão: a vaga nunca foi ocupada por esta cobrança — a RPC
    // só CONTA a tentativa (`p_gateway_payment_id` null), e a resposta é
    // 200 com o motivo: não é erro do sistema, é o banco dizendo não, e o
    // cliente segue com outro cartão ou PIX na MESMA reserva. NUNCA chega a
    // `confirmar_pagamento`, cujo ramo 'recusado' cancela o pedido e devolve
    // o estoque. Falha da RPC não muda a resposta: a recusa é verdade de
    // qualquer jeito, e a próxima tentativa tem token novo (chave nova).
    const respostaRecusaDoCartao = async (motivo: string) => {
      await liberarCobranca(supabase, pedido.id, null);
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

    // Achado B2 (2ª revisão de risco, 26/09/2026): a Orders API respondeu 409
    // `idempotency_key_already_used` — a MESMA chave, um corpo DIFERENTE (o
    // Brick nunca reusa token). A cobrança da tentativa ANTERIOR (cuja
    // resposta esta function nunca viu) PODE estar aprovada — não dá para
    // saber sem um id para reconsultar, e não existe endpoint "consulta pela
    // chave" na Orders API. Ocupa a vaga com o SENTINELA
    // (`vagaEmVerificacao`, acima) em vez de um id de verdade: bloqueia
    // cartão novo E PIX nesta reserva até o WEBHOOK resolver a ambiguidade
    // (adotando a cobrança, se ela aparecer aprovada — Achado B2,
    // `webhook-mercadopago/index.ts`) ou a reserva expirar. A resposta ao
    // cliente é a MESMA que um cartão em análise já usa (`statusPagamento:
    // "aguardando"`, sem `desafio3ds`) — `PagamentoComCartao.tsx` já trata
    // isso como "em análise pelo banco", sem oferecer novo cartão nem PIX.
    const respostaCartaoEmVerificacao = async () => {
      const sentinela = `${PREFIXO_VAGA_EM_VERIFICACAO}${await chaveDeIdempotencia(pedido, "cartao")}`;
      // Achado S3 (3ª revisão de risco, 26/09/2026): o sentinela NÃO grava
      // `metodo_online`/`parcelas` — os dois viriam do corpo deste RETRY
      // (token novo, muitas vezes forma/parcelamento diferentes), nunca da
      // cobrança da tentativa ANTERIOR que pode estar aprovada por baixo. A
      // ADOÇÃO (`webhook-mercadopago/index.ts`) grava os dois de verdade,
      // lidos da order RECONSULTADA, quando resolve o sentinela.
      const { data: ocupou, error: erroOcuparSentinela } = await supabase
        .from("marketplace_orders")
        .update({
          gateway_payment_id: sentinela,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pedido.id)
        .is("gateway_payment_id", null)
        .select("id")
        .maybeSingle();
      // Achado N4 (3ª revisão de risco, 26/09/2026): esta gravação ignorava
      // `error` — uma falha de BANCO (timeout, deadlock) fazia `ocupou` virar
      // `undefined` do MESMO jeito que "a vaga já não está livre", e o
      // cliente recebia "Este pedido já tem uma cobrança gerada." para um
      // pedido cuja vaga continua NULL de verdade. Recuperável: nada foi
      // gravado, e o "Tentar de novo" repete a mesma chave de idempotência
      // (o MP ainda vai devolver o MESMO 409, mas desta vez a gravação tem
      // chance de funcionar).
      if (erroOcuparSentinela) {
        console.error(
          "criar-pagamento: falha ao gravar o sentinela de verificação — nada gravado, cobrança da tentativa anterior pode estar aprovada sem registro",
          { orderId: pedido.id, erro: erroOcuparSentinela },
        );
        return json({ error: "Não foi possível confirmar a cobrança. Tente de novo em instantes." }, 503);
      }
      console.error(
        "criar-pagamento: cartao_em_verificacao — 409 idempotency_key_already_used (chave repetida com corpo diferente); a cobrança da tentativa anterior PODE ter sido aprovada",
        { orderId: pedido.id, vagaOcupada: Boolean(ocupou) },
      );
      if (!ocupou) {
        // A vaga já não está livre — outra chamada concorrente resolveu
        // isto primeiro (adotou uma cobrança, ou já marcou a MESMA
        // verificação). Relê o estado real, mesmo padrão do resto do
        // handler: nunca inventa causa.
        const { data: atual } = await supabase
          .from("marketplace_orders")
          .select("payment_status, gateway_payment_id")
          .eq("id", pedido.id)
          .maybeSingle();
        if (atual?.payment_status === "expirado") {
          return json({ error: "O prazo para pagar este pedido acabou.", terminal: true }, 409);
        }
        return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
      }
      // Achado S5 (3ª revisão de risco, 26/09/2026): sem migration para
      // avisar quando um PEDIDO expira ainda com o sentinela na vaga (o
      // pg_cron que expira pedidos é SQL puro, sem HTTP), o ponto mais
      // barato e mais confiável é aqui — na ESCRITA do sentinela, feita uma
      // única vez por tentativa ambígua. `reconciliar-pagamentos` (Achado
      // S5/N3) passou a IGNORAR vagas em verificação (não tenta mais
      // consultar o MP com elas a cada 10 min), então esperar por ela para
      // avisar deixaria o admin sem sinal nenhum até a reserva morrer.
      // Reusa o MESMO canal de "cartão sem registro" — é a mesma categoria
      // de risco (uma cobrança de cartão pode existir sem nenhum ponteiro
      // confiável), só a origem muda.
      const alertarAdmin = deps.alertarAdminCartaoOrfao ?? alertarAdminCartaoOrfaoReal;
      await comTempoLimite(alertarAdmin({ supabase, orderId: pedido.id, idOrderOrfa: sentinela }), 5000);
      return json(
        { paymentId: null, statusPagamento: "aguardando", expiraEm: pedido.expires_at },
        200,
      );
    };

    // E-mail do pagador: o primeiro VÁLIDO da mesma corrente do PIX — um
    // `customer_data.email` torto não pode travar o cartão no construtor
    // (que valida o formato); o fallback genérico fecha a corrente.
    const emailDoCartao = [
      dados.email,
      (pedido.customer_data as Record<string, unknown> | null)?.email,
      emailDoToken(req.headers.get("Authorization")),
    ].find(emailValido) ?? "sem-email@ikcous.com.br";

    let corpo: Record<string, unknown>;
    try {
      corpo = montarCorpoCartaoOrders({
        orderId: pedido.id,
        valor: Number(pedido.total),
        email: emailPagadorSandbox ?? emailDoCartao,
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

    const r = await criarOrder({
      token: mpToken,
      corpo,
      chaveIdempotencia: await chaveDeIdempotencia(pedido, "cartao", dados.token),
      fetchImpl: deps.fetchImpl,
      // O corpo da recusa traz o pagador (e-mail, CPF): no log, só o resumo.
      corpoNoLog: false,
    });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) return respostaCredencialRecusada(r.status);
      // 409 (Achado B2, 2ª revisão de risco, 26/09/2026): ver o comentário
      // grande de `respostaCartaoEmVerificacao`, acima.
      if (r.status === 409 && idempotencyKeyJaUsado(r.corpoDoErro)) {
        return await respostaCartaoEmVerificacao();
      }
      // 402: o MP processou e RECUSOU o pagamento (a order recusada vem no
      // corpo do erro, com o motivo).
      if (r.status === 402) return await respostaRecusaDoCartao(motivoDaRecusaDoErro(r.corpoDoErro));
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
        if (erro400EhDeDadoDoCartao(r.corpoDoErro)) {
          return await respostaRecusaDoCartao(MOTIVO_RECUSA_DADOS_DO_CARTAO);
        }
        // Achado R3 (2ª revisão de risco, 26/09/2026): um 400 que NÃO é
        // sobre o cartão ainda CONSOME a chave de idempotência no MP (a doc
        // não promete "só sucesso/402 conta" — um 400 pode ficar em cache do
        // mesmo jeito). Sem avançar a tentativa, o PRÓXIMO cartão (token
        // novo, MESMA chave) bateria num 409 à toa. Diferente do Achado B2:
        // um 400 NÃO é ambíguo (a Orders API recusou a REQUISIÇÃO inteira —
        // não existe order para o webhook adotar depois), então a saída
        // certa é liberar a tentativa (como uma recusa imediata), não
        // "aguarde verificação". Falha da RPC não muda a resposta (mesma
        // regra de `respostaRecusaDoCartao`): o bug de integração é verdade
        // de qualquer jeito.
        await liberarCobranca(supabase, pedido.id, null);
        return json({ error: r.erro }, 502);
      }
      // Rede, 5xx, outro 4xx: nada foi cobrado com certeza — 502
      // recuperável, e a chave de idempotência protege o retry do MESMO
      // token contra cobrança dupla.
      return json({ error: r.erro }, 502);
    }

    const orderCartao = r.order as Record<string, unknown>;
    const statusCartao = mapearStatusOrder(
      String(orderCartao.status ?? ""),
      String(orderCartao.status_detail ?? ""),
    );
    // Order criada, mas já recusada (`failed`) — ou, por defesa, cancelada/
    // expirada na própria criação: mesma recusa do 402. A vaga não é
    // ocupada por uma cobrança morta.
    if (statusCartao === "recusado" || statusCartao === "expirado") {
      return await respostaRecusaDoCartao(motivoDaRecusa(orderCartao));
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

  let updateDaVaga = supabase
    .from("marketplace_orders")
    .update(valoresUpdate)
    .eq("id", pedido.id);
  if (metodo !== "cartao") {
    updateDaVaga = updateDaVaga.eq("payment_status", "aguardando");
  }
  const { data: gravado, error: erroUpdate } = await updateDaVaga
    .is("gateway_payment_id", null)
    // `expires_at` além de `id`: a resposta abaixo precisa do prazo
    // EFETIVAMENTE gravado, não do que `pedido` (lido ANTES deste UPDATE)
    // guardava em memória — sem isto a tela mostraria "Vence às HH:MM" do
    // prazo ANTIGO mesmo com o banco já realinhado ao novo. `payment_status`
    // (Achado R1, 2ª revisão de risco, 26/09/2026): só o CARTÃO precisa dele
    // — ver o bloco logo abaixo.
    .select("id, expires_at, payment_status")
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
  // do que decide: `statusBrutoDaOrderCriada` — `processed` (aprovado,
  // IRREVERSÍVEL, dinheiro capturado) sempre grava e HONRA (P1, sem mudança);
  // `action_required`/`created` (REVERSÍVEL, nada capturado) só grava se o
  // pedido REALMENTE estava 'aguardando' no instante do UPDATE — se não
  // estava, desfaz: cancela a order no MP (o cliente nunca vai completá-la
  // mesmo) e devolve o MESMO 409 terminal que `podeCobrar` já devolve para
  // todo pedido fora de 'aguardando'.
  if (
    gravado &&
    metodo === "cartao" &&
    gravado.payment_status !== "aguardando" &&
    (statusBrutoDaOrderCriada === "action_required" || statusBrutoDaOrderCriada === "created")
  ) {
    console.warn(
      "criar-pagamento: desafio 3DS gravado num pedido que já não estava 'aguardando' — cancelando a order (nada foi capturado) e recusando",
      { orderId: pedido.id, idOrder: idGateway, paymentStatusNaGravacao: gravado.payment_status },
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
    return json({ error: "O prazo para pagar este pedido acabou.", terminal: true }, 409);
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
    const { data: atual } = await supabase
      .from("marketplace_orders")
      .select("payment_status, gateway_payment_id")
      .eq("id", pedido.id)
      .maybeSingle();

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
        if (idOcupante && !idEhClassico(idOcupante) && !vagaEmVerificacao(idOcupante)) {
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
            "criar-pagamento: cartao_orfao evitado — PIX concorrente ainda aberto foi cancelado e a vaga foi trocada pelo cartão já aprovado (Achado R2)",
            { orderId: pedido.id, idOrderAprovado: idGateway, idPixCancelado: idOcupante },
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
        // prometer o que ainda não aconteceu.
        return json(
          {
            error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
            terminal: true,
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

    if (atual?.payment_status === "expirado") {
      // Definitivo, mesma categoria dos três ramos de podeCobrar acima: o
      // pedido já está 'expirado', e qualquer nova tentativa cai no ramo 1
      // de podeCobrar (payment_status !== 'aguardando') e é recusada de
      // novo, para sempre.
      return json({ error: "O prazo para pagar este pedido acabou.", terminal: true }, 409);
    }
    if (atual?.gateway_payment_id !== null && atual?.gateway_payment_id !== undefined) {
      // Recuperável: a OUTRA chamada concorrente já gravou a cobrança —
      // nova tentativa converge pelo caminho `reconsultar`, sem `terminal`.
      return json({ error: "Este pedido já tem uma cobrança gerada." }, 409);
    }
    // Estado que a releitura não explicou (ex.: ela também falhou) — sem
    // inventar causa. Recuperável: sem causa conhecida, tentar de novo é
    // razoável, e a chave de idempotência protege contra cobrança duplicada.
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
