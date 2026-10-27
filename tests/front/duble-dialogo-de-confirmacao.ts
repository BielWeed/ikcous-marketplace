// Lote 230: as perguntas de dinheiro do painel (devolver, estornar, cancelar
// pedido, concluir devolução) deixaram de usar o `confirm()` do navegador e
// passaram a abrir a janela do app (`useConfirmarAcao`). Os testes antigos
// decidiam o "sim"/"não" por um dublê de `confirm` e liam dele o TEXTO da
// pergunta. Este dublê liga as duas coisas sem mexer no que cada teste
// afirma: quando a janela abre, lê o texto que a PESSOA lê (a descrição),
// entrega-o ao `globalThis.confirm` (o dublê do teste) e toca o botão que o
// dublê mandou -- o da ação para sim, "Voltar" para não. Se a janela nunca
// abrir, o dublê nunca é chamado e as asserções `toHaveBeenCalledTimes` dos
// testes falham: não esconde nada. Os testes NOVOS do lote 230 não usam
// este dublê: eles provam que `confirm` não é chamado.
import { act } from "react";

let observador: MutationObserver | null = null;

function responderSeHouverJanela() {
  const janela = document.querySelector<HTMLElement>(
    '[data-testid="confirmar-acao"]',
  );
  if (!janela || janela.dataset.respondida === "1") return;
  janela.dataset.respondida = "1";
  const texto =
    janela.querySelector('[data-slot="alert-dialog-description"]')
      ?.textContent ?? "";
  const sim = globalThis.confirm(texto);
  const botoes = Array.from(janela.querySelectorAll("button"));
  const botao = sim ? botoes[botoes.length - 1] : botoes[0];
  act(() => {
    botao?.click();
  });
}

export function ligarDialogoDeConfirmacao() {
  observador?.disconnect();
  observador = new MutationObserver(responderSeHouverJanela);
  observador.observe(document.body, { childList: true, subtree: true });
}

export function desligarDialogoDeConfirmacao() {
  observador?.disconnect();
  observador = null;
}
