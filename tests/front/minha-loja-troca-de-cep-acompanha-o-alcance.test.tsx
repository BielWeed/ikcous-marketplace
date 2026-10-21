// @vitest-environment jsdom
//
// "Só perto da loja" (Frete) grava os 5 primeiros números do CEP da loja no
// alcance da entrega. Se a lojista corrige o CEP da loja em Minha loja, o
// alcance gravado ficava no CEP ANTIGO: o próprio bairro novo ficava sem
// entrega, e o cartão "Sua loja está pronta?" seguia "feito" (16/10/2026).
//
// O conserto mora no MESMO salvamento do endereço: um único `updateConfig`
// leva o CEP novo e, só quando o alcance era EXATAMENTE os 5 números do CEP
// antigo, os 5 números do novo. Nada é gravado antes do Salvar; alcance
// escrito à mão (lista, faixa) nunca é tocado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";

import { pararABuscaDeCep } from "./duble-busca-de-cep";

let updateConfigMock: ReturnType<typeof vi.fn>;
let configAtual: Record<string, unknown>;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: true,
  }),
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map<string, string>([
    ["store_address", "texto"],
    ["store_city", "texto"],
    ["store_state", "texto"],
    ["origin_cep", "texto"],
    ["store_description", "texto"],
    ["business_hours", "texto"],
    ["local_cep_range", "texto"],
  ]),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_CONFIG = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  originCep: "38500-000",
  businessHours: "Seg-Sex: 8h às 19h",
  whatsappNumber: "(34) 99999-9999",
  storeAddress: null,
  storeDescription: null,
  localCepRange: "",
};

function instalarCepDeSaoPaulo() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            logradouro: "Avenida Paulista",
            bairro: "Bela Vista",
            localidade: "São Paulo",
            uf: "SP",
          }),
          { status: 200 },
        ),
    ),
  );
}

describe("Minha loja: trocar o CEP da loja leva o alcance 'só perto da loja' junto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configAtual = { ...BASE_CONFIG };
    updateConfigMock = vi.fn(async () => true);
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView onNavigate={() => {}} onSetDirty={() => {}} />,
      );
    });
  }

  async function digitarNoEndereco(id: string, valor: string) {
    const input = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      input.focus();
      setter?.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  }

  async function clicarSalvar() {
    const botao = hospedeiro.querySelector(
      '[aria-label="Ações de Minha loja"] button',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function trocarOCepESalvar() {
    instalarCepDeSaoPaulo();
    await renderizarTela();
    await digitarNoEndereco("endereco-cep", "01310100");
    await digitarNoEndereco("endereco-numero", "1578");
    await clicarSalvar();
  }

  it("alcance era só os 5 números do CEP antigo: o MESMO updateConfig leva os 5 do CEP novo", async () => {
    configAtual = { ...BASE_CONFIG, localCepRange: "38500" };
    await trocarOCepESalvar();
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    const enviado = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(enviado.originCep).toBe("01310-100");
    expect(enviado.localCepRange).toBe("01310");
    const { toast } = await import("sonner");
    const aviso = vi.mocked(toast.success).mock.calls.at(-1)?.[0] as string;
    expect(aviso).toContain("CEPs que começam com 01310");
  });

  it("nada é gravado antes do Salvar (só digitar o CEP novo não escreve o alcance)", async () => {
    configAtual = { ...BASE_CONFIG, localCepRange: "38500" };
    instalarCepDeSaoPaulo();
    await renderizarTela();
    await digitarNoEndereco("endereco-cep", "01310100");
    await digitarNoEndereco("endereco-numero", "1578");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("alcance vazio: o payload NÃO carrega localCepRange (vazio já acompanha o CEP sozinho)", async () => {
    await trocarOCepESalvar();
    const enviado = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect("localCepRange" in enviado).toBe(false);
  });

  it("alcance escrito à mão (lista, faixa, outro prefixo): nunca é tocado", async () => {
    for (const localCepRange of [
      "38500, 38600",
      "38500-000, 38509-999",
      "38600",
    ]) {
      updateConfigMock = vi.fn(async () => true);
      configAtual = { ...BASE_CONFIG, localCepRange };
      await trocarOCepESalvar();
      const enviado = updateConfigMock.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect("localCepRange" in enviado, localCepRange).toBe(false);
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
    }
  });

  it("só o número do endereço muda (os 5 números do CEP continuam): o alcance não é regravado", async () => {
    const salvo = montarEnderecoDaLoja({
      cep: "01310100",
      rua: "Avenida Paulista",
      numero: "100",
      complemento: "",
      bairro: "Bela Vista",
      cidade: "São Paulo",
      uf: "SP",
    });
    configAtual = {
      ...BASE_CONFIG,
      originCep: salvo.originCep,
      storeAddress: salvo.storeAddress,
      storeCity: "São Paulo",
      storeState: "SP",
      localCepRange: "01310",
    };
    instalarCepDeSaoPaulo();
    await renderizarTela();
    await digitarNoEndereco("endereco-numero", "1578");
    await clicarSalvar();
    const enviado = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect("localCepRange" in enviado).toBe(false);
  });
});
