// @vitest-environment jsdom
//
// ReviewForm: (1) o comentário mostra um contador "n/1000" (antes o texto era
// cortado em 1000 sem aviso); (2) o formulário avisa a quem o contém, por
// `enviandoRef`, que há um envio em curso, para a folha não ser fechada nem
// reaberta no meio dele.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addReview = vi.fn();

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

const contador = () =>
  hospedeiro.querySelector<HTMLElement>('[data-testid="contador-comentario"]');

describe("ReviewForm — contador do comentário", () => {
  beforeEach(async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={5} />);
    });
  });

  it("começa em 0/1000 e acompanha o que a cliente digita", async () => {
    expect(contador()?.textContent).toBe("0/1000");
    await digitar("Chegou rápido");
    expect(contador()?.textContent).toBe("13/1000");
  });

  it("anuncia a contagem com educação (aria-live polite)", () => {
    expect(contador()?.getAttribute("aria-live")).toBe("polite");
  });

  it("só fica vermelho perto do limite (a partir de 900)", async () => {
    await digitar("a".repeat(899));
    expect(contador()?.className).not.toContain("text-red-700");
    await digitar("a".repeat(900));
    expect(contador()?.className).toContain("text-red-700");
    await digitar("a".repeat(1000));
    expect(contador()?.textContent).toBe("1000/1000");
    expect(contador()?.className).toContain("text-red-700");
  });
});

describe("ReviewForm — avisa que está enviando", () => {
  it("enviandoRef fica true durante o envio e volta a false no fim", async () => {
    let concluir!: (valor: { id: string }) => void;
    addReview.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluir = resolve;
        }),
    );
    const enviandoRef = { current: false };
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(
        <ReviewForm
          productId="p-1"
          initialRating={4}
          enviandoRef={enviandoRef}
        />,
      );
    });

    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });
    expect(addReview).toHaveBeenCalledTimes(1);
    expect(enviandoRef.current).toBe(true);

    await act(async () => {
      concluir({ id: "r-1" });
    });
    expect(enviandoRef.current).toBe(false);
  });

  it("toque duplo no Publicar manda uma avaliação só", async () => {
    addReview.mockImplementation(() => new Promise(() => {}));
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={4} />);
    });
    const form = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(addReview).toHaveBeenCalledTimes(1);
  });
});
