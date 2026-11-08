// @vitest-environment jsdom
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { ReviewForm } from "@/components/ui/custom/ReviewForm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: h.enviar }),
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("oferece enviar avaliação, não publicação imediata", async () => {
  await act(async () => {
    root.render(<ReviewForm productId="p" initialRating={5} />);
  });
  expect(host.querySelector('button[type="submit"]')?.textContent).toBe(
    "Enviar avaliação",
  );
});

it("durante o envio diz Enviando, não Publicando", async () => {
  let concluir!: () => void;
  h.enviar.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        concluir = () => resolve(null);
      }),
  );
  await act(async () => {
    root.render(<ReviewForm productId="p" initialRating={5} />);
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
  try {
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe(
      "Enviando...",
    );
  } finally {
    await act(async () => concluir());
  }
});

it.each([
  ["cliente", "cliente", false],
  ["outra", "cliente", true],
  [undefined, "cliente", true],
  [undefined, undefined, true],
])(
  "autora %s, sessão %s: Útil disponível = %s",
  (autora, sessao, disponivel) => {
    act(() =>
      root.render(
        <ReviewCard
          userIdAtual={sessao}
          review={{
            id: "r",
            productId: "p",
            userId: autora,
            customerName: "Cliente",
            rating: 5,
            comment: "Gostei",
            verified: true,
            helpful: 0,
            status: "publicada",
            createdAt: "2026-11-07T12:00:00Z",
          }}
          onHelpful={vi.fn()}
        />,
      ),
    );
    const botao = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Útil"),
    );
    expect(!!botao && !botao.disabled).toBe(disponivel);
  },
);
