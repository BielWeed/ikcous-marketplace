// @vitest-environment jsdom
//
// `useBuscaCep`: toda falha de rede virava `console.error` mudo — o `catch`
// só tratava `AbortError` (timeout) com toast; o resto (offline, DNS,
// portal cativo, ViaCEP fora do ar) caía direto no `console.error` e o
// spinner só parava, sem mensagem nenhuma. A cliente concluía (errado) que o
// CEP não existia. Além disso `res.ok` nunca era conferido: um 500 do
// ViaCEP com corpo HTML matava no `res.json()` e caía no mesmo buraco.
//
// Mesmo padrão de mock de `use-busca-cep.test.tsx`: sem
// `@testing-library/react`, `createRoot` + `act` do React puro, e um
// componente sonda mínimo.
import { useBuscaCep } from "@/hooks/useBuscaCep";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em use-busca-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda() {
  const { buscando, buscar } = useBuscaCep(() => {});
  return (
    <div>
      <span data-testid="buscando">{String(buscando)}</span>
      <button
        type="button"
        data-testid="buscar"
        onClick={() => buscar("01310100")}
      >
        buscar
      </button>
    </div>
  );
}

describe("useBuscaCep — falha de rede e resposta ruim avisam a cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function clicarBuscar() {
    (
      document.querySelector('[data-testid="buscar"]') as HTMLButtonElement
    ).click();
  }

  function buscando(): string {
    return (document.querySelector('[data-testid="buscando"]') as HTMLElement)
      .textContent as string;
  }

  it("fetch rejeitado com TypeError (offline/DNS) emite toast em vez de sumir mudo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const { toast } = await import("sonner");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      raiz.render(<Sonda />);
    });

    act(() => {
      clicarBuscar();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
    );
    expect(buscando()).toBe("false");
  });

  it("res.ok false (500 do ViaCEP) avisa a cliente sem tentar .json() no corpo", async () => {
    const jsonSpy = vi.fn(() =>
      Promise.reject(new SyntaxError("Unexpected token <")),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: jsonSpy,
        } as unknown as Response),
      ),
    );
    const { toast } = await import("sonner");

    await act(async () => {
      raiz.render(<Sonda />);
    });

    act(() => {
      clicarBuscar();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
    );
    // A âncora: se o hook ainda chamasse `.json()` antes de conferir `ok`,
    // este teste passaria pelo motivo errado (caindo no catch genérico).
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });
});
