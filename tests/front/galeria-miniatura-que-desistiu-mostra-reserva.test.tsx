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

it("GaleriaDoProduto tenta de novo a miniatura da segunda foto junto com a foto grande", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const host = document.createElement("div");
  const root = createRoot(host);
  const fotos = [
    "https://cdn.example/a.jpg",
    "https://cdn.example/b.jpg",
    "https://cdn.example/c.jpg",
  ];
  try {
    act(() =>
      root.render(
        <GaleriaDoProduto
          fotos={fotos}
          nome="Blusa"
          indice={1}
          onMudarIndice={vi.fn()}
        />,
      ),
    );
    const grande = host.querySelector('[role="group"][aria-label="2 de 3"]')!;
    const miniatura = host.querySelector(
      'button[aria-label="Ver foto 2 de 3"]',
    )!;
    const vizinha = host.querySelector('button[aria-label="Ver foto 3 de 3"]')!;
    const imagemVizinha = vizinha.querySelector("img");
    expect(imagemVizinha).not.toBeNull();

    const falharAsDuas = () =>
      act(() => {
        grande.querySelector("img")!.dispatchEvent(new Event("error"));
        miniatura.querySelector("img")!.dispatchEvent(new Event("error"));
      });
    falharAsDuas();
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    falharAsDuas();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    falharAsDuas();

    expect(miniatura.querySelector("img")).toBeNull();
    expect(miniatura.textContent).toBe("Sem foto");
    expect(grande.querySelector("img")).toBeNull();
    act(() => grande.querySelector("button")!.click());

    expect(grande.querySelector("img")?.getAttribute("src")).toBe(
      `${fotos[1]}?_r=3`,
    );
    expect(miniatura.querySelector("img")?.getAttribute("src")).toBe(
      `${fotos[1]}?_r=3`,
    );
    expect(miniatura.textContent).not.toContain("Sem foto");
    expect(vizinha.querySelector("img")).toBe(imagemVizinha);
  } finally {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it.each(["carregada", "ainda tentando"])(
  "GaleriaDoProduto preserva a miniatura %s ao tentar de novo a foto grande",
  async (estado) => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const host = document.createElement("div");
    const root = createRoot(host);
    const fotos = ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"];
    try {
      act(() =>
        root.render(
          <GaleriaDoProduto
            fotos={fotos}
            nome="Blusa"
            indice={1}
            onMudarIndice={vi.fn()}
          />,
        ),
      );
      const grande = host.querySelector('[role="group"][aria-label="2 de 2"]')!;
      const miniatura = host.querySelector(
        'button[aria-label="Ver foto 2 de 2"]',
      )!;
      const imagem = miniatura.querySelector("img")!;
      const falharGrande = () =>
        act(() =>
          grande.querySelector("img")!.dispatchEvent(new Event("error")),
        );
      falharGrande();
      await act(async () => vi.advanceTimersByTimeAsync(1500));
      falharGrande();
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      falharGrande();

      act(() =>
        imagem.dispatchEvent(
          new Event(estado === "carregada" ? "load" : "error"),
        ),
      );
      const src = imagem.getAttribute("src");
      act(() => grande.querySelector("button")!.click());

      expect(grande.querySelector("img")?.getAttribute("src")).toBe(
        `${fotos[1]}?_r=3`,
      );
      expect(miniatura.querySelector("img")).toBe(imagem);
      expect(imagem.getAttribute("src")).toBe(src);
      expect(miniatura.textContent).not.toContain("Sem foto");
      if (estado === "ainda tentando") {
        await act(async () => vi.advanceTimersByTimeAsync(1500));
        expect(miniatura.querySelector("img")?.getAttribute("src")).toBe(
          `${fotos[1]}?_r=1`,
        );
      }
    } finally {
      act(() => root.unmount());
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  },
);
