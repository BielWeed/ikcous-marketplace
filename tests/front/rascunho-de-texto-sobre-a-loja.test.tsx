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
// A leitura da loja: concluída (`isLoaded`) e sem falha (`configIndisponivel`).
let lojaCarregada = true;
let lojaIndisponivel = false;
const updateConfigMock = vi.fn(async (_mudanca: unknown, _opcoes: unknown) => {
  return true;
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: lojaCarregada,
    configIndisponivel: lojaIndisponivel,
    refresh: vi.fn(),
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
  lojaCarregada = true;
  lojaIndisponivel = false;
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

type Clique = { preventDefault: () => void };
type OpcoesDoAviso = {
  description: string;
  action: { onClick: (evento?: Clique) => void };
  // Botão próprio (JSX): o `cancel` comum não roda num aviso não dismissible.
  cancel: { props: { onClick: () => void } };
};
const ofertasDeRascunho = () =>
  toast.info.mock.calls.filter(([titulo]) =>
    String(titulo).includes("Rascunho não salvo"),
  ) as [string, OpcoesDoAviso][];
const ofertaDeRascunho = () => ofertasDeRascunho()[0];
const ultimaOferta = () => ofertasDeRascunho().at(-1);
const RECADO_MUDOU = "O texto salvo mudou depois deste rascunho";

function guardarRascunho(texto: string, base: string) {
  localStorage.setItem(
    chave("admin-1"),
    JSON.stringify({ texto, base, salvoEm: Date.now() }),
  );
}

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
    await act(async () => oferta?.[1].cancel.props.onClick());
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

  it("rascunho feito sobre outro texto salvo: o aviso já abre com o recado", async () => {
    guardarRascunho("Meu rascunho", "Texto antigo de antes");
    await montar();
    expect(ofertaDeRascunho()?.[1].description).toContain(RECADO_MUDOU);
  });

  it("controle: rascunho sobre o MESMO texto salvo abre sem o recado", async () => {
    guardarRascunho("Meu rascunho", "Texto salvo");
    await montar();
    expect(ofertaDeRascunho()?.[1].description).not.toContain(RECADO_MUDOU);
  });

  it("salvo muda por fora com o aviso aberto: Restaurar avisa antes e só o segundo troca", async () => {
    guardarRascunho("Meu rascunho", "Texto salvo");
    await montar();
    const primeira = ofertaDeRascunho();
    expect(primeira?.[1].description).not.toContain(RECADO_MUDOU);

    // Outro aparelho salvou; o tempo real troca a descrição na tela.
    configAtual = {
      ...configAtual,
      storeDescription: "<p>Texto do outro aparelho</p>",
    };
    await montar();
    expect(campo().value).toBe("Texto do outro aparelho");

    const clique = { preventDefault: vi.fn() };
    await act(async () => primeira?.[1].action.onClick(clique));
    // Não restaurou: o aviso continua aberto, agora com o recado.
    expect(clique.preventDefault).toHaveBeenCalled();
    expect(campo().value).toBe("Texto do outro aparelho");
    const segunda = ultimaOferta();
    expect(segunda).not.toBe(primeira);
    expect(segunda?.[1].description).toContain(RECADO_MUDOU);

    // Avisada, ela decide restaurar: agora troca.
    await act(async () =>
      segunda?.[1].action.onClick({ preventDefault: vi.fn() }),
    );
    expect(campo().value).toBe("Meu rascunho");
  });

  it("com o aviso esperando, ela digita e esconde a aba: o rascunho antigo fica", async () => {
    guardarRascunho("Rascunho antigo", "Texto salvo");
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();
    await digitar("Outra coisa digitada agora");
    await ocultarAAba();
    const guardado = JSON.parse(localStorage.getItem(chave("admin-1")) ?? "{}");
    expect(guardado.texto).toBe("Rascunho antigo");
  });
});

// "Descartar e Sair" do aviso de saída (App.tsx) chama
// `descartarRascunhoDeTexto`: com o "Rascunho não salvo encontrado" ainda sem
// resposta, o rascunho não é o que ela está descartando — fica para depois.
describe("Minha loja — Descartar e Sair só apaga o rascunho que ela viu", () => {
  async function descartarESair() {
    const { descartarRascunhoDeTexto } = await import(
      "@/lib/rascunho-de-texto"
    );
    descartarRascunhoDeTexto("sobre-a-loja", "admin-1");
  }

  it("aviso de rascunho sem resposta: descartar ao sair não o apaga", async () => {
    guardarRascunho("A história que o celular guardou", "Texto salvo");
    const guardado = localStorage.getItem(chave("admin-1"));
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();

    await descartarESair();
    expect(localStorage.getItem(chave("admin-1"))).toBe(guardado);

    toast.info.mockClear();
    await remontar();
    expect(ofertaDeRascunho()).toBeDefined();
  });

  it("controle: descrição sendo editada e sem salvar sai no descartar", async () => {
    await montar();
    await digitar("Descrição que ela desistiu de salvar");
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();

    await descartarESair();
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();
  });

  // Rede lenta: a loja ainda não chegou (ou a leitura falhou) e ela descartou
  // ao sair. O rascunho que o celular guardou nunca pôde ser oferecido: fica.
  it("loja ainda carregando: o rascunho fica e é oferecido quando ela chega", async () => {
    guardarRascunho("A história que o celular guardou", "Texto salvo");
    const guardado = localStorage.getItem(chave("admin-1"));
    lojaCarregada = false;
    await montar();
    expect(ofertaDeRascunho()).toBeUndefined();

    await descartarESair();
    expect(localStorage.getItem(chave("admin-1"))).toBe(guardado);

    lojaCarregada = true;
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();
  });

  it("leitura da loja falhou: o rascunho fica e é oferecido quando ela volta", async () => {
    guardarRascunho("A história que o celular guardou", "Texto salvo");
    const guardado = localStorage.getItem(chave("admin-1"));
    lojaIndisponivel = true;
    await montar();
    expect(ofertaDeRascunho()).toBeUndefined();

    await descartarESair();
    expect(localStorage.getItem(chave("admin-1"))).toBe(guardado);

    lojaIndisponivel = false;
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();
  });
});
