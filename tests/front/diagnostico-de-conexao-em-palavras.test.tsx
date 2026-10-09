// @vitest-environment jsdom
//
// Painel simples, G7b (onda 4, frente A): o diagnóstico de conexão de Ajustes
// ("Minha loja está no ar?") fala em palavras. Antes: "Meça a latência (ping)
// e perda de pacotes … banco de dados do Supabase", três cartões com
// "Latência Média", "Variação (Min / Max)" e "Perda de Pacotes" e texto de
// 7,5px. Agora:
//   D1  nada de latência, ping, perda de pacotes nem Supabase na tela;
//   D2  o resultado é UMA frase: "Conexão boa", "Conexão lenta" ou "Sem
//       internet", com o que fazer;
//   D3  os milissegundos só aparecem num detalhe (`<details>`), para quem
//       quiser os números;
//   D4  nenhum texto menor que 11px e o botão de testar com alvo de 44px;
//   D5  o título "Diagnóstico de Conexão" e o disclosure continuam (contrato
//       de ajustes-disclosure-do-diagnostico).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Relógio de mentira: só a consulta do teste anda o tempo (o React também lê
// `performance.now`; um relógio que só cresce não o atrapalha).
const { relogio, consulta } = vi.hoisted(() => ({
  relogio: { agora: 1000 },
  consulta: {
    duracaoMs: 40,
    falha: false,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => {
          relogio.agora += consulta.duracaoMs;
          return Promise.resolve(
            consulta.falha
              ? { data: null, error: { message: "Failed to fetch" } }
              : { data: [{ id: "p1" }], error: null },
          );
        },
      }),
    }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Ajustes — o diagnóstico de conexão fala em palavras", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    relogio.agora = 1000;
    consulta.duracaoMs = 40;
    consulta.falha = false;
    vi.spyOn(performance, "now").mockImplementation(() => relogio.agora);
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  function botaoPorTexto(trecho: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    );
    expect(botao, `botão ausente: "${trecho}"`).toBeDefined();
    return botao as HTMLButtonElement;
  }

  /** O bloco do diagnóstico: o pai do botão "Diagnóstico de Conexão". */
  function diagnostico(): HTMLElement {
    return botaoPorTexto("Diagnóstico de Conexão").parentElement as HTMLElement;
  }

  async function abrirDiagnostico() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      botaoPorTexto("Minha loja está no ar?").click();
    });
  }

  async function testarAgora() {
    await act(async () => {
      botaoPorTexto("Testar a conexão agora").click();
    });
    // Quatro tentativas com 200 ms entre elas.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
  }

  const JARGAO = /lat[êe]ncia|\bping\b|perda de pacotes|supabase/i;

  it("D1/D5 — antes de testar: título de sempre, nada de latência, ping, pacotes ou Supabase", async () => {
    await abrirDiagnostico();

    const bloco = diagnostico();
    expect(bloco.textContent).toContain("Diagnóstico de Conexão");
    expect(bloco.textContent).not.toMatch(JARGAO);
    expect(
      botaoPorTexto("Diagnóstico de Conexão").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(bloco.textContent).toContain("Testar a conexão agora");
  });

  it("D2/D3 — loja respondendo rápido: 'Conexão boa', e os ms só no detalhe", async () => {
    consulta.duracaoMs = 40;
    await abrirDiagnostico();
    await testarAgora();

    const bloco = diagnostico();
    expect(bloco.textContent).toContain("Conexão boa");
    expect(bloco.textContent).not.toMatch(JARGAO);

    const detalhe = bloco.querySelector("details");
    expect(detalhe, "detalhe com os números ausente").not.toBeNull();
    expect(detalhe!.textContent).toContain("40 ms");
    // Fora do detalhe, nenhum número em ms.
    const foraDoDetalhe = (bloco.textContent ?? "").replace(
      detalhe!.textContent ?? "",
      "",
    );
    expect(foraDoDetalhe).not.toMatch(/\bms\b/);
  });

  it("D2 — loja demorando: 'Conexão lenta', com o que fazer", async () => {
    consulta.duracaoMs = 400;
    await abrirDiagnostico();
    await testarAgora();

    const bloco = diagnostico();
    expect(bloco.textContent).toContain("Conexão lenta");
    expect(bloco.textContent).toMatch(/outra rede|Wi-Fi|dados móveis/);
    expect(bloco.querySelector("details")?.textContent).toContain("400 ms");
  });

  it("D2 — nenhuma tentativa chegou: 'Sem internet', com o que fazer, sem número inventado", async () => {
    consulta.falha = true;
    await abrirDiagnostico();
    await testarAgora();

    const bloco = diagnostico();
    expect(bloco.textContent).toContain("Sem internet");
    expect(bloco.textContent).toMatch(/Wi-Fi|dados móveis/);
    expect(bloco.textContent).not.toMatch(JARGAO);
    expect(bloco.querySelector("details")?.textContent ?? "").not.toMatch(
      /\d+ ms/,
    );
  });

  it("D4 — nenhum texto menor que 11px e o botão de testar com alvo de 44px", async () => {
    consulta.duracaoMs = 40;
    await abrirDiagnostico();
    await testarAgora();

    const bloco = diagnostico();
    for (const tamanho of [6, 7, 8, 9, 10]) {
      expect(bloco.innerHTML).not.toContain(`text-[${tamanho}`);
    }
    expect(botaoPorTexto("Testar a conexão agora").className).toContain(
      "min-h-11",
    );
  });
});
