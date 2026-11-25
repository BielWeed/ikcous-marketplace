// @vitest-environment jsdom
//
// Bordas do consumidor da fila de abertura do app instalado
// (`src/lib/atalho-do-icone.ts`) que o teste "com o app já aberto" não pisava:
//   · o endereço de uma tela do painel (`/admin/orders`) vira o nome da tela
//     do roteador (`admin-orders`), com barra final e maiúsculas;
//   · a raiz do site (`/`, e `//`) é a Home — só `/?source=pwa` é a abertura
//     normal pelo ícone, que não muda nada;
//   · parâmetro que não é texto (lista, objeto) e chamada sem parâmetros não
//     derrubam nem navegam: a fila do navegador é entrada de fora.
import { instalarConsumidorDoAtalhoDoIcone } from "@/lib/atalho-do-icone";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Consumidor = (params?: { targetURL?: unknown }) => void;

describe("atalho do ícone — caminhos do painel, raiz e parâmetros estranhos", () => {
  let consumidor: Consumidor | undefined;
  let desinstalar: (() => void) | undefined;

  beforeEach(() => {
    consumidor = undefined;
    vi.stubGlobal("launchQueue", {
      setConsumer: (c: Consumidor) => {
        consumidor = c;
      },
    });
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

  it("/admin/orders vira a tela admin-orders", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/admin/orders` });
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("admin-orders");
  });

  it("/Admin/Customers/ (maiúsculas e barra final) vira admin-customers", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/Admin/Customers/` });
    expect(navegar).toHaveBeenCalledWith("admin-customers");
  });

  it("o caminho 'admin' sozinho é a tela admin, não 'admin-'", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/admin` });
    expect(navegar).toHaveBeenCalledWith("admin");
  });

  it("a raiz do site (/) é a Home quando o app está em outra tela", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/` });
    expect(navegar).toHaveBeenCalledTimes(1);
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("barra dupla (//) também cai na Home", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}//` });
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("a raiz com outra consulta que não é a do ícone também é a Home", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/?source=outra` });
    expect(navegar).toHaveBeenCalledWith("home");
  });

  it("a raiz quando o app já está na Home não navega", () => {
    globalThis.history.replaceState(null, "", "/");
    const navegar = ligar();
    consumidor?.({ targetURL: `${origem()}/` });
    expect(navegar).not.toHaveBeenCalled();
  });

  it("parâmetro que não é texto não vira endereço (lista com um endereço dentro)", () => {
    const navegar = ligar();
    consumidor?.({ targetURL: ["/cart"] });
    consumidor?.({ targetURL: { toString: () => "/cart" } });
    consumidor?.({ targetURL: 42 });
    consumidor?.({ targetURL: null });
    expect(navegar).not.toHaveBeenCalled();
  });

  it("chamada sem parâmetros não derruba o consumidor", () => {
    const navegar = ligar();
    expect(() => consumidor?.(undefined)).not.toThrow();
    expect(() => consumidor?.({})).not.toThrow();
    expect(navegar).not.toHaveBeenCalled();
  });
});
