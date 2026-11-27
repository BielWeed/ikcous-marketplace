// @vitest-environment jsdom
//
// A lojista tem o painel aberto em dois aparelhos. No A ela muda o prazo de troca (30 -> 45) e salva.
// O B ficou aberto com a politica lida ANTES (prazo 30); la ela so edita o texto e salva. O formulario
// mandava TODOS os campos de volta e o prazo voltava a 30 em silencio. Agora o pedido leva SO os campos
// que a lojista mexeu (comparados com o que a tela leu); a RPC aceita chave ausente ("campo ausente
// fica como esta"), entao o banco guarda o resto. Mesma regra que ja valia para a lista de categorias.
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

async function digitarTexto(id: string, valor: string) {
  const campo = hospedeiro.querySelector<HTMLTextAreaElement>(`#${id}`);
  expect(campo).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
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

describe("salvar a política envia só os campos que a lojista alterou", () => {
  it("mudar só o texto: o pedido leva só o texto (o prazo de outro aparelho não é desfeito)", async () => {
    await montar();
    await digitarTexto(
      "politica-texto",
      "Trocas em até 30 dias, com etiqueta.",
    );
    await salvar();

    expect(pedidos()).toEqual([
      { texto_politica: "Trocas em até 30 dias, com etiqueta." },
    ]);
  });

  it("mudar só o prazo de troca: o pedido leva só o prazo", async () => {
    await montar();
    await digitar("politica-troca", "45");
    await salvar();

    expect(pedidos()).toEqual([{ prazo_troca_dias: 45 }]);
  });

  it("mudar dois campos: leva os dois e mais nada", async () => {
    await montar();
    await digitar("politica-vicio", "120");
    await act(async () => {
      botao("A loja paga")?.click();
    });
    await salvar();

    expect(pedidos()).toEqual([
      { prazo_vicio_dias: 120, frete_troca_pago_por: "loja" },
    ]);
  });

  it("alternar um método (lista) leva só aquela lista", async () => {
    await montar();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLElement>(
          '[aria-label="Coleta no endereço do pedido"]',
        )
        ?.click();
    });
    await salvar();

    // a lista vai com a versão que a tela VIU (`vistos`): o banco recusa se outro aparelho a mudou
    expect(pedidos()).toEqual([
      {
        metodos_locais: ["entrega_na_loja"],
        vistos: { metodos_locais: ["entrega_na_loja", "coleta"] },
      },
    ]);
  });

  it("mudar o prazo e voltar ao valor salvo: não é mudança e o botão fica parado", async () => {
    await montar();
    await digitar("politica-troca", "45");
    await digitar("politica-troca", "30");

    expect(botao("Política salva")?.disabled).toBe(true);
    await salvar();
    expect(pedidos()).toHaveLength(0);
  });

  it("nada mudou: o botão fica desligado ('Política salva') e nenhum pedido sai", async () => {
    await montar();

    expect(botao("Política salva")?.disabled).toBe(true);
    await salvar();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("depois de salvar, o próximo salvamento compara com o que o BANCO devolveu", async () => {
    await montar();
    await digitar("politica-troca", "45");
    await salvar();
    await digitar("politica-vicio", "100");
    await salvar();

    expect(pedidos()).toEqual([
      { prazo_troca_dias: 45 },
      { prazo_vicio_dias: 100 },
    ]);
  });
});

describe("a lista 'sem troca' continua indo só quando a lojista mexeu nela", () => {
  it("marcar uma categoria MANDA a lista inteira, e só ela", async () => {
    await montar();
    await act(async () => {
      botao("Calçados")?.click();
    });
    await salvar();

    expect(pedidos()).toEqual([
      {
        categorias_sem_troca: ["Brinquedo", "Calçados"],
        vistos: { categorias_sem_troca: ["Brinquedo"] },
      },
    ]);
  });

  it("mudar prazo e categoria: leva os dois", async () => {
    await montar();
    await digitar("politica-troca", "20");
    await act(async () => {
      botao("Brinquedo")?.click();
    });
    await salvar();

    expect(pedidos()).toEqual([
      {
        prazo_troca_dias: 20,
        categorias_sem_troca: [],
        vistos: { categorias_sem_troca: ["Brinquedo"] },
      },
    ]);
  });
});
