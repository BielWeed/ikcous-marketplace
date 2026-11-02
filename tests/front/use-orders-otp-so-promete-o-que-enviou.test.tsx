// @vitest-environment jsdom
/**
 * `generateOrderOtp` depois da inversão (#161 + #86).
 *
 * O que se prova aqui é a TRADUÇÃO: a resposta HTTP da edge function vira um
 * booleano e uma mensagem. Antes desta mudança a função chamava a RPC e
 * devolvia `true` assim que a validação passava — muito antes de qualquer
 * e-mail existir. É esse `true` prematuro que a tela usava para escrever
 * "código de verificação enviado".
 *
 * Este projeto NÃO tem @testing-library/react (conferido no package.json em
 * 19/08/2026): os testes de front daqui montam com react-dom/client puro. Por
 * isso o hook se alcança por um componente-sonda, que só expõe a função.
 */
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const rpc = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke },
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ data: [], error: null }) }),
      }),
    }),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));
// O hook chama estes dois no corpo; sem eles a sonda não monta.
// `vi.hoisted`: a fábrica do mock sobe para o topo, então a conta atual tem de
// existir antes dela. Os testes de troca de conta mudam `auth.user`.
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: auth.user, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

type Gerar = (e: string, w: string, f: string) => Promise<boolean>;

let host: HTMLDivElement;
let raiz: Root;

/**
 * Duas restrições se cruzam aqui, e é por isso que a sonda tem esta forma:
 *
 * 1. O import de `@/hooks/useOrders` tem de ser DINÂMICO. `vi.mock` é içado
 *    para o topo do arquivo, então um import estático faria a fábrica do mock
 *    rodar antes de `const invoke = vi.fn()` existir — e o vitest morre com
 *    "Cannot access 'invoke' before initialization", sem coletar teste nenhum.
 * 2. A função tem de sair por um EFEITO, e não por atribuição a uma variável
 *    de fora durante a renderização: isso é efeito colateral em render, e a
 *    regra `react-hooks/globals` do projeto reprova — com razão.
 */
async function pegarGenerateOrderOtp(): Promise<Gerar> {
  const { useOrders } = await import("@/hooks/useOrders");

  function Sonda({ aoMontar }: { aoMontar: (g: Gerar) => void }) {
    const { generateOrderOtp } = useOrders(false, false);
    useEffect(() => {
      aoMontar(generateOrderOtp);
    }, [generateOrderOtp, aoMontar]);
    return null;
  }

  let gerar: Gerar | undefined;
  // Elemento NOVO a cada render: o React pula a renderização de um objeto de
  // elemento idêntico, e o hook nunca veria a conta nova.
  const elemento = () => (
    <Sonda
      aoMontar={(g) => {
        gerar = g;
      }}
    />
  );
  await act(async () => {
    raiz.render(elemento());
  });
  // Mesmo tipo de componente = mesma instância do hook (não remonta): serve
  // para o teste de troca de conta, que muda `auth.user` e re-renderiza.
  rerenderizar = async () => {
    await act(async () => {
      raiz.render(elemento());
    });
  };
  if (!gerar) throw new Error("a sonda não expôs generateOrderOtp");
  return gerar;
}

let rerenderizar: () => Promise<void> = async () => {};

describe("generateOrderOtp — o retorno segue o envio, não a validação", () => {
  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("chama a edge function, e NÃO a RPC", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await pegarGenerateOrderOtp();
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(invoke).toHaveBeenCalledWith("send-otp-email", {
      body: {
        email: "a@b.c",
        whatsapp: "34999999999",
        orderFragment: "abcdef",
      },
    });
    // A RPC continua existindo no banco, mas esta tela não a chama mais.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enviou: devolve true", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    const gerar = await pegarGenerateOrderOtp();
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(true);
  });

  it("envio falhou: devolve false e avisa que a loja não conseguiu enviar", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "envio_falhou" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Não conseguimos enviar",
    );
  });

  it("loja sem remetente configurado: também é falha de envio, não culpa de quem compra", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "sem_remetente" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain(
      "Não conseguimos enviar",
    );
  });

  it("dados não conferem: mensagem única, sem dizer qual metade errou", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "nao_confere" },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    // Distinguir "pedido não existe" de "e-mail não bate" diria a quem está
    // adivinhando qual metade ele já acertou (AUTH-010, #118).
    expect(String(toastError.mock.calls[0][0])).toContain(
      "e-mail, WhatsApp e ID juntos",
    );
  });

  it("pedido repetido cedo demais: diz quantos segundos esperar", async () => {
    invoke.mockResolvedValue({
      data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
      error: null,
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(String(toastError.mock.calls[0][0])).toContain("42");
  });

  it("a função nem respondeu (rede caiu): devolve false, nunca true", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new Error("Failed to fetch"),
    });
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("invoke lançou exceção: devolve false, nunca true", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

/**
 * A mensagem de "muito recente" depois de um envio que FALHOU (02/11/2026).
 *
 * A edge grava o código e a janela de 60 s ANTES do SMTP, e não os desfaz se o
 * SMTP falha (desfazer tira o freio e deixaria uma pane queimar os tetos de
 * 24 h da cliente). Então quem tenta de novo em seguida recebe `muito_recente`
 * — e dizer "Já enviamos um código, confira sua caixa de entrada" seria
 * mentira: o último envio falhou. A tela lembra a falha, por pedido, e só nesse
 * caso troca a frase. O contrato com a edge é o mesmo.
 */
describe("generateOrderOtp — muito_recente depois de um envio que falhou", () => {
  const FALHOU = { data: { ok: false, motivo: "envio_falhou" }, error: null };
  const MUITO_RECENTE = {
    data: { ok: false, motivo: "muito_recente", espereSegundos: 42 },
    error: null,
  };
  const textoDoUltimoToast = () =>
    String(toastError.mock.calls[toastError.mock.calls.length - 1][0]);

  /** O 502 real: `invoke` descarta o corpo e entrega um erro com `context`. */
  const erroHttp502 = (corpo: unknown) => ({
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx"), {
      context: { json: async () => corpo },
    }),
  });

  beforeEach(() => {
    invoke.mockReset();
    rpc.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    auth.user = null;
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("falhou e a tentativa seguinte caiu no freio: a frase é verdadeira, sem 'já enviamos' nem 'caixa de entrada'", async () => {
    invoke.mockResolvedValueOnce(FALHOU).mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(false);

    const texto = textoDoUltimoToast();
    expect(texto).toContain("Ainda não conseguimos enviar");
    expect(texto).not.toMatch(/já enviamos|caixa de entrada/i);
    // Não promete o tempo exato.
    expect(texto).not.toContain("42");
  });

  it("o 502 REAL (erro HTTP sem data, motivo só no corpo) também conta como falha lembrada", async () => {
    invoke
      .mockResolvedValueOnce(erroHttp502({ ok: false, motivo: "envio_falhou" }))
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(textoDoUltimoToast()).toContain("Ainda não conseguimos enviar");
  });

  it("nenhuma falha anterior: o 'já enviamos' de sempre, com os segundos", async () => {
    invoke.mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");

    const texto = textoDoUltimoToast();
    expect(texto).toContain("Já enviamos um código há pouco");
    expect(texto).toContain("42");
    expect(texto).toContain("caixa de entrada");
  });

  it("o último envio deu certo: o 'já enviamos' continua valendo", async () => {
    invoke
      .mockResolvedValueOnce(FALHOU)
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    expect(await gerar("a@b.c", "34999999999", "abcdef")).toBe(true);
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });

  it("a falha de um pedido não contamina outro", async () => {
    invoke.mockResolvedValueOnce(FALHOU).mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    await gerar("outra@pessoa.com", "34888888888", "123456");

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });

  it("falha de rede (sem resposta da função) NÃO vira falha lembrada: pode haver código enviado antes", async () => {
    invoke
      .mockResolvedValueOnce({
        data: null,
        error: new Error("Failed to fetch"),
      })
      .mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });

  it("depois de 60 s a falha lembrada vence: o freio de agora é de outro envio", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    invoke.mockResolvedValueOnce(FALHOU).mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    vi.setSystemTime(new Date("2026-11-02T12:01:01Z"));
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });

  it("troca de conta apaga a memória da falha", async () => {
    invoke.mockResolvedValueOnce(FALHOU).mockResolvedValueOnce(MUITO_RECENTE);
    const gerar = await pegarGenerateOrderOtp();

    await gerar("a@b.c", "34999999999", "abcdef");
    auth.user = { id: "outra-conta" };
    await rerenderizar();
    await gerar("a@b.c", "34999999999", "abcdef");

    expect(textoDoUltimoToast()).toContain("Já enviamos um código há pouco");
  });
});
