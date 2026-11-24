// @vitest-environment jsdom
//
// A tela "Servidor em Manutenção" usava branco e zinc FIXOS (feitos para fundo
// escuro). Na loja de tema claro (o padrão) o título ficava branco sobre branco
// e o botão "Tentar de novo" sumia. Agora as cores vêm dos tokens do tema, que
// invertem sozinhos no tema escuro. Só classes: o resto da tela não muda.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useVoltaDaManutencao", () => ({
  useVoltaDaManutencao: () => undefined,
}));
vi.mock("@/lib/volta-da-manutencao", () => ({
  recarregarComPaginaNova: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MaintenanceView — cores seguem o tema da loja", () => {
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

  it("título, texto, faixa e botão não usam branco nem zinc fixos", async () => {
    const { MaintenanceView } = await import(
      "@/components/pwa/MaintenanceView"
    );
    await act(async () => {
      raiz.render(<MaintenanceView />);
    });
    const titulo = hospedeiro.querySelector("h1");
    const texto = hospedeiro.querySelector("p");
    const botao = hospedeiro.querySelector("button");
    expect(titulo?.className).toContain("text-foreground");
    expect(texto?.className).toContain("text-muted-foreground");
    expect(botao?.className).toContain("text-foreground");
    expect(botao?.className).toContain("bg-muted");
    // Só o quadrado escuro do ícone (decorativo, com engrenagem âmbar) mantém
    // cor fixa: os demais elementos vêm dos tokens.
    const fora = hospedeiro.innerHTML.replace(
      /<div class="relative flex size-24[^>]*>/,
      "",
    );
    expect(fora).not.toMatch(/text-white|text-zinc-|bg-white\/|border-white\//);
  });
});
