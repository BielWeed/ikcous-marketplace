// @vitest-environment jsdom
//
// Painel simples (D9, D10, E4): o WhatsApp da loja e a mensagem de compartilhar
// saíram da tela "Atendimento" e viraram o bloco "Contato" de Minha loja. O
// MORADOR é o mesmo (10-11 dígitos ganham o 55, vazio grava NULL, "WhatsApp
// inválido", modelos prontos abrem e fecham); a CASA mudou:
//   - o Salvar do Contato manda SÓ `whatsappNumber` e `shareText` (nunca o
//     horário, nunca o endereço);
//   - `secaoInicial="contato"` rola até o bloco e põe o foco no título dele;
//   - no topo aparece "Falta preencher: …", calculado pelos seis passos, e o
//     toque leva ao bloco certo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { pararABuscaDeCep } from "./duble-busca-de-cep";

let updateConfigMock: Mock<(...args: unknown[]) => Promise<boolean>>;
let configAtual: Record<string, unknown>;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: true,
    products: [],
  }),
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map<string, string>([
    ["store_address", "texto"],
    ["store_city", "texto"],
    ["store_state", "texto"],
    ["origin_cep", "texto"],
    ["store_description", "texto"],
    ["business_hours", "texto"],
  ]),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Loja com os três passos de Minha loja em dia: marca, endereço (CEP + número)
// e WhatsApp. Cada teste tira o que quer provar que "falta".
const LOJA_COMPLETA = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: "01310-100",
  storeAddress:
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
  storeCity: "São Paulo",
  storeState: "SP",
  businessHours: "Seg a sex 9h–18h",
  whatsappNumber: "5534999998888",
  shareText: "Confira [nome] por [preco]: [link]",
  storeDescription: null,
};

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Minha loja — bloco Contato (WhatsApp e mensagem de compartilhar)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoSujar: Mock<(dirty: boolean) => void>;
  let rolar: Mock<() => void>;

  beforeEach(() => {
    // O jsdom não implementa scrollIntoView: o dublê também prova o "rola".
    rolar = vi.fn();
    HTMLElement.prototype.scrollIntoView = rolar;
    configAtual = { ...LOJA_COMPLETA };
    updateConfigMock = vi.fn(async () => true);
    aoSujar = vi.fn((_dirty: boolean) => {});
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
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
    document.body.className = "";
    vi.unstubAllGlobals();
  });

  async function abrirTela(
    props: {
      secaoInicial?: "contato";
      onSetBackOverride?: (fn: (() => void) | null) => void;
      onNavigate?: (view: string) => void;
    } = {},
  ) {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView
          onNavigate={props.onNavigate ?? vi.fn()}
          onSetDirty={aoSujar}
          secaoInicial={props.secaoInicial}
          onSetBackOverride={props.onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const blocoContato = () =>
    [...hospedeiro.querySelectorAll<HTMLElement>("section")].find(
      (s) => s.querySelector("h2")?.textContent === "Contato",
    );

  const tituloDoContato = () =>
    blocoContato()?.querySelector("h2") as HTMLElement;

  const botaoSalvarContato = () =>
    [...(blocoContato()?.querySelectorAll("button") ?? [])].find((b) =>
      (b.textContent ?? "").includes("Salvar"),
    ) as HTMLButtonElement;

  async function digitarWhatsApp(valor: string) {
    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo.focus();
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });
  }

  async function clicarSalvarContato() {
    await act(async () => {
      botaoSalvarContato().click();
      await esperar(50);
    });
  }

  it("o bloco Contato traz o WhatsApp e a mensagem de compartilhar, e não manda mais para Atendimento", async () => {
    await abrirTela();

    const bloco = blocoContato();
    expect(bloco).toBeTruthy();
    expect(bloco?.querySelector("#settings-whatsapp")).not.toBeNull();
    expect(
      bloco?.querySelector("#settings-share-message-editor"),
    ).not.toBeNull();
    expect(
      [...hospedeiro.querySelectorAll("button")].some((b) =>
        (b.textContent ?? "").includes("Editar em Atendimento"),
      ),
    ).toBe(false);
  });

  it("WhatsApp com 9 dígitos: 'WhatsApp inválido' e nada é gravado", async () => {
    await abrirTela();
    await digitarWhatsApp("119876543");
    await clicarSalvarContato();

    expect(toast.error).toHaveBeenCalledWith("WhatsApp inválido");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("WhatsApp com 11 dígitos: grava com o 55 na frente, só WhatsApp e mensagem (sem horário)", async () => {
    await abrirTela();
    await digitarWhatsApp("11987654321");
    await clicarSalvarContato();

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    const enviado = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(enviado).not.toHaveProperty("businessHours");
    expect(enviado).toEqual({
      whatsappNumber: "5511987654321",
      shareText: "Confira [nome] por [preco]: [link]",
    });
  });

  it("WhatsApp apagado grava NULL (o botão de WhatsApp some da loja)", async () => {
    await abrirTela();
    await digitarWhatsApp("");
    await clicarSalvarContato();

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(updateConfigMock.mock.calls[0][0]).toEqual({
      whatsappNumber: null,
      shareText: "Confira [nome] por [preco]: [link]",
    });
  });

  it("sem alteração o Salvar do Contato fica desabilitado; digitar liga o sinal de alteração não salva", async () => {
    await abrirTela();
    expect(botaoSalvarContato().disabled).toBe(true);

    await digitarWhatsApp("11987654321");
    expect(botaoSalvarContato().disabled).toBe(false);
    expect(aoSujar).toHaveBeenLastCalledWith(true);
  });

  it("os modelos de mensagem abrem e fecham (Esc) e o modelo escolhido preenche o editor", async () => {
    await abrirTela();

    const abrirModelos = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Modelos prontos"),
    ) as HTMLButtonElement;
    await act(async () => {
      abrirModelos.click();
      await esperar(100);
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.getElementById("preset-search-input")).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(100);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      abrirModelos.click();
      await esperar(100);
    });
    const modelo = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Oferta Quente"),
    ) as HTMLButtonElement;
    await act(async () => {
      modelo.click();
      await esperar(100);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      (
        hospedeiro.querySelector(
          "#settings-share-message-editor",
        ) as HTMLElement
      ).innerHTML,
    ).toContain('data-tag="preco"');
  });

  it("o Voltar do aparelho fecha só a folha de modelos (onSetBackOverride)", async () => {
    const onSetBackOverride = vi.fn();
    await abrirTela({ onSetBackOverride });

    const abrirModelos = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Modelos prontos"),
    ) as HTMLButtonElement;
    await act(async () => {
      abrirModelos.click();
      await esperar(100);
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // O AdminArea repassa o setState do App: o argumento é o ATUALIZADOR que
    // devolve o Voltar (mesmo contrato das outras folhas do painel).
    const chamadas = onSetBackOverride.mock.calls
      .map(([arg]) => arg)
      .filter((arg): arg is () => () => void => typeof arg === "function");
    expect(chamadas.length).toBeGreaterThan(0);
    const voltar = chamadas[chamadas.length - 1]();
    await act(async () => {
      voltar();
      await esperar(100);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  describe("secaoInicial (D10)", () => {
    it('com secaoInicial="contato" o foco vai para o título do bloco Contato e a tela rola até ele', async () => {
      await abrirTela({ secaoInicial: "contato" });

      expect(document.activeElement).toBe(tituloDoContato());
      expect(rolar).toHaveBeenCalled();
    });

    it("sem secaoInicial o foco não é puxado para o Contato", async () => {
      await abrirTela();
      expect(document.activeElement).not.toBe(tituloDoContato());
    });
  });

  describe("Falta preencher (E4)", () => {
    const faltaPreencher = () =>
      hospedeiro.querySelector<HTMLElement>("[data-falta-preencher]");

    it("loja com tudo em dia: o aviso não aparece", async () => {
      await abrirTela();
      expect(faltaPreencher()).toBeNull();
      expect(hospedeiro.textContent).not.toContain("Falta preencher");
    });

    it("sem WhatsApp: o topo diz 'Falta preencher: WhatsApp' e o toque leva ao bloco Contato", async () => {
      configAtual = { ...LOJA_COMPLETA, whatsappNumber: null };
      await abrirTela();

      const aviso = faltaPreencher();
      expect(aviso).not.toBeNull();
      expect(aviso?.textContent?.replace(/\s+/g, " ").trim()).toBe(
        "Falta preencher: WhatsApp",
      );

      rolar.mockClear();
      const toque = aviso?.querySelector("button") as HTMLButtonElement;
      expect(toque.textContent).toBe("WhatsApp");
      await act(async () => {
        toque.click();
      });
      expect(document.activeElement).toBe(tituloDoContato());
      expect(rolar).toHaveBeenCalled();
    });

    it("faltando marca e endereço, cada toque leva ao seu bloco", async () => {
      configAtual = {
        ...LOJA_COMPLETA,
        logoUrl: "",
        storeAddress: null,
      };
      await abrirTela();

      const toques = [
        ...(faltaPreencher()?.querySelectorAll("button") ?? []),
      ] as HTMLButtonElement[];
      expect(toques.map((b) => b.textContent)).toEqual([
        "Nome e logo",
        "Endereço",
      ]);

      await act(async () => {
        toques[1].click();
      });
      expect(document.activeElement?.textContent).toBe("Endereço da loja");
      await act(async () => {
        toques[0].click();
      });
      expect(document.activeElement?.textContent).toBe("Marca da loja");
    });

    it("o aviso cai sozinho quando o que faltava é salvo (a config chega preenchida)", async () => {
      configAtual = { ...LOJA_COMPLETA, whatsappNumber: null };
      await abrirTela();
      expect(faltaPreencher()).not.toBeNull();

      configAtual = { ...LOJA_COMPLETA };
      await abrirTela();
      expect(faltaPreencher()).toBeNull();
    });
  });
});
