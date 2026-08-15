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
  consultarOrder,
  consultarPagamento,
  criarOrder,
  criarPagamento,
  extrairDataExpiracaoOrder,
  extrairQrCode,
  idEhClassico,
  mapearStatus,
  mapearStatusOrder,
  minutosDaExpiracaoPix,
  montarCorpoCartao,
  montarCorpoPixOrders,
} from "../_shared/mercadopago.ts";

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
  deps: {
    supabase?: ReturnType<typeof createClient>;
    fetchImpl?: typeof fetch;
    // Tarefa 2 (CHECKOUT-070): mesma costura de `fetchImpl` acima, para o
    // catch do throw de `montarCorpoPixOrders` (expiração fora da faixa)
    // ser alcançável em teste sem depender de um bug de verdade neste
    // arquivo. Em produção nunca é passado — default "PT30M" abaixo.
    expiracaoPix?: string;
  } = {},
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
  // Fase 3 entrega SÓ PIX. O cartão continua desligado no Brick (Task 8), mas
  // a recusa tem de ser aqui também: a tela é do cliente, e o caminho de
  // cartão tem defeito conhecido — depois da primeira recusa o pedido fica
  // impagável até expirar (herança nº 2 da Fase 2). Cartão é a Fase 3.5.
  // CHECKOUT-050 (#194), correção da revisão (a rodada anterior marcou isto
  // terminal por engano): NÃO é permanente. "Tentar de novo" remonta o
  // Brick, e é justamente lá que o cliente escolhe PIX — o próprio retry
  // TROCA de método, que é a saída que a própria mensagem sugere. Marcar
  // terminal prendia o cliente numa caixa que já tinha desmontado o
  // formulário onde ele faria essa troca.
  if (body.metodo !== "pix") {
    return json({ error: "No momento aceitamos apenas PIX." }, 400);
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

  if (decisao.acao === "reconsultar") {
    // Aqui é onde a tela recupera o MESMO QR sem criar uma segunda cobrança
    // — nenhum UPDATE, porque nada mudou no pedido, só a consulta. MEDIDO em
    // 14/08/2026 contra a API real: o GET /v1/orders/{id} devolve o QR
    // idêntico ao da criação, então este ramo basta. (Dizia "o QR só existe
    // na resposta da CRIAÇÃO" — era suposição, e a medição a derrubou.)
    //
    // Tarefa 2 (CHECKOUT-070): só PIX chega aqui (cartão já foi recusado
    // acima, antes da leitura do pedido).
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
          statusPagamento: mapearStatus(classico.status) ?? classico.status,
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
    const r = await consultarOrder({
      token: mpToken,
      orderId: idGatewayReconsulta,
      fetchImpl: deps.fetchImpl,
    });
    if (!r.ok) return json({ error: r.erro }, 502);

    const extraido = extrairQrCode(r.order);
    const statusObjeto = r.order as Record<string, unknown>;
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
        statusPagamento:
          mapearStatusOrder(
            String(statusObjeto.status ?? ""),
            String(statusObjeto.status_detail ?? ""),
          ) ?? `${String(statusObjeto.status ?? "")}:${String(statusObjeto.status_detail ?? "")}`,
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

  // decisao.acao === "criar" a partir daqui.
  const email =
    (body.email as string) ??
    (pedido.customer_data as Record<string, unknown>)?.email ??
    "sem-email@ikcous.com.br";

  // Os quatro valores que os dois caminhos (PIX/Orders novo, cartão/clássico
  // morto) precisam produzir para a gravação e a resposta abaixo, que são
  // IGUAIS nos dois — só a CHAMADA ao gateway diverge.
  let idGateway: string;
  let statusCru: string;
  let qrCode: string | undefined;
  let qrCodeBase64: string | undefined;
  let ticketUrl: string | undefined;
  // Realinhamento de expires_at (decisão do dono, 14/08/2026) — só o PIX
  // preenche isto (a Orders API é quem manda date_of_expiration; o clássico
  // de cartão nunca teve esse campo). `undefined` = não mexe em expires_at,
  // que é o comportamento de hoje.
  let expiresAtNovo: string | undefined;

  if (body.metodo === "pix") {
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
      // O id do pedido como chave: um retry do front sobre o MESMO pedido
      // não cria uma segunda cobrança no MP.
      chaveIdempotencia: String(pedido.id),
      fetchImpl: deps.fetchImpl,
    });
    if (!r.ok) return json({ error: r.erro }, 502);

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
  } else {
    // Cartão: caminho CLÁSSICO, código morto hoje — `body.metodo !== "pix"`
    // já recusa com 400 lá em cima, antes da leitura do pedido, então este
    // ramo nunca executa em produção. Mantido de propósito (Tarefa 2 migra
    // SÓ o caminho PIX, que é o alcançável, e cartão é a Fase 3.5 — ver o
    // comentário da checagem `body.metodo !== "pix"` acima). NÃO é porque
    // `webhook-mercadopago`/`reconciliar-pagamentos` (Tasks 3-4) dependam de
    // `montarCorpoCartao`/`criarPagamento` clássicos: conferido em 13/08/2026,
    // os dois importam só `consultarPagamento`, `mapearStatus` e
    // `validarAssinatura` de `_shared/mercadopago.ts` — nenhum toca cartão.
    // Hoje o único chamador vivo de `montarCorpoCartao`/`criarPagamento` é
    // este ramo e os testes deles em `mercadopago_test.ts`; a limpeza deste
    // ramo fica para depois da Fase 3.5, não das Tasks 3-4.
    const corpo = montarCorpoCartao({
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
      chaveIdempotencia: String(pedido.id),
      fetchImpl: deps.fetchImpl,
    });
    if (!r.ok) return json({ error: r.erro }, 502);

    idGateway = r.id;
    // Achado da revisão da CHECKOUT-080 (#213): antes desta correção este
    // ramo atribuía `r.status` CRU (vocabulário clássico do MP) direto a
    // `statusCru` — que vira `statusPagamento` na resposta lá embaixo. O
    // ramo é INALCANÇÁVEL hoje (`body.metodo !== "pix"` recusa com 400 antes
    // da leitura do pedido, então `else` nunca executa em produção), mas
    // fica mantido de propósito para quando o cartão for religado (Fase
    // 3.5) — e nesse dia um "approved" cru não bateria em nenhum valor do
    // conjunto fechado que PagamentoOnline.tsx conhece, virando terminal
    // para um cartão que o MP acabou de aprovar e cobrar. `mapearStatus` é o
    // MESMO tradutor já aplicado ao ramo clássico irmão (reconsulta, acima)
    // — `?? r.status` é só a rede de segurança para um status que nem esse
    // mapa conhece (nunca um palpite: o front trata como desconhecido e
    // recusa fechado).
    statusCru = mapearStatus(r.status) ?? r.status;
    qrCode = r.qrCode;
    qrCodeBase64 = r.qrCodeBase64;
    ticketUrl = r.ticketUrl;
  }

  // Grava a cobrança. O WHERE repete a condição de podeCobrar porque entre a
  // leitura e agora o pg_cron pode ter expirado o pedido: se expirou, o
  // update não acha linha e a cobrança fica órfã no MP — que é o caso que a
  // reconciliação da Fase 3 resolve. Sobrescrever seria pior.
  //
  // `expires_at` só entra no SET quando o realinhamento (decisão do dono,
  // 14/08/2026, ver expiracaoRealinhavel acima) aprovou o valor do MP — sem
  // isto, TODO pedido teria a coluna tocada, mesmo quando o comportamento
  // certo é deixá-la como está.
  const valoresUpdate: Record<string, unknown> = {
    gateway_payment_id: idGateway,
    updated_at: new Date().toISOString(),
  };
  if (expiresAtNovo) valoresUpdate.expires_at = expiresAtNovo;

  const { data: gravado, error: erroUpdate } = await supabase
    .from("marketplace_orders")
    .update(valoresUpdate)
    .eq("id", pedido.id)
    .eq("payment_status", "aguardando")
    .is("gateway_payment_id", null)
    // `expires_at` além de `id`: a resposta abaixo precisa do prazo
    // EFETIVAMENTE gravado, não do que `pedido` (lido ANTES deste UPDATE)
    // guardava em memória — sem isto a tela mostraria "Vence às HH:MM" do
    // prazo ANTIGO mesmo com o banco já realinhado ao novo.
    .select("id, expires_at")
    .maybeSingle();

  if (erroUpdate || !gravado) {
    console.error("criar-pagamento: cobrança criada mas não gravada", idGateway, erroUpdate);
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
