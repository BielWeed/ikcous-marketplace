// @vitest-environment jsdom
//
// VOLTAR DO APARELHO DURANTE O SALVAR DO ENDEREÇO (r84-b, achado 1).
//
// A cliente toca em Salvar e a rede está lenta: a gravação espera até 15 s, e
// só o botão Cancelar fica travado -- o Voltar do aparelho não. Ela aperta
// Voltar, o app mostra o Perfil (a animação pode reter a tela de endereço).
// Quando a gravação termina, a tela que saiu ainda chamava `onBack()`: o `handleBack` do
// App olha o histórico da entrada ATUAL (o Perfil) e voltava mais um passo,
// expulsando a cliente do Perfil sem ela tocar em nada. O endereço fica salvo
// de qualquer jeito; o que não pode é um segundo "voltar" por uma tela que
// não existe mais (mesma guarda que o checkout ganhou na r57-c).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, addAddress, updateAddress, lista } = vi.hoisted(() => ({
  auth: {
    user: { id: "u1", user_metadata: {} } as {
      id: string;
      user_metadata: { name?: string };
    } | null,
    profile: { full_name: "Mariana Lopes" } as { full_name?: string } | null,
  },
  addAddress: vi.fn(),
  updateAddress: vi.fn(),
  lista: { itens: [] as unknown[] },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: lista.itens,
    loading: false,
    fetchAddresses: vi.fn(),
    addAddress,
    updateAddress,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", shippingCoverage: "local" },
    isLoaded: true,
  }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

// Uma gravação que a rede demora a responder: o teste decide quando termina.
function gravacaoEmVoo<T>() {
  let terminar!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    terminar = resolve;
  });
  return { promessa, terminar };
}

const salvo = {
  id: "end-1",
  user_id: "u1",
  name: "Casa",
  recipient_name: "Mariana Lopes",
  cep: "38500-000",
  street: "Rua Tiradentes",
  number: "1250",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: false,
};

describe("AddressFormView — Voltar do aparelho durante o Salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: "u1", user_metadata: {} };
    auth.profile = { full_name: "Mariana Lopes" };
    lista.itens = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            logradouro: "Rua Tiradentes",
            bairro: "Centro",
            localidade: "Monte Carmelo",
            uf: "MG",
          }),
        }),
      ),
    );
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

  async function abrir(addressId?: string) {
    const onBack = vi.fn();
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    await act(async () => {
      raiz.render(<AddressFormView addressId={addressId} onBack={onBack} />);
    });
    return onBack;
  }

  // Mesmo fallback do App quando não há startViewTransition. Não substituímos
  // o shell nem AnimatePresence: a própria animação retém a tela que saiu.
  async function abrirNoShell(addressId?: string) {
    const onBack = vi.fn();
    const { AddressFormView } = await import(
      "@/views/customer/AddressFormView"
    );
    const { SecondaryViewMotionShell } = await import(
      "@/components/layouts/AppMotionFallbacks"
    );
    const mostrar = async (ativa: boolean) => {
      await act(async () => {
        raiz.render(
          <>
            {!ativa && <div data-testid="perfil" />}
            <SecondaryViewMotionShell
              active={ativa}
              viewKey="address_form"
              direction="back"
              transitionScroll={{ oldScroll: 0, newScroll: 0 }}
              duration={0.34}
            >
              <AddressFormView addressId={addressId} onBack={onBack} />
            </SecondaryViewMotionShell>
          </>,
        );
      });
    };
    await mostrar(true);
    // Deixa a animação de entrada começar antes de solicitar a saída.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return { onBack, mostrar };
  }

  async function preencherNovo() {
    await act(async () => {
      digitar("cep", "38500000");
    });
    await esvaziar();
    await act(async () => {
      digitar("number", "1250");
    });
  }

  async function tocarEmSalvar() {
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esvaziar();
  }

  // O App troca a tela (mostra o Perfil): a tela de endereço é desmontada.
  async function clienteApertaVoltarDoAparelho() {
    await act(async () => {
      raiz.render(<div data-testid="perfil" />);
    });
    expect(document.querySelector('[data-testid="perfil"]')).not.toBeNull();
  }

  it("endereço NOVO: a tela já saiu quando a gravação termina -- não chama onBack de novo", async () => {
    const gravacao = gravacaoEmVoo<{ id: string }>();
    addAddress.mockReturnValue(gravacao.promessa);
    const onBack = await abrir();
    await preencherNovo();
    await tocarEmSalvar();
    expect(addAddress).toHaveBeenCalledTimes(1);

    await clienteApertaVoltarDoAparelho();
    await act(async () => {
      gravacao.terminar({ id: "novo" });
    });
    await esvaziar();

    expect(onBack).not.toHaveBeenCalled();
  });

  it("EDIÇÃO: a tela já saiu quando a gravação termina -- não chama onBack de novo", async () => {
    lista.itens = [salvo];
    const gravacao = gravacaoEmVoo<boolean>();
    updateAddress.mockReturnValue(gravacao.promessa);
    const onBack = await abrir("end-1");
    await act(async () => {
      digitar("number", "1251");
    });
    await tocarEmSalvar();
    expect(updateAddress).toHaveBeenCalledTimes(1);

    await clienteApertaVoltarDoAparelho();
    await act(async () => {
      gravacao.terminar(true);
    });
    await esvaziar();

    expect(onBack).not.toHaveBeenCalled();
  });

  it("CONTROLE: a cliente ficou na tela -- a gravação que termina bem volta UMA vez", async () => {
    const gravacao = gravacaoEmVoo<{ id: string }>();
    addAddress.mockReturnValue(gravacao.promessa);
    const onBack = await abrir();
    await preencherNovo();
    await tocarEmSalvar();
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => {
      gravacao.terminar({ id: "novo" });
    });
    await esvaziar();

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    { modo: "NOVO", addressId: undefined },
    { modo: "EDIÇÃO", addressId: "end-1" },
  ])(
    "$modo: resposta durante a saída animada não volta de novo",
    async ({ addressId }) => {
      if (addressId) lista.itens = [salvo];
      const gravacao = gravacaoEmVoo<boolean | { id: string }>();
      const gravador = addressId ? updateAddress : addAddress;
      gravador.mockReturnValue(gravacao.promessa);
      const tela = await abrirNoShell(addressId);
      if (!addressId) await preencherNovo();
      await tocarEmSalvar();
      expect(gravador).toHaveBeenCalledTimes(1);
      const formulario = hospedeiro.querySelector("form");

      await tela.mostrar(false);
      expect(hospedeiro.querySelector('[data-testid="perfil"]')).not.toBeNull();
      // A rota já saiu, mas a MESMA instância ainda está no DOM pelo exit real.
      expect(formulario).not.toBeNull();
      expect(hospedeiro.querySelector("form")).toBe(formulario);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      expect(hospedeiro.querySelector("form")).toBe(formulario);
      await act(async () => {
        gravacao.terminar(addressId ? true : { id: "novo" });
      });
      await esvaziar();

      expect(tela.onBack).not.toHaveBeenCalled();
    },
  );

  it.each([
    { modo: "NOVO", addressId: undefined },
    { modo: "EDIÇÃO", addressId: "end-1" },
  ])(
    "$modo: enquanto o shell está ativo o sucesso volta uma vez",
    async ({ addressId }) => {
      if (addressId) lista.itens = [salvo];
      const gravacao = gravacaoEmVoo<boolean | { id: string }>();
      const gravador = addressId ? updateAddress : addAddress;
      gravador.mockReturnValue(gravacao.promessa);
      const tela = await abrirNoShell(addressId);
      if (!addressId) await preencherNovo();
      await tocarEmSalvar();
      expect(gravador).toHaveBeenCalledTimes(1);
      expect(tela.onBack).not.toHaveBeenCalled();

      await act(async () => {
        gravacao.terminar(addressId ? true : { id: "novo" });
      });
      await esvaziar();
      expect(tela.onBack).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { modo: "NOVO", addressId: undefined },
    { modo: "EDIÇÃO", addressId: "end-1" },
  ])(
    "$modo: interromper a saída não devolve permissão à gravação antiga",
    async ({ addressId }) => {
      if (addressId) lista.itens = [salvo];
      const gravacao = gravacaoEmVoo<boolean | { id: string }>();
      const gravador = addressId ? updateAddress : addAddress;
      gravador.mockReturnValue(gravacao.promessa);
      const tela = await abrirNoShell(addressId);
      if (!addressId) await preencherNovo();
      await tocarEmSalvar();
      expect(gravador).toHaveBeenCalledTimes(1);
      const formulario = hospedeiro.querySelector("form");

      await tela.mostrar(false);
      expect(formulario).not.toBeNull();
      expect(hospedeiro.querySelector("form")).toBe(formulario);
      await tela.mostrar(true);
      expect(hospedeiro.querySelector("form")).toBe(formulario);
      await act(async () => {
        gravacao.terminar(addressId ? true : { id: "antigo" });
      });
      await esvaziar();
      expect(tela.onBack).not.toHaveBeenCalled();

      // A nova presença não fica travada: só uma NOVA gravação pode navegar.
      gravador.mockResolvedValue(addressId ? true : { id: "novo" });
      await tocarEmSalvar();
      expect(gravador).toHaveBeenCalledTimes(2);
      expect(tela.onBack).toHaveBeenCalledTimes(1);
    },
  );

  it("CONTROLE: a cliente saiu e a gravação FALHA -- nada volta e nada quebra", async () => {
    const gravacao = gravacaoEmVoo<null>();
    addAddress.mockReturnValue(gravacao.promessa);
    const onBack = await abrir();
    await preencherNovo();
    await tocarEmSalvar();

    await clienteApertaVoltarDoAparelho();
    await act(async () => {
      gravacao.terminar(null);
    });
    await esvaziar();

    expect(onBack).not.toHaveBeenCalled();
  });
});
