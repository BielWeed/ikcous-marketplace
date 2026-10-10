// @vitest-environment jsdom
//
// G8 do painel simples (spec §6): a política de devolução explica os mínimos
// da lei em palavras — "CDC art. 49" e "CDC art. 26" saem da tela. É SÓ
// TEXTO: os limites (arrependimento 7..90, troca 0..365, defeito 30..365),
// os atributos min/max dos campos e o pacote inteiro da RPC
// `salvar_politica_de_devolucao` ficam exatamente como eram.
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

const ARREPENDIMENTO =
  "Mínimo de 7 dias: é o direito de arrependimento que a lei garante em compras fora da loja física.";
const DEFEITO =
  "Mínimo de 30 dias: é o prazo da lei para reclamar de defeito em produto não durável (o durável tem 90).";

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

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("mínimos da lei em palavras (funções puras)", () => {
  it("arrependimento abaixo de 7 e defeito abaixo de 30 explicam sem 'CDC'", async () => {
    const { erroDoArrependimento, erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoArrependimento("6")).toBe(ARREPENDIMENTO);
    expect(erroDoArrependimento("0")).toBe(ARREPENDIMENTO);
    expect(erroDoVicio("29")).toBe(DEFEITO);
    expect(erroDoVicio("0")).toBe(DEFEITO);
    for (const frase of [ARREPENDIMENTO, DEFEITO]) {
      expect(frase).not.toMatch(/CDC|art\./);
    }
  });

  it("os limites são os mesmos de antes (só o texto mudou)", async () => {
    const { erroDaTroca, erroDoArrependimento, erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    // arrependimento: 7..90
    expect(erroDoArrependimento("7")).toBeNull();
    expect(erroDoArrependimento("90")).toBeNull();
    expect(erroDoArrependimento("91")).toBe("No máximo 90 dias.");
    expect(erroDoArrependimento("")).toBe("Informe o número de dias.");
    expect(erroDoArrependimento("7.5")).toBe("Informe o número de dias.");
    // defeito: 30..365
    expect(erroDoVicio("30")).toBeNull();
    expect(erroDoVicio("365")).toBeNull();
    expect(erroDoVicio("366")).toBe("No máximo 365 dias.");
    expect(erroDoVicio("abc")).toBe("Informe o número de dias.");
    // troca por gosto: 0..365
    expect(erroDaTroca("0")).toBeNull();
    expect(erroDaTroca("365")).toBeNull();
    expect(erroDaTroca("366")).toBe("No máximo 365 dias.");
  });
});

describe("PoliticaDeDevolucaoSection — prazos em palavras", () => {
  it("abaixo do mínimo a tela mostra a frase da lei, sem 'CDC', e não salva", async () => {
    await montar();
    await digitar("politica-arrependimento", "5");
    expect(hospedeiro.textContent).toContain(ARREPENDIMENTO);
    await digitar("politica-vicio", "20");
    expect(hospedeiro.textContent).toContain(DEFEITO);
    expect(hospedeiro.textContent).not.toMatch(/CDC|art\. ?\d/);
    expect(botao("Salvar política")?.disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("os campos mantêm min/max de antes", async () => {
    await montar();
    expect([
      campo("politica-arrependimento").min,
      campo("politica-arrependimento").max,
    ]).toEqual(["7", "90"]);
    expect([campo("politica-troca").min, campo("politica-troca").max]).toEqual([
      "0",
      "365",
    ]);
    expect([campo("politica-vicio").min, campo("politica-vicio").max]).toEqual([
      "30",
      "365",
    ]);
  });

  it("o pacote do salvar é idêntico, chave por chave", async () => {
    await montar();
    await digitar("politica-arrependimento", "10");
    await act(async () => {
      botao("Moda íntima")?.click();
    });
    await act(async () => {
      botao("Salvar política")?.click();
    });
    await esperar();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("salvar_politica_de_devolucao", {
      p: {
        prazo_arrependimento_dias: 10,
        prazo_troca_dias: 30,
        prazo_vicio_dias: 90,
        aceita_troca: true,
        aceita_vale: true,
        exige_fotos_vicio: true,
        metodos_locais: ["entrega_na_loja", "coleta"],
        metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
        reembolso_momento: "ao_receber",
        frete_troca_pago_por: "cliente",
        categorias_sem_troca: ["Moda íntima"],
        texto_politica: "",
        endereco_devolucao: "",
      },
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
