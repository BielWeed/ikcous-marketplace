// @vitest-environment jsdom
//
// O logo aparece numa caixa de 32 px de altura (até 120 px de largura), mas a
// loja pode ter enviado o arquivo original de vários MB: o Header servia esse
// original inteiro a toda cliente. Agora pede a versão reduzida (240 px, 2x a
// caixa, para telas de alta densidade) e, se a loja não tiver a transformação
// de imagem ligada, tenta o ORIGINAL antes de cair no logo do build — que
// seria o logo errado. As imagens já enviadas continuam valendo (a URL gravada
// no banco não muda).
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
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "https://abcdefghijklmnopqrst.supabase.co/storage/v1";
const ARQUIVO = "store-branding/v1/hash/image";
const LOGO_PNG = `${BASE}/object/public/${ARQUIVO}.png`;
const LOGO_SVG = `${BASE}/object/public/${ARQUIVO}.svg`;
const LOGO_REDUZIDO = `${BASE}/render/image/public/${ARQUIVO}.png?width=240&resize=contain&quality=80`;
const LOGO_EXTERNO = "https://loja.example/logo.png";
const NOME_DA_LOJA = "LOJA DA PROVA R47";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Header — o logo baixa a versão reduzida, com o original de reserva", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function falhar() {
    act(() => imagem().dispatchEvent(new Event("error")));
  }

  it("reserva a largura antes da logo carregar e preserva o alinhamento à esquerda", async () => {
    await renderizar(LOGO_PNG);
    expect(imagem().parentElement?.className).toContain("w-[100px]");
    expect(imagem().parentElement?.className).toContain("xs:w-[120px]");
    expect(imagem().className).toContain("object-left");
  });

  it("logo PNG da loja: pede a versão de 240 px, não o arquivo original", async () => {
    await renderizar(LOGO_PNG);
    expect(imagem().getAttribute("src")).toBe(LOGO_REDUZIDO);
  });

  it("se a versão reduzida falha, tenta o ORIGINAL antes de cair no logo do build", async () => {
    await renderizar(LOGO_PNG);
    falhar();
    expect(imagem().getAttribute("src")).toBe(LOGO_PNG);
    expect(imagem().getAttribute("src")).not.toBe(
      buildIdentityFixture.localUrls.header,
    );
  });

  it("se o original também falha, segue a escada de sempre: logo do build e depois o nome", async () => {
    await renderizar(LOGO_PNG);
    falhar();
    falhar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
    falhar();
    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain(NOME_DA_LOJA);
  });

  it("SVG não se transforma: vai direto o original, sem etapa extra", async () => {
    await renderizar(LOGO_SVG);
    expect(imagem().getAttribute("src")).toBe(LOGO_SVG);
    falhar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
  });

  it("endereço de fora do armazenamento da loja continua como era", async () => {
    await renderizar(LOGO_EXTERNO);
    expect(imagem().getAttribute("src")).toBe(LOGO_EXTERNO);
    falhar();
    expect(imagem().getAttribute("src")).toBe(
      buildIdentityFixture.localUrls.header,
    );
  });
});
