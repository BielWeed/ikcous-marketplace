// @vitest-environment jsdom
//
// O aviso da tela de Ajustes sobre o arrependimento tem que dizer o que o
// servidor faz: o frete de ida só volta quando o pedido volta inteiro (mesma
// regra da nota que o cliente lê em SolicitarDevolucaoSheet). Dizer "frete de
// ida incluso" sempre prometia à lojista um reembolso que a regra não dá.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeAddress: "Rua das Flores, 100 — Centro" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

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
  maybeSingle.mockResolvedValue({ data: LINHA, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("PoliticaDeDevolucaoSection: aviso do arrependimento", () => {
  it("o frete de ida só volta quando o pedido volta inteiro", async () => {
    const { PoliticaDeDevolucaoSection } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    await act(async () => {
      raiz.render(<PoliticaDeDevolucaoSection onDirtyMudou={vi.fn()} />);
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const aviso = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Arrependimento: mínimo 7 dias"),
    );
    expect(aviso, "aviso do arrependimento").toBeDefined();
    const texto = (aviso?.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain(
      "o frete de ida também volta quando o pedido volta inteiro",
    );
    expect(texto).not.toContain("frete de ida incluso");
  });
});
