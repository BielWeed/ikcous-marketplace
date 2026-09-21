// @vitest-environment jsdom
//
// O mapa da "Sobre a Loja" só carrega com DUAS peças juntas: frame-src com o
// destino do redirect (https://www.google.com/maps/embed — ver
// vercel-headers-frame-do-mapa.test.ts) e o atributo credentialless no
// iframe, porque o COEP credentialless do app barra iframe terceiro sem
// COEP/CORP (o embed do Google não responde com nenhum dos dois —
// ERR_BLOCKED_BY_RESPONSE, quadro cinza no celular em 20/09/2026).
// Este teste prende a peça do COMPONENTE: os dois iframes (página pública e
// prévia do painel) nascem credentialless e com a cascata certa de query.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigDeTeste = Record<string, unknown>;

let configAtual: ConfigDeTeste = {};
const updateConfig = vi.fn(async () => true);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig,
    isLoaded: true,
  }),
}));

// BusinessHoursSection (bloco 3 do painel) lê a sessão; a prévia do mapa não
// depende dela — a sessão é stubada para o painel montar inteiro.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    session: null,
    isAdmin: false,
    adminStatus: "não-admin",
  }),
}));

// Editor de identidade (bloco 1) é preguiçoso e puxa storage/upload: fora do
// alcance deste teste — o que se prende aqui é o mapa do bloco 2.
vi.mock("@/components/admin/settings/IdentitySettingsSection", () => ({
  IdentitySettingsSection: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

const LOJA_SEM_ENDERECO: ConfigDeTeste = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  originCep: "38500-000",
  storeAddress: null,
};

function iframeDaPublica(hospedeiro: HTMLElement) {
  return hospedeiro.querySelector<HTMLIFrameElement>(
    "iframe[title^='Mapa da loja']",
  );
}

describe("os iframes do mapa da Sobre a Loja nascem credentialless", () => {
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
    vi.clearAllMocks();
  });

  it("página pública: fallback endereço vazio → CEP do frete, iframe credentialless", async () => {
    configAtual = LOJA_SEM_ENDERECO;
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });

    const mapa = iframeDaPublica(hospedeiro);
    expect(mapa).not.toBeNull();
    expect(mapa!.getAttribute("src")).toBe(
      "https://maps.google.com/maps?q=38500-000&z=15&output=embed",
    );
    expect(mapa!.hasAttribute("credentialless")).toBe(true);
  });

  it("página pública: endereço preenchido vence o CEP e o iframe continua credentialless", async () => {
    configAtual = {
      ...LOJA_SEM_ENDERECO,
      storeAddress: "Avenida Paulista, 1578 — Bela Vista",
    };
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });

    const mapa = iframeDaPublica(hospedeiro);
    expect(mapa!.getAttribute("src")).toBe(
      `https://maps.google.com/maps?q=${encodeURIComponent("Avenida Paulista, 1578 — Bela Vista")}&z=15&output=embed`,
    );
    expect(mapa!.hasAttribute("credentialless")).toBe(true);
  });

  it("prévia do painel: o que está DIGITADO alimenta o iframe credentialless SEM gravar nada", async () => {
    configAtual = LOJA_SEM_ENDERECO;
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView
          onNavigate={() => {}}
          active
          onSetDirty={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Fallback com o campo em branco: o mapa usa o CEP do frete.
    const previa = hospedeiro.querySelector<HTMLIFrameElement>(
      "iframe[title='Prévia do mapa da página Sobre a Loja']",
    );
    expect(previa).not.toBeNull();
    expect(previa!.getAttribute("src")).toBe(
      "https://maps.google.com/maps?q=38500-000&z=15&output=embed",
    );
    expect(previa!.hasAttribute("credentialless")).toBe(true);

    // O lojista digita o endereço: a prévia acompanha NA HORA, e nada é
    // gravado (o Salvar é ação explícita de outro teste). Input controlado do
    // React: o valor entra pelo setter nativo, como em
    // admin-sobre-a-loja-salva-sem-apagar.test.tsx.
    const campo = hospedeiro.querySelector<HTMLInputElement>("#store-address");
    expect(campo).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "Rodovia BR-365, km 12 — Monte Carmelo");
      campo!.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
    });

    const previaDigita = hospedeiro.querySelector<HTMLIFrameElement>(
      "iframe[title='Prévia do mapa da página Sobre a Loja']",
    );
    expect(previaDigita!.getAttribute("src")).toBe(
      `https://maps.google.com/maps?q=${encodeURIComponent("Rodovia BR-365, km 12 — Monte Carmelo")}&z=15&output=embed`,
    );
    expect(previaDigita!.hasAttribute("credentialless")).toBe(true);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("sem endereço, sem CEP e sem cidade: o cartão de mapa nem existe", async () => {
    configAtual = {
      storeName: "Ateliê da Serra",
      storeAddress: null,
      originCep: null,
      storeCity: null,
      storeState: null,
    };
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });

    expect(iframeDaPublica(hospedeiro)).toBeNull();
  });
});
