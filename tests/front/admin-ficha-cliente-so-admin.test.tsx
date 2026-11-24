// @vitest-environment jsdom
//
// A ficha do cliente (nome, e-mail, WhatsApp, pedidos, endereços, carrinho) só
// existe para quem é administrador DE AGORA. Quem barra de verdade é o banco
// (RLS e a RPC de admin); a tela é a segunda trava: sem `isAdmin` ela não pede
// nada ao banco, não desenha nada e devolve a pessoa com "Acesso negado".
//
// Teste de MUTAÇÃO (24/11/2026): apagar qualquer uma destas guardas de
// `AdminUserDetailView` não derrubava teste algum, porque todos os vizinhos
// montam a ficha com `isAdmin: true`. Cada caso abaixo cai se UMA guarda sumir:
//   - `fetchUserData` sem `if (!isAdmin) return` -> a RPC da ficha é chamada
//   - `carregarVoz` sem `if (!isAdmin) return` -> as avaliações são consultadas
//   - o efeito do "Acesso negado" apagado -> ninguém volta, nenhum aviso
//   - `if (!isAdmin) return null` apagado -> o esqueleto/cabeçalho aparece
// E o caso da borda: o administrador abre a ficha (dados na tela) e é
// rebaixado com ela aberta — o dado do cliente some da tela na hora.
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
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

const { auth, rpcFalso, fromFalso } = vi.hoisted(() => ({
  auth: {
    atual: { isAdmin: true, user: { id: "admin-1" } } as {
      isAdmin: boolean;
      user: { id: string } | null;
    },
  },
  rpcFalso: vi.fn(),
  fromFalso: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => auth.atual,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcFalso, from: fromFalso },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOME_DO_CLIENTE = "Cliente Sigilosa da Prova";
const EMAIL_DO_CLIENTE = "sigilo@exemplo.com";

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminUserDetailView — a ficha do cliente é só de administrador", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;
  const aoVoltar = vi.fn();

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    auth.atual = { isAdmin: true, user: { id: "admin-1" } };
    rpcFalso.mockImplementation(() =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: NOME_DO_CLIENTE,
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: EMAIL_DO_CLIENTE,
            whatsapp: "34999999999",
          },
          orders: [],
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    );
    // Cadeia que serve às consultas da ficha (`.select().in()`, as avaliações e
    // perguntas com `.select().eq().order()`), todas resolvendo "sem linhas".
    fromFalso.mockImplementation(() => {
      const vazio = { data: [], error: null };
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        in: () => Promise.resolve(vazio),
        eq: () => cadeia,
        order: () => Promise.resolve(vazio),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
      return cadeia;
    });
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

  async function desenhar() {
    const AdminUserDetailView = TelaFicha;
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={aoVoltar}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  async function avisosDeErro(): Promise<unknown[][]> {
    const { toast } = await import("sonner");
    return vi.mocked(toast.error).mock.calls;
  }

  it("CONTROLE: o administrador abre a ficha, o banco é consultado e o cliente aparece", async () => {
    await desenhar();

    expect(rpcFalso).toHaveBeenCalled();
    expect(texto()).toContain(NOME_DO_CLIENTE);
    expect(aoVoltar).not.toHaveBeenCalled();
    expect(await avisosDeErro()).not.toContainEqual(["Acesso negado"]);
  });

  it.each([
    [
      "conta comum (não é admin)",
      { isAdmin: false, user: { id: "cliente-9" } },
    ],
    ["sem conta nenhuma", { isAdmin: false, user: null }],
  ])(
    "%s: nada é pedido ao banco, nada do cliente é desenhado e a pessoa é devolvida com 'Acesso negado'",
    async (_nome, quem) => {
      auth.atual = quem;

      await desenhar();

      // Nem a ficha (rpc) nem as avaliações/perguntas (from) são consultadas.
      expect(rpcFalso).not.toHaveBeenCalled();
      expect(fromFalso).not.toHaveBeenCalled();
      // Nada na tela: nem o esqueleto da ficha, e claro nenhum dado do cliente.
      expect(hospedeiro.innerHTML).toBe("");
      expect(texto()).not.toContain(NOME_DO_CLIENTE);
      expect(texto()).not.toContain(EMAIL_DO_CLIENTE);
      // E a pessoa não fica presa numa tela vazia.
      expect(await avisosDeErro()).toContainEqual(["Acesso negado"]);
      expect(aoVoltar).toHaveBeenCalledTimes(1);
    },
  );

  it("rebaixada com a ficha aberta: o dado do cliente some da tela na hora e a pessoa é devolvida", async () => {
    await desenhar();
    expect(texto()).toContain(NOME_DO_CLIENTE);
    expect(aoVoltar).not.toHaveBeenCalled();

    // O servidor passou a dizer que ela não é mais administradora.
    auth.atual = { isAdmin: false, user: { id: "admin-1" } };
    await desenhar();

    expect(texto()).not.toContain(NOME_DO_CLIENTE);
    expect(texto()).not.toContain(EMAIL_DO_CLIENTE);
    expect(hospedeiro.innerHTML).toBe("");
    expect(await avisosDeErro()).toContainEqual(["Acesso negado"]);
    expect(aoVoltar).toHaveBeenCalledTimes(1);
  });
});
