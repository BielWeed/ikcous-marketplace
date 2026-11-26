// @vitest-environment jsdom
//
// "A partir de" do frete grátis local — duas bordas do texto digitado que as
// provas vizinhas não pisam:
//  - "0" é dinheiro (zero reais), não texto inválido: o pai recebe 0 e a tela
//    pede o valor (mensagem de "escreva o valor"), nunca "como 99,90";
//  - só espaços valem como campo vazio (0), não como texto que não é dinheiro
//    (NaN): quem apertou a barra de espaço não ganha a mensagem de formato.
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enviados = vi.hoisted(() => [] as number[]);

function Pai({ inicial }: { readonly inicial: number }) {
  const [acimaDe, setAcimaDe] = useState(inicial);
  return (
    <FreteGratisBloco
      preset="acima_de_valor"
      acimaDe={acimaDe}
      onEscolher={vi.fn()}
      onAcimaDe={(valor) => {
        enviados.push(valor);
        setAcimaDe(valor);
      }}
    />
  );
}

describe("FreteGratisBloco — zero e espaços no 'A partir de'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    enviados.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const campo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#frete-gratis-acima-de");
  const alerta = () =>
    hospedeiro.querySelector('[role="alert"]')?.textContent ?? "";

  async function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo(), texto);
      campo()?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function abrir(inicial = 100) {
    await act(async () => {
      raiz.render(<Pai inicial={inicial} />);
    });
  }

  it("'0' chega ao pai como 0 (número), fica no campo e pede o valor", async () => {
    await abrir();
    await digitar("0");
    expect(enviados.at(-1)).toBe(0);
    expect(campo()?.value).toBe("0");
    expect(alerta()).toContain("Escreva o valor.");
    expect(alerta()).not.toContain("como 99,90");
    expect(campo()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("só espaços valem como campo vazio: 0 para o pai e a mensagem de 'escreva o valor'", async () => {
    await abrir();
    await digitar("   ");
    expect(enviados.at(-1)).toBe(0);
    expect(alerta()).toContain("Escreva o valor.");
    expect(alerta()).not.toContain("como 99,90");
  });

  it("controle: texto que não é dinheiro continua dando NaN e a mensagem de formato", async () => {
    await abrir();
    await digitar("abc");
    expect(Number.isNaN(enviados.at(-1))).toBe(true);
    expect(alerta()).toContain("como 99,90");
  });
});
