// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";
import { buildIdentityFixture } from "./fixtures/build-identity";

let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
// A busca acessa catálogo/carrinho; esta prova exercita a imagem real do Header.
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LOGO_A = "https://loja.example/logo-a.svg";
const LOGO_B = "https://loja.example/logo-b.png";
const NOME_DA_LOJA = "LOJA DA PROVA 258";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Header — a logo acompanha a configuração sem remontar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { storeName: NOME_DA_LOJA };
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizar(logoUrl?: string) {
    mockConfig = { storeName: NOME_DA_LOJA, logoUrl };
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      // Mesma raiz/posição; callback novo força o memo a ler o mock atualizado.
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
  }

  function imagem() {
    const img = hospedeiro.querySelector("img");
    expect(img).not.toBeNull();
    return img!;
  }

  function falhar(img = imagem()) {
    act(() => img.dispatchEvent(new Event("error")));
  }

  it("tenta a URL que chega depois do primeiro render sem logo", async () => {
    await renderizar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
    const botao = imagem().closest("button");
    botao!.focus();

    await renderizar(LOGO_A);

    expect(imagem().getAttribute("src")).toBe(LOGO_A);
    expect(imagem().alt).toBe(NOME_DA_LOJA);
    expect(imagem().classList.contains("object-contain")).toBe(true);
    expect(imagem().closest("button")).toBe(botao);
    expect(document.activeElement).toBe(botao);
  });

  it("troca de A para B mesmo se A já falhou", async () => {
    await renderizar(LOGO_A);
    falhar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
    await renderizar(LOGO_B);
    expect(imagem().getAttribute("src")).toBe(LOGO_B);
  });

  it("voltar a A depois de B permite outra tentativa de A", async () => {
    await renderizar(LOGO_A);
    falhar();
    await renderizar(LOGO_B);
    falhar();
    await renderizar(LOGO_A);
    expect(imagem().getAttribute("src")).toBe(LOGO_A);
  });

  it("a mesma URL quebrada não reinicia a escada no rerender", async () => {
    await renderizar(LOGO_A);
    falhar();
    await renderizar(LOGO_A);
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
    falhar();
    await renderizar(LOGO_A);
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain(NOME_DA_LOJA);
  });

  it("o erro atrasado do elemento de A não derruba B", async () => {
    await renderizar(LOGO_A);
    const anterior = imagem();
    await renderizar(LOGO_B);
    falhar(anterior);
    expect(imagem().getAttribute("src")).toBe(LOGO_B);
    falhar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
  });

  it("o erro da primeira tentativa de A não derruba A após passar por B", async () => {
    await renderizar(LOGO_A);
    const primeiraA = imagem();
    await renderizar(LOGO_B);
    await renderizar(LOGO_A);
    falhar(primeiraA);
    expect(imagem().getAttribute("src")).toBe(LOGO_A);
  });

  it("erro repetido da candidata anterior não pula a reserva seguinte", async () => {
    await renderizar(LOGO_A);
    const anterior = imagem();
    falhar(anterior);
    falhar(anterior);
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
  });

  it.each([undefined, ""])(
    "remover a URL (%s) volta à reserva local",
    async (ausente) => {
      await renderizar(LOGO_A);
      await renderizar(ausente);
      expect(imagem().getAttribute("src")).toBe(
        buildIdentityFixture.localUrls.header,
      );
    },
  );

  it("URL remota igual à reserva local não tenta a mesma imagem duas vezes", async () => {
    await renderizar(buildIdentityFixture.localUrls.header);
    falhar();
    expect(hospedeiro.querySelector("img")).toBeNull();
    await renderizar(buildIdentityFixture.localUrls.header);
    expect(hospedeiro.querySelector("img")).toBeNull();
  });

  it("uma URL nova recupera a imagem mesmo depois de chegar ao texto", async () => {
    await renderizar(LOGO_A);
    falhar();
    falhar();
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain(NOME_DA_LOJA);
    await renderizar(LOGO_B);
    expect(imagem().getAttribute("src")).toBe(LOGO_B);
  });
});
