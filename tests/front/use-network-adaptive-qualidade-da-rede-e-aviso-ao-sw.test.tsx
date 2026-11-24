// @vitest-environment jsdom
//
// `useNetworkAdaptive` (src/hooks/useNetworkAdaptive.ts): classifica a rede
// (Network Information API), avisa o service worker para ele adaptar o cache e
// guarda o histórico em `pwa_forensics`. Era trocado por dublê em todos os
// testes de tela; nenhum provava a classificação. O que protege:
//  - sem internet = "offline"; sem informação da API = "fast"; modo de
//    economia de dados = "slow"; 4g/wifi = "fast"; 3g = "medium"; 2g,
//    slow-2g ou tipo desconhecido = "slow";
//  - o SW só é avisado quando a qualidade MUDA (a inicial "fast" não avisa);
//  - o evento `offline` avisa "offline" na hora; `online` e `change` da
//    conexão recalculam;
//  - o histórico do aparelho guarda no máximo 20 entradas, a mais nova na
//    frente; JSON estragado no armazenamento não derruba nada;
//  - falha ao falar com o SW não impede o histórico;
//  - `isSlow` vale para "slow" e "offline", não para "medium";
//  - ao desmontar, os ouvintes saem.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNetworkAdaptive } from "@/hooks/useNetworkAdaptive";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useNetworkAdaptive>;

interface Conexao extends EventTarget {
  effectiveType?: string;
  saveData?: boolean;
}

function conexaoFalsa(
  dados: { effectiveType?: string; saveData?: boolean } = {},
): Conexao {
  return Object.assign(new EventTarget(), dados);
}

describe("useNetworkAdaptive — qualidade da rede e aviso ao service worker", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let postMessage: ReturnType<typeof vi.fn>;
  let onLine: ReturnType<typeof vi.spyOn>;
  const api: { atual: Api | null } = { atual: null };

  function Sonda() {
    const retorno = useNetworkAdaptive();
    useEffect(() => {
      api.atual = retorno;
    }, [retorno]);
    return null;
  }

  function instalarConexao(conexao: Conexao | undefined) {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: conexao,
    });
  }

  beforeEach(() => {
    api.atual = null;
    localStorage.clear();
    postMessage = vi.fn();
    onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({ active: { postMessage } })),
      },
    });
    instalarConexao(undefined);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(navigator, "connection");
    Reflect.deleteProperty(navigator, "serviceWorker");
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function esvaziarFila() {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await esvaziarFila();
  }

  function aviso(quality: string) {
    return { type: "SET_NETWORK_QUALITY", quality };
  }

  function historico(): Array<{ m: string; d: { quality: string } }> {
    return JSON.parse(localStorage.getItem("pwa_forensics") ?? "[]");
  }

  it.each([
    ["4g", false, "fast"],
    ["wifi", false, "fast"],
    ["3g", false, "medium"],
    ["2g", false, "slow"],
    ["slow-2g", false, "slow"],
    [undefined, false, "slow"],
    ["4g", true, "slow"],
    ["3g", true, "slow"],
  ] as const)(
    "conexão %s (economia de dados: %s) é classificada como '%s'",
    async (tipo, economia, esperada) => {
      instalarConexao(
        conexaoFalsa({ effectiveType: tipo, saveData: economia }),
      );

      await montar();

      expect(api.atual?.getQuality()).toBe(esperada);
    },
  );

  it("sem informação da API de rede assume 'fast' e NÃO avisa o service worker", async () => {
    await montar();

    expect(api.atual?.getQuality()).toBe("fast");
    expect(postMessage).not.toHaveBeenCalled();
    expect(localStorage.getItem("pwa_forensics")).toBeNull();
  });

  it("navegador offline na montagem: 'offline', avisa o SW e registra no histórico", async () => {
    onLine.mockReturnValue(false);

    await montar();

    expect(api.atual?.getQuality()).toBe("offline");
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(aviso("offline"));
    expect(historico()).toHaveLength(1);
    expect(historico()[0]).toMatchObject({
      m: "Network Quality",
      d: { quality: "offline" },
    });
  });

  it("3g na montagem avisa o SW uma vez com 'medium'", async () => {
    instalarConexao(conexaoFalsa({ effectiveType: "3g" }));

    await montar();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(aviso("medium"));
  });

  it("o evento offline avisa 'offline'; o online recalcula e volta ao que a conexão diz", async () => {
    await montar();

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await esvaziarFila();
    expect(api.atual?.getQuality()).toBe("offline");
    expect(postMessage).toHaveBeenLastCalledWith(aviso("offline"));

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await esvaziarFila();
    expect(api.atual?.getQuality()).toBe("fast");
    expect(postMessage).toHaveBeenLastCalledWith(aviso("fast"));
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("o evento change da conexão recalcula a qualidade", async () => {
    const conexao = conexaoFalsa({ effectiveType: "4g" });
    instalarConexao(conexao);
    await montar();
    expect(api.atual?.getQuality()).toBe("fast");

    conexao.effectiveType = "2g";
    await act(async () => {
      conexao.dispatchEvent(new Event("change"));
    });
    await esvaziarFila();

    expect(api.atual?.getQuality()).toBe("slow");
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(aviso("slow"));
  });

  it("a mesma qualidade duas vezes seguidas não avisa nem registra de novo", async () => {
    instalarConexao(conexaoFalsa({ effectiveType: "3g" }));
    await montar();
    expect(postMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await esvaziarFila();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(historico()).toHaveLength(1);
  });

  it("isSlow vale para 'slow' e 'offline', não para 'fast' nem 'medium'", async () => {
    const conexao = conexaoFalsa({ effectiveType: "4g" });
    instalarConexao(conexao);
    await montar();
    expect(api.atual?.isSlow()).toBe(false);

    conexao.effectiveType = "3g";
    await act(async () => {
      conexao.dispatchEvent(new Event("change"));
    });
    await esvaziarFila();
    expect(api.atual?.isSlow()).toBe(false);

    conexao.effectiveType = "2g";
    await act(async () => {
      conexao.dispatchEvent(new Event("change"));
    });
    await esvaziarFila();
    expect(api.atual?.isSlow()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await esvaziarFila();
    expect(api.atual?.isSlow()).toBe(true);
  });

  it("o histórico guarda no máximo 20 entradas, a mais nova na frente", async () => {
    const antigas = Array.from({ length: 20 }, (_, i) => ({
      t: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
      m: "Network Quality",
      d: { quality: "antiga" },
    }));
    localStorage.setItem("pwa_forensics", JSON.stringify(antigas));
    onLine.mockReturnValue(false);

    await montar();

    const lidas = historico();
    expect(lidas).toHaveLength(20);
    expect(lidas[0]?.d.quality).toBe("offline");
    expect(lidas[1]?.d.quality).toBe("antiga");
    // A mais velha das 20 antigas foi a que saiu.
    expect(JSON.stringify(lidas)).not.toContain("00:00:19.000Z");
  });

  it("histórico estragado no armazenamento não derruba o hook nem o aviso ao SW", async () => {
    localStorage.setItem("pwa_forensics", "{isso não é json");
    onLine.mockReturnValue(false);

    await montar();

    expect(api.atual?.getQuality()).toBe("offline");
    expect(postMessage).toHaveBeenCalledWith(aviso("offline"));
  });

  it("falha ao falar com o service worker não impede o histórico", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => {
          throw new Error("sem service worker");
        }),
      },
    });
    onLine.mockReturnValue(false);

    await montar();

    expect(historico()).toHaveLength(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("ao desmontar, os eventos de online, offline e da conexão deixam de ser ouvidos", async () => {
    const conexao = conexaoFalsa({ effectiveType: "4g" });
    instalarConexao(conexao);
    await montar();

    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);

    conexao.effectiveType = "2g";
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      conexao.dispatchEvent(new Event("change"));
    });
    await esvaziarFila();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("o objeto devolvido é estável entre renders (quem o põe em dependência de efeito não reexecuta)", async () => {
    await montar();
    const primeiro = api.atual;

    await act(async () => {
      raiz.render(<Sonda />);
    });

    expect(api.atual).toBe(primeiro);
  });
});
