// @vitest-environment jsdom
//
// RELEASE 1.5.4 — SuperFrete e a chave de acesso SÓ-ESCRITA no painel.
//
// Até a 1.5.3 a seção "Transportadoras" (Ajustes) fazia
// `select("*")` em `store_shipping_credentials` e guardava o JSON inteiro —
// o token da conta REAL do Melhor Envio/Frenet — no estado React e no campo
// de senha, só para mostrá-lo de volta. A tela de Frete já tinha deixado de
// baixar o token (AdminShippingView-126); esta seção era a última porta.
//
// O que este arquivo prende:
//   1. nenhuma consulta pede a coluna `credentials` (nem "*") — o navegador
//      recebe só `provider` das linhas filtradas NO BANCO;
//   2. o token salvo nunca aparece no DOM; o campo nasce VAZIO e a tela diz
//      "chave salva" (só quando há token de verdade);
//   3. Salvar só grava credencial quando uma chave NOVA foi digitada
//      (`{ token, sandbox }`), e não troca o provedor sozinho;
//   4. "Testar" sem chave digitada pede à edge a chave SALVA
//      (`usarCredencialSalva: true`, sem `credentials` no corpo);
//   5. o Melhor Envio continua salvando e testando igual (sem regressão);
//   6. a SuperFrete existe como opção, com rótulo e aviso honestos.
//
// AJUSTES DA 1.5.5 (e-mail de contato técnico da SuperFrete, preenchido na
// tela — ver transportadoras-superfrete-email-contato.test.tsx):
//   - a seção faz uma TERCEIRA leitura, que pede só o e-mail por alias
//     (`contato:credentials->>contact_email`, com `.eq("provider", …)`); o
//     item 1 passou a aceitar esse caminho e continua recusando a coluna
//     inteira, "*" e qualquer menção a token. O mini-PostgREST abaixo ganhou
//     o filtro por `provider` e a projeção por alias para isso;
//   - salvar a SUPERFRETE não segue mais a ordem ADMIN-010 (updateConfig ->
//     upsert pelo navegador): a credencial vai PRIMEIRO pela edge
//     (`save_credentials`) e o provedor só muda se ela disser que ficou
//     completo — ativar a SuperFrete antes de saber se há chave + e-mail
//     deixava a loja "ativa" sem cotação. ME/Frenet continuam ADMIN-010;
//   - "Testar" da SuperFrete leva o e-mail do campo junto.
//
// Tokens abaixo são FICTÍCIOS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TOKEN_ME_SALVO, estadoDaLoja, banco, invoke, updateConfig } =
  vi.hoisted(() => {
    const TOKEN_ME_SALVO = "tok-me-SALVO-ficticio-nao-pode-viajar";
    return {
      TOKEN_ME_SALVO,
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
    };
  });

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// O builder do PostgREST em miniatura: `.not/.neq/.eq` filtram NO "banco"
// (como o Postgres faria com `credentials->>campo`) e a projeção obedece às
// colunas pedidas — pedir "credentials" ou "*" devolveria o token, e é isso
// que a asserção sobre `colunasPedidas` impede.
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
        // 1.5.5: filtro pela coluna `provider` (a leitura do e-mail).
        if (coluna === "provider") return l.provider;
        const m = /^credentials->>(\w+)$/.exec(coluna);
        if (!m) return undefined;
        const v = l.credentials?.[m[1]];
        return v == null ? null : String(v);
      };
      const consulta = (colunas: string, linhas: Linha[]): any =>
        Object.assign(
          Promise.resolve({
            data: linhas.map((l) => {
              const saida: Record<string, unknown> = {};
              for (const c of colunas.split(",").map((x) => x.trim())) {
                if (c === "provider") saida.provider = l.provider;
                // 1.5.5: alias `nome:credentials->>campo` devolve SÓ o campo.
                const alias = /^(\w+):credentials->>(\w+)$/.exec(c);
                if (alias) {
                  const v = l.credentials?.[alias[2]];
                  saida[alias[1]] = v == null ? null : String(v);
                } else if (c === "*" || c.includes("credentials")) {
                  saida.credentials = l.credentials;
                }
              }
              return saida;
            }),
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

describe("TransportadorasSection — chave só-escrita e SuperFrete (1.5.4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac"],
    };
    banco.linhas = [
      {
        provider: "melhor_envio",
        credentials: { token: TOKEN_ME_SALVO, sandbox: false },
      },
    ];
    banco.colunasPedidas = [];
    banco.upserts = [];
    updateConfig.mockResolvedValue(true);
    invoke.mockResolvedValue({
      data: { success: true, message: "ok" },
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

  async function clicar(b: HTMLElement | undefined) {
    expect(b).toBeDefined();
    await act(async () => {
      b?.click();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function digitarToken(valor: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoToken(), valor);
      campoToken().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("nenhuma consulta pede a coluna credentials (nem '*'): o token não sai do banco", async () => {
    await abrir();
    expect(banco.colunasPedidas.length).toBeGreaterThan(0);
    for (const colunas of banco.colunasPedidas) {
      // 1.5.5: a ÚNICA menção a `credentials` aceita é o caminho do e-mail
      // de contato por alias — o PostgREST devolve só aquele texto.
      expect(
        colunas.replace(/\w+:credentials->>contact_email/g, ""),
      ).not.toMatch(/credentials/);
      expect(colunas).not.toMatch(/token/);
      expect(colunas).not.toMatch(/\*/);
    }
  });

  it("o token salvo nunca aparece no DOM; o campo nasce vazio com o selo 'chave salva'", async () => {
    await abrir();
    expect(hospedeiro.innerHTML).not.toContain(TOKEN_ME_SALVO);
    expect(campoToken().value).toBe("");
    expect(campoToken().disabled).toBe(false);
    expect(hospedeiro.textContent).toMatch(/chave salva/i);
  });

  it("linha SEM token (credentials: {}) não ganha o selo — presença de linha não basta", async () => {
    banco.linhas = [{ provider: "melhor_envio", credentials: {} }];
    await abrir();
    expect(hospedeiro.textContent).not.toMatch(/chave salva/i);
    // E sem chave nenhuma não há o que testar.
    expect(botao(/^Testar$/)?.disabled).toBe(true);
  });

  it("salvar só os serviços NÃO regrava a credencial (nada de token velho voltando ao banco)", async () => {
    await abrir();
    await clicar(botao(/^jadlog$/));
    await clicar(botao(/Salvar/));
    expect(updateConfig).toHaveBeenCalledWith({
      shippingProvider: "melhor_envio",
      enabledShippingMethods: ["sedex", "pac", "jadlog"],
    });
    expect(banco.upserts).toHaveLength(0);
  });

  it("Melhor Envio sem regressão: chave NOVA digitada é gravada ({token, sandbox}) e sai do estado depois de salva", async () => {
    await abrir();
    await digitarToken("tok-me-NOVO-ficticio");
    await clicar(botao(/Salvar/));
    expect(banco.upserts).toHaveLength(1);
    expect(banco.upserts[0].linha).toMatchObject({
      provider: "melhor_envio",
      credentials: { token: "tok-me-NOVO-ficticio", sandbox: false },
    });
    expect(banco.upserts[0].opcoes).toEqual({ onConflict: "provider" });
    // Depois de salvar, a chave não fica parada no campo nem no DOM.
    expect(campoToken().value).toBe("");
    expect(hospedeiro.innerHTML).not.toContain("tok-me-NOVO-ficticio");
    expect(hospedeiro.textContent).toMatch(/chave salva/i);
  });

  it("Testar SEM chave digitada pede à edge a chave SALVA — o navegador não manda token nenhum", async () => {
    await abrir();
    await clicar(botao(/^Testar$/));
    expect(invoke).toHaveBeenCalledTimes(1);
    const [nome, opcoes] = invoke.mock.calls[0];
    expect(nome).toBe("calculate-shipping");
    expect(opcoes.body).toEqual({
      action: "test_credentials",
      provider: "melhor_envio",
      usarCredencialSalva: true,
    });
  });

  it("Testar COM chave digitada (antes de salvar) manda a chave digitada", async () => {
    await abrir();
    await digitarToken("tok-me-DIGITADO-ficticio");
    await clicar(botao(/^Testar$/));
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "test_credentials",
      provider: "melhor_envio",
      credentials: { token: "tok-me-DIGITADO-ficticio", sandbox: false },
    });
  });

  it("a SuperFrete é uma opção; escolhê-la NÃO troca o provedor da loja até salvar", async () => {
    await abrir();
    const opcao = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (el) => /SuperFrete/.test(el.textContent ?? ""),
    ) as HTMLElement | undefined;
    await clicar(opcao);
    expect(opcao?.getAttribute("aria-checked")).toBe("true");
    expect(updateConfig).not.toHaveBeenCalled();
    // Sem chave salva da SuperFrete: nada de selo, e o aviso honesto do teste.
    expect(hospedeiro.textContent).not.toMatch(/chave salva/i);
    expect(hospedeiro.textContent).toMatch(/Chave de acesso — SuperFrete/);
    expect(hospedeiro.textContent).toMatch(/cota(ção|r) de verdade/i);
  });

  // 1.5.5 — ORDEM NOVA para a SuperFrete (era: updateConfig -> upsert pelo
  // navegador, a ordem ADMIN-010). Motivo: a SuperFrete só cota com chave E
  // e-mail de contato, e o e-mail é validado no SERVIDOR; trocar o provedor
  // primeiro deixava a loja "ativa" na SuperFrete sem ter como cotar. Agora a
  // credencial vai pela edge (`save_credentials`) e o provedor só muda depois,
  // se a edge confirmar chave + e-mail. O navegador não grava mais a linha
  // 'superfrete' direto. (ME/Frenet: ADMIN-010 intacta, teste acima.)
  it("SuperFrete: salvar com chave digitada grava a credencial PELA EDGE primeiro e só depois troca o provedor (updateConfig)", async () => {
    const ordem: string[] = [];
    invoke.mockImplementation((_nome: string, opcoes: any) => {
      ordem.push("edge");
      return Promise.resolve({
        data: {
          success: true,
          tem_chave: true,
          sandbox: false,
          contact_email: opcoes.body.credentials.contact_email,
        },
        error: null,
      });
    });
    updateConfig.mockImplementation(() => {
      ordem.push("updateConfig");
      return Promise.resolve(true);
    });
    await abrir();
    const opcao = [...hospedeiro.querySelectorAll('[role="radio"]')].find(
      (el) => /SuperFrete/.test(el.textContent ?? ""),
    ) as HTMLElement;
    await clicar(opcao);
    await digitarToken("tok-sf-NOVO-ficticio");
    const campoEmail = hospedeiro.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campoEmail, "tecnico@loja.com");
      campoEmail.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar(botao(/Salvar/));
    expect(ordem).toEqual(["edge", "updateConfig"]);
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "save_credentials",
      provider: "superfrete",
      credentials: {
        token: "tok-sf-NOVO-ficticio",
        sandbox: false,
        contact_email: "tecnico@loja.com",
      },
    });
    expect(updateConfig).toHaveBeenCalledWith({
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    });
    expect(banco.upserts).toHaveLength(0);
  });

  it("SuperFrete já salva: selo 'chave salva' e o teste usa a chave salva", async () => {
    estadoDaLoja.atual = {
      shippingProvider: "superfrete",
      enabledShippingMethods: ["sedex", "pac"],
    };
    banco.linhas = [
      ...banco.linhas,
      {
        provider: "superfrete",
        // 1.5.5: a linha salva tem o e-mail de contato técnico.
        credentials: {
          token: "tok-sf-x",
          sandbox: true,
          contact_email: "salvo@loja.com",
        },
      },
    ];
    await abrir();
    expect(hospedeiro.textContent).toMatch(/chave salva/i);
    expect(hospedeiro.innerHTML).not.toContain("tok-sf-x");
    // O modo de testes salvo aparece ligado (lido pelo filtro, não pelo token).
    const interruptor = hospedeiro.querySelector('[role="switch"]');
    expect(interruptor?.getAttribute("aria-checked")).toBe("true");
    await clicar(botao(/^Testar$/));
    // 1.5.5: o teste da SuperFrete leva o e-mail do campo (a edge monta o
    // User-Agent com ele); o token continua NÃO indo.
    expect(invoke.mock.calls[0][1].body).toEqual({
      action: "test_credentials",
      provider: "superfrete",
      usarCredencialSalva: true,
      credentials: { contact_email: "salvo@loja.com" },
    });
  });

  it("trocar o modo de testes SEM colar a chave do outro ambiente não grava nada (as chaves são por ambiente)", async () => {
    const { toast } = await import("sonner");
    await abrir();
    const interruptor = hospedeiro.querySelector(
      '[role="switch"]',
    ) as HTMLElement;
    await clicar(interruptor);
    await clicar(botao(/Salvar/));
    expect(updateConfig).not.toHaveBeenCalled();
    expect(banco.upserts).toHaveLength(0);
    expect(toast.error).toHaveBeenCalled();
  });
});
