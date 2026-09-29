// @vitest-environment jsdom
//
// Financeiro — o "olho" do cabeçalho esconde TODOS os valores da tela (saldo
// total, contas, KPIs) e é lembrado neste aparelho (`localStorage`, com
// try/catch: armazenamento bloqueado não derruba a tela, só não lembra).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { CHAVE_VALORES_OCULTOS } from "@/hooks/useFinanceiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const RESUMO = {
  periodo: { inicio: "2026-09-01", fim: "2026-09-30" },
  saldo_total: 12345.67,
  contas: [
    { id: "c1", nome: "Caixa da loja", tipo: "caixa", saldo: 345.67 },
    { id: "c2", nome: "Conta bancária", tipo: "banco", saldo: 12000 },
  ],
  entradas: 5000,
  saidas: 1200,
  resultado: 3800,
  a_receber: { total: 700, vencido: 100, proximos_7_dias: 600 },
  a_pagar: { total: 900, vencido: 0, proximos_7_dias: 300 },
  por_forma: [
    { forma: "pix", valor: 3000 },
    { forma: "cash", valor: 2000 },
  ],
  por_canal: { online: 3000, presencial: 2000 },
  serie: [],
  caixa_aberto: null,
};

rpcFalso.mockImplementation(async (nome: string) => {
  if (nome === "fin_resumo") return { data: RESUMO, error: null };
  return { data: [], error: null };
});

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — ocultar valores", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  async function montar() {
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    });
    await esperar();
  }

  const olho = () =>
    hospedeiro.querySelector(
      "button[aria-pressed][aria-label$='valores']",
    ) as HTMLButtonElement;

  it("o olho esconde saldo, contas e KPIs — e lembra neste aparelho", async () => {
    await montar();
    const visivel = normalizar(hospedeiro.textContent);
    expect(visivel).toContain("R$ 12.345,67");
    expect(visivel).toContain("R$ 345,67");
    expect(visivel).toContain("+R$ 5.000,00");
    expect(olho().getAttribute("aria-label")).toBe("Ocultar valores");

    await act(async () => {
      olho().click();
    });

    const oculto = normalizar(hospedeiro.textContent);
    expect(oculto).not.toContain("12.345,67");
    expect(oculto).not.toContain("345,67");
    expect(oculto).not.toContain("5.000,00");
    expect(oculto).toContain("Valor oculto");
    expect(olho().getAttribute("aria-pressed")).toBe("true");
    expect(olho().getAttribute("aria-label")).toBe("Mostrar valores");
    expect(localStorage.getItem(CHAVE_VALORES_OCULTOS)).toBe("1");

    // Voltar à tela depois: continua escondido.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    expect(normalizar(hospedeiro.textContent)).not.toContain("12.345,67");

    await act(async () => {
      olho().click();
    });
    expect(normalizar(hospedeiro.textContent)).toContain("R$ 12.345,67");
    expect(localStorage.getItem(CHAVE_VALORES_OCULTOS)).toBeNull();
  });

  it("armazenamento bloqueado não derruba a tela", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    await montar();
    expect(normalizar(hospedeiro.textContent)).toContain("R$ 12.345,67");

    await act(async () => {
      olho().click();
    });
    expect(normalizar(hospedeiro.textContent)).not.toContain("12.345,67");
  });
});
