// @vitest-environment jsdom
//
// O nome pode vir do cadastro enquanto o perfil não chega. O WhatsApp pode
// ter mudado desde então: só o perfil confirma o número atual. RENDER DE
// VERDADE da ProfileView; hooks de dados são dublês. Dados inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = {
  userId: "user-1" as string | null,
  metadata: {} as Record<string, unknown>,
  profile: null as Record<string, unknown> | null,
  authLoading: false,
};
const fetchProfile = vi.fn<() => Promise<boolean>>();

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
    fetchProfile.mockResolvedValue(false);
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

  it("enquanto o perfil carrega, não mostra o número antigo do cadastro", async () => {
    estado.metadata = { full_name: "Maria", phone: "(34) 98888-7777" };
    fetchProfile.mockImplementationOnce(() => new Promise(() => {}));
    await abrir();

    expect(hospedeiro.textContent).not.toContain("(34) 98888-7777");
    expect(hospedeiro.textContent).not.toContain("Adicionar WhatsApp");
    expect(hospedeiro.textContent).toContain("WhatsApp");
    expect(hospedeiro.textContent).toContain("Carregando…");
  });

  it("sem perfil e sem nada no cadastro: segue o e-mail e não inventa 'Adicionar WhatsApp'", async () => {
    await abrir();

    expect(nomeMostrado()).toBe("maria.conta");
    expect(hospedeiro.textContent).not.toContain("Adicionar WhatsApp");
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

  it("se a busca falhar, avisa e só tenta novamente ao tocar em Tentar de novo", async () => {
    fetchProfile.mockImplementationOnce(() => Promise.resolve(false));
    fetchProfile.mockRejectedValueOnce(new Error("sem rede"));
    estado.metadata = {
      full_name: "Maria da Conta Silva",
      phone: "(34) 98888-7777",
    };
    await abrir();

    expect(nomeMostrado()).toBe("Maria da Conta Silva");
    expect(hospedeiro.textContent).not.toContain("(34) 98888-7777");
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar seu WhatsApp",
    );
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent === "Tentar de novo",
    );
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());
    expect(fetchProfile).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar seu WhatsApp",
    );
  });

  it("mantém o foco em Tentar de novo se a retentativa do WhatsApp falhar", async () => {
    const { promise: retentativa, resolve: concluir } =
      Promise.withResolvers<boolean>();
    fetchProfile.mockResolvedValueOnce(false).mockReturnValueOnce(retentativa);
    await abrir();

    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (botao) => botao.textContent === "Tentar de novo",
    );
    if (!tentar) throw new Error("Não encontrou Tentar de novo");
    tentar.focus();
    expect(document.activeElement).toBe(tentar);

    await act(async () => tentar.click());
    expect(hospedeiro.textContent).toContain("Carregando…");
    expect(document.activeElement).toBe(tentar);
    expect(tentar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => tentar.click());
    expect(fetchProfile).toHaveBeenCalledTimes(2);

    await act(async () => concluir(false));
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar seu WhatsApp",
    );
    expect(document.activeElement).toBe(tentar);
    expect(tentar.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("não mostra a retentativa ou o erro da conta que já saiu do Perfil", async () => {
    const anterior = Promise.withResolvers<boolean>();
    const atual = Promise.withResolvers<boolean>();
    fetchProfile
      .mockResolvedValueOnce(false)
      .mockReturnValueOnce(anterior.promise)
      .mockReturnValueOnce(atual.promise);
    await abrir();

    const tentar = () =>
      [...hospedeiro.querySelectorAll("button")].find(
        (botao) => botao.textContent === "Tentar de novo",
      );
    const botaoAnterior = tentar();
    if (!botaoAnterior) throw new Error("Não encontrou Tentar de novo");
    await act(async () => botaoAnterior.click());
    expect(botaoAnterior.getAttribute("aria-disabled")).toBe("true");

    estado.userId = "user-2";
    await abrir();
    expect(hospedeiro.textContent).toContain("Carregando…");
    expect(tentar()).toBeUndefined();

    await act(async () => anterior.resolve(false));
    expect(hospedeiro.textContent).toContain("Carregando…");
    expect(tentar()).toBeUndefined();

    await act(async () => atual.resolve(false));
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar seu WhatsApp",
    );
    expect(tentar()).toBeDefined();
  });

  it("com o perfil carregado, mostra o número atual, não o do cadastro", async () => {
    estado.metadata = { phone: "(34) 98888-7777" };
    estado.profile = { whatsapp: "34987654321" };
    await abrir();

    expect(hospedeiro.textContent).toContain("(34) 98765-4321");
    expect(hospedeiro.textContent).not.toContain("(34) 98888-7777");
    expect(hospedeiro.textContent).not.toContain("Carregando…");
  });
});
