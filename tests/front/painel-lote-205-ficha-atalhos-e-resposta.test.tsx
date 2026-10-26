// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function fonte(caminho: string) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repositório, teste de texto-fonte
  return readFileSync(caminho, "utf-8");
}

describe("ficha do cliente — id que não existe", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("mostra 'Cliente não encontrado' com Voltar, sem ficha fantasma", async () => {
    mocks.rpc.mockResolvedValue({
      data: { profile: null, orders: [], addresses: [], cart_items: [] },
      error: null,
    });
    const onBack = vi.fn();
    const { AdminUserDetailView } = await import(
      "@/views/admin/AdminUserDetailView"
    );
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="id-que-nao-existe"
          onBack={onBack}
          onNavigate={vi.fn()}
        />,
      );
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cliente não encontrado");
    expect(texto).not.toContain("Usuário Não-Nomeado");
    expect(texto).not.toContain("N/A");
    const voltar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Voltar",
    );
    expect(voltar).toBeDefined();
    await act(async () => voltar?.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("lote 205 — texto-fonte", () => {
  it("botões de remover item e limpar carrinho: vermelho que existe e alvo de 44 px", () => {
    const ficha = fonte("src/views/admin/AdminUserDetailView.tsx");
    expect(ficha).not.toContain("rose-650");
    expect(
      ficha.match(/min-h-11 rounded-xl border-0 bg-red-600/g),
    ).toHaveLength(2);
  });

  it("atalho Ctrl+Alt+letra avisa com o nome do painel em português", () => {
    const app = fonte("src/App.tsx");
    expect(app).not.toContain("Navegando para o painel de");
    expect(app).toContain("NOMES_DO_PAINEL[targetView]");
  });

  it("data do último pedido do cartão do cliente usa pt-BR", () => {
    const cartao = fonte("src/components/admin/users/CartaoCliente.tsx");
    expect(cartao).not.toContain("toLocaleDateString()");
  });

  it("resposta de pergunta não apaga o que está entre < e >", () => {
    const qa = fonte("src/views/admin/AdminQAView.tsx");
    expect(qa).not.toContain('.replace(/<[^>]*>/g, "")');
  });
});
