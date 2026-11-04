// @vitest-environment jsdom
//
// O Início lia o PIX só do retrato do BOOT (`pagamentoOnlineLigado()`): quem
// ligava o pagamento pelo app em Ajustes voltava ao Início e ainda via "Ligar o
// pagamento pelo app (PIX)" em "Recomendado para vender"; quem pausava ainda o
// via como pronto. Agora o Início lê o mesmo eco que Ajustes publica e que a
// tela de Frete já usa (`usePagamentoPeloApp`), e acompanha a Public Key que o
// eco trouxer — a loja que abriu sem chave no boot também fica certa depois de
// ligar o PIX.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  boot: { ligado: false, chave: "APP_USR-chave-de-teste" as string | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => undefined,
  },
}));
vi.mock("@/lib/flags", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/flags")>()),
  pagamentoOnlineLigado: () => h.boot.ligado,
}));
vi.mock("@/config/configuracaoDaLoja", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  chavePublicaMercadoPago: () => h.boot.chave,
}));
vi.mock("@/hooks/useRecomendadosDaLoja", () => ({
  useRecomendadosDaLoja: () => ({
    email: "configurado",
    nomesLigados: ["Melhor Envio"],
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Gabriel Dono" },
    isAdmin: true,
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja", storeCity: "Manaus", storeState: "AM" },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PASSO_PIX = "Ligar o pagamento pelo app (PIX)";
const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

let hospedeiro: HTMLDivElement;
let raiz: Root;
let ecoDaVez: typeof import("@/lib/pagamento-pelo-app-no-painel") | undefined;

async function montarInicio() {
  vi.resetModules();
  // O módulo do eco é recarregado junto com a tela: os testes publicam no
  // MESMO módulo que o Início assina.
  const eco = await import("@/lib/pagamento-pelo-app-no-painel");
  ecoDaVez = eco;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  const { AdminDashboardView } = await import(
    "@/views/admin/AdminDashboardView"
  );
  await act(async () => {
    raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
  });
  return eco;
}

beforeEach(() => {
  h.boot.ligado = false;
  h.boot.chave = "APP_USR-chave-de-teste";
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  ecoDaVez?.esquecerEcoDoPagamentoPeloApp();
});

describe("Início: o pagamento pelo app acompanha o que Ajustes acabou de gravar", () => {
  it("boot desligado: o passo aparece; ligar em Ajustes (eco) faz o passo sumir", async () => {
    const eco = await montarInicio();
    expect(texto(hospedeiro)).toContain(PASSO_PIX);

    await act(async () => eco.publicarPagamentoPeloApp(true));
    expect(texto(hospedeiro)).not.toContain(PASSO_PIX);
  });

  it("boot ligado: o passo não aparece; pausar em Ajustes (eco) faz o passo voltar", async () => {
    h.boot.ligado = true;
    const eco = await montarInicio();
    expect(texto(hospedeiro)).not.toContain(PASSO_PIX);

    await act(async () => eco.publicarPagamentoPeloApp(false));
    expect(texto(hospedeiro)).toContain(PASSO_PIX);
  });

  it("boot sem Public Key: ligar com a chave publicada junto (eco) faz o passo sumir", async () => {
    h.boot.chave = null;
    const eco = await montarInicio();
    expect(texto(hospedeiro)).toContain(PASSO_PIX);

    await act(async () => eco.publicarPagamentoPeloApp(true, true));
    expect(texto(hospedeiro)).not.toContain(PASSO_PIX);
  });

  it("boot ligado e sem Public Key: o eco 'ligado, mas sem chave' (leitura crua) não acende o passo", async () => {
    h.boot.ligado = true;
    h.boot.chave = null;
    const eco = await montarInicio();
    expect(texto(hospedeiro)).toContain(PASSO_PIX);

    await act(async () => eco.publicarPagamentoPeloApp(true, false));
    expect(texto(hospedeiro)).toContain(PASSO_PIX);
  });

  it("eco de 'ligado' sem dizer da chave: vale a chave do boot (não inventa chave)", async () => {
    h.boot.chave = null;
    const eco = await montarInicio();

    await act(async () => eco.publicarPagamentoPeloApp(true));
    expect(texto(hospedeiro)).toContain(PASSO_PIX);
  });
});

describe("eco do pagamento pelo app: a chave publicada", () => {
  it("publicar com a chave avisa quem assina; esquecer volta ao boot", async () => {
    const eco = await import("@/lib/pagamento-pelo-app-no-painel");
    expect(eco.chaveDoPixPeloAppAgora()).toBeNull();
    eco.publicarPagamentoPeloApp(true, true);
    expect(eco.chaveDoPixPeloAppAgora()).toBe(true);
    eco.publicarPagamentoPeloApp(true);
    expect(eco.chaveDoPixPeloAppAgora()).toBe(true);
    eco.esquecerEcoDoPagamentoPeloApp();
    expect(eco.chaveDoPixPeloAppAgora()).toBeNull();
  });
});
