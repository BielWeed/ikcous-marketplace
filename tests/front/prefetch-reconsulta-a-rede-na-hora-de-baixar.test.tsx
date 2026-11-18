// @vitest-environment jsdom
// O aquecimento de uma tela é agendado para quando o navegador estiver
// ocioso (até 2 s depois). Se nesse intervalo a cliente liga a economia de
// dados ou a conexão cai para 2G, o download já agendado não pode continuar:
// a checagem de rede lenta tem que valer também na hora de baixar, não só
// na hora de agendar.
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({ lenta: false }));

vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => rede.lenta }),
}));

describe("prefetch reconsulta a rede na hora de baixar", () => {
  const carregados = new Set<string>();
  const fila: IdleRequestCallback[] = [];
  let prefetchView: ((view: string) => void) | undefined;
  let raiz: ReturnType<typeof createRoot>;

  const executarIdle = async () => {
    for (const callback of fila.splice(0)) {
      callback({ didTimeout: false, timeRemaining: () => 50 });
    }
    await vi.dynamicImportSettled();
  };

  beforeEach(async () => {
    rede.lenta = false;
    carregados.clear();
    fila.length = 0;
    for (const modulo of [
      "@/views/customer/CartView",
      "@/views/customer/FavoritesView",
    ]) {
      vi.doMock(modulo, () => {
        carregados.add(modulo);
        return { default: () => null };
      });
    }
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      fila.push(callback);
      return fila.length;
    });
    raiz = createRoot(document.createElement("div"));
    function Alvo() {
      const hook = usePrefetchOnHover();
      useEffect(() => {
        prefetchView = hook.prefetchView;
      });
      return null;
    }
    await act(async () => raiz.render(<Alvo />));
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    vi.unstubAllGlobals();
    vi.doUnmock("@/views/customer/CartView");
    vi.doUnmock("@/views/customer/FavoritesView");
  });

  it("rede boa do começo ao fim: a tela é baixada", async () => {
    prefetchView!("favorites");
    expect(fila).toHaveLength(1);
    await executarIdle();
    expect([...carregados]).toEqual(["@/views/customer/FavoritesView"]);
  });

  it("economia de dados ligada depois de agendar: não baixa, e baixa quando a rede melhora", async () => {
    prefetchView!("cart");
    expect(fila).toHaveLength(1);

    rede.lenta = true;
    await executarIdle();
    expect(carregados.size).toBe(0);

    // A tela não ficou marcada como "já baixada": no próximo hover, com a
    // rede boa, ela é aquecida normalmente.
    rede.lenta = false;
    prefetchView!("cart");
    expect(fila).toHaveLength(1);
    await executarIdle();
    expect([...carregados]).toEqual(["@/views/customer/CartView"]);
  });
});
