// @vitest-environment jsdom
//
// LocalErrorBoundary — bordas que o teste da "aba que falhou" não pisava. O
// que protege:
//   · "Tentar de novo" (variante cliente) chama `onReset` UMA vez e remonta os
//     filhos — sem isso o pai que passou `onReset` nunca soube que a tela foi
//     retomada;
//   · `fallback` próprio vence a tela padrão, inclusive em falha de chunk;
//   · "Ver detalhes" abre e "Ocultar detalhes" FECHA a pilha (só em DEV);
//   · o foco só vai para o aviso quando o botão some ("esgotado"): um resultado
//     "sem-rede" (o botão continua lá) não pode roubar o foco do teclado.
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tentarDeNovoMock } = vi.hoisted(() => ({
  tentarDeNovoMock: vi.fn<() => Promise<string>>(),
}));

vi.mock("@/lib/recarga-de-aba-que-falhou", () => ({
  tentarDeNovoAbaQueNaoBaixou: tentarDeNovoMock,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let quebra = true;

function Filho() {
  if (quebra) throw new Error("falha-tecnica-de-teste");
  return <p>filho montado</p>;
}

function FilhoDeChunk(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: http://x/assets/Tela-abc.js",
  );
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
}

beforeEach(() => {
  quebra = true;
  tentarDeNovoMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("LocalErrorBoundary — onReset e fallback", () => {
  it("'Tentar de novo' da variante cliente chama onReset uma vez e remonta os filhos", () => {
    const onReset = vi.fn<() => void>();
    act(() =>
      raiz.render(
        <LocalErrorBoundary variante="cliente" onReset={onReset}>
          <Filho />
        </LocalErrorBoundary>,
      ),
    );
    expect(hospedeiro.textContent).toContain("Algo deu errado nesta tela");

    quebra = false;
    act(() => botaoPorTexto("Tentar de novo")?.click());

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("filho montado");
    expect(hospedeiro.textContent).not.toContain("Algo deu errado");
  });

  it("fallback próprio substitui a tela padrão, também em falha de chunk", () => {
    act(() =>
      raiz.render(
        <LocalErrorBoundary fallback={<p>aviso do pai</p>}>
          <Filho />
        </LocalErrorBoundary>,
      ),
    );
    expect(hospedeiro.textContent).toBe("aviso do pai");

    act(() =>
      raiz.render(
        <LocalErrorBoundary key="chunk" fallback={<p>aviso do pai</p>}>
          <FilhoDeChunk />
        </LocalErrorBoundary>,
      ),
    );
    expect(hospedeiro.textContent).toBe("aviso do pai");
  });
});

describe("LocalErrorBoundary — detalhes técnicos (DEV)", () => {
  it("'Ver detalhes' abre a pilha e 'Ocultar detalhes' fecha", () => {
    vi.stubEnv("DEV", true);
    act(() =>
      raiz.render(
        <LocalErrorBoundary>
          <Filho />
        </LocalErrorBoundary>,
      ),
    );

    act(() => botaoPorTexto("Ver detalhes")?.click());
    expect(hospedeiro.querySelector("pre")?.textContent).toContain(
      "falha-tecnica-de-teste",
    );

    act(() => botaoPorTexto("Ocultar detalhes")?.click());
    expect(hospedeiro.querySelector("pre")).toBeNull();
    expect(botaoPorTexto("Ver detalhes")).toBeDefined();
  });
});

describe("LocalErrorBoundary — foco do aviso de chunk", () => {
  it("resultado 'sem-rede' mantém o botão e NÃO leva o foco para o aviso", async () => {
    tentarDeNovoMock.mockResolvedValue("sem-rede");
    act(() =>
      raiz.render(
        <LocalErrorBoundary>
          <FilhoDeChunk />
        </LocalErrorBoundary>,
      ),
    );
    const aviso = hospedeiro.querySelector<HTMLElement>('[role="alert"]');
    expect(aviso).not.toBeNull();

    await act(async () => {
      botaoPorTexto("Tentar de novo")?.click();
    });

    expect(hospedeiro.textContent).toContain("Verifique sua conexão.");
    expect(botaoPorTexto("Tentar de novo")).toBeDefined();
    expect(document.activeElement).not.toBe(aviso);
  });

  it("resultado 'esgotado' tira o botão e leva o foco para o aviso", async () => {
    tentarDeNovoMock.mockResolvedValue("esgotado");
    act(() =>
      raiz.render(
        <LocalErrorBoundary>
          <FilhoDeChunk />
        </LocalErrorBoundary>,
      ),
    );
    const aviso = hospedeiro.querySelector<HTMLElement>('[role="alert"]');

    await act(async () => {
      botaoPorTexto("Tentar de novo")?.click();
    });

    expect(botaoPorTexto("Tentar de novo")).toBeUndefined();
    expect(document.activeElement).toBe(aviso);
  });
});
