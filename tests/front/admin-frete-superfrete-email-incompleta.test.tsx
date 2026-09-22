// @vitest-environment jsdom
//
// RELEASE 1.5.5 — tela de Frete: SuperFrete SEM o e-mail de contato técnico
// (ou sem a chave) é INCOMPLETA, não "chave salva".
//
// Desde a 1.5.5 a edge monta o User-Agent da SuperFrete com o e-mail que a
// lojista salvou em Ajustes > Transportadoras; sem ele, nenhuma cotação de
// fora da cidade sai. A tela de Frete, que só LÊ a credencial, precisa dizer
// isso — o que falta e onde preencher — sem citar variável de ambiente. O
// Melhor Envio e a Frenet ficam exatamente como estavam.
//
// A leitura do e-mail é por ALIAS (`contato:credentials->>contact_email`):
// o navegador recebe só o e-mail, nunca a coluna `credentials` nem o token.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TOKEN, mockConfig, banco } = vi.hoisted(() => ({
  TOKEN: "tok-conta-real-FICTICIO-nao-pode-viajar",
  mockConfig: {
    shippingProvider: "superfrete" as
      | "flat_fee"
      | "melhor_envio"
      | "frenet"
      | "superfrete",
    shippingCoverage: "national" as "local" | "national",
  },
  banco: {
    linhas: [] as Array<{
      provider: string;
      credentials: Record<string, unknown>;
    }>,
    colunasPedidas: [] as string[],
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "store_shipping_credentials") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      type Linha = (typeof banco.linhas)[number];
      const campo = (l: Linha, coluna: string) => {
        if (coluna === "provider") return l.provider;
        const m = /^credentials->>(\w+)$/.exec(coluna);
        if (!m) return undefined;
        const v = l.credentials?.[m[1]];
        return v == null ? null : String(v);
      };
      const projetar = (colunas: string, l: Linha) => {
        const saida: Record<string, unknown> = {};
        for (const c of colunas.split(",").map((x) => x.trim())) {
          if (c === "provider") saida.provider = l.provider;
          const alias = /^(\w+):credentials->>(\w+)$/.exec(c);
          if (alias) {
            const v = l.credentials?.[alias[2]];
            saida[alias[1]] = v == null ? null : String(v);
          } else if (c === "*" || c.includes("credentials")) {
            saida.credentials = l.credentials;
          }
        }
        return saida;
      };
      const consulta = (colunas: string, linhas: Linha[]): any =>
        Object.assign(
          Promise.resolve({
            data: linhas.map((l) => projetar(colunas, l)),
            error: null,
          }),
          {
            not: (coluna: string, _op: string, _v: unknown) =>
              consulta(
                colunas,
                linhas.filter((l) => campo(l, coluna) != null),
              ),
            neq: (coluna: string, valor: unknown) =>
              consulta(
                colunas,
                linhas.filter((l) => campo(l, coluna) !== valor),
              ),
            eq: (coluna: string, valor: unknown) =>
              consulta(
                colunas,
                linhas.filter((l) => campo(l, coluna) === valor),
              ),
          },
        );
      return {
        select: (colunas: string) => {
          banco.colunasPedidas.push(colunas);
          return consulta(colunas, banco.linhas);
        },
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — SuperFrete sem e-mail de contato é incompleta (1.5.5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.shippingProvider = "superfrete";
    mockConfig.shippingCoverage = "national";
    banco.linhas = [];
    banco.colunasPedidas = [];
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
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("chave salva SEM e-mail -> incompleta, dizendo o que falta e onde preencher; nunca 'chave salva' nem 'conectado'", async () => {
    banco.linhas = [
      { provider: "superfrete", credentials: { token: TOKEN, sandbox: false } },
    ];
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/chave salva/i);
    expect(texto).not.toMatch(/SuperFrete conectado/i);
    expect(texto).toMatch(/incompleta/i);
    expect(texto).toMatch(/e-mail de contato técnico/i);
    expect(texto).toContain("Ajustes > Transportadoras");
    expect(texto).not.toContain("SUPERFRETE_USER_AGENT");
    expect(hospedeiro.innerHTML).not.toContain(TOKEN);
  });

  it("e-mail salvo INVÁLIDO (gravado direto no banco) também é incompleta", async () => {
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN, contact_email: "joão@x.com" },
      },
    ];
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/chave salva/i);
    expect(texto).toMatch(/incompleta/i);
  });

  it("e-mail salvo mas SEM chave -> desconectada, pedindo para conectar em Ajustes", async () => {
    banco.linhas = [
      { provider: "superfrete", credentials: { contact_email: "loja@ex.com" } },
    ];
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toMatch(/chave salva/i);
    expect(texto).toMatch(/conecte o SuperFrete em Ajustes/);
    expect(texto).not.toContain("SUPERFRETE_USER_AGENT");
  });

  it("chave + e-mail -> continua 'chave salva' (o Testar em Ajustes é quem prova)", async () => {
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN, contact_email: "loja@ex.com" },
      },
    ];
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/chave salva/i);
    expect(texto).not.toMatch(/incompleta/i);
    expect(texto).not.toMatch(/SuperFrete conectado/i);
  });

  it("a leitura nunca pede a coluna credentials inteira nem o token — só o e-mail por alias", async () => {
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN, contact_email: "loja@ex.com" },
      },
    ];
    await abrirTela();
    expect(banco.colunasPedidas.length).toBeGreaterThan(0);
    for (const colunas of banco.colunasPedidas) {
      expect(colunas).not.toMatch(/\*/);
      expect(colunas).not.toMatch(/token/);
      expect(
        colunas.replace(/\w+:credentials->>contact_email/g, ""),
      ).not.toMatch(/credentials/);
    }
    expect(hospedeiro.innerHTML).not.toContain(TOKEN);
  });

  it("controle: Melhor Envio com token continua 'conectado', sem pergunta de e-mail", async () => {
    mockConfig.shippingProvider = "melhor_envio";
    banco.linhas = [
      { provider: "melhor_envio", credentials: { token: TOKEN } },
    ];
    await abrirTela();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/Melhor Envio conectado/);
    expect(texto).toContain(
      "Conectado ao Melhor Envio — PAC e SEDEX com preço real, na hora.",
    );
    expect(texto).not.toMatch(/incompleta/i);
    expect(texto).not.toMatch(/e-mail/i);
    // O ME não pergunta nada do e-mail ao banco.
    expect(banco.colunasPedidas.some((c) => c.includes("contact_email"))).toBe(
      false,
    );
  });
});
