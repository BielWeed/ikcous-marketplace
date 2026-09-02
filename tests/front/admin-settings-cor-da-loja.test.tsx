// @vitest-environment jsdom
//
// Tela "Cor da loja" nos Ajustes (pedido 004, 02/09/2026): o lojista escolhe
// a cor da marca e o app grava pelo updateConfig — o MESMO caminho dos
// outros campos da tela; a vitrine inteira acompanha pelo mecanismo que já
// existia (corPrimariaEfetiva → --primary e meta theme-color). O CONTRATO
// que este arquivo prova:
//
//   1. A guarda do PRETO vale na ESCRITA: escolher #000000 é recusado com
//      mensagem honesta e NADA vai ao banco. A leitura trata preto gravado
//      como resíduo de configuração antiga (guarda de corPrimariaEfetiva,
//      src/config/cor-da-loja.ts) — gravar preto pela tela deixaria a
//      vitrine na cor padrão com o lojista achando que mudou algo.
//   2. Hex com LETRAS em maiúsculas grava NORMALIZADO em minúsculas — a
//      caixa morre na validaCorDaLoja e o canônico gravado é o que a
//      comparação exata da guarda de leitura espera.
//   3. A cor exibida é a EFETIVA (mesma regra da vitrine): sem cor no
//      banco, o campo nasce com a semente do build.
//   4. Falha de gravação não vira "salvo" (mesmo contrato ADMIN-010, #94
//      das outras seções).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { branding } from "@/config/branding";

const updateConfig = vi.fn();

// `mockConfig` precisa ser declarado via `vi.hoisted` porque `vi.mock` é
// hoisted acima dos imports -- mesmo padrão de
// admin-settings-identidade-da-loja.test.tsx.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    storeName: "Loja Teste",
    // SEM cor de propósito: a loja não escolheu — o campo nasce com a
    // semente do build (mesmo contrato que a vitrine aplica).
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

describe("AdminSettingsView — Cor da loja", () => {
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

  // A seção de cor nasce COLAPSADA (mesmo pedido do Gabriel de 02/09 que
  // esconde as outras): o teste expande antes de exercitar o formulário.
  async function abrirSecaoCor(): Promise<HTMLInputElement> {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    const cabecalho = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cor da loja"),
    ) as HTMLButtonElement;
    expect(cabecalho).toBeDefined();
    await act(async () => {
      cabecalho.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#store-color-hex",
    );
    expect(campo).toBeDefined();
    return campo!;
  }

  // jsdom + createRoot não reage a mutação direta de `value` sem passar
  // pelo onChange do React -- setter nativo + evento "input" é o jeito que
  // funciona com controlled inputs neste ambiente (mesmo padrão do teste
  // de identidade da loja).
  const setValorNativo = (elemento: HTMLInputElement, valor: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  };

  async function clicarSalvarCor() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar cor"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
  }

  it("o campo nasce com a cor efetiva — a semente do build quando a loja não escolheu", async () => {
    const campo = await abrirSecaoCor();
    expect(campo.value).toBe(branding.theme.primary);
  });

  it("escolher PRETO é recusado com mensagem honesta e NADA vai ao banco", async () => {
    const campo = await abrirSecaoCor();

    await act(async () => {
      setValorNativo(campo, "#000000");
    });
    await clicarSalvarCor();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Preto não pode ser a cor da loja"),
    );
    // A mensagem também fica no lugar (não é só toast que some): erro
    // junto ao campo, com role=alert.
    expect(hospedeiro.textContent).toContain("Preto não pode ser a cor da loja");
  });

  // Letras A-F maiúsculas são o ÚNICO jeito de exercitar a normalização de
  // caixa do contrato (cor-da-loja.ts): dígitos não têm caixa — um "#000000"
  // "em maiúsculas" é idêntico ao minúsculo e não prova nada. Sem o
  // toLowerCase(), o regex da validação recusaria #FF5733 como "formato" e
  // uma cor legítima nunca chegaria ao banco.
  it("hex com LETRAS em maiúsculas grava NORMALIZADO em minúsculas — a caixa morre na validação", async () => {
    updateConfig.mockResolvedValue(true);
    const campo = await abrirSecaoCor();

    await act(async () => {
      setValorNativo(campo, "#FF5733");
    });
    await clicarSalvarCor();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).toEqual({
      primaryColor: "#ff5733",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Cor da loja salva");
  });

  it("hex válido grava pelo updateConfig em minúsculas (canônico da guarda de leitura)", async () => {
    updateConfig.mockResolvedValue(true);
    const campo = await abrirSecaoCor();

    await act(async () => {
      setValorNativo(campo, "#059669");
    });
    await clicarSalvarCor();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0][0]).toEqual({
      primaryColor: "#059669",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Cor da loja salva");
  });

  it("formato fora de #RRGGBB é recusado antes de salvar", async () => {
    const campo = await abrirSecaoCor();

    await act(async () => {
      setValorNativo(campo, "verde");
    });
    await clicarSalvarCor();

    expect(updateConfig).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("#RRGGBB");
  });

  it("não diz que salvou quando a gravação falha", async () => {
    updateConfig.mockResolvedValue(false);
    const campo = await abrirSecaoCor();

    await act(async () => {
      setValorNativo(campo, "#059669");
    });
    await clicarSalvarCor();

    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
