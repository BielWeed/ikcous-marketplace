// @vitest-environment jsdom
//
// LOJA-01 (auditoria 26/08/2026): `StarRating` tinha `readonly = false` como
// padrão. Isso deixava todo card de EXIBIÇÃO (ProductCard, PremiumOffers,
// CompareView, ProductView) com o cursor de mãozinha e o hover amarelo de um
// campo de ENTRADA, mesmo o clique nunca controlando nota nenhuma -- só
// abrindo o produto por trás do card. Dos usos de exibição do projeto, só
// `ReviewCard.tsx` passava `readonly` explicitamente; os outros dependiam de
// alguém lembrar de passar a prop, e foi exatamente esse padrão que falhou
// quatro vezes.
//
// A correção inverte o padrão: exibição (sem prop nenhuma) vira o DEFAULT.
// Quem precisar de um campo de nota clicável de verdade (hoje nenhum lugar
// do projeto usa) passa `readonly={false}` e `onRatingChange` explicitamente
// -- a exceção se declara, a regra não depende de lembrança.
//
// POR QUE RENDER DE VERDADE (react-dom/client + jsdom), NÃO DUBLÊ DE REACT:
// o que este teste prova é a classe CSS que chega no DOM de verdade, não uma
// leitura isolada de props.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StarRating } from "@/components/ui/custom/StarRating";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StarRating — exibição não parece campo de entrada por padrão (LOJA-01)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("sem passar `readonly`, as estrelas não têm cursor de clique nem hover de campo de entrada", async () => {
    await act(async () => {
      raiz.render(<StarRating rating={4} />);
    });

    const estrelas = hospedeiro.querySelectorAll("svg.lucide-star");
    expect(estrelas.length).toBe(5);
    for (const estrela of estrelas) {
      const classe = estrela.getAttribute("class") ?? "";
      expect(classe).not.toContain("cursor-pointer");
      expect(classe).not.toContain("hover:text-yellow-500");
    }
  });

  it("clicar numa estrela sem `onRatingChange` não quebra (comportamento de exibição, não de entrada)", async () => {
    await act(async () => {
      raiz.render(<StarRating rating={2} />);
    });

    const primeiraEstrela = hospedeiro.querySelector("svg.lucide-star")!;
    expect(() => {
      act(() => {
        primeiraEstrela.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
    }).not.toThrow();
  });

  it("com `readonly={false}` e `onRatingChange` explícitos, o campo continua editável (a exceção pedida funciona)", async () => {
    const aoMudar = vi.fn();
    await act(async () => {
      raiz.render(
        <StarRating rating={2} readonly={false} onRatingChange={aoMudar} />,
      );
    });

    const estrelas = hospedeiro.querySelectorAll("svg.lucide-star");
    expect(estrelas[0].getAttribute("class") ?? "").toContain(
      "cursor-pointer",
    );

    await act(async () => {
      estrelas[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(aoMudar).toHaveBeenCalledWith(3);
  });
});
