// @vitest-environment jsdom
//
// RELEASE 1.5.5 — o e-mail de contato técnico da SuperFrete é da LOJISTA.
//
// Pedido do dono: "Pq email? Se precisa de email deve ter no app para eu
// colocar e nao voce colocar". Na 1.5.4 a edge exigia uma variável de
// projeto com o e-mail, e a tela dizia "Ativo agora: SuperFrete" olhando o
// RASCUNHO (a escolha não salva), não o que estava gravado.
//
// O que este arquivo prende:
//   1. o campo "E-mail de contato técnico" aparece SÓ com a SuperFrete
//      escolhida, e nasce com o e-mail SALVO (lido sozinho, por alias — nunca
//      a coluna `credentials` inteira, nunca o token);
//   2. e-mail inválido bloqueia Testar e Salvar, com aviso no campo;
//   3. salvar a SuperFrete passa SEMPRE pela edge (`save_credentials`), e só
//      DEPOIS, se a edge disser que ficou completo (chave + e-mail), o
//      provedor vivo muda (`updateConfig`) — nunca pelo estado local;
//   4. o Melhor Envio continua como antes (updateConfig antes do upsert,
//      sem campo de e-mail — ADMIN-010);
//   5. o rodapé diz o que está SALVO ("Ativo agora") e, com rascunho
//      diferente, "Selecionado (falta salvar)";
//   6. nenhum texto da tela cita variável de ambiente.
//
// Tokens e e-mails abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TOKEN_SF_SALVO, estadoDaLoja, banco, invoke, updateConfig, ordem } =
  vi.hoisted(() => ({
    TOKEN_SF_SALVO: "tok-sf-SALVO-ficticio-nao-pode-viajar",
    estadoDaLoja: {
      atual: {
        shippingProvider: "melhor_envio" as string,
        enabledShippingMethods: ["sedex", "pac"] as string[],
      },
    },
    banco: {
      linhas: [] as Array<{
        provider: string;
        credentials: Record<string, unknown>;
      }>,
      colunasPedidas: [] as string[],
      upserts: [] as any[],
    },
    invoke: vi.fn(),
    updateConfig: vi.fn(),
    ordem: [] as string[],
  }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// O builder do PostgREST em miniatura. Filtros (`.not/.neq/.eq`) rodam NO
// "banco", sobre `provider` ou `credentials->>campo`; a projeção obedece às
// colunas pedidas: "provider", um alias `nome:credentials->>campo` (devolve
// SÓ aquele campo) — e "credentials"/"*" devolveriam o JSON inteiro com o
// token, que é o que as asserções sobre `colunasPedidas` impedem.
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
        upsert: (linha: any, opcoes: any) => {
          ordem.push("upsert");
          banco.upserts.push({ linha, opcoes });
          return Promise.resolve({ error: null });
        },
      };
    },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
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

const LINHA_SF_COMPLETA = {
  provider: "superfrete",
  credentials: {
    token: "tok-sf-SALVO-ficticio-nao-pode-viajar",
    sandbox: false,
    contact_email: "salvo@loja.com",
  },
};

describe("TransportadorasSection — e-mail de contato técnico da SuperFrete (1.5.5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    ordem.length = 0;
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"],
    };
    banco.linhas = [
      {
        provider: "melhor_envio",
        credentials: { token: "tok-me-SALVO-ficticio", sandbox: false },
      },
      { ...LINHA_SF_COMPLETA },
    ];
    banco.colunasPedidas = [];
    banco.upserts = [];
    updateConfig.mockImplementation(() => {
      ordem.push("updateConfig");
      return Promise.resolve(true);
    });
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      ordem.push(`invoke:${opcoes?.body?.action}`);
      if (opcoes?.body?.action === "save_credentials") {
        return Promise.resolve({
          data: {
            success: true,
            tem_chave: true,
            sandbox: false,
            contact_email: opcoes.body.credentials.contact_email,
          },
          error: null,
        });
      }
      return Promise.resolve({
        data: { success: true, message: "ok" },
        error: null,
      });
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

  const botao = (re: RegExp) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      re.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement | undefined;
  const campoToken = () =>
    hospedeiro.querySelector('input[type="password"]') as HTMLInputElement;
  const campoEmail = () =>
    hospedeiro.querySelector('input[type="email"]') as HTMLInputElement | null;
  const rodape = () => {
    const salvar = botao(/^Salvar$|Salvando/);
    return salvar?.parentElement?.textContent ?? "";
  };

  async function clicar(b: HTMLElement | undefined | null) {
    expect(b).toBeTruthy();
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

  async function digitar(campo: HTMLInputElement | null, valor: string) {
    expect(campo).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, valor);
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function escolherSuperFrete() {
    const opcao = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (el) => /SuperFrete/.test(el.textContent ?? ""),
    ) as HTMLElement;
    await clicar(opcao);
  }

  it("o campo de e-mail aparece SÓ com a SuperFrete escolhida, com a explicação, e vem preenchido com o e-mail salvo", async () => {
    await abrir();
    expect(campoEmail()).toBeNull();
    await escolherSuperFrete();
    const campo = campoEmail();
    expect(campo).not.toBeNull();
    expect(campo?.value).toBe("salvo@loja.com");
    expect(campo?.getAttribute("autocomplete")).toBe("email");
    expect(hospedeiro.textContent).toContain("E-mail de contato técnico");
    expect(hospedeiro.textContent).toContain(
      "A SuperFrete exige um e-mail para falar com quem cuida desta integração se algo der errado nas cotações. Use um e-mail seu que você lê. Ele não aparece para as clientes.",
    );
    // O e-mail SALVO igual ao do campo não suja a tela: só a troca de
    // transportadora está pendente.
    await clicar(
      [...hospedeiro.querySelectorAll('[role="radio"]')].find((el) =>
        /Melhor Envio/.test(el.textContent ?? ""),
      ) as HTMLElement,
    );
    expect(campoEmail()).toBeNull();
    expect(botao(/^Salvar$/)?.disabled).toBe(true);
  });

  it("a leitura nunca pede a coluna credentials inteira nem o token — o e-mail vem sozinho, por alias", async () => {
    await abrir();
    expect(banco.colunasPedidas.length).toBeGreaterThanOrEqual(3);
    for (const colunas of banco.colunasPedidas) {
      expect(colunas).not.toMatch(/\*/);
      expect(colunas).not.toMatch(/token/);
      // A única menção a `credentials` permitida é o caminho do e-mail.
      const semOEmail = colunas.replace(/\w+:credentials->>contact_email/g, "");
      expect(semOEmail).not.toMatch(/credentials/);
    }
    expect(banco.colunasPedidas).toContain(
      "provider, contato:credentials->>contact_email",
    );
    expect(hospedeiro.innerHTML).not.toContain(TOKEN_SF_SALVO);
  });

  it("e-mail inválido bloqueia Testar e Salvar, com aviso no campo — nada vai à edge nem ao config", async () => {
    const { toast } = await import("sonner");
    await abrir();
    await escolherSuperFrete();
    for (const invalido of ["sem-arroba", "a@b.com)", "joão@x.com", "   "]) {
      invoke.mockClear();
      updateConfig.mockClear();
      await digitar(campoEmail(), invalido);
      await clicar(botao(/^Testar$/));
      expect(invoke).not.toHaveBeenCalled();
      await clicar(botao(/^Salvar$/));
      expect(invoke).not.toHaveBeenCalled();
      expect(updateConfig).not.toHaveBeenCalled();
      expect(campoEmail()?.getAttribute("aria-invalid")).toBe("true");
    }
    expect(toast.error).toHaveBeenCalled();
    expect(hospedeiro.textContent).toMatch(/e-mail/i);
  });

  it("Testar com a chave salva manda o e-mail DO CAMPO junto (a edge monta o User-Agent com ele)", async () => {
    await abrir();
    await escolherSuperFrete();
    await digitar(campoEmail(), "  novo@loja.com ");
    await clicar(botao(/^Testar$/));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "test_credentials",
      provider: "superfrete",
      usarCredencialSalva: true,
      credentials: { contact_email: "novo@loja.com" },
    });
  });

  it("salvar com a chave VAZIA manda à edge só o e-mail (a chave salva continua) e depois ativa", async () => {
    await abrir();
    await escolherSuperFrete();
    await digitar(campoEmail(), "novo@loja.com");
    await clicar(botao(/^Salvar$/));
    expect(ordem).toEqual(["invoke:save_credentials", "updateConfig"]);
    expect(invoke.mock.calls[0][0]).toBe("calculate-shipping");
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "save_credentials",
      provider: "superfrete",
      credentials: { contact_email: "novo@loja.com" },
    });
    expect(updateConfig).toHaveBeenCalledWith({
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    });
    // A SuperFrete NUNCA grava direto na tabela pelo navegador.
    expect(banco.upserts).toHaveLength(0);
  });

  it("chave NOVA + e-mail: vão os dois (e o modo de testes) à edge, e a chave sai do estado depois de salva", async () => {
    await abrir();
    await escolherSuperFrete();
    await digitar(campoToken(), "tok-sf-NOVO-ficticio");
    await clicar(botao(/^Salvar$/));
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "save_credentials",
      provider: "superfrete",
      credentials: {
        token: "tok-sf-NOVO-ficticio",
        sandbox: false,
        contact_email: "salvo@loja.com",
      },
    });
    expect(campoToken().value).toBe("");
    expect(hospedeiro.innerHTML).not.toContain("tok-sf-NOVO-ficticio");
  });

  it("D1: salvar a SuperFrete chama a edge MESMO sem nada mudado nas credenciais", async () => {
    await abrir();
    await escolherSuperFrete();
    await clicar(botao(/^Salvar$/));
    expect(ordem).toEqual(["invoke:save_credentials", "updateConfig"]);
  });

  it("a edge FALHOU (rede) -> updateConfig NÃO é chamado e o provedor vivo não muda", async () => {
    const { toast } = await import("sonner");
    invoke.mockImplementation(() =>
      Promise.resolve({ data: null, error: new Error("Failed to fetch") }),
    );
    await abrir();
    await escolherSuperFrete();
    await clicar(botao(/^Salvar$/));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(rodape()).toMatch(/Ativo agora:\s*Melhor Envio/);
  });

  it("D4: a edge RECUSOU ({success:false, error}) -> a tela mostra a frase da edge e updateConfig NÃO é chamado", async () => {
    const { toast } = await import("sonner");
    invoke.mockImplementation(() =>
      Promise.resolve({
        data: {
          success: false,
          error: "Cole a chave de acesso da SuperFrete.",
        },
        error: null,
      }),
    );
    await abrir();
    await escolherSuperFrete();
    await clicar(botao(/^Salvar$/));
    expect(updateConfig).not.toHaveBeenCalled();
    const mensagens = [
      ...(toast.error as any).mock.calls.map((c: unknown[]) =>
        JSON.stringify(c),
      ),
      hospedeiro.textContent ?? "",
    ].join(" ");
    expect(mensagens).toContain("Cole a chave de acesso da SuperFrete.");
  });

  it("D1: estado local 'completo', mas a edge devolve contact_email null -> NÃO ativa, com o toast de completar", async () => {
    const { toast } = await import("sonner");
    invoke.mockImplementation(() =>
      Promise.resolve({
        data: {
          success: true,
          tem_chave: true,
          sandbox: false,
          contact_email: null,
        },
        error: null,
      }),
    );
    await abrir();
    await escolherSuperFrete();
    await clicar(botao(/^Salvar$/));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Para ativar a SuperFrete, cole a chave de acesso e preencha o e-mail de contato.",
    );
  });

  it("SuperFrete incompleta (edge diz que não há chave) -> NÃO ativa, com o toast de completar", async () => {
    const { toast } = await import("sonner");
    invoke.mockImplementation((_n: string, opcoes: any) =>
      Promise.resolve({
        data: {
          success: true,
          tem_chave: false,
          sandbox: false,
          contact_email: opcoes.body.credentials.contact_email,
        },
        error: null,
      }),
    );
    await abrir();
    await escolherSuperFrete();
    await clicar(botao(/^Salvar$/));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Para ativar a SuperFrete, cole a chave de acesso e preencha o e-mail de contato.",
    );
  });

  it("SuperFrete SEM e-mail no campo -> Salvar não vai à edge e pede para completar", async () => {
    const { toast } = await import("sonner");
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN_SF_SALVO, sandbox: false },
      },
    ];
    await abrir();
    await escolherSuperFrete();
    expect(campoEmail()?.value).toBe("");
    await clicar(botao(/^Salvar$/));
    expect(invoke).not.toHaveBeenCalled();
    expect(updateConfig).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Para ativar a SuperFrete, cole a chave de acesso e preencha o e-mail de contato.",
    );
  });

  it("edge salvou, mas o updateConfig falhou -> avisa que chave e e-mail ficaram salvos e a ativa NÃO mudou", async () => {
    const { toast } = await import("sonner");
    updateConfig.mockResolvedValue(false);
    await abrir();
    await escolherSuperFrete();
    await digitar(campoToken(), "tok-sf-NOVO-ficticio");
    await digitar(campoEmail(), "novo@loja.com");
    await clicar(botao(/^Salvar$/));
    expect(updateConfig).toHaveBeenCalledTimes(1);
    const avisos = (toast.error as any).mock.calls
      .map((c: unknown[]) => JSON.stringify(c))
      .join(" ");
    expect(avisos).toMatch(/salv/i);
    expect(avisos).toMatch(/não mudou/i);
    // O estado local acompanha o que a edge gravou: a chave saiu do campo e
    // o e-mail novo é o salvo (voltar ao ME e à SuperFrete não "suja" o e-mail).
    expect(campoToken().value).toBe("");
    expect(campoEmail()?.value).toBe("novo@loja.com");
  });

  it("Melhor Envio sem regressão: updateConfig ANTES do upsert (ADMIN-010), sem campo de e-mail e sem edge", async () => {
    await abrir();
    expect(campoEmail()).toBeNull();
    await digitar(campoToken(), "tok-me-NOVO-ficticio");
    await clicar(botao(/^Salvar$/));
    expect(ordem).toEqual(["updateConfig", "upsert"]);
    expect(invoke).not.toHaveBeenCalled();
    expect(banco.upserts[0].linha).toMatchObject({
      provider: "melhor_envio",
      credentials: { token: "tok-me-NOVO-ficticio", sandbox: false },
    });
    expect(banco.upserts[0].linha.credentials).not.toHaveProperty(
      "contact_email",
    );
  });

  it("'Ativo agora' mostra o provedor SALVO; com rascunho diferente aparece 'Selecionado (falta salvar)'", async () => {
    await abrir();
    expect(rodape()).toMatch(/Ativo agora:\s*Melhor Envio/);
    expect(rodape()).not.toMatch(/falta salvar/);
    await escolherSuperFrete();
    expect(rodape()).toMatch(/Ativo agora:\s*Melhor Envio/);
    expect(rodape()).toMatch(/Selecionado \(falta salvar\):\s*SuperFrete/);
    expect(rodape()).not.toMatch(/Ativo agora:\s*SuperFrete/);
  });

  it("SuperFrete SALVA como ativa, mas sem e-mail -> o rodapé avisa que as cotações de fora não saem", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    };
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN_SF_SALVO, sandbox: false },
      },
    ];
    await abrir();
    expect(rodape()).toMatch(/Ativo agora:\s*SuperFrete/);
    expect(rodape()).toMatch(/fora da cidade/i);
    expect(rodape()).toMatch(/e-mail/i);
  });

  it("controle: SuperFrete salva e COMPLETA não mostra o aviso de incompleta", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    };
    await abrir();
    expect(rodape()).toMatch(/Ativo agora:\s*SuperFrete/);
    expect(rodape()).not.toMatch(/fora da cidade/i);
  });

  it("nenhum texto da tela cita variável de ambiente", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    };
    banco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN_SF_SALVO, sandbox: false },
      },
    ];
    await abrir();
    expect(hospedeiro.textContent).not.toContain("SUPERFRETE_USER_AGENT");
    expect(hospedeiro.textContent).not.toMatch(
      /vari[aá]ve(l|is) (de|do) (ambiente|projeto)/i,
    );
  });
});
