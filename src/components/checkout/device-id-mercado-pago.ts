/**
 * DEVICE ID DO COMPRADOR (03/10/2026) — o sinal que o antifraude do Mercado
 * Pago pede para reconhecer o dispositivo. Sem ele, um pagamento real com
 * cartão foi recusado com `status_detail: high_risk`.
 *
 * Quem cria o valor é o `security.js` do próprio Mercado Pago
 * (`window.MP_DEVICE_SESSION_ID`, doc "melhorar aprovação" da Orders API). O
 * SDK v2 NÃO o cria aqui: o script de "device profiling" que ele injeta é
 * INLINE e a CSP da loja o barra (`script-src-elem inline`) — medido em
 * 03/10/2026. Então carregamos o `security.js` à parte, com `view="checkout"`,
 * e liberamos só `https://www.mercadopago.com` em `script-src` (vercel.json).
 *
 * Três regras que não se negociam:
 * - LAZY: só quando o formulário do cartão vai ser montado. O boot do app é
 *   medido e o PIX nunca precisou disto.
 * - NUNCA BLOQUEIA o pagamento: a coleta é assíncrona e pode falhar (rede,
 *   extensão, CSP). Falha vira "sem Device ID" — o cartão segue sem ele.
 * - O valor é ENTRADA que sai do navegador para a nossa edge e vira cabeçalho
 *   HTTP: só passa se casar com o formato fechado (o MESMO de
 *   `deviceIdValido` em `supabase/functions/_shared/mercadopago.ts`).
 */

export const SECURITY_JS_URL = "https://www.mercadopago.com/v2/security.js";

/** `[A-Za-z0-9._-]`, 1..512 — medido: ~230 caracteres, só letras/dígitos/pontos. */
export function deviceIdValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^[A-Za-z0-9._-]{1,512}$/.test(valor);
}

/**
 * O Device ID que o `security.js` já criou, ou `null`. Lido no INSTANTE do
 * envio (a coleta é assíncrona e não se espera por ela): ausente ou fora do
 * formato é `null`, e quem chama manda o pagamento sem o campo.
 */
export function lerDeviceIdDoMercadoPago(): string | null {
  const valor = (globalThis as { MP_DEVICE_SESSION_ID?: unknown })
    .MP_DEVICE_SESSION_ID;
  return deviceIdValido(valor) ? valor : null;
}

/**
 * Anexa o `security.js` à página UMA vez e volta na hora (nada a esperar).
 *
 * A fonte da verdade do "já carreguei" é a própria tag no DOM: StrictMode,
 * "Tentar outro cartão" e módulo recarregado chamam de novo e não duplicam. Se
 * o script falha (rede, extensão, bloqueio), a tag morta é REMOVIDA — senão
 * nenhuma tentativa futura voltaria a carregá-lo — e o erro é engolido. Nunca
 * lança: o formulário do cartão e o PIX não dependem disto.
 */
export function carregarDeviceIdMercadoPago(): void {
  try {
    if (typeof document === "undefined") return;
    if (document.querySelector("script[data-mp-device-id]")) return;

    const tag = document.createElement("script");
    tag.src = SECURITY_JS_URL;
    tag.async = true;
    // O `security.js` lê este atributo para saber de que parte do fluxo é a
    // coleta ("checkout" enriquece o sinal do antifraude).
    tag.setAttribute("view", "checkout");
    tag.dataset.mpDeviceId = "1";
    tag.addEventListener("error", () => tag.remove());
    document.head.appendChild(tag);
  } catch {
    // Sem Device ID o pagamento segue — nunca derruba o formulário.
  }
}
