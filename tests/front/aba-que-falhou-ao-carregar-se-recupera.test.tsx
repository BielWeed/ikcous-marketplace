// @vitest-environment jsdom
/**
 * No 3G instavel, o carregamento de uma aba principal (Inicio, Favoritos,
 * Carrinho, Perfil) falhava e a cliente via "Falha Operacional - erro ao
 * carregar este bloco de controle" (texto de painel do lojista). O botao nao
 * resolvia e voltar a aba tambem nao: so fechando e reabrindo o app.
 *
 * Aqui a aba e uma `lazyWithPreload` de verdade dentro do `LocalErrorBoundary`
 * de verdade - o mesmo arranjo do App.tsx - e o que muda e o que a cliente
 * ve e se o "tentar de novo" carrega a tela.
 */
import { LocalErrorBoundary } from "@/components/ui/custom/LocalErrorBoundary";
import { lazyWithPreload } from "@/utils/lazyWithPreload";
import { Suspense, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";
const FALHA_DE_CHUNK =
  "Failed to fetch dynamically imported module: http://x/assets/Favoritos-abc.js";

const MENSAGEM_HUMANA =
  "Não conseguimos carregar esta tela. Verifique sua conexão.";

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

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onLineOriginal: boolean;
const reloadEspiao = vi.fn();

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorage());
  vi.stubGlobal("sessionStorage", criarStorage());
  reloadEspiao.mockClear();
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

function aba(fabrica: () => Promise<{ default: typeof Tela }>) {
  return lazyWithPreload(fabrica);
}

async function montarAba(Aba: ReturnType<typeof aba>) {
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

async function tocarEmTentarDeNovo() {
  const botao = botaoPorTexto("Tentar de novo");
  expect(botao).toBeDefined();
  await act(async () => {
    botao?.click();
  });
  await descarregar();
}

describe("aba principal que falhou ao carregar - a cliente consegue se recuperar", () => {
  it("falha de chunk mostra frase humana, sem texto de painel do lojista", async () => {
    definirOnLine(true);
    const Aba = aba(async () => {
      throw new Error(FALHA_DE_CHUNK);
    });

    await montarAba(Aba);

    expect(hospedeiro.textContent).toContain(MENSAGEM_HUMANA);
    expect(hospedeiro.textContent).not.toContain("Falha Operacional");
    expect(hospedeiro.textContent).not.toContain("bloco de controle");
    expect(botaoPorTexto("Tentar de novo")).toBeDefined();
  });

  it("com a rede de volta, 'Tentar de novo' carrega a aba", async () => {
    definirOnLine(true);
    const fabrica = vi
      .fn<() => Promise<{ default: typeof Tela }>>()
      .mockRejectedValueOnce(new Error(FALHA_DE_CHUNK))
      .mockResolvedValue({ default: Tela });
    const Aba = aba(fabrica);
    await montarAba(Aba);
    expect(hospedeiro.textContent).toContain(MENSAGEM_HUMANA);

    await tocarEmTentarDeNovo();

    expect(hospedeiro.textContent).toContain("favoritos carregados");
    expect(hospedeiro.textContent).not.toContain(MENSAGEM_HUMANA);
    expect(fabrica).toHaveBeenCalledTimes(2);
  });

  it("falha que NAO e de chunk mantem o comportamento de antes", async () => {
    definirOnLine(true);
    const Aba = aba(async () => {
      throw new Error("cannot read properties of undefined");
    });

    await montarAba(Aba);

    expect(hospedeiro.textContent).toContain("Falha Operacional");
    expect(hospedeiro.textContent).not.toContain(MENSAGEM_HUMANA);
    expect(botaoPorTexto("Tentar Novamente")).toBeDefined();
    expect(botaoPorTexto("Tentar de novo")).toBeUndefined();
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
  });

  it("falha de REDE (3G) nas duas tentativas nao gasta o orcamento de recuperacao", async () => {
    definirOnLine(true);
    instalarSondaDeRede(false);
    const Aba = aba(async () => {
      throw new Error(FALHA_DE_CHUNK);
    });
    await montarAba(Aba);

    await tocarEmTentarDeNovo();
    await tocarEmTentarDeNovo();

    expect(hospedeiro.textContent).toContain(MENSAGEM_HUMANA);
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("a PRIMEIRA falha nunca dispara a recuperacao de versao", async () => {
    definirOnLine(true);
    instalarSondaDeRede(true);
    const Aba = aba(async () => {
      throw new Error(FALHA_DE_CHUNK);
    });

    await montarAba(Aba);

    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("falha de novo com a rede PROVADA entra na escada de versao (1 engajamento)", async () => {
    definirOnLine(true);
    instalarSondaDeRede(true);
    const Aba = aba(async () => {
      throw new Error(FALHA_DE_CHUNK);
    });
    await montarAba(Aba);

    await tocarEmTentarDeNovo();

    const estado = JSON.parse(
      localStorage.getItem(CHAVE_RECUPERACAO_CHUNK) ?? "null",
    ) as { count: number } | null;
    expect(estado?.count).toBe(1);
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain(MENSAGEM_HUMANA);
  });
});
