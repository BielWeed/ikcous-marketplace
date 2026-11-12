// @vitest-environment jsdom
//
// Avaliar o produto: as estrelas bastam, o comentário é opcional. Antes, o
// formulário recusava a avaliação sem texto ("O comentário deve ter pelo
// menos 3 caracteres"), mas o banco aceita sem (reviews.comment é nullable e
// não há CHECK nem trigger que o exija). Quem só queria dar a nota era
// barrada, e a loja ficava com menos avaliações.
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
  addReview.mockResolvedValue({ id: "r-1" });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(initialRating?: number, onSuccess = vi.fn()) {
  const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
  await act(async () => {
    raiz.render(
      <ReviewForm
        productId="p-1"
        initialRating={initialRating}
        onSuccess={onSuccess}
      />,
    );
  });
  return onSuccess;
}

async function enviar() {
  const botao = hospedeiro.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  await act(async () => {
    botao?.click();
  });
}

describe("ReviewCard — avaliação só com estrelas", () => {
  it("sem comentário não desenha o parágrafo vazio", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    await act(async () => {
      raiz.render(
        <ReviewCard
          review={{
            id: "r-1",
            productId: "p-1",
            customerName: "Cliente",
            rating: 5,
            comment: "",
            helpful: 0,
            verified: true,
            createdAt: "2026-09-28T12:00:00Z",
          }}
        />,
      );
    });
    const vazios = [...hospedeiro.querySelectorAll("p")].filter(
      (p) => (p.textContent ?? "").trim() === "",
    );
    expect(vazios).toHaveLength(0);
  });

  // r150-f: `trim()` não tira U+200B/U+200E/U+2800/U+3164; uma avaliação antiga
  // gravada só com isso desenhava o parágrafo em branco.
  it.each(["\u200b", "\u200e\u200e", "\u2800", "\u3164"])(
    "comentário só de caractere invisível (%j) não desenha o parágrafo",
    async (comment) => {
      const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
      await act(async () => {
        raiz.render(
          <ReviewCard
            review={{
              id: "r-1",
              productId: "p-1",
              customerName: "Cliente",
              rating: 5,
              comment,
              helpful: 0,
              verified: true,
              createdAt: "2026-09-28T12:00:00Z",
            }}
          />,
        );
      });
      expect(hospedeiro.querySelector("p.whitespace-pre-wrap")).toBeNull();
    },
  );

  it("controle: comentário com texto de verdade continua desenhado", async () => {
    const { ReviewCard } = await import("@/components/ui/custom/ReviewCard");
    await act(async () => {
      raiz.render(
        <ReviewCard
          review={{
            id: "r-1",
            productId: "p-1",
            customerName: "Cliente",
            rating: 5,
            comment: "Chegou rápido",
            helpful: 0,
            verified: true,
            createdAt: "2026-09-28T12:00:00Z",
          }}
        />,
      );
    });
    expect(hospedeiro.querySelector("p.whitespace-pre-wrap")?.textContent).toBe(
      "Chegou rápido",
    );
  });
});

describe("ReviewForm — comentário opcional", () => {
  it("só as estrelas: publica a avaliação com comentário vazio", async () => {
    const onSuccess = await montar(4);
    await enviar();

    expect(addReview).toHaveBeenCalledTimes(1);
    expect(addReview).toHaveBeenCalledWith({
      productId: "p-1",
      rating: 4,
      comment: "",
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("pelo menos 3 caracteres");
  });

  it("comentário só de espaços conta como vazio", async () => {
    const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
    await act(async () => {
      raiz.render(<ReviewForm productId="p-1" initialRating={5} />);
    });
    const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(area, "   ");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await enviar();

    expect(addReview).toHaveBeenCalledWith({
      productId: "p-1",
      rating: 5,
      comment: "",
    });
  });

  // r150-f: comentário só de U+200B/U+200E/U+2800/U+3164 vira "" no envio (as
  // estrelas bastam) e NÃO conta como texto digitado (a folha não pergunta
  // "descartar texto?" nem segura a atualização do app por ele).
  it.each(["\u200b", "\u200e\u200e", "\u2800", "\u3164"])(
    "comentário só de caractere invisível (%j) vai como vazio e não conta como texto",
    async (invisivel) => {
      const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
      const temTextoRef = { current: false };
      await act(async () => {
        raiz.render(
          <ReviewForm
            productId="p-1"
            initialRating={5}
            temTextoRef={temTextoRef}
          />,
        );
      });
      const area = hospedeiro.querySelector("textarea") as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        setter?.call(area, invisivel);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(temTextoRef.current).toBe(false);
      await enviar();

      expect(addReview).toHaveBeenCalledWith({
        productId: "p-1",
        rating: 5,
        comment: "",
      });
    },
  );

  it("o campo se apresenta como opcional", async () => {
    await montar(3);
    expect(hospedeiro.textContent).toContain("Opcional");
  });

  it("sem nenhuma estrela continua barrando: a nota é o que importa", async () => {
    await montar();
    await enviar();

    expect(addReview).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Selecione uma nota de 1 a 5.");
  });
});
