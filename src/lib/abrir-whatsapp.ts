/**
 * Abre um link do WhatsApp em nova aba, isolada do app (achado A8-d/L12).
 *
 * Sem `noopener`, a aba aberta herda `window.opener` e poderia navegar o app.
 * Atenção: com `noopener` o `window.open` DEVOLVE `null` mesmo quando abre —
 * por isso este helper não devolve nada, e ninguém deve testar o retorno para
 * decidir se "o popup foi bloqueado".
 */
export function abrirWhatsapp(url: string): void {
  globalThis.open(url, "_blank", "noopener,noreferrer");
}
