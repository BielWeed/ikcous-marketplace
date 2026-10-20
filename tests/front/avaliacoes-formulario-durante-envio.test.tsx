// @vitest-environment jsdom
import { ReviewForm } from "@/components/ui/custom/ReviewForm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: h.enviar }),
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

it("bloqueia comentário e estrelas enquanto o envio está pendente", async () => {
  let concluir!: (valor: null) => void;
  h.enviar.mockImplementation(
    () =>
      new Promise<null>((resolve) => {
        concluir = resolve;
      }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(<ReviewForm productId="p" initialRating={5} />);
  });
  const area = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(area, "Meu comentário");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
  const estrelas = [
    ...host.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
  ];
  expect(h.enviar).toHaveBeenCalledTimes(1);
  expect(area.disabled).toBe(true);
  expect(estrelas).toHaveLength(5);
  expect(estrelas.every((botao) => botao.disabled)).toBe(true);
  await act(async () => {
    concluir(null);
  });
  expect(area.disabled).toBe(false);
  expect(area.value).toBe("Meu comentário");
  expect(estrelas.every((botao) => !botao.disabled)).toBe(true);
});
