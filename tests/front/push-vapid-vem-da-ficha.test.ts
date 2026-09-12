// @vitest-environment jsdom
//
// T4 (app): a chave pública VAPID que assina a inscrição de push passa a vir
// da FICHA da loja (`chavePublicaVapid()`, escala etapa 3, 11/09/2026), nunca
// mais de `import.meta.env.VITE_VAPID_PUBLIC_KEY` direto — MP e VAPID DIFEREM
// entre lojas num build compartilhado (fato medido na spec da etapa 3):
// inscrever com a VAPID errada assina push que o navegador da OUTRA loja
// nunca reconhece.
//
// Mesmo andaime de push-notifications-erro-por-origem.test.tsx e
// push-sem-vapid-avisa-em-vez-de-ficar-inerte.test.ts: Sonda (useEffect
// capturando o retorno do hook) via createRoot + act, sem
// @testing-library/react. `.test.ts` porque não há JSX aqui.
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";

const upsert = vi.fn();
const subscribeNoNavegador = vi.fn();
const getSubscriptionNoNavegador = vi.fn();
const requestPermission = vi.fn();

const USUARIO = { id: "cliente-1" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return { upsert };
      }
      throw new Error(`tabela inesperada nos testes: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);

// ── Fixture da ficha v2 (mesmo builder de
// tests/front/configuracao-da-loja-pela-ficha.test.ts) ──
function asset(
  name: string,
  mediaType: string,
  width?: number,
  height?: number,
) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: mediaType,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function identidadeValida() {
  const header = asset("header.png", "image/png");
  const row = {
    store_name: "Loja Do Push",
    store_city: null,
    store_state: null,
    primary_color: "#123456",
    secondary_color: "#abcdef",
    accent_color: "#fedcba",
    logo_url: `${SUPABASE_URL}/storage/v1/object/public/branding/${header.path}`,
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: header,
      favicon: asset("favicon.png", "image/png"),
      apple_touch: asset("apple.png", "image/png", 180, 180),
      icon_192: asset("icon192.png", "image/png", 192, 192),
      icon_512: asset("icon512.png", "image/png", 512, 512),
      maskable_512: asset("maskable.png", "image/png", 512, 512),
      og: asset("og.png", "image/png", 1200, 630),
    },
  };
  return parseStoreIdentity(row, SUPABASE_URL);
}

function fichaValida(
  overridesConfiguracao: Partial<FichaDaLoja["configuracao"]> = {},
  host = "loja-push-teste.exemplo.com",
): FichaDaLoja {
  return {
    schemaVersion: 2,
    host,
    identidade: {
      identity: identidadeValida(),
      localUrls: {
        originals: ["https://cdn.exemplo/originals/o.png"],
        header: "https://cdn.exemplo/header.png",
        loader: "https://cdn.exemplo/loader.png",
        favicon: "https://cdn.exemplo/favicon.png",
        apple_touch: "https://cdn.exemplo/apple.png",
        icon_192: "https://cdn.exemplo/icon192.png",
        icon_512: "https://cdn.exemplo/icon512.png",
        maskable_512: "https://cdn.exemplo/maskable.png",
        og: "https://cdn.exemplo/og.png",
      },
      publicUrl: `https://${host}`,
      identityRevision: "d".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL,
      publishableKey: "sb_publishable_push_teste",
    },
    configuracao: {
      mpPublicKey: "APP_USR-da-loja-config",
      vapidPublicKey: "Bda-loja-config",
      pagamentoOnline: true,
      manutencao: false,
      ...overridesConfiguracao,
    },
  };
}

function injetarFicha(conteudo: string) {
  const elemento = document.createElement("script");
  elemento.type = "application/json";
  elemento.id = FICHA_DA_LOJA_ID;
  elemento.textContent = conteudo;
  document.head.appendChild(elemento);
}

/** MESMA conversão de `usePushNotifications.ts` (`subscribe`, conversão da
 * chave VAPID base64url → `Uint8Array`) — usada aqui só para calcular o
 * `applicationServerKey` ESPERADO a partir da chave da ficha, nunca para
 * decidir o que o hook faz. */
function paraApplicationServerKey(vapidPublicKey: string): Uint8Array {
  const padding = "=".repeat((4 - (vapidPublicKey.length % 4)) % 4);
  const base64 = (vapidPublicKey + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const rawData = globalThis.atob(base64);
  // Índice é o contador do próprio laço (0..rawData.length), nunca entrada
  // externa — mesma forma da conversão real em usePushNotifications.ts.
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    // eslint-disable-next-line security/detect-object-injection
    outputArray[i] = rawData.codePointAt(i) || 0;
  }
  return outputArray;
}

interface Snapshot {
  isSupported: boolean;
  subscribe: () => Promise<unknown>;
}

function ultimoEstado(
  aoAtualizar: ReturnType<typeof vi.fn>,
): Snapshot | undefined {
  return aoAtualizar.mock.calls.at(-1)?.[0];
}

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

describe("usePushNotifications — a chave VAPID vem da ficha da loja (escala etapa 3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let registration: {
    pushManager: {
      subscribe: typeof subscribeNoNavegador;
      getSubscription: typeof getSubscriptionNoNavegador;
    };
  };

  beforeEach(() => {
    vi.resetAllMocks();
    document.head.innerHTML = "";

    registration = {
      pushManager: {
        subscribe: subscribeNoNavegador,
        getSubscription: getSubscriptionNoNavegador,
      },
    };
    getSubscriptionNoNavegador.mockResolvedValue(null);

    class PushManagerStub {}
    vi.stubGlobal("PushManager", PushManagerStub);
    vi.stubGlobal("Notification", {
      permission: "default" as NotificationPermission,
      requestPermission,
    });

    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: { ready: Promise.resolve(registration) },
      configurable: true,
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
    document.head.innerHTML = "";
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
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
      raiz.render(createElement(SondaReal));
    });

    await esperarAte(() => ultimoEstado(aoAtualizar)?.isSupported === true);

    return { aoAtualizar };
  }

  it("ficha v2 com vapidPublicKey da loja: a inscrição usa essa chave, nunca a do build", async () => {
    vi.stubGlobal("location", { hostname: "loja-push-teste.exemplo.com" });
    // Ambiente assado preenchido de propósito, com um valor DIFERENTE — a
    // prova é que ele nunca é usado enquanto a ficha existe.
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-nunca-usado-00000000000000");
    const CHAVE_DA_FICHA = "Bda-loja-push-vapid-000000000000000";
    injetarFicha(
      JSON.stringify(fichaValida({ vapidPublicKey: CHAVE_DA_FICHA })),
    );

    const { aoAtualizar } = await montar();

    requestPermission.mockResolvedValue("granted");
    const subscricaoFalsa = {
      endpoint: "https://push.example/endpoint-vapid-da-ficha",
      toJSON: () => ({
        endpoint: "https://push.example/endpoint-vapid-da-ficha",
        keys: { p256dh: "chave-p256dh", auth: "chave-auth" },
      }),
    };
    subscribeNoNavegador.mockResolvedValue(subscricaoFalsa);
    upsert.mockResolvedValue({ error: null });

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    await act(async () => {
      await subscribe();
    });

    expect(subscribeNoNavegador).toHaveBeenCalledTimes(1);
    const chaveUsada = subscribeNoNavegador.mock.calls[0][0]
      .applicationServerKey as Uint8Array;
    expect(Array.from(chaveUsada)).toEqual(
      Array.from(paraApplicationServerKey(CHAVE_DA_FICHA)),
    );
  });

  // O TESTE DE DINHEIRO/PRIVACIDADE (ADENDO A.2): num build compartilhado
  // por N lojas, ficha AUSENTE em produção nunca pode cair no assado — mesmo
  // com ele preenchido no env. Sem esta trava, a loja sem ficha (arquivo
  // estático servido cru) inscreveria o navegador com a VAPID de OUTRA loja.
  it("ficha ausente em produção (DEV falso), com VITE_VAPID_PUBLIC_KEY preenchido no env: recusa ANTES de pedir permissão, com a causa 'VAPID Public Key não configurada nesta loja'", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "Bassado-nunca-usado-00000000000000");

    const { aoAtualizar } = await montar();

    const { subscribe } = ultimoEstado(aoAtualizar)!;
    let erroCapturado: unknown;
    await act(async () => {
      try {
        await subscribe();
      } catch (erro) {
        erroCapturado = erro;
      }
    });

    expect(erroCapturado).toBeInstanceOf(Error);
    // Frase genérica que a TELA mostra (família "navegador",
    // `mensagemDaOrigem`) — nunca o texto cru da causa.
    expect((erroCapturado as Error).message).toBe(
      "Não foi possível ativar as notificações neste navegador. Tente novamente ou use um navegador atualizado.",
    );
    // A causa crua, guardada em `.cause` só para depuração, prova que a
    // recusa veio da CHAVE FALTANDO — não de outro motivo qualquer que
    // coincidisse na mesma frase genérica.
    expect(((erroCapturado as Error).cause as Error)?.message).toBe(
      "VAPID Public Key não configurada nesta loja",
    );
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribeNoNavegador).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
