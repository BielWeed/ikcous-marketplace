// @vitest-environment jsdom
/**
 * "Tentar de novo" de uma tela que não baixou: recarregar a página sozinho
 * pode trazer de volta a MESMA versão velha (o service worker antigo entrega o
 * HTML velho do cache enquanto o novo ainda espera), e a tela falhava de novo.
 * Por isso, ANTES do reload seco, o botão tenta fazer o service worker novo
 * assumir (update + SKIP_WAITING + recarga no controllerchange).
 *
 * Os casos que doem: sem service worker novo a recarga seca de sempre continua;
 * update que pendura não prende o botão; momento inseguro (compra em andamento)
 * não ativa versão nova; e a guarda de laço / a sonda de rede vêm antes de
 * qualquer mexida no service worker.
 */
import { definirAvaliadorDeMomentoSeguro } from "@/lib/atualizacao/veto-de-recarga";
import {
  PRAZO_DA_PAGINA_SAIR_MS,
  tentarDeNovoAbaQueNaoBaixou,
} from "@/lib/recarga-de-aba-que-falhou";
import { PRAZO_CICLO_DO_SW_MS } from "@/lib/recuperacao-chunk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function criarStorage(): Storage {
  const armazem = new Map<string, string>();
  return {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, String(v));
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
    clear: () => armazem.clear(),
    key: () => null,
    get length() {
      return armazem.size;
    },
  } as Storage;
}

interface EsperandoFalso {
  postMessage: ReturnType<typeof vi.fn>;
}

interface SwFalso {
  registro: {
    waiting: EsperandoFalso | null;
    update: ReturnType<typeof vi.fn>;
  };
  /** Dispara o controllerchange, como o navegador quando o novo assume. */
  assumir: () => void;
  ouvintes: Set<() => void>;
}

const reloadEspiao = vi.fn();
let sw: SwFalso;

function instalarSw(opcoes: {
  comWaiting: boolean;
  /** O novo assume sozinho quando recebe SKIP_WAITING. */
  assumeAoPedir?: boolean;
  /** O update() traz um service worker novo esperando. */
  updateTrazWaiting?: boolean;
  update?: () => Promise<void>;
}) {
  const ouvintes = new Set<() => void>();
  const postMessage = vi.fn(() => {
    if (opcoes.assumeAoPedir ?? true) {
      for (const o of [...ouvintes]) o();
    }
  });
  const registro: SwFalso["registro"] = {
    waiting: opcoes.comWaiting ? { postMessage } : null,
    update: vi.fn(async () => {
      if (opcoes.update) return opcoes.update();
      if (opcoes.updateTrazWaiting) registro.waiting = { postMessage };
    }),
  };
  sw = {
    registro,
    assumir: () => {
      for (const o of [...ouvintes]) o();
    },
    ouvintes,
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => registro,
      addEventListener: (_t: string, f: () => void) => ouvintes.add(f),
      removeEventListener: (_t: string, f: () => void) => ouvintes.delete(f),
    },
  });
  return { postMessage };
}

function removerSw() {
  Reflect.deleteProperty(navigator, "serviceWorker");
}

function redeBoa(boa: boolean) {
  vi.stubGlobal(
    "fetch",
    boa
      ? vi.fn(
          async () =>
            new Response(JSON.stringify({ version: "1.0.0-x" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        )
      : vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
  );
}

/** Roda o "Tentar de novo" e deixa os timers correrem até o fim dos prazos. */
async function tocar() {
  const p = tentarDeNovoAbaQueNaoBaixou();
  await vi.advanceTimersByTimeAsync(
    PRAZO_DA_PAGINA_SAIR_MS + PRAZO_CICLO_DO_SW_MS + 20000,
  );
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", criarStorage());
  vi.stubGlobal("sessionStorage", criarStorage());
  reloadEspiao.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload: reloadEspiao },
  });
  redeBoa(true);
});

afterEach(() => {
  definirAvaliadorDeMomentoSeguro(null);
  removerSw();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tentar de novo — antes de recarregar, tenta o service worker novo", () => {
  it("com um service worker novo ESPERANDO: ativa ele e recarrega no controllerchange (uma vez)", async () => {
    const { postMessage } = instalarSw({ comWaiting: true });

    const resultado = await tocar();

    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(sw.registro.update).not.toHaveBeenCalled();
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
    expect(resultado).toBe("pagina-ficou");
  });

  it("o reload só acontece DEPOIS de o novo assumir (não antes do controllerchange)", async () => {
    const { postMessage } = instalarSw({
      comWaiting: true,
      assumeAoPedir: false,
    });

    const p = tentarDeNovoAbaQueNaoBaixou();
    await vi.advanceTimersByTimeAsync(100);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(reloadEspiao).not.toHaveBeenCalled();

    sw.assumir();
    await vi.advanceTimersByTimeAsync(PRAZO_DA_PAGINA_SAIR_MS + 10);
    await p;
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("sem waiting: pede update() antes; se o novo aparece, ativa ele", async () => {
    const { postMessage } = instalarSw({
      comWaiting: false,
      updateTrazWaiting: true,
    });

    await tocar();

    expect(sw.registro.update).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("sem versão nova no ar (update não traz waiting): cai no reload seco de sempre, uma vez", async () => {
    const { postMessage } = instalarSw({ comWaiting: false });

    await tocar();

    expect(sw.registro.update).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("update() que pendura para sempre não prende o botão: passado o prazo, recarrega", async () => {
    instalarSw({ comWaiting: false, update: () => new Promise(() => {}) });

    const resultado = await tocar();

    expect(sw.registro.update).toHaveBeenCalledTimes(1);
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(resultado).toBe("pagina-ficou");
  });

  it("update() que falha (rejeita) cai no reload seco", async () => {
    instalarSw({
      comWaiting: false,
      update: async () => {
        throw new Error("InvalidStateError");
      },
    });

    await tocar();

    expect(sw.registro.update).toHaveBeenCalledTimes(1);
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("o novo nunca assume (controllerchange não chega): passado o prazo, recarrega seco, uma vez", async () => {
    const { postMessage } = instalarSw({
      comWaiting: true,
      assumeAoPedir: false,
    });

    await tocar();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(sw.ouvintes.size).toBe(0); // não deixa ouvinte pendurado
  });

  it("compra em andamento (momento inseguro): NÃO ativa a versão nova, só o reload de sempre", async () => {
    const { postMessage } = instalarSw({ comWaiting: true });
    definirAvaliadorDeMomentoSeguro(() => false);

    await tocar();

    expect(postMessage).not.toHaveBeenCalled();
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("sem service worker no navegador: reload seco, como antes", async () => {
    removerSw();

    await tocar();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("rede ruim: não mexe no service worker nem recarrega", async () => {
    redeBoa(false);
    const { postMessage } = instalarSw({ comWaiting: true });

    const resultado = await tocar();

    expect(resultado).toBe("sem-rede");
    expect(postMessage).not.toHaveBeenCalled();
    expect(sw.registro.update).not.toHaveBeenCalled();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("guarda de laço esgotada: não mexe no service worker nem recarrega", async () => {
    const { postMessage } = instalarSw({ comWaiting: true });
    sessionStorage.setItem(
      "pwa_aba_falhou_recargas",
      JSON.stringify({ inicio: Date.now(), count: 2 }),
    );

    const resultado = await tocar();

    expect(resultado).toBe("esgotado");
    expect(postMessage).not.toHaveBeenCalled();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("gasta UMA reserva da guarda por toque, mesmo pelo caminho do service worker", async () => {
    instalarSw({ comWaiting: true });

    await tocar();

    const estado = JSON.parse(
      sessionStorage.getItem("pwa_aba_falhou_recargas") ?? "{}",
    ) as { count: number };
    expect(estado.count).toBe(1);
  });
});
