// @vitest-environment jsdom
//
// O nome da loja sai do código: as telas passam a preferir `config.storeName`
// (o que o lojista gravou no banco) e só então caem no `branding.appName` do
// branding.json estático. Antes disto o lojista mudava o nome no banco e a
// tela continuava mostrando o nome do arquivo — o gap documentado no
// comentário de StoreLocationSection (AdminSettingsView): "o nome que
// aparece continua vindo de branding.appName".
//
// POR QUE O HEADER EM DOIS CAMINHOS: o nome vive em dois lugares nele —
//  - no alt da <img> da logo (o que o leitor de tela anuncia, e o único
//    nome do caminho feliz, em que a logo do banco carrega e o bloco
//    textual nem renderiza);
//  - no fallback textual (mainName/subName), que só aparece quando TODAS as
//    logos falham (db -> svg -> png -> texto).
// Os dois precisam seguir a mesma ordem de preferência, então o teste anda
// os dois caminhos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

// Mock mutável: cada teste ajusta `mockConfig` antes de renderizar. Os
// componentes leem `config` em tempo de render (não no import), então mudar
// a variável entre testes funciona mesmo com o módulo já carregado.
let mockConfig: Partial<StoreConfig> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));

// O sino do Header vive em outro contexto; aqui basta que ele monte sem o
// provider de notificação real.
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));

// A SearchBar real puxa catálogo (useProducts/useCart/supabase) que não é
// desta prova — o alvo é o nome, não a busca.
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Sinal nominal, nunca número mágico: se este texto aparecer na tela, só
// pode ter vindo do config do banco.
const NOME_DO_BANCO = "LOJA DA PROVA 258";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Header — o nome da loja vem do banco, não do branding.json", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    // framer-motion (AnimatePresence/layout) consulta estes três no mount;
    // o jsdom deste projeto não os implementa (mesmo achado documentado em
    // admin-layout-cracha-pedidos-pendentes e admin-coupons-view-expirado).
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarHeader() {
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  // Sem logoUrl o Header nasce no estado "svg"; cada erro de imagem o
  // rebaixa um degrau (svg -> png -> texto) até sobrar o nome escrito.
  async function derrubarAsLogos() {
    for (let degrau = 0; degrau < 2; degrau++) {
      const img = hospedeiro.querySelector("img");
      expect(img).toBeTruthy();
      act(() => {
        img!.dispatchEvent(new Event("error"));
      });
    }
  }

  it("o alt da logo já mostra o nome do banco no caminho feliz", async () => {
    mockConfig = { storeName: NOME_DO_BANCO };
    await renderizarHeader();

    const alt = hospedeiro.querySelector("img")?.getAttribute("alt");
    expect(alt).toBe(NOME_DO_BANCO);
  });

  it("quando todas as logos falham, o nome escrito é o do banco", async () => {
    mockConfig = { storeName: NOME_DO_BANCO };
    await renderizarHeader();

    await derrubarAsLogos();

    expect(hospedeiro.textContent).toContain(NOME_DO_BANCO);
    expect(hospedeiro.textContent).not.toContain("IKCOUS");
  });

  it("sem nome no banco, o fallback continua sendo o branding atual", async () => {
    mockConfig = {};
    await renderizarHeader();

    await derrubarAsLogos();

    // branding.json diz "IKCOUS - imports": o Header separa em "IKCOUS" +
    // "imports". É o mesmo nome de antes — a preferência nova não pode
    // trocar o fallback.
    expect(hospedeiro.textContent).toContain("IKCOUS");
    expect(hospedeiro.textContent).not.toContain(NOME_DO_BANCO);
  });
});
