// @vitest-environment jsdom
//
// Política de devolução (lote 203): a mensagem de erro de um prazo (~100
// caracteres) ficava presa na coluna de 76 px do campo. Agora ela ocupa a
// linha inteira. O jsdom não mede largura: a prova aqui é a estrutura (o erro
// não é filho do item de 76 px) e as classes que a fazem ocupar as duas
// colunas; a largura real só o navegador prova.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, maybeSingle, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "c-1", name: "Moda íntima" },
      { id: "c-2", name: "Calçados" },
    ],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeAddress: "Rua das Flores, 100 — Centro" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-09-26T10:00:00Z",
  updated_by: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: LINHA, error: null });
  rpc.mockImplementation(
    (_nome: string, args: { p: Record<string, unknown> }) =>
      Promise.resolve({ data: { ...LINHA, ...args.p }, error: null }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection />);
  });
  await esperar();
}

function campo(id: string) {
  const el = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
  expect(el).toBeTruthy();
  return el as HTMLInputElement;
}

async function digitar(id: string, valor: string) {
  const el = campo(id);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

describe("prazos: o erro ocupa a linha inteira", () => {
  it("o erro do Arrependimento não fica na coluna de 76 px", async () => {
    await montar();
    await digitar("politica-arrependimento", "3");
    const erro = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Mínimo de 7 dias"),
    );
    expect(erro).toBeTruthy();
    // linha do prazo = avó do <p>; o envolucro do campo = pai.
    const envolucro = erro?.parentElement as HTMLElement;
    const linha = envolucro.parentElement as HTMLElement;
    const grade = linha.parentElement as HTMLElement;
    expect(grade.className).toContain("grid-cols-[1fr_76px]");
    // o envolucro some do layout (o campo vira o item de 76 px) e o erro
    // ocupa as duas colunas da linha.
    expect(grade.className).toContain("[&>div>div]:contents");
    expect(grade.className).toContain("[&>div>div>p]:col-span-2");
    expect(envolucro.contains(campo("politica-arrependimento"))).toBe(true);
  });
});
