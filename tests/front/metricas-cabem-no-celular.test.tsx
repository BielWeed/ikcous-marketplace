import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { BarChart3, Package, Wallet } from "lucide-react";
// @vitest-environment jsdom
//
// Onda J (painel simples no celular, 360px): o cartão de métrica cortava o
// rótulo (8,5px), o subtítulo (9px) e até o valor, e o acento das maiúsculas
// sumia (`leading-none` + `truncate`). A faixa também andava sozinha a cada
// 4s, e os pontos de navegação eram bolinhas de 4px sem nome em português.
//
// O que este teste prova (decisões P-J1 e P-J4 do plano):
//   a. rótulo/subtítulo/rodapé quebram em até 2 linhas (`line-clamp-2`), sem
//      `truncate` nem `leading-none`;
//   b. o ícone some abaixo de 480px (`hidden xs:flex`) para o texto caber;
//   c. cada ponto é um <button> com nome ("Mostrar o grupo 1 de 3") e
//      `aria-current` no ativo, com alvo de toque de 44px;
//   d. "Expandir" tem alvo de toque de 44px (`min-h-11`);
//   e. a faixa NÃO anda sozinha por padrão;
//   f. quem passa `autoplayInterval` explícito liga (opt-in continua).
//
// Embla é trocado por um dublê: o jsdom não mede layout, então os "grupos"
// (snaps) e o `scrollNext` têm que ser controlados pelo teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const emblaFalso = vi.hoisted(() => {
  const api = {
    on: () => api,
    off: () => api,
    reInit: () => {},
    selectedScrollSnap: () => 0,
    scrollSnapList: () => [0, 1, 2],
    canScrollPrev: () => false,
    canScrollNext: () => true,
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    scrollTo: vi.fn(),
  };
  return { api, ref: () => {} };
});

vi.mock("embla-carousel-react", () => ({
  default: () => [emblaFalso.ref, emblaFalso.api],
}));

let hospedeiro: HTMLDivElement;
let raiz: Root;

const cardsFake: readonly KpiCardConfig[] = [
  {
    id: "capital",
    label: "Aguardando pagamento",
    value: "R$ 7.348,00",
    subValue: "Capital líquido",
    footer: "Atualizado agora",
    icon: Wallet,
  },
  { id: "pedidos", label: "Pedidos hoje", value: 3, icon: BarChart3 },
  { id: "catalogo", label: "Produtos", value: 19, icon: Package },
];

async function montar(elemento: React.ReactElement) {
  await act(async () => {
    raiz.render(elemento);
  });
}

async function carregarCarrossel() {
  const { AdminKpiCarousel } = await import(
    "@/components/admin/AdminKpiCarousel"
  );
  return AdminKpiCarousel;
}

describe("AdminKpiCarousel — cabe no celular de 360px", () => {
  beforeEach(() => {
    emblaFalso.api.scrollNext.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rótulo, subtítulo e rodapé quebram em 2 linhas, sem cortar nem achatar o acento", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const valor = hospedeiro.querySelector("h3");
    const rotulo = valor?.previousElementSibling;
    const subtitulo = valor?.nextElementSibling;
    const rodape = subtitulo?.nextElementSibling;

    for (const texto of [rotulo, subtitulo, rodape]) {
      expect(texto).toBeTruthy();
      expect(texto!.className).toContain("line-clamp-2");
      expect(texto!.className).not.toContain("truncate");
      expect(texto!.className).not.toContain("leading-none");
    }
    expect(rotulo?.textContent).toBe("Aguardando pagamento");
    expect(subtitulo?.textContent).toBe("Capital líquido");
    expect(rodape?.textContent).toBe("Atualizado agora");
    // Subtítulo e rodapé em frase normal (o acento das maiúsculas já era o
    // problema) — o rótulo continua em maiúsculas.
    expect(subtitulo!.className).not.toContain("uppercase");
    expect(rodape!.className).not.toContain("uppercase");
    expect(rotulo!.className).toContain("uppercase");
  });

  it("o ícone some abaixo de 480px para o texto ganhar largura", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const cartao = hospedeiro.querySelector("h3")!.closest(".group");
    const caixaDoIcone = cartao!.firstElementChild;
    expect(caixaDoIcone!.className).toContain("hidden");
    expect(caixaDoIcone!.className).toContain("xs:flex");
  });

  it("os pontos são botões com nome em português, alvo de 44px e marca do ativo", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const pontos = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Mostrar o grupo"]',
      ),
    );
    expect(pontos.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Mostrar o grupo 1 de 3",
      "Mostrar o grupo 2 de 3",
      "Mostrar o grupo 3 de 3",
    ]);
    for (const ponto of pontos) {
      expect(ponto.className).toContain("h-11");
      expect(ponto.className).toContain("w-6");
      expect(ponto.hasAttribute("title")).toBe(false);
    }
    expect(pontos[0].getAttribute("aria-current")).toBe("true");
    expect(pontos[1].hasAttribute("aria-current")).toBe(false);

    await act(async () => {
      pontos[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(emblaFalso.api.scrollTo).toHaveBeenCalledWith(1);
  });

  it("'Expandir' tem alvo de toque de 44px", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const expandir = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Expandir"),
    );
    expect(expandir).toBeTruthy();
    expect(expandir!.className).toContain("min-h-11");
  });

  it("a faixa NÃO anda sozinha por padrão", async () => {
    vi.useFakeTimers();
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(emblaFalso.api.scrollNext).not.toHaveBeenCalled();
  });

  it("com autoplayInterval explícito a faixa anda (opt-in continua)", async () => {
    vi.useFakeTimers();
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(
      <AdminKpiCarousel
        cards={cardsFake}
        title="Métricas"
        autoplayInterval={4000}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(emblaFalso.api.scrollNext).toHaveBeenCalled();
  });
});
