// @vitest-environment jsdom
/**
 * No 3G instavel, o carregamento de uma aba principal (Inicio, Favoritos,
 * Carrinho, Perfil) falhava e a cliente via "Falha Operacional - erro ao
 * carregar este bloco de controle" (texto de painel do lojista). O botao nao
 * resolvia e voltar a aba tambem nao: so fechando e reabrindo o app.
 *
 * O DUBLE E FIEL AO NAVEGADOR (medido no Chromium 152): o `import()` que
 * falhou uma vez MEMORIZA a falha e devolve a mesma rejeicao sem ir ao
 * servidor, mesmo com o servidor ja recuperado. So uma recarga da pagina zera
 * essa memoria. Por isso "Tentar de novo" com rede boa RECARREGA - e isso
 * nunca pode gastar o orcamento de `recuperacao-chunk` nem virar laco.
 */
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import {
  CHAVE_RECARGAS_DE_ABA_QUE_FALHOU,
  JANELA_RECARGAS_DE_ABA_QUE_FALHOU_MS,
  MAX_RECARGAS_DE_ABA_QUE_FALHOU,
  reservarRecargaDeAbaQueFalhou,
} from "@/lib/recarga-de-aba-que-falhou";
import { lazyWithPreload } from "@/utils/lazyWithPreload";
import { Suspense, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";
const FALHA_DE_CHUNK =
  "Failed to fetch dynamically imported module: http://x/assets/Favoritos-abc.js";

const TELA_NAO_BAIXOU = "Não conseguimos carregar esta tela.";
const FRASE_DE_REDE = "Verifique sua conexão.";
const FRASE_FECHE_E_ABRA = "Feche e abra o app de novo.";

const Tela = () => <div>favoritos carregados</div>;

function criarStorage(): Storage {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => armazem.clear(),
    key: () => null,
    get length() {
      return armazem.size;
    },
  } as Storage;
}

/** O navegador: memoriza a falha do import ate a pagina ser recarregada. */
class NavegadorFiel {
  servidorOk = false;
  pedidosAoServidor = 0;
  private memoria = new Map<string, Promise<{ default: typeof Tela }>>();

  importar(url: string): Promise<{ default: typeof Tela }> {
    const lembrada = this.memoria.get(url);
    if (lembrada) return lembrada; // falha (ou sucesso) memorizada: sem rede
    this.pedidosAoServidor += 1;
    const resposta: Promise<{ default: typeof Tela }> = this.servidorOk
      ? Promise.resolve({ default: Tela })
      : Promise.reject(new Error(FALHA_DE_CHUNK));
    resposta.catch(() => {}); // a rejeicao e tratada por quem importa
    this.memoria.set(url, resposta);
    return resposta;
  }

  /** Recarregar a pagina zera a memoria do navegador. */
  recarregar() {
    this.memoria.clear();
  }
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onLineOriginal: boolean;
let navegador: NavegadorFiel;
const reloadEspiao = vi.fn();

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorage());
  vi.stubGlobal("sessionStorage", criarStorage());
  navegador = new NavegadorFiel();
  reloadEspiao.mockReset();
  reloadEspiao.mockImplementation(() => navegador.recarregar());
  onLineOriginal = navigator.onLine;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      pathname: "/loja",
      search: "",
      reload: reloadEspiao,
      replace: vi.fn(),
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onLineOriginal,
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function definirOnLine(valor: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => valor,
  });
}

function instalarSondaDeRede(redeBoa: boolean) {
  vi.stubGlobal(
    "fetch",
    redeBoa
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

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function descarregar() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** Uma carga da pagina: modulo novo (estado do lazy zerado) + tela montada. */
async function montarPagina() {
  const Aba = lazyWithPreload(() => navegador.importar("Favoritos-abc.js"));
  await act(async () => {
    raiz.render(
      <LocalErrorBoundary>
        <Suspense fallback={<div>carregando</div>}>
          <Aba />
        </Suspense>
      </LocalErrorBoundary>,
    );
  });
  await descarregar();
}

/** O que o navegador faz depois do `location.reload()`: tudo recomeca, o
 * sessionStorage e o localStorage ficam. */
async function recarregarPagina() {
  await act(async () => {
    raiz.unmount();
  });
  raiz = createRoot(hospedeiro);
  await montarPagina();
}

async function tocarEmTentarDeNovo() {
  const botao = botaoPorTexto("Tentar de novo");
  expect(botao).toBeDefined();
  await act(async () => {
    botao?.click();
  });
  await descarregar();
}

function recargasGastas(): number {
  const cru = sessionStorage.getItem(CHAVE_RECARGAS_DE_ABA_QUE_FALHOU);
  return cru ? (JSON.parse(cru) as { count: number }).count : 0;
}

describe("aba principal que falhou ao carregar - a cliente consegue se recuperar", () => {
  it("o duble e fiel: depois de falhar, o navegador nao vai mais ao servidor", async () => {
    definirOnLine(true);
    await montarPagina();
    navegador.servidorOk = true; // a rede voltou, mas...

    await expect(navegador.importar("Favoritos-abc.js")).rejects.toThrow(
      FALHA_DE_CHUNK,
    );
    expect(navegador.pedidosAoServidor).toBe(1);
  });

  it("falha de chunk mostra frase simples, sem texto de painel e sem culpar a rede sem prova", async () => {
    definirOnLine(true);

    await montarPagina();

    expect(hospedeiro.textContent).toContain(TELA_NAO_BAIXOU);
    expect(hospedeiro.textContent).toContain("Toque em Tentar de novo.");
    expect(hospedeiro.textContent).not.toContain(FRASE_DE_REDE);
    expect(hospedeiro.textContent).not.toContain("Falha Operacional");
    expect(hospedeiro.textContent).not.toContain("bloco de controle");
    expect(botaoPorTexto("Tentar de novo")).toBeDefined();
  });

  it("rede boa: 'Tentar de novo' RECARREGA a pagina, sem gastar o orcamento de versao, e a aba carrega", async () => {
    definirOnLine(true);
    instalarSondaDeRede(true);
    await montarPagina();
    navegador.servidorOk = true; // a rede voltou

    await tocarEmTentarDeNovo();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
    // O duble provou: sem a recarga o servidor nem seria consultado.
    expect(navegador.pedidosAoServidor).toBe(1);

    await recarregarPagina();

    expect(hospedeiro.textContent).toBe("favoritos carregados");
    expect(navegador.pedidosAoServidor).toBe(2);
  });

  it("rede ruim: nao recarrega, diz para verificar a conexao e o botao volta a funcionar", async () => {
    definirOnLine(true);
    instalarSondaDeRede(false);
    await montarPagina();

    await tocarEmTentarDeNovo();

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(recargasGastas()).toBe(0);
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    expect(hospedeiro.textContent).toContain(TELA_NAO_BAIXOU);
    expect(hospedeiro.textContent).toContain(FRASE_DE_REDE);
    expect(botaoPorTexto("Tentar de novo")?.disabled).toBe(false);

    // A rede volta: o MESMO botao agora recarrega.
    instalarSondaDeRede(true);
    await tocarEmTentarDeNovo();
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("sem internet de cara (navigator.onLine=false) a frase ja fala da conexao", async () => {
    definirOnLine(false);

    await montarPagina();

    expect(hospedeiro.textContent).toContain(FRASE_DE_REDE);
  });

  it("guarda de laco: so 2 recargas por janela; a 3a mostra 'feche e abra', sem botao e sem recarregar", async () => {
    definirOnLine(true);
    instalarSondaDeRede(true);
    await montarPagina(); // servidor segue falhando (arquivo realmente ausente)

    for (let i = 0; i < MAX_RECARGAS_DE_ABA_QUE_FALHOU; i++) {
      await tocarEmTentarDeNovo();
      await recarregarPagina();
    }
    expect(reloadEspiao).toHaveBeenCalledTimes(MAX_RECARGAS_DE_ABA_QUE_FALHOU);

    await tocarEmTentarDeNovo();

    expect(reloadEspiao).toHaveBeenCalledTimes(MAX_RECARGAS_DE_ABA_QUE_FALHOU);
    expect(hospedeiro.textContent).toContain(FRASE_FECHE_E_ABRA);
    expect(hospedeiro.textContent).not.toContain(FRASE_DE_REDE);
    expect(botaoPorTexto("Tentar de novo")).toBeUndefined();
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
  });

  it("falha que NAO e de chunk mantem o comportamento de antes", async () => {
    definirOnLine(true);
    const Aba = lazyWithPreload(async () => {
      throw new Error("cannot read properties of undefined");
    });
    await act(async () => {
      raiz.render(
        <LocalErrorBoundary>
          <Suspense fallback={<div>carregando</div>}>
            <Aba />
          </Suspense>
        </LocalErrorBoundary>,
      );
    });
    await descarregar();

    expect(hospedeiro.textContent).toContain("Falha Operacional");
    expect(hospedeiro.textContent).not.toContain(TELA_NAO_BAIXOU);
    expect(botaoPorTexto("Tentar Novamente")).toBeDefined();
    expect(botaoPorTexto("Tentar de novo")).toBeUndefined();
    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
  });
});

describe("reservarRecargaDeAbaQueFalhou - a guarda de laco", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", criarStorage());
  });

  it("libera o maximo e recusa a seguinte dentro da janela", () => {
    const t0 = 1_000_000;
    expect(reservarRecargaDeAbaQueFalhou(t0)).toBe(true);
    expect(reservarRecargaDeAbaQueFalhou(t0 + 1000)).toBe(true);
    expect(reservarRecargaDeAbaQueFalhou(t0 + 2000)).toBe(false);
  });

  it("passada a janela, volta a liberar", () => {
    const t0 = 1_000_000;
    reservarRecargaDeAbaQueFalhou(t0);
    reservarRecargaDeAbaQueFalhou(t0 + 1);
    expect(reservarRecargaDeAbaQueFalhou(t0 + 2)).toBe(false);

    expect(
      reservarRecargaDeAbaQueFalhou(t0 + JANELA_RECARGAS_DE_ABA_QUE_FALHOU_MS),
    ).toBe(true);
  });

  it("storage quebrado falha fechado (sem recarga que nao da para contar)", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });

    expect(reservarRecargaDeAbaQueFalhou(1_000_000)).toBe(false);
  });
});
