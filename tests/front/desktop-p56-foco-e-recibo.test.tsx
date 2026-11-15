// @vitest-environment jsdom
//
// Uso de PC (P56): foco do teclado invisível no frete. Os campos de valor/prazo/mínimo/
//    desconto têm `focus:outline-none focus:ring-0` e ficam dentro de uma
//    "caixa" que não mostrava foco nenhum: quem navega por Tab no computador
//    não via onde estava. A caixa (o contêiner do input) ganha um anel só no
//    PC (`lg:`): no celular/tablet o toque no campo continua sem anel.
//
// O celular fica intacto: cada caixa tem as classes SEM prefixo congeladas
// como lista literal (nunca comparadas com o histórico do git).
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOCO_NO_PC = ["lg:focus-within:ring-2", "lg:focus-within:ring-sky-300"];

/** As classes do elemento, em lista. */
const classesDe = (el: Element) =>
  (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

/** Só as classes que valem no celular: sem `lg:`. */
const semPrefixo = (el: Element) =>
  classesDe(el).filter((c) => !c.startsWith("lg:"));

/** A regra do teste: todas as classes esperadas, escritas por inteiro. */
const temTodas = (classes: readonly string[], esperadas: readonly string[]) =>
  esperadas.every((c) => classes.includes(c));

describe("o verificador do teste (mutantes em cópia da lista de classes)", () => {
  const real = [
    "flex",
    "rounded-xl",
    "lg:focus-within:ring-2",
    "lg:focus-within:ring-sky-300",
  ];

  it("a lista certa passa", () => {
    expect(temTodas(real, FOCO_NO_PC)).toBe(true);
  });

  it("mutante 1: sem a classe nova reprova", () => {
    const mutante = real.filter((c) => c !== "lg:focus-within:ring-sky-300");
    expect(temTodas(mutante, FOCO_NO_PC)).toBe(false);
  });

  it("mutante 2: sem o prefixo `lg:` (anel também no celular) reprova", () => {
    const mutante = real.map((c) => c.replace(/^lg:/, ""));
    expect(temTodas(mutante, FOCO_NO_PC)).toBe(false);
  });
});

describe("foco do teclado no frete: a caixa do campo acende só no PC", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  const caixaDe = (id: string) => {
    const campo = host.querySelector<HTMLInputElement>(`#${id}`);
    if (!campo) throw new Error(`campo '${id}' não encontrado`);
    return campo.parentElement as HTMLElement;
  };

  it("entrega própria: valor e prazo", () => {
    act(() =>
      raiz.render(
        <FreteLocalBloco
          valor={10}
          onValor={vi.fn()}
          faixa=""
          onFaixa={vi.fn()}
          coverage="national"
          onCoverage={vi.fn()}
          dias="1"
          onDias={vi.fn()}
        />,
      ),
    );
    const casca = [
      "flex",
      "min-h-11",
      "cursor-text",
      "items-center",
      "gap-1.5",
      "rounded-xl",
      "border",
      "border-admin-border",
      "bg-admin-surface",
      "px-4",
      "py-2",
    ];
    for (const id of ["local-delivery-fee", "local-delivery-days"]) {
      const caixa = caixaDe(id);
      expect(caixa.tagName).toBe("LABEL");
      expect(temTodas(classesDe(caixa), FOCO_NO_PC)).toBe(true);
      expect(semPrefixo(caixa)).toEqual(casca);
    }
  });

  it("frete grátis local: 'A partir de'", () => {
    act(() =>
      raiz.render(
        <FreteGratisBloco
          preset="acima_de_valor"
          acimaDe={100}
          onEscolher={vi.fn()}
          onAcimaDe={vi.fn()}
        />,
      ),
    );
    const caixa = caixaDe("frete-gratis-acima-de");
    expect(temTodas(classesDe(caixa), FOCO_NO_PC)).toBe(true);
    expect(semPrefixo(caixa)).toEqual([
      "flex",
      "min-h-12",
      "items-center",
      "gap-1.5",
      "rounded-xl",
      "border",
      "bg-admin-raised",
      "px-4",
      "py-2",
      "border-admin-border",
    ]);
  });

  it("frete nacional: desconto e pedido mínimo", () => {
    act(() =>
      raiz.render(
        <EstrategiaNacionalBloco
          estrategia="desconto_na_mais_barata"
          minimo={0}
          tipoDesconto="percentual"
          valorDesconto={10}
          alcance="mais_barata"
          onEscolherEstrategia={vi.fn()}
          onMinimo={vi.fn()}
          onTipoDesconto={vi.fn()}
          onValorDesconto={vi.fn()}
          onAlcance={vi.fn()}
        />,
      ),
    );
    const casca = [
      "flex",
      "items-center",
      "gap-1.5",
      "rounded-xl",
      "border",
      "border-admin-border",
      "bg-admin-surface",
      "px-4",
      "py-2",
    ];
    for (const id of [
      "frete-nacional-valor-desconto",
      "frete-nacional-minimo",
    ]) {
      const caixa = caixaDe(id);
      expect(temTodas(classesDe(caixa), FOCO_NO_PC)).toBe(true);
      expect(semPrefixo(caixa)).toEqual(casca);
    }
  });
});
