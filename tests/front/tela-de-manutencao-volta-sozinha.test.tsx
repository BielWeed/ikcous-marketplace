// @vitest-environment jsdom
//
// A tela "Servidor em Manutenção" sai do ar sozinha quando a loja volta, e tem
// o botão "Tentar de novo" (06/11/2026). Antes ela não tinha botão nem nova
// checagem: a ficha é lida uma vez por carregamento, e quem deixava o app
// aberto ficava olhando "Voltamos em alguns minutos!" com a loja já aberta.
//
// O que este arquivo prova, com relógio falso e sem rede:
//   - pergunta à ficha atual a cada 45 s ENQUANTO a tela existe (e só);
//   - ficha dizendo "voltou" => apaga a cópia guardada e navega, uma vez;
//   - ficha dizendo "manutenção"/erro => não faz nada;
//   - NÃO HÁ LAÇO: se a página nova ainda disser "manutenção" e a pergunta
//     disser "voltou" de novo, a recarga automática para (3 por 30 min, 90 s
//     de espaço) — simulado montando a tela de novo a cada "recarga";
//   - o botão recarrega mesmo com a trava automática esgotada, uma vez por toque.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navegar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recuperacao-chunk", () => ({
  navegarPreservandoEndereco: navegar,
}));

import { MaintenanceView } from "@/components/pwa/MaintenanceView";
import {
  CHAVE_RECARGAS_DA_MANUTENCAO,
  INTERVALO_DA_CHECAGEM_MS,
} from "@/lib/volta-da-manutencao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resposta(manutencao: boolean) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ configuracao: { manutencao } }),
  } as unknown as Response;
}

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement;
let buscar: ReturnType<typeof vi.fn>;
let apagouDoCache: ReturnType<typeof vi.fn>;
let estadoDaAba: "visible" | "hidden" = "visible";

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz?.render(<MaintenanceView />);
  });
}

async function desmontar() {
  await act(async () => {
    raiz?.unmount();
  });
  raiz = null;
  hospedeiro.remove();
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  sessionStorage.clear();
  estadoDaAba = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => estadoDaAba,
  });
  buscar = vi.fn(async () => resposta(true));
  vi.stubGlobal("fetch", buscar);
  apagouDoCache = vi.fn(async () => true);
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => ["app-cache-x"]),
    open: vi.fn(async () => ({ delete: apagouDoCache })),
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
  if (raiz) await desmontar();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // biome-ignore lint/performance/noDelete: restaura o getter nativo do jsdom
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe("tela de manutenção — o que a pessoa vê", () => {
  it("mostra o aviso e o botão 'Tentar de novo'", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Servidor em Manutenção");
    const botao = hospedeiro.querySelector("button");
    expect(botao?.textContent).toBe("Tentar de novo");
    expect(botao?.getAttribute("type")).toBe("button");
    expect(botao?.hasAttribute("disabled")).toBe(false);
  });
});

describe("tela de manutenção — checagem automática", () => {
  it("não pergunta nada antes do primeiro intervalo", async () => {
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS - 1);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("a cada intervalo pergunta à ficha atual (sem cache) e, em manutenção, não faz mais nada", async () => {
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS * 3);
    expect(buscar).toHaveBeenCalledTimes(3);
    expect(buscar).toHaveBeenCalledWith("/identidade.json", {
      cache: "no-store",
    });
    expect(navegar).not.toHaveBeenCalled();
    expect(apagouDoCache).not.toHaveBeenCalled();
  });

  it("a loja voltou: apaga a cópia guardada ANTES de navegar, uma vez só, e para de perguntar", async () => {
    const ordem: string[] = [];
    apagouDoCache.mockImplementation(async () => {
      ordem.push("apagou");
      return true;
    });
    navegar.mockImplementation(() => {
      ordem.push("navegou");
    });
    buscar.mockImplementation(async () => resposta(false));
    await montar();

    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(ordem).toEqual(["apagou", "navegou"]);
    expect(apagouDoCache).toHaveBeenCalledWith("https://loja.exemplo.com/");

    // a página ainda está aqui (a navegação é falsa): não pode repetir.
    await passar(INTERVALO_DA_CHECAGEM_MS * 5);
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it("anota a recarga automática (a trava de laço depende disso)", async () => {
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS);
    const anotadas = JSON.parse(
      sessionStorage.getItem(CHAVE_RECARGAS_DA_MANUTENCAO) ?? "[]",
    );
    expect(anotadas).toHaveLength(1);
  });

  it("falha de rede na pergunta: segue em manutenção e tenta de novo no ciclo seguinte", async () => {
    buscar.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(navegar).not.toHaveBeenCalled();
    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(navegar).toHaveBeenCalledTimes(1);
  });

  it("aba escondida não gasta rede; ao voltar a ficar visível pergunta na hora", async () => {
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    estadoDaAba = "hidden";
    await passar(INTERVALO_DA_CHECAGEM_MS * 4);
    expect(buscar).not.toHaveBeenCalled();

    estadoDaAba = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledTimes(1);
  });

  it("uma pergunta lenta não empilha outra por cima (uma por vez)", async () => {
    let liberar: (r: Response) => void = () => {};
    buscar.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          liberar = resolve;
        }),
    );
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS * 4);
    expect(buscar).toHaveBeenCalledTimes(1);
    liberar(resposta(true));
    await passar(0);
  });
});

describe("tela de manutenção — a checagem para quando a tela sai do ar", () => {
  it("depois de desmontar, nenhuma pergunta nova e nenhuma navegação", async () => {
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await desmontar();
    await passar(INTERVALO_DA_CHECAGEM_MS * 10);
    expect(buscar).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("resposta que chega DEPOIS de a tela sair não navega (não derruba a loja já aberta)", async () => {
    let liberar: (r: Response) => void = () => {};
    buscar.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          liberar = resolve;
        }),
    );
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS);
    expect(buscar).toHaveBeenCalledTimes(1);

    await desmontar();
    liberar(resposta(false));
    await passar(10);

    expect(navegar).not.toHaveBeenCalled();
    expect(apagouDoCache).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHAVE_RECARGAS_DA_MANUTENCAO)).toBeNull();
  });

  it("o ouvinte de visibilidade também sai junto", async () => {
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await desmontar();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(buscar).not.toHaveBeenCalled();
  });
});

describe("tela de manutenção — NÃO HÁ LAÇO DE RECARGA", () => {
  it("ficha diz 'voltou' mas a página nova insiste em 'manutenção': para em 3 recargas automáticas", async () => {
    // Cada "recarga" aqui = a tela é montada de novo (página nova), com o
    // sessionStorage da aba intacto, e a pergunta continua dizendo "voltou".
    buscar.mockImplementation(async () => resposta(false));
    for (let pagina = 0; pagina < 12; pagina++) {
      await montar();
      await passar(INTERVALO_DA_CHECAGEM_MS);
      await desmontar();
    }
    expect(navegar).toHaveBeenCalledTimes(3);
  });

  it("nunca duas recargas automáticas com menos de 90 s de distância", async () => {
    const instantes: number[] = [];
    navegar.mockImplementation(() => {
      instantes.push(Date.now());
    });
    buscar.mockImplementation(async () => resposta(false));
    for (let pagina = 0; pagina < 12; pagina++) {
      await montar();
      await passar(INTERVALO_DA_CHECAGEM_MS);
      await desmontar();
    }
    expect(instantes.length).toBeGreaterThan(1);
    const distancias = instantes
      .slice(1)
      .map((instante, i) => instante - instantes.slice(0, -1).at(i)!);
    expect(distancias.length).toBeGreaterThan(0);
    expect(Math.min(...distancias)).toBeGreaterThanOrEqual(90_000);
  });

  it("sem sessionStorage utilizável não recarrega sozinha (e nem pergunta à toa)", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS * 5);
    expect(navegar).not.toHaveBeenCalled();
    expect(buscar).not.toHaveBeenCalled();
  });

  it("só dá para LER o sessionStorage (cheio: setItem falha): a ficha diz 'voltou' e mesmo assim NÃO recarrega, porque sem anotar a recarga não há trava", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("cheio", "QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
    });
    buscar.mockImplementation(async () => resposta(false));
    await montar();
    await passar(INTERVALO_DA_CHECAGEM_MS * 5);
    expect(buscar).toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });
});

describe("tela de manutenção — botão 'Tentar de novo'", () => {
  it("apaga a cópia guardada e navega, sem esperar a checagem", async () => {
    await montar();
    const botao = hospedeiro.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apagouDoCache).toHaveBeenCalledWith("https://loja.exemplo.com/");
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("funciona mesmo com as 3 recargas automáticas já gastas", async () => {
    const agora = Date.now();
    sessionStorage.setItem(
      CHAVE_RECARGAS_DA_MANUTENCAO,
      JSON.stringify([agora - 1_000, agora - 2_000, agora - 3_000]),
    );
    await montar();
    const botao = hospedeiro.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(navegar).toHaveBeenCalledTimes(1);
  });

  it("durante a recarga o botão fica desligado e diz que está verificando: dois toques não viram duas recargas", async () => {
    let terminarLimpeza: () => void = () => {};
    apagouDoCache.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          terminarLimpeza = () => resolve(true);
        }),
    );
    await montar();
    const botao = hospedeiro.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(botao.hasAttribute("disabled")).toBe(true);
    expect(botao.textContent).toBe("Verificando...");
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apagouDoCache).toHaveBeenCalledTimes(1);

    await act(async () => {
      terminarLimpeza();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(navegar).toHaveBeenCalledTimes(1);
  });
});
