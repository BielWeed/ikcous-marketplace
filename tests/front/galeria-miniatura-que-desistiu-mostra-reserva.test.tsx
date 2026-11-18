// @vitest-environment jsdom
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@/hooks/useTelaDeComputador", () => ({
  useTelaDeComputador: () => true,
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("GaleriaDoProduto conserva o botão mas troca a miniatura que esgotou as tentativas", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const host = document.createElement("div");
  const root = createRoot(host);
  const mudar = vi.fn();
  try {
    await act(async () =>
      root.render(
        <GaleriaDoProduto
          fotos={["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]}
          nome="Blusa"
          indice={0}
          onMudarIndice={mudar}
        />,
      ),
    );
    const botao = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Ver foto 1 de 2"]',
    )!;
    const falhar = () =>
      act(() => {
        botao.querySelector("img")!.dispatchEvent(new Event("error"));
      });
    falhar();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    falhar();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    falhar();
    expect(botao.querySelector("img")).toBeNull();
    expect(botao.textContent).toContain("Sem foto");
    act(() => botao.click());
    expect(mudar).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});
