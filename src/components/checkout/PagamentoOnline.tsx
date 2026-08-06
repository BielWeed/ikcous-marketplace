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
      // Zera para uma tentativa futura poder recomeçar — senão a página inteira
      // fica presa num erro de rede momentâneo.
      promessaSdk = null;
      reject(new Error("Não foi possível carregar o pagamento."));
    });

    if (!existente) document.head.appendChild(tag);
  });

  return promessaSdk;
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
  const container = useRef<HTMLDivElement>(null);
  const jaMontou = useRef(false);
  // `expiraEm` vem junto do PIX, da resposta da edge function — é o prazo que
  // está gravado na linha do pedido, o mesmo que o pg_cron vai ler.
  const [pix, setPix] = useState<{
    qrCodeBase64?: string;
    qrCode?: string;
    expiraEm: string;
  } | null>(null);

  useEffect(() => {
    // Guarda contra o duplo mount do StrictMode: sem ela o Brick renderiza
    // duas vezes e a segunda sobrescreve o container vazio.
    if (jaMontou.current) return;
    jaMontou.current = true;

    let cancelado = false;

    (async () => {
      try {
        await carregarSdkMercadoPago();
        if (cancelado) return;

        const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
        if (!publicKey) throw new Error("Pagamento indisponível.");

        // @ts-expect-error o SDK entra pelo global
        const mp = new globalThis.MercadoPago(publicKey, { locale: "pt-BR" });

        await mp.bricks().create("payment", "mp-container", {
          initialization: { amount: valor },
          customization: {
            paymentMethods: { bankTransfer: "all", creditCard: "all" },
          },
          callbacks: {
            onReady: () => {},
            onError: (erro: unknown) => {
              console.error("brick:", erro);
              onErro("Não foi possível carregar o pagamento.");
            },
            onSubmit: async ({
              formData,
            }: { formData: Record<string, any> }) => {
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
              if (ehPix) {
                setPix({
                  qrCodeBase64: r.qrCodeBase64,
                  qrCode: r.qrCode,
                  expiraEm: r.expiraEm,
                });
              }
            },
          },
        });
      } catch (err: any) {
        if (!cancelado)
          onErro(err?.message ?? "Não foi possível carregar o pagamento.");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [orderId, valor, criarPagamento, onErro]);

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

  return <div id="mp-container" ref={container} />;
}
