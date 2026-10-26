// Escolher o atributo da variação como o lojista faz hoje: TOCANDO a peça
// (Cor, Tamanho, Voltagem) em vez de digitar o nome. Um nome fora dos três
// passa por "Outro" e é digitado no campo livre que a peça revela.
import { act } from "react";

const TIPOS = ["Cor", "Tamanho", "Voltagem"] as const;

function grupoDoAtributo(posicao: number): HTMLElement {
  const grupo = document.querySelector<HTMLElement>(
    `[data-testid="atributo-${posicao}"]`,
  );
  if (!grupo) throw new Error(`O atributo ${posicao + 1} não está na tela.`);
  return grupo;
}

/** A peça do tipo (ou qualquer botão de valor) do atributo `posicao`, pelo texto exato. */
export function botaoDoAtributo(
  posicao: number,
  texto: string,
): HTMLButtonElement {
  const botao = [...grupoDoAtributo(posicao).querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === texto,
  );
  if (!botao) {
    throw new Error(`"${texto}" não está no atributo ${posicao + 1}.`);
  }
  return botao;
}

/**
 * Vale para o modal de variação única (`variant-name*`) e para a grade
 * (`grade-nome-*`). Só "Cor", "Tamanho" e "Voltagem" (exatamente assim) tocam
 * a peça; qualquer outro texto — inclusive "cor" em minúscula, que é o jeito de
 * provar que a trava de um grupo ignora a caixa — passa por "Outro".
 * `viaOutro` força o caminho livre: é como se chega a um nome que o seletor
 * não oferece (o produto já usa outro grupo), para provar que a trava recusa.
 */
export async function escolherAtributo(
  posicao: number,
  nome: string,
  idDoNome: string,
  digitar: (id: string, valor: string) => void | Promise<void>,
  { viaOutro = false }: { viaOutro?: boolean } = {},
): Promise<void> {
  const tipo = viaOutro ? undefined : TIPOS.find((t) => t === nome);
  await act(async () => {
    botaoDoAtributo(posicao, tipo ?? "Outro").click();
  });
  if (!tipo) await digitar(idDoNome, nome);
}

/** O tipo marcado no atributo `posicao` ("Cor", "Tamanho"…), ou null se nenhum. */
export function atributoMarcado(posicao: number): string | null {
  const marcada = grupoDoAtributo(posicao).querySelector(
    '[role="group"] button[aria-pressed="true"]',
  );
  return marcada ? (marcada.textContent ?? "").trim() : null;
}
