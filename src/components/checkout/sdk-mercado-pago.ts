const SDK_URL = "https://sdk.mercadopago.com/js/v2";

let promessaSdk: Promise<void> | null = null;

/**
 * Carrega o SDK do Mercado Pago uma vez por sessão.
 *
 * O `promessaSdk` em módulo evita a corrida do StrictMode do React 18, que
 * monta o componente duas vezes em desenvolvimento: sem ele, duas tags de
 * script entram na página e o Brick tenta renderizar duas vezes no mesmo
 * container.
 *
 * Mora num módulo próprio (26/09/2026) porque o cartão
 * (`PagamentoComCartao.tsx`) é quem monta o Brick hoje, e o
 * `PagamentoOnline.tsx` importa o cartão — a função ficar lá fecharia um
 * ciclo de import entre os dois. `PagamentoOnline.tsx` reexporta.
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
