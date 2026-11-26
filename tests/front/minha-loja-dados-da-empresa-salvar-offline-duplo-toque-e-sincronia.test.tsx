// @vitest-environment jsdom
//
// Minha loja › Dados da empresa — o que as provas vizinhas
// (minha-loja-dados-da-empresa.test.tsx) não pisam. Aqui o "salvar" é chamado
// pela tela de cima (`onRegistrarSalvamento`), como o coordenador de Minha loja
// faz, e o que se mede é o que ele devolve e o que a tela vive:
//  - offline: não grava, avisa e devolve "não salvou" (false);
//  - segundo toque com o primeiro ainda no ar: ignorado (false), grava UMA vez,
//    campos travados e "pendente" enquanto dura;
//  - o servidor recusa (false) ou a chamada quebra: devolve false, avisa, não
//    mostra "salvo" e o que foi digitado fica;
//  - dado novo chegando: cada campo adota o novo SÓ se não foi mexido;
//  - o que NÃO conta como mudança (espaços sobrando, máscara, e-mail legado com
//    espaço) e o que conta (zeros do documento);
//  - erros: razão social comprida e e-mail errado ficam ligados ao campo (aria),
//    o foco vai ao primeiro campo errado e sem erro nenhum não sobra alerta;
//  - o aviso da lei trata espaços como vazio; o botão trava em cada situação.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorDeMinhaLoja } from "@/views/admin/AdminAboutStoreView";

const updateConfig = vi.fn(
  async (_u: Record<string, unknown>, _o?: unknown) => true,
);
const toastSuccess = vi.fn();
const toastError = vi.fn();
const { estado } = vi.hoisted(() => ({
  estado: {
    offline: false,
    isLoaded: true,
    config: {} as Record<string, unknown>,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    isLoaded: estado.isLoaded,
    updateConfig,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

const COMPLETA = {
  storeLegalName: "Loja da Ana Ltda",
  storeLegalDocument: "11222333000181",
  storeSupportEmail: "oi@loja.com",
};

describe("Minha loja › Dados da empresa — salvar pela tela de cima e sincronia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let editor: EditorDeMinhaLoja | null;
  const dirty = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockImplementation(async () => true);
    estado.offline = false;
    estado.isLoaded = true;
    estado.config = { ...COMPLETA };
    editor = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(registrar = true) {
    const { DadosDaEmpresa } = await import(
      "@/components/admin/minha-loja/DadosDaEmpresa"
    );
    await act(async () => {
      raiz.render(
        <DadosDaEmpresa
          onDirtyChange={dirty}
          onRegistrarSalvamento={
            registrar
              ? (e) => {
                  editor = e;
                }
              : undefined
          }
        />,
      );
    });
    await act(async () => {
      await esperar(10);
    });
  }
  async function reabrir() {
    // mesmo componente, config nova (o contexto devolve o objeto atual)
    const { DadosDaEmpresa } = await import(
      "@/components/admin/minha-loja/DadosDaEmpresa"
    );
    await act(async () => {
      raiz.render(
        <DadosDaEmpresa
          onDirtyChange={dirty}
          onRegistrarSalvamento={(e) => {
            editor = e;
          }}
        />,
      );
    });
    await act(async () => {
      await esperar(10);
    });
  }

  const campo = (id: string) =>
    hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
  const razao = () => campo("empresa-razao-social");
  const documento = () => campo("empresa-documento");
  const email = () => campo("empresa-email");
  const ultimoDirty = () => dirty.mock.calls.at(-1)?.[0];

  async function digitar(el: HTMLInputElement, valor: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function salvar() {
    let r: boolean | undefined;
    await act(async () => {
      r = await editor?.salvar();
    });
    return r;
  }

  describe("o salvar da tela de cima", () => {
    it("registra o editor e esconde o botão próprio; 'alterado' acompanha a digitação", async () => {
      await abrir();
      expect(editor).not.toBeNull();
      expect(editor?.alterado).toBe(false);
      expect(
        [...hospedeiro.querySelectorAll("button")].some((b) =>
          b.textContent?.includes("Salvar dados da empresa"),
        ),
      ).toBe(false);
      await digitar(razao(), "Outra Ltda");
      expect(editor?.alterado).toBe(true);
    });

    it("offline: não grava, avisa com a explicação e devolve false", async () => {
      estado.offline = true;
      await abrir();
      const r = await salvar();
      expect(r).toBe(false);
      expect(updateConfig).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(
        "Sem conexão com a internet",
        expect.objectContaining({
          description: expect.stringContaining("online"),
        }),
      );
    });

    it("valor errado: devolve false, não grava e não diz 'salvo'", async () => {
      await abrir();
      await digitar(documento(), "123");
      expect(await salvar()).toBe(false);
      expect(updateConfig).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it("deu certo: devolve true e diz 'Dados da empresa salvos'", async () => {
      await abrir();
      await digitar(razao(), "Outra Ltda");
      expect(await salvar()).toBe(true);
      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(toastSuccess).toHaveBeenCalledWith("Dados da empresa salvos");
    });

    it("o servidor recusou (false): devolve false, não diz 'salvo' e o digitado fica", async () => {
      updateConfig.mockImplementation(async () => false);
      await abrir();
      await digitar(razao(), "  Outra   Ltda ");
      expect(await salvar()).toBe(false);
      expect(toastSuccess).not.toHaveBeenCalled();
      // nada foi "arrumado" na tela: o que ela digitou continua lá
      expect(razao().value).toBe("  Outra   Ltda ");
    });

    it("a chamada quebrou: avisa com o erro do painel, devolve false e destrava a tela", async () => {
      updateConfig.mockImplementation(async () => {
        throw new Error("falhou");
      });
      await abrir();
      await digitar(razao(), "Outra Ltda");
      expect(await salvar()).toBe(false);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(razao().disabled).toBe(false);
    });

    it("segundo toque com o primeiro no ar: ignorado, grava uma vez, campos travados e 'pendente' até acabar", async () => {
      let terminar: (v: boolean) => void = () => {};
      updateConfig.mockImplementation(
        () => new Promise<boolean>((r) => (terminar = r)),
      );
      await abrir();
      await digitar(razao(), "Outra Ltda");
      let primeira: Promise<boolean> | undefined;
      await act(async () => {
        primeira = editor?.salvar();
        await esperar(5);
      });
      expect(razao().disabled).toBe(true);
      expect(documento().disabled).toBe(true);
      expect(email().disabled).toBe(true);
      expect(ultimoDirty()).toBe(true);
      expect(await salvar()).toBe(false);
      expect(updateConfig).toHaveBeenCalledTimes(1);
      await act(async () => {
        terminar(true);
        await primeira;
      });
      expect(razao().disabled).toBe(false);
      expect(updateConfig).toHaveBeenCalledTimes(1);
    });

    it("depois de salvar a tela mostra o que ficou gravado (espaços aparados, documento com máscara)", async () => {
      estado.config = {};
      await abrir();
      await digitar(razao(), "  Loja   da Ana ");
      await digitar(documento(), "11222333000181");
      await salvar();
      expect(razao().value).toBe("Loja da Ana");
      expect(documento().value).toBe("11.222.333/0001-81");
    });
  });

  describe("pendente", () => {
    it("ao sair da tela avisa que não há mais nada pendente", async () => {
      await abrir();
      await digitar(razao(), "Outra Ltda");
      expect(ultimoDirty()).toBe(true);
      act(() => raiz.unmount());
      expect(ultimoDirty()).toBe(false);
      raiz = createRoot(hospedeiro);
    });

    it("espaços sobrando na razão social não contam como mudança", async () => {
      await abrir();
      await digitar(razao(), "  Loja da   Ana Ltda ");
      expect(ultimoDirty()).toBe(false);
      expect(editor?.alterado).toBe(false);
    });

    it("tirar os zeros do documento É mudança (a máscara não é, mas os dígitos são)", async () => {
      await abrir();
      await digitar(documento(), "11222333181");
      expect(editor?.alterado).toBe(true);
      expect(ultimoDirty()).toBe(true);
    });

    it("e-mail legado salvo com espaços nas pontas não conta como mudança ao abrir", async () => {
      estado.config = { ...COMPLETA, storeSupportEmail: "  oi@loja.com " };
      await abrir();
      expect(editor?.alterado).toBe(false);
      expect(ultimoDirty()).toBe(false);
    });
  });

  describe("dado novo que chega (carga, salvamento em outro aparelho)", () => {
    it("campo intocado adota o valor novo", async () => {
      await abrir();
      estado.config = {
        storeLegalName: "Nome Novo Ltda",
        storeLegalDocument: "52998224725",
        storeSupportEmail: "novo@loja.com",
      };
      await reabrir();
      expect(razao().value).toBe("Nome Novo Ltda");
      expect(documento().value).toBe("529.982.247-25");
      expect(email().value).toBe("novo@loja.com");
    });

    it("campo mexido NUNCA é pisado: cada um dos três guarda o que a lojista digitou", async () => {
      await abrir();
      await digitar(razao(), "Digitei A");
      await digitar(documento(), "529.982.247-25");
      await digitar(email(), "digitei@loja.com");
      estado.config = {
        storeLegalName: "Nome Novo Ltda",
        storeLegalDocument: "11222333000181",
        storeSupportEmail: "novo@loja.com",
      };
      await reabrir();
      expect(razao().value).toBe("Digitei A");
      expect(documento().value).toBe("529.982.247-25");
      expect(email().value).toBe("digitei@loja.com");
    });

    it("só o campo mexido é preservado; os outros adotam o novo", async () => {
      await abrir();
      await digitar(razao(), "Digitei A");
      estado.config = {
        storeLegalName: "Nome Novo Ltda",
        storeLegalDocument: "52998224725",
        storeSupportEmail: "novo@loja.com",
      };
      await reabrir();
      expect(razao().value).toBe("Digitei A");
      expect(documento().value).toBe("529.982.247-25");
      expect(email().value).toBe("novo@loja.com");
    });
  });

  describe("erros ligados ao campo", () => {
    it("razão social comprida: aviso, aria e foco na razão; corrigir some com tudo", async () => {
      await abrir();
      await digitar(razao(), "x".repeat(201));
      await digitar(documento(), "123");
      await salvar();
      const erro = hospedeiro.querySelector("#empresa-razao-social-erro");
      expect(erro?.getAttribute("role")).toBe("alert");
      expect(erro?.textContent).toContain("200");
      expect(razao().getAttribute("aria-invalid")).toBe("true");
      expect(razao().getAttribute("aria-describedby")).toBe(
        "empresa-razao-social-erro",
      );
      // dois campos errados: o foco vai ao primeiro da fila (razão social)
      expect(document.activeElement).toBe(razao());
      await digitar(razao(), "Loja da Ana");
      expect(hospedeiro.querySelector("#empresa-razao-social-erro")).toBeNull();
      expect(razao().hasAttribute("aria-invalid")).toBe(false);
    });

    it("só o e-mail errado: aria no e-mail, foco nele, e os outros campos sem marca de erro", async () => {
      await abrir();
      await digitar(email(), "isso-nao-e-email");
      await salvar();
      expect(email().getAttribute("aria-invalid")).toBe("true");
      expect(email().getAttribute("aria-describedby")).toBe(
        "empresa-email-erro",
      );
      expect(document.activeElement).toBe(email());
      expect(razao().hasAttribute("aria-invalid")).toBe(false);
      expect(documento().hasAttribute("aria-invalid")).toBe(false);
      expect(documento().hasAttribute("aria-describedby")).toBe(false);
    });

    it("sem erro nenhum: nenhum alerta na tela e nenhum campo marcado", async () => {
      await abrir();
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
      for (const el of [razao(), documento(), email()]) {
        expect(el.hasAttribute("aria-invalid")).toBe(false);
        expect(el.hasAttribute("aria-describedby")).toBe(false);
      }
    });

    it("o documento e o e-mail não usam o corretor ortográfico", async () => {
      await abrir();
      expect(documento().getAttribute("spellcheck")).toBe("false");
      expect(email().getAttribute("spellcheck")).toBe("false");
    });
  });

  describe("aviso da lei e botão de salvar", () => {
    const aviso = "A lei pede que a loja mostre quem é";

    it("razão social só com espaços conta como vazia: o aviso aparece", async () => {
      estado.config = { ...COMPLETA, storeLegalName: "   " };
      await abrir();
      expect(hospedeiro.textContent).toContain(aviso);
    });

    it("e-mail só com espaços conta como vazio: o aviso aparece", async () => {
      estado.config = { ...COMPLETA, storeSupportEmail: "   " };
      await abrir();
      expect(hospedeiro.textContent).toContain(aviso);
    });

    const botao = () =>
      hospedeiro.querySelector(
        'button[title^="Salva a razão social"]',
      ) as HTMLButtonElement;

    it("o botão trava offline, com a tela ainda carregando e sem alteração; destrava com alteração", async () => {
      await abrir(false);
      expect(botao().disabled).toBe(true); // nada alterado
      await digitar(razao(), "Outra Ltda");
      expect(botao().disabled).toBe(false);
      estado.offline = true;
      await act(async () => {
        const { DadosDaEmpresa } = await import(
          "@/components/admin/minha-loja/DadosDaEmpresa"
        );
        raiz.render(<DadosDaEmpresa onDirtyChange={dirty} />);
      });
      expect(botao().disabled).toBe(true); // offline
      estado.offline = false;
      estado.isLoaded = false;
      await act(async () => {
        const { DadosDaEmpresa } = await import(
          "@/components/admin/minha-loja/DadosDaEmpresa"
        );
        raiz.render(<DadosDaEmpresa onDirtyChange={dirty} />);
      });
      expect(botao().disabled).toBe(true); // carregando
    });

    it("salvando: o botão mostra 'Salvando...' e fica travado", async () => {
      let terminar: (v: boolean) => void = () => {};
      updateConfig.mockImplementation(
        () => new Promise<boolean>((r) => (terminar = r)),
      );
      await abrir(false);
      await digitar(razao(), "Outra Ltda");
      await act(async () => {
        botao().click();
        await esperar(5);
      });
      expect(botao().textContent).toContain("Salvando...");
      expect(botao().disabled).toBe(true);
      await act(async () => {
        terminar(true);
        await esperar(5);
      });
      expect(botao().textContent).toContain("Salvar dados da empresa");
    });
  });
});
