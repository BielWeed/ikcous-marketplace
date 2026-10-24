// @vitest-environment jsdom
//
// BARRA DE CIMA DO PAINEL, redesenho "Tinta" (24/10/2026). O dono achou o
// desenho dela "um pouco inferior ao resto do painel". Só apresentação: o que a
// barra FAZ (Voltar/Perfil, nome da loja com os detalhes da conexão, sino com
// bolinha) fica igual — este arquivo prova o que muda no desenho e, nos casos
// de borda, que nada do comportamento se perdeu:
//   - Voltar: retângulo de raio 16 (não mais pílula) com contorno sólido, texto
//     visível "Perfil"/"Voltar" e alvo de 44px;
//   - nome da loja: bolinha de estado (cor do estado) + "Estado · Admin";
//     nome comprido QUEBRA em linhas (nunca corta com reticências);
//   - sino: círculo de 44px neutro, sino cheio, bolinha vermelha só quando há
//     aviso, "!" quando a conferência falhou;
//   - sem cor fixa de tema no cabeçalho (o painel tem 3 temas).
// O jsdom não calcula CSS: a prova visual (3 temas x 320/360/390) é no navegador
// real; aqui a asserção é sobre estrutura e classe.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê o código-fonte do próprio repositório (caminho constante); só leitura */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EstadoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { ConexaoDoPainel } from "@/components/layouts/ConexaoDoPainel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  pedidos: 0,
  falha: false,
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
          : { count: estado.pedidos, error: null },
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lerFonte = (caminho: string) =>
  readFileSync(resolve(process.cwd(), caminho), "utf8");

/** Código sem as linhas de comentário (`//`, `/*`, ` *`). */
const semComentarios = (fonte: string) =>
  fonte
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");

const normal: EstadoDeOperacao = {
  isOffline: false,
  quality: "excellent",
  latency: 80,
  showSyncFlash: false,
};

let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  estado.pedidos = 0;
  estado.falha = false;
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

describe("nome da loja na barra — bolinha de estado e 'Estado · Admin'", () => {
  function montar(est: EstadoDeOperacao, nome = "Loja Aurora") {
    act(() => raiz.render(<ConexaoDoPainel estado={est} nome={nome} />));
    return host.querySelector<HTMLButtonElement>("button")!;
  }

  function bolinha(botao: HTMLElement) {
    return botao.querySelector<HTMLElement>('span[aria-hidden="true"]');
  }

  it.each([
    ["online", normal, "Online · Admin", "text-emerald-400"],
    [
      "conexão boa (não excelente)",
      { ...normal, quality: "good" as const },
      "Online · Admin",
      "text-sky-300",
    ],
    [
      "lenta",
      { ...normal, quality: "slow" as const },
      "Lenta · Admin",
      "text-orange-300",
    ],
    [
      "sem internet",
      { ...normal, isOffline: true, quality: "offline" as const },
      "Sem internet · Admin",
      "text-red-400",
    ],
    [
      "sincronizado",
      { ...normal, showSyncFlash: true },
      "Sincronizado · Admin",
      "text-emerald-400",
    ],
  ])("%s: texto e cor do estado", (_nome, est, texto, cor) => {
    const botao = montar(est);
    expect(botao.textContent).toBe(`Loja Aurora${texto}`);
    const ponto = bolinha(botao);
    expect(ponto, "bolinha de estado").toBeTruthy();
    const classes = ponto!.className.split(/\s+/);
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("bg-current");
    expect(classes).toContain(cor);
    // O estado também é dito em PALAVRAS (cor sozinha não é informação) e o
    // nome acessível continua dizendo o estado.
    expect(botao.getAttribute("aria-label")).toContain("Admin, conexão");
  });

  it("estado anormal pinta também a palavra; o normal deixa o cinza de apoio", () => {
    // A palavra é o <span> mais interno que diz "· Admin" (os de fora a contêm).
    const palavra = (b: HTMLElement) =>
      Array.from(b.querySelectorAll("span"))
        .filter((s) => s.textContent?.includes("· Admin"))
        .at(-1)!;
    // Normal: a palavra herda o cinza de apoio do contêiner (sem cor de estado).
    const palavraNormal = palavra(montar(normal));
    expect(palavraNormal.className).not.toMatch(
      /text-(emerald|sky|orange|red)/,
    );
    expect(palavraNormal.parentElement?.className).toContain(
      "text-muted-foreground",
    );
    act(() => raiz.unmount());
    raiz = createRoot(host);
    const lenta = montar({ ...normal, quality: "slow" });
    expect(palavra(lenta).className).toContain("text-orange-300");
  });

  it("nome MUITO comprido quebra em linhas, nunca corta e o seta fica à vista", () => {
    const longo =
      "Ateliê das Marés & Casa Coleção Jardim das Dunas Premium Importados";
    const botao = montar(normal, longo);
    expect(botao.textContent).toContain(longo);
    expect(botao.querySelector(".truncate, .line-clamp-1")).toBeNull();
    const nomeEl = Array.from(botao.querySelectorAll("span")).find(
      (s) => s.textContent === longo,
    )!;
    expect(nomeEl.className).toContain("break-words");
    // A letra do nome comprido é menor, mas nunca abaixo de 12px.
    expect(nomeEl.className).not.toMatch(/text-\[(?:[0-9]|1[01])(?:\.\d)?px\]/);
    expect(botao.querySelector("svg")).toBeTruthy();
  });

  it("abrir gira a seta e mostra a explicação; o botão de fechar tem 44px", () => {
    const botao = montar(normal);
    const seta = () => botao.querySelector("svg")!;
    expect(seta().getAttribute("class")).not.toContain("rotate-180");
    act(() => botao.click());
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(seta().getAttribute("class")).toContain("rotate-180");
    const painel = document.getElementById(
      botao.getAttribute("aria-controls")!,
    )!;
    expect(painel.textContent).toContain("A loja está conectada.");
    expect(
      painel.querySelector('button[aria-label="Fechar detalhes da conexão"]')
        ?.className,
    ).toContain("size-11");
  });

  it("sem nome (lateral do computador) continua a caixinha com ícone e o rótulo", () => {
    act(() => raiz.render(<ConexaoDoPainel estado={normal} />));
    const botao = host.querySelector<HTMLButtonElement>("button")!;
    expect(botao.textContent).toBe("Online");
    expect(botao.className).toContain("border-admin-border");
    expect(botao.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });
});

describe("AdminLayout — cabeçalho do celular", () => {
  async function montar(view: "admin-dashboard" | "admin-coupon-form") {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView={view} onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    // Um flush para as contagens (promessas) virarem estado.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return host.querySelector("header") as HTMLElement;
  }

  const sinoDe = (cab: HTMLElement) =>
    cab.querySelector<HTMLButtonElement>('button[aria-label="Notificações"]')!;

  it("Voltar/Perfil: retângulo de raio 16 com contorno sólido e texto visível", async () => {
    for (const [view, rotulo] of [
      ["admin-dashboard", "Perfil"],
      ["admin-coupon-form", "Voltar"],
    ] as const) {
      act(() => raiz.unmount());
      raiz = createRoot(host);
      const cab = await montar(view);
      const voltar = Array.from(cab.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === rotulo,
      );
      expect(voltar, rotulo).toBeTruthy();
      const classes = voltar!.className.split(/\s+/);
      expect(classes).toContain("rounded-2xl");
      expect(classes).not.toContain("rounded-full");
      expect(classes).toContain("border-solid");
      expect(classes).toContain("min-h-11");
      expect(classes).toContain("min-w-11");
      expect(voltar!.querySelector("svg")).toBeTruthy();
    }
  });

  it("sino sem aviso: círculo de 44px, sino cheio, SEM bolinha", async () => {
    const cab = await montar("admin-dashboard");
    const sino = sinoDe(cab);
    const classes = sino.className.split(/\s+/);
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("size-11");
    expect(classes).toContain("border-solid");
    expect(sino.querySelector("svg")?.getAttribute("class")).toContain(
      "fill-current",
    );
    expect(sino.querySelector("span")).toBeNull();
    expect(sino.getAttribute("title")).toBe("Notificações");
  });

  it("sino com aviso: bolinha vermelha pulsando no canto, nome e título dizem que há aviso", async () => {
    estado.pedidos = 3;
    const cab = await montar("admin-dashboard");
    const sino = sinoDe(cab);
    const ponto = sino.querySelector("span");
    expect(ponto).toBeTruthy();
    expect(ponto!.getAttribute("aria-hidden")).toBe("true");
    expect(ponto!.className).toContain("bg-red-500");
    expect(ponto!.className).toContain("animate-pulse");
    expect(ponto!.className).toContain("ring-admin-nav");
    expect(ponto!.textContent).toBe("");
    expect(sino.getAttribute("title")).toBe("Há avisos para conferir");
    expect(sino.getAttribute("aria-label")).toBe("Notificações");
  });

  it("conferência que FALHA: o sino mostra '!' e fica com contorno de erro", async () => {
    estado.falha = true;
    const cab = await montar("admin-dashboard");
    const sino = sinoDe(cab);
    expect(sino.querySelector("span")?.textContent).toBe("!");
    expect(sino.getAttribute("title")).toBe("Falha ao conferir avisos");
    const classes = sino.className.split(/\s+/);
    expect(classes).toContain("border-red-300");
    expect(classes).toContain("text-red-400");
  });

  it("o cabeçalho e a conexão não carregam cor fixa de tema (3 temas)", () => {
    const layout = lerFonte("src/components/layouts/AdminLayout.tsx");
    const inicio = layout.indexOf("<header");
    const cabecalho = semComentarios(
      layout.slice(inicio, layout.indexOf("</header>", inicio)),
    );
    // Única cor fixa permitida: o "!" de erro (#B82243 com texto branco), que
    // o CSS dos temas preserva de propósito (regra `.bg-[#B82243].text-white`).
    const hexs = cabecalho.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexs.filter((h) => h.toUpperCase() !== "#B82243")).toEqual([]);
    const conexao = semComentarios(
      lerFonte("src/components/layouts/ConexaoDoPainel.tsx"),
    );
    expect(conexao.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    // O "!" de erro usa `bg-[#B82243] ... text-white` (par que o CSS dos temas
    // preserva); fora esse par, nada de branco/preto/zinco/violeta/rosé fixos.
    const semOParDoErro = cabecalho.replace(
      /bg-\[#B82243\][^"]*text-white/,
      "",
    );
    for (const trecho of [semOParDoErro, conexao]) {
      expect(trecho).not.toMatch(
        /\b(?:text|bg|border|ring)-(?:white|black|zinc|violet|sky-300\/|rose)/,
      );
    }
  });
});
