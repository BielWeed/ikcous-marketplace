// @vitest-environment jsdom
//
// "Meus fornecedores": dois defeitos que só aparecem com a tela E o hook juntos, então
// aqui os dois são REAIS e só o Supabase é simulado (o que se confere é o pedido que
// chega ao banco, não o que a tela passa ao hook).
//
//   1. Editar num aparelho desfazia em silêncio o que outro aparelho salvou: a folha
//      mandava TODOS os campos com o valor de quando abriu. Agora a edição leva só o
//      que a lojista mexeu nesta folha; sem nada mexido, fecha sem gravar.
//   2. Gravar que estourou o prazo PODE ter sido salvo. A folha mandava tocar num
//      "Tentar de novo" que não existe e, ao fechar, dizia "não foi salvo" sem reler a
//      lista: a lojista cadastrava de novo e o fornecedor duplicava.
//
// Fixtures inventadas (telefones 11900000000, domínios .invalid).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { erroDeConsultaSemResposta } from "@/lib/prazo-da-requisicao";

type Resultado = { data: unknown; error: unknown };
type Chamada = { metodo: string; args: unknown[] };

const banco = vi.hoisted(() => ({
  // Cada `await` de um construtor pergunta aqui o que responder, vendo os métodos que ele usou.
  responder: (
    _metodos: Array<{ metodo: string; args: unknown[] }>,
  ): {
    data: unknown;
    error: unknown;
  } => ({ data: null, error: null }),
  pedidos: [] as Array<Array<{ metodo: string; args: unknown[] }>>,
}));

vi.mock("@/lib/supabase", () => {
  const construtor = () => {
    const metodos: Chamada[] = [];
    banco.pedidos.push(metodos);
    const b: any = {};
    for (const metodo of [
      "select",
      "upsert",
      "update",
      "delete",
      "eq",
      "order",
      "range",
      "single",
    ]) {
      // eslint-disable-next-line security/detect-object-injection -- metodo vem so da lista literal acima.
      b[metodo] = (...args: unknown[]) => {
        metodos.push({ metodo, args });
        return b;
      };
    }
    // biome-ignore lint/suspicious/noThenProperty: simula o builder do supabase-js, que é thenable
    b.then = (ok: (r: Resultado) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => banco.responder(metodos))
        .then(ok, falha);
    return b;
  };
  return { supabase: { from: () => construtor() } };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/uuid-v4", () => ({
  gerarUuidV4: () => "00000000-0000-4000-8000-000000000001",
}));

const toastSucesso = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COMPLETO = {
  id: "a",
  nome: "Atacado Fixture",
  whatsapp: "11900000000",
  instagram: "loja.fixture",
  site: "https://exemplo.fixture.invalid/",
  cidade: "São Paulo",
  uf: "SP",
  observacoes: "Pedido mínimo de 10 peças.",
  favorito: true,
};

const usou = (metodos: Chamada[], metodo: string) =>
  metodos.some((m) => m.metodo === metodo);
const ehLeituraDaLista = (metodos: Chamada[]) =>
  usou(metodos, "range") &&
  !usou(metodos, "update") &&
  !usou(metodos, "upsert");
const leiturasDaLista = () => banco.pedidos.filter(ehLeituraDaLista).length;
const gravacoes = () =>
  banco.pedidos.filter((m) => usou(m, "update") || usou(m, "upsert"));

function esperar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("Meus fornecedores: edição manda só o mexido; demora ao gravar relê a lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let listaDoServidor: unknown[];

  beforeEach(() => {
    vi.clearAllMocks();
    banco.pedidos = [];
    listaDoServidor = [COMPLETO];
    banco.responder = (metodos) => {
      if (usou(metodos, "update")) {
        const mudanca = metodos.find((m) => m.metodo === "update")
          ?.args[0] as Record<string, unknown>;
        return { data: [{ ...COMPLETO, ...mudanca }], error: null };
      }
      if (ehLeituraDaLista(metodos)) {
        return { data: listaDoServidor, error: null };
      }
      throw new Error("o teste não programou a resposta desta chamada");
    };
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminFornecedoresView } = await import(
      "@/views/admin/AdminFornecedoresView"
    );
    await act(async () => {
      raiz.render(<AdminFornecedoresView active onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  const tela = () => document.body.textContent ?? "";
  const botao = (rotulo: string | RegExp) =>
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => {
        const nome = b.getAttribute("aria-label") ?? b.textContent ?? "";
        return typeof rotulo === "string"
          ? nome.trim() === rotulo
          : rotulo.test(nome);
      },
    );
  const clicar = async (el: Element | undefined) => {
    expect(el).toBeDefined();
    await act(async () => {
      (el as HTMLElement).click();
      await esperar();
    });
  };
  function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const campo = (rotulo: RegExp) => {
    const label = [...document.body.querySelectorAll("label")].find((l) =>
      rotulo.test(l.textContent ?? ""),
    );
    const id = label?.getAttribute("for");
    const el = id ? document.getElementById(id) : null;
    if (!el) throw new Error(`campo ${rotulo} não encontrado`);
    return el as HTMLInputElement | HTMLTextAreaElement;
  };

  it("editar só a cidade: o pedido ao banco NÃO leva WhatsApp, Instagram, site nem observações", async () => {
    await montar();
    await clicar(botao("Editar Atacado Fixture"));
    await act(async () => digitar(campo(/Cidade/), "Campinas"));
    await clicar(botao("Salvar fornecedor"));

    const [pedido] = gravacoes();
    expect(pedido).toBeDefined();
    const mudanca = pedido.find((m) => m.metodo === "update")?.args[0];
    // Só o que a lojista mexeu nesta folha. Mandar o resto regravaria, com o valor de quando a
    // folha abriu, o que outro aparelho mudou nesse meio tempo.
    expect(mudanca).toEqual({ cidade: "Campinas" });
    expect(pedido).toContainEqual({ metodo: "eq", args: ["id", "a"] });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(toastSucesso).toHaveBeenCalledWith("Fornecedor atualizado.");
  });

  it("abrir a edição e salvar sem mexer em nada não grava: só fecha a folha", async () => {
    await montar();
    await clicar(botao("Editar Atacado Fixture"));
    await clicar(botao("Salvar fornecedor"));

    expect(gravacoes()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(toastSucesso).not.toHaveBeenCalled();
  });

  it("cadastro que estourou o prazo: manda tocar em Salvar fornecedor e, ao fechar, avisa que pode não ter sido salvo e relê a lista", async () => {
    await montar();
    expect(leiturasDaLista()).toBe(1);
    // O banco gravou, mas a resposta não chegou a tempo (o mesmo erro que o prazo de 20 s produz).
    banco.responder = ((anterior) => (metodos) => {
      if (usou(metodos, "upsert")) throw erroDeConsultaSemResposta();
      return anterior(metodos);
    })(banco.responder);

    await clicar(botao(/^Novo fornecedor$/));
    await act(async () => digitar(campo(/Nome/), "Fornecedor Lento"));
    await clicar(botao("Salvar fornecedor"));

    const aviso = document.querySelector('[role="dialog"] [role="alert"]');
    expect(aviso?.textContent).toContain("Salvar fornecedor");
    expect(aviso?.textContent).not.toContain("Tentar de novo");

    // O servidor tem o fornecedor que a lojista pensa que não salvou.
    listaDoServidor = [
      COMPLETO,
      {
        ...COMPLETO,
        id: "00000000-0000-4000-8000-000000000001",
        nome: "Fornecedor Lento",
        favorito: false,
      },
    ];
    await clicar(botao("Fechar"));
    expect(tela()).toContain("pode não ter sido salvo");
    expect(tela()).not.toContain("ainda não foi salvo");
    await clicar(botao("Descartar"));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(leiturasDaLista()).toBe(2);
    expect(tela()).toContain("Fornecedor Lento");
  });
});
