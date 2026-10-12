// @vitest-environment jsdom
//
// `useBuscaCep` com o aviso DENTRO DA TELA (redesenho de "Novo endereço",
// 03/10/2026). O hook sempre contou o desfecho da busca em `resultado`; o que
// muda por chamador é SE ele também avisa por toast:
//
// - checkout de convidado: continua com toast, como sempre (padrão do hook);
// - tela de endereço: `avisarPorToast: false` — a mensagem mora junto do campo
//   de CEP, onde a cliente está olhando, e não some em 2,5 s.
//
// Estes testes provam os quatro desfechos, que o modo "dentro da tela" não
// chama o toast, que o padrão continua chamando, e que `limpar()` apaga o
// desfecho velho (CEP editado depois de uma busca).
import { TIMEOUT_TENTATIVA_CEP_MS, useBuscaCep } from "@/hooks/useBuscaCep";
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

function resposta(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corpo),
  };
}

const PAULISTA = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};

function Sonda({ avisarPorToast }: { avisarPorToast?: boolean }) {
  const { resultado, buscar, limpar } = useBuscaCep(
    () => {},
    avisarPorToast === undefined ? undefined : { avisarPorToast },
  );
  return (
    <div>
      <span data-testid="resultado">{resultado?.tipo ?? "nenhum"}</span>
      <button
        type="button"
        data-testid="buscar"
        onClick={() => buscar("01310100")}
      >
        b
      </button>
      <button type="button" data-testid="limpar" onClick={() => limpar()}>
        l
      </button>
    </div>
  );
}

describe("useBuscaCep — desfecho em `resultado` e aviso dentro da tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar(avisarPorToast?: boolean) {
    await act(async () => {
      raiz.render(<Sonda avisarPorToast={avisarPorToast} />);
    });
  }
  function clicar(id: string) {
    act(() => {
      (
        document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
      ).click();
    });
  }
  async function esvaziar() {
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
  }
  function resultado(): string {
    return (document.querySelector('[data-testid="resultado"]') as HTMLElement)
      .textContent as string;
  }
  function todosOsProvedoresDizem(corpo: (url: string) => unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => Promise.resolve(corpo(url))),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
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

  it("achou: resultado 'achou' e NENHUM toast no modo dentro da tela", async () => {
    const { toast } = await import("sonner");
    todosOsProvedoresDizem(() => resposta(PAULISTA));
    await montar(false);

    expect(resultado()).toBe("nenhum");
    clicar("buscar");
    await esvaziar();

    expect(resultado()).toBe("achou");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("todos dizem que não existe: 'naoEncontrado', sem toast", async () => {
    const { toast } = await import("sonner");
    todosOsProvedoresDizem((url) =>
      url.includes("viacep")
        ? resposta({ erro: "true" })
        : url.includes("opencep")
          ? resposta({ error: true }, 404)
          : resposta({ code: "not_found" }, 404),
    );
    await montar(false);

    clicar("buscar");
    await esvaziar();

    expect(resultado()).toBe("naoEncontrado");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("sem rede: 'indisponivel' (não afirma que o CEP não existe), sem toast", async () => {
    const { toast } = await import("sonner");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await montar(false);

    clicar("buscar");
    await esvaziar();

    expect(resultado()).toBe("indisponivel");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("provedor pendurado: 'demorou', sem toast", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    );
    await montar(false);

    clicar("buscar");
    // Três provedores, todos pendurados: cada um estoura a própria tentativa.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TIMEOUT_TENTATIVA_CEP_MS);
      });
    }
    await esvaziar();

    expect(resultado()).toBe("demorou");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("PADRÃO (checkout de convidado): continua avisando por toast, e também preenche `resultado`", async () => {
    const { toast } = await import("sonner");
    todosOsProvedoresDizem(() => resposta(PAULISTA));
    await montar();

    clicar("buscar");
    await esvaziar();

    expect(toast.success).toHaveBeenCalledWith("CEP localizado!");
    expect(resultado()).toBe("achou");
  });

  it("PADRÃO: 'não encontrado' continua sendo toast.error com a frase de sempre", async () => {
    const { toast } = await import("sonner");
    todosOsProvedoresDizem((url) =>
      url.includes("viacep")
        ? resposta({ erro: "true" })
        : url.includes("opencep")
          ? resposta({ error: true }, 404)
          : resposta({ code: "not_found" }, 404),
    );
    await montar();

    clicar("buscar");
    await esvaziar();

    expect(toast.error).toHaveBeenCalledWith("CEP não encontrado");
    expect(resultado()).toBe("naoEncontrado");
  });

  it("limpar() apaga o desfecho velho (a cliente editou o CEP depois da busca)", async () => {
    todosOsProvedoresDizem(() => resposta(PAULISTA));
    await montar(false);

    clicar("buscar");
    await esvaziar();
    expect(resultado()).toBe("achou");

    clicar("limpar");
    expect(resultado()).toBe("nenhum");
  });

  it("uma busca nova zera o desfecho anterior enquanto está em voo", async () => {
    let liberar: (r: unknown) => void = () => {};
    let primeira = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        if (primeira) {
          primeira = false;
          return Promise.resolve(resposta(PAULISTA));
        }
        return new Promise((resolve) => {
          liberar = resolve;
        });
      }),
    );
    await montar(false);

    clicar("buscar");
    await esvaziar();
    expect(resultado()).toBe("achou");

    clicar("buscar");
    await act(async () => {
      await Promise.resolve();
    });
    // Em voo: o "achou" da busca anterior não pode continuar valendo.
    expect(resultado()).toBe("nenhum");

    liberar(resposta(PAULISTA));
    await esvaziar();
    expect(resultado()).toBe("achou");
  });
});
