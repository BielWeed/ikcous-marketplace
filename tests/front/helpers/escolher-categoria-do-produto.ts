// Escolher a categoria no formulário de produto, como a lojista faz: tocar no
// campo "Categoria" (abre a folha de baixo) e tocar no cartão da categoria.
//
// Síncrono de propósito: os testes antigos chamavam isto de DENTRO de um
// `act(async () => { digitar(...); selecionar...; await espera })`, e dentro do
// `act` o React só desenha no fim. `flushSync` desenha na hora, então a folha
// existe entre um toque e outro.
import { flushSync } from "react-dom";

const texto = (el: Element) =>
  (el.textContent ?? "").replace(/\s+/g, " ").trim();

export function escolherCategoriaDoProduto(nome: string): void {
  const campo = document.getElementById("product-category");
  if (!campo) throw new Error("O campo Categoria não está na tela.");
  flushSync(() => campo.click());
  const cartao = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="dialog"] button[aria-pressed]',
    ),
  ].find((b) => texto(b) === nome);
  if (!cartao) {
    throw new Error(`Não há cartão da categoria "${nome}" na folha.`);
  }
  flushSync(() => cartao.click());
}

/** O nome que o campo mostra agora ("Escolher categoria" quando está vazio). */
export function categoriaMostradaNoCampo(): string {
  const valor = document.getElementById("product-category-valor");
  if (!valor) throw new Error("O campo Categoria não está na tela.");
  return texto(valor);
}
