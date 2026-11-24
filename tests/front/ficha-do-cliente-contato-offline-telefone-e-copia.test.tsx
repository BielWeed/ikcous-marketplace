// @vitest-environment jsdom
//
// Caça por mutação na ficha do cliente (24/11/2026). Três regras do bloco de
// contato podiam ser quebradas sem nenhum teste cair:
//   - sem internet, "Conversar no WhatsApp" fica desligado (e não abre nada),
//     mesmo com um número bom;
//   - o telefone da ficha aparece formatado quando é brasileiro, e igual ao
//     cadastro quando é estrangeiro;
//   - copiar e-mail/telefone avisa o que foi copiado, e copia o texto certo.
// Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUserDetailView as TipoFicha } from "@/views/admin/AdminUserDetailView";

const h = vi.hoisted(() => ({
  offline: false,
  whatsapp: "11988887777" as string | null,
  email: "prova@fixture.invalid" as string | null,
  copiados: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: h.email,
            whatsapp: h.whatsapp,
          },
          orders: [],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      // Consulta encadeável que devolve lista vazia (carrinho e "voz do cliente").
      select: () => {
        const vazia = (): unknown =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            eq: vazia,
            in: vazia,
            is: vazia,
            order: vazia,
            limit: vazia,
            not: vazia,
          });
        return vazia();
      },
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: (texto: string) => {
    h.copiados.push(texto);
    return Promise.resolve(true);
  },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

let AdminUserDetailView: typeof TipoFicha;

beforeAll(async () => {
  ({ AdminUserDetailView } = await import("@/views/admin/AdminUserDetailView"));
}, 60_000);

describe("ficha do cliente — contato", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.offline = false;
    h.whatsapp = "11988887777";
    h.email = "prova@fixture.invalid";
    h.copiados.length = 0;
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const botao = (trecho: string): HTMLButtonElement => {
    const achado = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(trecho),
    );
    if (!achado) throw new Error(`"${trecho}" não está na tela`);
    return achado;
  };

  it("com internet e número bom, o botão do WhatsApp está ligado e abre a conversa", async () => {
    await abrirFicha();

    expect(botao("Conversar no WhatsApp").disabled).toBe(false);
    await act(async () => {
      botao("Conversar no WhatsApp").click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0]?.[0]).toBe("https://wa.me/5511988887777");
  });

  it("SEM internet, o botão do WhatsApp fica desligado mesmo com número bom, e clicar não abre nada", async () => {
    h.offline = true;
    await abrirFicha();

    const contato = botao("Conversar no WhatsApp");
    expect(contato.disabled).toBe(true);
    await act(async () => {
      contato.click();
    });
    expect(abrir).not.toHaveBeenCalled();
  });

  it("telefone brasileiro de 11 dígitos aparece formatado; o cadastro sem máscara não vaza para a tela", async () => {
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("(11) 98888-7777");
    expect(hospedeiro.textContent).not.toContain("11988887777");
  });

  it("telefone fixo de 10 dígitos aparece formatado", async () => {
    h.whatsapp = "1133334444";
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("(11) 3333-4444");
  });

  it("telefone estrangeiro aparece como foi cadastrado", async () => {
    h.whatsapp = "+1 202 555 0147";
    await abrirFicha();

    expect(hospedeiro.textContent).toContain("+1 202 555 0147");
  });

  it("copiar o telefone copia o cadastro (sem máscara) e avisa 'Telefone copiado'", async () => {
    await abrirFicha();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-label="Copiar telefone"]')
        ?.click();
    });

    expect(h.copiados).toEqual(["11988887777"]);
    expect(toast.success).toHaveBeenCalledWith("Telefone copiado com sucesso!");
  });

  it("copiar o e-mail copia o e-mail e avisa 'E-mail copiado'", async () => {
    await abrirFicha();
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>('[aria-label="Copiar e-mail"]')
        ?.click();
    });

    expect(h.copiados).toEqual(["prova@fixture.invalid"]);
    expect(toast.success).toHaveBeenCalledWith("E-mail copiado com sucesso!");
  });

  it("sem e-mail e sem telefone cadastrados, não há botão de copiar nada", async () => {
    h.email = null;
    h.whatsapp = null;
    await abrirFicha();

    expect(hospedeiro.querySelector('[aria-label="Copiar e-mail"]')).toBeNull();
    expect(
      hospedeiro.querySelector('[aria-label="Copiar telefone"]'),
    ).toBeNull();
  });
});
