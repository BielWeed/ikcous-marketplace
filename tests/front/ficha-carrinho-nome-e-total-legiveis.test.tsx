// @vitest-environment jsdom
//
// Lote r39-f, a aba Carrinho da ficha do cliente (painel):
//   - o nome do produto não é mais cortado numa linha só sem como ler: ocupa até
//     duas linhas (`line-clamp-2`), quebra palavra comprida (`break-words`) e traz
//     o nome inteiro no `title` (quem usa mouse lê tudo);
//   - o "Total estimado" não é mais texto com degradê (`text-transparent` +
//     `bg-clip-text`): o degradê escapava da troca de cores do tema Claro e o
//     total quase sumia. Agora usa `text-green-500`, a mesma classe do valor de
//     cada linha, que o tema Claro já remapeia para verde escuro.
// O jsdom não aplica CSS: a prova é sobre as classes do DOM renderizado, e as
// classes novas são compiladas no Tailwind do projeto (classe inventada não
// gera CSS).
// Andaime copiado de admin-ficha-carrinho-com-duas-escolhas.test.tsx.
import { createRequire } from "node:module";
import { join } from "node:path";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

const NOME_LONGO =
  "Conjunto Térmico Feminino Algodão Egípcio Manga Longa Tamanho Grande Cor Vinho";

const produtoDoBanco = {
  id: "p-conjunto",
  nome: NOME_LONGO,
  preco_venda: 10,
  estoque: 16,
  ativo: true,
  imagens: [],
  product_variants: [],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: [{ product_id: "p-conjunto", quantity: 1 }],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => {
        const vazio = Promise.resolve({ data: [], error: null });
        return Object.assign(vazio, {
          in: () => Promise.resolve({ data: [produtoDoBanco], error: null }),
          eq: () => vazio,
          order: () => vazio,
        });
      },
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

const raizDoRepo = join(__dirname, "..", "..");
const exigir = createRequire(join(raizDoRepo, "package.json"));
const carregarConfig = exigir("tailwindcss/loadConfig") as (
  caminho: string,
) => Record<string, unknown>;

describe("Ficha do cliente, aba Carrinho: nome e total legíveis (r39-f)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrirAbaCarrinho() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((b) =>
      b.textContent?.includes("Carrinho"),
    );
    await act(async () => {
      aba!.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await act(async () => {
      await esperar(0);
    });
  }

  const classesDe = (el: Element) =>
    (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

  it("o nome do produto ocupa até 2 linhas, quebra palavra e traz o nome inteiro no title", async () => {
    await abrirAbaCarrinho();

    const nome = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === NOME_LONGO,
    );
    expect(nome, "nome do produto ausente na aba Carrinho").toBeDefined();
    const classes = classesDe(nome as HTMLElement);
    expect(classes).toContain("line-clamp-2");
    expect(classes).toContain("break-words");
    expect(classes).not.toContain("truncate");
    expect(nome?.getAttribute("title")).toBe(NOME_LONGO);
  });

  it("o Total estimado é texto verde comum (text-green-500), sem degradê transparente", async () => {
    await abrirAbaCarrinho();

    const rotulo = [...hospedeiro.querySelectorAll("td")].find(
      (td) => td.textContent?.trim() === "Total estimado",
    );
    expect(rotulo, "rótulo 'Total estimado' ausente").toBeDefined();
    const valor = rotulo?.nextElementSibling as HTMLElement;
    expect(valor.textContent?.replace(/\s/g, " ")).toContain("R$ 10,00");
    const classes = classesDe(valor);
    expect(classes).toContain("text-green-500");
    expect(classes).not.toContain("text-transparent");
    expect(classes).not.toContain("bg-clip-text");
    expect(classes.some((c) => c.startsWith("from-"))).toBe(false);
    expect(classes.some((c) => c.startsWith("to-"))).toBe(false);
    expect(classes).not.toContain("bg-gradient-to-r");
  });

  it("as classes usadas nesta correção existem no Tailwind do projeto", async () => {
    const usadas = [
      "line-clamp-2",
      "break-words",
      "text-green-500",
      "whitespace-nowrap",
      "tracking-tighter",
      "text-sm",
      "min-[360px]:text-base",
      "min-[400px]:text-lg",
    ];
    const tailwind = exigir("tailwindcss");
    const config = carregarConfig(join(raizDoRepo, "tailwind.config.js"));
    const resultado = await postcss([
      tailwind({
        ...config,
        content: usadas.map((classe) => ({
          raw: `<div class="${classe}"></div>`,
          extension: "html",
        })),
      }),
    ]).process("@tailwind utilities;", { from: undefined });

    const barra = String.fromCharCode(92);
    const semRegra = usadas.filter(
      (classe) =>
        !resultado.css.includes(
          `.${classe.replace(/[^a-zA-Z0-9_-]/g, (c) => `${barra}${c}`)}`,
        ),
    );
    expect(semRegra).toEqual([]);
  });
});
