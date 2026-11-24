// @vitest-environment jsdom
//
// Caça por mutação no cartão do cliente da lista do painel (24/11/2026).
// Estas regras podiam ser quebradas sem que nenhum teste caísse:
//   - o código curto da conta (`#` + 8 primeiros caracteres, em caixa alta);
//   - "Total já comprado" sempre com centavos, e zero quando o dado falta;
//   - "Pedidos" com separador de milhar e zero quando o dado falta;
//   - "Sem compras ainda" só para quem nunca comprou;
//   - o cartão abre a ficha com Enter e Espaço, mas só quando o foco é do
//     próprio cartão (Enter num botão de dentro não pode abrir a ficha);
//   - os atalhos da folha "Gestão de Cliente" levam ao cliente certo;
//   - o raio de "avisos ativos" aparece só para quem tem aviso ativo.
// Só fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        maybeSingle: () =>
          Promise.resolve({ data: { user_id: "dono-da-loja" }, error: null }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "outra-pessoa" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import type { View } from "@/types";
import type { Customer } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cliente(sobrescreve: Partial<Customer> = {}): Customer {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    full_name: "Maria Souza",
    email: "maria@fixture.invalid",
    phone: null,
    role: "customer",
    created_at: "2026-02-07T12:00:00Z",
    orders_count: 2,
    total_spent: 150,
    ...sobrescreve,
  };
}

describe("CartaoCliente — números, teclado e atalhos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: View, id?: string) => void>>;

  beforeEach(() => {
    onNavigate = vi.fn<(view: View, id?: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.removeAttribute("style");
    document.body.className = "";
  });

  async function mostrar(c: Customer, detalhado = true) {
    await act(async () => {
      raiz.render(
        <CartaoCliente
          customer={c}
          detalhado={detalhado}
          onNavigate={onNavigate}
          onPrefetch={vi.fn()}
        />,
      );
    });
    return hospedeiro.textContent ?? "";
  }

  const cartao = () =>
    hospedeiro.querySelector<HTMLElement>('[role="button"][tabindex="0"]');

  async function teclar(alvo: Element, key: string) {
    await act(async () => {
      alvo.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  }

  it("mostra o código curto da conta: # + 8 primeiros caracteres em caixa alta", async () => {
    await mostrar(cliente());
    const codigo = [...hospedeiro.querySelectorAll("span")].find((s) =>
      (s.textContent ?? "").startsWith("#"),
    );
    expect(codigo?.textContent).toBe("#ABCDEF12");
  });

  it("o total já comprado sempre mostra os centavos e o separador de milhar", async () => {
    expect(await mostrar(cliente({ total_spent: 1234.5 }))).toContain(
      "R$ 1.234,50",
    );
    expect(await mostrar(cliente({ total_spent: 150 }))).toContain("R$ 150,00");
  });

  it.each([null, undefined])(
    "total já comprado ausente (%s) aparece como R$ 0,00 e não como 'NaN' ou vazio",
    async (ausente) => {
      const texto = await mostrar(
        cliente({ total_spent: ausente as unknown as number }),
      );
      expect(texto).toContain("R$ 0,00");
      expect(texto).not.toContain("NaN");
    },
  );

  it("pedidos usa separador de milhar", async () => {
    expect(await mostrar(cliente({ orders_count: 1234 }))).toContain(
      "Pedidos1.234",
    );
  });

  it.each([null, undefined])(
    "contagem de pedidos ausente (%s) aparece como 0",
    async (ausente) => {
      const texto = await mostrar(
        cliente({ orders_count: ausente as unknown as number }),
      );
      expect(texto).toContain("Pedidos0");
    },
  );

  it("'Sem compras ainda' só aparece para quem nunca comprou", async () => {
    expect(await mostrar(cliente({ orders_count: 0 }))).toContain(
      "Sem compras ainda",
    );
    expect(await mostrar(cliente({ orders_count: 3 }))).not.toContain(
      "Sem compras ainda",
    );
  });

  it("clicar no cartão abre a ficha DESTE cliente", async () => {
    await mostrar(cliente());
    await act(async () => {
      cartao()?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(
      "admin-user-detail",
      "abcdef12-3456-7890-abcd-ef1234567890",
    );
  });

  it.each(["Enter", " "])(
    "a tecla %j no cartão abre a ficha",
    async (tecla) => {
      await mostrar(cliente());
      const alvo = cartao();
      if (!alvo) throw new Error("Cartão não encontrado");
      await teclar(alvo, tecla);
      expect(onNavigate).toHaveBeenCalledWith(
        "admin-user-detail",
        "abcdef12-3456-7890-abcd-ef1234567890",
      );
    },
  );

  it("outra tecla não abre a ficha", async () => {
    await mostrar(cliente());
    const alvo = cartao();
    if (!alvo) throw new Error("Cartão não encontrado");
    await teclar(alvo, "a");
    await teclar(alvo, "Tab");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("Enter no botão de gestão de dentro do cartão NÃO abre a ficha (o foco não é do cartão)", async () => {
    await mostrar(cliente());
    const gestao = hospedeiro.querySelector(
      '[aria-label^="Gestão de Cliente"]',
    );
    if (!gestao) throw new Error("Botão de gestão não encontrado");
    await teclar(gestao, "Enter");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("abrir o menu de gestão não abre a ficha por tabela", async () => {
    await mostrar(cliente());
    const gestao = hospedeiro.querySelector<HTMLElement>(
      '[aria-label^="Gestão de Cliente"]',
    );
    await act(async () => {
      gestao?.click();
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Ver ficha do cliente");
  });

  async function abrirMenuE(texto: string) {
    const gestao = hospedeiro.querySelector<HTMLElement>(
      '[aria-label^="Gestão de Cliente"]',
    );
    await act(async () => {
      gestao?.click();
    });
    const atalho = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    );
    if (!atalho) throw new Error(`Atalho "${texto}" não está no menu`);
    await act(async () => {
      atalho.click();
    });
  }

  it("o atalho 'Ver ficha do cliente' abre a ficha do cliente do cartão", async () => {
    await mostrar(cliente());
    await abrirMenuE("Ver ficha do cliente");
    expect(onNavigate).toHaveBeenCalledWith(
      "admin-user-detail",
      "abcdef12-3456-7890-abcd-ef1234567890",
    );
  });

  it("o atalho 'Notificação Push' abre o aviso já com ESTE cliente escolhido", async () => {
    await mostrar(cliente());
    await abrirMenuE("Notificação Push");
    expect(onNavigate).toHaveBeenCalledWith(
      "admin-push",
      "abcdef12-3456-7890-abcd-ef1234567890",
    );
  });

  it("com aviso ativo: aparece o raio e o menu diz 'Avisos ativos.'", async () => {
    await mostrar(cliente({ is_push_subscribed: true }));
    expect(
      hospedeiro.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toBe("Avisos ativos");
    const gestao = hospedeiro.querySelector<HTMLElement>(
      '[aria-label^="Gestão de Cliente"]',
    );
    await act(async () => {
      gestao?.click();
    });
    expect(document.body.textContent).toContain("Avisos ativos.");
    expect(document.body.textContent).not.toContain("Sem avisos ativos");
  });

  it("sem aviso ativo: não aparece o raio e o menu avisa que o push continua disponível", async () => {
    await mostrar(cliente({ is_push_subscribed: false }));
    expect(hospedeiro.querySelector('[role="img"]')).toBeNull();
    const gestao = hospedeiro.querySelector<HTMLElement>(
      '[aria-label^="Gestão de Cliente"]',
    );
    await act(async () => {
      gestao?.click();
    });
    expect(document.body.textContent).toContain(
      "Sem avisos ativos. Notificação Push continua disponível.",
    );
  });
});
