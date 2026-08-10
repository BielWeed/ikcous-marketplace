import { useOrders } from "@/hooks/useOrders";
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
  onErro: (msg: string) => void;
  onPix: (pix: {
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
  }) => void;
}): () => void {
  let cancelado = false;
  let controlador: { unmount: () => void } | null = null;

  (async () => {
    try {
      await carregarSdkMercadoPago();
      if (cancelado) return;

      const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
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
            onErro("Não foi possível carregar o pagamento.");
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

              // A-1 da revisão final: recusa é resultado normal de um
              // pagamento CRIADO (o MP responde 201), não erro HTTP —
              // criarPagamento devolve `ok`. Sem olhar `r.status`, um
              // cartão recusado não avisava nada, e a troca para PIX
              // reconsultava a MESMA cobrança recusada sem QR. O `status`
              // volta CRU do Mercado Pago — comparado contra os valores
              // dele, nunca traduzido para o vocabulário do banco.
              if (r.status === "rejected" || r.status === "cancelled") {
                throw new Error(
                  "Pagamento recusado. Tente outro cartão ou pague com PIX.",
                );
              }
              const statusConhecido = [
                "pending",
                "in_process",
                "approved",
                "authorized",
              ].includes(r.status);
              if (!statusConhecido) {
                // Status novo do MP não pode virar sucesso silencioso.
                throw new Error("Não foi possível confirmar o pagamento.");
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
                });
              }
            } catch (err: any) {
              // As quatro mensagens de criarPagamento (useOrders.ts:974-980)
              // só chegam ao cliente se saírem por aqui — sem este catch, a
              // rejeição desaparece dentro do próprio SDK e a tela fica muda.
              onErro(err?.message ?? "Não foi possível gerar a cobrança.");
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
      if (!cancelado)
        onErro(err?.message ?? "Não foi possível carregar o pagamento.");
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
  onErro: (msg: string) => void;
}) {
  const { criarPagamento } = useOrders(false, true);
  // `expiraEm` vem junto do PIX, da resposta da edge function — é o prazo que
  // está gravado na linha do pedido, o mesmo que o pg_cron vai ler.
  const [pix, setPix] = useState<{
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
  } | null>(null);

  // Padrão de ref para callback em recurso imperativo. `onErro` é tipicamente
  // um closure inline de quem consome o componente (`onErro={(m) =>
  // setErro(m)}`), e MUDA de identidade a cada re-render do pai — um toast,
  // um evento realtime do useOrders, o contador regressivo do prazo. Se
  // `onErro` estivesse nas deps do efeito abaixo, cada re-render do pai
  // desmontaria o Brick vivo (perdendo o formulário e o que o cliente já
  // digitou) e recriaria do zero, silenciosamente — sem estourar
  // ALREADY_INITIALIZED, porque o unmount roda antes do create seguinte.
  //
  // A atualização do `.current` vai num `useEffect` sem deps (roda depois de
  // TODO render), não direto no corpo do componente: mutar ref durante o
  // render é erro do `eslint-plugin-react-hooks` ("Cannot access refs during
  // render") — o valor só precisa estar atualizado antes da PRÓXIMA vez que
  // um callback assíncrono do Brick o ler, nunca durante a renderização.
  const onErroRef = useRef(onErro);
  useEffect(() => {
    onErroRef.current = onErro;
  });

  useEffect(() => {
    return montarBrick({
      orderId,
      valor,
      criarPagamento,
      onErro: (msg) => onErroRef.current(msg),
      onPix: setPix,
    });
    // `onErro` de propósito fora das deps — ver o comentário do onErroRef
    // acima. O Brick fica vivo enquanto `orderId`/`valor` (primitivos) e
    // `criarPagamento` (useCallback(..., []) em useOrders.ts) não mudarem.
  }, [orderId, valor, criarPagamento]);

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
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(pix.qrCode ?? "")}
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white"
        >
          Copiar código PIX
        </button>
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

  return <div id="mp-container" />;
}
