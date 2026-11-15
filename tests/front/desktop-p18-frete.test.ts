// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const raizDoRepo = resolve(import.meta.dirname, "../..");
const caminho = "src/views/admin/AdminShippingView.tsx";
const fonte = readFileSync(resolve(raizDoRepo, caminho), "utf8");
// Literais extraídos de git show 84a35d769:src/views/admin/AdminShippingView.tsx.
// Sem executar git no teste: o checkout raso do CI não contém essa base.
const classesDaBase = [
  "size-3.5",
  "size-3.5",
  "size-3.5 animate-spin",
  "size-3.5",
  "flex shrink-0 items-center",
  "flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-extrabold transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 ${infoBotaoSalvar.estilo}",
  "pb-admin min-h-screen bg-admin-bg text-zinc-100",
  "sticky top-0 z-30 bg-admin-bg/90 px-4 py-3 backdrop-blur-md sm:px-6",
  "mx-auto max-w-4xl rounded-[20px] border border-admin-border bg-admin-surface p-4",
  "flex items-center gap-1",
  "min-w-0 break-words text-2xl font-black uppercase italic tracking-tight",
  "flex min-h-11 min-w-11 shrink-0 items-center justify-center text-[hsl(var(--admin-text-soft))]",
  "size-5",
  "mt-2 flex flex-wrap items-center justify-between gap-2",
  'rounded-full border border-admin-border px-2.5 py-1 text-xs font-bold ${pendencias || confirmarTransportadoras ? "text-amber-300" : "text-emerald-300"}',
  "mt-2 text-xs text-red-300",
  "mx-auto max-w-4xl space-y-4 p-4 sm:px-6",
  "animate-pulse space-y-4",
  "h-72 rounded-[20px] bg-admin-raised",
  "h-24 rounded-[20px] bg-admin-raised",
  "rounded-xl border border-admin-border bg-admin-surface p-3 text-[12.5px] text-zinc-400",
  "pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]",
  "space-y-3",
  "pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]",
  "pt-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[hsl(var(--admin-text-soft))]",
  'flex flex-wrap items-center gap-3 rounded-[20px] border bg-admin-surface p-4 ${faltaCep ? "border-amber-500/40" : "border-admin-border"}',
  "flex size-10 shrink-0 items-center justify-center rounded-xl bg-admin-raised text-admin-gold",
  "size-5",
  "min-w-[150px] flex-1 break-words",
  "text-[15px] font-extrabold",
  "text-[13px] text-[hsl(var(--admin-text-soft))]",
  "min-h-11 rounded-xl border border-admin-border bg-admin-raised px-3 text-[13px] font-bold",
  "mt-6 space-y-4 border-t border-admin-border pt-5",
  "text-sm font-bold text-zinc-200",
  "ml-2 text-xs font-normal text-zinc-500",
  "text-xs text-zinc-500",
  "space-y-1.5",
  "flex items-center gap-2 text-xs text-zinc-400",
  "size-4 text-emerald-400",
  "min-h-11 w-full rounded-xl border border-admin-border bg-admin-surface px-3 text-sm text-zinc-100 disabled:opacity-50",
  "text-xs text-amber-300",
  "space-y-1.5",
  "text-xs text-zinc-400",
  "min-h-11 w-full rounded-xl border border-admin-border bg-admin-surface px-3 text-sm text-zinc-100 disabled:opacity-50",
  "text-xs text-zinc-500",
  "mt-3 text-xs text-amber-300",
  "min-h-11 underline",
  "mb-4 flex rounded-full bg-admin-bg p-1",
  'min-h-11 min-w-0 flex-1 rounded-full px-2 text-xs font-bold ${abaGratis === aba ? "border border-solid border-foreground bg-admin-hover text-foreground" : "text-zinc-300"}',
  "block text-red-300",
  "mt-2 text-[12.5px] text-red-300",
  "text-sm font-bold",
  "mb-3 text-[12.5px] text-[hsl(var(--admin-text-soft))]",
  "mt-5 text-sm font-bold",
  "mt-2 text-[12.5px] text-[hsl(var(--admin-text-soft))]",
  "mt-2 min-h-11 rounded-xl border border-admin-border px-3 text-xs font-bold",
  "text-xs leading-relaxed text-[hsl(var(--admin-text-soft))]",
  "rounded-[14px] border border-amber-500/30 bg-amber-500/10 p-3 text-amber-300",
  "flex items-start gap-2 text-[13px] font-bold",
  "size-[18px] shrink-0",
  "mt-1 text-[12.5px]",
  "mt-2 min-h-11 rounded-lg border border-amber-500/30 px-3 text-xs font-bold",
];

function classesLiterais(texto: string): string[] {
  return [
    ...texto.matchAll(/className="([^"]*)"|className=\{`([^`]*)`\}/g),
  ].map((m) => classesDoCelular(m[1] ?? m[2]));
}

const { estado, updateConfig } = vi.hoisted(() => ({
  estado: {
    config: {} as Record<string, unknown>,
    carregado: true,
    erro: false,
    offline: false,
    gratis: 0,
    cep: "38400000",
    endereco: "Rua de teste, 123",
    faixa: "",
    ligados: [] as string[],
    erroTransportadoras: false,
  },
  updateConfig: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    isLoaded: estado.carregado,
    configIndisponivel: estado.erro,
    updateConfig,
    refresh: vi.fn(),
  }),
}));

function configurarLoja() {
  estado.config = {
    freeShippingMin: estado.gratis,
    shippingCoverage: "national",
    originCep: estado.cep,
    enabledShippingMethods: ["sedex", "pac"],
    localDeliveryFee: 10,
    localDeliveryEnabled: true,
    localDeliveryDays: 1,
    localCepRange: estado.faixa,
    storeAddress: estado.endereco,
    storeCity: "Cidade de teste",
    storeState: "SP",
    nationalShippingStrategy: "desligado",
    nationalShippingMin: 0,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  };
}

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { whatsapp: null, nome: null },
              error: null,
            }),
        }),
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: (_nome: string, opcoes: { body?: { action?: string } }) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: {
              success: !estado.erroTransportadoras,
              modo: "multi",
              ligados: estado.ligados,
              provedores: {
                melhor_envio: {
                  tem_chave: estado.ligados.includes("melhor_envio"),
                  sandbox: false,
                  servicos: null,
                },
                superfrete: {
                  tem_chave: false,
                  sandbox: false,
                  servicos: null,
                },
                frenet: { tem_chave: false, sandbox: false, servicos: null },
              },
            },
            error: estado.erroTransportadoras
              ? new Error("Erro de teste")
              : null,
          });
        }
        return Promise.resolve({ data: { success: true }, error: null });
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna de teste do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("P18 — Frete no computador, só classes", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(estado, {
      carregado: true,
      erro: false,
      offline: false,
      gratis: 0,
      cep: "38400000",
      endereco: "Rua de teste, 123",
      faixa: "",
      ligados: [],
      erroTransportadoras: false,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    localStorage.clear();
  });

  async function montar() {
    configurarLoja();
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      root.render(createElement(AdminShippingView, { active: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return host.querySelector("main")!;
  }

  it("preserva cada literal de classes do celular da base", () => {
    expect(classesLiterais(fonte)).toHaveLength(62);
    expect(classesLiterais(fonte)).toEqual(classesDaBase);
  });

  it("alarga corpo e cabeçalho juntos e mantém Salvar no cabeçalho sem corte", async () => {
    const main = await montar();
    const header = host.querySelector("header")!;
    expect(main.classList.contains("lg:max-w-none")).toBe(true);
    expect(header.classList.contains("lg:max-w-none")).toBe(true);
    expect(header.classList.contains("lg:grid")).toBe(true);
    // O cabeçalho É a faixa fixa da tela (nada fixo acima dele): fica em top-0,
    // como nas outras telas do painel. Um offset aqui o empurraria 96 px para
    // baixo e esconderia o início do corpo.
    expect(header.parentElement?.classList.contains("top-0")).toBe(true);
    expect(header.parentElement?.className).not.toMatch(/(?:^|\s)lg:top-/);
    expect(header.textContent).toContain("Salvo");
    expect(header.querySelector("button[disabled]")).not.toBeNull();
    expect(header.className).not.toMatch(/overflow-hidden|h-screen|max-h-/);
    expect(main.className).not.toMatch(/overflow-hidden|h-screen|max-h-/);
  });

  it.each([
    "grátis desligado, lista vazia",
    "grátis ligado, transportadora",
    "carregando",
    "erro da loja",
    "sem internet",
    "sem CEP e endereço",
    "alcance inválido",
    "erro das transportadoras",
  ])(
    "enumera todos os filhos da grade sem deixar buraco: %s",
    async (cenario) => {
      if (cenario === "grátis ligado, transportadora") {
        estado.gratis = 100;
        estado.ligados = ["melhor_envio"];
      }
      if (cenario === "carregando") estado.carregado = false;
      if (cenario === "erro da loja") estado.erro = true;
      if (cenario === "sem internet") estado.offline = true;
      if (cenario === "sem CEP e endereço") {
        estado.cep = "";
        estado.endereco = "";
      }
      if (cenario === "alcance inválido") estado.faixa = "inválido";
      if (cenario === "erro das transportadoras")
        estado.erroTransportadoras = true;
      const main = await montar();
      expect(main.classList.contains("xl:grid")).toBe(true);
      expect(main.classList.contains("xl:grid-cols-2")).toBe(true);
      expect(main.classList.contains("xl:space-y-0")).toBe(true);
      expect(main.classList.contains("xl:gap-6")).toBe(true);
      expect(main.className).not.toMatch(
        /(?:^|\s)lg:grid(?:\s|$)|lg:grid-cols-2/,
      );
      // 1024: 720px, uma coluna (nenhuma grade em lg:, verificado acima).
      // 1280: (976 - 24) / 2 = 476px por coluna, só a partir de xl:.

      // Aplica os seletores reais da classe do main aos filhos REAIS renderizados.
      const regras = [
        ...main.className.matchAll(/xl:\[&>([^\]]+)\]:col-span-([12])/g),
      ].sort((a, b) => Number(a[1] !== "*") - Number(b[1] !== "*"));
      const filhos = [...main.children];
      expect(filhos.length).toBeGreaterThan(0);
      let ocupado = 0;
      const estreitos: string[] = [];
      for (const filho of filhos) {
        let span = 1;
        for (const regra of regras) {
          if (filho.matches(regra[1])) span = Number(regra[2]);
        }
        if (span === 1) estreitos.push(filho.id);
        expect(
          ocupado + span,
          filho.outerHTML.slice(0, 160),
        ).toBeLessThanOrEqual(2);
        ocupado = (ocupado + span) % 2;
      }
      expect(ocupado, "a última linha também deve estar completa").toBe(0);
      expect(estreitos).toEqual(
        estado.carregado ? ["painel-frete-local", "painel-frete-nacional"] : [],
      );
      if (estado.erro)
        expect(
          main.querySelector("[data-aviso-loja-sem-dados]"),
        ).not.toBeNull();
      if (estado.offline) expect(main.textContent).toContain("Sem internet.");
      if (!estado.carregado)
        expect(main.querySelector("[aria-busy]")).not.toBeNull();
    },
  );
});
