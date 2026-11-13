// @vitest-environment jsdom
//
// Política de trocas e devoluções no painel, rede "pendurada" (conecta e não
// responde) na LEITURA inicial: a consulta não tinha prazo, a tela ficava em
// "Carregando política…" para sempre e o "Tentar de novo" só aparecia quando a
// leitura devolvia erro. Agora o estouro cai no caminho de erro que já existe
// (com o botão), e a leitura que chega TARDE, depois do prazo, não sobrescreve
// a tela de uma nova tentativa. Só a rede é dublada; a tela é a de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "c-1", name: "Calçados" }],
  }),
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
    warning: vi.fn(),
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

type Resposta = { data: unknown; error: unknown };
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection />);
  });
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const botaoTentarDeNovo = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    /Tentar de novo/.test(b.textContent ?? ""),
  );
const campo = (id: string) =>
  hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
async function tentarDeNovo() {
  const botao = botaoTentarDeNovo();
  expect(botao).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
}

describe("política de devolução: leitura com a rede conectada e sem resposta", () => {
  it("passado o prazo mostra o erro com 'Tentar de novo', e tentar de novo carrega o formulário", async () => {
    maybeSingle.mockImplementationOnce(() => new Promise<Resposta>(() => {}));
    await montar();
    expect(hospedeiro.textContent).toContain("Carregando política…");
    expect(botaoTentarDeNovo()).toBeUndefined();

    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);

    expect(hospedeiro.textContent).toContain(
      "Não consegui carregar a política de devolução.",
    );
    expect(hospedeiro.textContent).not.toContain("Carregando política…");

    maybeSingle.mockResolvedValueOnce({ data: LINHA, error: null });
    await tentarDeNovo();

    expect(campo("politica-troca")?.value).toBe("30");
    expect(botaoTentarDeNovo()).toBeUndefined();
  });

  it("a leitura que chega tarde, depois da nova tentativa, não sobrescreve o que a nova tentativa mostrou", async () => {
    let chegarTarde!: (r: Resposta) => void;
    maybeSingle.mockImplementationOnce(
      () => new Promise<Resposta>((resolve) => (chegarTarde = resolve)),
    );
    await montar();
    await avancar(PRAZO_DA_CONSULTA_DO_PAINEL_MS);
    expect(botaoTentarDeNovo()).toBeTruthy();

    // A nova tentativa responde com a política de 45 dias de troca.
    maybeSingle.mockResolvedValueOnce({
      data: { ...LINHA, prazo_troca_dias: 45 },
      error: null,
    });
    await tentarDeNovo();
    expect(campo("politica-troca")?.value).toBe("45");

    // A primeira leitura, abandonada, chega agora com um retrato velho.
    await act(async () =>
      chegarTarde({ data: { ...LINHA, prazo_troca_dias: 10 }, error: null }),
    );

    expect(campo("politica-troca")?.value).toBe("45");
  });

  it("a leitura que responde dentro do prazo carrega como antes", async () => {
    maybeSingle.mockResolvedValueOnce({ data: LINHA, error: null });
    await montar();
    await avancar(0);

    expect(campo("politica-troca")?.value).toBe("30");
    expect(botaoTentarDeNovo()).toBeUndefined();
  });
});
