// @vitest-environment jsdom
//
// Estado de erro do painel (AdminErrorState): o texto padrão quando a tela não
// diz nada, o texto que a tela manda, o botão "Tentar Novamente" que só existe
// quando há o que tentar, e o estado "Recarregando..." (botão travado + ícone
// girando). Caça por mutação (25/11/2026): o único teste direto só abria o
// padrão com `onRetry` e clicava; trocar a frase padrão, deixar o botão
// aparecer sem `onRetry`, nunca travar o botão enquanto recarrega ou inverter o
// ícone girando passava em branco.
import { AdminErrorState } from "@/components/admin/AdminErrorState";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

function montar(props: Parameters<typeof AdminErrorState>[0] = {}) {
  act(() => {
    raiz.render(<AdminErrorState {...props} />);
  });
}

const botao = () => host.querySelector("button") as HTMLButtonElement | null;
const icone = () => botao()?.querySelector("svg") as SVGElement;

describe("AdminErrorState: os textos", () => {
  it("sem nada informado, usa o título e a frase padrão", () => {
    montar();
    expect(host.querySelector("h3")?.textContent).toBe("Algo deu errado");
    expect(host.querySelector("h3 + p")?.textContent).toBe(
      "Não foi possível carregar os dados. Verifique sua conexão e tente novamente.",
    );
  });

  it("título e frase que a tela manda trocam os padrões, cada um no seu lugar", () => {
    montar({
      title: "Pedidos fora do ar",
      message: "Tente em alguns minutos.",
    });
    expect(host.querySelector("h3")?.textContent).toBe("Pedidos fora do ar");
    expect(host.querySelector("h3 + p")?.textContent).toBe(
      "Tente em alguns minutos.",
    );
    expect(host.textContent).not.toContain("Algo deu errado");
    expect(host.textContent).not.toContain("Verifique sua conexão");
  });

  it("é um alerta (leitor de tela anuncia sozinho)", () => {
    montar();
    expect(host.firstElementChild?.getAttribute("role")).toBe("alert");
  });
});

describe("AdminErrorState: o botão de tentar de novo", () => {
  it("sem onRetry NÃO desenha botão (não há o que tentar)", () => {
    montar();
    expect(botao()).toBeNull();
  });

  it("com onRetry: botão 'Tentar Novamente' habilitado, que chama onRetry uma vez", () => {
    const onRetry = vi.fn();
    montar({ onRetry });
    expect(botao()?.textContent).toBe("Tentar Novamente");
    expect(botao()?.disabled).toBe(false);
    act(() => botao()?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("recarregando: o texto muda, o botão trava e o clique não chama onRetry", () => {
    const onRetry = vi.fn();
    montar({ onRetry, isLoading: true });
    expect(botao()?.textContent).toBe("Recarregando...");
    expect(botao()?.disabled).toBe(true);
    act(() => botao()?.click());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("o ícone só gira enquanto recarrega", () => {
    montar({ onRetry: vi.fn(), isLoading: false });
    expect(icone().getAttribute("class")).not.toContain("animate-spin");
    montar({ onRetry: vi.fn(), isLoading: true });
    expect(icone().getAttribute("class")).toContain("animate-spin");
  });

  it("isLoading sem onRetry continua sem botão", () => {
    montar({ isLoading: true });
    expect(botao()).toBeNull();
  });

  it("o botão é um alvo de toque de 44px", () => {
    montar({ onRetry: vi.fn() });
    expect(botao()?.className).toContain("min-h-11");
  });
});
