// @vitest-environment jsdom
//
// RELEASE 1.5.7 v2 — CONTRATO-1.5.7.md §4/§8: a lista de serviços reais da
// conta (`list_services`) e o seguro do Melhor Envio.
//
// O que este arquivo prende:
//   1. `servicos` só vai no pedido de salvar se a lista CARREGOU e a
//      lojista MEXEU nela — falha de `list_services` não apaga nada;
//   2. selecionar zero serviços depois de mexer bloqueia o Salvar (a edge
//      recusa `servicos: []`, mas a tela evita a viagem);
//   3. os ids do Melhor Envio que exigem agência (12, 15, 16, 22) mostram o
//      aviso "vende no checkout, mas a etiqueta tem de ser feita no site do
//      Melhor Envio" (recado da hub 22/09, EMENDA R2);
//   4. seguro do Melhor Envio (ajuste do dono, rodada 4 — "zerar a
//      declaração NÃO foi autorizado"): o controle "Sem seguro" some da
//      interface, o Salvar SEMPRE manda seguro:'valor_dos_produtos' e
//      NUNCA 'sem_seguro'; se a config lida vier 'sem_seguro' (só possível
//      por fora do painel), mostra um aviso e corrige no próximo salvar;
//   5. SuperFrete com `origem:'catalogo_documentado'` mostra o aviso
//      honesto de que a lista é do catálogo, não da conta (recado da hub).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, descartarCache } = vi.hoisted(() => ({
  invoke: vi.fn(),
  descartarCache: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => descartarCache(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const RESPOSTA_ME_LIGADO = {
  success: true,
  modo: "multi",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: {
      tem_chave: true,
      sandbox: false,
      servicos: null,
      seguro: "valor_dos_produtos",
    },
    superfrete: { tem_chave: true, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("TransportadorasSection — serviços da conta e seguro (1.5.7 v2)", () => {
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

  async function abrir() {
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
  }

  const botoes = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].filter((b) =>
      re.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("carrega a lista de serviços do Melhor Envio com 'Transportadora — Serviço'", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
              { codigo: "31", transportadora: "Jadlog", servico: "Package" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    expect(hospedeiro.textContent).toContain("Correios — PAC");
    expect(hospedeiro.textContent).toContain("Jadlog — Package");
  });

  it("servicos SÓ vai no pedido de salvar se carregou E a lojista mexeu", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    invoke.mockClear();
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    // Salva SEM mexer na lista carregada.
    await clicar(botoes(/^Salvar$/)[0]);
    const chamadaSalvar = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "save_credentials",
    );
    expect(chamadaSalvar?.[1]?.body).not.toHaveProperty("servicos");
  });

  it("falha ao carregar serviços NÃO apaga a seleção salva (as caixas nem aparecem)", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            ...RESPOSTA_ME_LIGADO,
            provedores: {
              ...RESPOSTA_ME_LIGADO.provedores,
              melhor_envio: {
                ...RESPOSTA_ME_LIGADO.provedores.melhor_envio,
                servicos: ["1", "31"],
              },
            },
          },
          error: null,
        });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: { success: false, error: "boom" },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    expect(hospedeiro.textContent).toMatch(/nada foi apagado/i);
    // Nenhuma caixa de serviço na tela (a lista não carregou).
    expect(hospedeiro.querySelectorAll('input[type="checkbox"]').length).toBe(
      3,
    ); // só as 3 do bloco "ligados"
  });

  it("marcar zero serviços depois de mexer bloqueia o Salvar (sem ida à edge)", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            ...RESPOSTA_ME_LIGADO,
            provedores: {
              ...RESPOSTA_ME_LIGADO.provedores,
              melhor_envio: {
                ...RESPOSTA_ME_LIGADO.provedores.melhor_envio,
                servicos: ["1"],
              },
            },
          },
          error: null,
        });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    const caixaServico = hospedeiro.querySelector(
      'label input[type="checkbox"]',
    ) as HTMLInputElement;
    // Ela nasce marcada (era a salva) — desmarcar deixa zero selecionados.
    expect(caixaServico.checked).toBe(true);
    await clicar(caixaServico);
    const { toast } = await import("sonner");
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[0]);
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Selecione ao menos um serviço antes de salvar.",
    );
  });

  it("ids que exigem agência (12, 15, 16, 22) mostram o aviso do checkout/etiqueta", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              {
                codigo: "12",
                transportadora: "LATAM Cargo",
                servico: "Rodoviário",
              },
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    expect(hospedeiro.textContent).toContain(
      "Vende no checkout, mas a etiqueta tem de ser feita no site do Melhor Envio.",
    );
    // O aviso é SÓ para o id 12, não para o 1 (Correios PAC).
    const linhaCorreios = [...hospedeiro.querySelectorAll("label")].find((l) =>
      /Correios — PAC/.test(l.textContent ?? ""),
    );
    expect(linhaCorreios?.textContent).not.toMatch(/Vende no checkout/);
  });

  it("o controle 'Sem seguro' NÃO aparece na interface do Melhor Envio (ajuste do dono, rodada 4)", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    expect(botoes(/^Sem seguro$/).length).toBe(0);
    expect(hospedeiro.textContent).not.toMatch(/Sem seguro/);
  });

  it("salvar o Melhor Envio sempre manda seguro:'valor_dos_produtos' — nunca 'sem_seguro'", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[0]);
    const chamadaSalvar = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "save_credentials",
    );
    expect(chamadaSalvar?.[1]?.body).toMatchObject({
      seguro: "valor_dos_produtos",
    });
    expect(chamadaSalvar?.[1]?.body?.seguro).not.toBe("sem_seguro");
  });

  it("config lida com seguro 'sem_seguro' (só possível por fora do painel): mostra aviso e o próximo salvar corrige para 'valor_dos_produtos'", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            ...RESPOSTA_ME_LIGADO,
            provedores: {
              ...RESPOSTA_ME_LIGADO.provedores,
              melhor_envio: {
                ...RESPOSTA_ME_LIGADO.provedores.melhor_envio,
                seguro: "sem_seguro",
              },
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    expect(hospedeiro.textContent).toContain(
      "Seguro desligado por fora do painel — ao salvar, volta para Com seguro.",
    );
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[0]);
    const chamadaSalvar = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "save_credentials",
    );
    expect(chamadaSalvar?.[1]?.body).toMatchObject({
      seguro: "valor_dos_produtos",
    });
  });

  it("SuperFrete com origem:'catalogo_documentado' mostra o aviso honesto (recado da hub 22/09)", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      if (
        opcoes?.body?.action === "list_services" &&
        opcoes.body.provider === "superfrete"
      ) {
        return Promise.resolve({
          data: {
            success: true,
            origem: "catalogo_documentado",
            servicos: [
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[1]);
    expect(hospedeiro.textContent).toMatch(
      /Lista de serviços da SuperFrete\. O teste confirma quais cotam na sua conta\./,
    );
  });

  it("Melhor Envio (controle) NÃO mostra o aviso de catálogo — vem da conta", async () => {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_ME_LIGADO, error: null });
      }
      if (opcoes?.body?.action === "list_services") {
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "1", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[0]);
    expect(hospedeiro.textContent).not.toMatch(
      /Lista de serviços da SuperFrete/,
    );
    void descartarCache;
  });
});
