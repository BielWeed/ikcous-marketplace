// @vitest-environment jsdom
//
// Promover a administrador, na folha "Gestão de Cliente" do cartão do cliente.
// Só o DONO DA LOJA vê as ações; a confirmação diz QUEM é a pessoa; o botão
// principal só aparece depois do "Cancelar" (que tem o foco ao abrir); o banco
// é chamado uma vez só mesmo com duplo clique; cada erro vira frase em
// português; o cartão reflete o novo cargo na hora.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  meuId: "dono-1" as string | null,
  donoId: "dono-1" as string | null,
  offline: false,
  rpc: vi.fn(),
  leituraDono: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
    from: (tabela: string) => ({
      select: () => ({
        maybeSingle: () => {
          h.leituraDono(tabela);
          return Promise.resolve(
            h.donoId
              ? { data: { user_id: h.donoId }, error: null }
              : { data: null, error: null },
          );
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.meuId ? { id: h.meuId } : null }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { CartaoCliente } from "@/components/admin/users/CartaoCliente";
import { limparDonoDaLoja } from "@/hooks/useDonoDaLoja";
import type { CargoDaConta } from "@/lib/cargo-da-conta";
import type { Customer } from "@/utils/admin_cache";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

function cliente(over: Partial<Customer> = {}): Customer {
  return {
    id: "cli-1",
    email: "maria.silva@exemplo.com",
    full_name: "Maria Silva",
    phone: "34999990000",
    role: "customer",
    created_at: "2026-08-01T00:00:00Z",
    orders_count: 1,
    total_spent: 10,
    ...over,
  };
}

const TITULO_PROMOVER = "Tornar administrador";
const SUBTITULO_PROMOVER =
  "Dá acesso ao painel da loja. Só o dono da loja pode fazer isso.";
const TITULO_REMOVER = "Remover acesso de administrador";
const SUBTITULO_REMOVER = "Volta a ser cliente e perde o acesso ao painel.";

describe("promover a administrador (folha do cartão)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let aoMudarCargo: ReturnType<
    typeof vi.fn<(id: string, novoCargo: CargoDaConta) => void>
  >;

  beforeEach(() => {
    h.meuId = "dono-1";
    h.donoId = "dono-1";
    h.offline = false;
    h.rpc.mockReset();
    h.leituraDono.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    limparDonoDaLoja();
    aoMudarCargo = vi.fn<(id: string, novoCargo: CargoDaConta) => void>();
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

  async function render(c: Customer, comCallback = true) {
    await act(async () => {
      raiz.render(
        <CartaoCliente
          customer={c}
          onNavigate={vi.fn()}
          onPrefetch={vi.fn()}
          onCargoMudou={comCallback ? aoMudarCargo : undefined}
        />,
      );
    });
  }

  function gatilho(): HTMLButtonElement {
    const b = hospedeiro.querySelector<HTMLButtonElement>(
      '[aria-label^="Gestão de Cliente"]',
    );
    if (!b) throw new Error("sem gatilho da folha");
    return b;
  }

  async function abrirFolha() {
    await act(async () => {
      gatilho().click();
    });
    // a leitura de dono_da_loja acontece ao abrir a folha
    await act(async () => {
      await esperar(5);
    });
  }

  const botoes = () => [...document.body.querySelectorAll("button")];
  const linha = (titulo: string) =>
    botoes().find((b) => b.textContent?.includes(titulo));
  const dialogo = () =>
    document.body.querySelector<HTMLElement>('[role="alertdialog"]');

  async function clicar(el: Element | undefined | null) {
    if (!el) throw new Error("elemento não achado");
    await act(async () => {
      (el as HTMLElement).click();
    });
    await act(async () => {
      await esperar(5);
    });
  }

  async function abrirConfirmacaoDePromover() {
    await render(cliente());
    await abrirFolha();
    await clicar(linha(TITULO_PROMOVER));
  }

  describe("quem vê as ações", () => {
    it("o dono vê 'Tornar administrador' no cartão de um cliente, com o subtítulo exato", async () => {
      await render(cliente());
      await abrirFolha();
      const b = linha(TITULO_PROMOVER);
      expect(b).toBeTruthy();
      expect(b?.textContent).toContain(SUBTITULO_PROMOVER);
      expect(linha(TITULO_REMOVER)).toBeUndefined();
      // o mesmo desenho das linhas vizinhas
      expect(b?.className).toContain("min-h-14");
      expect(b?.querySelector("svg.size-11")).toBeTruthy();
    });

    it("o dono vê 'Remover acesso de administrador' (vermelho) no cartão de um administrador", async () => {
      await render(cliente({ role: "admin" }));
      await abrirFolha();
      const b = linha(TITULO_REMOVER);
      expect(b).toBeTruthy();
      expect(b?.textContent).toContain(SUBTITULO_REMOVER);
      expect(b?.innerHTML).toContain("text-red-300");
      expect(linha(TITULO_PROMOVER)).toBeUndefined();
    });

    it("quem NÃO é o dono não vê ação nenhuma (e a folha segue funcionando)", async () => {
      h.meuId = "admin-comum";
      h.donoId = "dono-1";
      await render(cliente());
      await abrirFolha();
      expect(linha(TITULO_PROMOVER)).toBeUndefined();
      expect(linha(TITULO_REMOVER)).toBeUndefined();
      expect(linha("Ver ficha do cliente")).toBeTruthy();
    });

    it("loja sem dono cadastrado: ninguém vê as ações", async () => {
      h.donoId = null;
      await render(cliente());
      await abrirFolha();
      expect(linha(TITULO_PROMOVER)).toBeUndefined();
    });

    it("no cartão do próprio dono não há ação (nem remover)", async () => {
      await render(cliente({ id: "dono-1", role: "admin" }));
      await abrirFolha();
      expect(linha(TITULO_PROMOVER)).toBeUndefined();
      expect(linha(TITULO_REMOVER)).toBeUndefined();
    });

    it("o dono olhando o PRÓPRIO cartão como cliente (id igual ao dele): nada", async () => {
      await render(cliente({ id: "dono-1", role: "customer" }));
      await abrirFolha();
      expect(linha(TITULO_PROMOVER)).toBeUndefined();
    });

    it.each(["gerente", "vendedor"])(
      "cartão de %s: nenhuma ação (o banco só conhece admin/customer)",
      async (papel) => {
        await render(cliente({ role: papel }));
        await abrirFolha();
        expect(linha(TITULO_PROMOVER)).toBeUndefined();
        expect(linha(TITULO_REMOVER)).toBeUndefined();
      },
    );

    it("a leitura do dono acontece só ao abrir a folha (a lista não consulta por cartão)", async () => {
      await render(cliente());
      expect(h.leituraDono).not.toHaveBeenCalled();
      await abrirFolha();
      expect(h.leituraDono).toHaveBeenCalledTimes(1);
    });

    it("offline: a linha aparece mas não dispara nada", async () => {
      h.offline = true;
      await render(cliente());
      await abrirFolha();
      const b = linha(TITULO_PROMOVER) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      await clicar(b);
      expect(dialogo()).toBeNull();
    });
  });

  describe("a confirmação", () => {
    it("promover: textos exatos, quem é a pessoa, e o foco inicial em Cancelar", async () => {
      await abrirConfirmacaoDePromover();
      const d = dialogo();
      expect(d).toBeTruthy();
      const texto = d?.textContent ?? "";
      expect(texto).toContain("Dar acesso de administrador a Maria Silva?");
      expect(texto).toContain(
        "Esta pessoa vai poder ver e mudar pedidos, produtos, clientes, custos e configurações da loja.",
      );
      expect(texto).toContain(
        "Ela não poderá nomear outros administradores nem mexer em você. Você pode tirar esse acesso quando quiser.",
      );
      // sem ambiguidade entre duas "Maria": e-mail e telefone do cartão
      expect(texto).toContain("maria.silva@exemplo.com");
      expect(texto).toContain("34999990000");
      const rotulos = [...(d?.querySelectorAll("button") ?? [])].map(
        (b) => b.textContent,
      );
      expect(rotulos).toContain("Dar acesso de administrador");
      expect(rotulos).toContain("Cancelar");
      expect(document.activeElement?.textContent).toBe("Cancelar");
      // nada foi chamado só por abrir
      expect(h.rpc).not.toHaveBeenCalled();
    });

    it("sem e-mail nem telefone: só o nome, sem linha de contato", async () => {
      await render(cliente({ email: null, phone: null }));
      await abrirFolha();
      await clicar(linha(TITULO_PROMOVER));
      const d = dialogo();
      expect(d?.textContent).toContain("Maria Silva");
      expect(d?.querySelector('[data-testid="promover-quem"]')).toBeNull();
    });

    it("só o e-mail: mostra só o e-mail", async () => {
      await render(cliente({ phone: null }));
      await abrirFolha();
      await clicar(linha(TITULO_PROMOVER));
      const quem = dialogo()?.querySelector('[data-testid="promover-quem"]');
      expect(quem?.textContent).toBe("maria.silva@exemplo.com");
    });

    it("remover: textos exatos, botão vermelho 'Tirar acesso', foco em Cancelar", async () => {
      await render(cliente({ role: "admin" }));
      await abrirFolha();
      await clicar(linha(TITULO_REMOVER));
      const d = dialogo();
      const texto = d?.textContent ?? "";
      expect(texto).toContain(
        "Tirar o acesso de administrador de Maria Silva?",
      );
      expect(texto).toContain(
        "A pessoa volta a ser cliente. O acesso ao painel pode levar até cerca de 1 hora para acabar por completo no aparelho dela.",
      );
      const tirar = [...(d?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent === "Tirar acesso",
      );
      expect(tirar).toBeTruthy();
      expect(tirar?.className).toMatch(/bg-red-/);
      expect(document.activeElement?.textContent).toBe("Cancelar");
    });

    it("a folha fecha antes da confirmação (uma camada por vez) e o corpo não fica travado ao terminar", async () => {
      await abrirConfirmacaoDePromover();
      // só a confirmação está aberta
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      await clicar(
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent === "Cancelar",
        ),
      );
      expect(dialogo()).toBeNull();
      expect(document.body.style.pointerEvents).not.toBe("none");
    });

    it("Cancelar: não chama o banco, fecha e devolve o foco ao botão da folha", async () => {
      await abrirConfirmacaoDePromover();
      await clicar(
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent === "Cancelar",
        ),
      );
      expect(h.rpc).not.toHaveBeenCalled();
      expect(dialogo()).toBeNull();
      expect(document.activeElement).toBe(gatilho());
    });
  });

  describe("confirmar", () => {
    const confirmar = () =>
      [...(dialogo()?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent === "Dar acesso de administrador",
      );

    it("chama definir_cargo com p_user_id/p_cargo, avisa, atualiza o cartão e devolve o foco", async () => {
      h.rpc.mockResolvedValue({
        data: { user_id: "cli-1", de: "customer", para: "admin", mudou: true },
        error: null,
      });
      await abrirConfirmacaoDePromover();
      await clicar(confirmar());
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect(h.rpc).toHaveBeenCalledWith("definir_cargo", {
        p_user_id: "cli-1",
        p_cargo: "admin",
      });
      expect(toast.success).toHaveBeenCalledWith(
        "Maria Silva agora é administrador. Peça para essa pessoa sair e entrar de novo no app.",
      );
      expect(aoMudarCargo).toHaveBeenCalledWith("cli-1", "admin");
      expect(dialogo()).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(gatilho());
    });

    it("duplo clique chama o banco UMA vez e o botão fica desabilitado em voo", async () => {
      let liberar: (v: unknown) => void = () => {};
      h.rpc.mockReturnValue(
        new Promise((r) => {
          liberar = r;
        }),
      );
      await abrirConfirmacaoDePromover();
      const b = confirmar() as HTMLButtonElement;
      await act(async () => {
        b.click();
        b.click();
      });
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect((confirmar() as HTMLButtonElement | undefined)?.disabled).toBe(
        true,
      );
      const cancelar = [...document.querySelectorAll("button")].find(
        (x) => x.textContent === "Cancelar",
      ) as HTMLButtonElement;
      expect(cancelar.disabled).toBe(true);
      // Esc em voo não fecha a confirmação
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(dialogo()).toBeTruthy();
      await act(async () => {
        liberar({
          data: {
            user_id: "cli-1",
            de: "customer",
            para: "admin",
            mudou: true,
          },
          error: null,
        });
        await esperar(5);
      });
      expect(h.rpc).toHaveBeenCalledTimes(1);
      expect(aoMudarCargo).toHaveBeenCalledTimes(1);
    });

    it("remover: manda p_cargo=customer e o aviso fala de 'até cerca de 1 hora'", async () => {
      h.rpc.mockResolvedValue({
        data: { user_id: "cli-1", de: "admin", para: "customer", mudou: true },
        error: null,
      });
      await render(cliente({ role: "admin" }));
      await abrirFolha();
      await clicar(linha(TITULO_REMOVER));
      await clicar(
        [...(dialogo()?.querySelectorAll("button") ?? [])].find(
          (b) => b.textContent === "Tirar acesso",
        ),
      );
      expect(h.rpc).toHaveBeenCalledWith("definir_cargo", {
        p_user_id: "cli-1",
        p_cargo: "customer",
      });
      expect(toast.success).toHaveBeenCalledWith(
        "Maria Silva voltou a ser cliente. O acesso ao painel pode levar até cerca de 1 hora para acabar por completo.",
      );
      expect(aoMudarCargo).toHaveBeenCalledWith("cli-1", "customer");
    });

    it.each([
      [
        "42501",
        "Acesso negado: só o dono da loja define cargos.",
        "Acesso negado: só o dono da loja define cargos.",
      ],
      [
        "22023",
        "Cargo inválido: informe a pessoa e use admin ou customer.",
        "Cargo inválido: informe a pessoa e use admin ou customer.",
      ],
      ["P0002", "Pessoa não encontrada.", "Pessoa não encontrada."],
      [
        "PGRST202",
        "Could not find the function public.definir_cargo",
        "Esta função ainda não está ativa nesta loja.",
      ],
      [
        "42501",
        "O cargo não foi gravado: confira se o dono é administrador nas duas fontes (auth.users e profiles).",
        "O cadastro do dono da loja está incompleto. Fale com o suporte para acertar.",
      ],
    ])(
      "erro %s vira toast.error em português, sem mudar o cartão",
      async (codigo, msg, esperado) => {
        h.rpc.mockResolvedValue({
          data: null,
          error: { code: codigo, message: msg },
        });
        await abrirConfirmacaoDePromover();
        await clicar(confirmar());
        expect(toast.error).toHaveBeenCalledWith(esperado);
        expect(toast.success).not.toHaveBeenCalled();
        expect(aoMudarCargo).not.toHaveBeenCalled();
        expect(dialogo()).toBeNull();
      },
    );

    it("rede caiu (a chamada lança): mensagem de rede, sem quebrar a tela", async () => {
      h.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
      await abrirConfirmacaoDePromover();
      await clicar(confirmar());
      expect(toast.error).toHaveBeenCalledWith(
        "Sem conexão com a internet. Confira a rede e tente de novo.",
      );
      expect(aoMudarCargo).not.toHaveBeenCalled();
    });

    it("depois de um erro dá para tentar de novo (a trava de duplo clique é solta)", async () => {
      h.rpc.mockResolvedValueOnce({
        data: null,
        error: { code: "P0002", message: "Pessoa não encontrada." },
      });
      await abrirConfirmacaoDePromover();
      await clicar(confirmar());
      h.rpc.mockResolvedValueOnce({
        data: { user_id: "cli-1", de: "customer", para: "admin", mudou: true },
        error: null,
      });
      await abrirFolha();
      await clicar(linha(TITULO_PROMOVER));
      await clicar(confirmar());
      expect(h.rpc).toHaveBeenCalledTimes(2);
      expect(aoMudarCargo).toHaveBeenCalledTimes(1);
    });

    it("sem a prop onCargoMudou o cartão funciona como hoje (sem quebrar)", async () => {
      h.rpc.mockResolvedValue({
        data: { user_id: "cli-1", de: "customer", para: "admin", mudou: true },
        error: null,
      });
      await render(cliente(), false);
      await abrirFolha();
      await clicar(linha(TITULO_PROMOVER));
      await clicar(confirmar());
      expect(toast.success).toHaveBeenCalledTimes(1);
    });
  });

  describe("linguagem", () => {
    it("a palavra 'administradora' não aparece em lugar nenhum da folha nem da confirmação", async () => {
      await render(cliente());
      await abrirFolha();
      expect(document.body.textContent).not.toMatch(/administradora/i);
      await clicar(linha(TITULO_PROMOVER));
      expect(document.body.textContent).not.toMatch(/administradora/i);
    });
  });
});
