// @vitest-environment jsdom
//
// Caça 27/11 — a política de trocas aberta em dois aparelhos. As listas (como
// o produto volta, local e nacional, e as categorias "sem troca por gosto")
// vão INTEIRAS no pedido quando a lojista mexe nelas, montadas da cópia que a
// tela leu. O celular com a tela velha marcava uma categoria e regravava a
// lista sem a categoria que o computador tinha acabado de marcar. Agora o
// pedido leva também a lista que a tela VIU (`p.vistos`); a RPC recusa com
// LST01 quando ela já não é a do banco, sem gravar nada, e a tela relê,
// reaplica por cima da lista nova o que a lojista mudou (merge de três vias:
// visto, escolhido, servidor) e pede para salvar outra vez.
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
    warning: vi.fn(),
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
      { id: "c-3", name: "Roupa" },
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

const AVISO =
  "A política de trocas foi mudada em outro aparelho. Conferimos de novo e mantivemos o que você mudou — revise e salve outra vez.";

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
  updated_at: "2026-11-27T10:00:00Z",
};

const RECUSA = (coluna: string) => ({
  data: null,
  error: {
    code: "LST01",
    details: coluna,
    message: "A lista foi mudada em outro aparelho.",
  },
});

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
    for (let i = 0; i < 10; i++) await Promise.resolve();
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

const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
const interruptor = (rotulo: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="${rotulo}"]`,
  );
const marcada = (nome: string) =>
  botao(nome)?.getAttribute("aria-pressed") === "true";

async function tocar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
}

async function salvar() {
  await tocar(botao("Salvar política"));
  await esvaziarFila();
}

function pedidos(): Record<string, unknown>[] {
  return rpc.mock.calls
    .filter(([nome]) => nome === "salvar_politica_de_devolucao")
    .map(([, args]) => args.p as Record<string, unknown>);
}

describe("política de trocas — a lista mudou em outro aparelho", () => {
  it("marcar uma categoria manda também a lista que a tela VIU", async () => {
    await montar();
    await tocar(botao("Calçados"));
    await salvar();
    expect(pedidos()[0]).toEqual({
      categorias_sem_troca: ["Brinquedo", "Calçados"],
      vistos: { categorias_sem_troca: ["Brinquedo"] },
    });
  });

  it("desligar a coleta manda a lista local vista; a lista nacional, intocada, não vai", async () => {
    await montar();
    await tocar(interruptor("Coleta no endereço do pedido"));
    await salvar();
    expect(pedidos()[0]).toEqual({
      metodos_locais: ["entrega_na_loja"],
      vistos: { metodos_locais: ["entrega_na_loja", "coleta"] },
    });
  });

  it("mudar só um prazo não manda lista nenhuma, nem a lista vista", async () => {
    await montar();
    await digitar("politica-troca", "20");
    await salvar();
    expect(pedidos()[0]).toEqual({ prazo_troca_dias: 20 });
  });

  it("recusa LST01: relê, reaplica a categoria marcada por cima da lista nova e pede para salvar de novo", async () => {
    await montar();
    // O computador marcou "Roupa" enquanto o celular estava aberto.
    rpc.mockImplementationOnce(() =>
      Promise.resolve(RECUSA("categorias_sem_troca")),
    );
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, categorias_sem_troca: ["Brinquedo", "Roupa"] },
      error: null,
    });
    await tocar(botao("Calçados"));
    await salvar();

    expect(toast.error).toHaveBeenCalledWith(AVISO);
    expect(toast.success).not.toHaveBeenCalled();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    // A escolha dela (Calçados) continua, e a do outro aparelho (Roupa) entrou.
    expect(marcada("Brinquedo")).toBe(true);
    expect(marcada("Roupa")).toBe(true);
    expect(marcada("Calçados")).toBe(true);

    await salvar();
    expect(pedidos()[1]).toEqual({
      categorias_sem_troca: ["Brinquedo", "Roupa", "Calçados"],
      vistos: { categorias_sem_troca: ["Brinquedo", "Roupa"] },
    });
  });

  it("recusa LST01: a categoria que ela DESMARCOU continua fora, e a do outro aparelho fica", async () => {
    await montar();
    rpc.mockImplementationOnce(() =>
      Promise.resolve(RECUSA("categorias_sem_troca")),
    );
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, categorias_sem_troca: ["Brinquedo", "Roupa"] },
      error: null,
    });
    await tocar(botao("Brinquedo"));
    await salvar();

    expect(marcada("Brinquedo")).toBe(false);
    expect(marcada("Roupa")).toBe(true);
    await salvar();
    expect(pedidos()[1]).toEqual({
      categorias_sem_troca: ["Roupa"],
      vistos: { categorias_sem_troca: ["Brinquedo", "Roupa"] },
    });
  });

  it("recusa LST01 nos métodos: reaplica a escolha dela, mantém o prazo que ela digitou e traz do banco o que só o outro mudou", async () => {
    await montar();
    rpc.mockImplementationOnce(() =>
      Promise.resolve(RECUSA("metodos_nacionais")),
    );
    // O outro aparelho desligou o código de postagem e a entrega na loja, e
    // mudou o prazo de defeito.
    maybeSingle.mockResolvedValue({
      data: {
        ...LINHA,
        metodos_locais: ["coleta"],
        metodos_nacionais: ["envio_proprio"],
        prazo_vicio_dias: 120,
      },
      error: null,
    });
    await digitar("politica-troca", "20");
    await tocar(interruptor("Eu mesmo envio"));
    await salvar();
    expect(pedidos()[0]).toEqual({
      prazo_troca_dias: 20,
      metodos_nacionais: ["etiqueta_reversa"],
      vistos: { metodos_nacionais: ["etiqueta_reversa", "envio_proprio"] },
    });

    expect(toast.error).toHaveBeenCalledWith(AVISO);
    const ligado = (rotulo: string) =>
      interruptor(rotulo)?.getAttribute("aria-checked");
    // Os dois desligaram um nacional cada: nenhum fica.
    expect(ligado("Código de postagem dos Correios")).toBe("false");
    expect(ligado("Eu mesmo envio")).toBe("false");
    // Local ela não mexeu: segue o banco.
    expect(ligado("Entregar na loja")).toBe("false");
    expect(ligado("Coleta no endereço do pedido")).toBe("true");
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#politica-troca")?.value,
    ).toBe("20");
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#politica-vicio")?.value,
    ).toBe("120");

    await salvar();
    expect(pedidos()[1]).toEqual({
      prazo_troca_dias: 20,
      metodos_nacionais: [],
      vistos: { metodos_nacionais: ["envio_proprio"] },
    });
  });

  it("a lista vista é a do banco depois do salvamento anterior, não a da primeira leitura", async () => {
    await montar();
    await tocar(botao("Calçados"));
    await salvar();
    await tocar(botao("Roupa"));
    await salvar();
    expect(pedidos()[1]).toEqual({
      categorias_sem_troca: ["Brinquedo", "Calçados", "Roupa"],
      vistos: { categorias_sem_troca: ["Brinquedo", "Calçados"] },
    });
  });
});
