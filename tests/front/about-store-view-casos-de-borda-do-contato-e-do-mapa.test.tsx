// @vitest-environment jsdom
//
// Casos de BORDA da página "Sobre a loja" que os testes vizinhos
// (`about-store-view-mostra-o-que-a-loja-tem`, `...-endereco-e-descricao`)
// deixavam passar, achados por mutação (trocar uma linha da página e ver se
// algum teste cai). Protege, para a cliente que abre a página:
// - campo preenchido só com espaços NÃO vira bloco vazio (horário, história,
//   endereço, CEP, logo): a régua da casa é "sem valor, sem rótulo";
// - o mapa cai para cidade/UF quando a loja só tem isso;
// - sem internet o mapa e o link do Google saem e o endereço em texto entra;
// - o WhatsApp de telefone FIXO (10 dígitos) também ganha o 55, o número já
//   com +55 não duplica o 55, e a frase vai codificada no link;
// - o link do Google Maps abre em outra aba sem entregar o app (noopener);
// - o domínio do e-mail também é codificado no `mailto:`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigDeTeste = Record<string, unknown>;

let configAtual: ConfigDeTeste = {};
let semInternetAgora = false;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
}));
// O hook devolve `isOffline`: true = sem internet.
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => semInternetAgora,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObservadorFalso);
vi.stubGlobal("IntersectionObserver", ObservadorFalso);

const LOJA_VAZIA: ConfigDeTeste = {
  storeName: null,
  logoUrl: null,
  storeCity: null,
  storeState: null,
  businessHours: null,
  whatsappNumber: null,
  storeDescription: null,
  storeAddress: null,
  originCep: null,
};

describe("AboutStoreView — bordas de contato, mapa e campos só com espaço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    semInternetAgora = false;
    vi.stubGlobal("open", vi.fn());
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

  async function renderizarPagina() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  function mapa() {
    return hospedeiro.querySelector<HTMLIFrameElement>(
      "iframe[title^='Mapa da loja']",
    );
  }

  function linkDoMapa() {
    return hospedeiro.querySelector<HTMLAnchorElement>(
      "a[aria-label='Abrir no Google Maps']",
    );
  }

  function botaoWhatsapp() {
    return document.body.querySelector<HTMLButtonElement>(
      "button[aria-label='Falar com a loja no WhatsApp']",
    );
  }

  async function clicarNoWhatsapp() {
    const botao = botaoWhatsapp();
    expect(botao).not.toBeNull();
    await act(async () => {
      botao?.click();
    });
    return String(vi.mocked(globalThis.open).mock.calls[0]?.[0]);
  }

  describe("campo só com espaços não vira bloco vazio", () => {
    it("horário só com espaços: sem 'Horário de atendimento' e a página diz que está vazia", async () => {
      configAtual = { ...LOJA_VAZIA, businessHours: "   \n  " };
      const texto = await renderizarPagina();
      expect(texto).not.toContain("Horário de atendimento");
      expect(texto).toContain("A loja ainda não preencheu estas informações");
    });

    it("história só com espaços: sem 'Nossa história' e a página diz que está vazia", async () => {
      configAtual = { ...LOJA_VAZIA, storeDescription: "  \n  " };
      const texto = await renderizarPagina();
      expect(texto).not.toContain("Nossa história");
      expect(texto).toContain("A loja ainda não preencheu estas informações");
    });

    it("história que a sanitização esvazia (só <script>): o bloco não existe", async () => {
      configAtual = {
        ...LOJA_VAZIA,
        storeDescription: "<script>alert(1)</script>",
      };
      const texto = await renderizarPagina();
      expect(texto).not.toContain("Nossa história");
      expect(hospedeiro.querySelector("script")).toBeNull();
      expect(texto).toContain("A loja ainda não preencheu estas informações");
    });

    it("endereço só com espaços cai para o CEP, nunca vira um mapa de '%20%20'", async () => {
      configAtual = {
        ...LOJA_VAZIA,
        storeAddress: "   ",
        originCep: "38500-000",
      };
      await renderizarPagina();
      expect(mapa()?.getAttribute("src")).toBe(
        "https://maps.google.com/maps?q=38500-000&z=15&output=embed",
      );
    });

    it("CEP só com espaços cai para a cidade/UF", async () => {
      configAtual = {
        ...LOJA_VAZIA,
        originCep: "   ",
        storeCity: "Monte Carmelo",
        storeState: "MG",
      };
      await renderizarPagina();
      expect(mapa()?.getAttribute("src")).toBe(
        `https://maps.google.com/maps?q=${encodeURIComponent("Monte Carmelo, MG")}&z=15&output=embed`,
      );
    });

    it("endereço e CEP só com espaços, sem cidade: nenhum mapa", async () => {
      configAtual = { ...LOJA_VAZIA, storeAddress: "  ", originCep: "  " };
      await renderizarPagina();
      expect(mapa()).toBeNull();
      expect(linkDoMapa()).toBeNull();
    });

    it("logo só com espaços usa a logo do build, não um <img src> em branco", async () => {
      configAtual = { ...LOJA_VAZIA, logoUrl: "   " };
      await renderizarPagina();
      const logo = hospedeiro.querySelector<HTMLImageElement>(
        "img[alt^='Logo da loja']",
      );
      expect(logo?.getAttribute("src")).toBe("/identity/aurora/header.webp");
    });
  });

  describe("o mapa cai para cidade/UF quando é só o que a loja tem", () => {
    it("só cidade e UF: mapa e link do Google usam 'Cidade, UF' codificado", async () => {
      configAtual = {
        ...LOJA_VAZIA,
        storeCity: "São João del-Rei",
        storeState: "MG",
      };
      await renderizarPagina();
      const consulta = encodeURIComponent("São João del-Rei, MG");
      expect(mapa()?.getAttribute("src")).toBe(
        `https://maps.google.com/maps?q=${consulta}&z=15&output=embed`,
      );
      expect(linkDoMapa()?.getAttribute("href")).toBe(
        `https://www.google.com/maps/search/?api=1&query=${consulta}`,
      );
    });

    it("só a UF (cidade em branco): mostra 'MG' sozinho, sem vírgula solta", async () => {
      configAtual = { ...LOJA_VAZIA, storeCity: "  ", storeState: "MG" };
      await renderizarPagina();
      const consulta = encodeURIComponent("MG");
      expect(mapa()?.getAttribute("src")).toBe(
        `https://maps.google.com/maps?q=${consulta}&z=15&output=embed`,
      );
    });
  });

  describe("sem internet", () => {
    it("troca o mapa e o link do Google pelo endereço em texto com o aviso", async () => {
      semInternetAgora = true;
      configAtual = {
        ...LOJA_VAZIA,
        storeAddress: "Rua das Flores, 120 — Centro",
      };
      const texto = await renderizarPagina();
      expect(texto).toContain("Sem internet");
      expect(texto).toContain("Rua das Flores, 120 — Centro");
      expect(mapa()).toBeNull();
      expect(linkDoMapa()).toBeNull();
    });

    it("com internet o aviso não aparece e o mapa existe", async () => {
      semInternetAgora = false;
      configAtual = { ...LOJA_VAZIA, storeAddress: "Rua das Flores, 120" };
      const texto = await renderizarPagina();
      expect(texto).not.toContain("Sem internet");
      expect(mapa()).not.toBeNull();
      expect(linkDoMapa()).not.toBeNull();
    });

    it("sem internet e sem endereço nenhum: nem o aviso de 'Sem internet' aparece", async () => {
      semInternetAgora = true;
      configAtual = { ...LOJA_VAZIA };
      const texto = await renderizarPagina();
      expect(texto).not.toContain("Sem internet");
    });
  });

  describe("o link do Google Maps", () => {
    it("abre em outra aba sem entregar o app à página aberta (noopener, noreferrer)", async () => {
      configAtual = { ...LOJA_VAZIA, storeAddress: "Rua das Flores, 120" };
      await renderizarPagina();
      const link = linkDoMapa();
      expect(link?.getAttribute("target")).toBe("_blank");
      const rel = (link?.getAttribute("rel") ?? "").split(/\s+/);
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    });

    it("endereço com acento, vírgula, & e # vai codificado: a consulta não se parte", async () => {
      const endereco = "Av. Ação & Cia, 10 #3 — São Paulo";
      configAtual = { ...LOJA_VAZIA, storeAddress: endereco };
      await renderizarPagina();
      const href = linkDoMapa()?.getAttribute("href") ?? "";
      const consulta = href.split("query=")[1] ?? "";
      expect(consulta).toBe(encodeURIComponent(endereco));
      expect(consulta).not.toMatch(/[ &#,]/);
      expect(decodeURIComponent(consulta)).toBe(endereco);
    });
  });

  describe("o botão de WhatsApp", () => {
    it("telefone FIXO (10 dígitos) também ganha o 55", async () => {
      configAtual = { ...LOJA_VAZIA, whatsappNumber: "(34) 3333-4444" };
      await renderizarPagina();
      const url = await clicarNoWhatsapp();
      expect(url.startsWith("https://wa.me/553433334444?text=")).toBe(true);
    });

    it("número já com +55 não duplica o 55", async () => {
      configAtual = { ...LOJA_VAZIA, whatsappNumber: "+55 (34) 99999-9999" };
      await renderizarPagina();
      const url = await clicarNoWhatsapp();
      expect(url.startsWith("https://wa.me/5534999999999?text=")).toBe(true);
    });

    it("a frase de abertura vai codificada no link (acento, espaço e '!')", async () => {
      configAtual = { ...LOJA_VAZIA, whatsappNumber: "34999999999" };
      await renderizarPagina();
      const url = await clicarNoWhatsapp();
      expect(url).toBe(
        `https://wa.me/5534999999999?text=${encodeURIComponent("Olá! Vim pelo app da loja.")}`,
      );
      expect(url).not.toContain(" ");
      expect(url).not.toContain("á");
    });

    it("número curto demais (sem DDD): sem botão", async () => {
      configAtual = { ...LOJA_VAZIA, whatsappNumber: "99999-9999" };
      await renderizarPagina();
      expect(botaoWhatsapp()).toBeNull();
    });
  });

  describe("o e-mail de atendimento", () => {
    it("codifica o domínio no mailto sem mudar o texto visível", async () => {
      configAtual = { ...LOJA_VAZIA, storeSupportEmail: "ajuda@lo%ja.com" };
      await renderizarPagina();
      const link = hospedeiro.querySelector("a[href^='mailto:']");
      expect(link?.textContent).toBe("ajuda@lo%ja.com");
      expect(link?.getAttribute("href")).toBe("mailto:ajuda@lo%25ja.com");
    });
  });
});
