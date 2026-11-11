// @vitest-environment jsdom
//
// A PERGUNTA "A LOJA VOLTOU?" DA TELA DE MANUTENÇÃO TEM PRAZO (r136-f).
//
// O defeito: `lojaSaiuDaManutencao` fazia `fetch("/identidade.json")` sem prazo.
// Em rede lenta/conexão pendurada a pergunta nunca terminava, o flag
// `perguntando` do hook ficava `true` para sempre e NENHUM intervalo seguinte
// perguntava de novo: a tela ficava em "Voltamos em alguns minutos!" com a
// loja já aberta (o defeito que a peça de 06/11 existe para curar, de volta
// pela porta dos fundos).
//
// Um `fetch` que honra o `signal` (como o de verdade) rejeita com AbortError
// ao ser abortado — é o que `pendurado` simula. O irmão deste teste, para a
// leitura de /version.json do portão de atualização, é
// update-check-leitura-da-versao-tem-prazo.test.ts.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recuperacao-chunk", () => ({
  navegarPreservandoEndereco: navegar,
}));

import { MaintenanceView } from "@/components/pwa/MaintenanceView";
import {
  INTERVALO_DA_CHECAGEM_MS,
  lojaSaiuDaManutencao,
} from "@/lib/volta-da-manutencao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mesmo valor da sonda de rede (PRAZO_SONDA_DE_REDE_MS); o teste irmão em node
// confere a igualdade com o módulo real (aqui o módulo está mockado).
const PRAZO = 5000;

function resposta(manutencao: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ configuracao: { manutencao } }),
  } as unknown as Response;
}

/** Rejeita com AbortError quando o `signal` abortar; nunca resolve sozinho. */
function aoAbortar(init: RequestInit | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement;
let buscar: ReturnType<typeof vi.fn>;
let sinais: AbortSignal[];

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz?.render(<MaintenanceView />);
  });
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  sessionStorage.clear();
  sinais = [];
  buscar = vi.fn(async () => resposta(true));
  vi.stubGlobal("fetch", buscar);
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => ["app-cache-x"]),
    open: vi.fn(async () => ({ delete: vi.fn(async () => true) })),
  });
  vi.stubGlobal("location", {
    origin: "https://loja.exemplo.com",
    pathname: "/",
    search: "",
    hash: "",
    href: "https://loja.exemplo.com/",
  });
  navegar.mockReset();
});

afterEach(async () => {
  if (raiz) {
    await act(async () => {
      raiz?.unmount();
    });
    raiz = null;
    hospedeiro.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lojaSaiuDaManutencao — pergunta que nunca responde", () => {
  it("fetch pendente: antes do prazo espera; no prazo ABORTA o pedido e devolve false", async () => {
    buscar.mockImplementation((_url: unknown, init?: RequestInit) => {
      if (init?.signal) sinais.push(init.signal);
      return aoAbortar(init);
    });
    let valor: boolean | "pendente" = "pendente";
    const pergunta = lojaSaiuDaManutencao().then((v) => {
      valor = v;
    });

    await vi.advanceTimersByTimeAsync(PRAZO - 1);
    expect(valor).toBe("pendente");
    expect(sinais[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pergunta;
    expect(sinais[0]?.aborted).toBe(true);
    expect(valor).toBe(false);
  });

  it("o corpo que trava depois dos cabeçalhos também é cortado pelo prazo", async () => {
    buscar.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal) sinais.push(init.signal);
      return {
        ok: true,
        status: 200,
        json: () => aoAbortar(init),
      } as unknown as Response;
    });
    const pergunta = lojaSaiuDaManutencao();
    await vi.advanceTimersByTimeAsync(PRAZO);
    expect(await pergunta).toBe(false);
    expect(sinais[0]?.aborted).toBe(true);
  });

  it("pede /identidade.json sem cache e com o signal do prazo", async () => {
    await lojaSaiuDaManutencao();
    expect(buscar).toHaveBeenCalledWith("/identidade.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("lojaSaiuDaManutencao — controles: o que já funcionava segue igual", () => {
  it("resposta dentro do prazo: 'voltou' é true, 'continua' é false, sem timer pendurado", async () => {
    buscar.mockImplementationOnce(async () => resposta(false));
    expect(await lojaSaiuDaManutencao()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    buscar.mockImplementationOnce(async () => resposta(true));
    expect(await lojaSaiuDaManutencao()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("erro de rede continua sendo 'continua em manutenção' (false), sem lançar e sem timer", async () => {
    buscar.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await lojaSaiuDaManutencao()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("tela de manutenção — pergunta pendurada não trava as seguintes", () => {
  it("a pergunta que nunca responde é abortada no prazo, solta o 'perguntando', e o PRÓXIMO intervalo pergunta de novo (e, voltando, recarrega)", async () => {
    buscar.mockImplementationOnce((_url: unknown, init?: RequestInit) => {
      if (init?.signal) sinais.push(init.signal);
      return aoAbortar(init);
    });
    buscar.mockImplementation(async () => resposta(false));
    await montar();

    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(buscar).toHaveBeenCalledTimes(1);

    // Ainda dentro do prazo a pergunta não empilha outra por cima.
    await passar(PRAZO - 1);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(navegar).not.toHaveBeenCalled();

    // Passado o prazo ela é abortada e o flag solta...
    await passar(1);
    expect(sinais[0]?.aborted).toBe(true);
    expect(navegar).not.toHaveBeenCalled();

    // ...então o intervalo seguinte pergunta de novo e a loja que voltou é vista.
    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(navegar).toHaveBeenCalledTimes(1);
  });

  it("controle: uma pergunta lenta DENTRO do prazo ainda vale e NÃO é abortada", async () => {
    buscar.mockImplementationOnce(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          if (init?.signal) sinais.push(init.signal);
          setTimeout(() => resolve(resposta(false)), PRAZO - 100);
        }),
    );
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS + PRAZO);
    expect(sinais[0]?.aborted).toBe(false);
    expect(navegar).toHaveBeenCalledTimes(1);
  });
});
