// @vitest-environment jsdom
//
// O cartão "Produtos que mais dão lucro" quebrava inteiro quando o nome de um
// produto SEM foto tinha emoji na 2ª posição: a miniatura de reserva cortava
// o nome com `substring(0, 2)` (que racha o emoji ao meio, deixando um
// surrogate solitário) e `encodeURIComponent` LANÇA nesse caso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A foto só entra no DOM quando o observador diz "visível": o stub diz já na
// 1ª observação, para a miniatura de reserva existir de verdade no teste.
class IntersectionObserverStub {
  private readonly aoVer: IntersectionObserverCallback;
  constructor(aoVer: IntersectionObserverCallback) {
    this.aoVer = aoVer;
  }
  observe() {
    this.aoVer(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function statsComProduto(name: string) {
  return {
    topProducts: [{ id: "p1", name, quantity: 3, total: 90, image: "" }],
  } as any;
}

describe("TopProductsList — produto sem foto com emoji no nome", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("renderiza a lista e a miniatura em vez de quebrar o cartão", async () => {
    const { TopProductsList } = await import(
      "@/components/admin/dashboard/TopProductsList"
    );
    await act(async () =>
      raiz.render(
        <TopProductsList
          stats={statsComProduto("✨🎁 Caneca")}
          loading={false}
          onNavigate={() => {}}
        />,
      ),
    );
    expect(hospedeiro.querySelectorAll("ol li")).toHaveLength(1);
    expect(hospedeiro.textContent).toContain("✨🎁 Caneca");
    // Produto sem foto: a miniatura é o quadrado local "Sem foto" (sem pedir
    // imagem de fora), com o nome do produto inteiro — emoji incluído — como
    // rótulo; não existe mais letra de reserva para rachar o emoji.
    const miniatura = hospedeiro.querySelector('ol li [role="img"]');
    expect(miniatura).toBeTruthy();
    expect(miniatura?.getAttribute("aria-label")).toBe("✨🎁 Caneca");
    expect(miniatura?.textContent).toBe("Sem foto");
    expect(hospedeiro.querySelector("ol li img")).toBeNull();
  });
});
