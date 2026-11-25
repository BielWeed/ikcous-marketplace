// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), cartão "Avisos de pedido novo neste
// aparelho" do Início. O teste vizinho prende o fluxo principal; ficavam soltos
// (defeitos de UMA linha):
//  - depois de uma tentativa que FALHOU, tocar em Ligar de novo funciona (a
//    trava de toque duplo é solta) e o erro antigo some enquanto liga;
//  - as frases do erro ao ligar: "não foi possível" (o hook devolveu nada), a
//    frase genérica quando a mensagem vem vazia ou quando o erro nem é um
//    `Error` (texto cru nunca chega à tela);
//  - o aviso de teste sem internet (e sem chamar o servidor), o texto que o
//    teste leva e o que a resposta com ERRO significa (erro ganha de
//    "enviados"; uma falha sem confirmação entre outras já é "sem
//    confirmação");
//  - a barrinha de "ligando" e a frase de "sem internet" no cartão de ligar;
//  - os passos de liberar no iPhone instalado (Ajustes) — não os do Chrome;
//  - ao voltar para a tela: quando a permissão do navegador difere da do
//    hook o cartão é RECONSTRUÍDO (esquece o erro antigo); quando já bate, o
//    erro fica; e sem `Notification` no navegador nada quebra.
// Dados inventados; nenhuma chamada de rede.
import { passosParaLiberarOsAvisos } from "@/lib/avisos-do-aparelho";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({
  estado: {} as Record<string, unknown>,
  subscribe: vi.fn(),
}));
const auth = vi.hoisted(() => ({ isAdmin: true }));
const rede = vi.hoisted(() => ({ offline: false }));
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ ...hook.estado, subscribe: hook.subscribe }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => rede.offline,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LIGAR = "Ligar avisos neste aparelho";
const TESTE = "Mandar um aviso de teste";
const HOJE = new Date("2026-10-14T12:00:00Z");
const USER_AGENT_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

function inscricaoDeTeste() {
  return {
    endpoint: "https://push.exemplo.test/abc",
    toJSON: () => ({
      endpoint: "https://push.exemplo.test/abc",
      keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
    }),
  } as unknown as PushSubscription;
}

function aparelhoSemAviso(extra: Record<string, unknown> = {}) {
  hook.estado = {
    isSupported: true,
    permission: "default",
    subscription: null,
    semConta: false,
    sondado: true,
    ...extra,
  };
}

function erroDoHook(mensagem: string) {
  return Object.assign(new Error(mensagem), { name: "PushSubscribeError" });
}

describe("CartaoDeAvisosDoAparelho: buracos de mutação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HOJE);
    localStorage.clear();
    hook.subscribe.mockReset();
    invoke.mockReset();
    auth.isAdmin = true;
    rede.offline = false;
    aparelhoSemAviso();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const nome of ["userAgent", "platform", "maxTouchPoints"]) {
      Reflect.deleteProperty(navigator, nome);
    }
  });

  async function montar() {
    const { CartaoDeAvisosDoAparelho } = await import(
      "@/components/admin/inicio/CartaoDeAvisosDoAparelho"
    );
    await act(async () => {
      raiz.render(<CartaoDeAvisosDoAparelho />);
    });
    return CartaoDeAvisosDoAparelho;
  }

  async function redesenhar(Cartao: Awaited<ReturnType<typeof montar>>) {
    await act(async () => {
      raiz.render(<Cartao />);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const alerta = () => hospedeiro.querySelector('[role="alert"]');
  const status = () => hospedeiro.querySelector('[role="status"]');
  function botao(nome: string): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) =>
        (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === nome,
    );
  }
  async function tocar(nome: string) {
    const alvo = botao(nome);
    if (!alvo) throw new Error(`botão "${nome}" não encontrado: ${texto()}`);
    await act(async () => {
      alvo.click();
    });
  }

  describe("ligar depois de uma falha", () => {
    it("a primeira tentativa falha, a segunda funciona: a trava de toque duplo foi solta", async () => {
      hook.subscribe
        .mockRejectedValueOnce(erroDoHook("Toque de novo e escolha Permitir."))
        .mockResolvedValueOnce(inscricaoDeTeste());
      await montar();

      await tocar(LIGAR);
      expect(alerta()?.textContent).toBe("Toque de novo e escolha Permitir.");

      await tocar(LIGAR);
      expect(hook.subscribe).toHaveBeenCalledTimes(2);
      expect(texto()).toContain("Avisos ligados neste aparelho");
    });

    it("enquanto a nova tentativa espera a resposta, o erro antigo some e a barrinha aparece", async () => {
      let resolver!: (inscricao: PushSubscription) => void;
      hook.subscribe
        .mockRejectedValueOnce(erroDoHook("Toque de novo e escolha Permitir."))
        .mockImplementationOnce(
          () =>
            new Promise<PushSubscription>((resolve) => {
              resolver = resolve;
            }),
        );
      await montar();
      await tocar(LIGAR);
      expect(alerta()).not.toBeNull();
      expect(hospedeiro.querySelector(".animate-pulse")).toBeNull();

      await tocar(LIGAR);
      expect(botao("Ligando...")?.disabled).toBe(true);
      expect(alerta()).toBeNull();
      expect(hospedeiro.querySelector(".animate-pulse")).not.toBeNull();

      await act(async () => {
        resolver(inscricaoDeTeste());
      });
      expect(texto()).toContain("Avisos ligados neste aparelho");
    });
  });

  describe("frases do erro ao ligar", () => {
    it("o hook não devolve inscrição: 'Não foi possível ligar os avisos agora.'", async () => {
      hook.subscribe.mockResolvedValue(undefined);
      await montar();
      await tocar(LIGAR);
      expect(alerta()?.textContent).toBe(
        "Não foi possível ligar os avisos agora.",
      );
    });

    it("erro do hook com mensagem em branco: frase genérica, não o vazio", async () => {
      hook.subscribe.mockRejectedValue(erroDoHook("   "));
      await montar();
      await tocar(LIGAR);
      expect(alerta()?.textContent).toBe(
        "Os avisos não foram ligados. Tente de novo em instantes.",
      );
    });

    it("rejeição que nem é um Error (mesmo com o nome certo): texto cru não chega à tela", async () => {
      hook.subscribe.mockRejectedValue({
        name: "PushSubscribeError",
        message: "texto cru do navegador",
      });
      await montar();
      await tocar(LIGAR);
      expect(alerta()?.textContent).toBe(
        "Os avisos não foram ligados. Tente de novo em instantes.",
      );
      expect(texto()).not.toContain("texto cru do navegador");
    });
  });

  describe("cartão de ligar offline", () => {
    it("sem internet, o cartão diz que não dá para ligar nem testar", async () => {
      rede.offline = true;
      await montar();
      expect(texto()).toContain(
        "Avisos de pedidos indisponíveis. Conecte-se para ligar ou testar os avisos.",
      );
    });

    it("com internet, essa frase não aparece", async () => {
      await montar();
      expect(texto()).not.toContain("Avisos de pedidos indisponíveis");
    });
  });

  describe("aviso de teste", () => {
    async function montarJaLigado() {
      hook.subscribe.mockResolvedValue(inscricaoDeTeste());
      const Cartao = await montar();
      await tocar(LIGAR);
      return Cartao;
    }

    it("a mensagem do teste diz o que a pessoa deve esperar ver", async () => {
      invoke.mockResolvedValue({ data: { enviados: 1 }, error: null });
      await montarJaLigado();
      await tocar(TESTE);
      const [, opcoes] = invoke.mock.calls[0];
      expect(opcoes.body.title).toBe("Aviso de teste — Loja de Teste");
      expect(opcoes.body.body).toBe(
        "Se você está lendo isto, o aviso de pedido novo chega neste aparelho.",
      );
    });

    it("sem internet: não chama o servidor e diz 'Sem internet agora'", async () => {
      const Cartao = await montarJaLigado();
      rede.offline = true;
      await redesenhar(Cartao);

      await tocar(TESTE);

      expect(invoke).not.toHaveBeenCalled();
      expect(alerta()?.textContent).toBe(
        "Sem internet agora. Conecte-se e toque de novo.",
      );
    });

    it("resposta com ERRO e com 'enviados' junto: é falha, nunca sucesso", async () => {
      invoke.mockResolvedValue({
        data: { enviados: 1 },
        error: new Error("falha inventada"),
      });
      await montarJaLigado();
      await tocar(TESTE);
      expect(alerta()?.textContent).toContain("não foi enviado");
      expect(status()).toBeNull();
    });

    it("resposta com ERRO e falha sem confirmação: continua sendo 'não foi enviado'", async () => {
      invoke.mockResolvedValue({
        data: {
          enviados: 0,
          falhas: [
            {
              status: null,
              motivo:
                "Sem resposta do serviço de push dentro do prazo; o aviso pode ter chegado",
              quantidade: 1,
            },
          ],
        },
        error: new Error("falha inventada"),
      });
      await montarJaLigado();
      await tocar(TESTE);
      expect(alerta()?.textContent).toContain("não foi enviado");
      expect(alerta()?.textContent).not.toContain("Não foi possível confirmar");
    });

    it("uma falha sem confirmação entre outras já basta para 'confira o aparelho'", async () => {
      invoke.mockResolvedValue({
        data: {
          enviados: 0,
          falhas: [
            { status: 410, motivo: "Gone", quantidade: 1 },
            {
              status: null,
              motivo:
                "Sem resposta do serviço de push dentro do prazo; o aviso pode ter chegado",
              quantidade: 1,
            },
          ],
        },
        error: null,
      });
      await montarJaLigado();
      await tocar(TESTE);
      expect(alerta()?.textContent).toContain(
        "Não foi possível confirmar o envio",
      );
    });
  });

  describe("passos de liberar no iPhone instalado", () => {
    it("bloqueado no iPhone com o app instalado: os passos são os dos Ajustes", async () => {
      aparelhoSemAviso({ permission: "denied" });
      Object.defineProperty(navigator, "userAgent", {
        value: USER_AGENT_IPHONE,
        configurable: true,
      });
      vi.stubGlobal("matchMedia", (consulta: string) => ({
        matches: consulta.includes("standalone"),
      }));
      await montar();

      const passos = Array.from(hospedeiro.querySelectorAll("ol li")).map(
        (li) => li.textContent,
      );
      expect(passos).toEqual(
        passosParaLiberarOsAvisos(
          { instalado: true, ehApple: true },
          "Loja de Teste",
        ),
      );
      expect(passos[0]).toBe("Abra os Ajustes do aparelho.");
    });
  });

  describe("voltar das configurações do aparelho", () => {
    async function comErroDeLigarNaTela() {
      hook.subscribe.mockRejectedValue(erroDoHook("Erro de teste."));
      const Cartao = await montar();
      await tocar(LIGAR);
      expect(alerta()?.textContent).toBe("Erro de teste.");
      return Cartao;
    }

    it("permissão do navegador diferente da do hook: o cartão é reconstruído e esquece o erro antigo", async () => {
      vi.stubGlobal("Notification", { permission: "default" });
      await comErroDeLigarNaTela();

      vi.stubGlobal("Notification", { permission: "granted" });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(alerta()).toBeNull();
    });

    it("hook já em dia com o navegador (mudou de 'default' para 'granted'): o erro continua na tela", async () => {
      vi.stubGlobal("Notification", { permission: "default" });
      const Cartao = await comErroDeLigarNaTela();

      // O hook enxerga a nova permissão (sem inscrição ainda) e a tela se
      // redesenha; o ouvinte de foco precisa comparar com a permissão ATUAL.
      aparelhoSemAviso({ permission: "granted" });
      await redesenhar(Cartao);
      vi.stubGlobal("Notification", { permission: "granted" });
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });

      expect(alerta()?.textContent).toBe("Erro de teste.");
    });

    it("navegador sem Notification: voltar à tela não lança erro nenhum", async () => {
      vi.stubGlobal("Notification", undefined);
      const erros: unknown[] = [];
      const registrar = (evento: Event) => erros.push(evento);
      window.addEventListener("error", registrar);
      await montar();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      window.removeEventListener("error", registrar);

      expect(erros).toEqual([]);
      expect(botao(LIGAR)).toBeDefined();
    });
  });
});
