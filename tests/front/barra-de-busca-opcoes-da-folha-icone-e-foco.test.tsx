// @vitest-environment jsdom
//
// BarraDeBusca / OpcoesDaBusca — bordas que as provas vizinhas não pisam:
//  - as opções na FAIXA (padrão) ficam do tamanho do texto e mostram o contador
//    "N no recorte"; as mesmas opções dentro da FOLHA de filtros ocupam a
//    largura toda e NÃO repetem o contador;
//  - sem contador informado, nenhum número aparece;
//  - o ícone do botão de modo mostra o modo atual (grade no detalhado, lista no
//    compacto);
//  - a bolinha de filtros ativos só aparece com filtro ativo (omitido = nenhum);
//  - a folha de filtros nasce fechada, não tem o "X" embutido além do próprio
//    "Fechar filtros", e devolve o foco ao botão de Filtros ao fechar — menos
//    quando fecha para abrir o gerenciador de categorias.
import { BarraDeBusca, OpcoesDaBusca } from "@/components/admin/BarraDeBusca";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObservadorMudo);
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  globalThis.history.replaceState({ view: "pedidos" }, "", "/pedidos");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opcoes = [
  {
    valor: "todos",
    rotulo: "Todos",
    selecionada: true,
    onClick: () => {},
    quantidade: 12,
  },
  {
    valor: "pagos",
    rotulo: "Pagos",
    selecionada: false,
    onClick: () => {},
    quantidade: 0,
  },
  {
    valor: "sem",
    rotulo: "Sem contagem",
    selecionada: false,
    onClick: () => {},
  },
];

const botoes = () => [...host.querySelectorAll("button")];
const classes = (el: Element) => el.className.split(/\s+/);

describe("OpcoesDaBusca — faixa x folha", () => {
  it("na faixa: opção do tamanho do texto e com o contador 'N no recorte' (inclusive o zero)", async () => {
    await act(async () => root.render(<OpcoesDaBusca opcoes={opcoes} />));
    for (const b of botoes()) {
      expect(classes(b)).toContain("shrink-0");
      expect(classes(b)).not.toContain("w-full");
    }
    expect(host.querySelector('[aria-label="12 no recorte"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="0 no recorte"]')).not.toBeNull();
  });

  it("sem contador informado, nenhum número aparece na opção", async () => {
    await act(async () => root.render(<OpcoesDaBusca opcoes={opcoes} />));
    const semContagem = botoes().find((b) =>
      b.textContent?.includes("Sem contagem"),
    ) as HTMLButtonElement;
    expect(semContagem.querySelector(".tabular-nums")).toBeNull();
    expect(semContagem.textContent).toBe("Sem contagem");
  });

  it("na folha: opção na largura toda e SEM o contador", async () => {
    await act(async () => root.render(<OpcoesDaBusca opcoes={opcoes} folha />));
    for (const b of botoes()) {
      expect(classes(b)).toContain("w-full");
      expect(classes(b)).not.toContain("shrink-0");
      expect(b.querySelector(".tabular-nums")).toBeNull();
    }
    expect(host.querySelector('[aria-label$="no recorte"]')).toBeNull();
  });
});

function Barra({
  modo = "compact",
  extra = {},
}: {
  modo?: "compact" | "detailed";
  extra?: Record<string, unknown>;
}) {
  return (
    <BarraDeBusca
      id="busca-teste"
      rotulo="Buscar pedidos"
      placeholder="Buscar pedido…"
      value=""
      onChange={() => {}}
      modo={modo}
      onMudarModo={() => {}}
      grupo="Situação"
      tituloFiltro="Situação do pedido"
      opcoes={opcoes}
      {...extra}
    />
  );
}

describe("BarraDeBusca — ícone do modo e bolinha de filtros", () => {
  const iconeDoModo = () =>
    host
      .querySelector('button[aria-label^="Mostrar"] svg')
      ?.getAttribute("class");

  it("modo detalhado mostra o ícone de grade; compacto mostra o de lista", async () => {
    await act(async () => root.render(<Barra modo="detailed" />));
    expect(iconeDoModo()).toContain("lucide-layout-grid");
    expect(iconeDoModo()).not.toContain("lucide-list");
    await act(async () => root.render(<Barra modo="compact" />));
    expect(iconeDoModo()).toContain("lucide-list");
    expect(iconeDoModo()).not.toContain("lucide-layout-grid");
  });

  it("filtrosAtivos omitido: sem bolinha; com 3: bolinha '3'; com 0: sem bolinha", async () => {
    const bolinha = () =>
      host.querySelector('button[aria-label="Filtros"] span')?.textContent;
    await act(async () => root.render(<Barra />));
    expect(bolinha()).toBeUndefined();
    await act(async () => root.render(<Barra extra={{ filtrosAtivos: 3 }} />));
    expect(bolinha()).toBe("3");
    await act(async () => root.render(<Barra extra={{ filtrosAtivos: 0 }} />));
    expect(bolinha()).toBeUndefined();
  });
});

describe("BarraDeBusca — folha de filtros", () => {
  const filtros = () =>
    host.querySelector('button[aria-label="Filtros"]') as HTMLButtonElement;
  const dialogo = () => document.body.querySelector('[role="dialog"]');
  const esperar = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));
  /** Espera (máquina carregada oscila) até a condição valer, no máximo 3 s. */
  async function esperarAte(condicao: () => boolean) {
    for (let i = 0; i < 60 && !condicao(); i++) {
      await act(async () => {
        await esperar(50);
      });
    }
  }

  async function abrir(extra: Record<string, unknown> = {}) {
    await act(async () => root.render(<Barra extra={extra} />));
    await act(async () => {
      filtros().click();
    });
    await esperarAte(() => dialogo() !== null);
  }

  it("nasce fechada (aria-expanded=false, sem diálogo)", async () => {
    await act(async () => root.render(<Barra />));
    expect(dialogo()).toBeNull();
    expect(filtros().getAttribute("aria-expanded")).toBe("false");
  });

  it("aberta: só o 'Fechar filtros' fecha (sem o X embutido), e as opções da folha não repetem o contador", async () => {
    await abrir();
    expect(dialogo()).not.toBeNull();
    expect(filtros().getAttribute("aria-expanded")).toBe("true");
    const nomes = [...(dialogo()?.querySelectorAll("button") ?? [])].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
    );
    expect(nomes.filter((n) => /fechar|close/i.test(n ?? ""))).toEqual([
      "Fechar filtros",
    ]);
    expect(dialogo()?.querySelector(".tabular-nums")).toBeNull();
  });

  it("fechar pelo 'Fechar filtros' devolve o foco ao botão de Filtros", async () => {
    await abrir();
    const fechar = document.body.querySelector(
      'button[aria-label="Fechar filtros"]',
    ) as HTMLButtonElement;
    await act(async () => {
      fechar.click();
    });
    await esperarAte(
      () => dialogo() === null && document.activeElement === filtros(),
    );
    expect(dialogo()).toBeNull();
    expect(document.activeElement).toBe(filtros());
  });

  it("'Gerenciar categorias' fecha a folha SEM puxar o foco de volta ao botão de Filtros", async () => {
    const aoGerenciar = vi.fn();
    await abrir({ onGerenciarCategorias: aoGerenciar });
    const gerenciar = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Gerenciar categorias"),
    ) as HTMLButtonElement;
    await act(async () => {
      gerenciar.click();
    });
    await esperarAte(() => dialogo() === null);
    // folga para o foco que (por defeito) voltaria ao botão de Filtros
    await act(async () => {
      await esperar(150);
    });
    expect(aoGerenciar).toHaveBeenCalledTimes(1);
    expect(dialogo()).toBeNull();
    expect(document.activeElement).not.toBe(filtros());
  });
});
