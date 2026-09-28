// @vitest-environment jsdom
//
// Política de trocas e devoluções no painel (PoliticaDeDevolucaoSection):
// lê a linha id=1 de `politica_devolucao`, não deixa salvar abaixo dos
// mínimos da lei (arrependimento 7, vício 30 — com a explicação) e grava
// pela RPC `salvar_politica_de_devolucao({p})`, com as categorias sem troca
// escolhidas entre as categorias que a loja tem.
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
const onDirtyMudou = vi.fn();

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

async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection onDirtyMudou={onDirtyMudou} />);
  });
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function digitar(id: string, valor: string) {
  const campo = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
  expect(campo).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    campo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(campo, valor);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
    campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("mínimos legais da política (funções puras)", () => {
  it("arrependimento ≥ 7, vício ≥ 30, troca 0..365 — com explicação", async () => {
    const { erroDaTroca, erroDoArrependimento, erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoArrependimento("6")).toContain("CDC art. 49");
    expect(erroDoArrependimento("7")).toBeNull();
    expect(erroDoArrependimento("91")).toBe("No máximo 90 dias.");
    expect(erroDoVicio("29")).toContain("CDC art. 26");
    expect(erroDoVicio("90")).toBeNull();
    expect(erroDaTroca("0")).toBeNull();
    expect(erroDaTroca("")).toBe("Informe o número de dias.");
  });
});

describe("PoliticaDeDevolucaoSection", () => {
  it("abaixo do mínimo legal explica e não deixa salvar", async () => {
    await montar();
    expect(botao("Política salva")?.disabled).toBe(true);

    await digitar("politica-arrependimento", "5");
    expect(hospedeiro.textContent).toContain("CDC art. 49");
    expect(botao("Salvar política")?.disabled).toBe(true);

    await digitar("politica-vicio", "20");
    expect(hospedeiro.textContent).toContain("CDC art. 26");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("salva pela RPC com os prazos e as categorias sem troca escolhidas", async () => {
    await montar();

    await digitar("politica-arrependimento", "10");
    await act(async () => {
      botao("Moda íntima")?.click();
    });
    expect(onDirtyMudou).toHaveBeenLastCalledWith(true);

    await act(async () => {
      botao("Salvar política")?.click();
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledWith(
      "salvar_politica_de_devolucao",
      expect.objectContaining({
        p: expect.objectContaining({
          prazo_arrependimento_dias: 10,
          prazo_vicio_dias: 90,
          categorias_sem_troca: ["Moda íntima"],
          metodos_locais: ["entrega_na_loja", "coleta"],
        }),
      }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(botao("Política salva")).toBeTruthy();
    expect(onDirtyMudou).toHaveBeenLastCalledWith(false);
  });

  it("recusa do servidor aparece como veio", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Acesso negado." },
    });
    await montar();
    await digitar("politica-troca", "15");
    await act(async () => {
      botao("Salvar política")?.click();
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(toast.error).toHaveBeenCalledWith("Acesso negado.");
  });
});
