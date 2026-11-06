// @vitest-environment jsdom
//
// O modelo pronto "Cupom de R$20" preenchia "Use o cupom BEMVINDO" e o
// "Desconto Relâmpago" prometia "10% OFF ativo por 1 hora" — sem que a loja
// tivesse criado cupom nenhum. A lojista clicava no modelo, enviava na
// primeira campanha, e a cliente digitava BEMVINDO e lia "O cupom BEMVINDO
// não existe". Aqui se prende, na tela de verdade:
//   1. o modelo NÃO traz código fixo nem desconto inventado: traz o marcador;
//   2. o envio fica travado, com o motivo na cara, enquanto o marcador
//      estiver no texto;
//   3. citar um código que a loja não tem (ou que está desligado) avisa
//      antes de sair — e o segundo toque, de quem sabe o que faz, envia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmarEnvioSePerguntar } from "./confirma-envio-para-todos";

const { estado } = vi.hoisted(() => ({
  estado: {
    cupons: [] as Record<string, unknown>[],
    erroDosCupons: null as null | { message: string },
    consultasDeCupom: [] as unknown[],
    colunasPedidas: [] as string[],
    // Banco de loja de teste, sem a coluna `coupons.alcance`: pedir a coluna
    // responde 42703 (undefined_column), como o PostgREST.
    bancoSemAlcance: false,
    cuponsLigadosNaLoja: true,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      realTimeSalesAlerts: false,
      enableCoupons: estado.cuponsLigadosNaLoja,
    },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const invokeSendPush = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () => Promise.resolve({ count: 3, error: null }),
        };
      }
      if (tabela === "coupons") {
        return {
          select: (colunas: string) => ({
            // A tela pede os códigos num filtro `or` de `ilike` (sem diferenciar
            // maiúscula, como o checkout): o dublê lê o filtro e compara igual.
            or: (filtro: string) => {
              const codigos = filtro
                .split(",")
                .map((parte) => parte.replace(/^code\.ilike\./, ""));
              estado.consultasDeCupom.push(codigos);
              estado.colunasPedidas.push(colunas);
              if (estado.bancoSemAlcance && /alcance/.test(colunas)) {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: "42703",
                    message: "column coupons.alcance does not exist",
                  },
                });
              }
              if (estado.erroDosCupons) {
                return Promise.resolve({
                  data: null,
                  error: estado.erroDosCupons,
                });
              }
              const minusculas = codigos.map((c) => c.toLowerCase());
              // O banco só devolve as colunas pedidas: sem `alcance` no
              // select, a linha chega sem ele (o dublê não pode "ajudar").
              const pediuAlcance = /alcance/.test(colunas);
              return Promise.resolve({
                data: estado.cupons
                  .filter((c) =>
                    minusculas.includes(String(c.code).toLowerCase()),
                  )
                  .map(({ alcance: _alcance, ...resto }) =>
                    pediuAlcance ? { ...resto, alcance: _alcance } : resto,
                  ),
                error: null,
              });
            },
          }),
        };
      }
      if (tabela === "public_profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({ data: { full_name: "Ana" }, error: null }),
            }),
          }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "log-1" }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (tabela === "notificacoes") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () =>
              Object.assign(Promise.resolve({ data: [], error: null }), {
                range: () => Promise.resolve({ data: [], error: null }),
              }),
          }),
        }),
      };
    },
    rpc: (...a: any[]) => {
      // O envio lê os aparelhos em páginas de 1.000 (`.order().range()`).
      const r = Reflect.apply(
        (nome: string) => {
          const alvos = [
            { user_id: "u1", endpoint: "e1", p256dh: "p1", auth: "a1" },
            { user_id: "u2", endpoint: "e2", p256dh: "p2", auth: "a2" },
            { user_id: "u3", endpoint: "e3", p256dh: "p3", auth: "a3" },
          ];
          if (nome === "get_segmented_push_count") {
            return Promise.resolve({ data: alvos.length, error: null });
          }
          if (nome === "get_segmented_push_targets") {
            return Promise.resolve({ data: alvos, error: null });
          }
          return Promise.resolve({ data: null, error: new Error("rpc?") });
        },
        null,
        a,
      );
      return Object.assign(r, { order: () => r, range: () => r });
    },
    functions: { invoke: invokeSendPush },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — modelo pronto não promete cupom que a loja não criou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeSendPush.mockResolvedValue({
      data: { enviados: 3, falharam: 0, falhas: [] },
      error: null,
    });
    estado.cupons = [];
    estado.erroDosCupons = null;
    estado.consultasDeCupom = [];
    estado.colunasPedidas = [];
    estado.bancoSemAlcance = false;
    estado.cuponsLigadosNaLoja = true;

    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

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

  async function abrirTela(targetUserId?: string) {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(
        <AdminPushView onNavigate={vi.fn()} targetUserId={targetUserId} />,
      );
    });
    await act(async () => {
      await esperar(80);
    });
  }

  function digitar(
    elemento: HTMLInputElement | HTMLTextAreaElement,
    valor: string,
  ) {
    const prototipo =
      elemento instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(
      elemento,
      valor,
    );
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const campoTitulo = () =>
    hospedeiro.querySelector<HTMLInputElement>("#push-title")!;
  const campoCorpo = () =>
    hospedeiro.querySelector<HTMLTextAreaElement>("#push-body")!;

  async function escrever(titulo: string, corpo: string) {
    await act(async () => {
      digitar(campoTitulo(), titulo);
      digitar(campoCorpo(), corpo);
    });
    await act(async () => {
      await esperar(260);
    });
  }

  async function clicarModelo(trecho: string) {
    const pilula = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(trecho),
    );
    expect(pilula).toBeTruthy();
    await act(async () => {
      pilula!.click();
    });
    await act(async () => {
      await esperar(40);
    });
  }

  const botaoEnviar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Enviar agora para"),
    ) as HTMLButtonElement;

  async function enviar() {
    await act(async () => {
      botaoEnviar().click();
    });
    await confirmarEnvioSePerguntar();
    await act(async () => {
      await esperar(80);
    });
  }

  it("o modelo de cupom de boas-vindas traz o marcador, nunca BEMVINDO nem R$20", async () => {
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");

    const tudo = `${campoTitulo().value} ${campoCorpo().value}`;
    expect(tudo).toContain("[CÓDIGO DO SEU CUPOM]");
    expect(tudo).not.toMatch(/BEMVINDO/i);
    expect(tudo).not.toMatch(/R\$\s*\d/);
  });

  it("o modelo de oferta não promete 10% OFF nem relógio", async () => {
    await abrirTela();
    await clicarModelo("Oferta com cupom");

    const tudo = `${campoTitulo().value} ${campoCorpo().value}`;
    expect(tudo).toContain("[CÓDIGO DO SEU CUPOM]");
    expect(tudo).not.toMatch(/10\s*%/);
    expect(tudo).not.toMatch(/1 hora/i);
  });

  it("com o marcador no texto o envio fica travado, com o motivo na tela", async () => {
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");

    expect(botaoEnviar().disabled).toBe(true);
    const aviso = hospedeiro.querySelector(
      '[data-testid="aviso-codigo-pendente"]',
    );
    expect(aviso).toBeTruthy();
    expect(aviso?.textContent).toMatch(/Cupons/);
    expect(aviso?.textContent).toContain("[CÓDIGO DO SEU CUPOM]");

    // mesmo forçando o clique, nada sai
    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
  });

  it("o modelo do carrinho (sem cupom) não trava nada", async () => {
    await abrirTela();
    await clicarModelo("Lembrete de Carrinho");

    expect(
      hospedeiro.querySelector('[data-testid="aviso-codigo-pendente"]'),
    ).toBeNull();
    expect(botaoEnviar().disabled).toBe(false);
  });

  it("trocar o marcador por um cupom que existe libera e envia", async () => {
    estado.cupons = [
      {
        code: "VERAO10",
        active: true,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");
    await escrever("Oferta na loja", "Use o cupom VERAO10 na sua compra.");

    expect(botaoEnviar().disabled).toBe(false);
    expect(
      hospedeiro.querySelector('[data-testid="aviso-codigo-pendente"]'),
    ).toBeNull();

    await enviar();
    expect(estado.consultasDeCupom).toEqual([["VERAO10"]]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("cupom antigo guardado em caixa mista é achado, não vira 'não existe'", async () => {
    estado.cupons = [
      {
        code: "Verao10",
        active: true,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await clicarModelo("Cupom de boas-vindas");
    await escrever("Oferta na loja", "Use o cupom VERAO10 na sua compra.");

    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("citar um código que a loja não criou avisa antes de enviar", async () => {
    estado.cupons = [];
    await abrirTela();
    await escrever("Presente para você", "Use o cupom BEMVINDO e economize.");

    await enviar();

    expect(invokeSendPush).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    const chamada = (toast.error as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        /BEMVINDO/.test(String(c[0]) + String(JSON.stringify(c[1]))),
    );
    expect(chamada).toBeTruthy();
  });

  it("cupom desligado também avisa; o segundo toque, de quem sabe o que faz, envia", async () => {
    estado.cupons = [
      {
        code: "VERAO10",
        active: false,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();

    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("com a chave geral de cupons desligada, citar um cupom bom avisa antes de enviar", async () => {
    estado.cuponsLigadosNaLoja = false;
    estado.cupons = [
      {
        code: "VERAO10",
        active: true,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    const chamada = (toast.error as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) =>
        /Os cupons de desconto estão desligados na sua loja\. Ligue em Cupons/.test(
          String(c[0]),
        ),
    );
    expect(chamada).toBeTruthy();

    // mesmo comportamento dos outros avisos: o segundo toque envia
    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("com a chave geral de cupons desligada, texto sem cupom citado envia sem aviso", async () => {
    estado.cuponsLigadosNaLoja = false;
    await abrirTela();
    await escrever("Novidades", "Chegaram produtos novos na loja.");

    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("se não deu para conferir o cupom, não envia calado: avisa", async () => {
    estado.erroDosCupons = { message: "rede caiu" };
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
  });

  const cupomExclusivo = {
    code: "VERAO10",
    active: true,
    valid_until: null,
    usage_limit: null,
    usage_count: 0,
    alcance: "exclusivo",
  };

  async function avisosDeErro() {
    const { toast } = await import("sonner");
    return (toast.error as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
  }

  it("cupom exclusivo citado num aviso para todos avisa antes de enviar; o segundo toque envia", async () => {
    estado.cupons = [cupomExclusivo];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(await avisosDeErro()).toContainEqual(
      expect.stringContaining("O cupom VERAO10 é exclusivo de clientes"),
    );

    await enviar();
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("cupom exclusivo citado em mensagem para UM cliente não avisa", async () => {
    estado.cupons = [cupomExclusivo];
    await abrirTela("u1");
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(await avisosDeErro()).toEqual([]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("banco sem a coluna alcance: refaz a consulta sem ela, confere o resto e não vira 'não consegui conferir'", async () => {
    estado.bancoSemAlcance = true;
    estado.cupons = [
      {
        code: "VERAO10",
        active: true,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(estado.colunasPedidas).toHaveLength(2);
    expect(estado.colunasPedidas[0]).toContain("alcance");
    expect(estado.colunasPedidas[1]).not.toContain("alcance");
    expect(await avisosDeErro()).toEqual([]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });

  it("banco sem a coluna alcance continua achando os outros problemas do cupom", async () => {
    estado.bancoSemAlcance = true;
    estado.cupons = [
      {
        code: "VERAO10",
        active: false,
        valid_until: null,
        usage_limit: null,
        usage_count: 0,
      },
    ];
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(await avisosDeErro()).toContainEqual(
      expect.stringContaining("O cupom VERAO10 está desativado"),
    );
  });

  it("outro erro (rede) na consulta com alcance NÃO é tratado como banco antigo: continua avisando que não conferiu", async () => {
    estado.erroDosCupons = { message: "rede caiu" };
    await abrirTela();
    await escrever("Oferta", "Use o cupom VERAO10 hoje.");

    await enviar();
    expect(estado.colunasPedidas).toHaveLength(1);
    expect(invokeSendPush).not.toHaveBeenCalled();
    expect(await avisosDeErro()).toContainEqual(
      expect.stringContaining("Não consegui conferir"),
    );
  });

  it("texto sem cupom citado nem consulta a tabela de cupons", async () => {
    await abrirTela();
    await escrever("Novidades", "Chegaram produtos novos na loja.");

    await enviar();
    expect(estado.consultasDeCupom).toEqual([]);
    expect(invokeSendPush).toHaveBeenCalledTimes(1);
  });
});
