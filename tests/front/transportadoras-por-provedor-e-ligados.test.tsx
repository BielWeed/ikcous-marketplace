// @vitest-environment jsdom
//
// RELEASE 1.5.7 v2 (CONTRATO-1.5.7.md + EMENDA R2) — TransportadorasSection
// deixa de ser "escolha UM provedor" (radiogroup) e vira "configure CADA
// provedor, e escolha quais estão LIGADOS na loja". Os testes antigos do
// modelo de radiogroup único (transportadoras-chave-so-escrita-e-superfrete,
// transportadoras-superfrete-email-contato, transportadoras-superfrete-
// chip-pac-e-mini) foram REMOVIDOS: testavam uma tela que não existe mais
// (seleção única + leitura direta de `store_shipping_credentials`). Este
// arquivo prende o comportamento do modelo NOVO:
//
//   1. TODA leitura vem de UMA ação da edge (`ler_configuracao_frete`) — o
//      navegador nunca chama `supabase.from("store_shipping_credentials")`;
//   2. um cartão por provedor, sempre visível, independente do modo;
//   3. salvar a chave de um provedor NUNCA liga/desliga nada sozinho
//      (`save_credentials` e `save_active_providers` são ações separadas);
//   4. token vazio com chave já salva mantém a salva; sem chave salva e sem
//      token novo, a tela nem chama a edge (recusa local, sem round-trip);
//   5. o bloco "Provedores ligados na loja" só deixa marcar quem tem chave
//      salva e não está em sandbox;
//   6. `espelho:'pendente'`/`cache:'pendente'` são avisos honestos
//      (sucesso), nunca erro;
//   7. depois de salvar (credencial OU ligados), o cache do navegador é
//      descartado pela rota do pacote C (`descartarCacheDeFreteDoNavegador`).
//
// Tokens e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, descartarCache, chamadasAoBanco } = vi.hoisted(() => ({
  invoke: vi.fn(),
  descartarCache: vi.fn(),
  chamadasAoBanco: { total: 0 },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // Nenhuma leitura/gravação desta seção deve passar por aqui — qualquer
    // chamada incrementa o contador que os testes de regressão conferem.
    from: () => {
      chamadasAoBanco.total++;
      return {
        select: () => Promise.resolve({ data: [], error: null }),
        upsert: () => Promise.resolve({ error: null }),
      };
    },
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

const RESPOSTA_LEGADO = {
  success: true,
  modo: "legado",
  ligados: ["melhor_envio"],
  provedores: {
    melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("TransportadorasSection — modelo por provedor (1.5.7 v2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasAoBanco.total = 0;
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_LEGADO, error: null });
      }
      return Promise.resolve({ data: { success: true }, error: null });
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
  const camposToken = () =>
    [
      ...hospedeiro.querySelectorAll('input[type="password"]'),
    ] as HTMLInputElement[];

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

  async function digitar(campo: HTMLInputElement, valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("lê a configuração por UMA ação da edge, nunca pelo PostgREST direto", async () => {
    await abrir();
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({ body: { action: "ler_configuracao_frete" } }),
    );
    expect(chamadasAoBanco.total).toBe(0);
  });

  it("mostra os três cartões sempre, mesmo em modo legado com só o Melhor Envio ligado", async () => {
    await abrir();
    expect(hospedeiro.textContent).toContain("Chave de acesso — Melhor Envio");
    expect(hospedeiro.textContent).toContain("Chave de acesso — SuperFrete");
    expect(hospedeiro.textContent).toContain("Chave de acesso — Frenet");
  });

  it("mostra J&T Standard quando a lista da conta Frenet o omite, sem afirmar que já cota", async () => {
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: {
            ...RESPOSTA_LEGADO,
            provedores: {
              ...RESPOSTA_LEGADO.provedores,
              frenet: { tem_chave: true, sandbox: false, servicos: null },
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
              { codigo: "03298", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[2]);
    expect(hospedeiro.textContent).toContain("J&T Express — Standard");
    expect(hospedeiro.textContent).toContain("não listou este serviço");
  });

  it("J&T novo só é salvo após a cotação deste serviço passar no Testar", async () => {
    let jtCotou = false;
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete")
        return Promise.resolve({
          data: {
            ...RESPOSTA_LEGADO,
            provedores: {
              ...RESPOSTA_LEGADO.provedores,
              frenet: { tem_chave: true, sandbox: false, servicos: null },
            },
          },
          error: null,
        });
      if (action === "list_services")
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "03298", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      if (action === "test_credentials")
        return Promise.resolve({
          data: {
            success: true,
            servicosTestados: [
              { codigo: "03298", ok: true, preco: 13.43, prazo: 6 },
              { codigo: "JTE_INT", ok: jtCotou, preco: 11.74, prazo: 3 },
            ],
          },
          error: null,
        });
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[2]);
    const linhaJT = [...hospedeiro.querySelectorAll("label")].find((l) =>
      l.textContent?.includes("J&T Express — Standard"),
    );
    const linhaPAC = [...hospedeiro.querySelectorAll("label")].find((l) =>
      l.textContent?.includes("Correios — PAC"),
    );
    await clicar(linhaPAC?.querySelector("input") ?? undefined);
    await clicar(linhaJT?.querySelector("input") ?? undefined);
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[2]);
    await clicar(botoes(/^Testar$/)[2]);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "test_credentials",
          servicos: ["03298", "JTE_INT"],
        }),
      }),
    );
    await clicar(botoes(/^Salvar$/)[2]);
    expect(
      invoke.mock.calls.some(
        (c: any[]) => c[1]?.body?.action === "save_credentials",
      ),
    ).toBe(false);
    jtCotou = true;
    await clicar(botoes(/^Testar$/)[2]);
    await digitar(camposToken()[2], "chave-trocada-ficticia");
    await clicar(botoes(/^Salvar$/)[2]);
    expect(
      invoke.mock.calls.some(
        (c: any[]) => c[1]?.body?.action === "save_credentials",
      ),
    ).toBe(false);
    await digitar(camposToken()[2], "");
    await clicar(botoes(/^Testar$/)[2]);
    await clicar(botoes(/^Salvar$/)[2]);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "save_credentials",
          provider: "frenet",
          servicos: ["03298", "JTE_INT"],
        }),
      }),
    );
  });

  it("bloqueia troca de chave, serviços e salvamento durante Testar", async () => {
    let responderTeste: ((value: unknown) => void) | undefined;
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      const action = opcoes?.body?.action;
      if (action === "ler_configuracao_frete")
        return Promise.resolve({
          data: {
            ...RESPOSTA_LEGADO,
            provedores: {
              ...RESPOSTA_LEGADO.provedores,
              frenet: { tem_chave: true, sandbox: false, servicos: null },
            },
          },
          error: null,
        });
      if (action === "list_services")
        return Promise.resolve({
          data: {
            success: true,
            servicos: [
              { codigo: "03298", transportadora: "Correios", servico: "PAC" },
            ],
          },
          error: null,
        });
      if (action === "test_credentials")
        return new Promise((resolve) => {
          responderTeste = resolve;
        });
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    await clicar(botoes(/Ver serviços da conta/)[2]);
    await clicar(botoes(/^Testar$/)[2]);
    expect(camposToken()[2].disabled).toBe(true);
    expect(botoes(/^Salvar$/)[2].disabled).toBe(true);
    const jt = [...hospedeiro.querySelectorAll("label")].find((l) =>
      l.textContent?.includes("J&T Express — Standard"),
    );
    expect((jt?.querySelector("input") as HTMLInputElement).disabled).toBe(
      true,
    );
    await act(async () => {
      responderTeste?.({
        data: { success: true, servicosTestados: [] },
        error: null,
      });
      await esperarMicrotarefas();
    });
    expect(camposToken()[2].disabled).toBe(false);
  });

  it("modo legado sem provedor selecionado não migra por engano", async () => {
    invoke.mockImplementation((_nome: string, opcoes: any) =>
      Promise.resolve({
        data:
          opcoes?.body?.action === "ler_configuracao_frete"
            ? { ...RESPOSTA_LEGADO, ligados: [] }
            : { success: true },
        error: null,
      }),
    );
    await abrir();
    const botao = botoes(/Salvar provedores/)[0];
    expect(botao.disabled).toBe(true);
    await clicar(botao);
    expect(
      invoke.mock.calls.some(
        (c: any[]) => c[1]?.body?.action === "save_active_providers",
      ),
    ).toBe(false);
  });

  it("permite salvar a seleção atual para migrar do modo legado ao multiprovedor", async () => {
    await abrir();
    const botao = botoes(/Salvar provedores/)[0];
    expect(botao.disabled).toBe(false);
    await clicar(botao);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: { action: "save_active_providers", ligados: ["melhor_envio"] },
      }),
    );
  });

  it("chave salva não some do DOM: o campo nasce vazio e mostra o selo 'chave salva' só para quem tem token", async () => {
    await abrir();
    const [tokenME] = camposToken();
    expect(tokenME.value).toBe("");
    // Só o Melhor Envio tem chave na fixture — o selo aparece uma vez.
    const selos = [...hospedeiro.querySelectorAll("p")].filter((p) =>
      /Chave salva\./.test(p.textContent ?? ""),
    );
    expect(selos).toHaveLength(1);
  });

  it("Salvar SEM chave nova e SEM chave salva não chama a edge (recusa local)", async () => {
    await abrir();
    const { toast } = await import("sonner");
    invoke.mockClear();
    // SuperFrete não tem chave salva na fixture.
    const botaoSalvarSF = botoes(/^Salvar$/)[1];
    await clicar(botaoSalvarSF);
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Cole a chave de acesso desta transportadora antes de salvar.",
    );
  });

  it("salvar a chave do Melhor Envio NÃO liga nada sozinho: só save_credentials é chamado", async () => {
    await abrir();
    const [tokenME] = camposToken();
    await digitar(tokenME, "tok-me-novo-ficticio");
    await clicar(botoes(/^Salvar$/)[0]);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "save_credentials",
          provider: "melhor_envio",
          token: "tok-me-novo-ficticio",
          sandbox: false,
          seguro: "valor_dos_produtos",
        }),
      }),
    );
    const chamouLigar = invoke.mock.calls.some(
      (c: any[]) => c[1]?.body?.action === "save_active_providers",
    );
    expect(chamouLigar).toBe(false);
    // Garantia (a) estendida (revisão Opus): o fluxo de SALVAR também
    // nunca toca o PostgREST direto.
    expect(chamadasAoBanco.total).toBe(0);
  });

  it("depois de salvar com sucesso, descarta o cache de frete do navegador (rota do pacote C)", async () => {
    await abrir();
    const [tokenME] = camposToken();
    await digitar(tokenME, "tok-me-novo-ficticio");
    await clicar(botoes(/^Salvar$/)[0]);
    expect(descartarCache).toHaveBeenCalledTimes(1);
  });

  it("SuperFrete sem e-mail válido: Salvar recusa localmente, sem chamar a edge", async () => {
    await abrir();
    const { toast } = await import("sonner");
    const camposEmail = [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ] as HTMLInputElement[];
    const tokenSF = camposToken()[1];
    await digitar(tokenSF, "tok-sf-novo-ficticio");
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[1]);
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    void camposEmail;
  });

  it("SuperFrete com e-mail válido: Salvar manda token + sandbox + contact_email", async () => {
    await abrir();
    const tokenSF = camposToken()[1];
    // RELEASE 1.5.7 v2 (R3-7): o Melhor Envio (índice 0) também ganhou campo
    // de e-mail — a SuperFrete é o SEGUNDO cartão a ter um.
    const emailSF = [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ][1] as HTMLInputElement;
    await digitar(tokenSF, "tok-sf-novo-ficticio");
    await digitar(emailSF, "tecnico@loja.com");
    await clicar(botoes(/^Salvar$/)[1]);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: {
          action: "save_credentials",
          provider: "superfrete",
          token: "tok-sf-novo-ficticio",
          sandbox: false,
          contact_email: "tecnico@loja.com",
        },
      }),
    );
  });

  it("a edge recusou (success:false) -> mostra a frase da edge e NÃO descarta cache", async () => {
    await abrir();
    const { toast } = await import("sonner");
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_LEGADO, error: null });
      }
      return Promise.resolve({
        data: { success: false, error: "Token inválido para este provedor." },
        error: null,
      });
    });
    const [tokenME] = camposToken();
    await digitar(tokenME, "tok-ruim");
    await clicar(botoes(/^Salvar$/)[0]);
    expect(toast.error).toHaveBeenCalledWith(
      "Token inválido para este provedor.",
    );
    expect(descartarCache).not.toHaveBeenCalled();
  });

  describe("bloco 'Provedores ligados na loja'", () => {
    it("só permite marcar provedor com chave salva e fora do sandbox", async () => {
      await abrir();
      const linhaME = [...hospedeiro.querySelectorAll("label")].find((l) =>
        /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      const linhaSF = [...hospedeiro.querySelectorAll("label")].find(
        (l) =>
          /SuperFrete/.test(l.textContent ?? "") &&
          l.querySelector('input[type="checkbox"]'),
      ) as HTMLLabelElement;
      const caixaME = linhaME.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      const caixaSF = linhaSF.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(caixaME.disabled).toBe(false);
      expect(caixaME.checked).toBe(true);
      expect(caixaSF.disabled).toBe(true);
    });

    // ── Achado 1 (revisão Opus): a caixa e a chave de sandbox travavam SÓ
    // para IMPEDIR entrar num estado ruim — mas travavam também a SAÍDA
    // dele, prendendo a lojista. As duas travas têm de deixar SAIR sempre. ──
    it("modo antigo, Melhor Envio ligado com sandbox:true: a chave DESTRAVA e, com a chave de produção colada, dá para desligar o Sandbox e salvar", async () => {
      invoke.mockImplementation((_n: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: {
              success: true,
              modo: "legado",
              ligados: ["melhor_envio"],
              provedores: {
                melhor_envio: {
                  tem_chave: true,
                  sandbox: true,
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
        return Promise.resolve({ data: { success: true }, error: null });
      });
      await abrir();
      const interruptorME = [
        ...hospedeiro.querySelectorAll('[role="switch"]'),
      ].find((el) =>
        (el.getAttribute("aria-label") ?? "").includes("Melhor Envio"),
      ) as HTMLElement;
      // A trava é só para LIGAR sandbox num provedor já ligado — a loja
      // presa (ligada + sandbox) precisa continuar destravável, senão não
      // há como sair desse estado pela tela.
      expect(interruptorME.hasAttribute("disabled")).toBe(false);
      await clicar(interruptorME);

      // Revisão Opus (rodada 2): destravar o INTERRUPTOR não basta para
      // SALVAR. A edge continua recusando `sandbox:false` SEM chave nova
      // quando a salva é de outro ambiente (acoes.ts:530, "a chave é por
      // ambiente" — mesma garantia do teste dedicado logo abaixo). Sem
      // colar a chave de produção aqui, este `corpo` seria exatamente o
      // que a edge REJEITA — a lojista digita a chave nova do ambiente
      // que está escolhendo, como qualquer troca de ambiente exige.
      const [tokenME] = camposToken();
      await digitar(tokenME, "tok-me-producao-ficticio");

      await clicar(botoes(/^Salvar$/)[0]);
      const corpo = invoke.mock.calls.find(
        (c: any[]) => c[1]?.body?.action === "save_credentials",
      )?.[1]?.body;
      expect(corpo).toMatchObject({
        action: "save_credentials",
        provider: "melhor_envio",
        sandbox: false,
        token: "tok-me-producao-ficticio",
      });
    });

    it("provedor ligado sem chave (drift do espelho): dá para desmarcar e salvar os ligados sem ele", async () => {
      invoke.mockImplementation((_n: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: {
              success: true,
              modo: "legado",
              // `ligados` diz que o Melhor Envio está ligado, mas a
              // credencial dele não sustenta mais isso (drift do
              // espelho) — a caixa não pode ficar presa marcada e
              // INDESMARCÁVEL só porque `podeLigar` é falso.
              ligados: ["melhor_envio"],
              provedores: {
                melhor_envio: {
                  tem_chave: false,
                  sandbox: false,
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
        return Promise.resolve({
          data: { success: true, ligados: [] },
          error: null,
        });
      });
      await abrir();
      const linhaME = [...hospedeiro.querySelectorAll("label")].find((l) =>
        /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      const caixaME = linhaME.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      expect(caixaME.checked).toBe(true);
      expect(caixaME.disabled).toBe(false);
      await clicar(caixaME);
      expect(caixaME.checked).toBe(false);

      await clicar(botoes(/Salvar provedores/)[0]);
      expect(invoke).toHaveBeenCalledWith(
        "calculate-shipping",
        expect.objectContaining({
          body: { action: "save_active_providers", ligados: [] },
        }),
      );
    });

    it("salvar os ligados chama save_active_providers com a lista escolhida", async () => {
      await abrir();
      const linhaME = [...hospedeiro.querySelectorAll("label")].find((l) =>
        /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      const caixaME = linhaME.querySelector("input") as HTMLInputElement;
      await clicar(caixaME);
      invoke.mockImplementation((_n: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: { ...RESPOSTA_LEGADO, ligados: [] },
            error: null,
          });
        }
        return Promise.resolve({
          data: { success: true, ligados: [] },
          error: null,
        });
      });
      await clicar(botoes(/Salvar provedores/)[0]);
      expect(invoke).toHaveBeenCalledWith(
        "calculate-shipping",
        expect.objectContaining({
          body: { action: "save_active_providers", ligados: [] },
        }),
      );
      expect(descartarCache).toHaveBeenCalledTimes(1);
    });

    it("espelho:'pendente' é aviso honesto de SUCESSO, nunca erro", async () => {
      await abrir();
      const { toast } = await import("sonner");
      const linhaME = [...hospedeiro.querySelectorAll("label")].find((l) =>
        /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      await clicar(linhaME.querySelector("input") as HTMLInputElement);
      invoke.mockImplementation((_n: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({
            data: { ...RESPOSTA_LEGADO, ligados: [] },
            error: null,
          });
        }
        return Promise.resolve({
          data: { success: true, ligados: [], espelho: "pendente" },
          error: null,
        });
      });
      await clicar(botoes(/Salvar provedores/)[0]);
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        "Provedores atualizados!",
        expect.objectContaining({
          description: expect.stringMatching(/indicador antigo não atualizou/i),
        }),
      );
    });

    it("save_active_providers FALHOU: ligadosSalvos NÃO muda (Sandbox do ME segue desabilitado e o rótulo não vira 'ligado' para o que não está mais marcado)", async () => {
      await abrir();
      const { toast } = await import("sonner");
      // SuperFrete não tem chave na fixture legada — não dá para marcá-la;
      // desmarca o Melhor Envio (o único ligado) para simular a tentativa
      // de mudança que vai falhar.
      const linhaME = [...hospedeiro.querySelectorAll("label")].find((l) =>
        /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      const caixaME = linhaME.querySelector("input") as HTMLInputElement;
      await clicar(caixaME);
      expect(caixaME.checked).toBe(false);

      invoke.mockImplementation((_n: string, opcoes: any) => {
        if (opcoes?.body?.action === "ler_configuracao_frete") {
          return Promise.resolve({ data: RESPOSTA_LEGADO, error: null });
        }
        return Promise.resolve({
          data: { success: false, error: "Não foi possível desligar agora." },
          error: null,
        });
      });
      await clicar(botoes(/Salvar provedores/)[0]);

      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível desligar agora.",
      );

      // ── Achado 3 (revisão Opus), sensível a MUTANTE: se algum código
      // futuro trocar `ligadosSalvos` na falha (o defeito que este teste
      // existe para pegar), as DUAS asserções abaixo mudam de valor.
      //
      // (1) o interruptor de sandbox do card do ME é `disabled={ligado &&
      // !sandboxAtual}` — `ligado` vem de `ligadosSalvos.has(provider)`.
      // Continua VERDADEIRO (ME segue SALVO como ligado; só o rascunho do
      // checkbox foi desmarcado) até a próxima leitura confirmar o
      // contrário.
      const interruptorME = [
        ...hospedeiro.querySelectorAll('[role="switch"]'),
      ].find((el) =>
        (el.getAttribute("aria-label") ?? "").includes("Melhor Envio"),
      ) as HTMLElement;
      expect(interruptorME.hasAttribute("disabled")).toBe(true);

      // (2) o rótulo compara ligadosSalvos (verdade) × o rascunho
      // (marcado=false agora): "será desligado (falta salvar)" — nunca
      // "ligado" (mentira: o servidor não confirmou) nem "chave salva"
      // (também mentira: ele CONTINUA ligado de verdade).
      const linhaMEDepois = [...hospedeiro.querySelectorAll("label")].find(
        (l) => /Melhor Envio/.test(l.textContent ?? ""),
      ) as HTMLLabelElement;
      expect(linhaMEDepois.textContent).toMatch(
        /será desligado \(falta salvar\)/,
      );
      expect(linhaMEDepois.textContent).not.toMatch(/\bligado\b/);

      const chamouSaveActiveDeNovo = invoke.mock.calls.filter(
        (c: any[]) => c[1]?.body?.action === "save_active_providers",
      );
      expect(chamouSaveActiveDeNovo).toHaveLength(1);
    });
  });

  it("Testar SEM chave digitada usa a credencial SALVA — nenhum token vai no corpo da chamada", async () => {
    await abrir();
    // R3-7: o Melhor Envio também exige e-mail em cada consulta — preenche
    // só o e-mail (a chave continua vindo do servidor, sem token no corpo).
    const emailME = hospedeiro.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await digitar(emailME, "contato@loja-ficticia.com.br");
    invoke.mockClear();
    // Melhor Envio já tem chave salva na fixture; testar sem digitar nada
    // novo tem de pedir à edge para usar a credencial salva.
    await clicar(botoes(/^Testar$/)[0]);
    expect(invoke).toHaveBeenCalledWith(
      "calculate-shipping",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "test_credentials",
          provider: "melhor_envio",
          usarCredencialSalva: true,
        }),
      }),
    );
    const corpo = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "test_credentials",
    )?.[1]?.body;
    // Nenhum token em lugar nenhum do corpo — nem solto, nem dentro de
    // `credentials` (que aqui só carrega o e-mail exigido pela R3-7).
    expect(corpo).not.toHaveProperty("token");
    expect(corpo?.credentials).not.toHaveProperty("token");
    // Garantia (a) estendida (revisão Opus): o fluxo de TESTAR também
    // nunca toca o PostgREST direto.
    expect(chamadasAoBanco.total).toBe(0);
  });

  it("depois de salvar com sucesso, o campo do token volta vazio (a chave não fica pairando na tela)", async () => {
    await abrir();
    const [tokenME] = camposToken();
    await digitar(tokenME, "tok-me-novo-ficticio");
    expect(camposToken()[0].value).toBe("tok-me-novo-ficticio");
    await clicar(botoes(/^Salvar$/)[0]);
    // A seção recarrega (`carregar()`) depois do save — o rascunho volta
    // vazio, e a chave nova não fica visível na tela depois de salva.
    expect(camposToken()[0].value).toBe("");
  });

  it("SuperFrete com e-mail de FORMATO INVÁLIDO: recusa localmente com a mensagem de formato (mesma da 1.5.5), sem chamar a edge", async () => {
    await abrir();
    const { toast } = await import("sonner");
    const tokenSF = camposToken()[1];
    const emailSF = [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ][1] as HTMLInputElement;
    await digitar(tokenSF, "tok-sf-novo-ficticio");
    await digitar(emailSF, "nao-e-um-email-valido");
    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[1]);

    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br).",
    );
  });

  it("Salvar SEM chave nova e SEM chave salva ainda recusa local mesmo com o sandbox mexido (caso base, sem provar nada sobre o ambiente)", async () => {
    // SuperFrete não tem chave salva na fixture legada — mexer no sandbox
    // não muda o motivo da recusa: é a MESMA "sem chave nenhuma" de sempre.
    // A garantia real de "a chave é por ambiente" está no teste seguinte,
    // que usa um provedor com chave JÁ salva (só aí o servidor decide algo
    // sobre ambiente) e no rollback (edge, acoes_test.ts/index_test.ts —
    // ver mapa de garantias no CHECKPOINT-P).
    await abrir();
    const { toast } = await import("sonner");
    const interruptorSandboxSF = [
      ...hospedeiro.querySelectorAll('[role="switch"]'),
    ].find((el) =>
      (el.getAttribute("aria-label") ?? "").includes("SuperFrete"),
    ) as HTMLElement;
    expect(interruptorSandboxSF).toBeDefined();
    await clicar(interruptorSandboxSF);

    invoke.mockClear();
    await clicar(botoes(/^Salvar$/)[1]);
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Cole a chave de acesso desta transportadora antes de salvar.",
    );
  });

  // ── Achado "teste (f) oco" (revisão Opus): o teste acima usava um
  // provedor SEM chave — a recusa vinha da checagem "sem chave nenhuma",
  // que não tem nada a ver com "a chave é por ambiente". A garantia de
  // verdade (acoes.ts, save_credentials: `!tokenNovo && novos.sandbox !==
  // undefined && ... !== atual.sandbox` recusa) só se prova com um
  // provedor que JÁ TEM chave salva num ambiente — aqui o Melhor Envio,
  // não ligado nesta fixture (chave livre, sem a trava do R3-8). ──────────
  it("trocar o sandbox de um provedor com chave SALVA, sem colar chave nova: a edge recusa (chave é por ambiente) e a tela mostra a frase EXATA dela, sem gravar", async () => {
    const RESPOSTA_ME_COM_CHAVE_NAO_LIGADO = {
      success: true,
      modo: "legado",
      ligados: [],
      provedores: {
        melhor_envio: { tem_chave: true, sandbox: false, servicos: null },
        superfrete: { tem_chave: false, sandbox: false, servicos: null },
        frenet: { tem_chave: false, sandbox: false, servicos: null },
      },
    };
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: RESPOSTA_ME_COM_CHAVE_NAO_LIGADO,
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });
    await abrir();
    const { toast } = await import("sonner");
    const interruptorME = [
      ...hospedeiro.querySelectorAll('[role="switch"]'),
    ].find((el) =>
      (el.getAttribute("aria-label") ?? "").includes("Melhor Envio"),
    ) as HTMLElement;
    // Não está ligado nesta fixture: a chave de sandbox está LIVRE
    // (R3-8 não entra aqui — o achado 1 é outra trava).
    expect(interruptorME.hasAttribute("disabled")).toBe(false);
    await clicar(interruptorME);

    // A EXATA frase que a edge devolve (acoes.ts, comentário "A chave é
    // POR AMBIENTE") — a tela nunca inventa a própria versão.
    const MENSAGEM_DA_EDGE =
      "Para trocar o modo de testes (Sandbox), cole a chave de acesso do ambiente escolhido — Sandbox e produção usam chaves diferentes.";
    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({
          data: RESPOSTA_ME_COM_CHAVE_NAO_LIGADO,
          error: null,
        });
      }
      if (opcoes?.body?.action === "save_credentials") {
        return Promise.resolve({
          data: { success: false, error: MENSAGEM_DA_EDGE },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });

    await clicar(botoes(/^Salvar$/)[0]);

    const corpo = invoke.mock.calls.find(
      (c: any[]) => c[1]?.body?.action === "save_credentials",
    )?.[1]?.body;
    // A tela manda o sandbox novo SEM token — é assim que a edge sabe que
    // não houve chave nova colada para o ambiente escolhido.
    expect(corpo).toMatchObject({ provider: "melhor_envio", sandbox: true });
    expect(corpo).not.toHaveProperty("token");
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DA_EDGE);
    expect(descartarCache).not.toHaveBeenCalled();
  });

  // ── R3-8 (revisão do pacote E): `save_credentials` recusa `sandbox:true`
  // em provedor LIGADO, nos dois modos, com `motivo:'sandbox'` — o cartão
  // desabilita a chave PREVENTIVAMENTE, e se o servidor mesmo assim
  // recusar, a tela mostra a mensagem dele. ──────────────────────────────
  it("provedor LIGADO: a chave de sandbox nasce desabilitada, com o aviso de desligar antes", async () => {
    // Fixture: Melhor Envio está ligado (RESPOSTA_LEGADO); SuperFrete não.
    await abrir();
    const interruptorME = [
      ...hospedeiro.querySelectorAll('[role="switch"]'),
    ].find((el) =>
      (el.getAttribute("aria-label") ?? "").includes("Melhor Envio"),
    ) as HTMLElement;
    const interruptorSF = [
      ...hospedeiro.querySelectorAll('[role="switch"]'),
    ].find((el) =>
      (el.getAttribute("aria-label") ?? "").includes("SuperFrete"),
    ) as HTMLElement;
    expect(interruptorME).toBeDefined();
    expect(interruptorSF).toBeDefined();

    expect(interruptorME.hasAttribute("disabled")).toBe(true);
    // Controle: SuperFrete NÃO está ligada — a chave continua livre.
    expect(interruptorSF.hasAttribute("disabled")).toBe(false);

    // O aviso aparece só no cartão do provedor ligado.
    const cartaoME = interruptorME.closest(
      "div.space-y-3",
    ) as HTMLElement | null;
    expect(cartaoME?.textContent).toContain(
      "Desligue esta transportadora antes de usar o modo de testes.",
    );
  });

  it("mesmo com a chave desabilitada, se o SERVIDOR recusar sandbox em provedor ligado, mostra a mensagem dele (motivo:'sandbox')", async () => {
    // Cenário defensivo (duas abas, corrida entre ligar e trocar de
    // ambiente): a SuperFrete não está ligada NESTA leitura, então o
    // interruptor dela segue clicável — mas o servidor pode ter recebido a
    // ligação por outro caminho entre a leitura e o salvar. A tela nunca
    // inventa a própria frase: mostra exatamente o que a edge devolve.
    await abrir();
    const interruptorSF = [
      ...hospedeiro.querySelectorAll('[role="switch"]'),
    ].find((el) =>
      (el.getAttribute("aria-label") ?? "").includes("SuperFrete"),
    ) as HTMLElement;
    await clicar(interruptorSF);
    const tokenSF = camposToken()[1];
    const emailSF = [
      ...hospedeiro.querySelectorAll('input[type="email"]'),
    ][1] as HTMLInputElement;
    await digitar(tokenSF, "tok-sf-novo-ficticio");
    await digitar(emailSF, "tecnico@loja.com");

    invoke.mockImplementation((_n: string, opcoes: any) => {
      if (opcoes?.body?.action === "ler_configuracao_frete") {
        return Promise.resolve({ data: RESPOSTA_LEGADO, error: null });
      }
      if (opcoes?.body?.action === "save_credentials") {
        return Promise.resolve({
          data: {
            success: false,
            motivo: "sandbox",
            error:
              "Desligue esta transportadora antes de usar o modo de testes.",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { success: true }, error: null });
    });

    const { toast } = await import("sonner");
    await clicar(botoes(/^Salvar$/)[1]);
    expect(toast.error).toHaveBeenCalledWith(
      "Desligue esta transportadora antes de usar o modo de testes.",
    );
    expect(descartarCache).not.toHaveBeenCalled();
  });
});
