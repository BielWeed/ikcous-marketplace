// @vitest-environment jsdom
//
// A DIVISÃO DE TERRITÓRIO da frente glm-visual-admin-0209, mantida pela
// frente frete-v2-0309 (03/09/2026 — a tela de Frete foi redesenhada, a
// divisão NÃO mudou):
//
//   Tela de FRETE (AdminShippingView) ── dona das REGRAS:
//     presets de frete grátis, CEP de origem, cobertura, entrega local.
//   Ajustes > TRANSPORTADORAS (TransportadorasSection) ── dona da API:
//     `shippingProvider`, `enabledShippingMethods`, credenciais, teste.
//   Ajustes > HISTÓRICO (HistoricoCotacoesSection) ── dona do diagnóstico.
//
// Este arquivo prende a divisão em si, porque a regressão mais barata de
// escrever é a sutil: uma tela "ajudando" a outra e gravando campo alheio.
// Salvar Frete enviando `shippingProvider` de novo revertia a escolha salva
// em Ajustes por um valor velho de formulário — sem erro nenhum, com toast
// verde dos dois lados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaLoja, estadoDoBanco, updateConfig, invoke } = vi.hoisted(
  () => ({
    estadoDaLoja: {
      atual: {
        freeShippingMin: 100,
        shippingCoverage: "national" as "local" | "national",
        originCep: "38400-000",
        enabledShippingMethods: ["sedex", "pac"] as string[],
        localDeliveryFee: 10,
        localCepRange: "",
      },
    },
    estadoDoBanco: {
      credenciais: [
        {
          provider: "melhor_envio",
          credentials: { token: "tok-salvo", sandbox: false },
        },
      ] as any[],
    },
    updateConfig: vi.fn(),
    invoke: vi.fn(),
  }),
);

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2): a leitura de
// credenciais deixou de ser PostgREST em `store_shipping_credentials` — é a
// ação `ler_configuracao_frete` da edge. O `estadoDoBanco.credenciais`
// virou a fonte dessa resposta em vez de linhas de tabela.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    functions: {
      invoke: (nome: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          const linhaME = estadoDoBanco.credenciais.find(
            (l) => l.provider === "melhor_envio",
          );
          return Promise.resolve({
            data: {
              success: true,
              modo: "legado",
              ligados: linhaME?.credentials?.token ? ["melhor_envio"] : [],
              provedores: {
                melhor_envio: {
                  tem_chave: Boolean(linhaME?.credentials?.token),
                  sandbox: Boolean(linhaME?.credentials?.sandbox),
                  servicos: null,
                },
                superfrete: {
                  tem_chave: false,
                  sandbox: false,
                  servicos: null,
                },
                frenet: { tem_chave: false, sandbox: false, servicos: null },
              },
            },
            error: null,
          });
        }
        return invoke(nome, opcoes);
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function digitarNoCampo(
  campo: HTMLInputElement,
  texto: string,
): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

describe("A divisão Frete (regras) × Ajustes (transportadoras)", () => {
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

  it("Salvar a tela de Frete NÃO envia transportadora, serviços nem a taxa fixa morta (campo alheio reverteria a escolha salva)", async () => {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Torna o formulário sujo (senão o botão nem habilita).
    const campoCep = hospedeiro.querySelector(
      "#origin-cep",
    ) as HTMLInputElement;
    await digitarNoCampo(campoCep, "11111000");

    const botaoSalvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salvar"),
    ) as HTMLButtonElement;
    expect(botaoSalvar.disabled).toBe(false);
    await act(async () => {
      botaoSalvar.click();
      await esperarMicrotarefas();
    });

    expect(updateConfig).toHaveBeenCalledTimes(1);
    const payload = updateConfig.mock.calls[0][0];
    expect(payload).toHaveProperty("originCep", "11111-000");
    // O coração do teste: estes campos são DA SEÇÃO DE TRANSPORTADORAS.
    expect(payload).not.toHaveProperty("shippingProvider");
    expect(payload).not.toHaveProperty("enabledShippingMethods");
    // A taxa fixa morreu na frete-v2 (o campo fica órfão no banco de
    // propósito) — o save da tela nova também não a ressuscita.
    expect(payload).not.toHaveProperty("shippingFee");
  });

  it("a tela de Frete não tem mais token nem histórico, e o atalho leva a Ajustes", async () => {
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

    // As chaves mudaram de casa: nada de campo de senha nesta tela.
    expect(hospedeiro.querySelector('input[type="password"]')).toBeNull();
    // O histórico também: nada de tabela de cotações.
    expect(hospedeiro.querySelector("table")).toBeNull();

    // O bloco de frete nacional sempre oferece o caminho curto para lá.
    const botaoAjustes = [...hospedeiro.querySelectorAll("button")].find((b) =>
      /abrir ajustes/i.test(b.textContent || ""),
    ) as HTMLButtonElement;
    expect(botaoAjustes).toBeDefined();

    await act(async () => {
      botaoAjustes.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  // RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2): os dois testes que
  // viviam aqui — "Salvar a seção Transportadoras grava a escolha no
  // config..." e "updateConfig recusando PARA o fluxo..." — foram
  // REMOVIDOS. Eles provavam que TransportadorasSection ligava um chip de
  // serviço (ex.: "jadlog") e salvava via `updateConfig({shippingProvider,
  // enabledShippingMethods})`. Esse desenho morreu: a seção não chama mais
  // `updateConfig` para NADA — ela lê e grava só pela edge
  // (`ler_configuracao_frete`/`save_credentials`/`save_active_providers`),
  // e os "serviços" viraram a lista real da conta (`list_services`), sem
  // chip sintético. A cobertura equivalente vive em
  // transportadoras-por-provedor-e-ligados.test.tsx ("salvar a chave do
  // Melhor Envio NÃO liga nada sozinho: só save_credentials é chamado") e em
  // admin-frete-v2-contrato.test.tsx (Salvar em Frete não envia campo de
  // Transportadoras) — a divisão de território que este arquivo prende
  // continua de pé, só que pelo lado da edge.

  it("lote E: a seção veste o idioma visual do novo Ajustes (o card é da casca, não do conteúdo)", async () => {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O card `rounded-3xl border-white/5` passou a ser da CASCA
    // (SecaoColapsavel — mesma divisão da seção de Identidade, que sempre
    // foi conteúdo puro). Conteúdo que ainda carrega o próprio vidro
    // (`admin-glass`) vira card dentro de card no salão novo.
    expect(hospedeiro.querySelector(".admin-glass")).toBeNull();

    // Vocabulário de gente no rótulo interno — o título da seção é do hub;
    // dentro, a pergunta que o lojista responde é esta.
    expect(hospedeiro.textContent).toMatch(/como sua loja envia/i);

    // Rótulos internos no padrão do salão: text-[10px] font-black
    // uppercase tracking-[0.2em] (o mesmo idioma dos grupos do hub).
    const rotuloServicos = [
      ...hospedeiro.querySelectorAll<HTMLElement>("span, p"),
    ].find(
      (el) =>
        el.children.length === 0 &&
        el.textContent?.trim() === "Serviços da conta",
    );
    expect(rotuloServicos).toBeDefined();
    for (const classe of [
      "text-[10px]",
      "font-black",
      "uppercase",
      "tracking-[0.2em]",
    ]) {
      expect(rotuloServicos?.classList.contains(classe)).toBe(true);
    }

    // O cabeçalho "Chave de acesso" carrega o padrão no bloco que empurra o
    // ícone junto (o span interno é só o texto) — o que se prende é o
    // elemento que veste as classes.
    const classesDeRotulo = [
      "text-[10px]",
      "font-black",
      "uppercase",
      "tracking-[0.2em]",
    ];
    const temRotuloChave = [
      ...hospedeiro.querySelectorAll<HTMLElement>("*"),
    ].some(
      (el) =>
        el.textContent?.trim().startsWith("Chave de acesso") &&
        classesDeRotulo.every((c) => el.classList.contains(c)),
    );
    expect(temRotuloChave).toBe(true);
  });
});
