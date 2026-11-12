// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { descricaoDaLojaParaHtml, textoDaLoja } from "@/lib/texto-da-loja";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

let configAtual: Record<string, unknown>;
const updateConfigMock = vi.fn(async () => true);
const onSetDirty = vi.fn((_dirty: boolean) => {});

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
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Minha loja — descrição salva não deixa alteração pendente falsa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    configAtual = {
      storeName: "Ateliê da Serra",
      storeCity: "Monte Carmelo",
      storeState: "MG",
      originCep: "38500-000",
      businessHours: "Seg-Sex: 8h às 19h",
      whatsappNumber: "(34) 99999-9999",
      storeAddress: null,
      storeDescription: "<p>a</p><p>b</p>",
    };
    // O HTML já é o salvo: sucesso sem mudar o config nem sua assinatura.
    updateConfigMock.mockResolvedValue(true);
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView onNavigate={() => {}} onSetDirty={onSetDirty} />,
      );
    });
  }

  const botaoSalvar = () =>
    hospedeiro.querySelector(
      '[aria-label="Ações de Minha loja"] button',
    ) as HTMLButtonElement;

  const campoDescricao = () =>
    hospedeiro.querySelector("#store-description") as HTMLTextAreaElement;

  async function digitar(descricao: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoDescricao(), descricao);
      campoDescricao().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it.each([
    {
      caso: "linhas vazias extras",
      html: "<p>a</p><p>b</p>",
      digitado: "a\n\n\nb",
      normalizado: "a\n\nb",
    },
    {
      caso: "controle sem linhas extras",
      html: "<p>a</p><p>b</p>",
      digitado: " a\n\nb ",
      normalizado: "a\n\nb",
    },
    {
      caso: "caracteres & < > preservados",
      html: "<p>a &amp; &lt;b&gt;</p><p>c</p>",
      digitado: "a & <b>\n\n\nc",
      normalizado: "a & <b>\n\nc",
    },
    {
      caso: "descrição vazia",
      html: null,
      digitado: "   ",
      normalizado: "",
    },
  ])(
    "salva e limpa a pendência: $caso",
    async ({ html, digitado, normalizado }) => {
      configAtual.storeDescription = html;
      await renderizarTela();
      expect(botaoSalvar().getAttribute("aria-disabled")).toBe("true");

      await digitar(digitado);
      expect(botaoSalvar().getAttribute("aria-disabled")).not.toBe("true");
      expect(onSetDirty).toHaveBeenLastCalledWith(true);

      await act(async () => {
        botaoSalvar().click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(updateConfigMock).toHaveBeenCalledExactlyOnceWith(
        { storeDescription: html },
        expect.objectContaining({ silent: true }),
      );
      const { toast } = await import("sonner");
      expect(toast.success).toHaveBeenCalledWith("Endereço e descrição salvos");
      expect(botaoSalvar().getAttribute("aria-disabled")).toBe("true");
      expect(onSetDirty).toHaveBeenLastCalledWith(false);
      expect(campoDescricao().value).toBe(normalizado);
      // A mesma conversão usada pelo baseline é estável ao repetir a ida e volta.
      expect(textoDaLoja(descricaoDaLojaParaHtml(normalizado))).toBe(
        normalizado,
      );
    },
  );

  it("texto realmente novo continua habilitando Salvar", async () => {
    await renderizarTela();
    await digitar("Uma história nova");
    expect(botaoSalvar().getAttribute("aria-disabled")).not.toBe("true");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    expect(updateConfigMock).not.toHaveBeenCalled();
  });
});
