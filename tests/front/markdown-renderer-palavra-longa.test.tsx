// @vitest-environment jsdom
// Caça 30 (06/11/2026): link ou palavra longa na descrição do produto saía
// cortado na borda da tela (o <main> do App tem overflow-x-hidden e não há
// regra global de quebra de palavra). `break-words` no container herda para
// <p>, <li> e <strong>, sem mexer no literal do parágrafo (contrato F3.6).
import { MarkdownRenderer } from "@/components/ui/custom/MarkdownRenderer";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MarkdownRenderer — palavra longa quebra em vez de cortar", () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("o container leva break-words e preserva a classe passada de fora", async () => {
    await act(async () => {
      root.render(
        <MarkdownRenderer
          content={`https://exemplo.com/${"a".repeat(120)}`}
          className="mt-2"
        />,
      );
    });
    const container = host.firstElementChild as HTMLElement;
    expect(container.className).toContain("break-words");
    expect(container.className).toContain("mt-2");
    expect(container.className).toContain("space-y-4");
  });
});
