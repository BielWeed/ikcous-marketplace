// @vitest-environment jsdom
//
// Painel simples (G6): a lojista lê o NOME do serviço, não o código.
//   - (Frenet é o terceiro cartão: ME e SuperFrete pedem e-mail para testar)
//   - o resultado do "Testar" mostra "PAC: cotou certo"; o código cru vai
//     para o `title` (detalhe), nunca é o texto da linha;
//   - o nome vem de `list_services` (a API); não há tabela fixa de nomes. Se
//     a lista não foi carregada, o texto honesto é "Serviço 1" — o código
//     como número, sem inventar um nome;
//   - "Sandbox" some da tela: o interruptor se chama "Modo de teste" (o
//     teste o acha pelo nome da transportadora) e o guia da chave também.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const RESPOSTA_FRENET_LIGADA = {
  success: true,
  modo: "multi",
  ligados: ["frenet"],
  provedores: {
    melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: true, sandbox: false, servicos: null },
  },
};

const TESTE = {
  success: true,
  servicosTestados: [
    { codigo: "1", ok: true, preco: 25.5, prazo: 3 },
    { codigo: "2", ok: false, motivo: "erro_do_servico", detalhe: "dimensões" },
  ],
};

describe("TransportadorasSection — serviço pelo nome, modo de teste sem jargão", () => {
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

  async function abrir(listaDeServicos: unknown[] | null) {
    invoke.mockImplementation((_n: string, opcoes: any) => {
      const acao = opcoes?.body?.action;
      if (acao === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_FRENET_LIGADA, error: null });
      }
      if (acao === "test_credentials") {
        return Promise.resolve({ data: TESTE, error: null });
      }
      if (acao === "list_services") {
        return Promise.resolve({
          data: { success: true, servicos: listaDeServicos ?? [] },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
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

  const linha = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("li")].find((li) =>
      re.test(li.textContent ?? ""),
    );

  it("com a lista da conta carregada, o Testar mostra 'PAC: cotou certo' e o código só no title", async () => {
    await abrir([
      { codigo: "1", transportadora: "Correios", servico: "PAC" },
      { codigo: "2", transportadora: "Correios", servico: "SEDEX" },
    ]);
    await clicar(botoes(/Ver serviços da conta/)[2]);
    await clicar(botoes(/^Testar$/)[2]);

    const pac = linha(/cotou certo/);
    expect(pac?.textContent).toBe("PAC: cotou certo");
    expect(pac?.getAttribute("title")).toBe("Código 1");
    const sedex = linha(/não cotou/);
    expect(sedex?.textContent).toBe("SEDEX: não cotou (dimensões)");
    expect(sedex?.getAttribute("title")).toBe("Código 2");
  });

  it("sem a lista carregada, não inventa nome: 'Serviço 1: cotou certo'", async () => {
    await abrir(null);
    await clicar(botoes(/^Testar$/)[2]);

    const um = linha(/cotou certo/);
    expect(um?.textContent).toBe("Serviço 1: cotou certo");
    expect(um?.getAttribute("title")).toBe("Código 1");
    expect(linha(/não cotou/)?.textContent).toBe(
      "Serviço 2: não cotou (dimensões)",
    );
  });

  it("a tela não diz 'Sandbox': o interruptor é 'Modo de teste' e continua achável pela transportadora", async () => {
    await abrir(null);

    expect(hospedeiro.textContent).not.toMatch(/Sandbox/);
    const interruptor = [
      ...hospedeiro.querySelectorAll('button[role="switch"]'),
    ].find((el) => /Modo de teste/.test(el.getAttribute("aria-label") ?? ""));
    expect(interruptor).toBeDefined();
    expect(
      [...hospedeiro.querySelectorAll('button[role="switch"]')].some((el) =>
        /Melhor Envio/.test(el.getAttribute("aria-label") ?? ""),
      ),
    ).toBe(true);
    expect(hospedeiro.innerHTML).not.toMatch(/aria-label="[^"]*Sandbox/);
  });

  it("o guia da chave também fala em 'Modo de teste', sem 'Sandbox'", async () => {
    await abrir(null);

    expect(hospedeiro.innerHTML).not.toMatch(/Sandbox/);
    expect(hospedeiro.textContent).toMatch(/Modo de teste/);
  });
});
