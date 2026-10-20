// @vitest-environment jsdom
import { useAddresses } from "@/hooks/useAddresses";
import type { Address } from "@/types";
import { ProfileView } from "@/views/customer/ProfileView";
import { act, createContext, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resultado = { data: unknown; error: Error | null };
const { consultas } = vi.hoisted(() => ({
  consultas: [] as Array<(resultado: Resultado) => void>,
}));

const CONTA_A = {
  id: "conta-a",
  email: "ana@example.com",
  user_metadata: {},
};
const CONTA_B = { ...CONTA_A, id: "conta-b", email: "bia@example.com" };
// Cada tela pode continuar na conta de sua consulta enquanto a outra troca.
const ContextoDaConta = createContext(CONTA_A);

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: useContext(ContextoDaConta),
    profile: { full_name: "Ana", avatar_url: null, cover_url: null },
    logout: vi.fn(),
    isAdmin: false,
    loading: false,
    updateProfile: async () => true,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const promessa = new Promise<Resultado>((resolve) => {
        consultas.push(resolve);
      });
      const cadeia = Object.assign(promessa, {
        select: () => cadeia,
        insert: () => cadeia,
        update: () => cadeia,
        delete: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        single: () => cadeia,
      });
      return cadeia;
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/hooks/useOrders", () => {
  const fetchUserOrders = vi.fn();
  return { useOrders: () => ({ orders: [], fetchUserOrders }) };
});
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja",
      businessHours: "Seg-Sex: 8h às 19h",
      whatsappNumber: "34999999999",
    },
  }),
}));
vi.mock("@/components/ui/custom/OrderTimeline", () => ({
  OrderTimeline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const CASA: Address = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: true,
};
const NOVO_TRABALHO: Omit<Address, "id" | "user_id"> = {
  name: "Trabalho",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Trabalho",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: false,
};
const TRABALHO: Address = {
  ...NOVO_TRABALHO,
  id: "end-trabalho",
  user_id: "conta-a",
};
const CASA_B: Address = {
  ...CASA,
  id: "end-b",
  user_id: "conta-b",
  street: "Rua B",
};

function OutraTela() {
  const hook = useAddresses();
  return (
    <nav>
      <button type="button" onClick={() => void hook.fetchAddresses()}>
        Consultar outra tela
      </button>
      <button type="button" onClick={() => void hook.addAddress(NOVO_TRABALHO)}>
        Adicionar
      </button>
      <button
        type="button"
        onClick={() =>
          void hook.updateAddress("end-casa", { street: "Rua Editada" })
        }
      >
        Editar
      </button>
      <button type="button" onClick={() => void hook.deleteAddress("end-casa")}>
        Apagar
      </button>
    </nav>
  );
}

describe("endereços — só leitura confirmada da mesma conta limpa o erro entre telas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const navegar = vi.fn();

  beforeEach(() => {
    consultas.length = 0;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderizar(contaPerfil = CONTA_A, contaOutra = CONTA_A) {
    await act(async () => {
      raiz.render(
        <>
          <ContextoDaConta.Provider value={contaPerfil}>
            <section data-testid="perfil">
              <ProfileView onNavigate={navegar} />
            </section>
          </ContextoDaConta.Provider>
          <ContextoDaConta.Provider value={contaOutra}>
            <OutraTela />
          </ContextoDaConta.Provider>
        </>,
      );
    });
  }

  function perfil() {
    return hospedeiro.querySelector('[data-testid="perfil"]')!;
  }

  function aviso() {
    return perfil().querySelector('[role="alert"]');
  }

  async function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === texto,
    );
    expect(botao).toBeDefined();
    await act(async () => botao!.click());
  }

  function proximaResposta() {
    const resolver = consultas.shift();
    expect(resolver).toBeDefined();
    return resolver!;
  }

  async function responder(resultado: Resultado) {
    const resolver = proximaResposta();
    await act(async () => resolver(resultado));
  }

  async function falharPerfil() {
    await renderizar();
    await responder({ data: null, error: new Error("Sem rede") });
    expect(aviso()).not.toBeNull();
    expect(perfil().textContent).not.toContain("Nenhum endereço cadastrado");
  }

  it("leitura bem-sucedida em outra tela atualiza o Perfil e remove o alerta", async () => {
    await falharPerfil();
    await clicar("Consultar outra tela");
    await responder({ data: [TRABALHO], error: null });

    expect(perfil().textContent).toContain("Rua do Trabalho");
    expect(aviso()).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("ikcous_addresses_cache_conta-a")!),
    ).toEqual([TRABALHO]);
  });

  it("leitura vazia em outra tela remove o alerta e libera o vazio legítimo", async () => {
    localStorage.setItem(
      "ikcous_addresses_cache_conta-a",
      JSON.stringify([CASA]),
    );
    await falharPerfil();
    expect(perfil().textContent).toContain("Rua Principal");
    await clicar("Consultar outra tela");
    await responder({ data: [], error: null });

    expect(aviso()).toBeNull();
    expect(perfil().textContent).toContain("Nenhum endereço cadastrado");
    expect(perfil().textContent).not.toContain("Rua Principal");
    expect(
      JSON.parse(localStorage.getItem("ikcous_addresses_cache_conta-a")!),
    ).toEqual([]);
  });

  it.each([
    {
      acao: "Adicionar",
      data: TRABALHO,
      ruas: ["Rua Principal", "Rua do Trabalho"],
    },
    {
      acao: "Editar",
      data: { ...CASA, street: "Rua Editada" },
      ruas: ["Rua Editada"],
    },
    { acao: "Apagar", data: null, ruas: [] },
  ])(
    "$acao sobre cache antigo publica a lista sem apagar o erro",
    async ({ acao, data, ruas }) => {
      localStorage.setItem(
        "ikcous_addresses_cache_conta-a",
        JSON.stringify([CASA]),
      );
      await falharPerfil();
      await clicar(acao);
      await responder({ data, error: null });

      expect(aviso()).not.toBeNull();
      expect(perfil().textContent).not.toContain("Nenhum endereço cadastrado");
      for (const rua of ruas) expect(perfil().textContent).toContain(rua);
      if (acao !== "Adicionar") {
        expect(perfil().textContent).not.toContain("Rua Principal");
      }
    },
  );

  it("leitura confirmada de outra conta não altera a lista nem limpa o erro", async () => {
    localStorage.setItem(
      "ikcous_addresses_cache_conta-a",
      JSON.stringify([CASA]),
    );
    await falharPerfil();
    await renderizar(CONTA_A, CONTA_B);
    await clicar("Consultar outra tela");
    await responder({ data: [CASA_B], error: null });

    expect(aviso()).not.toBeNull();
    expect(perfil().textContent).toContain("Rua Principal");
    expect(perfil().textContent).not.toContain("Rua B");
    expect(
      JSON.parse(localStorage.getItem("ikcous_addresses_cache_conta-a")!),
    ).toEqual([CASA]);
  });

  it.each([CONTA_A, CONTA_B])(
    "resposta em voo de A após Perfil trocar para B é ignorada (outra tela em $id)",
    async (contaOutra) => {
      localStorage.setItem(
        "ikcous_addresses_cache_conta-a",
        JSON.stringify([CASA]),
      );
      localStorage.setItem(
        "ikcous_addresses_cache_conta-b",
        JSON.stringify([CASA_B]),
      );
      await falharPerfil();
      await clicar("Consultar outra tela");
      const resolverAntiga = proximaResposta();
      await renderizar(CONTA_B, contaOutra);
      await responder({ data: null, error: new Error("B também sem rede") });
      expect(aviso()).not.toBeNull();
      await act(async () => resolverAntiga({ data: [TRABALHO], error: null }));

      expect(aviso()).not.toBeNull();
      expect(perfil().textContent).toContain("Rua B");
      expect(perfil().textContent).not.toContain("Rua do Trabalho");
      expect(
        JSON.parse(localStorage.getItem("ikcous_addresses_cache_conta-b")!),
      ).toEqual([CASA_B]);
      if (contaOutra === CONTA_B) {
        expect(
          JSON.parse(localStorage.getItem("ikcous_addresses_cache_conta-a")!),
        ).toEqual([CASA]);
      }
    },
  );

  it.each([
    { data: [CASA], texto: "Rua Principal" },
    { data: [], texto: "Nenhum endereço cadastrado" },
  ])(
    "nova tentativa na própria instância mantém o fluxo: $texto",
    async ({ data, texto }) => {
      await falharPerfil();
      await clicar("Tentar de novo");
      await responder({ data, error: null });

      expect(aviso()).toBeNull();
      expect(perfil().textContent).toContain(texto);
    },
  );
});
