import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { useOrders } from "@/hooks/useOrders";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SDK_URL = "https://sdk.mercadopago.com/js/v2";

let promessaSdk: Promise<void> | null = null;

/**
 * Carrega o SDK do Mercado Pago uma vez por sessão.
 *
 * O `promessaSdk` em módulo evita a corrida do StrictMode do React 18, que
 * monta o componente duas vezes em desenvolvimento: sem ele, duas tags de
 * script entram na página e o Brick tenta renderizar duas vezes no mesmo
 * container.
 */
export function carregarSdkMercadoPago(): Promise<void> {
  if (promessaSdk) return promessaSdk;

  promessaSdk = new Promise<void>((resolve, reject) => {
    const existente = document.querySelector<HTMLScriptElement>(
      "script[data-mp-sdk]",
    );
    const tag = existente ?? document.createElement("script");

    if (!existente) {
      tag.src = SDK_URL;
      tag.async = true;
      tag.dataset.mpSdk = "1";
    }

    tag.addEventListener("load", () => resolve());
    tag.addEventListener("error", () => {
      // Zera para uma tentativa futura poder recomeçar — e REMOVE a tag morta.
      // Sem o remove(), a próxima chamada acha esta tag via querySelector, cai
      // no ramo `if (!existente)` e nunca reanexa `src`/listeners a um script
      // que já falhou: nem resolve, nem rejeita, a Promise nova fica pendurada
      // para sempre.
      promessaSdk = null;
      tag.remove();
      reject(new Error("Não foi possível carregar o pagamento."));
    });

    if (!existente) document.head.appendChild(tag);
  });

  return promessaSdk;
}

/**
 * De que tipo é a falha que `onErro` está reportando — ver CHECKOUT-050.
 *
 * "recuperavel": tentar de novo pode dar um resultado diferente. Cobre dois
 * casos bem distintos: a cobrança pode não ter chegado a existir (rede caiu,
 * SDK não carregou, Brick não montou) — aí `criar-pagamento` cria do zero,
 * sem `gateway_payment_id` gravado; OU o PIX voltou sem QR code num 200 que
 * JÁ CRIOU a cobrança (o UPDATE grava `gateway_payment_id` antes de
 * responder) — aí a próxima tentativa cai em `reconsultar`, que pode trazer
 * o QR que a criação não trouxe. Nos dois casos insistir é seguro; muda só o
 * caminho que `criar-pagamento` escolhe.
 *
 * "terminal": a cobrança já existe e está morta para este pedido (recusada,
 * cancelada, com status que o banco não reconhece) OU a reserva do pedido já
 * venceu. Tentar de novo bate na MESMA recusa — `podeCobrar` manda para
 * `reconsultar` sempre que já existe `gateway_payment_id`, devolvendo o
 * status da mesma cobrança (ver o comentário grande dentro de `onSubmit`
 * abaixo).
 */
export type CategoriaErroPagamento = "recuperavel" | "terminal";

/**
 * Marca um erro como TERMINAL para quem captura no catch de `onSubmit` —
 * usado só nos dois pontos abaixo onde SABEMOS que reconsultar devolve a
 * mesma recusa. Qualquer outro erro (rede, `criarPagamento` rejeitando por
 * outro motivo) é tratado como recuperável por padrão.
 */
class ErroPagamentoTerminal extends Error {}

/** O corpo que `criarPagamento` devolve quando a chamada dá certo (201). */
type RespostaCriarPagamento = {
  paymentId: string;
  statusPagamento: string;
  expiraEm: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

type ResultadoClassificacaoPagamento =
  | { tipo: "erro"; mensagem: string; categoria: CategoriaErroPagamento }
  | {
      tipo: "pix";
      pix: {
        qrCodeBase64?: string;
        qrCode?: string;
        expiraEm: string;
        ticketUrl?: string;
      };
    }
  // Cartão aprovado: hoje inalcançável (o Brick só oferece PIX, ver
  // `montarBrick` abaixo), mas o vocabulário de status não distingue o meio
  // de pagamento — fica nomeado em vez de escondido dentro de um `if`.
  | { tipo: "sem-acao" };

/**
 * Traduz a resposta (ou o corpo já resolvido) de `criarPagamento` para o que
 * a tela deve fazer — erro (com categoria) ou QR do PIX. Extraída de dentro
 * do `onSubmit` do Brick (CHECKOUT-080, #213) para ser a MESMA regra nos dois
 * caminhos que chamam `criarPagamento` hoje: o `onSubmit` do Brick (cartão,
 * ainda vivo para a Fase 3.5, ver comentário de `montarBrick`) e o disparo
 * direto do PIX (`dispararPagamentoPix`, pedido do dono de 25/09/2026, que
 * pula o Brick inteiro). Duplicar este `if`-chain nos dois lugares é o tipo
 * de cópia que diverge sozinha na próxima mudança de vocabulário do banco —
 * ver CHECKOUT-080 no histórico, que já foi exatamente esse defeito uma vez.
 *
 * `ehPix` decide só o desfecho de SUCESSO (se vira QR ou "sem-acao"); os
 * quatro ramos de erro (recusado/expirado/estornado/desconhecido) são os
 * mesmos para os dois métodos — a MESMA cobrança recusada volta idêntica
 * numa reconsulta, seja qual for o meio que a criou.
 */
function classificarRespostaPagamento(
  r: RespostaCriarPagamento,
  ehPix: boolean,
): ResultadoClassificacaoPagamento {
  // A-1 da revisão final, vocabulário atualizado na CHECKOUT-080 (#213):
  // recusa é resultado normal de um pagamento CRIADO (o MP responde 201), não
  // erro HTTP — criarPagamento devolve `ok`. `statusPagamento` vem no
  // vocabulário FECHADO do banco ('aguardando'/'pago'/'recusado'/'expirado'/
  // 'estornado' — useOrders.ts, `StatusPagamentoConhecido`), não mais no
  // vocabulário cru do MP: a edge function já traduziu.
  if (r.statusPagamento === "recusado") {
    // Nem "outro cartão" nem "pague com PIX" cabem aqui: cartão está
    // desligado no Brick (só PIX, ver comentário de `montarBrick`), e
    // `podeCobrar` (criar-pagamento/index.ts) manda para `reconsultar`
    // sempre que o pedido já tem gateway_payment_id — o que devolve o
    // status da MESMA cobrança recusada, sem criar outra. Qualquer nova
    // tentativa neste pedido bate na mesma recusa até expirar. 'recusado'
    // cobre os dois desfechos que o vocabulário clássico separava em
    // "rejected"/"cancelled" — este banco não tem um valor 'cancelado'
    // distinto de 'recusado' (ver o comentário de MAPA_STATUS_ORDER em
    // supabase/functions/_shared/mercadopago.ts).
    return {
      tipo: "erro",
      mensagem:
        "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    };
  }
  if (r.statusPagamento === "expirado") {
    // CHECKOUT-080 (#213): o QR deste PIX venceu no Mercado Pago (não
    // necessariamente porque a reserva de 30 min do PEDIDO também venceu —
    // os dois prazos podem divergir, ver expiracaoRealinhavel em
    // criar-pagamento/index.ts). `reconsultar` devolve a MESMA order vencida
    // para sempre: só um pedido novo gera um QR novo.
    return {
      tipo: "erro",
      mensagem:
        "O prazo deste PIX venceu antes do pagamento ser confirmado. Faça um pedido novo para gerar um QR code novo.",
      categoria: "terminal",
    };
  }
  if (r.statusPagamento === "estornado") {
    // Um estorno desfaz um pagamento que chegou a ser aprovado — não há
    // "tentar de novo" que reverta isso para o MESMO pedido.
    return {
      tipo: "erro",
      mensagem:
        "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
      categoria: "terminal",
    };
  }
  const statusConhecido =
    r.statusPagamento === "aguardando" || r.statusPagamento === "pago";
  if (!statusConhecido) {
    // Rede de segurança OBRIGATÓRIA (item 4 da CHECKOUT-080, #213): status
    // novo/desconhecido do MP (ou AUSENTE — function antiga ainda no ar, ver
    // teste dedicado) não pode virar sucesso silencioso, e reconsultar não
    // muda o que o MP já respondeu.
    return {
      tipo: "erro",
      mensagem: "Não foi possível confirmar o pagamento.",
      categoria: "terminal",
    };
  }
  if (!ehPix) return { tipo: "sem-acao" };
  if (!r.qrCode && !r.qrCodeBase64) {
    // Nunca sinaliza sucesso sem QR de verdade — sem QR o cliente ficaria
    // preso numa tela vazia, sem volta, com o pedido morrendo em 30 min de
    // reserva. Recuperável (não `ErroPagamentoTerminal`): a cobrança em si
    // não existe de forma útil, e uma nova tentativa cria/reconsulta do zero
    // sem risco de duplicar cobrança.
    return {
      tipo: "erro",
      mensagem: "Não foi possível gerar o QR code do PIX.",
      categoria: "recuperavel",
    };
  }
  return {
    tipo: "pix",
    pix: {
      qrCodeBase64: r.qrCodeBase64,
      qrCode: r.qrCode,
      expiraEm: r.expiraEm,
      ticketUrl: r.ticketUrl,
    },
  };
}

/**
 * Monta o Payment Brick e devolve a função de desmontagem do efeito.
 *
 * Cartão (Fase 3.5): o Brick só oferece PIX hoje (`paymentMethods` abaixo), e
 * o PIX passou a se disparar direto (`dispararPagamentoPix`, pedido do dono
 * de 25/09/2026) — ele não chama esta função. `montarBrick` fica viva, sem
 * caller em produção, para o dia em que o cartão for religado: a tela do
 * Brick pedindo os dados do cartão continua fazendo sentido para esse meio,
 * só o PIX é que não precisava mais dela.
 *
 * Extraída do `useEffect` do componente por dois motivos:
 *
 * 1. A guarda contra o StrictMode e o cancelamento do efeito precisam falar a
 *    MESMA língua. `cancelado` é checado nos dois únicos pontos em que dá
 *    para abortar sem deixar rastro: antes do `create()` (a IIFE cancelada
 *    nunca chega a criar nada — é o que faz o StrictMode montar/desmontar/
 *    remontar sem duplicar o Brick, sem precisar de um `jaMontou` que bloqueia
 *    a segunda montagem de verdade também) e depois dele (a criação já
 *    aconteceu; só dá para desfazer desmontando — sem isso, uma criação em
 *    voo cujo efeito já foi cancelado ficava abandonada, e o bundle do Brick
 *    reclama "Brick already initialized" na próxima tentativa, porque só o
 *    `unmount()` dele limpa o estado interno).
 * 2. Isola a corrida do StrictMode e o ciclo de vida do Brick de qualquer
 *    aparato de teste de React — o teste chama esta função diretamente,
 *    simula mount → cleanup → mount e confere o que o SDK real (mockado)
 *    fez, sem precisar renderizar componente nenhum.
 *
 * Exportada para teste — não é API pública do componente.
 */
export function montarBrick({
  orderId,
  valor,
  criarPagamento,
  onErro,
  onPix,
}: {
  orderId: string;
  valor: number;
  criarPagamento: ReturnType<typeof useOrders>["criarPagamento"];
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
  onPix: (pix: {
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
    ticketUrl?: string;
  }) => void;
}): () => void {
  let cancelado = false;
  let controlador: { unmount: () => void } | null = null;

  (async () => {
    try {
      await carregarSdkMercadoPago();
      if (cancelado) return;

      const publicKey = chavePublicaMercadoPago();
      if (!publicKey) throw new Error("Pagamento indisponível.");

      // @ts-expect-error o SDK entra pelo global
      const mp = new globalThis.MercadoPago(publicKey, { locale: "pt-BR" });

      const criado = await mp.bricks().create("payment", "mp-container", {
        initialization: { amount: valor },
        customization: {
          // So PIX na Fase 3. O caminho de cartao existe no codigo mas tem
          // defeito conhecido: depois da primeira recusa o pedido fica
          // impagavel ate expirar, e a mensagem atual pede "tente outro
          // cartao", o que e' impossivel. Religar cartao e' a Fase 3.5, e
          // depende de chave de idempotencia versionada.
          paymentMethods: { bankTransfer: "all" },
        },
        callbacks: {
          onReady: () => {},
          onError: (erro: unknown) => {
            console.error("brick:", erro);
            // O Brick nem chegou a montar — nenhuma cobrança foi criada.
            onErro("Não foi possível carregar o pagamento.", "recuperavel");
          },
          onSubmit: async ({ formData }: { formData: Record<string, any> }) => {
            try {
              // PIX volta sem token; cartão volta tokenizado NO NAVEGADOR — o
              // número do cartão não passa pelo nosso servidor.
              const ehPix = !formData.token;
              const r = await criarPagamento({
                orderId,
                metodo: ehPix ? "pix" : "cartao",
                token: formData.token,
                parcelas: formData.installments,
                paymentMethodId: formData.payment_method_id,
                issuerId: formData.issuer_id,
                email: formData.payer?.email,
                documento: formData.payer?.identification,
              });

              // Classificação (recusado/expirado/estornado/desconhecido/QR
              // ausente) extraída para `classificarRespostaPagamento` —
              // MESMA regra usada pelo disparo direto do PIX
              // (`dispararPagamentoPix`, ver comentário lá). Só o desfecho
              // muda por caminho: aqui, sucesso desmonta o Brick antes de
              // repassar o QR.
              const resultado = classificarRespostaPagamento(r, ehPix);
              if (resultado.tipo === "erro") {
                throw resultado.categoria === "terminal"
                  ? new ErroPagamentoTerminal(resultado.mensagem)
                  : new Error(resultado.mensagem);
              }
              if (resultado.tipo === "pix") {
                // O Brick some do DOM quando o JSX troca para o QR — desmonta
                // ANTES de trocar, senão a próxima montagem (voltar ao
                // checkout sem recarregar a página) esbarra em "Brick
                // already initialized".
                controlador?.unmount();
                controlador = null;
                onPix(resultado.pix);
              }
            } catch (err: any) {
              // As quatro mensagens de criarPagamento (`useOrders.ts`, na
              // função `criarPagamento` — âncora por NOME, não por linha: a
              // citação anterior apontava para :974-980 e o arquivo já
              // andou 178 linhas desde então)
              // só chegam ao cliente se saírem por aqui — sem este catch, a
              // rejeição desaparece dentro do próprio SDK e a tela fica muda.
              //
              // Categoria: terminal para os dois `throw new
              // ErroPagamentoTerminal` acima, e para qualquer erro de
              // `criarPagamento` (useOrders.ts) que traga `.terminal ===
              // true` — DADO que a edge function manda no corpo do 409,
              // não texto. CHECKOUT-050 (#194), achado da revisão: a
              // versão anterior comparava a MENSAGEM por igualdade exata
              // com o texto de prazo vencido; assim que o pg_cron marca o
              // pedido 'expirado' (a cada 5 min), a mesma reserva morta
              // passa a cair no ramo 1 de podeCobrar (payment_status !==
              // 'aguardando'), com uma mensagem que a comparação de texto
              // nunca reconhecia — o cliente ganhava "Tentar de novo" para
              // uma recusa que nunca muda. Sem compatibilidade com a
              // versão antiga da criar-pagamento (que não manda o campo):
              // a loja em produção não cobra online hoje (VITE_
              // PAGAMENTO_ONLINE falha fechada), e o deploy da function é
              // pré-requisito conhecido de ligar a flag — um fallback por
              // texto "só durante a transição" reintroduziria exatamente
              // este defeito. Qualquer outro erro — rede, gateway fora do
              // ar, corpo de erro genérico — é recuperável por padrão.
              const terminal =
                err instanceof ErroPagamentoTerminal || err?.terminal === true;
              // Ponto fechado (censo do lote, item 8): esta linha estava
              // marcada "a verificar — o vizinho é deliberado". Verificação
              // feita: DIFERENTE do catch de `montarBrick` (o que envolve
              // `carregarSdkMercadoPago()` e `mp.bricks().create()`, e cujo
              // comentário proíbe `err?.message` por causa do texto do
              // bundle do MP), este envolve só o `onSubmit` — que o SDK só
              // chama DEPOIS de `create()` ter resolvido, então são caminhos
              // que não se cruzam.
              //
              // As fontes que chegam aqui são texto curado em português,
              // nunca o SDK/rede/navegador crus. A regra que sustenta isso é
              // mais forte que a lista: só um corpo JSON com a chave exata
              // `error` sobrepõe o literal padrão, e a única coisa que emite
              // essa chave neste caminho é a nossa própria edge function.
              // Enumeração:
              // 1) os quatro `throw new ErroPagamentoTerminal(...)` acima
              //    (recusado/expirado/estornado/status desconhecido) e o
              //    `throw new Error("Não foi possível gerar o QR code do
              //    PIX.")` — literais fixos deste arquivo;
              // 2) `criarPagamento` (useOrders.ts) só lança
              //    `Object.assign(new Error(mensagem), { terminal })`, onde
              //    `mensagem` é OU o literal "Não foi possível gerar a
              //    cobrança." OU `corpo.error` lido do 409/502/etc. da edge
              //    function — e todo `error:` que
              //    supabase/functions/criar-pagamento/index.ts devolve é uma
              //    string curada; o corpo cru do Mercado Pago fica preso no
              //    console do servidor (_shared/mercadopago.ts, comentário
              //    "NUNCA para o cliente"), nunca no corpo da resposta;
              // 3) falha de rede pura (`FunctionsFetchError` do
              //    supabase-js) também não vaza: seu `.context` é o `Error`
              //    de fetch, sem método `.json`, então `corpo` fica
              //    `undefined` e a mensagem cai no literal padrão acima —
              //    `criarPagamento` nunca lê `error.message` diretamente.
              // 4) `controlador?.unmount()` é a única chamada a código de
              //    terceiro dentro deste `try`. Fica de fora da conta porque
              //    o cenário que a faria lançar (desmontagem dupla) está
              //    fechado pelo `controlador = null` da limpeza somado ao
              //    `?.`. Não foi possível sustentar NEM refutar que o SDK
              //    lance ali — ele vem de CDN e não está em node_modules —
              //    então isto fica declarado, não varrido para debaixo de um
              //    "todas as fontes".
              // Por isso, ao contrário do catch de `montarBrick`, aqui NÃO dá para
              // trocar por uma frase fixa única: cada `throw` já é
              // específico e verdadeiro para o caso, e um genérico jogaria
              // fora informação que o cliente precisa (ex.: PIX vencido vs.
              // pagamento recusado pedem ações diferentes).
              onErro(
                err?.message ?? "Não foi possível gerar a cobrança.",
                terminal ? "terminal" : "recuperavel",
              );
              // Relança para o Brick saber que o envio falhou e sair do
              // estado "processando" — engolir aqui prende o botão.
              throw err;
            }
          },
        },
      });

      if (cancelado) {
        // O efeito já foi cancelado (StrictMode remontando, ou desmontagem de
        // verdade) enquanto o create() estava em voo: desmonta em vez de
        // abandonar.
        criado.unmount();
        return;
      }
      controlador = criado;
    } catch (err: any) {
      // SDK que não carregou, chave pública ausente ou create() que falhou —
      // em qualquer um destes, nenhuma cobrança chegou a ser criada.
      //
      // Achado 2 da revisão (CHECKOUT-050, #194): NUNCA usar `err?.message`
      // aqui. Quando quem rejeita é o próprio create() do SDK do Mercado
      // Pago, essa mensagem é texto do BUNDLE deles — em inglês, com
      // jargão de configuração. Um toast escondia isso em 2500ms; agora a
      // caixa de erro fica NA TELA até o cliente sair, então uma mensagem
      // de terceiro travada ali é pior que antes. `err` continua indo para
      // o console, que é onde ela serve.
      console.error("montarBrick:", err);
      if (!cancelado)
        onErro("Não foi possível carregar o pagamento.", "recuperavel");
    }
  })();

  return () => {
    cancelado = true;
    controlador?.unmount();
    controlador = null;
  };
}

/**
 * Promessas de `criarPagamento` em voo (ou já resolvidas, até o `finally`
 * limpar), por `orderId` — mesmo padrão de `promessaSdk` acima, aplicado a um
 * problema análogo: o StrictMode do React 18 monta → desmonta → remonta o
 * efeito de forma SÍNCRONA, tudo antes de qualquer microtarefa rodar. Sem
 * este cache, a segunda montagem chamaria `criarPagamento` de novo ANTES da
 * primeira resposta voltar — duas cobranças para o mesmo pedido.
 *
 * A entrada some do mapa assim que a promessa assenta (sucesso OU falha): é
 * isso que faz "Tentar de novo" (CheckoutView troca a tela de erro por um
 * `<PagamentoOnline>` NOVO, remontando o componente do zero) disparar uma
 * chamada de verdade — pelo momento em que o cliente consegue clicar, a
 * tentativa anterior já assentou e já saiu do mapa.
 */
const promessasPagamentoPix = new Map<
  string,
  ReturnType<ReturnType<typeof useOrders>["criarPagamento"]>
>();

/**
 * Dispara a cobrança PIX direto — sem Brick, sem pedir e-mail de novo.
 *
 * Pedido do dono (25/09/2026): depois de escolher "Pagar agora com PIX", o
 * cliente caía na tela do Payment Brick do Mercado Pago pedindo para
 * escolher Pix DE NOVO e digitar um e-mail que a conta já tem. Como o Brick
 * hoje só oferece PIX (`paymentMethods` em `montarBrick`, acima — cartão é
 * Fase 3.5), a Brick inteira era uma etapa a mais sem função: `email` e
 * `documento` são OPCIONAIS em `criarPagamento` (useOrders.ts) — o servidor
 * já resolve o e-mail por `body.email ?? pedido.customer_data.email ?? emailDoToken(...) ?? "sem-email@ikcous.com.br"`
 * (criar-pagamento/index.ts) — então não há nada que só o Brick soubesse
 * coletar.
 *
 * A classificação da resposta (recusado/expirado/estornado/desconhecido/QR
 * ausente) é a MESMA de `montarBrick` — ver `classificarRespostaPagamento`.
 *
 * Exportada para teste — não é API pública do componente.
 */
export function dispararPagamentoPix({
  orderId,
  criarPagamento,
  onErro,
  onPix,
}: {
  orderId: string;
  criarPagamento: ReturnType<typeof useOrders>["criarPagamento"];
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
  onPix: (pix: {
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
    ticketUrl?: string;
  }) => void;
}): () => void {
  let cancelado = false;

  let promessa = promessasPagamentoPix.get(orderId);
  if (!promessa) {
    promessa = criarPagamento({ orderId, metodo: "pix" });
    promessasPagamentoPix.set(orderId, promessa);
    const removerDoCache = () => {
      // Só remove se ninguém trocou a entrada por uma promessa mais nova
      // enquanto esta estava em voo (corta a corrida com uma chamada futura
      // que já tenha substituído o valor do mapa).
      if (promessasPagamentoPix.get(orderId) === promessa) {
        promessasPagamentoPix.delete(orderId);
      }
    };
    // `.then(f, f)` e não `.finally(f)`: `.finally` devolve uma promessa
    // DERIVADA que continua rejeitando quando a original rejeita — sem
    // ninguém para dar `.catch` nela, vira rejeição não tratada (medido:
    // apareceu nos testes de erro recuperável/terminal assim que este bloco
    // foi escrito com `.finally`). Os dois branches de `.then` CONSOMEM a
    // rejeição, e o resultado (usado ou não) nunca sobra pendurado.
    promessa.then(removerDoCache, removerDoCache);
  }

  promessa
    .then((r) => {
      if (cancelado) return;
      const resultado = classificarRespostaPagamento(r, true);
      if (resultado.tipo === "erro") {
        onErro(resultado.mensagem, resultado.categoria);
        return;
      }
      if (resultado.tipo === "pix") onPix(resultado.pix);
    })
    .catch((err: any) => {
      if (cancelado) return;
      // Mesmo contrato do catch de `montarBrick` (CHECKOUT-050): `.terminal`
      // vindo de `criarPagamento` (useOrders.ts) é um DADO lido do corpo do
      // 409/etc. da edge function, nunca reconstruído a partir do texto da
      // mensagem — texto que muda quebraria uma comparação por igualdade.
      const terminal = err?.terminal === true;
      onErro(
        err?.message ?? "Não foi possível gerar a cobrança.",
        terminal ? "terminal" : "recuperavel",
      );
    });

  return () => {
    cancelado = true;
  };
}

export function PagamentoOnline({
  orderId,
  onErro,
}: {
  orderId: string;
  // Mantido no contrato do componente — o CheckoutView já congela e passa
  // este valor (evita ler `finalTotal` depois que `onClearCart()` zera o
  // carrinho). Não é usado aqui: o Brick precisava dele para
  // `initialization.amount`, mas o disparo direto não manda `valor` nenhum
  // — o servidor cobra `Number(pedido.total)` lido do PRÓPRIO pedido
  // (criar-pagamento/index.ts), nunca o que o corpo da chamada informa.
  // Fica no tipo para quando o cartão via Brick voltar (Fase 3.5).
  valor: number;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
}) {
  // Achado 4 da revisão do CHECKOUT-090 (16/08/2026): `isAdmin=false`, não
  // `true` — este componente é do CLIENTE. Era inofensivo porque
  // `enabled=false` desliga o efeito inteiro antes de `isAdmin` importar
  // (useOrders.ts), mas era a mesma forma do bug que a tarefa corrigiu em
  // CheckoutView. `enabled=false` continua CORRETO aqui: este componente só
  // usa `criarPagamento` e não precisa de realtime — quem detecta a
  // confirmação de pagamento é o CheckoutView, não ele.
  const { criarPagamento } = useOrders(false, false);
  // `expiraEm` vem junto do PIX, da resposta da edge function — é o prazo que
  // está gravado na linha do pedido, o mesmo que o pg_cron vai ler.
  const [pix, setPix] = useState<{
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
    ticketUrl?: string;
  } | null>(null);

  // Padrão de ref para callback em recurso imperativo. `onErro` é tipicamente
  // um closure inline de quem consome o componente (`onErro={(m) =>
  // setErro(m)}`), e MUDA de identidade a cada re-render do pai — um toast,
  // um evento realtime do useOrders, o contador regressivo do prazo. Se
  // `onErro` estivesse nas deps do efeito abaixo, cada re-render do pai
  // disparava `criarPagamento` de novo, silenciosamente — o mesmo defeito
  // que o comentário original descrevia para o Brick, só que sem o
  // `unmount()`/`create()` que ao menos deixava rastro de "recriação".
  //
  // A atualização do `.current` vai num `useEffect` sem deps (roda depois de
  // TODO render), não direto no corpo do componente: mutar ref durante o
  // render é erro do `eslint-plugin-react-hooks` ("Cannot access refs during
  // render") — o valor só precisa estar atualizado antes da PRÓXIMA vez que
  // a resposta de `criarPagamento` o ler, nunca durante a renderização.
  const onErroRef = useRef(onErro);
  useEffect(() => {
    onErroRef.current = onErro;
  });

  useEffect(() => {
    return dispararPagamentoPix({
      orderId,
      criarPagamento,
      onErro: (msg, categoria) => onErroRef.current(msg, categoria),
      onPix: setPix,
    });
    // `onErro` de propósito fora das deps — ver o comentário do onErroRef
    // acima. O disparo só repete se `orderId` (primitivo) ou `criarPagamento`
    // (useCallback(..., []) em useOrders.ts) mudarem de identidade — na
    // prática, só remontando o componente inteiro (CheckoutView troca a
    // tela de erro por um `<PagamentoOnline>` novo em "Tentar de novo").
  }, [orderId, criarPagamento]);

  // Brief "o app não mente quando copia" (08/09/2026): o botão chamava
  // `navigator.clipboard.writeText(...)` sem await, sem catch e sem NENHUM
  // aviso — nem quando dava certo. Agora `copiarParaClipboard` (mesma peça do
  // painel) diz o que aconteceu de verdade: sucesso muda o próprio texto do
  // botão por ~2s (o botão está no centro da atenção nesta tela — um toast
  // sumiria sem ninguém notar); falha mostra o código num campo selecionável,
  // porque sem cópia automática o cliente ainda precisa conseguir pagar.
  const [pixCopiado, setPixCopiado] = useState(false);
  const [pixFalhouCopia, setPixFalhouCopia] = useState(false);

  const handleCopiarPix = async (codigo: string) => {
    // Laudo Opus A-1 (08/09/2026): `montarBrick` só recusa o PIX quando
    // faltam OS DOIS campos (linha ~234) — a edge extrai `qr_code` e
    // `qr_code_base64` em separado, então o estado `{qrCodeBase64,
    // qrCode: undefined}` é alcançável. Sem esta guarda,
    // `copiarParaClipboard("")` resolveria `true` e o botão diria "Copiado!"
    // sem ter copiado nada. O botão já não renderiza quando `!pix.qrCode`
    // (abaixo); esta é a segunda trava, para uma refatoração futura que volte
    // a renderizar o botão sem QR não reabrir o mesmo defeito.
    const ok = codigo !== "" && (await copiarParaClipboard(codigo));
    if (!ok) {
      setPixFalhouCopia(true);
      return;
    }
    setPixFalhouCopia(false);
    setPixCopiado(true);
    setTimeout(() => setPixCopiado(false), 2000);
  };

  if (pix) {
    return (
      <div className="space-y-4 rounded-2xl border border-zinc-100 bg-white p-4">
        {pix.qrCodeBase64 && (
          <img
            src={`data:image/png;base64,${pix.qrCodeBase64}`}
            alt="QR code do PIX"
            className="mx-auto size-56"
          />
        )}
        {/* Laudo Opus A-1 (08/09/2026): sem `qrCode` não existe código para
            copiar — não oferecer o botão nem o campo de falha. O cliente
            segue pelo QR acima e pelo link "Pagar pelo Mercado Pago" abaixo,
            que já são condicionais ao próprio campo existir. */}
        {pix.qrCode && (
          <>
            <button
              type="button"
              onClick={() => handleCopiarPix(pix.qrCode ?? "")}
              className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white"
            >
              <span aria-live="polite">
                {pixCopiado ? "Copiado!" : "Copiar código PIX"}
              </span>
            </button>
            {/* Laudo Opus A-2 (08/09/2026): container SEMPRE montado (vazio
                por padrão) com `role="status"`/`aria-live="polite"` — antes
                o <div> só entrava no DOM quando `pixFalhouCopia` virava true,
                e o leitor de tela precisa que a região JÁ EXISTA para
                anunciar o texto que aparece nela; inseri-la depois do fato
                silenciava exatamente o caso que precisa de aviso. */}
            <div role="status" aria-live="polite" className="space-y-1.5">
              {pixFalhouCopia && (
                <>
                  <p className="text-center text-xs text-zinc-500">
                    Não consegui copiar sozinho. Toque no código abaixo, segure
                    e copie.
                  </p>
                  <textarea
                    readOnly
                    value={pix.qrCode ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50 p-2 font-mono text-[10px] text-zinc-900"
                  />
                </>
              )}
            </div>
          </>
        )}
        {pix.ticketUrl && (
          <a
            href={pix.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-medium text-zinc-500 underline"
          >
            Pagar pelo Mercado Pago
          </a>
        )}
        <p className="text-center text-xs text-zinc-500">
          Vence às{" "}
          {new Date(pix.expiraEm).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    );
  }

  // Pedido do dono (25/09/2026): sem Brick, este espaço nunca é preenchido
  // por um script de terceiro — precisa da própria tela dizer que está
  // gerando a cobrança, ou fica em branco até o QR chegar.
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-100 bg-white p-8">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
      <p className="text-xs text-zinc-500">Gerando o QR code do Pix...</p>
    </div>
  );
}
