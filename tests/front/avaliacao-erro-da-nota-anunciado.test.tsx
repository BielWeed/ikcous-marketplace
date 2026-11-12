// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({ addReview: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("anuncia o erro ao enviar sem escolher estrelas", async () => {
  const { ReviewForm } = await import("@/components/ui/custom/ReviewForm");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<ReviewForm productId="produto-teste" />),
    );
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Selecione uma nota de 1 a 5.",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
