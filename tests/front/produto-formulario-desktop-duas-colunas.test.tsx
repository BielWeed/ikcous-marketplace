// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchProduct,
    updateProduct,
    addProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const produto = {
  id: "prod-1",
  name: "Camiseta",
  description: "Algodão",
  price: 100,
  costPrice: 50,
  originalPrice: null,
  stock: 10,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  variants: [],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};
let raiz: Root;
let hospedeiro: HTMLDivElement;
let prateleira: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  fetchProduct.mockResolvedValue(produto);
  updateProduct.mockResolvedValue(produto);
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  hospedeiro = document.createElement("div");
  prateleira = document.createElement("div");
  document.body.append(hospedeiro, prateleira);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  prateleira.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function montar(larga: boolean) {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <ContextoDaBarra.Provider
        value={{
          destino: prateleira,
          receberPrateleira: vi.fn(),
          larga,
          altura: 100,
        }}
      >
        <AdminProductFormView
          userId="lojista-1"
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />
      </ContextoDaBarra.Provider>,
    );
  });
}

function elemento(seletor: string) {
  const el = hospedeiro.querySelector<HTMLElement>(seletor);
  expect(el, seletor).not.toBeNull();
  return el!;
}

// A grade pertence ao ancestral existente: ações e formulário não mudam de pai.
it("em xl reserva 380px para a mesma barra, sem criar ou mover elementos", async () => {
  await montar(true);
  const container = elemento(".produto-formulario");
  const form = elemento("form");
  const barra = elemento('[aria-label="Ações do produto"]');
  expect(container.classList.contains("xl:grid")).toBe(true);
  expect(
    container.classList.contains("xl:grid-cols-[minmax(0,1fr)_380px]"),
  ).toBe(true);
  expect(container.classList.contains("xl:[&>*]:col-span-2")).toBe(true);
  expect(container.classList.contains("xl:[&>form]:col-span-1")).toBe(true);
  expect(elemento(".produto-topo").classList.contains("xl:col-span-2")).toBe(
    true,
  );
  expect(
    elemento('[aria-hidden="true"].h-0').classList.contains("xl:absolute"),
  ).toBe(true);
  expect(form.parentElement).toBe(container);
  expect(barra.parentElement).toBe(container);
  expect(form.classList.contains("xl:col-start-1")).toBe(true);
  expect(form.classList.contains("xl:row-start-3")).toBe(true);
  for (const regra of [
    "col-start-2",
    "col-span-1",
    "row-start-3",
    "sticky",
    "top-24",
    "bottom-auto",
    "self-start",
  ]) {
    expect(
      container.classList.contains(`xl:[&>.admin-acao-inline]:${regra}`),
      regra,
    ).toBe(true);
  }
  expect(container.querySelector("aside")).toBeNull();
  expect(container.classList.contains("lg:[&>.admin-acao-inline]:static")).toBe(
    false,
  );
  expect(barra.closest("form, fieldset")).toBeNull();
  expect(
    form.compareDocumentPosition(barra) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(prateleira.children).toHaveLength(0);
});

// Sidebar 256px, casca sem padding até 1280px, formulário com 40px laterais.
// Cartão: 48px de padding + 2px de borda; o lg segue exatamente a base.
// A regra lida do DOM real decide quando descontar 380px + gap de 24px:
// antecipá-la para lg volta a espremer o formulário em 1024px.
it.each([
  { janela: 1024, duasColunas: false, principal: 728, campos: 678 },
  { janela: 1280, duasColunas: true, principal: 580, campos: 530 },
  { janela: 1536, duasColunas: true, principal: 836, campos: 786 },
  { janela: 1920, duasColunas: true, principal: 836, campos: 786 },
])(
  "em $janela px os campos têm espaço sem antecipar as duas colunas",
  async ({ janela, duasColunas, principal, campos }) => {
    await montar(true);
    const classes = [...elemento(".produto-formulario").classList];
    const gradesAtivas = classes.filter((classe) => {
      if (!classe.endsWith(":grid-cols-[minmax(0,1fr)_380px]")) return false;
      const prefixo = classe.split(":")[0];
      const minimo = { lg: 1024, xl: 1280, "2xl": 1536 }[
        prefixo as "lg" | "xl" | "2xl"
      ];
      expect(minimo).toBeDefined();
      return janela >= minimo;
    });
    const temDuasColunas = gradesAtivas.length > 0;
    expect(temDuasColunas).toBe(duasColunas);
    const largura =
      Math.min(janela - 256, 1280) - 40 - (temDuasColunas ? 380 + 24 : 0);
    expect(largura).toBe(principal);
    expect(largura - 50).toBe(campos);
    // Mesmo APÓS o padding dos cartões, nunca esprememos os campos.
    expect(largura - 50).toBeGreaterThanOrEqual(480);
  },
);

// Sem o portal no celular ou sem o handler real no PC, não grava a edição.
it.each([false, true])(
  "Salvar grava a mesma edição uma única vez (PC=%s), sem duplicar ações",
  async (larga) => {
    await montar(larga);
    const destino = larga
      ? elemento('[aria-label="Ações do produto"]')
      : prateleira;
    expect(
      document.querySelectorAll('[aria-label="Ações do produto"]'),
    ).toHaveLength(1);
    const botao = destino.querySelector<HTMLButtonElement>(".produto-salvar");
    expect(botao).not.toBeNull();
    await act(async () => {
      const nome = elemento("#product-name");
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(nome, "Camiseta nova");
      nome.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(botao!.disabled).toBe(false);
    await act(async () => botao!.click());
    expect(updateProduct).toHaveBeenCalledTimes(1);
    expect(updateProduct.mock.calls[0][0]).toBe("prod-1");
    expect(updateProduct.mock.calls[0][1]).toMatchObject({
      name: "Camiseta nova",
    });
    expect(botao!.textContent).toContain("Salvo");
  },
);

// Base 84a35d769: classe do container + bloco de marcaDoTopo até AcaoDaBarra
// (inclusive), com os dois literais do aviso de conflito de preço com grade.
// Exclui os modais de variante/ajuda fora desse bloco.
// Congelada aqui para funcionar também no CI sem Git/histórico disponível.
const CLASSES_CELULAR_DO_BLOCO_BASE = [
  "produto-formulario pb-admin relative h-auto min-h-full overflow-x-clip text-white",
  "h-0",
  "produto-topo sticky top-0 z-30 bg-admin-bg/95 px-5 backdrop-blur-md",
  "produto-topo-linha mx-auto flex max-w-3xl items-center gap-3",
  "min-w-0 flex-1 [&_h1>span>span]:not-italic [&_h1>span]:whitespace-normal [&_h1]:normal-case [&_h1]:leading-tight",
  "flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-solid border-admin-border bg-zinc-900 text-zinc-300",
  "size-5",
  "mx-auto max-w-3xl px-5 py-1",
  "text-xs text-zinc-400",
  "mt-3",
  "gpu-accelerated mx-auto max-w-3xl space-y-4 p-4 sm:px-5",
  // 1.5.218 (19/11/2026): elemento NOVO, o aviso "o navegador não guardou o
  // rascunho" (só aparece se o armazenamento falhar). Nenhum literal antigo mudou.
  "rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200",
  "m-0 min-w-0 space-y-4 border-0 p-0",
  "flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2",
  "size-5 shrink-0 animate-pulse text-red-500",
  "produto-fotos relative",
  "group/fotos",
  "produto-fotos-titulo flex min-h-12 items-center gap-3 pb-2 pr-14",
  "sr-only",
  "flex size-9 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-raised text-zinc-300",
  "size-5",
  "min-w-0 flex-1",
  "block text-base font-bold",
  "mt-1 block text-xs text-zinc-400",
  "w-full",
  "produto-fotos-vazio",
  "produto-fotos-envio relative flex cursor-pointer select-none flex-col items-center justify-center gap-1 overflow-hidden transition-all",
  "border-emerald-500 bg-emerald-500/10",
  "border-admin-border bg-zinc-900/30 hover:bg-emerald-500/5 hover:border-emerald-500/30",
  "opacity-40 pointer-events-none",
  "sr-only",
  "size-7",
  "text-sm font-medium",
  "hidden",
  "produto-fotos-miniaturas",
  "produto-fotos-dica",
  "min-w-0 flex-1 text-[11px] text-zinc-400",
  "produto-fotos-botoes",
  "produto-fotos-camera flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-bold transition-all",
  "opacity-40 pointer-events-none",
  "hidden",
  "produto-fotos-galeria flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full border border-solid border-admin-border-strong px-3 text-[13px] font-bold",
  "opacity-40 pointer-events-none",
  "produto-fotos-cheio",
  "produto-foto-foco",
  "produto-foto-foco-coluna",
  "produto-foto-foco-imagem",
  "flex size-full items-center justify-center bg-zinc-100 text-zinc-600",
  "size-6",
  "produto-foto-selo text-[11px] font-bold",
  "mt-2 text-xs text-zinc-400",
  "warning_aspect",
  "warning_res",
  "text-orange-300",
  "text-zinc-400",
  "block text-[11px] text-zinc-400",
  "produto-foto-foco-acoes",
  "flex min-h-11 w-full items-center gap-1.5 whitespace-nowrap rounded-xl border border-solid border-admin-border bg-admin-raised px-2.5 text-xs font-bold text-zinc-200 disabled:opacity-40",
  "size-4 shrink-0",
  "flex min-h-11 w-full items-center gap-1.5 rounded-xl bg-rose-400/10 px-2.5 text-xs font-bold text-rose-300 disabled:opacity-40",
  "size-4 shrink-0",
  "min-h-11 w-full rounded-xl border border-solid border-admin-border px-2.5 text-xs font-bold text-zinc-200 disabled:opacity-40",
  "produto-fotos-faixa",
  "produto-fotos-enviando",
  "size-5 animate-spin text-emerald-400",
  "mt-1 flex select-none items-center gap-1.5 text-[11px] font-bold text-zinc-500",
  "mt-2 min-h-11 rounded-xl border border-admin-border px-3 text-sm font-bold text-white",
  "mt-3 space-y-2",
  "flex flex-col gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300 sm:flex-row sm:items-center sm:justify-between",
  "min-w-0",
  "flex shrink-0 gap-2",
  "min-h-11 rounded-xl border border-admin-border bg-admin-raised px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40",
  "min-h-11 rounded-lg border border-admin-border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-zinc-300",
  "flex items-center gap-2",
  "produto-fotos-camera flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-[13px] font-bold",
  "opacity-40 pointer-events-none",
  "size-5",
  "hidden",
  "produto-fotos-galeria flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-solid border-admin-border-strong px-3 text-[13px] font-bold",
  "opacity-40 pointer-events-none",
  "size-5",
  "hidden",
  "mt-3 text-[11px] text-zinc-400",
  "space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5",
  "text-[11px] font-medium leading-relaxed text-zinc-400",
  "list-disc space-y-2 pl-4 text-[11px] font-medium text-zinc-500",
  "text-zinc-350",
  "text-zinc-350",
  "text-zinc-350",
  "text-zinc-350",
  "flex items-center justify-between gap-3 border-t border-admin-border pt-3 text-[11px] font-black uppercase tracking-wider text-emerald-400",
  "produto-dados space-y-2",
  "flex items-center gap-3",
  "produto-rotulo-secao",
  "-my-3 ml-auto flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full text-zinc-300 active:scale-95",
  "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
  "bg-blue-500 border-blue-400 text-blue-950 shadow-md shadow-blue-500/10 scale-110",
  "bg-zinc-950/50 border-admin-border text-zinc-400",
  "space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5",
  "text-[11px] font-medium leading-relaxed text-zinc-400",
  "list-none space-y-3 pl-0 text-[11px] font-medium text-zinc-500",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-300",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500",
  "text-zinc-350",
  "grid grid-cols-2 gap-3",
  "produto-campo col-span-2 space-y-1",
  "ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5 sm:text-base",
  "produto-campo col-span-2 space-y-1",
  "ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "w-full resize-none rounded-2xl border border-admin-border bg-zinc-950/50 px-4 py-3.5 text-sm font-medium leading-relaxed text-zinc-300 transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-3xl sm:px-6 sm:py-5",
  "produto-campo space-y-1 max-[480px]:col-span-2",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "group relative",
  "absolute left-0 top-1/2 -translate-y-1/2 text-sm text-zinc-300",
  "w-full rounded-xl border border-emerald-500/20 bg-zinc-950 py-3 pl-11 pr-4 text-base font-black tabular-nums text-emerald-500 shadow-inner transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/10 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg",
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "ml-1 mt-1 block text-[11px] font-bold text-emerald-500",
  "produto-campo space-y-1 max-[480px]:col-span-2",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "group relative",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black tabular-nums text-white transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:opacity-50 sm:rounded-2xl sm:px-6 sm:py-5",
  "pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400",
  "size-5",
  "ml-1 text-xs text-zinc-400", // Ajuda sobre peças reservadas.
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "produto-rotulo-secao col-span-2 -mb-1 mt-3",
  "col-span-2 space-y-3",
  "flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-admin-border bg-zinc-900/40 p-2.5 transition-all hover:border-emerald-500/10 sm:rounded-2xl sm:p-3.5",
  "min-w-0 space-y-0.5",
  "block text-sm font-bold text-white",
  "block text-[11px] font-medium text-zinc-500",
  "size-5 cursor-pointer rounded border-admin-border bg-zinc-950 text-emerald-500 transition-all focus:ring-emerald-500/20",
  // 1.5.229: aviso novo ao desligar a promoção (elemento novo; o resto do bloco segue congelado).
  "rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-medium leading-relaxed text-amber-200/80",
  "produto-campo space-y-1 duration-300 animate-in fade-in slide-in-from-top-2",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "group relative",
  "absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg",
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "rounded-xl border border-admin-border bg-admin-raised px-3 py-2.5",
  "text-[11px] font-medium text-zinc-500",
  "mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1",
  "text-[11px] font-medium text-zinc-400",
  "text-xl font-bold tabular-nums",
  "text-sm tabular-nums text-zinc-500 line-through",
  "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300",
  "ml-1 block text-[11px] font-bold leading-tight text-amber-400",
  "col-span-2 mt-4 flex items-center gap-4 rounded-[20px] border border-admin-border bg-admin-raised p-3",
  "h-20 w-16 shrink-0 rounded-xl object-cover",
  "flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-800 text-[11px] text-zinc-300",
  "size-6",
  "flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-800 text-[11px] text-zinc-300",
  "size-6",
  "min-w-0 space-y-1",
  "break-words text-base font-bold",
  "text-2xl font-bold tabular-nums",
  "text-xs text-zinc-400",
  "produto-rotulo-secao col-span-2 -mb-1 mt-3",
  "col-span-2",
  "relative space-y-4",
  "flex items-center justify-between",
  "flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full active:scale-95",
  "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
  "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110",
  "bg-zinc-950/50 border-admin-border text-zinc-400",
  "ml-auto mr-2 min-h-11 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white",
  "min-h-11 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white",
  "space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4",
  "text-[11px] font-black uppercase tracking-widest text-amber-400",
  "text-[11px] font-medium leading-relaxed text-amber-200/80",
  "text-[11px] font-medium leading-relaxed text-amber-200/80",
  "space-y-3 rounded-2xl border border-admin-border bg-zinc-950/40 p-4",
  "text-[11px] font-medium leading-relaxed text-zinc-400",
  "text-zinc-350",
  "list-none space-y-2 pl-0 text-[11px] font-medium text-zinc-500",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "space-y-3",
  "rounded-[20px] border border-admin-border bg-admin-surface p-5 text-center",
  "text-sm font-bold text-zinc-300",
  "col-span-2",
  "relative space-y-4",
  "flex items-center justify-between",
  "flex items-center gap-3",
  "flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full active:scale-95",
  "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
  "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110",
  "bg-zinc-950/50 border-admin-border text-zinc-400",
  "space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5",
  "text-[11px] font-medium leading-relaxed text-zinc-400",
  "list-none space-y-3 pl-0 text-[11px] font-medium text-zinc-500",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "flex items-start gap-2.5",
  "mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500",
  "text-zinc-350",
  "grid grid-cols-1 gap-3",
  "produto-campo space-y-1.5",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "group relative",
  "absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg",
  "text-[11px] font-bold mt-1 ml-1 block",
  "Aviso",
  "text-amber-500",
  "text-red-500",
  "space-y-4 rounded-[20px] border border-admin-border bg-admin-raised p-4",
  "flex flex-wrap items-end justify-between gap-3",
  "text-xs text-zinc-400",
  "mt-1 text-xl font-bold tabular-nums",
  "text-right",
  "text-xs text-zinc-400",
  "mt-1 text-xl font-bold tabular-nums",
  "h-2 overflow-hidden rounded-full bg-zinc-800",
  "bg-emerald-400",
  "bg-orange-400",
  "col-span-2",
  "space-y-3",
  "grid grid-cols-2 gap-3 md:grid-cols-4",
  "space-y-1",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500",
  "w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5",
  "ml-1 block text-[11px] font-bold text-red-500",
  "ml-1 block text-[11px] font-medium text-amber-300",
  "space-y-1",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500",
  "w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5",
  "ml-1 block text-[11px] font-bold text-red-500",
  "space-y-1",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500",
  "w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5",
  "ml-1 block text-[11px] font-bold text-red-500",
  "space-y-1",
  "ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500",
  "w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5",
  "ml-1 block text-[11px] font-bold text-red-500",
  "block text-[11px] font-medium leading-normal text-zinc-400",
  "col-span-2",
  "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6",
  "space-y-1.5 md:space-y-3",
  "ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "flex flex-col gap-2 xs:flex-row",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 font-mono text-sm font-black tabular-nums text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5",
  "flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95 sm:rounded-2xl",
  "size-4",
  "ml-1 mt-1 block text-[11px] leading-tight text-zinc-400",
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "ml-1 mt-1 block text-[11px] font-bold text-amber-500",
  "space-y-1.5 md:space-y-3",
  "ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500",
  "w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5",
  "ml-1 mt-1 block text-[11px] leading-tight text-zinc-400",
  "ml-1 mt-1 block text-[11px] font-bold text-red-500",
  "col-span-2",
  "space-y-1",
  "mt-2 flex items-start gap-2 px-1 text-xs text-amber-300",
  "mt-0.5 size-4 shrink-0",
  "break-all text-[11px] text-zinc-400",
  "produto-acoes mx-auto w-full max-w-3xl space-y-1.5",
  "space-y-1 px-1 text-xs text-amber-300",
  "min-h-11 rounded-full bg-admin-raised px-4 text-xs font-bold text-white",
  "produto-status flex flex-wrap items-center gap-x-2 px-1 text-xs font-medium text-amber-300",
  "size-4 shrink-0 text-amber-400",
  "min-h-11 rounded-full bg-admin-raised px-4 text-xs font-bold text-white",
  "produto-status flex items-center gap-2 px-1 text-xs font-bold text-amber-300",
  "size-4 shrink-0 text-amber-400",
  "-my-3.5 min-h-11 min-w-0 truncate text-left font-bold",
  "sr-only",
  "min-w-0 truncate",
  "sr-only",
  "produto-status flex items-center gap-2 px-1 text-xs font-bold text-emerald-300",
  "size-4 shrink-0",
  "grid grid-cols-[minmax(0,1fr)_auto] gap-2",
  "min-w-0",
  "produto-salvar flex min-h-11 w-full min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-base font-bold transition-colors disabled:pointer-events-none",
  "size-5 animate-spin",
  "size-5",
  "size-5",
  "size-5",
  "size-5",
  "produto-prever flex min-h-11 min-w-11 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-surface px-4 text-sm font-bold",
];
const SHA256_CLASSES_CELULAR_BASE =
  "abe76a6cc44e906b9265c27edc790d025630ca589df1ea0fdc5633fc767a2791";
const TOKENS_LG_DA_BASE = [
  "lg:grid-cols-12",
  "lg:col-span-8",
  "lg:col-span-4",
  "lg:pb-12",
  // P57 (1.5.192): a faixa de fotos da variação passa a quebrar linha no
  // computador. É outro elemento, fora do bloco de duas colunas; os tokens de
  // cima seguem congelados.
  "lg:snap-none",
  "lg:flex-wrap",
  "lg:overflow-x-visible",
];

function literaisDoBloco(fonte: string) {
  const ast = ts.createSourceFile(
    "form.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let container: ts.JsxElement | undefined;
  function encontrar(no: ts.Node) {
    if (
      ts.isJsxElement(no) &&
      no.openingElement.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(ast) === "className" &&
          attr.initializer &&
          ts.isStringLiteral(attr.initializer) &&
          attr.initializer.text.startsWith("produto-formulario "),
      )
    ) {
      container = no;
    }
    ts.forEachChild(no, encontrar);
  }
  encontrar(ast);
  if (!container)
    throw new Error("Container produto-formulario não encontrado");
  const filhos = container.children;
  const inicio = filhos.findIndex(
    (no) =>
      ts.isJsxSelfClosingElement(no) &&
      no.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.getText(ast) === "ref" &&
          attr.initializer?.getText(ast) === "{marcaDoTopo}",
      ),
  );
  const fim = filhos.findIndex(
    (no) =>
      ts.isJsxElement(no) &&
      no.openingElement.tagName.getText(ast) === "AcaoDaBarra",
  );
  if (inicio < 0 || fim < inicio) {
    throw new Error("Bloco marcaDoTopo → AcaoDaBarra não encontrado");
  }
  const classes: string[] = [];
  function coletar(no: ts.Node) {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText(ast) === "className" &&
      no.initializer
    ) {
      function literal(valor: ts.Node) {
        if (ts.isStringLiteral(valor)) {
          classes.push(classesDoCelular(valor.text));
        }
        ts.forEachChild(valor, literal);
      }
      literal(no.initializer);
    }
    ts.forEachChild(no, coletar);
  }
  coletar(container.openingElement);
  filhos.slice(inicio, fim + 1).forEach(coletar);
  return classes;
}

it("preserva todos os literais do bloco e os tokens lg da base congelada", () => {
  const fonte = readFileSync(
    "src/views/admin/AdminProductFormView.tsx",
    "utf8",
  );
  const atuais = literaisDoBloco(fonte);
  expect(atuais.length, "quantidade de literais no bloco congelado").toBe(
    CLASSES_CELULAR_DO_BLOCO_BASE.length,
  );
  const divergencias = atuais.flatMap((classe, indice) => {
    const base = CLASSES_CELULAR_DO_BLOCO_BASE.at(indice);
    return classe === base
      ? []
      : [{ literal: indice + 1, base, atual: classe }];
  });
  expect(
    divergencias,
    "classes do celular diferentes da lista congelada",
  ).toEqual([]);
  expect(
    createHash("sha256").update(JSON.stringify(atuais)).digest("hex"),
  ).toBe(SHA256_CLASSES_CELULAR_BASE);
  // Em 1024–1279 nem os tokens lg existentes podem ser alterados.
  expect(fonte.match(/\blg:[^\s"']+/g) ?? []).toEqual(TOKENS_LG_DA_BASE);
});

it("o rótulo longo das medidas pode quebrar linha no PC sem sobrepor o campo", async () => {
  await montar(true);
  const rotulo = elemento('label[for="product-length"]');
  expect(rotulo.textContent?.trim()).toBe("Comprimento (cm)");
  expect(rotulo.classList.contains("xl:whitespace-normal")).toBe(true);
  expect(rotulo.classList.contains("xl:break-words")).toBe(true);
  expect(rotulo.closest(".produto-campo")).toBeNull();
});

// Literais da base 1.5.187: retirar lg: deve reproduzir os containers do celular.
it("preserva classes do celular e a ordem das seções existentes", async () => {
  await montar(true);
  const pares = [
    [
      ".produto-formulario",
      "produto-formulario pb-admin relative h-auto min-h-full overflow-x-clip text-white",
    ],
    [
      ".produto-topo-linha",
      "produto-topo-linha mx-auto flex max-w-3xl items-center gap-3",
    ],
    [".produto-topo + div", "mx-auto max-w-3xl px-5 py-1"],
    ["form", "gpu-accelerated mx-auto max-w-3xl space-y-4 p-4 sm:px-5"],
    ["fieldset", "m-0 min-w-0 space-y-4 border-0 p-0"],
    [".produto-fotos", "produto-fotos relative"],
    [".produto-dados", "produto-dados space-y-2"],
    [".produto-dados .grid", "grid grid-cols-2 gap-3"],
    [".produto-acoes", "produto-acoes mx-auto w-full max-w-3xl space-y-1.5"],
  ];
  for (const [seletor, antes] of pares) {
    expect(classesDoCelular(elemento(seletor).className), seletor).toBe(antes);
  }
  expect(
    [...hospedeiro.querySelectorAll(".produto-rotulo-secao")].map(
      (el) => el.textContent,
    ),
  ).toEqual(["Essencial", "Promoção", "Mais detalhes"]);
  expect(
    [...hospedeiro.querySelectorAll(".produto-secao section")].map((el) =>
      el.getAttribute("aria-label"),
    ),
  ).toEqual([
    "Variações",
    "Custo e lucro",
    "Peso e medidas",
    "Códigos e câmera",
    "Na loja",
  ]);
});
