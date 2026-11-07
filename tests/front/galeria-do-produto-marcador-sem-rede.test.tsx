// @vitest-environment jsdom
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useTelaDeComputador", () => ({
  useTelaDeComputador: () => true,
}));

it("mostra Sem foto local sem pedir o marcador a um site externo", () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    act(() =>
      root.render(
        <GaleriaDoProduto
          fotos={["https://placehold.co/600x400?text=Sem+Imagem", "/real.jpg"]}
          nome="Blusa"
          indice={0}
          onMudarIndice={() => {}}
        />,
      ),
    );
    expect(host.querySelector('img[src*="placehold.co"]')).toBeNull();
    expect(host.textContent).toContain("Sem foto");
    expect(host.querySelector('[aria-label*="não carregou"]')).toBeNull();
    // O fundo da galeria é claro nos dois temas: o marcador não pode trocar de
    // cor no tema escuro (cinza claro sobre cinza claro some).
    const marcadores = host.querySelectorAll('[aria-label="Blusa (sem foto)"]');
    expect(marcadores.length).toBeGreaterThan(0);
    for (const marcador of marcadores) {
      expect(marcador.outerHTML).not.toMatch(/dark:/);
    }
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
