// @vitest-environment jsdom
//
// Achado de 28/09/2026 (celular do dono, Android, app instalado pela tela de
// início — a WebAPK, que o Android trata como um app SEPARADO do Chrome):
// "Quero receber!" mostrava "Não foi possível ativar as notificações neste
// navegador…". A causa, medida no aparelho:
//
//   - o SITE já tinha permissão no Chrome, então `Notification.requestPermission()`
//     respondeu "granted" sem perguntar nada ao Android;
//   - o APP instalado estava com Notificações "Sem permissão" nas
//     configurações do Android;
//   - `pushManager.subscribe()` lançou
//     `AbortError: Registration failed - permission denied`
//     (em outros casos o nome vem como `NotAllowedError`).
//
// Uma página web não abre a janela do Android nem liga essa chave — o
// conserto é a MENSAGEM: dizer exatamente o que fazer. O que este arquivo
// prende:
//
//   a. `NotAllowedError`, ou `AbortError` cuja mensagem tem "permission
//      denied" (sem diferenciar maiúsculas), COM a permissão do site
//      "granted" → origem própria `permissao_do_aparelho`, com a frase do
//      APP (instalado) ou do NAVEGADOR (aba), conforme o caso.
//   b. Qualquer outro erro de `subscribe()` continua na origem `navegador`.
//   c. Nesse caminho nada é gravado nem desfeito (o erro acontece antes do
//      `upsert`) e a permissão do site fica como está.
//
// Mesmo molde de push-notifications-erro-por-origem.test.tsx (Sonda, sem
// @testing-library/react).
import { branding } from "@/config/branding";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const tabelaDoSupabase = vi.fn();
const subscribeNoNavegador = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const requestPermission = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      tabelaDoSupabase(tabela);
      return { upsert };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Cada tique tem o PRÓPRIO `act()` — ver o comentário homônimo em
 * push-notifications-erro-por-origem.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

interface Snapshot {
  isSupported: boolean;
  permission: NotificationPermission;
  subscribe: () => Promise<unknown>;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

// Frases comparadas por IGUALDADE EXATA: provam o texto inteiro (o nome da
// loja no app, o "o seu navegador" na aba) e que as duas são diferentes
// entre si e da frase genérica de "navegador".
//
// O nome da loja é o do MANIFESTO (`branding.appName`, a mesma fotografia
// que preparou o HTML e o manifesto): é com ele que o app aparece na lista
// de Apps do Android, que é onde a pessoa vai procurá-lo.
const MENSAGEM_DO_APP = `O celular está bloqueando as notificações deste app. Abra as configurações do celular → Apps → ${branding.appName} → Notificações, ative e toque de novo.`;
const MENSAGEM_DA_ABA =
  "O celular está bloqueando as notificações do navegador. Abra as configurações do celular → Apps → o seu navegador → Notificações, ative e toque de novo.";
const MENSAGEM_NAVEGADOR =
  "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.";

const PERMISSAO_NEGADA_PELO_APARELHO = () =>
  new DOMException("Registration failed - permission denied", "AbortError");

describe("usePushNotifications — o celular bloqueia as notificações e a mensagem diz o que fazer", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  /** `display-mode: standalone` é o que a WebAPK/PWA instalada responde. */
  function definirModoInstalado(instalado: boolean) {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: instalado && consulta === "(display-mode: standalone)",
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "A".repeat(64));

    getSubscriptionNoNavegador.mockResolvedValue(null);
    const registration = {
      pushManager: {
        subscribe: subscribeNoNavegador,
        getSubscription: getSubscriptionNoNavegador,
      },
    };

    class PushManagerStub {}
    vi.stubGlobal("PushManager", PushManagerStub);

    // O SITE já tem permissão (o cenário do achado): `requestPermission`
    // responde "granted" sem perguntar nada.
    requestPermission.mockResolvedValue("granted");
    vi.stubGlobal("Notification", {
      permission: "granted" as NotificationPermission,
      requestPermission,
    });

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
    });

    definirModoInstalado(false);

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
    Reflect.deleteProperty(globalThis.navigator, "standalone");
  });

  async function montar() {
    vi.resetModules();
    const { usePushNotifications } = await import(
      "@/hooks/usePushNotifications"
    );

    const aoAtualizar = vi.fn();
    function SondaReal() {
      const estado = usePushNotifications();
      useEffect(() => {
        aoAtualizar(estado);
      });
      return null;
    }

    await act(async () => {
      raiz.render(<SondaReal />);
    });

    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    const { toast } = await import("sonner");
    return { toast, aoAtualizar };
  }

  async function tocarEmReceber(aoAtualizar: ReturnType<typeof vi.fn>) {
    const { subscribe } = ultimoEstado(aoAtualizar)!;
    let erroLancado: unknown;
    await act(async () => {
      try {
        await subscribe();
      } catch (erro) {
        erroLancado = erro;
      }
    });
    return erroLancado;
  }

  it("app instalado + AbortError 'permission denied': frase do APP com o nome da loja, sem gravar nada e sem mexer na permissão do site", async () => {
    definirModoInstalado(true);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(PERMISSAO_NEGADA_PELO_APARELHO());

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({
      name: "PushSubscribeError",
      origin: "permissao_do_aparelho",
      message: MENSAGEM_DO_APP,
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DO_APP);
    // O erro acontece ANTES do upsert: nada no banco, nem sequer a tabela.
    expect(upsert).not.toHaveBeenCalled();
    expect(tabelaDoSupabase).not.toHaveBeenCalled();
    // A permissão do site continua como está: "granted".
    expect(ultimoEstado(aoAtualizar)?.permission).toBe("granted");
  });

  it("aba do navegador + o mesmo erro: frase do NAVEGADOR, sem nome de loja e sem inventar qual navegador", async () => {
    definirModoInstalado(false);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(PERMISSAO_NEGADA_PELO_APARELHO());

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({
      origin: "permissao_do_aparelho",
      message: MENSAGEM_DA_ABA,
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DA_ABA);
    expect(MENSAGEM_DA_ABA).not.toContain(branding.appName);
    expect(upsert).not.toHaveBeenCalled();
    expect(tabelaDoSupabase).not.toHaveBeenCalled();
  });

  it.each([
    ["app instalado", true, MENSAGEM_DO_APP],
    ["aba do navegador", false, MENSAGEM_DA_ABA],
  ])(
    "NotAllowedError (%s): mesma origem nova, mesma frase",
    async (_rotulo, instalado, mensagem) => {
      definirModoInstalado(instalado);
      const { toast, aoAtualizar } = await montar();
      subscribeNoNavegador.mockRejectedValue(
        new DOMException("The request is not allowed", "NotAllowedError"),
      );

      const erro = await tocarEmReceber(aoAtualizar);

      expect(erro).toMatchObject({ origin: "permissao_do_aparelho" });
      expect(toast.error).toHaveBeenCalledWith(mensagem);
      expect(upsert).not.toHaveBeenCalled();
      expect(tabelaDoSupabase).not.toHaveBeenCalled();
    },
  );

  it("'permission denied' sem diferenciar maiúsculas (o texto muda de um Chrome para outro)", async () => {
    definirModoInstalado(true);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(
      new DOMException("REGISTRATION FAILED - Permission Denied", "AbortError"),
    );

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({ origin: "permissao_do_aparelho" });
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DO_APP);
  });

  it("app instalado no iOS (sem display-mode, mas `navigator.standalone === true`): também é o APP, não o navegador", async () => {
    definirModoInstalado(false);
    Object.defineProperty(globalThis.navigator, "standalone", {
      value: true,
      configurable: true,
    });
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(PERMISSAO_NEGADA_PELO_APARELHO());

    await tocarEmReceber(aoAtualizar);

    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DO_APP);
  });

  it("ambiente sem matchMedia: trata como aba do navegador, sem quebrar o tratamento do erro", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(PERMISSAO_NEGADA_PELO_APARELHO());

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({ origin: "permissao_do_aparelho" });
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_DA_ABA);
  });

  // Controles negativos: o que NÃO pode ter mudado de família.
  it("AbortError 'push service error' (falha do serviço de push): continua 'navegador', com a frase antiga, mesmo instalado", async () => {
    definirModoInstalado(true);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(
      new DOMException(
        "Registration failed - push service error",
        "AbortError",
      ),
    );

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({ origin: "navegador" });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("outro tipo de erro que só cita 'permission denied' no texto (NotSupportedError): continua 'navegador'", async () => {
    definirModoInstalado(true);
    const { toast, aoAtualizar } = await montar();
    subscribeNoNavegador.mockRejectedValue(
      new DOMException("permission denied", "NotSupportedError"),
    );

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({ origin: "navegador" });
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
  });

  it("permissão do site que NÃO está 'granted' na hora do erro: não é o aparelho quem bloqueia, continua 'navegador'", async () => {
    definirModoInstalado(true);
    const { toast, aoAtualizar } = await montar();
    // `requestPermission` respondeu "granted", mas quando o `subscribe()`
    // falha o site já não tem a permissão (revogada no meio do caminho): a
    // frase "o celular está bloqueando" seria um palpite.
    vi.stubGlobal("Notification", {
      permission: "denied" as NotificationPermission,
      requestPermission,
    });
    subscribeNoNavegador.mockRejectedValue(
      new DOMException("The request is not allowed", "NotAllowedError"),
    );

    const erro = await tocarEmReceber(aoAtualizar);

    expect(erro).toMatchObject({ origin: "navegador" });
    expect(toast.error).toHaveBeenCalledWith(MENSAGEM_NAVEGADOR);
  });
});
