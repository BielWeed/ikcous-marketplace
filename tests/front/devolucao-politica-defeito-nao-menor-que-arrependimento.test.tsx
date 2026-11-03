// @vitest-environment jsdom
//
// Caça 03/11, achado f9: o formulário da política validava cada prazo sozinho.
// Com arrependimento 45 e defeito 30 (aceitos pelos CHECKs do banco), no dia 40
// a cliente com produto quebrado via "Problema com o produto" desligado e só
// conseguia pedir como arrependimento, sem o fluxo de defeito. O formulário
// passa a recusar defeito menor que arrependimento, nos dois sentidos: ao
// digitar o defeito e ao mexer no arrependimento (o outro campo é revalidado).
// Só o formulário muda; o que o servidor já valida continua igual.
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
    config: { storeAddress: "Rua das Flores, 100" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM =
  "O prazo de defeito não pode ser menor que o de arrependimento";

const LINHA = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 30,
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

async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection />);
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
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

const ocorrencias = () =>
  (hospedeiro.textContent ?? "").split(MENSAGEM).length - 1;

describe("erroDoVicio — comparação com o arrependimento (função pura)", () => {
  it("defeito menor que o arrependimento é recusado, com os dias na frase", async () => {
    const { erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    const erro = erroDoVicio("30", "45");
    expect(erro).toContain(MENSAGEM);
    expect(erro).toContain("45 dias");
  });

  it("igual ao arrependimento vale; sem o segundo argumento nada muda", async () => {
    const { erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoVicio("45", "45")).toBeNull();
    expect(erroDoVicio("90", "45")).toBeNull();
    expect(erroDoVicio("30")).toBeNull();
    expect(erroDoVicio("29")).toContain("reclamar de defeito");
  });

  it("borda: arrependimento vazio ou inválido não gera erro cruzado no defeito", async () => {
    const { erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoVicio("30", "")).toBeNull();
    expect(erroDoVicio("30", "abc")).toBeNull();
    // 100 já é erro do próprio campo de arrependimento (máximo 90).
    expect(erroDoVicio("30", "100")).toBeNull();
  });

  it("o erro do próprio campo (mínimo 30) vem antes da comparação", async () => {
    const { erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoVicio("20", "45")).toContain("reclamar de defeito");
    expect(erroDoVicio("", "45")).toBe("Informe o número de dias.");
  });
});

describe("PoliticaDeDevolucaoSection — defeito não pode ser menor que arrependimento", () => {
  it("subir o arrependimento acima do defeito revalida o OUTRO campo e trava o salvar", async () => {
    await montar();
    expect(ocorrencias()).toBe(0);

    await digitar("politica-arrependimento", "45");

    // O campo de defeito não foi tocado, mas passou a mostrar o erro.
    expect(ocorrencias()).toBe(1);
    expect(botao("Salvar política")?.disabled).toBe(true);
    await act(async () => {
      botao("Salvar política")?.click();
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("baixar o arrependimento de volta limpa o erro do defeito e libera o salvar", async () => {
    await montar();
    await digitar("politica-arrependimento", "45");
    expect(ocorrencias()).toBe(1);

    await digitar("politica-arrependimento", "20");

    expect(ocorrencias()).toBe(0);
    expect(botao("Salvar política")?.disabled).toBe(false);
  });

  it("subir o defeito até o arrependimento (igual) resolve o erro e salva os dois prazos", async () => {
    await montar();
    await digitar("politica-arrependimento", "45");
    expect(ocorrencias()).toBe(1);

    await digitar("politica-vicio", "45");
    expect(ocorrencias()).toBe(0);

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
          prazo_arrependimento_dias: 45,
          prazo_vicio_dias: 45,
        }),
      }),
    );
  });

  it("borda: política JÁ gravada com defeito menor (45 e 30) mostra o erro ao abrir", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, prazo_arrependimento_dias: 45, prazo_vicio_dias: 30 },
      error: null,
    });
    await montar();

    expect(ocorrencias()).toBe(1);
    // Mexer em qualquer outra coisa não deixa salvar enquanto o erro estiver lá.
    await digitar("politica-troca", "15");
    expect(botao("Salvar política")?.disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});
