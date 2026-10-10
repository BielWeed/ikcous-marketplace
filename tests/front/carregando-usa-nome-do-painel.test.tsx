// @vitest-environment jsdom
//
// Painel simples (C8): a tela de "carregando" do AdminArea mostra o MESMO nome
// que o menu e o título da tela (`NOMES_DO_PAINEL`). Antes ela tinha uma
// cadeia própria de nomes e dizia "Campanha", "Suporte Q&A", "Frete
// nacional", "Detalhes" — nomes que a tela, depois de carregada, não usa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O esqueleto só aparece depois de um respiro (150 ms); o teste mede o texto,
// não o relógio.
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

// O módulo do AdminArea importa o AdminLayout, que importa o cliente do
// Supabase (e ele exige variáveis de ambiente que o teste não tem).
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

import { AdminViewLoadingFallback } from "@/components/layouts/AdminArea";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";

describe("AdminViewLoadingFallback — nome único do painel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  function tituloCarregando(view?: string): string {
    act(() => {
      raiz.render(<AdminViewLoadingFallback view={view} />);
    });
    return hospedeiro.querySelector("h1")?.textContent ?? "";
  }

  it("Perguntas mostra 'Perguntas', não 'Suporte Q&A'", () => {
    expect(tituloCarregando("admin-qa")).toBe("Perguntas");
  });

  it("Minha loja mostra 'Minha loja'", () => {
    expect(tituloCarregando("admin-about-store")).toBe("Minha loja");
  });

  it("Frete mostra 'Entrega e frete', não 'Frete' nem 'Frete nacional'", () => {
    expect(tituloCarregando("admin-shipping")).toBe("Entrega e frete");
    expect(tituloCarregando("admin-shipping-national")).toBe("Entrega e frete");
  });

  it("Cupom, Ficha do cliente e Relatórios deixam de ter nome próprio do carregando", () => {
    expect(tituloCarregando("admin-coupon-form")).toBe("Cupom");
    expect(tituloCarregando("admin-user-detail")).toBe("Ficha do cliente");
    expect(tituloCarregando("admin-crm")).toBe("Relatórios");
  });

  it.each(Object.entries(NOMES_DO_PAINEL))("%s mostra '%s'", (tela, nome) => {
    expect(tituloCarregando(tela)).toBe(nome);
  });

  it("tela desconhecida (ou sem tela) cai no nome genérico 'Painel'", () => {
    expect(tituloCarregando("admin-inventada")).toBe("Painel");
    expect(tituloCarregando(undefined)).toBe("Painel");
  });
});
