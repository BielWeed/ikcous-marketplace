// @vitest-environment jsdom
//
// Rede ruim: a conta entrou, mas o perfil (nome, WhatsApp, foto) ainda não
// veio. O Perfil mostrava a parte do e-mail antes do @ como NOME, escondia o
// WhatsApp e nunca pedia o perfil de novo. O cadastro guarda `full_name` e
// `phone` na conta (não `name`): enquanto o perfil não chega, a tela lê dali
// (da conta ATUAL) e, ao abrir, pede o perfil mais uma vez (uma tentativa por
// abertura, sem laço). RENDER DE VERDADE da ProfileView; hooks de dados são
// dublês. Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  userId: "user-1" as string | null,
  metadata: {} as Record<string, unknown>,
  profile: null as Record<string, unknown> | null,
  authLoading: false,
};
const fetchProfile = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    // Objeto NOVO a cada render, como os mocks (e o contexto) podem fazer.
    user: estado.userId
      ? {
          id: estado.userId,
          email: "maria.conta@exemplo.test",
          user_metadata: estado.metadata,
          created_at: "2026-10-15T12:00:00Z",
        }
      : null,
    profile: estado.profile,
    fetchProfile,
    logout: vi.fn(),
    isAdmin: false,
    loading: estado.authLoading,
    updateProfile: async () => true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    deleteAddress: async () => true,
    loading: false,
    erroAoCarregar: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: [], fetchUserOrders: async () => [] }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja Teste", whatsappNumber: "34999999999" },
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ObserverStub);
vi.stubGlobal("IntersectionObserver", ObserverStub);

describe("ProfileView — perfil que não carregou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.userId = "user-1";
    estado.metadata = {};
    estado.profile = null;
    estado.authLoading = false;
    fetchProfile.mockReset();
    fetchProfile.mockResolvedValue(undefined);
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

  async function abrir(isActive = true) {
    const { ProfileView } = await import("@/views/customer/ProfileView");
    await act(async () => {
      raiz.render(<ProfileView onNavigate={vi.fn()} isActive={isActive} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function nomeMostrado() {
    const rotulo = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent === "Nome completo",
    );
    return rotulo?.nextElementSibling?.textContent;
  }

  it("sem perfil, o nome vem do cadastro (full_name), não do pedaço do e-mail", async () => {
    estado.metadata = { full_name: "Maria da Conta Silva" };
    await abrir();

    // O e-mail aparece na linha "E-mail"; o que não pode é virar o NOME.
    expect(nomeMostrado()).toBe("Maria da Conta Silva");
    // A foto (inicial) acompanha o nome certo, não o e-mail.
    expect(
      hospedeiro.querySelector('span[aria-hidden="true"].text-4xl')
        ?.textContent,
    ).toBe("M");
  });

  it("sem perfil, o WhatsApp vem do cadastro (phone) em vez de sumir", async () => {
    estado.metadata = { full_name: "Maria", phone: "(34) 98888-7777" };
    await abrir();

    expect(hospedeiro.textContent).toContain("WhatsApp");
    expect(hospedeiro.textContent).toContain("(34) 98888-7777");
    expect(hospedeiro.textContent).not.toContain("Adicionar WhatsApp");
  });

  it("sem perfil e sem nada no cadastro: segue o e-mail e não inventa 'Adicionar WhatsApp'", async () => {
    await abrir();

    expect(nomeMostrado()).toBe("maria.conta");
    expect(hospedeiro.textContent).not.toContain("Adicionar WhatsApp");
    expect(hospedeiro.textContent).not.toContain("WhatsApp");
  });

  it("com o perfil carregado, ele manda: o cadastro não sobrescreve nome nem WhatsApp", async () => {
    estado.metadata = { full_name: "Nome do Cadastro", phone: "11911112222" };
    estado.profile = {
      full_name: "Nome do Perfil",
      avatar_url: null,
      cover_url: null,
      whatsapp: "",
    };
    await abrir();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Nome do Perfil");
    expect(texto).not.toContain("Nome do Cadastro");
    // Perfil veio SEM WhatsApp: é "Adicionar", nunca o número velho do cadastro.
    expect(texto).toContain("Adicionar WhatsApp");
    expect(texto).not.toContain("11911112222");
    expect(texto).not.toContain("(11) 91111-2222");
  });

  it("ao abrir sem perfil, pede o perfil de novo UMA vez e não entra em laço", async () => {
    await abrir();
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    // Re-renderizações (user novo a cada render, nada mudou): sem nova busca.
    await abrir();
    await abrir();
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it("uma tentativa por abertura: aba escondida não pede, cada volta à aba pede de novo", async () => {
    await abrir(false);
    expect(fetchProfile).not.toHaveBeenCalled();

    await abrir(true);
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    await abrir(false);
    await abrir(true);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it("perfil já carregado: não pede de novo", async () => {
    estado.profile = { full_name: "Maria", avatar_url: null, cover_url: null };
    await abrir();
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("sem conta (ou conta ainda carregando): não pede perfil", async () => {
    estado.userId = null;
    await abrir();
    expect(fetchProfile).not.toHaveBeenCalled();

    estado.userId = "user-1";
    estado.authLoading = true;
    await abrir();
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("se a busca do perfil falhar, a tela segue de pé e não repete sozinha", async () => {
    fetchProfile.mockRejectedValue(new Error("sem rede"));
    estado.metadata = { full_name: "Maria da Conta Silva" };
    await abrir();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(nomeMostrado()).toBe("Maria da Conta Silva");
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });
});
