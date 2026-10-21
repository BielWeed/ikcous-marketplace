import { act } from "react";
import { expect } from "vitest";

// A navegação mudou; os testes mantêm as mesmas guardas de dados,
// agora percorrendo escolha do jeito e o editor de uma página.
export async function escolherImagemPropria() {
  const botao = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Usar minha imagem",
  );
  expect(botao).toBeTruthy();
  await act(async () => botao!.click());
}

export async function abrirMaisOpcoes() {
  const resumo = [...document.querySelectorAll("summary")].find(
    (s) => s.textContent?.trim() === "Mais opções",
  );
  expect(resumo).toBeTruthy();
  if (!resumo!.parentElement!.hasAttribute("open")) {
    await act(async () => resumo!.click());
  }
}

export async function configurarTextos(ativo: boolean) {
  await abrirMaisOpcoes();
  const controle = document.querySelector<HTMLButtonElement>("#banner-textos");
  expect(controle).toBeTruthy();
  if ((controle!.getAttribute("aria-checked") === "true") !== ativo) {
    await act(async () => controle!.click());
  }
}
