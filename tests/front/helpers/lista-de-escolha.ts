// Escolher na lista de escolha do painel (o lugar dos `<select>`), como a
// lojista faz: tocar no campo (abre a folha no celular ou o popover no
// computador) e tocar na opção. É o substituto de `fireEvent.change` no
// `<select>` nos testes das telas.
//
// Contrato com o componente (`primitivos/lista-de-escolha`): o botão do campo
// tem o `id`, `aria-haspopup="listbox"` e `data-valor`; a lista tem o id
// `${id}-lista`; cada opção tem `data-valor` e `data-rotulo`.
//
// Síncrono de propósito, como `escolher-categoria-do-produto.ts`: `flushSync`
// desenha na hora, então a lista existe entre um toque e outro mesmo quando o
// teste chama isto de dentro de um `act`.
//
// Lança erro CLARO quando o campo não está na tela, a opção não existe ou
// está desabilitada: o teste nunca passa "escolhendo" o que a lojista não vê.
import { flushSync } from "react-dom";

export interface OpcaoVista {
  readonly valor: string;
  readonly rotulo: string;
  readonly desabilitada: boolean;
}

function campo(id: string): HTMLButtonElement {
  const botao = document.getElementById(id);
  if (
    !(botao instanceof HTMLButtonElement) ||
    botao.getAttribute("aria-haspopup") !== "listbox"
  ) {
    throw new Error(`A lista de escolha "${id}" não está na tela.`);
  }
  return botao;
}

function abrir(id: string): HTMLElement {
  const botao = campo(id);
  if (botao.disabled) {
    throw new Error(`A lista de escolha "${id}" está desabilitada.`);
  }
  if (botao.getAttribute("aria-expanded") !== "true") {
    flushSync(() => botao.click());
  }
  const lista = document.getElementById(`${id}-lista`);
  if (!lista) {
    throw new Error(`A lista de escolha "${id}" não abriu ao tocar no campo.`);
  }
  return lista;
}

function fechar(lista: HTMLElement): void {
  flushSync(() => {
    lista.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

function opcoesDe(lista: HTMLElement): HTMLElement[] {
  return [...lista.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Escolhe a opção de `valor` ("" vale: "Não informar" é opção de verdade). */
export function escolherNaLista(id: string, valor: string): void {
  const lista = abrir(id);
  const opcoes = opcoesDe(lista);
  const alvo = opcoes.find((o) => o.dataset.valor === valor);
  if (!alvo) {
    const existentes = opcoes
      .map((o) => `"${o.dataset.valor}" (${o.dataset.rotulo})`)
      .join(", ");
    fechar(lista);
    throw new Error(
      `Não há a opção "${valor}" na lista "${id}". As opções são: ${existentes || "nenhuma"}.`,
    );
  }
  if (alvo.getAttribute("aria-disabled") === "true") {
    fechar(lista);
    throw new Error(
      `A opção "${valor}" (${alvo.dataset.rotulo}) da lista "${id}" está desabilitada.`,
    );
  }
  flushSync(() => alvo.click());
}

/** As opções como a lojista as vê. Abre a lista para ler e fecha de novo. */
export function opcoesDaLista(id: string): OpcaoVista[] {
  const lista = abrir(id);
  const lidas = opcoesDe(lista).map((o) => ({
    valor: o.dataset.valor ?? "",
    rotulo: o.dataset.rotulo ?? "",
    desabilitada: o.getAttribute("aria-disabled") === "true",
  }));
  fechar(lista);
  return lidas;
}

/** O valor que o campo fechado mostra ("" = placeholder ou "Não informar"). */
export function valorDaLista(id: string): string {
  return campo(id).dataset.valor ?? "";
}
