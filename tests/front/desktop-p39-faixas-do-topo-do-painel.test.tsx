// @vitest-environment jsdom
//
// P39 (painel em computador): as duas faixas de aviso do topo do painel
// ("Conexão perdida" e "Falha ao conferir avisos") ficam FORA da coluna
// centrada do conteúdo e usavam só `mx-5`. Com a janela em 1536 e 1920 px o
// conteúdo é uma coluna de no máximo 1280 px (`max-w-7xl`, centrada, com 20 px
// de folga de cada lado), e a faixa seguia esticando até a borda do painel:
// em 1920 px ela ia de x=276 a x=1900 (1624 px) contra o conteúdo de x=468 a
// x=1708 (1240 px). A correção é só de computador (`lg:`); abaixo de 1024 px o
// className fica byte a byte o de antes.
//
// Congelado como literal (o CI clona só o último commit: nada de ler histórico).
// O jsdom não calcula CSS, então a conta de largura vem de Chromium (ver o
// relatório da peça); aqui a prova é o className do componente REAL e um
// mutante em cópia, para a trava não ser decorativa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const estado = vi.hoisted(() => ({
  falha: false,
  offline: false,
}));

vi.mock("@/hooks/useOnlineStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnlineStatus")>()),
  useConnectionDiagnostics: () => ({
    isOffline: estado.offline,
    quality: estado.offline ? "offline" : "excellent",
    latency: 80,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => {
  const criarBuilder = () => {
    const builder: any = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.or = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.gte = vi.fn(() => builder);
    // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
    builder.then = (resolver: any, rejeitar?: any) =>
      Promise.resolve(
        estado.falha
          ? { count: null, error: new Error("falhou") }
          : { count: 0, error: null },
      ).then(resolver, rejeitar);
    return builder;
  };
  return {
    supabase: {
      from: vi.fn(() => criarBuilder()),
      rpc: vi.fn((nome: string) =>
        Promise.resolve(
          nome === "admin_devolucoes_listar"
            ? {
                data: { total: 0, itens: [], contagem: { solicitada: 0 } },
                error: null,
              }
            : { data: { total_count: 0 }, error: null },
        ),
      ),
      channel: vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      })),
      removeChannel: vi.fn(),
    },
  };
});

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Como as faixas eram no celular (o que vale abaixo de 1024 px).
const CELULAR_FAIXA_DE_AVISOS =
  "mx-5 my-2 flex shrink-0 flex-wrap items-center gap-3 rounded-2xl border border-rose-300/20 bg-[#2B151D] p-3 text-xs text-[#F5C1CC]";
const CELULAR_FAIXA_DE_CONEXAO =
  "z-40 mx-5 my-2 flex shrink-0 items-start gap-3 rounded-2xl border border-rose-300/20 bg-[#2B151D] p-3 text-xs leading-relaxed text-[#F5C1CC]";

// A coluna do conteúdo é `max-w-7xl` (80rem) com 1.25rem de folga de cada lado
// (o `mx-5` da faixa): a faixa tem de acabar na mesma largura, 77.5rem, e ficar
// centrada quando o painel é mais largo que isso.
const TOKENS_DE_COMPUTADOR = [
  "lg:mx-auto",
  "lg:w-[calc(100%-2.5rem)]",
  "lg:max-w-[77.5rem]",
];

/** O que falta para a faixa ficar alinhada à coluna do conteúdo no computador. */
function problemasDaFaixa(className: string, celularEsperado: string) {
  const problemas: string[] = [];
  if (classesDoCelular(className) !== celularEsperado) {
    problemas.push("a classe do celular mudou");
  }
  const tokens = className.split(/\s+/);
  for (const token of TOKENS_DE_COMPUTADOR) {
    if (!tokens.includes(token)) problemas.push(`falta ${token}`);
  }
  return problemas;
}

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  estado.falha = false;
  estado.offline = false;
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
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montarPainel() {
  const { AdminLayout } = await import("@/components/layouts/AdminLayout");
  await act(async () => {
    raiz.render(
      <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
        <div />
      </AdminLayout>,
    );
  });
  // A conferência dos avisos responde depois do primeiro desenho.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function faixaDeAvisos() {
  const faixa = Array.from(
    host.querySelectorAll<HTMLElement>('[role="status"]'),
  ).find((el) => el.textContent?.includes("Falha ao conferir avisos"));
  expect(faixa, "faixa 'Falha ao conferir avisos'").toBeTruthy();
  return faixa as HTMLElement;
}

function faixaDeConexao() {
  const faixa = Array.from(
    host.querySelectorAll<HTMLElement>('[role="alert"]'),
  ).find((el) => el.textContent?.includes("Conexão perdida"));
  expect(faixa, "faixa 'Conexão perdida'").toBeTruthy();
  return faixa as HTMLElement;
}

describe("P39 — faixas de aviso do topo do painel alinhadas ao conteúdo", () => {
  it("'Falha ao conferir avisos': celular intacto e coluna do computador", async () => {
    estado.falha = true;
    await montarPainel();
    const classe = faixaDeAvisos().className;
    expect(classesDoCelular(classe)).toBe(CELULAR_FAIXA_DE_AVISOS);
    expect(problemasDaFaixa(classe, CELULAR_FAIXA_DE_AVISOS)).toEqual([]);
  });

  it("'Conexão perdida': celular intacto e coluna do computador", async () => {
    estado.offline = true;
    await montarPainel();
    const classe = faixaDeConexao().className;
    expect(classesDoCelular(classe)).toBe(CELULAR_FAIXA_DE_CONEXAO);
    expect(problemasDaFaixa(classe, CELULAR_FAIXA_DE_CONEXAO)).toEqual([]);
  });

  it("a largura máxima da faixa é a da coluna do conteúdo menos a folga", async () => {
    estado.falha = true;
    await montarPainel();
    // O conteúdo mora em `max-w-7xl` (80rem); a faixa em 80rem - 2 x 1.25rem.
    const coluna = host.querySelector("main .max-w-7xl");
    expect(coluna, "coluna do conteúdo com max-w-7xl").toBeTruthy();
    expect(faixaDeAvisos().classList.contains("lg:max-w-[77.5rem]")).toBe(true);
  });

  it("sem falha e sem queda de conexão, nenhuma faixa aparece", async () => {
    await montarPainel();
    expect(host.textContent).not.toContain("Falha ao conferir avisos");
    expect(host.textContent).not.toContain("Conexão perdida");
  });

  // Mutantes em CÓPIA: a trava precisa reprovar, senão é decorativa.
  describe("a trava reprova mutantes", () => {
    const boa = `${CELULAR_FAIXA_DE_AVISOS} ${TOKENS_DE_COMPUTADOR.join(" ")}`;

    it("cópia boa passa", () => {
      expect(problemasDaFaixa(boa, CELULAR_FAIXA_DE_AVISOS)).toEqual([]);
    });

    it("sem a largura máxima: reprova", () => {
      const mutante = boa.replace(" lg:max-w-[77.5rem]", "");
      expect(problemasDaFaixa(mutante, CELULAR_FAIXA_DE_AVISOS)).not.toEqual(
        [],
      );
    });

    it("sem o centramento: reprova", () => {
      const mutante = boa.replace(" lg:mx-auto", "");
      expect(problemasDaFaixa(mutante, CELULAR_FAIXA_DE_AVISOS)).not.toEqual(
        [],
      );
    });

    it("margem do celular alterada: reprova", () => {
      const mutante = boa.replace("mx-5", "mx-4");
      expect(problemasDaFaixa(mutante, CELULAR_FAIXA_DE_AVISOS)).not.toEqual(
        [],
      );
    });

    it("o computador editado DENTRO do literal do celular: reprova", () => {
      const mutante = boa.replace("mx-5", "lg:mx-5");
      expect(problemasDaFaixa(mutante, CELULAR_FAIXA_DE_AVISOS)).not.toEqual(
        [],
      );
    });
  });
});
