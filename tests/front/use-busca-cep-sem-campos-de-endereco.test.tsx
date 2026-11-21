// @vitest-environment jsdom
//
// `useBuscaCep` com `semCamposDeEndereco` (retirada na loja): a tela não mostra
// rua, bairro nem cidade, então o aviso não pode mandar "preencher o endereço
// manualmente". Sem a opção, o texto de sempre continua igual.
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de useBuscaCep.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Sonda({ semCampos }: { semCampos: boolean }) {
  const { buscar } = useBuscaCep(() => {}, { semCamposDeEndereco: semCampos });
  return (
    <button
      type="button"
      data-testid="buscar"
      onClick={() => buscar("01310100")}
    >
      buscar
    </button>
  );
}

describe("useBuscaCep — retirada na loja não pede endereço manual", () => {
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

  async function buscarComFalhaDeRede(semCampos: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      raiz.render(<Sonda semCampos={semCampos} />);
    });
    act(() => {
      (
        document.querySelector('[data-testid="buscar"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function buscarCepInexistente(semCampos: boolean) {
    // Os três provedores respondem que o CEP não existe (formatos reais).
    const naoExiste = (corpo: unknown, status: number) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(corpo),
      } as unknown as Response);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("viacep.com.br"))
          return naoExiste({ erro: "true" }, 200);
        if (url.includes("opencep.com")) return naoExiste({ error: true }, 404);
        return naoExiste(
          { code: "not_found", message: "O CEP nao foi encontrado" },
          404,
        );
      }),
    );
    await act(async () => {
      raiz.render(<Sonda semCampos={semCampos} />);
    });
    act(() => {
      (
        document.querySelector('[data-testid="buscar"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("busca indisponível na retirada manda tentar de novo", async () => {
    const { toast } = await import("sonner");
    await buscarComFalhaDeRede(true);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível buscar o CEP agora. Tente de novo.",
    );
  });

  it("busca indisponível na entrega continua pedindo o endereço manual", async () => {
    const { toast } = await import("sonner");
    await buscarComFalhaDeRede(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
    );
  });

  it("CEP inexistente na retirada manda conferir os números", async () => {
    const { toast } = await import("sonner");
    await buscarCepInexistente(true);
    expect(toast.error).toHaveBeenCalledWith(
      "CEP não encontrado. Confira os números.",
    );
  });

  it("CEP inexistente na entrega continua pedindo o endereço manual", async () => {
    const { toast } = await import("sonner");
    await buscarCepInexistente(false);
    expect(toast.error).toHaveBeenCalledWith(
      "CEP não encontrado. Preencha o endereço manualmente.",
    );
  });
});
