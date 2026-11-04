// @vitest-environment jsdom
//
// Rodada 5, achado 11: a ferramenta "Teste o CEP de um cliente" dizia "paga
// R$ X", mas ela só conhece a TAXA da entrega, não as regras de frete grátis
// (ela não recebe o preset). Com "Sempre grátis", o cliente não paga, e a
// prévia "Como fica para o cliente" da mesma tela mostra "Grátis" — as duas
// se contradiziam. Agora o teste diz o que sabe: quanto a entrega custa quando
// nenhuma regra de frete grátis se aplica. Nenhum valor cobrado muda: é texto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function testarCep(valor: number, cep: string): string {
  act(() => {
    raiz.render(
      <FreteLocalBloco
        valor={valor}
        onValor={() => {}}
        faixa=""
        onFaixa={() => {}}
        coverage="national"
        onCoverage={() => {}}
        cidade="Uberlândia"
        uf="MG"
        cepDaLoja="38400-100"
      />,
    );
  });
  const escolher = Array.from(
    hospedeiro.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
  ).find((b) => (b.textContent ?? "").includes("Escolher CEPs"));
  act(() => {
    escolher?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const campo = hospedeiro.querySelector<HTMLInputElement>("#cep-de-teste");
  const escrever = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    escrever?.call(campo, cep);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return hospedeiro.querySelector('[role="status"]')?.textContent ?? "";
}

describe("teste de CEP do frete local — não afirma que o cliente paga", () => {
  it("com taxa: diz que a entrega custa R$ X QUANDO nenhuma regra de grátis se aplica", () => {
    const texto = testarCep(10, "38400-999");
    expect(texto).toContain(
      "a entrega custa R$ 10 quando nenhuma regra de frete grátis se aplica",
    );
    expect(texto).not.toMatch(/\bpaga\b/);
  });

  it("taxa com centavos usa vírgula", () => {
    expect(testarCep(7.5, "38400-999")).toContain(
      "a entrega custa R$ 7,50 quando nenhuma regra de frete grátis se aplica",
    );
  });

  it("controle: taxa zero continua dizendo 'entrega grátis'", () => {
    const texto = testarCep(0, "38400-999");
    expect(texto).toContain("entrega grátis");
    expect(texto).not.toContain("R$ 0");
  });

  it("controle: CEP fora da entrega continua 'Fica de fora' e não fala de valor", () => {
    const texto = testarCep(10, "38500-123");
    expect(texto).toContain("Fica de fora da sua entrega");
    expect(texto).not.toContain("R$");
  });
});
