import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import { useOrders } from "@/hooks/useOrders";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { useEffect, useRef, useState } from "react";
import { IconePix } from "@/components/checkout/IconesDePagamento";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";

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

/**
 * Monta o Payment Brick e devolve a função de desmontagem do efeito.
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

              // A-1 da revisão final, vocabulário atualizado na CHECKOUT-080
              // (#213): recusa é resultado normal de um pagamento CRIADO (o
              // MP responde 201), não erro HTTP — criarPagamento devolve
              // `ok`. Sem olhar `r.statusPagamento`, um cartão recusado não
              // avisava nada, e a troca para PIX reconsultava a MESMA
              // cobrança recusada sem QR. `statusPagamento` agora vem no
              // vocabulário FECHADO do banco ('aguardando'/'pago'/
              // 'recusado'/'expirado'/'estornado' — useOrders.ts,
              // `StatusPagamentoConhecido`), não mais no vocabulário cru do
              // MP: a edge function já traduziu.
              if (r.statusPagamento === "recusado") {
                // Nem "outro cartão" nem "pague com PIX" cabem aqui: cartão
                // está desligado no Brick (só PIX, ver comentário acima), e
                // `podeCobrar` (criar-pagamento/index.ts) manda para
                // `reconsultar` sempre que o pedido já tem
                // gateway_payment_id — o que devolve o status da MESMA
                // cobrança recusada, sem criar outra. Qualquer nova
                // tentativa neste pedido bate na mesma recusa até expirar.
                // 'recusado' cobre os dois desfechos que o vocabulário
                // clássico separava em "rejected"/"cancelled" — este banco
                // não tem um valor 'cancelado' distinto de 'recusado'
                // (ver o comentário de MAPA_STATUS_ORDER em
                // supabase/functions/_shared/mercadopago.ts).
                throw new ErroPagamentoTerminal(
                  "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
                );
              }
              if (r.statusPagamento === "expirado") {
                // CHECKOUT-080 (#213): antes desta tarefa o vocabulário
                // clássico não tinha como representar 'expired' — caía no
                // default genérico abaixo. Com nome próprio, dá para dizer
                // ao cliente o que aconteceu de fato: o QR deste PIX venceu
                // no Mercado Pago (não necessariamente porque a reserva de
                // 30 min do PEDIDO também venceu — os dois prazos podem
                // divergir, ver expiracaoRealinhavel em
                // criar-pagamento/index.ts). `reconsultar` devolve a MESMA
                // order vencida para sempre: só um pedido novo gera um QR
                // novo.
                throw new ErroPagamentoTerminal(
                  "O prazo deste PIX venceu antes do pagamento ser confirmado. Faça um pedido novo para gerar um QR code novo.",
                );
              }
              if (r.statusPagamento === "estornado") {
                // CHECKOUT-080 (#213): também sem representação no
                // vocabulário clássico antes desta tarefa. Um estorno
                // desfaz um pagamento que chegou a ser aprovado — não há
                // "tentar de novo" que reverta isso para o MESMO pedido.
                throw new ErroPagamentoTerminal(
                  "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
                );
              }
              const statusConhecido =
                r.statusPagamento === "aguardando" ||
                r.statusPagamento === "pago";
              if (!statusConhecido) {
                // Rede de segurança OBRIGATÓRIA (item 4 da CHECKOUT-080,
                // #213): status novo/desconhecido do MP não pode virar
                // sucesso silencioso — e, como os três ramos terminais
                // acima, reconsultar não muda o que o MP já respondeu. É
                // esta checagem que pegou a classe inteira de defeito desta
                // tarefa (o backend falando um vocabulário que o front não
                // conhecia) — não pode ser afrouxada.
                throw new ErroPagamentoTerminal(
                  "Não foi possível confirmar o pagamento.",
                );
              }

              if (ehPix) {
                if (!r.qrCode && !r.qrCodeBase64) {
                  // Nunca desmonta o Brick sem QR de verdade — sem QR o
                  // cliente ficaria preso numa tela vazia, sem volta, com
                  // o pedido morrendo em 30 min de reserva.
                  throw new Error("Não foi possível gerar o QR code do PIX.");
                }
                // O Brick some do DOM quando o JSX troca para o QR — desmonta
                // ANTES de trocar, senão a próxima montagem (voltar ao
                // checkout sem recarregar a página) esbarra em "Brick
                // already initialized".
                controlador?.unmount();
                controlador = null;
                onPix({
                  qrCodeBase64: r.qrCodeBase64,
                  qrCode: r.qrCode,
                  expiraEm: r.expiraEm,
                  ticketUrl: r.ticketUrl,
                });
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

export function PagamentoOnline({
  orderId,
  valor,
  onErro,
}: {
  orderId: string;
  valor: number;
  onErro: (msg: string, categoria: CategoriaErroPagamento) => void;
}) {
  const { criarPagamento } = useOrders(false, false);
  const [pix, setPix] = useState<{
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
    ticketUrl?: string;
  } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [pixCopiado, setPixCopiado] = useState(false);
  const [pixFalhouCopia, setPixFalhouCopia] = useState(false);
  const onErroRef = useRef(onErro);
  const emVoo = useRef<ReturnType<typeof criarPagamento> | null>(null);
  useEffect(() => {
    onErroRef.current = onErro;
  });

  // O pedido já existe. Consultar/criar o Pix por seu ID evita o formulário
  // redundante do Brick; no servidor, a reconsulta devolve a MESMA cobrança.
  // O ref também compartilha a chamada entre os dois efeitos do StrictMode.
  useEffect(() => {
    let ativo = true;
    const promessa =
      emVoo.current ?? criarPagamento({ orderId, metodo: "pix" });
    emVoo.current = promessa;
    void (async () => {
      try {
        const resposta = await promessa;
        if (!ativo) return;
        if (resposta.statusPagamento === "pago") {
          setConfirmando(true);
          return;
        }
        const terminais = new Map([
          ["recusado", "Este Pix foi recusado. Consulte o pedido para continuar."],
          ["expirado", "O prazo deste Pix terminou. Consulte o pedido antes de tentar outra compra."],
          ["estornado", "Este pagamento foi estornado. Fale com a loja."],
        ]);
        const mensagemTerminal = terminais.get(resposta.statusPagamento);
        if (mensagemTerminal) throw new ErroPagamentoTerminal(mensagemTerminal);
        if (resposta.statusPagamento !== "aguardando") {
          throw new ErroPagamentoTerminal("Não foi possível confirmar o estado deste Pix. Consulte o pedido.");
        }
        if (!resposta.qrCode && !resposta.qrCodeBase64) {
          throw new Error("O QR Code ainda não está disponível. Tente novamente para consultar o mesmo pedido.");
        }
        setPix({
          qrCodeBase64: resposta.qrCodeBase64,
          qrCode: resposta.qrCode,
          expiraEm: resposta.expiraEm,
          ticketUrl: resposta.ticketUrl,
        });
      } catch (erro) {
        if (ativo) {
          const e = erro as Error & { terminal?: boolean };
          onErroRef.current(
            e.message || "Não foi possível consultar o Pix deste pedido.",
            e instanceof ErroPagamentoTerminal || e.terminal === true
              ? "terminal"
              : "recuperavel",
          );
        }
      } finally {
        if (emVoo.current === promessa) emVoo.current = null;
      }
    })();
    return () => {
      ativo = false;
    };
  }, [orderId, criarPagamento]);

  const handleCopiarPix = async (codigo: string) => {
    const ok = codigo !== "" && (await copiarParaClipboard(codigo));
    if (!ok) {
      setPixFalhouCopia(true);
      return;
    }
    setPixFalhouCopia(false);
    setPixCopiado(true);
    setTimeout(() => setPixCopiado(false), 2000);
  };

  if (!pix) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-2xl border border-zinc-100 bg-white p-5 text-sm text-zinc-600">
        <Loader2 className="size-5 animate-spin text-[#32BCAD]" aria-hidden="true" />
        {confirmando ? "Pagamento recebido. Confirmando o pedido…" : "Consultando o Pix deste pedido…"}
      </div>
    );
  }

  return (
    <section aria-label="Pagar com Pix" className="overflow-hidden rounded-[24px] border border-zinc-100 bg-white shadow-[0_14px_40px_-28px_rgba(0,0,0,.3)]">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#E6F8F5] text-[#238F85]">
            <IconePix className="size-6" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Pagar com Pix</h2>
            <p className="text-[11px] text-zinc-500">Pedido #{orderId.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>
        <strong className="text-base font-bold tabular-nums text-zinc-900">
          {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </strong>
      </div>
      <div className="space-y-4 px-5 py-5">
        <p className="text-center text-[13px] leading-relaxed text-zinc-600">
          Abra o app do seu banco e escaneie o QR Code. Também pode copiar o código abaixo.
        </p>
        {pix.qrCodeBase64 && (
          <div className="mx-auto w-fit rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
            <img
              src={`data:image/png;base64,${pix.qrCodeBase64}`}
              alt="QR Code Pix deste pedido"
              className="size-52 max-w-full object-contain"
            />
          </div>
        )}
        {pix.qrCode && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-zinc-500">Pix copia e cola</p>
            <p className="max-h-16 overflow-hidden break-all rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-600">
              {pix.qrCode}
            </p>
            <button
              type="button"
              onClick={() => handleCopiarPix(pix.qrCode ?? "")}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-4 py-2.5 text-[13px] font-semibold text-white active:scale-[.99]"
            >
              {pixCopiado ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span aria-live="polite">{pixCopiado ? "Código copiado" : "Copiar código Pix"}</span>
            </button>
            <div role="status" aria-live="polite">
              {pixFalhouCopia && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-600">A cópia automática falhou. Selecione e copie o código:</p>
                  <textarea readOnly value={pix.qrCode} onFocus={(e) => e.currentTarget.select()} rows={3}
                    className="w-full resize-none rounded-xl border border-zinc-200 p-2 font-mono text-[11px]" />
                </div>
              )}
            </div>
          </div>
        )}
        {pix.ticketUrl && (
          <a href={pix.ticketUrl} target="_blank" rel="noopener noreferrer"
            className="block text-center text-xs font-semibold text-[#238F85] underline underline-offset-2">
            Abrir no Mercado Pago
          </a>
        )}
      </div>
      <div className="flex items-start gap-2 border-t border-zinc-100 bg-zinc-50/70 px-5 py-3.5 text-[11px] leading-relaxed text-zinc-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#238F85]" aria-hidden="true" />
        <p>
          O pagamento será confirmado automaticamente.
          {pix.expiraEm && !Number.isNaN(Date.parse(pix.expiraEm)) && (
            <> Este código vale até <time dateTime={pix.expiraEm}>{new Date(pix.expiraEm).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</time>.</>
          )}
        </p>
      </div>
    </section>
  );
}
