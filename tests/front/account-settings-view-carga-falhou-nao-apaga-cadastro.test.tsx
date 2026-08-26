// @vitest-environment jsdom
//
// CONTA-01 — salvar o perfil com a tela em branco APAGA o nome e o WhatsApp
// do cliente, e diz "sucesso".
//
// Até 26/08/2026 a carga do perfil em AccountSettingsView era
// `const { data, error } = await supabase.rpc("get_my_complete_profile");
// if (data && !error) { ... }` — sem NENHUM ramo `else`. Em falha (rede
// oscilando, RPC lenta) `profileData` ficava travado no inicial
// `{ name: "", phone: "", email: "" }`, o formulário renderizava vazio como
// se o cadastro estivesse vazio, e o botão Salvar já estava clicável
// (`disabled={loading}` era só o loading DO SALVAR, nunca o da carga).
// Clicar em Salvar mandava as duas strings vazias para
// `update_my_profile_secure`, que faz `full_name = COALESCE(p_full_name,
// full_name)` — string vazia não é NULL, o COALESCE não protege, e grava
// `''` por cima do cadastro real.
//
// Este teste prende as DUAS metades da correção:
// (A) enquanto carrega e quando a carga falha, os campos ficam desabilitados
//     e um aviso explícito aparece — nunca um formulário vazio "normal";
// (B) mesmo que a trava de UI (o `disabled` do botão) seja contornada, a
//     própria `handleUpdateProfile` se recusa a gravar porque a carga não
//     terminou — a segunda camada de defesa pedida na tarefa.
//
// Mesmo padrão de account-settings-senha-usa-o-hook-traduzido.test.tsx:
// `useAuth` mockado por inteiro, `@/lib/supabase` mockado com `rpc`
// espionável, render de verdade (react-dom/client + jsdom), `sonner`
// mockado, ResizeObserver/IntersectionObserver stubados (framer-motion).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    auth: { updateUser: vi.fn() },
    rpc,
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

function localizarBotaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AccountSettingsView — carga que falha não apaga o cadastro", () => {
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

  async function montar() {
    const { AccountSettingsView } = await import(
      "@/views/customer/AccountSettingsView"
    );
    await act(async () => {
      raiz.render(<AccountSettingsView />);
    });
  }

  it("enquanto a carga não termina: campos desabilitados, botão Salvar desabilitado, aviso de carregando visível", async () => {
    // RPC de leitura nunca resolve — simula a rede oscilando/lenta.
    rpc.mockImplementation(() => new Promise(() => {}));

    await montar();

    expect(hospedeiro.textContent).toContain("Carregando");

    const nome = document.getElementById("full_name") as HTMLInputElement;
    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(nome.disabled).toBe(true);
    expect(telefone.disabled).toBe(true);
    // Ainda vazios — mas DESABILITADOS, não um formulário editável vazio.
    expect(nome.value).toBe("");
    expect(telefone.value).toBe("");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações");
    expect(botaoSalvar).toBeTruthy();
    expect(botaoSalvar!.disabled).toBe(true);
  });

  it("quando a carga FALHA (erro na RPC): mostra aviso de falha com retry, nunca formulário vazio silencioso", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: null,
          error: { message: "Network request failed" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await montar();
    await esperarAte(() =>
      hospedeiro.textContent?.includes("carregar") ?? false,
    );

    expect(hospedeiro.textContent).toContain("Não conseguimos carregar");
    expect(hospedeiro.textContent).toContain("Tentar de novo");

    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações");
    expect(botaoSalvar!.disabled).toBe(true);

    const nome = document.getElementById("full_name") as HTMLInputElement;
    const telefone = document.getElementById("phone") as HTMLInputElement;
    expect(nome.disabled).toBe(true);
    expect(telefone.disabled).toBe(true);
  });

  it("retry (Tentar de novo) refaz a carga e, se der certo, libera o formulário com os dados reais", async () => {
    rpc.mockImplementationOnce((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: null,
          error: { message: "Network request failed" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    await montar();
    await esperarAte(() =>
      hospedeiro.textContent?.includes("Tentar de novo") ?? false,
    );

    rpc.mockImplementation((nome: string) => {
      if (nome === "get_my_complete_profile") {
        return Promise.resolve({
          data: [{ full_name: "Cliente Real", whatsapp: "34999998888" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const botaoRetry = localizarBotaoPorTexto("Tentar de novo");
    await act(async () => {
      botaoRetry!.click();
    });
    await esperarAte(() => {
      const nome = document.getElementById("full_name") as HTMLInputElement;
      return nome.value === "Cliente Real";
    });

    const nome = document.getElementById("full_name") as HTMLInputElement;
    const botaoSalvar = localizarBotaoPorTexto("Salvar Alterações");
    expect(nome.disabled).toBe(false);
    expect(botaoSalvar!.disabled).toBe(false);
  });

  // A SEGUNDA camada de defesa pedida na tarefa: mesmo que a trava de UI
  // (o atributo `disabled` do botão) seja contornada — bug futuro, extensão
  // do navegador, o que for — `handleUpdateProfile` tem que se recusar a
  // gravar dados derivados de uma carga que não terminou.
  it("defesa em profundidade: mesmo com o `disabled` do botão forçadamente removido, salvar durante a carga NÃO grava nada", async () => {
    rpc.mockImplementation(() => new Promise(() => {}));

    await montar();

    const botaoSalvar = localizarBotaoPorTexto(
      "Salvar Alterações",
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(true);

    // Contorna a trava de UI diretamente no DOM, simulando uma falha da
    // camada 1, e dispara o clique mesmo assim.
    botaoSalvar.disabled = false;
    await act(async () => {
      botaoSalvar.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A chamada de GRAVAÇÃO nunca aconteceu — só a de LEITURA (pendente).
    const chamadasDeGravacao = rpc.mock.calls.filter(
      (chamada) => chamada[0] === "update_my_profile_secure",
    );
    expect(chamadasDeGravacao).toHaveLength(0);
  });
});
