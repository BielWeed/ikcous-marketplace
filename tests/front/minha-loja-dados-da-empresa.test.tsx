// @vitest-environment jsdom
//
// Minha loja › Dados da empresa: a lojista declara razão social, CNPJ ou CPF e
// e-mail de atendimento — tudo opcional. O que se mede é o que ela vive: campo
// vazio é válido (grava "não informado"), valor errado NÃO grava e o aviso diz
// o que corrigir, só os três campos vão no pedido, e a tela acusa "não salvo".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn(async (_updates: Record<string, unknown>) => true);
const toastSuccess = vi.fn();
const toastError = vi.fn();
const { estado } = vi.hoisted(() => ({
  estado: {
    offline: false,
    config: {} as Record<string, unknown>,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estado.config,
    isLoaded: true,
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

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Minha loja › Dados da empresa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.offline = false;
    estado.config = {};
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(onDirtyChange?: (pendente: boolean) => void) {
    const { DadosDaEmpresa } = await import(
      "@/components/admin/minha-loja/DadosDaEmpresa"
    );
    await act(async () => {
      raiz.render(<DadosDaEmpresa onDirtyChange={onDirtyChange} />);
    });
    await act(async () => {
      await esperar(10);
    });
  }

  function campo(id: string): HTMLInputElement {
    return hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
  }
  const razao = () => campo("empresa-razao-social");
  const documento = () => campo("empresa-documento");
  const email = () => campo("empresa-email");

  async function digitar(el: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function botao(): HTMLButtonElement {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Salvar dados da empresa"),
    ) as HTMLButtonElement;
  }

  async function salvar() {
    await act(async () => {
      botao().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(10);
    });
  }

  it("tela intocada: três campos vazios, botão desligado, nada pendente", async () => {
    const onDirtyChange = vi.fn();
    await abrir(onDirtyChange);
    expect(razao().value).toBe("");
    expect(documento().value).toBe("");
    expect(email().value).toBe("");
    expect(botao().disabled).toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("os campos têm nome visível e alvo de 44px (celular)", async () => {
    await abrir();
    for (const id of [
      "empresa-razao-social",
      "empresa-documento",
      "empresa-email",
    ]) {
      expect(hospedeiro.querySelector(`label[for="${id}"]`)).not.toBeNull();
      expect(campo(id).className).toContain("min-h-11");
    }
    expect(botao().className).toContain("min-h-11");
    expect(email().type).toBe("email");
  });

  it("preenche os campos com o que já está salvo (documento com máscara)", async () => {
    estado.config = {
      storeLegalName: "Loja da Ana Ltda",
      storeLegalDocument: "11222333000181",
      storeSupportEmail: "oi@loja.com",
    };
    await abrir();
    expect(razao().value).toBe("Loja da Ana Ltda");
    expect(documento().value).toBe("11.222.333/0001-81");
    expect(email().value).toBe("oi@loja.com");
    expect(botao().disabled).toBe(true);
  });

  it("digitar liga o aviso de 'não salvo'; voltar ao que estava desliga", async () => {
    const onDirtyChange = vi.fn();
    await abrir(onDirtyChange);
    await digitar(razao(), "Loja da Ana");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(botao().disabled).toBe(false);
    await digitar(razao(), "");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("cada um dos três campos, sozinho, já conta como alteração não salva", async () => {
    estado.config = {
      storeLegalName: "Loja da Ana Ltda",
      storeLegalDocument: "11222333000181",
      storeSupportEmail: "oi@loja.com",
    };
    for (const [el, novo] of [
      [() => razao(), "Outra Ltda"],
      [() => documento(), "529.982.247-25"],
      [() => email(), "novo@loja.com"],
    ] as const) {
      const onDirtyChange = vi.fn();
      await abrir(onDirtyChange);
      await digitar(el(), novo);
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(botao().disabled).toBe(false);
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
    }
  });

  it("a máscara do documento já salvo não conta como alteração", async () => {
    estado.config = { storeLegalDocument: "11222333000181" };
    const onDirtyChange = vi.fn();
    await abrir(onDirtyChange);
    await digitar(documento(), "11222333000181");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("salva só os três campos, limpos: sem máscara, espaços aparados", async () => {
    await abrir();
    await digitar(razao(), "  Loja da Ana   Ltda ");
    await digitar(documento(), "11.222.333/0001-81");
    await digitar(email(), " oi@loja.com ");
    await salvar();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const [enviado, opcoes] = updateConfig.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(enviado).toEqual({
      storeLegalName: "Loja da Ana Ltda",
      storeLegalDocument: "11222333000181",
      storeSupportEmail: "oi@loja.com",
    });
    expect(opcoes).toMatchObject({ silentSuccess: true });
    expect(toastSuccess).toHaveBeenCalledWith("Dados da empresa salvos");
    // a tela mostra o que ficou gravado
    expect(razao().value).toBe("Loja da Ana Ltda");
    expect(email().value).toBe("oi@loja.com");
  });

  it("CPF também vale", async () => {
    await abrir();
    await digitar(documento(), "529.982.247-25");
    await salvar();
    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({ storeLegalDocument: "52998224725" }),
      expect.anything(),
    );
  });

  it("apagar tudo é válido: grava vazio (a loja volta a não declarar nada)", async () => {
    estado.config = {
      storeLegalName: "Loja da Ana Ltda",
      storeLegalDocument: "11222333000181",
      storeSupportEmail: "oi@loja.com",
    };
    await abrir();
    await digitar(razao(), "");
    await digitar(documento(), "");
    await digitar(email(), "");
    await salvar();
    expect(updateConfig).toHaveBeenCalledWith(
      {
        storeLegalName: null,
        storeLegalDocument: null,
        storeSupportEmail: null,
      },
      expect.anything(),
    );
  });

  it("CNPJ com dígito errado NÃO grava e diz o que fazer, em português simples", async () => {
    await abrir();
    await digitar(documento(), "11.222.333/0001-82");
    await salvar();
    expect(updateConfig).not.toHaveBeenCalled();
    const aviso = hospedeiro.querySelector("#empresa-documento-erro");
    expect(aviso?.getAttribute("role")).toBe("alert");
    expect(aviso?.textContent).toMatch(/não confere/);
    expect(documento().getAttribute("aria-invalid")).toBe("true");
    expect(documento().getAttribute("aria-describedby")).toBe(
      "empresa-documento-erro",
    );
    // o foco vai ao campo que precisa de correção
    expect(document.activeElement).toBe(documento());
  });

  it("e-mail sem forma de e-mail NÃO grava e nenhum campo bom se perde", async () => {
    await abrir();
    await digitar(razao(), "Loja da Ana");
    await digitar(email(), "isso-nao-e-email");
    await salvar();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(
      hospedeiro.querySelector("#empresa-email-erro")?.textContent,
    ).toMatch(/e-mail/i);
    expect(razao().value).toBe("Loja da Ana");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("corrigir o campo apaga o aviso dele, e aí grava", async () => {
    await abrir();
    await digitar(email(), "errado");
    await salvar();
    expect(hospedeiro.querySelector("#empresa-email-erro")).not.toBeNull();
    await digitar(email(), "oi@loja.com");
    expect(hospedeiro.querySelector("#empresa-email-erro")).toBeNull();
    await salvar();
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("todos os avisos aparecem juntos", async () => {
    await abrir();
    await digitar(documento(), "123");
    await digitar(email(), "x");
    await salvar();
    expect(hospedeiro.querySelector("#empresa-documento-erro")).not.toBeNull();
    expect(hospedeiro.querySelector("#empresa-email-erro")).not.toBeNull();
  });

  it("a máscara entra ao sair do campo (sem pular o cursor enquanto digita)", async () => {
    await abrir();
    await digitar(documento(), "11222333000181");
    expect(documento().value).toBe("11222333000181");
    await act(async () => {
      documento().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(documento().value).toBe("11.222.333/0001-81");
  });

  it("falha ao gravar: não anuncia sucesso e o que ela digitou fica", async () => {
    updateConfig.mockResolvedValueOnce(false);
    await abrir();
    await digitar(razao(), "Loja da Ana");
    await salvar();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(razao().value).toBe("Loja da Ana");
    expect(botao().disabled).toBe(false);
  });

  it("sem internet: não tenta gravar e avisa", async () => {
    estado.offline = true;
    await abrir();
    expect(razao().disabled).toBe(true);
    expect(botao().disabled).toBe(true);
  });

  it("o que a lojista digitou não é pisado quando o config chega depois", async () => {
    await abrir();
    await digitar(razao(), "Digitado agora");
    estado.config = { storeLegalName: "Veio do banco" };
    await act(async () => {
      const { DadosDaEmpresa } = await import(
        "@/components/admin/minha-loja/DadosDaEmpresa"
      );
      raiz.render(<DadosDaEmpresa />);
    });
    expect(razao().value).toBe("Digitado agora");
  });

  it("config que chega com a tela intocada preenche o campo", async () => {
    await abrir();
    estado.config = { storeLegalName: "Veio do banco" };
    await act(async () => {
      const { DadosDaEmpresa } = await import(
        "@/components/admin/minha-loja/DadosDaEmpresa"
      );
      raiz.render(<DadosDaEmpresa />);
    });
    expect(razao().value).toBe("Veio do banco");
  });

  it("na tela Minha loja: bloco 6 'opcional', e o dirty do bloco liga a guarda da tela", async () => {
    const onSetDirty = vi.fn();
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView onNavigate={vi.fn()} onSetDirty={onSetDirty} />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
    expect(hospedeiro.textContent).toContain("Dados da empresa (opcional)");
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    await digitar(razao(), "Loja da Ana");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    const bloco = [...hospedeiro.querySelectorAll("section")].find(
      (s) =>
        s.querySelector("h2")?.textContent === "Dados da empresa (opcional)",
    );
    expect(bloco?.textContent).toContain("Alterado");
    expect(hospedeiro.textContent).toContain("1 alteração para salvar");
  });
});
