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
//   b. o ícone aparece em TODA largura (selo no canto; o rótulo reserva a faixa
//      dele com `pr-9`) — redesenho de 10/10/2026;
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
  const estado = { grupos: [0, 1, 2] };
  const api = {
    on: () => api,
    off: () => api,
    reInit: () => {},
    selectedScrollSnap: () => 0,
    scrollSnapList: () => estado.grupos,
    canScrollPrev: () => false,
    canScrollNext: () => true,
    scrollNext: vi.fn(),
    scrollPrev: vi.fn(),
    scrollTo: vi.fn(),
  };
  return { api, estado, ref: () => {} };
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
    emblaFalso.estado.grupos = [0, 1, 2];
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
    // Redesenho de 10/10/2026: rótulo, subtítulo e rodapé em frase normal
    // (maiúsculas miúdas em cinza escuro eram ilegíveis no celular).
    for (const texto of [rotulo, subtitulo, rodape]) {
      expect(texto!.className).not.toContain("uppercase");
    }
  });

  it("o fundo do cartão chega ao DOM inteiro: cor E gradiente (o cn() descartaria a cor)", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const classes = hospedeiro
      .querySelector("h3")!
      .closest(".group")!
      .className.split(/\s+/);
    expect(classes).toContain("bg-zinc-900/70");
    expect(classes).toContain("bg-gradient-to-b");
  });

  it("o ícone aparece em toda largura, em selo no canto, sem tomar a largura do valor", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const cartao = hospedeiro.querySelector("h3")!.closest(".group");
    const caixaDoIcone = cartao!.firstElementChild;
    const classes = caixaDoIcone!.className.split(/\s+/);
    expect(classes).not.toContain("hidden");
    expect(classes).not.toContain("xs:flex");
    expect(classes).toContain("absolute");
    // O rótulo reserva a faixa do selo; o valor fica com a largura inteira.
    const valor = hospedeiro.querySelector("h3")!;
    expect(valor.previousElementSibling!.className).toContain("pr-9");
    expect(valor.className).not.toContain("pr-9");
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
      expect(ponto.className).toContain("size-11");
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

  it("o valor mantém tamanho, algarismos tabulares e entrelinha em todos os tamanhos de tela", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const classes = hospedeiro.querySelector("h3")!.className;
    for (const classe of [
      "text-lg",
      "sm:text-2xl",
      "tabular-nums",
      "leading-tight",
      // text-2xl traz line-height próprio (32px) que anularia o leading-tight:
      // a entrelinha tem que ser refeita no tamanho de 640px em diante.
      "sm:leading-tight",
    ]) {
      expect(classes.split(/\s+/)).toContain(classe);
    }
  });

  it("o cartão tem padding vertical menor no computador e altura mínima, nunca travada", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const cartao = hospedeiro.querySelector("h3")!.closest(".group")!;
    const classes = cartao.className.split(/\s+/);
    expect(classes).toContain("sm:py-3");
    // J2-B rodada 1: o piso do cartão real é o MESMO do esqueleto (100px no
    // celular, 96px de 640px em diante) — o cartão nunca é menor que o
    // esqueleto e o conteúdo abaixo não sobe quando os números chegam.
    expect(classes).toContain("min-h-[100px]");
    expect(classes).toContain("sm:min-h-24");
    expect(classes).not.toContain("min-h-16");
    expect(classes).not.toContain("sm:min-h-[68px]");
    expect(classes.some((c) => /^(sm:)?h-(16|\[68px\])$/.test(c))).toBe(false);
  });

  it("o cartão real e o esqueleto usam EXATAMENTE a mesma altura mínima por breakpoint", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    const pisos = (el: Element) =>
      el.className
        .split(/\s+/)
        .filter((c) => /(^|:)min-h-/.test(c))
        .sort();

    await montar(
      <AdminKpiCarousel cards={cardsFake} title="Métricas" loading={true} />,
    );
    const esqueleto =
      hospedeiro.querySelector("div.animate-pulse")!.parentElement!;
    const pisosDoEsqueleto = pisos(esqueleto);

    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);
    const cartao = hospedeiro.querySelector("h3")!.closest(".group")!;

    expect(pisosDoEsqueleto.length).toBe(2);
    expect(pisos(cartao)).toEqual(pisosDoEsqueleto);
  });

  it("o esqueleto tem a altura mínima de um cartão real (o conteúdo abaixo não pula)", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(
      <AdminKpiCarousel cards={cardsFake} title="Métricas" loading={true} />,
    );

    const esqueleto =
      hospedeiro.querySelector("div.animate-pulse")!.parentElement!;
    const classes = esqueleto.className.split(/\s+/);
    // J2-B: o esqueleto mede o mesmo que o cartão real por breakpoint
    // (~100px no celular, ~96px de 640px em diante) — antes eram 96 e 68px
    // e o conteúdo abaixo pulava 11–28px quando os números chegavam.
    expect(classes).toContain("min-h-[100px]");
    expect(classes).toContain("sm:min-h-24");
    expect(classes).not.toContain("min-h-24");
    expect(classes).not.toContain("sm:min-h-[68px]");
    expect(classes.some((c) => /^(sm:)?h-(16|\[68px\])$/.test(c))).toBe(false);
  });

  it("a barra de cima reserva a altura da versão quebrada no celular (sem pulo quando os pontos chegam)", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    // Carregando: sem pontos, só título + "Expandir" (44px).
    await montar(
      <AdminKpiCarousel cards={cardsFake} title="Métricas" loading={true} />,
    );
    const barraCarregando = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) => b.textContent?.includes("Expandir"))!.parentElement!
      .parentElement!;
    expect(barraCarregando.className.split(/\s+/)).toContain("min-h-[65px]");
    expect(barraCarregando.className.split(/\s+/)).toContain("sm:min-h-11");

    // Carregado: a mesma barra, com a mesma reserva.
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);
    const barraPronta = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Expandir"),
    )!.parentElement!.parentElement!;
    expect(barraPronta.className.split(/\s+/)).toContain("min-h-[65px]");
    expect(barraPronta.className.split(/\s+/)).toContain("sm:min-h-11");
  });

  it("a seta invisível não captura toque (pointer-events-none) e só vira clicável no hover/foco do computador", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const proximo = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Próximo"]',
    )!;
    const anterior = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Anterior"]',
    )!;
    for (const seta of [proximo, anterior]) {
      const classes = seta.className.split(/\s+/);
      expect(classes).toContain("opacity-0");
      expect(classes).toContain("pointer-events-none");
    }
    // Só o computador (sm:) devolve o toque, com mouse em cima ou foco.
    const classesProximo = proximo.className.split(/\s+/);
    expect(classesProximo).toContain(
      "sm:group-hover/carousel:pointer-events-auto",
    );
    expect(classesProximo).toContain(
      "sm:group-focus-within/carousel:pointer-events-auto",
    );
    // E o opacity-100 do hover também só a partir de sm: (seta visível =
    // seta clicável; no celular nunca aparece "morta").
    expect(classesProximo).toContain("sm:group-hover/carousel:opacity-100");
    expect(classesProximo).not.toContain("group-hover/carousel:opacity-100");
  });

  it("o rótulo quebra em até 2 linhas, em frase normal, nunca abaixo de 11px", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const rotulo = hospedeiro.querySelector("h3")!.previousElementSibling!;
    const classes = rotulo.className.split(/\s+/);
    expect(classes).toContain("line-clamp-2");
    expect(classes).toContain("text-xs");
    expect(classes).toContain("font-semibold");
    // Se um tamanho em px entrar aqui, nunca fica abaixo de 11px.
    const tamanhos = classes
      .filter((c) => c.includes("text-["))
      .map((c) => Number.parseFloat(c.slice(c.indexOf("text-[") + 6)));
    for (const tamanho of tamanhos) expect(tamanho).toBeGreaterThanOrEqual(11);
  });

  it("o ponto dourado do título não achata quando o título quebra", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const ponto = hospedeiro.querySelector("span.animate-pulse");
    expect(ponto!.className).toContain("shrink-0");
  });

  it.each([6, 8])(
    "com %i grupos a barra de cima quebra linha e o 'Expandir' fica dentro dela",
    async (quantos) => {
      emblaFalso.estado.grupos = Array.from({ length: quantos }, (_, i) => i);
      const AdminKpiCarousel = await carregarCarrossel();
      await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

      const pontos = hospedeiro.querySelectorAll(
        'button[aria-label^="Mostrar o grupo"]',
      );
      expect(pontos.length).toBe(quantos);
      // Alvo de toque de 44px preservado.
      for (const ponto of pontos) expect(ponto.className).toContain("size-11");

      const expandir = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Expandir"),
      )!;
      // Do botão até a barra: cada nível que o contém tem que poder quebrar
      // linha (o jsdom não mede layout — a medida em pixels foi feita no
      // Chromium a 360px; aqui fica a classe que a garante).
      const grupoDireito = expandir.parentElement!;
      const barra = grupoDireito.parentElement!;
      const grupoDosPontos = pontos[0].parentElement!;
      expect(barra.className).toContain("flex-wrap");
      expect(grupoDireito.className).toContain("flex-wrap");
      expect(grupoDireito.className).toContain("max-w-full");
      expect(grupoDosPontos.className).toContain("flex-wrap");
      expect(grupoDosPontos.parentElement).toBe(grupoDireito);
    },
  );

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

  it("só as setas que podem rolar ganham o reveal do hover/foco; a desabilitada nunca aparece nem aceita clique", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    // O dublê do Embla: canScrollPrev=false, canScrollNext=true.
    const anterior = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Anterior"]',
    )!;
    const proximo = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Próximo"]',
    )!;
    expect(anterior.disabled).toBe(true);
    const reveal = (el: Element) =>
      el.className
        .split(/\s+/)
        .filter((c) => c.startsWith("sm:group-") && /opacity|pointer/.test(c));
    // A variante `sm:group-hover:*` vence `opacity-0` de base: a desabilitada
    // não pode carregar nenhuma delas.
    expect(reveal(anterior)).toEqual([]);
    expect(reveal(proximo).length).toBeGreaterThan(0);
  });

  it("abaixo de 640px as setas nem existem no layout (sem foco invisível no Tab); de sm: em diante voltam, com nome", async () => {
    const AdminKpiCarousel = await carregarCarrossel();
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    for (const [titulo, nome] of [
      ["Anterior", "Anterior"],
      ["Próximo", "Próximo"],
    ]) {
      const seta = hospedeiro.querySelector<HTMLButtonElement>(
        `button[title="${titulo}"]`,
      )!;
      const classes = seta.className.split(/\s+/);
      expect(classes).toContain("hidden");
      expect(classes).toContain("sm:flex");
      expect(classes).not.toContain("flex");
      expect(seta.getAttribute("aria-label")).toBe(nome);
    }
  });
});
