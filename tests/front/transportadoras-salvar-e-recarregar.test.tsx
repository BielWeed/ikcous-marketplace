// @vitest-environment jsdom
//
// PR #637 (23/09/2026) — sintoma do celular: "FRENET — Chave salva", mas a
// lista SERVIÇOS DA CONTA vazia com "Ver serviços da conta"; e "Salvar
// provedores" com Melhor Envio + Frenet "selecionado (falta salvar)" que
// "não salva". Estes testes usam uma edge FALSA COM ESTADO (salvar grava,
// `ler_configuracao_frete` devolve o gravado) para conferir o ciclo inteiro
// salvar → recarregar, e prendem:
//
//   1. a seleção de serviços SALVA aparece depois de recarregar, sem tocar em
//      "Ver serviços da conta" (antes a lista ficava vazia e parecia perdida);
//   2. depois de salvar com a lista aberta, a lista continua aberta e marcada;
//   3. a recusa do "Salvar provedores" fica ESCRITA no bloco (role=alert),
//      não só num toast que some — e sai quando a escolha muda;
//   4. o cenário do print (ME sem e-mail + Frenet marcados): a edge recusa
//      (`MOTIVO_SEM_EMAIL_MELHOR_ENVIO`) e a frase fica na tela;
//   5. salvar provedores com sucesso sobrevive à recarga.
//
// Tokens e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("a seção não pode ler o banco direto");
    },
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = {
  tem_chave: boolean;
  sandbox: boolean;
  servicos: string[] | null;
  contato_email?: string | null;
};

/** Edge falsa com ESTADO — o mínimo do contrato de `acoes.ts`. */
function criarServidor(inicial: {
  modo: "legado" | "multi";
  ligados: string[];
  provedores: Record<string, Linha>;
}) {
  const estado = structuredClone(inicial);
  const servicosDaFrenet = [
    { codigo: "JADLOG_PACKAGE", transportadora: "Jadlog", servico: "Package" },
  ];
  invoke.mockImplementation((_nome: string, opcoes: any) => {
    const corpo = opcoes?.body ?? {};
    const responder = (data: unknown) => Promise.resolve({ data, error: null });
    switch (corpo.action) {
      case "ler_configuracao_frete":
        return responder({ success: true, ...structuredClone(estado) });
      case "list_services":
        return responder({ success: true, servicos: servicosDaFrenet });
      case "test_credentials":
        return responder({
          success: true,
          servicosTestados: (corpo.servicos ?? []).map((codigo: string) => ({
            codigo,
            ok: true,
            preco: 20,
            prazo: 5,
          })),
        });
      case "save_credentials": {
        const linha = estado.provedores[corpo.provider];
        linha.tem_chave = true;
        if (Array.isArray(corpo.servicos)) linha.servicos = corpo.servicos;
        return responder({ success: true, tem_chave: true });
      }
      case "save_active_providers": {
        const lista: string[] = corpo.ligados;
        const me = estado.provedores.melhor_envio;
        if (lista.includes("melhor_envio") && !me.contato_email) {
          return responder({
            success: false,
            provider: "melhor_envio",
            motivo: "sem_email",
            error:
              "Informe o e-mail de contato do Melhor Envio (a API exige um contato da loja)",
          });
        }
        estado.modo = "multi";
        estado.ligados = lista;
        return responder({ success: true, ligados: lista });
      }
      default:
        return responder({ success: false, error: "ação desconhecida" });
    }
  });
  return estado;
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("TransportadorasSection — salvar e recarregar (PR #637)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperar();
      });
    }
  }

  /** "Recarregar a página": desmonta e monta de novo, lendo do servidor. */
  async function recarregar() {
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
  }

  async function clicar(el: Element | null | undefined) {
    if (!el) throw new Error("elemento não encontrado");
    await act(async () => {
      (el as HTMLElement).click();
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperar();
      });
    }
  }

  function cartaoDe(nome: string): HTMLElement {
    const titulo = Array.from(hospedeiro.querySelectorAll("span")).find(
      (s) => s.textContent === `Chave de acesso — ${nome}`,
    );
    const cartao = titulo?.closest("div.rounded-2xl") as HTMLElement | null;
    if (!cartao) throw new Error(`cartão ${nome} não encontrado`);
    return cartao;
  }

  function botaoCom(raizBusca: ParentNode, texto: string) {
    return Array.from(raizBusca.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    );
  }

  function caixaDoLigado(nome: string): HTMLInputElement {
    const rotulo = Array.from(hospedeiro.querySelectorAll("label")).find(
      (l) =>
        l.querySelector("span.font-bold")?.textContent === nome &&
        l.querySelector('input[type="checkbox"]'),
    );
    const caixa = rotulo?.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    if (!caixa) throw new Error(`caixa de ${nome} não encontrada`);
    return caixa;
  }

  const LEGADO_SF = {
    modo: "legado" as const,
    ligados: ["superfrete"],
    provedores: {
      melhor_envio: {
        tem_chave: true,
        sandbox: false,
        servicos: null,
        contato_email: null,
      },
      superfrete: {
        tem_chave: true,
        sandbox: false,
        servicos: null,
        contato_email: "loja@exemplo.com",
      },
      frenet: { tem_chave: true, sandbox: false, servicos: null },
    },
  };

  it("a seleção salva da Frenet aparece depois de recarregar, sem tocar em 'Ver serviços'", async () => {
    const estado = criarServidor(LEGADO_SF);
    estado.provedores.frenet.servicos = ["JTE_INT", "JADLOG_PACKAGE"];
    await montar();

    const frenet = cartaoDe("Frenet");
    expect(frenet.textContent).toContain("J&T Express — Standard");
    expect(frenet.textContent).toContain("JADLOG_PACKAGE");
    expect(frenet.textContent).not.toContain("Nenhum serviço");
  });

  it("salvar a Frenet com J&T testado grava, mantém a lista aberta e sobrevive à recarga", async () => {
    const estado = criarServidor(LEGADO_SF);
    await montar();

    await clicar(botaoCom(cartaoDe("Frenet"), "Ver serviços da conta"));
    const caixaJt = Array.from(cartaoDe("Frenet").querySelectorAll("label"))
      .find((l) => l.textContent?.includes("J&T Express — Standard"))
      ?.querySelector("input") as HTMLInputElement;
    await clicar(caixaJt);
    await clicar(botaoCom(cartaoDe("Frenet"), "Testar"));
    await clicar(
      Array.from(cartaoDe("Frenet").querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Salvar",
      ),
    );

    expect(estado.provedores.frenet.servicos).toEqual(["JTE_INT"]);
    // Lista continua aberta, com o salvo marcado.
    const jtDepois = Array.from(cartaoDe("Frenet").querySelectorAll("label"))
      .find((l) => l.textContent?.includes("J&T Express — Standard"))
      ?.querySelector("input") as HTMLInputElement | undefined;
    expect(jtDepois?.checked).toBe(true);

    await recarregar();
    expect(cartaoDe("Frenet").textContent).toContain("J&T Express — Standard");
  });

  it("cenário do print: ME + Frenet marcados, ME sem e-mail — a recusa fica escrita e nada grava", async () => {
    const estado = criarServidor(LEGADO_SF);
    await montar();

    await clicar(caixaDoLigado("Melhor Envio"));
    await clicar(caixaDoLigado("Frenet"));
    await clicar(botaoCom(hospedeiro, "Salvar provedores"));

    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("Nada foi salvo.");
    expect(alerta?.textContent).toContain(
      "Informe o e-mail de contato do Melhor Envio",
    );
    expect(estado.modo).toBe("legado");

    await recarregar();
    expect(caixaDoLigado("Frenet").checked).toBe(false);
    expect(caixaDoLigado("SuperFrete").checked).toBe(true);
  });

  it("a recusa do 'Salvar provedores' fica escrita no bloco até a escolha mudar", async () => {
    // A edge testa quem ENTRA na lista; a Frenet reprova (J&T não cotou).
    const estado = criarServidor(LEGADO_SF);
    await montar();
    invoke.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          success: false,
          provider: "frenet",
          motivo: "sem_cotacao_valida",
          servicosTestados: [
            { codigo: "JTE_INT", ok: false, motivo: "nao_retornado" },
          ],
          error:
            "Frenet não foi ligada: A chave está certa; estes serviços não cotaram para o pacote de teste.",
        },
        error: null,
      }),
    );
    await clicar(caixaDoLigado("Frenet"));
    await clicar(botaoCom(hospedeiro, "Salvar provedores"));

    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("Frenet não foi ligada");
    expect(alerta?.textContent).toContain("JTE_INT");
    expect(estado.ligados).toEqual(["superfrete"]);

    await clicar(caixaDoLigado("Frenet"));
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("depois da recusa, salvar o e-mail no cartão do ME tira o alerta velho", async () => {
    const estado = criarServidor(LEGADO_SF);
    await montar();
    await clicar(caixaDoLigado("Melhor Envio"));
    await clicar(botaoCom(hospedeiro, "Salvar provedores"));
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

    // Faz o que o alerta pede: e-mail no cartão do ME e "Salvar".
    const email = cartaoDe("Melhor Envio").querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(email, "loja@exemplo.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    estado.provedores.melhor_envio.contato_email = "loja@exemplo.com";
    await clicar(
      Array.from(cartaoDe("Melhor Envio").querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Salvar",
      ),
    );

    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("salvar provedores com sucesso sobrevive à recarga", async () => {
    const estado = criarServidor(LEGADO_SF);
    await montar();

    await clicar(caixaDoLigado("Frenet"));
    await clicar(botaoCom(hospedeiro, "Salvar provedores"));
    expect(estado.ligados).toEqual(["superfrete", "frenet"]);

    await recarregar();
    expect(caixaDoLigado("Frenet").checked).toBe(true);
    expect(caixaDoLigado("Frenet").closest("label")?.textContent).toContain(
      "ligado",
    );
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
