// @vitest-environment jsdom
//
// A conexão cai DEPOIS de o banner novo gravar. A tela dizia "Erro ao salvar
// as configurações do banner.", continuava em "Novo Banner" e o segundo Salvar
// fazia outro INSERT: dois banners iguais para todas as clientes. Agora o
// editor de banner novo gera o id no aparelho ao abrir e manda o MESMO id em
// toda tentativa; se a lista relida já traz o banner, o editor sai do modo
// novo. O dublê do `addBanner` faz o papel do banco: guarda a linha mesmo
// quando a resposta se perde, e trata id repetido como "já gravado" (o hook
// real faz isso pelo 23505 `banners_pkey`, provado no teste do hook).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirNovoBannerPelaBarra,
  escolherImagemPropria,
  esperarEditorFechadoPorSalvar,
} from "./helpers/editor-de-banner";

type BannerFalso = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => ({
  banco: [] as Array<Record<string, unknown> & { id: string }>,
  // A lista que a tela enxerga (muda quando o "hook" relê).
  definirLista: null as null | ((lista: unknown[]) => void),
  respostaDoAdd: "normal" as "normal" | "queda" | "recusa",
  // Se a releitura da lista depois da queda traz o banner gravado.
  releituraTrazOBanner: true,
  addBanner: vi.fn(),
  updateBanner: vi.fn(),
  uploadBannerImage: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

const existente: BannerFalso = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/existente.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top",
  active: true,
  order: 1,
};

const urlNova =
  "https://proj.supabase.co/storage/v1/object/public/banners/novo.jpg";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", async () => {
  const { useState } = await import("react");
  return {
    useBanners: () => {
      const [lista, setLista] = useState<unknown[]>(() => [...h.banco]);
      h.definirLista = setLista;
      return {
        banners: lista,
        isLoaded: true,
        uploadBannerImage: h.uploadBannerImage,
        addBanner: h.addBanner,
        updateBanner: h.updateBanner,
        deleteBanner: vi.fn(),
        deleteStorageFile: vi.fn().mockResolvedValue(undefined),
        reorderBanners: vi.fn(),
        refreshBanners: vi.fn(),
      };
    },
  };
});
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: h.toastError,
    info: h.toastInfo,
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const botaoSalvar = () =>
  [...document.body.querySelectorAll("button")].find((b) =>
    ["Salvar Banner", "Salvar Alterações"].includes(
      b.textContent?.trim() ?? "",
    ),
  ) as HTMLButtonElement | undefined;

const tituloDoEditor = () =>
  [...document.body.querySelectorAll("h1, h2")]
    .map((t) => t.textContent?.trim())
    .find((t) => t === "Novo Banner" || t === "Editar Banner");

const novosNoBanco = () => h.banco.filter((l) => l.id !== existente.id);

// O "banco": guarda a linha antes de decidir a resposta. Id repetido = já
// gravado (o hook real devolve sucesso pelo 23505 da chave primária).
function addBannerQueGrava(
  banner: Record<string, unknown>,
  opcoes?: { idDoFormulario?: string },
) {
  const id = opcoes?.idDoFormulario ?? `gerado-${h.banco.length}`;
  if (h.respostaDoAdd === "recusa") {
    return Promise.reject({ code: "23514", message: "check violation" });
  }
  const jaGravado = h.banco.find((l) => l.id === id);
  if (jaGravado) {
    return Promise.resolve({
      id,
      recuperadoAposConflito: true,
      bannerGravado: jaGravado,
    });
  }
  const linha = { ...banner, id };
  h.banco.push(linha);
  if (h.respostaDoAdd === "queda") {
    // O hook real avisa e relê a lista; aqui a releitura é a troca da lista.
    if (h.releituraTrazOBanner) h.definirLista?.([...h.banco]);
    return Promise.reject({ message: "TypeError: Failed to fetch", code: "" });
  }
  return Promise.resolve({
    id,
    recuperadoAposConflito: false,
    bannerGravado: linha,
  });
}

describe("AdminBannersView — a conexão cai depois de o banner novo gravar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.banco = [{ ...existente }];
    h.respostaDoAdd = "normal";
    h.releituraTrazOBanner = true;
    h.addBanner.mockImplementation(addBannerQueGrava);
    h.updateBanner.mockResolvedValue(undefined);
    h.uploadBannerImage.mockResolvedValue(urlNova);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  async function montarEAbrirNovoComImagem() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={vi.fn()}
          active={true}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();
    const campo = document.getElementById("banner-upload") as HTMLInputElement;
    Object.defineProperty(campo, "files", {
      value: [new File(["x"], "novo.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    await act(async () => {
      campo.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
  }

  async function tocarSalvar() {
    const salvar = botaoSalvar();
    expect(salvar).toBeDefined();
    await act(async () => {
      salvar!.click();
      await esperar();
      await esperar();
    });
  }

  it("gravou, caiu, a lista relida traz o banner: sai do modo novo e não cria outro", async () => {
    await montarEAbrirNovoComImagem();
    expect(tituloDoEditor()).toBe("Novo Banner");

    h.respostaDoAdd = "queda";
    await tocarSalvar();
    expect(h.toastError).not.toHaveBeenCalledWith(
      "Erro ao salvar as configurações do banner.",
    );
    expect(tituloDoEditor()).toBe("Editar Banner");

    h.respostaDoAdd = "normal";
    await tocarSalvar();

    expect(h.addBanner).toHaveBeenCalledTimes(1);
    expect(novosNoBanco()).toHaveLength(1);
    esperarEditorFechadoPorSalvar();
  });

  it("gravou, caiu, a releitura não trouxe: o 2º Salvar repete o MESMO id e o banco fica com UM", async () => {
    await montarEAbrirNovoComImagem();
    h.respostaDoAdd = "queda";
    h.releituraTrazOBanner = false;
    await tocarSalvar();
    expect(tituloDoEditor()).toBe("Novo Banner");

    h.respostaDoAdd = "normal";
    await tocarSalvar();

    expect(h.addBanner).toHaveBeenCalledTimes(2);
    const [, primeira] = h.addBanner.mock.calls[0];
    const [, segunda] = h.addBanner.mock.calls[1];
    expect(primeira?.idDoFormulario).toEqual(expect.any(String));
    expect(segunda?.idDoFormulario).toBe(primeira?.idDoFormulario);
    expect(novosNoBanco()).toHaveLength(1);
    esperarEditorFechadoPorSalvar();
  });

  it("controle: recusa real do banco (23514) não é queda e continua avisando erro", async () => {
    await montarEAbrirNovoComImagem();
    h.respostaDoAdd = "recusa";
    await tocarSalvar();

    expect(novosNoBanco()).toHaveLength(0);
    expect(h.toastError).toHaveBeenCalledWith(
      "Erro ao salvar as configurações do banner.",
    );
    expect(tituloDoEditor()).toBe("Novo Banner");
  });

  it("cada banner novo ganha um id próprio (abrir o editor de novo não reaproveita)", async () => {
    await montarEAbrirNovoComImagem();
    await tocarSalvar();
    esperarEditorFechadoPorSalvar();

    await abrirNovoBannerPelaBarra();
    await escolherImagemPropria();
    const campo = document.getElementById("banner-upload") as HTMLInputElement;
    Object.defineProperty(campo, "files", {
      value: [new File(["y"], "outro.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    await act(async () => {
      campo.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
    await tocarSalvar();

    expect(h.addBanner).toHaveBeenCalledTimes(2);
    const [, primeira] = h.addBanner.mock.calls[0];
    const [, segunda] = h.addBanner.mock.calls[1];
    expect(segunda?.idDoFormulario).not.toBe(primeira?.idDoFormulario);
    expect(novosNoBanco()).toHaveLength(2);
  });
});
