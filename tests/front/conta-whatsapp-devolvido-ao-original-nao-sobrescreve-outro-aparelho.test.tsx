// @vitest-environment jsdom
//
// "Minha conta" em dois aparelhos: o WhatsApp só deve ir à gravação quando o VALOR mudou em relação ao que a tela
// abriu, não quando o campo foi apenas TOCADO. Antes, a marca `whatsappEditado` (ligada em qualquer digitação) bastava:
// a pessoa mexia no telefone no aparelho A e devolvia o mesmo número; outro aparelho gravava um telefone novo; em A ela
// trocava só o NOME e o salvamento mandava o telefone velho por cima do novo.
//
// Prende: (1) editar e devolver ao original, trocar só o nome -> `p_whatsapp: null`; (2) telefone novo continua indo;
// (3) apagar o telefone continua indo (vazio); (4) não tocar -> null; (5) legado inválido tocado e devolvido, com
// pontuação diferente: nem bloqueia o salvar nem reenvia (a comparação é por DÍGITOS).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pedidoCpfComCabecalho } from "./helpers/pedido-cpf-com-cabecalho";

const fetchProfile = vi.fn();
const updateProfile = vi.fn();
const updatePassword = vi.fn();
const rpc = vi.fn();

const USUARIO = { id: "cliente-1", email: "cliente@example.com" };
const PERFIL = { avatar_url: null, cover_url: null };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: USUARIO,
    profile: PERFIL,
    fetchProfile,
    updateProfile,
    updatePassword,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: "token-cliente-1", user: USUARIO } },
        }),
    },
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return args[0] === "update_my_profile_secure"
        ? pedidoCpfComCabecalho(resposta)
        : resposta;
    },
  },
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

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function salvar() {
  const botaoSalvar = localizarBotaoPorTexto("Salvar alterações")!;
  await act(async () => {
    botaoSalvar.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gravacoes = () =>
  rpc.mock.calls.filter((chamada) => chamada[0] === "update_my_profile_secure");

describe("AccountSettingsView — WhatsApp devolvido ao original não sobrescreve o de outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function montarComWhatsappGravado(whatsapp: string) {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Fulano de Tal", whatsapp }],
          error: null,
        });
      }
      return Promise.resolve({ error: null });
    });
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return !nome.disabled && nome.value === "Fulano de Tal";
    });
  }

  it("edita o telefone, devolve ao original e troca só o nome: não manda o telefone", async () => {
    await montarComWhatsappGravado("34999991111");
    const campo = document.getElementById("phone") as HTMLInputElement;
    expect(campo.value).toBe("(34) 99999-1111");

    digitar("phone", "34988882222");
    digitar("phone", "34999991111");
    expect(campo.value).toBe("(34) 99999-1111");
    digitar("full_name", "Fulano de Tal Jr");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({
      p_full_name: "Fulano de Tal Jr",
      p_whatsapp: null,
    });
  });

  it("edita para um telefone novo e salva: o telefone novo vai", async () => {
    await montarComWhatsappGravado("34999991111");

    digitar("phone", "34988882222");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_whatsapp: "(34) 98888-2222" });
  });

  it("apaga o telefone e salva: o vazio vai (comportamento de sempre)", async () => {
    await montarComWhatsappGravado("34999991111");

    digitar("phone", "");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({ p_whatsapp: "" });
  });

  it("não toca no telefone e troca só o nome: não manda o telefone", async () => {
    await montarComWhatsappGravado("34999991111");

    digitar("full_name", "Fulano de Tal Jr");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({
      p_full_name: "Fulano de Tal Jr",
      p_whatsapp: null,
    });
  });

  it("depois de salvar o telefone novo, voltar ao antigo no aparelho volta a mandar (o base é o último salvo)", async () => {
    await montarComWhatsappGravado("34999991111");

    digitar("phone", "34988882222");
    await salvar();
    digitar("phone", "34999991111");
    await salvar();

    expect(gravacoes()).toHaveLength(2);
    expect(gravacoes()[1][1]).toMatchObject({ p_whatsapp: "(34) 99999-1111" });
  });

  it("legado inválido (12 dígitos) tocado e devolvido com outra pontuação: não bloqueia o salvar nem reenvia", async () => {
    await montarComWhatsappGravado("12 34567 89012");
    const campo = document.getElementById("phone") as HTMLInputElement;
    // Mais de 11 dígitos: a tela mostra o valor cru, como está no banco.
    expect(campo.value).toBe("12 34567 89012");

    digitar("phone", "12345678901");
    digitar("phone", "1234567890-12");
    expect(campo.value).toBe("1234567890-12");
    digitar("full_name", "Fulano de Tal Jr");
    await salvar();

    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0][1]).toMatchObject({
      p_full_name: "Fulano de Tal Jr",
      p_whatsapp: null,
    });
  });
});
