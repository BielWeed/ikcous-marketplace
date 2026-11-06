// @vitest-environment jsdom
//
// A lojista tem o painel aberto em dois aparelhos. No A ela renomeia uma categoria (o banco troca o
// nome tambem na lista "sem troca por gosto"); o B ficou com a politica lida ANTES, com o nome velho.
// No B ela so muda um prazo e salva: o formulario mandava a lista INTEIRA de volta e desfazia, em
// silencio, a renomeacao do A (os produtos da categoria voltavam a aceitar troca por gosto).
// Agora a lista so vai no pedido quando a lojista MEXEU nela; a RPC aceita chave ausente
// ("campo ausente fica como esta"), entao o banco guarda o que tem.
//
// Prazos, regras e valores nao mudam: so o que e' enviado.
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
  useCategories: () => ({
    categories: [
      { id: "c-1", name: "Brinquedo" },
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
  categorias_sem_troca: ["Brinquedo"],
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

async function esvaziarFila() {
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
  await esvaziarFila();
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

async function salvar() {
  await act(async () => {
    botao("Salvar política")?.click();
  });
  await esvaziarFila();
}

function pedidos(): Record<string, unknown>[] {
  return rpc.mock.calls
    .filter(([nome]) => nome === "salvar_politica_de_devolucao")
    .map(([, args]) => args.p as Record<string, unknown>);
}

describe("salvar a política só reenvia a lista 'sem troca' quando a lojista mexeu nela", () => {
  it("mudar só um prazo NÃO manda a lista (o banco guarda a que tem, mesmo renomeada em outro aparelho)", async () => {
    await montar();
    await digitar("politica-troca", "20");
    await salvar();

    const [pedido] = pedidos();
    expect(pedido).toBeDefined();
    expect(pedido?.prazo_troca_dias).toBe(20);
    expect(Object.keys(pedido ?? {})).not.toContain("categorias_sem_troca");
    // O resto do pedido continua completo e com os mesmos valores.
    expect(pedido).toMatchObject({
      prazo_arrependimento_dias: 7,
      prazo_vicio_dias: 90,
      aceita_troca: true,
      aceita_vale: true,
      exige_fotos_vicio: true,
      metodos_locais: ["entrega_na_loja", "coleta"],
      metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
      reembolso_momento: "ao_receber",
      frete_troca_pago_por: "cliente",
    });
  });

  it("marcar uma categoria MANDA a lista inteira", async () => {
    await montar();
    await act(async () => {
      botao("Calçados")?.click();
    });
    await salvar();

    expect(pedidos()[0]?.categorias_sem_troca).toEqual([
      "Brinquedo",
      "Calçados",
    ]);
  });

  it("desmarcar a única categoria MANDA a lista vazia (limpar também é mudança)", async () => {
    await montar();
    await act(async () => {
      botao("Brinquedo")?.click();
    });
    await salvar();

    expect(pedidos()[0]?.categorias_sem_troca).toEqual([]);
  });

  it("marcar e desmarcar de volta deixa a lista como estava: NÃO manda", async () => {
    await montar();
    await act(async () => {
      botao("Calçados")?.click();
    });
    await act(async () => {
      botao("Calçados")?.click();
    });
    await digitar("politica-troca", "20");
    await salvar();

    expect(Object.keys(pedidos()[0] ?? {})).not.toContain(
      "categorias_sem_troca",
    );
  });

  it("depois de salvar, a tela mostra a lista que o BANCO devolveu, e o salvamento seguinte também não a reenvia", async () => {
    await montar();
    // O banco tem outra lista (outro aparelho renomeou) e devolve essa na resposta.
    rpc.mockImplementationOnce(
      (_nome: string, args: { p: Record<string, unknown> }) =>
        Promise.resolve({
          data: { ...LINHA, ...args.p, categorias_sem_troca: ["Brinquedos"] },
          error: null,
        }),
    );
    await digitar("politica-troca", "20");
    await salvar();

    expect(Object.keys(pedidos()[0] ?? {})).not.toContain(
      "categorias_sem_troca",
    );
    expect(botao("Brinquedos")?.getAttribute("aria-pressed")).toBe("true");

    await digitar("politica-troca", "25");
    await salvar();
    expect(pedidos()).toHaveLength(2);
    expect(Object.keys(pedidos()[1] ?? {})).not.toContain(
      "categorias_sem_troca",
    );
  });
});
