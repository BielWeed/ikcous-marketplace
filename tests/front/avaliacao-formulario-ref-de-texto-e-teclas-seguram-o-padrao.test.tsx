// @vitest-environment jsdom
//
// ReviewForm — duas bordas que nenhum teste vigiava:
//  1. `temTextoRef` (que quem fecha a folha lê para perguntar "perder o texto?")
//     sobe só com texto VISÍVEL, desce ao apagar e, principalmente, ao SAIR da
//     tela: se ficasse "true" depois de o formulário desmontar, a próxima folha
//     perguntaria por um comentário que não existe mais.
//  2. As teclas de navegação das estrelas seguram o comportamento padrão do
//     navegador (setas rolariam a página e Home/End levariam ao topo/fim dela);
//     uma tecla comum não é segurada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const addReview = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

// Aquece o import pesado (zod, react-hook-form) fora do tempo de cada teste.
beforeAll(async () => {
  await import("@/components/ui/custom/ReviewForm");
}, 60_000);

beforeEach(() => {
  addReview.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function digitar(texto: string) {
  const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, texto);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function montar(props: {
  initialRating?: number;
  temTextoRef?: { current: boolean };
}) {
  const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
  await act(async () => {
    raiz.render(<ReviewForm productId="p-teclas" {...props} />);
  });
}

describe("ReviewForm — temTextoRef acompanha o texto visível e solta ao sair", () => {
  it("sobe ao digitar, desce ao apagar tudo", async () => {
    const temTextoRef = { current: false };
    await montar({ initialRating: 4, temTextoRef });
    expect(temTextoRef.current).toBe(false);

    await digitar("Veio no prazo");
    expect(temTextoRef.current).toBe(true);

    await digitar("");
    expect(temTextoRef.current).toBe(false);
  });

  it("só espaços e caractere invisível (U+200B) não contam como texto", async () => {
    const temTextoRef = { current: false };
    await montar({ initialRating: 4, temTextoRef });

    await digitar("    ");
    expect(temTextoRef.current).toBe(false);
    await digitar("​​");
    expect(temTextoRef.current).toBe(false);
  });

  it("ao SAIR da tela com texto escrito, volta a false (nada fica pendurado)", async () => {
    const temTextoRef = { current: false };
    await montar({ initialRating: 4, temTextoRef });
    await digitar("Texto que ficou pela metade");
    expect(temTextoRef.current).toBe(true);

    act(() => raiz.unmount());
    expect(temTextoRef.current).toBe(false);
  });
});

describe("ReviewForm — teclas das estrelas seguram o comportamento padrão", () => {
  function estrelaMarcada() {
    return hospedeiro.querySelector<HTMLButtonElement>(
      'button[role="radio"][aria-checked="true"]',
    ) as HTMLButtonElement;
  }
  function apertar(alvo: HTMLElement, key: string): boolean {
    const evento = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      alvo.dispatchEvent(evento);
    });
    return evento.defaultPrevented;
  }

  it("setas, Home e End seguram a tecla; uma letra não", async () => {
    await montar({ initialRating: 3 });

    for (const tecla of [
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "Home",
      "End",
    ]) {
      expect(apertar(estrelaMarcada(), tecla), tecla).toBe(true);
    }
    expect(apertar(estrelaMarcada(), "a")).toBe(false);
    expect(apertar(estrelaMarcada(), "Enter")).toBe(false);
  });
});
