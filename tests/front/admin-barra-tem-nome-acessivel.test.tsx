// @vitest-environment jsdom
//
// A BARRA INFERIOR DO CELULAR TEM NOME — painel simples, tarefa A2. Até aqui
// os cinco botões da barra só tinham o rótulo em texto, e o rótulo carregava
// `hidden sm:inline-block`: em 360px o lojista via cinco ícones sem palavra
// nenhuma e o leitor de tela dependia de um texto escondido.
//
// O CONTRATO (este arquivo):
//   1. Cada aba da barra móvel é um botão com nome acessível próprio:
//      Início, Pedidos, Produtos, Clientes, Ajustes (aria-label).
//   2. O rótulo visível NUNCA leva a classe `hidden` — aparece sempre, a
//      ~11px, e cabe porque a aba é `flex-1` (o Vender segue `shrink-0`).
//   3. O selo de pedidos entra no NOME ("Pedidos, 3 pendentes") e o selo
//      visual fica `aria-hidden`, para o leitor não ler "Pedidos 3 3".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PEDIDOS_PARA_PREPARAR = 3;

function criarContagemBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: PEDIDOS_PARA_PREPARAR, error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => criarContagemBuilder()),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ABAS = ["Início", "Pedidos", "Produtos", "Clientes", "Ajustes"] as const;

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

describe("AdminLayout — a barra inferior do celular tem nome acessível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    // A barra móvel é o único <nav> fixo; a da lateral é uma coluna comum.
    const nav = hospedeiro.querySelector("nav.fixed") as HTMLElement | null;
    expect(nav).toBeTruthy();
    return nav!;
  }

  function botaoDaAba(nav: HTMLElement, rotulo: string) {
    return Array.from(nav.querySelectorAll("button")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith(rotulo),
    ) as HTMLButtonElement | undefined;
  }

  it("cada uma das 5 abas é um botão com nome acessível", async () => {
    const nav = await montar();
    for (const rotulo of ABAS) {
      const botao = botaoDaAba(nav, rotulo);
      expect(botao, `aba ${rotulo}`).toBeTruthy();
      expect(botao!.tagName).toBe("BUTTON");
    }
    expect(botaoDaAba(nav, "Início")!.getAttribute("aria-label")).toBe(
      "Início",
    );
  });

  it("o rótulo visível de cada aba não carrega a classe `hidden`", async () => {
    const nav = await montar();
    for (const rotulo of ABAS) {
      const botao = botaoDaAba(nav, rotulo)!;
      const spanRotulo = Array.from(botao.querySelectorAll("span")).find(
        (s) => s.textContent?.trim() === rotulo,
      );
      expect(spanRotulo, `rótulo ${rotulo}`).toBeTruthy();
      expect(spanRotulo!.className.split(/\s+/)).not.toContain("hidden");
      expect(spanRotulo!.className).not.toContain("sm:inline-block");
      expect(spanRotulo!.className).toContain("text-[11px]");
    }
  });

  it("o selo de pedidos entra no nome e o selo visual é aria-hidden", async () => {
    const nav = await montar();
    await esperarAte(() =>
      (botaoDaAba(nav, "Pedidos")?.getAttribute("aria-label") ?? "").includes(
        String(PEDIDOS_PARA_PREPARAR),
      ),
    );
    const pedidos = botaoDaAba(nav, "Pedidos")!;
    // Texto neutro ("pendentes"): o selo conta pending+new+processing, o que
    // inclui PIX ainda não pago, e o "Para preparar" do Início não conta esse
    // pedido. Até a Onda F unificar a contagem, o nome não promete mais que o número.
    expect(pedidos.getAttribute("aria-label")).toBe(
      `Pedidos, ${PEDIDOS_PARA_PREPARAR} pendentes`,
    );
    const selo = Array.from(pedidos.querySelectorAll("span")).find(
      (s) => s.textContent?.trim() === String(PEDIDOS_PARA_PREPARAR),
    );
    expect(selo).toBeTruthy();
    expect(selo!.getAttribute("aria-hidden")).toBe("true");
  });

  it("no singular o nome diz '1 pendente'", async () => {
    const { supabase } = await import("@/lib/supabase");
    (supabase.from as any).mockImplementation(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({ count: 1, error: null }).then(resolve, reject);
      return builder;
    });
    const nav = await montar();
    await esperarAte(
      () =>
        botaoDaAba(nav, "Pedidos")?.getAttribute("aria-label") ===
        "Pedidos, 1 pendente",
    );
    expect(botaoDaAba(nav, "Pedidos")!.getAttribute("aria-label")).toBe(
      "Pedidos, 1 pendente",
    );
  });
});

// O rótulo visível deixou a barra mais alta (~81px em vez de ~68px abaixo de
// 640px). A folga de baixo do conteúdo no PWA instalado tinha 5.5rem (88px) e
// a barra ocupa 12+81=93px: sobravam 5px do último elemento sob a barra.
// Os dois modos usam a mesma folga base de 6.25rem.
describe("AdminLayout — folga de baixo comporta a barra com rótulo", () => {
  it("o --admin-tab-pb do PWA instalado usa 6.25rem, igual ao do navegador", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de um arquivo do próprio repositório, não entrada de usuário
    const fonte = readFileSync(
      resolve(__dirname, "../../src/components/layouts/AdminLayout.tsx"),
      "utf8",
    );
    const bloco = fonte.slice(
      fonte.indexOf('"--admin-tab-pb"'),
      fonte.indexOf('"--admin-tab-pb"') + 400,
    );
    expect(bloco).not.toContain("5.5rem");
    expect(bloco.match(/6\.25rem/g)?.length).toBe(2);
  });
});
