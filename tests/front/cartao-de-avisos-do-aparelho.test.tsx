// @vitest-environment jsdom
//
// O CARTÃO DO INÍCIO "VOCÊ NÃO ESTÁ RECEBENDO AVISO DE PEDIDO NOVO NESTE
// APARELHO". Sem o aviso ligado a loja só vê o pedido quando abre o painel; o
// cartão diz isso, deixa ligar com um toque e, depois de ligar, deixa mandar um
// aviso de teste. Prende:
//
//   a. aparece quando o aparelho NÃO está inscrito, e some quando está
//      (e some sozinho se a inscrição aparece com o cartão aberto);
//   b. enquanto a sonda do navegador não terminou ele não diz nada (senão o
//      aparelho inscrito veria o alarme por um instante);
//   c. "Agora não" esconde por 7 dias e o cartão volta depois — com o
//      armazenamento bloqueado nada quebra;
//   d. permissão negada mostra os passos para liberar (e nenhum botão que não
//      funcionaria); iPhone/iPad fora do app instalado mostra "Adicionar à
//      Tela de Início"; no app instalado vale o botão;
//   e. o botão liga chama o hook UMA vez; depois de ligar o cartão fica para o
//      teste, e o teste diz a verdade (enviado / não enviado);
//   f. sem conta, ou sem ser admin, não renderiza nada.
//
// Controles negativos decidem o teste: um cartão que nunca aparece passaria em
// tudo que é "some" — por isso cada "some" tem o irmão que aparece.
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

const TITULO = "Você não está recebendo aviso de pedido novo neste aparelho";
const REGIAO = "Avisos de pedido novo neste aparelho";
const LIGAR = "Ligar avisos neste aparelho";
const AGORA_NAO = "Agora não";
const TESTE = "Mandar um aviso de teste";
const DIA_MS = 24 * 60 * 60 * 1000;
const HOJE = new Date("2026-10-14T12:00:00Z");

function inscricaoDeTeste() {
  return {
    endpoint: "https://push.exemplo.test/abc",
    toJSON: () => ({
      endpoint: "https://push.exemplo.test/abc",
      keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
    }),
  } as unknown as PushSubscription;
}

/** Estado do hook de um aparelho que PODE ligar, mas ainda não ligou. */
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

function definirNavegador(valores: Record<string, unknown>) {
  for (const [nome, valor] of Object.entries(valores)) {
    Object.defineProperty(navigator, nome, {
      value: valor,
      configurable: true,
    });
  }
}

function instaladoNaTela(instalado: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: instalado && consulta.includes("standalone"),
  }));
}

const USER_AGENT_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("CartaoDeAvisosDoAparelho", () => {
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
    for (const nome of ["userAgent", "platform", "maxTouchPoints"]) {
      Reflect.deleteProperty(navigator, nome);
    }
  });

  async function montar(props: { aoFechar?: () => void } = {}) {
    const { CartaoDeAvisosDoAparelho } = await import(
      "@/components/admin/inicio/CartaoDeAvisosDoAparelho"
    );
    await act(async () => {
      raiz.render(<CartaoDeAvisosDoAparelho {...props} />);
    });
    return CartaoDeAvisosDoAparelho;
  }

  async function remontar(
    Cartao: Awaited<ReturnType<typeof montar>>,
  ): Promise<void> {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Cartao />);
    });
  }

  const regiao = () =>
    hospedeiro.querySelector<HTMLElement>(`[aria-label="${REGIAO}"]`);
  const texto = () => hospedeiro.textContent ?? "";
  function botao(nome: string): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === nome,
    );
  }
  async function tocar(nome: string) {
    const alvo = botao(nome);
    if (!alvo) throw new Error(`botão "${nome}" não encontrado: ${texto()}`);
    await act(async () => {
      alvo.click();
    });
  }

  describe("quando aparece e quando some", () => {
    it("aparece para o lojista num aparelho que não está inscrito", async () => {
      await montar();

      const r = regiao();
      expect(r).not.toBeNull();
      // <section> com nome acessível já é a região (role "region") para o
      // leitor de tela — escrever `role="region"` seria redundante (eslint e
      // Biome recusam).
      expect(r?.tagName).toBe("SECTION");
      expect(texto()).toContain(TITULO);
      expect(texto()).toContain("só vê o pedido quando você abre o painel");
      expect(botao(LIGAR)).toBeDefined();
      expect(botao(AGORA_NAO)).toBeDefined();
    });

    it("os botões têm alvo de toque de 44px (min-h-11)", async () => {
      await montar();
      for (const nome of [LIGAR, AGORA_NAO]) {
        expect(botao(nome)?.className, nome).toMatch(/\bmin-h-11\b/);
      }
    });

    it("some quando o aparelho está inscrito e com permissão", async () => {
      aparelhoSemAviso({
        permission: "granted",
        subscription: inscricaoDeTeste(),
      });
      await montar();

      expect(regiao()).toBeNull();
      expect(texto()).toBe("");
    });

    it("some sozinho quando a inscrição aparece com o cartão aberto, e volta se ela se perde", async () => {
      const Cartao = await montar();
      expect(regiao()).not.toBeNull();

      aparelhoSemAviso({
        permission: "granted",
        subscription: inscricaoDeTeste(),
      });
      await act(async () => {
        raiz.render(<Cartao />);
      });
      expect(regiao()).toBeNull();

      aparelhoSemAviso({ permission: "granted", subscription: null });
      await act(async () => {
        raiz.render(<Cartao />);
      });
      expect(regiao()).not.toBeNull();
    });

    it("inscrição com a permissão revogada NÃO conta como ligado", async () => {
      aparelhoSemAviso({
        permission: "denied",
        subscription: inscricaoDeTeste(),
      });
      await montar();

      expect(regiao()).not.toBeNull();
    });

    it("não diz nada enquanto a sonda do navegador não terminou", async () => {
      aparelhoSemAviso({ sondado: false });
      await montar();

      expect(regiao()).toBeNull();
    });

    it("sem conta (visitante) não renderiza", async () => {
      aparelhoSemAviso({ semConta: true });
      await montar();

      expect(regiao()).toBeNull();
    });

    it("quem não é admin não vê o cartão", async () => {
      auth.isAdmin = false;
      await montar();

      expect(regiao()).toBeNull();
    });

    it("navegador sem suporte a aviso diz isso, sem botão de ligar", async () => {
      aparelhoSemAviso({ isSupported: false });
      await montar();

      expect(texto()).toContain(TITULO);
      expect(texto()).toContain("Este navegador não consegue receber avisos");
      expect(botao(LIGAR)).toBeUndefined();
      expect(botao(AGORA_NAO)).toBeDefined();
    });
  });

  describe("Agora não", () => {
    it("esconde o cartão, grava 7 dias e o cartão volta depois disso", async () => {
      const Cartao = await montar();
      await tocar(AGORA_NAO);

      expect(regiao()).toBeNull();
      const gravado = Number(
        localStorage.getItem("ikcous_admin_avisos_do_aparelho_adiado_ate"),
      );
      expect(gravado).toBe(HOJE.getTime() + 7 * DIA_MS);

      // 6 dias depois ainda está escondido…
      vi.setSystemTime(new Date(HOJE.getTime() + 6 * DIA_MS));
      await remontar(Cartao);
      expect(regiao()).toBeNull();

      // …e passados os 7 dias ele volta.
      vi.setSystemTime(new Date(HOJE.getTime() + 8 * DIA_MS));
      await remontar(Cartao);
      expect(regiao()).not.toBeNull();
    });

    it("com o armazenamento do navegador bloqueado, nada quebra e o cartão some nesta visita", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("armazenamento bloqueado");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("armazenamento bloqueado");
      });
      await montar();
      expect(regiao()).not.toBeNull();

      await tocar(AGORA_NAO);

      expect(regiao()).toBeNull();
    });
  });

  describe("permissão negada e iPhone/iPad", () => {
    it("permissão negada mostra os passos para liberar e nenhum botão de ligar", async () => {
      aparelhoSemAviso({ permission: "denied" });
      await montar();

      expect(texto()).toContain("estão bloqueados");
      const passos = Array.from(hospedeiro.querySelectorAll("ol li")).map(
        (li) => li.textContent,
      );
      expect(passos.length).toBeGreaterThanOrEqual(3);
      expect(passos.join(" ")).toContain("Permissões");
      expect(botao(LIGAR)).toBeUndefined();
      expect(botao(AGORA_NAO)).toBeDefined();
    });

    it("permissão negada no app instalado aponta para as configurações do aparelho", async () => {
      aparelhoSemAviso({ permission: "denied" });
      instaladoNaTela(true);
      await montar();

      const passos = Array.from(hospedeiro.querySelectorAll("ol li"))
        .map((li) => li.textContent)
        .join(" ");
      expect(passos).toContain("Loja de Teste");
      expect(passos).toContain("configurações do aparelho");
    });

    it("iPhone fora do app instalado mostra Adicionar à Tela de Início, no lugar do botão", async () => {
      // Safari do iPhone numa aba: o navegador nem expõe o push.
      aparelhoSemAviso({ isSupported: false });
      definirNavegador({ userAgent: USER_AGENT_IPHONE });
      instaladoNaTela(false);
      await montar();

      expect(texto()).toContain("Compartilhar");
      expect(texto()).toContain("Adicionar à Tela de Início");
      expect(botao(LIGAR)).toBeUndefined();
    });

    it("iPad (que se apresenta como Mac com tela de toque) também recebe as instruções", async () => {
      aparelhoSemAviso({ isSupported: false });
      definirNavegador({ platform: "MacIntel", maxTouchPoints: 5 });
      instaladoNaTela(false);
      await montar();

      expect(texto()).toContain("Adicionar à Tela de Início");
      expect(botao(LIGAR)).toBeUndefined();
    });

    it("iPhone com o app instalado na Tela de Início mostra o botão, sem instruções", async () => {
      definirNavegador({ userAgent: USER_AGENT_IPHONE });
      instaladoNaTela(true);
      await montar();

      expect(botao(LIGAR)).toBeDefined();
      expect(texto()).not.toContain("Adicionar à Tela de Início");
    });

    it("um Mac de verdade (sem tela de toque) não recebe instruções de iPhone", async () => {
      definirNavegador({ platform: "MacIntel", maxTouchPoints: 0 });
      await montar();

      expect(botao(LIGAR)).toBeDefined();
      expect(texto()).not.toContain("Adicionar à Tela de Início");
    });
  });

  describe("ligar os avisos", () => {
    it("o botão chama o hook UMA vez, mesmo com toque duplo, e mostra o teste depois", async () => {
      let terminar: (valor: PushSubscription) => void = () => undefined;
      hook.subscribe.mockImplementation(
        () =>
          new Promise<PushSubscription>((resolve) => {
            terminar = resolve;
          }),
      );
      await montar();

      const alvo = botao(LIGAR);
      await act(async () => {
        alvo?.click();
        alvo?.click();
      });
      expect(hook.subscribe).toHaveBeenCalledTimes(1);
      expect(botao("Ligando...")?.disabled).toBe(true);

      await act(async () => {
        terminar(inscricaoDeTeste());
      });

      expect(texto()).toContain("Avisos ligados neste aparelho");
      expect(botao(LIGAR)).toBeUndefined();
      expect(botao(TESTE)).toBeDefined();
      // O botão que sumiu levaria o foco junto: ele vai para o teste.
      expect(document.activeElement).toBe(botao(TESTE));
    });

    it("se o hook recusar com a frase traduzida, o cartão a deixa FIXA na tela", async () => {
      // É o erro que o hook lança: `.message` já é a instrução em português
      // (aqui, o caso do Android com as notificações do app desligadas).
      const frase =
        "O aparelho está bloqueando as notificações deste app. Abra as configurações do aparelho → Apps → Loja de Teste → Notificações, ative e toque de novo.";
      hook.subscribe.mockRejectedValue(
        Object.assign(new Error(frase), { name: "PushSubscribeError" }),
      );
      await montar();

      await tocar(LIGAR);

      expect(regiao()).not.toBeNull();
      expect(botao(LIGAR)).toBeDefined();
      const alerta = hospedeiro.querySelector('[role="alert"]');
      expect(alerta?.textContent).toBe(frase);
      expect(texto()).not.toContain("Veja a mensagem que apareceu");
    });

    it("erro que não é do hook (texto cru) NÃO chega à tela: vale a frase genérica", async () => {
      hook.subscribe.mockRejectedValue(
        new Error("AbortError: Registration failed - permission denied"),
      );
      await montar();

      await tocar(LIGAR);

      const alerta = hospedeiro.querySelector('[role="alert"]');
      expect(alerta?.textContent).toContain("Os avisos não foram ligados");
      expect(texto()).not.toContain("AbortError");
    });

    it("hook que não inscreve (devolve nada) também não vira 'ligado'", async () => {
      hook.subscribe.mockResolvedValue(undefined);
      await montar();

      await tocar(LIGAR);

      expect(texto()).not.toContain("Avisos ligados neste aparelho");
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    });

    it("sem internet não tenta ligar e diz por quê", async () => {
      rede.offline = true;
      await montar();

      await tocar(LIGAR);

      expect(hook.subscribe).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
        "Sem internet",
      );
    });
  });

  describe("aviso de teste", () => {
    async function montarJaLigado() {
      hook.subscribe.mockResolvedValue(inscricaoDeTeste());
      await montar();
      await tocar(LIGAR);
    }

    it("manda a inscrição DESTE aparelho para a send-push e diz que enviou", async () => {
      invoke.mockResolvedValue({
        data: { ok: true, enviados: 1, falharam: 0 },
        error: null,
      });
      await montarJaLigado();

      await tocar(TESTE);

      expect(invoke).toHaveBeenCalledTimes(1);
      const [funcao, opcoes] = invoke.mock.calls[0];
      expect(funcao).toBe("send-push");
      expect(opcoes.body.tokens).toEqual([
        {
          endpoint: "https://push.exemplo.test/abc",
          keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
        },
      ]);
      expect(opcoes.body.title).toContain("Loja de Teste");
      // A mesma tela que o aviso real de pedido novo abre (notify-new-order).
      expect(opcoes.body.url).toBe("/admin-orders");
      const status = hospedeiro.querySelector('[role="status"]');
      expect(status?.textContent).toContain("Aviso de teste enviado");
      expect(status?.textContent).toContain("Se não aparecer");
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    });

    it("toque duplo no teste manda UM aviso só", async () => {
      invoke.mockResolvedValue({ data: { enviados: 1 }, error: null });
      await montarJaLigado();

      const alvo = botao(TESTE);
      await act(async () => {
        alvo?.click();
        alvo?.click();
      });

      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it("erro da função vira 'não foi enviado' — nunca sucesso", async () => {
      invoke.mockResolvedValue({
        data: null,
        error: new Error("Unauthorized"),
      });
      await montarJaLigado();

      await tocar(TESTE);

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
        "não foi enviado",
      );
      expect(hospedeiro.querySelector('[role="status"]')).toBeNull();
    });

    it("a função responde sem erro mas com zero enviados: também é falha", async () => {
      invoke.mockResolvedValue({
        data: { ok: false, enviados: 0, falharam: 1 },
        error: null,
      });
      await montarJaLigado();

      await tocar(TESTE);

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
        "não foi enviado",
      );
      expect(hospedeiro.querySelector('[role="status"]')).toBeNull();
    });

    it("a chamada que lança (rede caiu) é falha, e dá para tentar de novo", async () => {
      invoke
        .mockRejectedValueOnce(new Error("rede"))
        .mockResolvedValueOnce({ data: { enviados: 1 }, error: null });
      await montarJaLigado();

      await tocar(TESTE);
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

      await tocar(TESTE);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(hospedeiro.querySelector('[role="status"]')).not.toBeNull();
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    });

    it("'Pronto' fecha o cartão", async () => {
      await montarJaLigado();

      await tocar("Pronto");

      expect(regiao()).toBeNull();
    });

    it("'Pronto' entrega o foco à tela, uma vez", async () => {
      const aoFechar = vi.fn();
      hook.subscribe.mockResolvedValue(inscricaoDeTeste());
      await montar({ aoFechar });
      await tocar(LIGAR);
      expect(aoFechar).not.toHaveBeenCalled();

      await tocar("Pronto");

      expect(aoFechar).toHaveBeenCalledTimes(1);
    });
  });

  describe("o foco não se perde ao fechar", () => {
    it("'Agora não' entrega o foco à tela, uma vez (e não antes de tocar)", async () => {
      const aoFechar = vi.fn();
      await montar({ aoFechar });
      expect(aoFechar).not.toHaveBeenCalled();

      await tocar(AGORA_NAO);

      expect(aoFechar).toHaveBeenCalledTimes(1);
      expect(regiao()).toBeNull();
    });
  });

  describe("Sair e Entrar: o adiamento não cala o alarme", () => {
    it("adiou, o app esqueceu o adiamento ao descadastrar o aparelho (Sair), e o cartão volta", async () => {
      const { esquecerAdiamentoDosAvisos } = await import(
        "@/lib/avisos-do-aparelho"
      );
      const Cartao = await montar();
      await tocar(AGORA_NAO);
      expect(regiao()).toBeNull();

      // O mesmo gesto que `clearLocalUserData` (AuthContext) faz no Sair.
      esquecerAdiamentoDosAvisos();
      await remontar(Cartao);

      expect(regiao()).not.toBeNull();
    });
  });

  describe("textos que dependem do aparelho", () => {
    it("iPhone com app instalado mas sem push: manda ATUALIZAR o iOS, não trocar de navegador", async () => {
      aparelhoSemAviso({ isSupported: false });
      definirNavegador({ userAgent: USER_AGENT_IPHONE });
      instaladoNaTela(true);
      await montar();

      expect(texto()).toContain("Atualize o iOS");
      expect(texto()).toContain("16.4");
      expect(texto()).not.toContain("Chrome");
      expect(botao(LIGAR)).toBeUndefined();
    });

    it("os passos de 'bloqueado' mandam voltar e tocar em Ligar — o cartão não promete sumir", async () => {
      aparelhoSemAviso({ permission: "denied" });
      await montar();

      const passos = Array.from(hospedeiro.querySelectorAll("ol li")).map(
        (li) => li.textContent ?? "",
      );
      expect(passos.at(-1)).toContain("toque em Ligar avisos neste aparelho");
      expect(texto()).not.toContain("some sozinho");
    });
  });

  describe("voltar das configurações do aparelho", () => {
    it("se a permissão do navegador mudou enquanto a pessoa estava fora, o cartão lê tudo de novo e oferece Ligar", async () => {
      aparelhoSemAviso({ permission: "denied" });
      vi.stubGlobal("Notification", { permission: "denied" });
      await montar();
      expect(botao(LIGAR)).toBeUndefined();

      // A pessoa liberou nas configurações e voltou ao app.
      vi.stubGlobal("Notification", { permission: "default" });
      aparelhoSemAviso({ permission: "default" });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(botao(LIGAR)).toBeDefined();
      expect(texto()).not.toContain("estão bloqueados");
    });

    it("se nada mudou, voltar à tela não apaga o resultado que o cartão mostrava", async () => {
      vi.stubGlobal("Notification", { permission: "default" });
      hook.subscribe.mockRejectedValue(
        Object.assign(new Error("Toque de novo e escolha Permitir."), {
          name: "PushSubscribeError",
        }),
      );
      await montar();
      await tocar(LIGAR);
      expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();

      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        "Toque de novo e escolha Permitir.",
      );
    });
  });
});
