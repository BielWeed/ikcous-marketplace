// @vitest-environment jsdom
//
// P64 (D4): no computador o comentário de uma avaliação corria na largura
// inteira do cartão e a linha de leitura chegava a ~98 caracteres em 1280 e
// ~121 em 1536/1920 (o confortável é 65-75). O comentário ganha `lg:max-w-prose`
// (a descrição da ProductView já faz o mesmo). Só classe `lg:` acrescentada: o
// celular fica byte a byte como era -- o literal abaixo é CONGELADO. A resposta
// da loja NÃO entra nesta mudança.
import { ReviewCard } from "@/components/ui/custom/ReviewCard";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMENTARIO_NO_CELULAR =
  "mb-4 mt-3 whitespace-pre-wrap break-words text-xs font-normal leading-relaxed text-zinc-600 md:text-sm";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <ReviewCard
        review={{
          id: "avaliacao-p64",
          productId: "produto-p64",
          customerName: "Cliente",
          rating: 5,
          comment: "Gostei muito do tecido e do caimento, chegou rápido.",
          helpful: 0,
          verified: true,
          merchantReply: "Obrigada pela avaliação",
          createdAt: "2026-09-28T12:00:00Z",
        }}
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const paragrafo = (trecho: string) =>
  Array.from(host.querySelectorAll("p")).find((p) =>
    p.textContent?.includes(trecho),
  )!;

it("P64: o comentário limita a linha de leitura no computador e não mexe no celular", () => {
  const comentario = paragrafo("Gostei muito");
  expect(classesDoCelular(comentario.className)).toBe(COMENTARIO_NO_CELULAR);
  expect(comentario.classList.contains("lg:text-sm")).toBe(true);
  expect(comentario.classList.contains("lg:max-w-prose")).toBe(true);
});

it("P64: a resposta da loja não recebe o limite de linha", () => {
  const resposta = paragrafo("Obrigada");
  expect(resposta.classList.contains("lg:max-w-prose")).toBe(false);
});
