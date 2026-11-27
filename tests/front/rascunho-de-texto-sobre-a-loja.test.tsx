// @vitest-environment jsdom
//
// Caça "aba descartada perde rascunho" (27/11): a lojista escreve a descrição
// da loja em Minha loja, troca de app (vai tirar uma foto) e o celular
// descarta a aba. Sem rascunho, ao voltar a descrição tinha sumido. Agora o
// texto vai para o aparelho quando a aba fica oculta e, ao reabrir a tela,
// o painel oferece restaurar — só para a MESMA conta, por até 7 dias.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { toast } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

let configAtual: Record<string, unknown>;
let usuarioAtual = "admin-1";
const updateConfigMock = vi.fn(async (_mudanca: unknown, _opcoes: unknown) => {
  return true;
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: usuarioAtual },
    session: { user: { id: usuarioAtual } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
const chave = (uid: string) => `ikcous_rascunho_de_texto_sobre-a-loja:${uid}`;

let visibilidade: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => visibilidade,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  usuarioAtual = "admin-1";
  visibilidade = "visible";
  configAtual = {
    storeName: "Ateliê da Serra",
    storeCity: "Monte Carmelo",
    storeState: "MG",
    originCep: "38500-000",
    businessHours: "Seg-Sex: 8h às 19h",
    whatsappNumber: "(34) 99999-9999",
    storeAddress: null,
    storeDescription: "<p>Texto salvo</p>",
  };
  pararABuscaDeCep();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  // Antes do unstub: o armazenamento de reserva do setup é um stub global.
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function montar() {
  const { AdminAboutStoreView } = await import(
    "@/views/admin/AdminAboutStoreView"
  );
  await act(async () => {
    raiz.render(<AdminAboutStoreView onNavigate={() => {}} />);
  });
}

/** Desmonta e monta de novo, como a aba recarregada depois do descarte. */
async function remontar() {
  act(() => raiz.unmount());
  raiz = createRoot(hospedeiro);
  await montar();
}

const campo = () =>
  hospedeiro.querySelector("#store-description") as HTMLTextAreaElement;

async function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function ocultarAAba() {
  visibilidade = "hidden";
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  visibilidade = "visible";
}

type OpcoesDoAviso = {
  action: { onClick: () => void };
  cancel: { onClick: () => void };
};
const ofertaDeRascunho = () =>
  toast.info.mock.calls.find(([titulo]) =>
    String(titulo).includes("Rascunho"),
  ) as [string, OpcoesDoAviso] | undefined;

describe("Minha loja — rascunho da descrição sobrevive à aba descartada", () => {
  it("aba oculta guarda o texto e, ao voltar, Restaurar o devolve", async () => {
    await montar();
    await digitar("A história que eu estava escrevendo");
    await ocultarAAba();
    await remontar();

    expect(campo().value).toBe("Texto salvo");
    const oferta = ofertaDeRascunho();
    expect(oferta).toBeDefined();
    await act(async () => oferta?.[1].action.onClick());
    expect(campo().value).toBe("A história que eu estava escrevendo");
  });

  it("Descartar apaga o rascunho e a tela fica com o salvo", async () => {
    await montar();
    await digitar("Rascunho que ela não quer");
    await ocultarAAba();
    await remontar();

    const oferta = ofertaDeRascunho();
    expect(oferta).toBeDefined();
    await act(async () => oferta?.[1].cancel.onClick());
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();
    expect(campo().value).toBe("Texto salvo");
  });

  it("sem digitar nada, aba oculta não cria rascunho", async () => {
    await montar();
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();
    await remontar();
    expect(ofertaDeRascunho()).toBeUndefined();
  });

  it("outra conta no mesmo aparelho nunca vê o rascunho", async () => {
    await montar();
    await digitar("Texto da conta 1");
    await ocultarAAba();
    act(() => raiz.unmount());

    usuarioAtual = "admin-2";
    raiz = createRoot(hospedeiro);
    await montar();
    expect(ofertaDeRascunho()).toBeUndefined();
    expect(campo().value).toBe("Texto salvo");
    // E o da conta 1 continua guardado para ela.
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();
  });

  it("salvar com sucesso apaga o rascunho", async () => {
    await montar();
    await digitar("Texto novo");
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();

    const botao = hospedeiro.querySelector(
      '[aria-label="Ações de Minha loja"] button',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();

    await remontar();
    expect(ofertaDeRascunho()).toBeUndefined();
  });

  it("rascunho com mais de 7 dias é ignorado e sai do aparelho", async () => {
    localStorage.setItem(
      chave("admin-1"),
      JSON.stringify({
        texto: "Texto de outra época",
        base: "Texto salvo",
        salvoEm: Date.now() - SETE_DIAS_MS - 60_000,
      }),
    );
    await montar();
    expect(ofertaDeRascunho()).toBeUndefined();
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();
  });

  it("controle: rascunho de 6 dias ainda é oferecido", async () => {
    localStorage.setItem(
      chave("admin-1"),
      JSON.stringify({
        texto: "Texto da semana",
        base: "Texto salvo",
        salvoEm: Date.now() - SETE_DIAS_MS + 24 * 60 * 60 * 1000,
      }),
    );
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();
  });
});
