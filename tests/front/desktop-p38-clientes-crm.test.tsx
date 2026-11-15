// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { ClientesDoCrm } from "@/components/admin/crm/ClientesDoCrm";
import type { ClienteDoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/components/admin/crm/ClientesDoCrm.tsx";
const fonte = readFileSync(caminho, "utf8");
// Literais da base e7e81afc7: o CI não precisa do histórico do git.
const CLASSES_DO_CELULAR_NA_BASE = [
  "inline-flex items-center rounded-full border border-admin-border px-2 py-0.5 text-[11px] font-bold text-zinc-400",
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
  "size-1.5 shrink-0 rounded-full",
  "min-w-0 whitespace-normal",
  "relative flex min-h-[68px] flex-col justify-between gap-1 rounded-xl p-2 text-left",
  "border-solid border-foreground bg-admin-hover ring-1 ring-foreground hover:border-foreground",
  "flex items-start gap-1.5",
  "size-2 shrink-0 rounded-full",
  "opacity-60",
  "min-w-0 text-[11px] font-bold leading-[14px] text-zinc-200",
  "ml-auto size-3 shrink-0 text-zinc-500 sm:size-3.5",
  "premium-shimmer h-5 w-16 rounded-md sm:h-6 sm:w-12",
  "flex items-baseline justify-between gap-1.5 sm:block",
  "text-base font-black tabular-nums sm:block sm:text-xl",
  "text-zinc-400",
  "text-white",
  "min-w-0 break-words text-[11px] tabular-nums text-zinc-400 sm:mt-0.5 sm:block",
  "absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-foreground text-background",
  "size-3",
  "text-admin-text min-h-11 rounded-xl bg-admin-raised px-3 text-xs font-bold",
  "space-y-4",
  "mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-400",
  "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3",
  "mt-4 flex items-center justify-between gap-3 rounded-xl border border-admin-gold/20 bg-admin-gold/[0.06] px-3 py-2",
  "min-w-0 text-xs font-semibold text-admin-gold",
  "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-black uppercase tracking-wider text-admin-gold transition-colors hover:bg-admin-gold/10",
  "size-3.5",
  "hidden min-w-0",
  "text-[11px] uppercase tracking-wider text-zinc-400",
  "font-bold tabular-nums text-white",
  "min-w-0",
  "text-[11px] uppercase tracking-wider text-zinc-400",
  "font-bold tabular-nums",
  "text-white",
  "text-zinc-400",
  "hidden font-bold tabular-nums",
  "text-white",
  "text-zinc-400",
  "min-w-0",
  "text-[11px] uppercase tracking-wider text-zinc-400",
  "tabular-nums text-zinc-300",
  "hidden min-w-0",
  "text-[11px] uppercase tracking-wider text-zinc-400",
  "text-zinc-300",
  "grid min-h-[166px] grid-cols-2 gap-x-3 gap-y-2 rounded-2xl border border-admin-border bg-admin-surface p-3",
  "col-span-2 flex min-w-0 items-center gap-2",
  "flex size-9 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-raised text-sm font-bold text-admin-gold",
  "min-w-0 flex-1",
  "text-admin-text break-words text-sm font-bold",
  "",
  "text-admin-text-soft shrink-0 text-right text-[11px]",
  "hidden min-w-0",
  "",
  "col-span-2",
  "text-xs text-zinc-400",
  "hidden",
  "col-span-2 grid grid-cols-2 gap-x-3 gap-y-2",
  "col-span-2 flex gap-2",
  "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 text-[11px] font-black uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20",
  "size-4",
  "",
  "sr-only",
  "flex min-h-11 flex-1 items-center justify-center rounded-xl border border-dashed border-admin-border px-3 text-[11px] font-bold text-zinc-500",
  "flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-solid border-admin-border-strong px-3 text-[11px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5",
  "hidden size-4",
  "",
  "size-4",
  "sr-only",
  "min-w-0 space-y-2",
  "flex items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-xs text-amber-300",
  "min-h-11 shrink-0 px-2 font-bold",
  "min-h-11 min-w-11 shrink-0 font-bold",
  "flex flex-wrap gap-x-3",
  "text-admin-text",
  "text-admin-text",
  "flex min-w-0 gap-2",
  "relative min-w-0 flex-1",
  "text-admin-text-soft pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2",
  "sr-only",
  "h-12 rounded-2xl border-admin-border bg-admin-surface pl-9 text-xs",
  "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-admin-border bg-admin-surface text-admin-text-2",
  "border-solid border-foreground bg-admin-hover text-foreground",
  "size-4",
  "sr-only",
  "flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1",
  "min-h-11 shrink-0 whitespace-nowrap rounded-full border border-solid border-admin-border bg-admin-surface px-3 text-[11px] font-bold text-admin-text-2",
  "border-solid border-foreground bg-admin-hover text-foreground",
  "flex items-center justify-between gap-2 text-xs text-admin-gold",
  "min-h-11 px-2 font-bold",
  "pt-1",
  "space-y-3",
  "border-red-500/20 bg-red-500/5",
  "inline-flex items-center gap-2 text-red-300",
  "size-4 shrink-0",
  "flex min-h-11 items-center gap-1.5 rounded-xl border border-solid border-red-500/20 px-4 text-[11px] font-black uppercase tracking-wider text-red-200 transition-colors hover:bg-red-500/10",
  "size-3.5",
  "space-y-2",
  "premium-shimmer h-[166px] rounded-2xl",
  "space-y-2",
  "hidden gap-5 px-4 text-[11px] font-black uppercase tracking-wider text-zinc-400",
  "space-y-2 transition-opacity",
  "opacity-60",
  "min-h-11 rounded-xl border border-solid border-admin-border px-4 text-[11px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5",
  "min-h-11 rounded-xl bg-foreground px-4 text-[11px] font-black uppercase tracking-widest text-background transition-colors hover:opacity-90",
];

function conferirCelular(texto: string) {
  const arvore = ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const literais: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText() === "className") {
      function literal(filho: ts.Node) {
        if (ts.isStringLiteral(filho))
          literais.push(classesDoCelular(filho.text));
        ts.forEachChild(filho, literal);
      }
      if (no.initializer) literal(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  expect(literais).toEqual(CLASSES_DO_CELULAR_NA_BASE);
}

const cliente: ClienteDoCrm = {
  chave: "cliente-ficticio",
  userId: "cliente-ficticio",
  nome: "Cliente fictícia",
  whatsapp: "11999990000",
  email: null,
  pedidos: 2,
  receita: 100,
  ticketMedio: 50,
  primeiraCompra: "2026-10-01T12:00:00Z",
  ultimaCompra: "2026-11-01T12:00:00Z",
  diasSemComprar: 10,
  r: 4,
  f: 3,
  m: 3,
  segmento: "leais",
  canalPreferido: "presencial",
  valorEmAberto: null,
  cadastradoEm: "2026-09-01T12:00:00Z",
};
const h = vi.hoisted(() => ({
  lista: { total: 1, clientes: [] as ClienteDoCrm[] },
  carregando: false,
  erro: null,
  atualizar: vi.fn(),
}));
vi.mock("@/hooks/useCrm", () => ({ useCrmClientes: () => h }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja fictícia" } }),
}));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// O jsdom não mede pixels. Confere a transição no DOM REAL; a prova de
// largura e colisão é feita separadamente no Chromium com o CSS do app.
function conferirTransicao(linha: Element, cabecalho: Element) {
  expect(linha.className).toContain("xl:grid-cols-[");
  expect(cabecalho.className).toContain("xl:grid-cols-[");
  expect(cabecalho.classList.contains("xl:grid")).toBe(true);
  for (const el of [linha, ...linha.querySelectorAll("*"), cabecalho]) {
    for (const token of el.classList) {
      expect(token, el.tagName).not.toMatch(/^lg:/);
    }
  }
  expect(linha.querySelector(":scope > .col-span-2")?.className).toContain(
    "xl:col-span-1",
  );
  const grupo = linha.querySelector(":scope > .grid");
  if (grupo) {
    expect(grupo.classList.contains("xl:contents")).toBe(true);
    expect(grupo.classList.contains("grid-cols-2")).toBe(true);
  }
  const acoes = linha.querySelector('a[href*="wa.me"]')?.parentElement;
  expect(acoes?.classList.contains("xl:flex-wrap")).toBe(true);
  expect(acoes?.classList.contains("col-span-2")).toBe(true);
}

describe("P38 — clientes legíveis no computador estreito", () => {
  it("preserva cada literal de classes de celular e detecta alteração na cópia", () => {
    conferirCelular(fonte);
    expect(() =>
      conferirCelular(
        fonte.replace("grid min-h-[166px]", "grid min-h-[167px]"),
      ),
    ).toThrow();
  });
  it.each(["leais", "nunca_comprou", "pediu_nao_pagou"] as const)(
    "mantém cartão até 1279 e sete colunas só em xl: %s",
    async (segmento) => {
      h.lista = { total: 1, clientes: [{ ...cliente, segmento }] };
      await act(async () =>
        root.render(
          <ClientesDoCrm
            segmentos={[]}
            carregandoSegmentos={false}
            segmento={null}
            aoMudarSegmento={vi.fn()}
            active
            onNavigate={vi.fn()}
            sinalDeAtualizacao={0}
          />,
        ),
      );
      const linha = host.querySelector('a[href*="wa.me"]')?.closest("li");
      expect(linha).not.toBeNull();
      const cabecalho = [...host.querySelectorAll('[aria-hidden="true"]')].find(
        (el) => el.textContent?.startsWith("ClienteSegmentoPedidos"),
      );
      expect(cabecalho).toBeTruthy();
      conferirTransicao(linha!, cabecalho!);
      // Mutante numa cópia do DOM real, sem tocar o arquivo de produção.
      const copia = linha!.cloneNode(true) as Element;
      copia.className = copia.className.replace(
        "xl:grid-cols-[",
        "lg:grid-cols-[",
      );
      expect(() => conferirTransicao(copia, cabecalho!)).toThrow();
      expect(linha!.textContent).toContain("Cliente fictícia");
      if (segmento === "nunca_comprou")
        expect(linha!.textContent).toContain("Cadastro em");
      else {
        expect(linha!.textContent).toContain("01/11/2026");
        expect(linha!.textContent).toContain("Loja física");
      }
    },
  );
});
