// @vitest-environment jsdom
//
// A lojista renomeia uma categoria em "Gerenciar categorias" (o banco troca o nome
// tambem na lista "sem troca por gosto" da politica de devolucao) e volta para a aba
// Ajustes, que ficou montada por baixo. A secao guarda uma COPIA da lista lida ao abrir:
// se ela nao acompanhar o nome novo, o proximo "Salvar" regrava a lista com o nome
// velho e os produtos da categoria voltam a aceitar troca por gosto, sem aviso.
//
// O aviso real (`publicarMudancaDeCategoria`) NAO e' trocado por dubles: e' o mesmo
// canal que o hook de categorias usa depois de cada renomeacao aceita pelo banco.
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
      { id: "c-1", name: "Brinquedos" },
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

async function renomeadaNaOutraAba(de: string, para: string) {
  const { publicarMudancaDeCategoria } = await import(
    "@/lib/avisos-de-categoria"
  );
  await act(async () => {
    publicarMudancaDeCategoria({ tipo: "renomeada", de, para });
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

async function salvar() {
  await act(async () => {
    botao("Salvar política")?.click();
  });
  await esvaziarFila();
}

function listaGravada(): unknown {
  const chamada = rpc.mock.calls.find(
    ([nome]) => nome === "salvar_politica_de_devolucao",
  );
  return chamada?.[1]?.p?.categorias_sem_troca;
}

describe("renomear categoria com a aba Ajustes aberta por baixo", () => {
  it("salvar um prazo depois da renomeacao NAO regrava o nome antigo na regra", async () => {
    await montar();
    // Ao abrir, a regra esta no nome antigo ("Brinquedos" so existe como chip da lista de categorias).
    expect(botao("Brinquedo")?.getAttribute("aria-pressed")).toBe("true");
    expect(botao("Brinquedos")?.getAttribute("aria-pressed")).toBe("false");

    await renomeadaNaOutraAba("Brinquedo", "Brinquedos");

    // A regra segue ligada, agora no nome novo, e a tela nao fica "suja" por isso.
    expect(botao("Brinquedo")).toBeUndefined();
    expect(botao("Brinquedos")?.getAttribute("aria-pressed")).toBe("true");
    expect(botao("Política salva")).toBeTruthy();

    await digitar("politica-troca", "20");
    await salvar();

    expect(listaGravada()).toEqual(["Brinquedos"]);
  });

  it("o que a lojista ja tinha marcado e ainda nao salvou continua marcado", async () => {
    await montar();
    await act(async () => {
      botao("Calçados")?.click();
    });

    await renomeadaNaOutraAba("Brinquedo", "Brinquedos");
    await salvar();

    expect(listaGravada()).toEqual(["Brinquedos", "Calçados"]);
  });

  it("a troca vale pela regua da vitrine (maiuscula e espaco nas pontas)", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, categorias_sem_troca: ["  brinquedo "] },
      error: null,
    });
    await montar();

    await renomeadaNaOutraAba("Brinquedo", "Brinquedos");
    await digitar("politica-troca", "20");
    await salvar();

    expect(listaGravada()).toEqual(["Brinquedos"]);
  });

  it("renomear outra categoria nao mexe na regra", async () => {
    await montar();

    await renomeadaNaOutraAba("Calçados", "Sapatos");
    await digitar("politica-troca", "20");
    await salvar();

    expect(listaGravada()).toEqual(["Brinquedo"]);
  });

  it("a renomeacao que chega ENQUANTO a politica ainda esta sendo lida tambem vale", async () => {
    let entregar: (resposta: unknown) => void = () => {};
    maybeSingle.mockReturnValue(
      new Promise((resolve) => {
        entregar = resolve;
      }),
    );
    const { PoliticaDeDevolucaoSection } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    await act(async () => {
      raiz.render(<PoliticaDeDevolucaoSection />);
    });

    // A leitura saiu do banco ANTES da troca e so chega depois dela.
    await renomeadaNaOutraAba("Brinquedo", "Brinquedos");
    await act(async () => {
      entregar({ data: LINHA, error: null });
    });
    await esvaziarFila();

    expect(botao("Brinquedos")?.getAttribute("aria-pressed")).toBe("true");
    await digitar("politica-troca", "20");
    await salvar();
    expect(listaGravada()).toEqual(["Brinquedos"]);
  });
});
