// @vitest-environment jsdom
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("F3.6 amplia comentário e resposta no computador preservando as classes do celular", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <ReviewCard
          review={{
            id: "avaliacao-desktop",
            productId: "produto-desktop",
            customerName: "Cliente",
            rating: 5,
            comment: "Gostei do tecido",
            helpful: 0,
            verified: true,
            merchantReply: "Obrigada pela avaliação",
            createdAt: "2026-09-28T12:00:00Z",
          }}
        />,
      ),
    );
    const comentario = host.querySelector("p")!;
    expect(classesDoCelular(comentario.className)).toBe(
      "mb-4 mt-3 text-xs font-normal leading-relaxed text-zinc-600 md:text-sm",
    );
    expect(comentario.classList.contains("lg:text-sm")).toBe(true);
    const resposta = [...host.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Obrigada"),
    )!;
    expect(classesDoCelular(resposta.className)).toBe(
      "font-medium italic leading-relaxed text-zinc-600",
    );
    expect(resposta.classList.contains("lg:text-sm")).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});
