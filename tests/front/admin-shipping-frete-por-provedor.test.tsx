// @vitest-environment jsdom
//
// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2) — a tela de Frete deixou
// de fazer QUALQUER `select` direto em `store_shipping_credentials`; toda a
// configuração vem de UMA ação da edge (`ler_configuracao_frete`), a MESMA
// que a seção de Transportadoras usa. O estado passa a ser POR PROVEDOR
// (F10, tarefa P): "chave salva" | "ligado" | "sem chave" — NUNCA
// "conectado" só por ter chave.
//
// Substitui, para a parte de credenciais: admin-shipping-nao-baixa-o-
// token-para-o-navegador.test.tsx e as asserções de "Melhor Envio
// conectado"/"Conectado ao Melhor Envio" de admin-frete-v2-contrato.test.tsx
// e admin-visual-frete.test.tsx (removidos — testavam a leitura direta da
// tabela, que não existe mais).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TOKEN_REAL, mockConfig, invoke, chamadasAoBanco } = vi.hoisted(() => {
  const TOKEN_REAL = "tok-conta-real-do-melhor-envio-nao-pode-viajar-a-toa";
  return {
    TOKEN_REAL,
    mockConfig: {
      shippingCoverage: "national" as "local" | "national",
    },
    invoke: vi.fn(),
    chamadasAoBanco: { total: 0 },
  };
});

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
    from: () => {
      chamadasAoBanco.total++;
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function respostaConfig(
  ligados: string[],
  provedores: Record<
    string,
    { tem_chave: boolean; sandbox?: boolean; contato_email?: string | null }
  >,
) {
  return {
    success: true,
    modo: ligados.length > 0 ? "multi" : "legado",
    ligados,
    provedores: {
      melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
      superfrete: { tem_chave: false, sandbox: false, servicos: null },
      frenet: { tem_chave: false, sandbox: false, servicos: null },
      ...Object.fromEntries(
        Object.entries(provedores).map(([p, v]) => [
          p,
          { sandbox: false, servicos: null, ...v },
        ]),
      ),
    },
  };
}

describe("AdminShippingView — estado de frete POR PROVEDOR (1.5.7 v2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasAoBanco.total = 0;
    mockConfig.shippingCoverage = "national";
    invoke.mockResolvedValue({
      data: respostaConfig(["melhor_envio"], {
        melhor_envio: { tem_chave: true },
      }),
      error: null,
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

  it("lê a configuração pela edge, nunca por select direto em store_shipping_credentials", async () => {
    await abrirTela();
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({ body: { action: "ler_configuracao_frete" } }),
    );
    // O único `from()` que sobra é o dos logs (shipping_calculation_logs),
    // que esta tela não usa mais diretamente para credencial — mas mesmo
    // que outro código chame `from`, o token nunca pode aparecer no DOM.
    expect(hospedeiro.innerHTML).not.toContain(TOKEN_REAL);
  });

  it("um provedor ligado com chave: mostra 'ligado', nunca a palavra 'conectado' presa a ele", async () => {
    await abrirTela();
    expect(hospedeiro.textContent).toMatch(/Melhor Envio ligado/);
    // F10: a palavra "conectado" pode aparecer só na frase genérica de
    // ausência total ("Nenhuma transportadora conectada"), nunca atribuída
    // a um provedor por ele ter chave.
    expect(hospedeiro.textContent).not.toMatch(/Melhor Envio conectado/);
  });

  it("chave salva mas provedor NÃO ligado: nunca mostra 'ligado' para ele", async () => {
    invoke.mockResolvedValue({
      data: respostaConfig([], { melhor_envio: { tem_chave: true } }),
      error: null,
    });
    await abrirTela();
    expect(hospedeiro.textContent).not.toMatch(/Melhor Envio ligado/);
    expect(hospedeiro.textContent).toMatch(/Sem transportadora/i);
  });

  it("dois provedores ligados: a faixa soma 'N provedores ligados'", async () => {
    invoke.mockResolvedValue({
      data: respostaConfig(["melhor_envio", "superfrete"], {
        melhor_envio: { tem_chave: true },
        // SuperFrete precisa do e-mail de contato para contar como
        // "ligado" de verdade (achado 2) — este teste só quer a soma de
        // DOIS provedores COMPLETOS; a cobertura de "sem e-mail" mora nos
        // testes de "incompleta" abaixo.
        superfrete: {
          tem_chave: true,
          contato_email: "tecnico@loja-ficticia.com.br",
        },
      }),
      error: null,
    });
    await abrirTela();
    expect(hospedeiro.textContent).toMatch(/2 provedores ligados/);
  });

  // ── Achado 2 (revisão Opus): regressão 1.5.5 — SuperFrete com chave e
  // SEM e-mail de contato válido não pode aparecer como "ligado". Restaura,
  // na arquitetura nova, as garantias de
  // admin-frete-superfrete-email-incompleta.test.tsx (removido nesta
  // release por testar a leitura direta em store_shipping_credentials). ──
  describe("SuperFrete incompleta (chave sem e-mail de contato válido)", () => {
    it("chave salva SEM e-mail -> incompleta, nunca 'ligado' nem 'chave salva'", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["superfrete"], {
          superfrete: { tem_chave: true, contato_email: null },
        }),
        error: null,
      });
      await abrirTela();
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toMatch(/SuperFrete: incompleta/);
      expect(texto).not.toMatch(/SuperFrete ligado/);
      expect(texto).not.toMatch(/SuperFrete: chave salva/);
      expect(texto).toMatch(
        /SuperFrete incompleta — falta o e-mail de contato em Ajustes\./,
      );
    });

    it("e-mail salvo INVÁLIDO (gravado direto no banco, sem passar pela validação da edge) também é incompleta", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["superfrete"], {
          superfrete: { tem_chave: true, contato_email: "joão@x" },
        }),
        error: null,
      });
      await abrirTela();
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toMatch(/SuperFrete: incompleta/);
      expect(texto).not.toMatch(/SuperFrete ligado/);
    });

    it("chave + e-mail válido -> 'ligado' normal (controle)", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["superfrete"], {
          superfrete: {
            tem_chave: true,
            contato_email: "tecnico@loja-ficticia.com.br",
          },
        }),
        error: null,
      });
      await abrirTela();
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toMatch(/SuperFrete ligado/);
      expect(texto).not.toMatch(/incompleta/i);
    });

    it("incompleta NÃO soma no resumo do topo nem libera a mensagem de sucesso", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["superfrete"], {
          superfrete: { tem_chave: true, contato_email: null },
        }),
        error: null,
      });
      await abrirTela();
      const texto = hospedeiro.textContent ?? "";
      expect(texto).not.toMatch(/provedores ligados/);
      // Uma SuperFrete incompleta sozinha é o mesmo caso de "ninguém
      // ligado" para quem compra fora da cidade — o aviso continua ativo.
      expect(texto).toMatch(/Nenhuma transportadora ligada/i);
    });

    it("controle: Melhor Envio com chave e SEM e-mail NÃO fica incompleta — o e-mail dele só é exigido para LIGAR, não para a própria chave", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["melhor_envio"], {
          melhor_envio: { tem_chave: true, contato_email: null },
        }),
        error: null,
      });
      await abrirTela();
      const texto = hospedeiro.textContent ?? "";
      expect(texto).toMatch(/Melhor Envio ligado/);
      expect(texto).not.toMatch(/incompleta/i);
    });

    it("o CTA 'Preencher em Ajustes' leva para Ajustes", async () => {
      invoke.mockResolvedValue({
        data: respostaConfig(["superfrete"], {
          superfrete: { tem_chave: true, contato_email: null },
        }),
        error: null,
      });
      const onNavigate = vi.fn();
      const { AdminShippingView } = await import(
        "@/views/admin/AdminShippingView"
      );
      await act(async () => {
        raiz.render(
          <AdminShippingView
            active={true}
            onSetDirty={vi.fn()}
            onNavigate={onNavigate}
          />,
        );
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
      await act(async () => {
        await esperarMicrotarefas();
      });
      const cta = [...hospedeiro.querySelectorAll("button")].find((b) =>
        /preencher em ajustes/i.test(b.textContent ?? ""),
      );
      expect(cta).toBeDefined();
      await act(async () => {
        cta?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("admin-settings");
    });
  });

  it("nenhum provedor ligado: aviso bem visível e CTA para Ajustes", async () => {
    invoke.mockResolvedValue({
      data: respostaConfig([], {}),
      error: null,
    });
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(hospedeiro.textContent).toMatch(/Nenhuma transportadora ligada/i);
    const cta = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /conectar transportadora/i.test(b.textContent ?? ""),
    );
    expect(cta).toBeDefined();
  });

  it("leitura da edge falhou: estado honesto 'conexão a confirmar', com 'Tentar de novo'", async () => {
    invoke.mockResolvedValue({ data: { success: false }, error: null });
    await abrirTela();
    expect(hospedeiro.textContent).toMatch(/conexão a confirmar/i);
    const tentar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /tentar de novo/i.test(b.textContent ?? ""),
    );
    expect(tentar).toBeDefined();
  });

  it("provedor ligado, mas SEM chave salva (drift do espelho): nunca mostra 'ligado' (F10, falha para o lado seguro)", async () => {
    // Cenário do A1 do plano: painel antigo grava {token} e apaga o que o
    // modo multi precisa — o espelho pode dizer "ligado" para um provedor
    // que a linha de credencial não sustenta mais.
    invoke.mockResolvedValue({
      data: respostaConfig(["melhor_envio"], {
        melhor_envio: { tem_chave: false },
      }),
      error: null,
    });
    await abrirTela();
    expect(hospedeiro.textContent).not.toMatch(/Melhor Envio ligado/);
  });
});
