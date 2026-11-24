// @vitest-environment jsdom
//
// Caça por mutação em `useBuscaCep`: cinco bordas que a suíte existente não
// pisava (cada uma sobreviveu a uma mutação no hook).
//   1. CEP que não tem 8 dígitos (7 ou 9) NÃO sai da máquina: nenhuma consulta,
//      nenhum aviso, spinner desligado. Um 9º dígito colado não pode mandar a
//      cliente para os provedores com um CEP que não existe.
//   2. UMA tentativa lenta + as outras caindo por erro de rede = "demorou", e
//      não "indisponível": a cliente precisa saber que tentar de novo ajuda.
//   3. O TETO GERAL sozinho (nenhuma tentativa passou de 3 s, mas a soma passou
//      de 8 s) também é "demorou" — com "não existe" lentos NÃO vira "CEP não
//      encontrado", porque o terceiro provedor nunca respondeu.
//   4. Retirada na loja (`semCamposDeEndereco`) + demora: o aviso manda "tentar
//      de novo", nunca "preencher o endereço" (a tela não tem esses campos).
//   5. Busca cancelada (desmonte) cuja resposta chega com ERRO HTTP: o laço não
//      segue para o próximo provedor — o CEP da cliente não vai a mais um
//      terceiro por causa de uma busca que ninguém mais espera.
// Mesmo padrão dos outros `use-busca-cep-*`: `createRoot` + `act`, sonda mínima.
import {
  TIMEOUT_BUSCA_CEP_MS,
  TIMEOUT_TENTATIVA_CEP_MS,
  useBuscaCep,
} from "@/hooks/useBuscaCep";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Corpo = { ok: boolean; status: number; json: () => Promise<unknown> };

function resposta(corpo: unknown, status = 200): Corpo {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corpo),
  };
}

const NAO_EXISTE_VIACEP = () => resposta({ erro: "true" });
const NAO_EXISTE_OPENCEP = () => resposta({ error: true }, 404);

function Sonda({
  cep,
  semCampos = false,
}: {
  cep: string;
  semCampos?: boolean;
}) {
  const { buscando, buscar, resultado } = useBuscaCep(() => {}, {
    semCamposDeEndereco: semCampos,
  });
  return (
    <div>
      <span data-testid="buscando">{String(buscando)}</span>
      <span data-testid="resultado">{resultado?.tipo ?? "nenhum"}</span>
      <button type="button" data-testid="buscar" onClick={() => buscar(cep)}>
        buscar
      </button>
    </div>
  );
}

describe("useBuscaCep — bordas de prazo, CEP curto e busca cancelada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  function novaRaiz() {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    novaRaiz();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar(cep: string, semCampos = false) {
    await act(async () => {
      raiz.render(<Sonda cep={cep} semCampos={semCampos} />);
    });
  }

  function clicar() {
    act(() => {
      (
        document.querySelector('[data-testid="buscar"]') as HTMLButtonElement
      ).click();
    });
  }

  const texto = (id: string) =>
    (document.querySelector(`[data-testid="${id}"]`) as HTMLElement)
      .textContent;

  /** Nunca responde; só rejeita com AbortError quando a requisição é abortada. */
  function pendurar(signal: AbortSignal | undefined) {
    return new Promise<Corpo>((_resolve, reject) => {
      signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
      );
    });
  }

  /** Responde depois de `ms` (relógio falso), honrando o cancelamento. */
  function responderDepois(
    ms: number,
    corpo: Corpo,
    signal: AbortSignal | undefined,
  ) {
    return new Promise<Corpo>((resolve, reject) => {
      const id = setTimeout(() => resolve(corpo), ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(id);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      });
    });
  }

  it("CEP de 7 ou de 9 dígitos não dispara consulta nem aviso", async () => {
    const { toast } = await import("sonner");
    const buscaDeRede = vi.fn();
    vi.stubGlobal("fetch", buscaDeRede);

    for (const cep of ["3850012", "385001234", ""]) {
      await act(async () => {
        raiz.unmount();
      });
      hospedeiro.remove();
      novaRaiz();
      await montar(cep);
      clicar();
      await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      });
      expect(texto("buscando")).toBe("false");
      expect(texto("resultado")).toBe("nenhum");
    }

    expect(buscaDeRede).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("uma tentativa lenta e as outras com erro de rede: 'demorou', não 'indisponível'", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        if (url.includes("viacep.com.br")) return pendurar(init?.signal);
        return Promise.reject(new TypeError("Failed to fetch"));
      }),
    );
    await montar("01310100");

    clicar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_TENTATIVA_CEP_MS);
    });

    expect(texto("resultado")).toBe("demorou");
    expect(texto("buscando")).toBe("false");
    expect(toast.error).toHaveBeenCalledWith(
      "A busca de CEP demorou demais. Preencha o endereço manualmente.",
    );
  });

  it("só o teto geral estourou (cada tentativa < 3 s, soma > 8 s): 'demorou', nunca 'CEP não encontrado'", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const quase = TIMEOUT_TENTATIVA_CEP_MS - 100;
    expect(quase * 2).toBeLessThan(TIMEOUT_BUSCA_CEP_MS);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        if (url.includes("viacep.com.br"))
          return responderDepois(quase, NAO_EXISTE_VIACEP(), init?.signal);
        if (url.includes("opencep.com"))
          return responderDepois(quase, NAO_EXISTE_OPENCEP(), init?.signal);
        return pendurar(init?.signal);
      }),
    );
    await montar("01310100");

    clicar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
    });

    expect(texto("resultado")).toBe("demorou");
    expect(texto("buscando")).toBe("false");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "A busca de CEP demorou demais. Preencha o endereço manualmente.",
    );
  });

  it("retirada na loja + demora: manda tentar de novo, não preencher endereço", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
        pendurar(init?.signal),
      ),
    );
    await montar("01310100", true);

    clicar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
    });

    expect(texto("resultado")).toBe("demorou");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "A busca de CEP demorou demais. Tente de novo.",
    );
  });

  it("desmonte durante o 1º provedor, resposta chega com erro 500: o 2º provedor não é consultado", async () => {
    const { toast } = await import("sonner");
    let responder: (r: Corpo) => void = () => {};
    const buscaDeRede = vi.fn(
      // Dublê que IGNORA o cancelamento: a resposta chega mesmo assim, depois.
      () =>
        new Promise<Corpo>((resolve) => {
          responder = resolve;
        }),
    );
    vi.stubGlobal("fetch", buscaDeRede);
    await montar("01310100");

    clicar();
    expect(buscaDeRede).toHaveBeenCalledTimes(1);

    await act(async () => {
      raiz.unmount();
    });
    await act(async () => {
      responder({
        ok: false,
        status: 500,
        json: () => Promise.reject(new SyntaxError("<html>")),
      });
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(buscaDeRede).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    // Recria a raiz para o `afterEach` não desmontar duas vezes.
    hospedeiro.remove();
    novaRaiz();
  });
});
