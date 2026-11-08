// @vitest-environment jsdom
//
// "A partir de" do frete grátis local: o campo era `type="number"`, e o Safari
// do iPhone devolve vazio para o que não entende como número ("99,90"). Vazio
// virava 0, o campo controlado apagava o que ela digitou e aparecia "Escreva o
// valor". Aqui o campo é TEXTO (como o valor da entrega no mesmo painel): "99,90",
// "99.90" e "1.234,50" valem; o que não é dinheiro não grava 0 em silêncio.
//
// O jsdom faz com `type="number"` o mesmo que o Safari: troca "99,90" por "".
// Por isso o teste reproduz o defeito sem precisar de iPhone.
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const enviados = vi.hoisted(() => [] as number[]);

/** O pai de verdade: guarda o número que o bloco devolve e o devolve de volta. */
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

describe("FreteGratisBloco — 'A partir de' aceita vírgula", () => {
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

  it("'99,90' fica no campo, vira 99.9 no pai e não mostra erro", async () => {
    await abrir();
    await digitar("99,90");
    expect(campo()?.value).toBe("99,90");
    expect(enviados.at(-1)).toBe(99.9);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["99.90", 99.9],
    ["1.234,50", 1234.5],
    ["150", 150],
  ])("'%s' vale %s", async (texto, esperado) => {
    await abrir();
    await digitar(texto);
    expect(campo()?.value).toBe(texto);
    expect(enviados.at(-1)).toBe(esperado);
  });

  it("campo apagado: o pai recebe 0 e a tela pede o valor", async () => {
    await abrir();
    await digitar("");
    expect(enviados.at(-1)).toBe(0);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Escreva o valor",
    );
  });

  it("texto que não é dinheiro não vira 0 em silêncio: o pai recebe NaN e a tela avisa", async () => {
    await abrir();
    await digitar("cem");
    expect(campo()?.value).toBe("cem");
    expect(Number.isNaN(enviados.at(-1))).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(campo()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("valor que chega de fora (config carregou, salvou) aparece no campo", async () => {
    const bloco = (acimaDe: number) => (
      <FreteGratisBloco
        preset="acima_de_valor"
        acimaDe={acimaDe}
        onEscolher={vi.fn()}
        onAcimaDe={vi.fn()}
      />
    );
    await act(async () => {
      raiz.render(bloco(0));
    });
    expect(campo()?.value).toBe("");
    await act(async () => {
      raiz.render(bloco(250));
    });
    expect(campo()?.value).toBe("250");
  });

  it("valor decimal inicial aparece com vírgula e duas casas", async () => {
    await abrir(99.9);
    expect(campo()?.value).toBe("99,90");
  });

  it("o campo é de texto com teclado decimal (não 'number')", async () => {
    await abrir();
    expect(campo()?.type).toBe("text");
    expect(campo()?.inputMode).toBe("decimal");
  });
});
