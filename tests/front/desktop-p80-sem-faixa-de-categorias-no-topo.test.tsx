// @vitest-environment jsdom
// P80 -- "No computador tem duas categorias sendo mostradas. Deixe somente a
// original aí. Tire essa aí da barra superior." (pedido do dono, com print).
// O cabeçalho do computador tinha uma segunda faixa, só de texto ("Todas ·
// Auto Cuidado · brinquedo · Utilidade", nav "Categorias da loja"), logo abaixo
// da linha do logo/busca/menu; a faixa ORIGINAL, com ícones, mora na página
// inicial e não é tocada aqui. Sem a faixa o cabeçalho passa de 121 px (72 da
// linha principal + 48 da faixa + 1 de borda) para 73 px, e tudo que descontava
// os 121 px (teto da coluna grudada, espaçador do Suspense, recuo do aviso)
// acompanha. O celular não muda: o cabeçalho de PC é `hidden lg:block`.
//
// O jsdom não calcula CSS: a altura de fato em cada largura está medida no
// Chromium, no relatório da peça. Aqui a prova é o cabeçalho REAL montado, a
// fonte lida como texto e mutantes em CÓPIA da fonte para a trava não ser
// decorativa.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do ambiente de testes React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const estado = vi.hoisted(() => ({ computador: true }));
vi.mock("@/hooks/useTelaDeComputador", () => ({
  useTelaDeComputador: () => estado.computador,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de ensaio", logoUrl: null } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 2 }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 3 }),
}));
// Com categorias ATIVAS: é o caso em que a faixa aparecia.
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "auto", name: "Auto Cuidado", isActive: true },
      { id: "brinquedo", name: "brinquedo", isActive: true },
      { id: "utilidade", name: "Utilidade", isActive: true },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/components/pwa/IlhaDeAtualizacao", () => ({
  IlhaDeAtualizacao: () => null,
}));

import { CabecalhoCliente } from "@/components/desktop/CabecalhoCliente";
import { CabecalhoDoComputador } from "@/components/desktop/CabecalhoDoComputador";
import * as medidas from "@/components/desktop/medidas";
import type { View } from "@/types";

const FONTE_CABECALHO = readFileSync(
  "src/components/desktop/CabecalhoDoComputador.tsx",
  "utf8",
);
const FONTE_CASCA = readFileSync(
  "src/components/desktop/CabecalhoCliente.tsx",
  "utf8",
);
const FONTE_MEDIDAS = readFileSync("src/components/desktop/medidas.ts", "utf8");

const ALTURA = 73;

/** Só a faixa de texto do cabeçalho, sem falar do resto da fonte. */
const temFaixaNaFonte = (fonte: string) =>
  fonte.includes('aria-label="Categorias da loja"');
const classesDoHeader = (fonte: string) =>
  /<header className="([^"]*)"/.exec(fonte)?.[1] ?? "";
const alturaDoHeader = (fonte: string) =>
  Number(/lg:min-h-\[(\d+)px\]/.exec(classesDoHeader(fonte))?.[1]);
const alturaDoEspacador = (fonte: string) =>
  Number(/lg:h-\[(\d+)px\]/.exec(fonte)?.[1]);

let host: HTMLDivElement;
let root: Root;
const destinos: View[] = [];
const props = {
  currentView: "home" as View,
  onNavigate: (view: View) => {
    destinos.push(view);
  },
  searchQuery: "",
  onSearch: () => {},
  selectedCategory: "Todas",
  onCategorySelect: () => {},
  onCategoryChange: () => {},
  onOpenNotifications: vi.fn(),
};

beforeEach(() => {
  estado.computador = true;
  destinos.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montarCabecalho() {
  await act(async () => {
    root.render(<CabecalhoDoComputador {...props} />);
  });
}

describe("P80 -- o cabeçalho do computador não repete as categorias", () => {
  it("com categorias ativas, não existe a faixa 'Categorias da loja' nem seus botões", async () => {
    await montarCabecalho();
    expect(host.querySelector('[aria-label="Categorias da loja"]')).toBeNull();
    const rotulos = [...host.querySelectorAll("button")].map(
      (botao) => botao.textContent,
    );
    for (const nome of ["Todas", "Auto Cuidado", "brinquedo", "Utilidade"]) {
      expect(rotulos, nome).not.toContain(nome);
    }
    // Nenhuma das categorias aparece como texto do cabeçalho.
    expect(host.textContent).not.toContain("Auto Cuidado");
  });

  it("as ações continuam: logo, busca, Início/Favoritos/Pedidos/Perfil, sino e carrinho", async () => {
    await montarCabecalho();
    expect(
      host.querySelector('button[aria-label="Ir para o Início"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('input[placeholder="Buscar produtos"]'),
    ).not.toBeNull();
    const nav = host.querySelector('[aria-label="Navegação do computador"]');
    expect(nav).not.toBeNull();
    const botoes = [...(nav?.querySelectorAll("button") ?? [])];
    expect(botoes.map((b) => b.textContent)).toEqual([
      "Início",
      "Favoritos",
      "Pedidos",
      "Perfil",
    ]);
    for (const [rotulo, destino] of [
      ["Início", "home"],
      ["Favoritos", "favorites"],
      ["Pedidos", "orders"],
      ["Perfil", "profile"],
    ] as const) {
      act(() => botoes.find((b) => b.textContent === rotulo)?.click());
      expect(destinos.at(-1)).toBe(destino);
    }
    expect(
      host.querySelector('[aria-label="Notificações, 2 não lidas"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Carrinho, 3 itens"]'),
    ).not.toBeNull();
    // A região de status (aviso de "sem internet") segue embaixo do cabeçalho.
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    // Uma só página atual: Início.
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it("o <header> mede 73 px (era 121) e a constante, o espaçador e a coluna grudada acompanham", async () => {
    await montarCabecalho();
    const header = host.querySelector("header") as HTMLElement;
    expect(header.classList.contains("lg:min-h-[73px]")).toBe(true);
    expect(header.className).not.toContain("121px");
    expect(medidas.ALTURA_DO_CABECALHO_DO_COMPUTADOR).toBe(ALTURA);
    expect(medidas.COLUNA_FIXA_NO_COMPUTADOR).toContain(
      `lg:max-h-[calc(100dvh-${ALTURA}px-48px)]`,
    );
    expect(medidas.COLUNA_FIXA_NO_COMPUTADOR).not.toContain("121px");
  });

  it("o espaçador do Suspense (enquanto o cabeçalho carrega) também tem 73 px", async () => {
    act(() =>
      root.render(
        <CabecalhoCliente {...props}>
          <span />
        </CabecalhoCliente>,
      ),
    );
    const espacador = host.querySelector('[aria-hidden="true"]');
    expect(
      espacador,
      "o espaçador precisa existir no primeiro desenho",
    ).not.toBe(null);
    expect(espacador?.classList.contains("lg:h-[73px]")).toBe(true);
    expect(espacador?.className).not.toContain("121px");
    // Deixa o cabeçalho (carregado sob demanda) chegar dentro do act, sem aviso.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(host.querySelector("header")).not.toBeNull();
  });

  it("o celular continua sem cabeçalho de computador", () => {
    estado.computador = false;
    act(() =>
      root.render(
        <CabecalhoCliente {...props}>
          <header data-celular>Celular</header>
        </CabecalhoCliente>,
      ),
    );
    expect(host.querySelector("[data-celular]")).not.toBeNull();
    expect(host.querySelector('[aria-label="Categorias da loja"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Navegação do computador"]'),
    ).toBeNull();
  });
});

describe("P80 -- a fonte e os mutantes", () => {
  it("a fonte não tem a faixa, nem o gancho de categorias que só ela usava", () => {
    expect(temFaixaNaFonte(FONTE_CABECALHO)).toBe(false);
    expect(FONTE_CABECALHO).not.toMatch(/useCategories|categoriaValidaDaHome/);
  });

  it("as três alturas da fonte são 73 e a constante é a mesma", () => {
    expect(alturaDoHeader(FONTE_CABECALHO)).toBe(ALTURA);
    expect(alturaDoEspacador(FONTE_CASCA)).toBe(ALTURA);
    expect(FONTE_MEDIDAS).toContain(
      `export const ALTURA_DO_CABECALHO_DO_COMPUTADOR = ${ALTURA};`,
    );
    expect(FONTE_MEDIDAS).toContain(`calc(100dvh-${ALTURA}px-48px)`);
    expect(FONTE_MEDIDAS).not.toMatch(/\b121px/);
  });

  it("mutante: recolocar a faixa de categorias é pego", () => {
    const mutante = FONTE_CABECALHO.replace(
      '<nav\n          aria-label="Navegação do computador"',
      '<nav aria-label="Categorias da loja" />\n        <nav\n          aria-label="Navegação do computador"',
    );
    expect(mutante).not.toBe(FONTE_CABECALHO);
    expect(temFaixaNaFonte(mutante)).toBe(true);
  });

  it("mutante: voltar o <header> para 121 px é pego", () => {
    const mutante = FONTE_CABECALHO.replace(
      "lg:min-h-[73px]",
      "lg:min-h-[121px]",
    );
    expect(mutante).not.toBe(FONTE_CABECALHO);
    expect(alturaDoHeader(mutante)).not.toBe(ALTURA);
  });

  it("mutante: voltar o espaçador para 121 px é pego", () => {
    const mutante = FONTE_CASCA.replace("lg:h-[73px]", "lg:h-[121px]");
    expect(mutante).not.toBe(FONTE_CASCA);
    expect(alturaDoEspacador(mutante)).not.toBe(ALTURA);
  });
});
