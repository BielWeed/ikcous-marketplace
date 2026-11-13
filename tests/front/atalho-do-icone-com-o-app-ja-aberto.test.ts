// @vitest-environment jsdom
//
// Com o app instalado JÁ ABERTO (ex.: numa página de produto), escolher
// "Carrinho" ou "Favoritos" no ícone só trazia a janela para a frente: o
// manifesto usa `launch_handler: focus-existing` (de propósito, para a lojista
// não perder o estado ao tocar no ícone) e, nesse modo, o destino chega só pela
// API `launchQueue`, que ninguém consumia. Com o app fechado o atalho abre a URL
// direto e funciona (isso escondia o defeito).
//
// Aqui o consumidor da fila de abertura decide: destino do atalho, da MESMA
// origem, conhecido do roteador e diferente de onde o app já está → navega pelo
// roteador. Abertura normal pelo ícone (start_url), outra origem, URL quebrada,
// caminho desconhecido e navegador sem `launchQueue` não mudam nada.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MANIFESTO_BASE } from "../../src/config/manifestoBase";
import {
  START_URL_DO_ICONE,
  instalarConsumidorDoAtalhoDoIcone,
} from "../../src/lib/atalho-do-icone";

type Consumidor = (params: { targetURL?: string }) => void;

describe("atalho do ícone com o app já aberto (launchQueue)", () => {
  let consumidor: Consumidor | undefined;
  let setConsumer: ReturnType<typeof vi.fn<(c: Consumidor) => void>>;
  let desinstalar: (() => void) | undefined;

  beforeEach(() => {
    consumidor = undefined;
    setConsumer = vi.fn((c: Consumidor) => {
      consumidor = c;
    });
    vi.stubGlobal("launchQueue", { setConsumer });
    globalThis.history.replaceState(null, "", "/product-detail");
  });
  afterEach(() => {
    desinstalar?.();
    desinstalar = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const origem = () => globalThis.location.origin;

  function ligar() {
    const navegar = vi.fn<(view: string) => void>();
    desinstalar = instalarConsumidorDoAtalhoDoIcone({ navegar });
    return navegar;
  }

  function abrir(targetURL: string | undefined) {
    expect(consumidor).toBeDefined();
    consumidor?.({ targetURL });
  }

  it("registra UM consumidor na fila de abertura", () => {
    ligar();
    expect(setConsumer).toHaveBeenCalledTimes(1);
  });

  it("atalho Carrinho com o app aberto em outra tela: navega para o carrinho", () => {
    const navegar = ligar();
    abrir(`${origem()}/cart`);
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("cart");
  });

  it("atalho Favoritos: navega para favoritos", () => {
    const navegar = ligar();
    abrir(`${origem()}/favorites`);
    expect(navegar).toHaveBeenCalledWith("favorites");
  });

  it("os atalhos do manifesto resolvem para as telas certas (o que o ícone oferece, o consumidor entende)", () => {
    const navegar = ligar();
    for (const atalho of MANIFESTO_BASE.shortcuts) {
      abrir(`${origem()}${atalho.url}`);
    }
    expect(navegar.mock.calls.map((c) => c[0])).toEqual(["cart", "favorites"]);
  });

  it("abrir pelo ícone normal (start_url do manifesto) não muda a página", () => {
    const navegar = ligar();
    abrir(`${origem()}${START_URL_DO_ICONE}`);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("o start_url do consumidor é o MESMO do manifesto (um não anda sem o outro)", () => {
    expect(START_URL_DO_ICONE).toBe(MANIFESTO_BASE.start_url);
  });

  it("URL de outra origem é ignorada", () => {
    const navegar = ligar();
    abrir("https://outra-loja.exemplo/cart");
    expect(navegar).not.toHaveBeenCalled();
  });

  it("URL malformada, vazia ou ausente é ignorada, sem erro", () => {
    const navegar = ligar();
    expect(() => {
      abrir("http://");
      abrir("");
      abrir(undefined);
    }).not.toThrow();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("caminho que o roteador não conhece é ignorado", () => {
    const navegar = ligar();
    abrir(`${origem()}/nao-existe`);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("já está na tela do atalho (app aberto a frio direto em /cart): não navega de novo", () => {
    globalThis.history.replaceState(null, "", "/cart");
    const navegar = ligar();
    abrir(`${origem()}/cart`);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("barra final e maiúsculas valem como o roteador lê (/Favorites/)", () => {
    const navegar = ligar();
    abrir(`${origem()}/Favorites/`);
    expect(navegar).toHaveBeenCalledWith("favorites");
  });

  it("falha do roteador não derruba o consumidor da fila", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const navegar = vi.fn(() => {
      throw new Error("boom");
    });
    desinstalar = instalarConsumidorDoAtalhoDoIcone({ navegar });
    expect(() => abrir(`${origem()}/cart`)).not.toThrow();
    expect(erro).toHaveBeenCalled();
  });

  it("depois de desinstalar, o consumidor antigo não navega mais", () => {
    const navegar = ligar();
    desinstalar?.();
    desinstalar = undefined;
    abrir(`${origem()}/cart`);
    expect(navegar).not.toHaveBeenCalled();
  });

  it("navegador sem launchQueue (Safari, Firefox): não faz nada e não quebra", () => {
    vi.stubGlobal("launchQueue", undefined);
    const navegar = vi.fn();
    expect(() => {
      desinstalar = instalarConsumidorDoAtalhoDoIcone({ navegar });
    }).not.toThrow();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("App.tsx liga o consumidor pelo roteador (handleNavigate), não por recarga da página", () => {
    const fonte = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/App.tsx"),
      "utf8",
    );
    expect(fonte).toContain(
      'import { instalarConsumidorDoAtalhoDoIcone } from "@/lib/atalho-do-icone";',
    );
    const trecho = fonte.slice(
      fonte.indexOf("instalarConsumidorDoAtalhoDoIcone({"),
    );
    expect(trecho).toMatch(
      /navegar: \(view\) => \{\s*void handleNavigate\(view\);/,
    );
    const lib = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../src/lib/atalho-do-icone.ts"),
      "utf8",
    );
    expect(lib).not.toMatch(
      /location\.(assign|replace|reload)|location\.href\s*=/,
    );
  });
});
