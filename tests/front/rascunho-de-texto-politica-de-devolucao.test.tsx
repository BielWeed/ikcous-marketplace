// @vitest-environment jsdom
//
// Caça "aba descartada perde rascunho" (27/11): o texto da política de trocas
// e devoluções é longo; a lojista troca de app no meio e o celular descarta a
// aba. Agora o texto vai para o aparelho quando a aba fica oculta e, ao
// reabrir, o painel oferece restaurar — só para a MESMA conta, por 7 dias.
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
    dismiss: vi.fn(),
  }),
}));

let usuarioAtual = "admin-1";

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
    config: { storeAddress: "Rua das Flores, 100 — Centro" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: usuarioAtual } }),
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
  categorias_sem_troca: [],
  texto_politica: "Política salva",
  endereco_devolucao: null,
  updated_at: "2026-09-26T10:00:00Z",
  updated_by: null,
};

const chave = (uid: string) =>
  `ikcous_rascunho_de_texto_politica-de-devolucao:${uid}`;

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
  localStorage.clear();
  sessionStorage.clear();
});

async function montar(ativa = true) {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection ativa={ativa} />);
  });
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function remontar() {
  act(() => raiz.unmount());
  raiz = createRoot(hospedeiro);
  await montar();
}

const campo = () =>
  hospedeiro.querySelector("#politica-texto") as HTMLTextAreaElement;

async function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    campo().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(campo(), texto);
    campo().dispatchEvent(new Event("input", { bubbles: true }));
    campo().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
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

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("Política de devolução — rascunho do texto sobrevive à aba descartada", () => {
  it("aba oculta guarda o texto e, ao voltar, Restaurar o devolve", async () => {
    await montar();
    expect(campo().value).toBe("Política salva");
    await digitar("Trocas em até 30 dias, com etiqueta");
    await ocultarAAba();
    await remontar();

    expect(campo().value).toBe("Política salva");
    const oferta = ofertaDeRascunho();
    expect(oferta).toBeDefined();
    await act(async () => oferta?.[1].action.onClick());
    expect(campo().value).toBe("Trocas em até 30 dias, com etiqueta");
    // Restaurado é alteração pendente: o botão pede para salvar.
    expect(botao("Salvar política")).toBeDefined();
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
    expect(campo().value).toBe("Política salva");
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();
  });

  it("salvar com sucesso apaga o rascunho", async () => {
    await montar();
    await digitar("Texto novo da política");
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();

    await act(async () => {
      botao("Salvar política")?.click();
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();

    await remontar();
    expect(ofertaDeRascunho()).toBeUndefined();
  });

  it("controle: salvar que FALHA mantém o rascunho", async () => {
    await montar();
    await digitar("Texto que não gravou");
    await ocultarAAba();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "XX000", message: "falhou" },
    });
    await act(async () => {
      botao("Salvar política")?.click();
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(chave("admin-1"))).not.toBeNull();
  });

  it("rascunho com mais de 7 dias é ignorado e sai do aparelho", async () => {
    localStorage.setItem(
      chave("admin-1"),
      JSON.stringify({
        texto: "Texto de outra época",
        base: "Política salva",
        salvoEm: Date.now() - 8 * 24 * 60 * 60 * 1000,
      }),
    );
    await montar();
    expect(ofertaDeRascunho()).toBeUndefined();
    expect(localStorage.getItem(chave("admin-1"))).toBeNull();
  });

  it("Ajustes escondida (outra aba): o aviso sai e o rascunho fica; ao voltar, volta o aviso", async () => {
    const rascunho = JSON.stringify({
      texto: "Rascunho guardado",
      base: "Política salva",
      salvoEm: Date.now(),
    });
    localStorage.setItem(chave("admin-1"), rascunho);
    await montar();
    expect(ofertaDeRascunho()).toBeDefined();

    // Ela foi para Pedidos: a aba Ajustes segue montada, escondida.
    await montar(false);
    expect(toast.dismiss).toHaveBeenCalledWith(
      "rascunho-de-texto-politica-de-devolucao",
    );
    // Sem decidir, a aba do navegador oculta não apaga nem troca o rascunho.
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).toBe(rascunho);

    toast.info.mockClear();
    await montar(true);
    expect(ofertaDeRascunho()).toBeDefined();
  });

  it("depois de Restaurar e seguir digitando, sair e voltar à aba não pergunta de novo nem trava o rascunho", async () => {
    localStorage.setItem(
      chave("admin-1"),
      JSON.stringify({
        texto: "Rascunho guardado",
        base: "Política salva",
        salvoEm: Date.now(),
      }),
    );
    await montar();
    await act(async () => ofertaDeRascunho()?.[1].action.onClick());
    expect(campo().value).toBe("Rascunho guardado");
    await digitar("Rascunho guardado e mais um trecho");

    await montar(false);
    await montar(true);
    // Uma pergunta só: a do rascunho antigo, já respondida.
    expect(
      toast.info.mock.calls.filter(([t]) =>
        String(t).includes("Rascunho não salvo"),
      ),
    ).toHaveLength(1);
    await ocultarAAba();
    const guardado = JSON.parse(localStorage.getItem(chave("admin-1")) ?? "{}");
    expect(guardado.texto).toBe("Rascunho guardado e mais um trecho");
  });

  it("escondida desde o começo (grupo fechado): sem aviso, e esconder a aba NÃO apaga o rascunho", async () => {
    const rascunho = JSON.stringify({
      texto: "Rascunho guardado",
      base: "Política salva",
      salvoEm: Date.now(),
    });
    localStorage.setItem(chave("admin-1"), rascunho);
    await montar(false);
    expect(ofertaDeRascunho()).toBeUndefined();
    // Ela bloqueia a tela sem ter visto o aviso: o rascunho é dela, fica.
    await ocultarAAba();
    expect(localStorage.getItem(chave("admin-1"))).toBe(rascunho);
    // Abriu o grupo: agora o aviso aparece.
    await montar(true);
    expect(ofertaDeRascunho()).toBeDefined();
  });
});
