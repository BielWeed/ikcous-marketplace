// UI-191 (G10): o cancelamento do pedido deixou de perguntar pelo `confirm()`
// do navegador e passou a abrir a caixa de confirmação da casa (AlertDialog).
// Estes testes sempre decidiram o "sim"/"não" por um dublê de `confirm` e
// leram dele o TEXTO da pergunta. Este dublê liga as duas coisas sem mexer no
// que cada teste afirma: quando a caixa abre, ele lê o texto que a PESSOA lê
// (a descrição da caixa), entrega-o ao `globalThis.confirm` (o dublê do teste)
// e toca o botão que o dublê mandou -- "Cancelar pedido" para sim, "Manter
// pedido" para não. Se a caixa nunca abrir, o dublê nunca é chamado e as
// asserções `toHaveBeenCalledTimes(1)` dos testes falham: não esconde nada.
import { act } from "react";

let observador: MutationObserver | null = null;

function responderSeHouverCaixa() {
  const caixa = document.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!caixa || caixa.dataset.respondida === "1") return;
  const texto =
    caixa.querySelector('[data-slot="alert-dialog-description"]')
      ?.textContent ?? "";
  // Só a caixa de cancelamento (a de "descartar avaliação" é outra pergunta).
  if (
    !caixa
      .querySelector('[data-slot="alert-dialog-title"]')
      ?.textContent?.includes("Cancelar este pedido")
  ) {
    return;
  }
  caixa.dataset.respondida = "1";
  const sim = globalThis.confirm(texto);
  const botao = Array.from(caixa.querySelectorAll("button")).find(
    (b) => b.textContent === (sim ? "Cancelar pedido" : "Manter pedido"),
  );
  act(() => {
    botao?.click();
  });
}

export function ligarCaixaDeCancelamento() {
  observador?.disconnect();
  observador = new MutationObserver(responderSeHouverCaixa);
  observador.observe(document.body, { childList: true, subtree: true });
}

export function desligarCaixaDeCancelamento() {
  observador?.disconnect();
  observador = null;
}
