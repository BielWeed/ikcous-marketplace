// @vitest-environment jsdom
//
// Tarefa 3 do plano "o app para de inventar endereço": a tela de Ajustes
// tinha exatamente dois blocos -- um medidor de latência de rede e um guia
// de ajuda -- e nenhuma configuração de loja. Este teste prova o cartão
// "Localização da Loja" que passa a existir ali: mostra o que já está
// salvo, grava o que a pessoa digitar, e não finge sucesso quando a
// gravação falha.
//
// O campo "Nome da loja" NÃO entra: `storeName` não tem nenhum consumidor
// do lado do cliente (git grep confirma) -- nenhuma tela exibe o nome da
// loja para quem compra, que continua vindo de `branding.appName`. Um
// campo que grava e nunca aparece é a mesma classe de defeito que o commit
// 06176a1 deste branch já matou: a tela promete o que o app não faz.
//
// O terceiro caso é o mais importante: o defeito de "dizer salvo sem salvar"
// foi corrigido no PR #225 (ADMIN-010, #94) em outros formulários -- o botão
// de salvar tem de olhar o retorno de `updateConfig` (`Promise<boolean>`) e
// só comemorar quando ele for `true`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();

// `mockConfig` precisa ser declarado via `vi.hoisted` porque `vi.mock` é
// hoisted acima dos imports -- mesmo padrão de checkout-guest-cep.test.tsx.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeCity: "Uberlândia",
    storeState: "MG",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// AdminSettingsView importa `@/lib/supabase` direto (usado só pelo
// diagnóstico de conexão, num botão que nenhum caso deste arquivo clica) --
// sem o dublê o import tentaria criar um client de verdade em jsdom.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminSettingsView — Identidade da Loja", () => {
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
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function pegarCampo(id: string): HTMLInputElement {
    const campo = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    expect(campo).toBeDefined();
    return campo;
  }

  function pegarBotaoSalvar(): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    return botao;
  }

  it("mostra os campos de cidade e estado preenchidos com o que está salvo", async () => {
    await abrirTela();

    expect(pegarCampo("store-city").value).toBe("Uberlândia");
    expect(pegarCampo("store-state").value).toBe("MG");
  });

  it("não mostra campo de nome da loja, nem afirma que o nome aparece para quem compra", async () => {
    await abrirTela();

    expect(hospedeiro.querySelector("#store-name")).toBeNull();
    // "Nome" só aparecia neste cartão pelo rótulo do campo e pela frase de
    // ajuda -- os dois saíram junto com o campo. Uma correção parcial que
    // tirasse só o `<input>` e deixasse a frase mentindo não passa aqui.
    expect(hospedeiro.textContent).not.toMatch(/nome/i);
  });

  it("grava os dois campos quando a pessoa salva", async () => {
    updateConfig.mockResolvedValue(true);
    await abrirTela();

    const cidade = pegarCampo("store-city");
    const estado = pegarCampo("store-state");

    // jsdom + createRoot não reage a mutação direta de `value` sem passar
    // pelo onChange do React -- disparar via setter nativo + evento "input"
    // é o jeito que funciona com controlled inputs neste ambiente.
    const setValorNativo = (elemento: HTMLInputElement, valor: string) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(elemento, valor);
      elemento.dispatchEvent(new Event("input", { bubbles: true }));
    };

    await act(async () => {
      setValorNativo(cidade, "Patos de Minas");
      setValorNativo(estado, "mg");
    });

    const botao = pegarBotaoSalvar();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const [payload] = updateConfig.mock.calls[0];
    expect(payload.storeCity).toBe("Patos de Minas");
    // Estado sempre em maiúscula, independente do que foi digitado.
    expect(payload.storeState).toBe("MG");
    // Sem campo de nome na tela, a gravação não pode mais carregar
    // `storeName` -- nem vazio, nem `null`.
    expect(payload.storeName).toBeUndefined();
  });

  it("não diz que salvou quando a gravação falha", async () => {
    updateConfig.mockResolvedValue(false);
    await abrirTela();

    const botao = pegarBotaoSalvar();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
