// @vitest-environment jsdom
//
// Bloco "Estratégias do frete local" (FreteGratisBloco): as quatro opções
// (nome, frase, qual delas está marcada, o que cada clique devolve), o estado
// que o cabeçalho mostra, o campo "A partir de" só quando a opção é "acima de
// um valor", e as duas mensagens de erro DIFERENTES (valor ilegível x valor
// zerado). Caça por mutação (25/11/2026): o teste existente só cobre a
// digitação do valor; trocar o que o clique devolve, o rótulo do cabeçalho,
// a fronteira do zero ou a ligação do erro ao campo passava em branco.
//
// Mutante equivalente anotado: `Object.is(valorDoTexto(atual), acimaDe)` ->
// `valorDoTexto(atual) === acimaDe` só difere para NaN/-0, que o pai nunca
// devolve como valor salvo.
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import type { PresetFreteGratis } from "@/lib/presets-de-frete-gratis";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(
  props: {
    preset?: PresetFreteGratis;
    acimaDe?: number;
    onEscolher?: (p: PresetFreteGratis) => void;
    onAcimaDe?: (v: number) => void;
    desabilitado?: boolean;
    mostrarCabecalho?: boolean;
  } = {},
) {
  act(() => {
    raiz.render(
      <FreteGratisBloco
        preset={props.preset ?? "desligado"}
        acimaDe={props.acimaDe ?? 0}
        onEscolher={props.onEscolher ?? vi.fn()}
        onAcimaDe={props.onAcimaDe ?? vi.fn()}
        desabilitado={props.desabilitado}
        mostrarCabecalho={props.mostrarCabecalho}
      />,
    );
  });
}

const opcoes = () => [
  ...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
];
const campo = () =>
  host.querySelector<HTMLInputElement>("#frete-gratis-acima-de");
const alerta = () => host.querySelector('[role="alert"]');

function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(campo(), texto);
    campo()?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const ORDEM: PresetFreteGratis[] = [
  "desligado",
  "acima_de_valor",
  "sempre",
  "por_produto",
];

describe("FreteGratisBloco: as quatro opções", () => {
  it("nome e frase de cada opção, na ordem", () => {
    montar();
    expect(opcoes().map((o) => o.textContent)).toEqual([
      "✓Não dar frete grátisO cliente paga o valor da entrega.",
      "✓Grátis acima de um valorPedidos a partir do valor não pagam a entrega.",
      "✓Sempre grátisNenhum pedido paga a entrega.",
      "✓Só produtos marcadosGrátis quando o carrinho tem um produto marcado com “frete grátis” no cadastro.",
    ]);
  });

  it.each(ORDEM.map((p, i) => [p, i] as const))(
    "clicar na opção %s devolve exatamente esse preset",
    (preset, indice) => {
      const onEscolher = vi.fn();
      // Começa marcando OUTRA opção, para o clique não ser "no que já está".
      montar({
        preset: preset === "desligado" ? "sempre" : "desligado",
        onEscolher,
      });
      act(() => opcoes().at(indice)?.click());
      expect(onEscolher).toHaveBeenCalledTimes(1);
      expect(onEscolher).toHaveBeenCalledWith(preset);
    },
  );

  it.each(ORDEM.map((p, i) => [p, i] as const))(
    "com o preset %s só ESSA opção está marcada",
    (preset, indice) => {
      montar({ preset, acimaDe: 100 });
      expect(opcoes().map((o) => o.getAttribute("aria-checked"))).toEqual(
        ORDEM.map((_, i) => (i === indice ? "true" : "false")),
      );
    },
  );

  it("desabilitado trava as quatro opções; habilitado deixa todas livres", () => {
    montar({ desabilitado: true });
    expect(opcoes().every((o) => o.disabled)).toBe(true);
    montar({ desabilitado: false });
    expect(opcoes().every((o) => !o.disabled)).toBe(true);
  });

  it("desabilitado também trava o campo 'A partir de'", () => {
    montar({ preset: "acima_de_valor", acimaDe: 100, desabilitado: true });
    expect(campo()?.disabled).toBe(true);
    montar({ preset: "acima_de_valor", acimaDe: 100, desabilitado: false });
    expect(campo()?.disabled).toBe(false);
  });

  it("a frase de apoio diz que vale para entrega e retirada", () => {
    montar();
    expect(host.textContent).toContain(
      "Vale para a sua entrega e para a retirada na loja.",
    );
  });
});

describe("FreteGratisBloco: o cabeçalho", () => {
  it.each([
    ["desligado", "desligado"],
    ["acima_de_valor", "acima de um valor"],
    ["sempre", "sempre grátis"],
    ["por_produto", "por produto"],
  ] as const)("com o preset %s o estado diz '%s'", (preset, rotulo) => {
    montar({ preset, acimaDe: 100 });
    expect(host.textContent).toContain("Estratégias do frete local");
    expect(host.querySelector("b")?.textContent).toBe(rotulo);
    expect(host.textContent).toContain(`estratégia: ${rotulo}`);
  });

  it("mostrarCabecalho=false some com o título e o estado, mas mantém as opções", () => {
    montar({ preset: "sempre", mostrarCabecalho: false });
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).not.toContain("estratégia:");
    expect(opcoes()).toHaveLength(4);
  });

  it("sem informar, o cabeçalho aparece (o padrão é mostrar)", () => {
    montar({ preset: "sempre" });
    expect(host.querySelector("b")?.textContent).toBe("sempre grátis");
  });
});

describe("FreteGratisBloco: o campo 'A partir de'", () => {
  it("só existe com a opção 'acima de um valor' marcada", () => {
    for (const preset of ORDEM) {
      montar({ preset, acimaDe: 100 });
      expect(campo() !== null).toBe(preset === "acima_de_valor");
    }
  });

  it("tem rótulo 'A partir de' ligado ao campo e dica de R$ 100", () => {
    montar({ preset: "acima_de_valor", acimaDe: 100 });
    const rotulo = host.querySelector<HTMLLabelElement>(
      'label[for="frete-gratis-acima-de"]',
    );
    expect(rotulo?.textContent).toBe("A partir de");
    expect(campo()?.placeholder).toBe("100");
  });

  it("é um campo de TEXTO com teclado decimal (o iPhone devolve vazio para 'number' com vírgula)", () => {
    montar({ preset: "acima_de_valor", acimaDe: 100 });
    expect(campo()?.type).toBe("text");
    expect(campo()?.inputMode).toBe("decimal");
    expect(campo()?.autocomplete).toBe("off");
  });

  it("valor inteiro aparece sem casas; zero aparece vazio", () => {
    montar({ preset: "acima_de_valor", acimaDe: 150 });
    expect(campo()?.value).toBe("150");
    montar({ preset: "acima_de_valor", acimaDe: 0 });
    expect(campo()?.value).toBe("");
  });

  it("valor com centavos aparece com vírgula e duas casas", () => {
    montar({ preset: "acima_de_valor", acimaDe: 12.5 });
    expect(campo()?.value).toBe("12,50");
  });

  it("valor inválido vindo de fora (NaN) aparece como campo vazio", () => {
    montar({ preset: "acima_de_valor", acimaDe: Number.NaN });
    expect(campo()?.value).toBe("");
  });

  it("digitar devolve ao pai o número já convertido", () => {
    const onAcimaDe = vi.fn();
    montar({ preset: "acima_de_valor", acimaDe: 100, onAcimaDe });
    digitar("49,90");
    expect(onAcimaDe).toHaveBeenLastCalledWith(49.9);
    digitar("");
    expect(onAcimaDe).toHaveBeenLastCalledWith(0);
    digitar("abc");
    expect(Number.isNaN(onAcimaDe.mock.lastCall?.[0])).toBe(true);
  });
});

describe("FreteGratisBloco: as duas mensagens de erro", () => {
  it("valor válido e maior que zero: sem erro, campo válido, sem 'describedby'", () => {
    montar({ preset: "acima_de_valor", acimaDe: 100 });
    expect(alerta()).toBeNull();
    expect(campo()?.getAttribute("aria-invalid")).toBe("false");
    expect(campo()?.hasAttribute("aria-describedby")).toBe(false);
    expect(campo()?.parentElement?.className).toContain("border-admin-border");
    expect(campo()?.parentElement?.className).not.toContain("border-red-400");
  });

  it("um centavo já vale: a fronteira do zero é só o ZERO", () => {
    montar({ preset: "acima_de_valor", acimaDe: 0.01 });
    expect(alerta()).toBeNull();
    expect(campo()?.getAttribute("aria-invalid")).toBe("false");
  });

  it("valor zerado: pede o valor e manda escolher a primeira opção, ligando o erro ao campo", () => {
    montar({ preset: "acima_de_valor", acimaDe: 0 });
    expect(alerta()?.textContent).toBe(
      "Escreva o valor. Para não dar frete grátis, escolha a primeira opção.",
    );
    expect(alerta()?.id).toBe("erro-gratis-local");
    expect(campo()?.getAttribute("aria-invalid")).toBe("true");
    expect(campo()?.getAttribute("aria-describedby")).toBe("erro-gratis-local");
    expect(campo()?.parentElement?.className).toContain("border-red-400");
  });

  it("texto que não é dinheiro: a frase é OUTRA (valor em reais, como 99,90)", () => {
    montar({ preset: "acima_de_valor", acimaDe: 100 });
    digitar("cem reais");
    expect(alerta()?.textContent).toBe("Escreva o valor em reais, como 99,90.");
    expect(campo()?.getAttribute("aria-invalid")).toBe("true");
  });

  it("texto ilegível com o pai ainda em 0: continua a frase do 'ilegível', não a do zero", () => {
    montar({ preset: "acima_de_valor", acimaDe: 0 });
    digitar("xyz");
    expect(alerta()?.textContent).toBe("Escreva o valor em reais, como 99,90.");
  });

  it("valor que chega de fora troca o texto do campo, mas o que ela digitou e já vale não é reescrito", () => {
    montar({ preset: "acima_de_valor", acimaDe: 99 });
    digitar("99,");
    // O pai devolveu 99 (igual ao que o texto produz): "99," fica como está.
    montar({ preset: "acima_de_valor", acimaDe: 99 });
    expect(campo()?.value).toBe("99,");
    // Valor DIFERENTE vindo de fora: o campo acompanha.
    montar({ preset: "acima_de_valor", acimaDe: 120 });
    expect(campo()?.value).toBe("120");
  });
});
