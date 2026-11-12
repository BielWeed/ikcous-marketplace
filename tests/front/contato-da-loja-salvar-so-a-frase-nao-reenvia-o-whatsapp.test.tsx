// @vitest-environment jsdom
//
// Contato da loja: o WhatsApp é o único canal de fechamento de pedido. Com o
// painel aberto em dois aparelhos, mudar SÓ a frase de compartilhar no aparelho
// A (cuja tela ainda mostra o número antigo) não pode reenviar esse número
// antigo e desfazer a troca que a lojista fez no aparelho B. O Salvar do
// Contato só manda o que ela mexeu: número só se mudou, frase só se mudou.
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

import { ContatoDaLoja } from "@/components/admin/minha-loja/ContatoDaLoja";
import type { EditorDeMinhaLoja } from "@/views/admin/AdminAboutStoreView";

let updateConfigMock: Mock<(...args: unknown[]) => Promise<boolean>>;
let configAtual: Record<string, unknown>;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: true,
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_DA_BASE = "Confira [nome] por [preco]: [link]";

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Contato da loja: salvar só a frase não reenvia o WhatsApp", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let editor: EditorDeMinhaLoja | null;

  beforeEach(() => {
    configAtual = {
      whatsappNumber: "5511900000000",
      shareText: FRASE_DA_BASE,
    };
    updateConfigMock = vi.fn(async () => true);
    editor = null;
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrir() {
    await act(async () => {
      raiz.render(
        <ContatoDaLoja
          onRegistrarSalvamento={(registrado) => {
            editor = registrado;
          }}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

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

  async function trocarAFrasePorUmModelo() {
    const abrirModelos = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Modelos prontos"),
    ) as HTMLButtonElement;
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
  }

  async function salvar(): Promise<boolean | undefined> {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await editor?.salvar();
    });
    return resultado;
  }

  const enviado = () =>
    updateConfigMock.mock.calls[0][0] as Record<string, unknown>;

  it("editar só a frase e salvar manda SÓ shareText (o número da tela, que pode estar velho, não vai)", async () => {
    await abrir();
    await trocarAFrasePorUmModelo();
    expect(editor?.alterado).toBe(true);

    expect(await salvar()).toBe(true);

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(enviado()).not.toHaveProperty("whatsappNumber");
    expect(Object.keys(enviado())).toEqual(["shareText"]);
    expect(enviado().shareText).not.toBe(FRASE_DA_BASE);
    expect(updateConfigMock.mock.calls[0][1]).toEqual({ silentSuccess: true });
    expect(toast.success).toHaveBeenCalledWith("Contato salvo");
  });

  it("número antigo INVÁLIDO na base + só a frase editada: salva a frase, sem 'WhatsApp inválido'", async () => {
    configAtual = { whatsappNumber: "12345", shareText: FRASE_DA_BASE };
    await abrir();
    await trocarAFrasePorUmModelo();

    expect(await salvar()).toBe(true);

    expect(toast.error).not.toHaveBeenCalled();
    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(enviado())).toEqual(["shareText"]);
  });

  it("editar o número para outro válido manda o número novo e não reenvia a frase", async () => {
    await abrir();
    await digitarWhatsApp("11987654321");

    expect(await salvar()).toBe(true);

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(enviado()).toEqual({ whatsappNumber: "5511987654321" });
  });

  it("apagar o número continua gravando NULL", async () => {
    await abrir();
    await digitarWhatsApp("");

    expect(await salvar()).toBe(true);

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(enviado()).toEqual({ whatsappNumber: null });
  });

  it("número editado para um valor inválido continua barrando com 'WhatsApp inválido'", async () => {
    await abrir();
    await digitarWhatsApp("119876543");

    expect(await salvar()).toBe(false);

    expect(toast.error).toHaveBeenCalledWith("WhatsApp inválido");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("número inválido editado barra mesmo com a frase também editada", async () => {
    await abrir();
    await digitarWhatsApp("119876543");
    await trocarAFrasePorUmModelo();

    expect(await salvar()).toBe(false);

    expect(toast.error).toHaveBeenCalledWith("WhatsApp inválido");
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("número e frase editados: os dois vão juntos", async () => {
    await abrir();
    await digitarWhatsApp("11987654321");
    await trocarAFrasePorUmModelo();

    expect(await salvar()).toBe(true);

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(enviado().whatsappNumber).toBe("5511987654321");
    expect(typeof enviado().shareText).toBe("string");
    expect(enviado().shareText).not.toBe(FRASE_DA_BASE);
  });
});
