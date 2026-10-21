import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import {
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";

// Só a rede e as APIs do navegador são dublês. A leitura da identidade,
// a montagem/serialização da ficha e o tratamento do push são os reais.
function linhaRemotaSemBadge(origin: string) {
  const hash = "a".repeat(64);
  const asset = (nome: string, width: number, height: number) => ({
    path: `v1/${hash}/${nome}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width,
    height,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: "Loja Fixture",
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#123456",
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: asset("loader", 64, 64),
      favicon: asset("favicon", 32, 32),
      apple_touch: asset("apple", 180, 180),
      icon_192: asset("icon192", 192, 192),
      icon_512: asset("icon512", 512, 512),
      maskable_512: asset("maskable", 512, 512),
      og: asset("og", 1200, 630),
    },
  };
}

async function fichaDoPorteiro(host: string, origin: string) {
  const linha = linhaRemotaSemBadge(origin);
  const resposta = await atenderPorteiro(
    new Request(`https://${host}/identidade.json`),
    {
      VITE_SUPABASE_URL: origin,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    },
    {
      cache: new Map(),
      fetchImpl: async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.origin !== origin || url.pathname !== "/rest/v1/v_store_config")
          throw new Error(`URL inesperada no teste: ${url.href}`);
        const dados =
          url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA
            ? {
                dominio_publico: host,
                mp_public_key: null,
                vapid_public_key: null,
                pagamento_online: false,
                manutencao: false,
              }
            : linha;
        return Response.json([dados]);
      },
    },
  );
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get("x-ikcous-porteiro")).toBe("ok");
  const ficha: FichaDaLoja = await resposta.clone().json();
  expect(ficha.host).toBe(host);
  expect(ficha.identidade.localUrls).not.toHaveProperty("badge_96");
  return resposta;
}

async function notificarComFichaEmCache(host: string, resposta: Response) {
  vi.resetModules();
  const listeners = new Map<string, (evento: unknown) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("self", {
    location: { origin: `https://${host}`, hostname: host },
    __WB_MANIFEST: [],
    registration: { showNotification },
    addEventListener: (tipo: string, listener: (evento: unknown) => void) =>
      listeners.set(tipo, listener),
  });
  vi.stubGlobal("caches", {
    open: async (nome: string) => {
      if (nome !== "ikcous-identidade")
        throw new Error(`Cache inesperado no teste: ${nome}`);
      return {
        match: async (caminho: string) => {
          if (caminho !== "/identidade.json")
            throw new Error(`Caminho inesperado no teste: ${caminho}`);
          // Os mesmos bytes entregues pelo porteiro, sem acrescentar badge.
          return resposta.clone();
        },
      };
    },
    match: vi.fn(),
  });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  await import("@/sw/sw");
  const push = listeners.get("push");
  if (!push) throw new Error("O service worker não registrou push");
  const waitUntil = vi.fn();
  push({
    data: {
      json: () => ({
        title: "Aviso",
        body: "Mensagem",
        url: "/pedido",
        badge: "https://externo.example/badge-errado.png",
      }),
    },
    waitUntil,
  });
  expect(waitUntil).toHaveBeenCalledTimes(1);
  await waitUntil.mock.calls[0][0];
  return showNotification;
}

describe("badge da notificação — identidade remota → porteiro → service worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("identidade remota SEM badge → ficha real → showNotification com sino neutro (estado atual)", async () => {
    const resposta = await fichaDoPorteiro(
      "loja-a.exemplo",
      "https://projetoaaaaaaaaaaaaa.supabase.co",
    );
    const showNotification = await notificarComFichaEmCache(
      "loja-a.exemplo",
      resposta,
    );
    // O icon remoto prova que a ficha atravessou a cadeia; um cache vazio
    // também daria badge neutro, mas não este icon da própria loja.
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Aviso", {
      body: "Mensagem",
      icon: `https://projetoaaaaaaaaaaaaa.supabase.co/storage/v1/object/public/branding/v1/${"a".repeat(64)}/icon192.png`,
      badge: "/icons/badge-96x96.png",
      data: { url: "/pedido" },
    });
  });

  it.todo(
    "identidade remota COM `badge_96` opcional → ficha → `showNotification` com a MESMA URL do Storage",
  );

  it("host A não herda o badge do host B ao encontrar a mesma ficha em cache", async () => {
    const respostaB = await fichaDoPorteiro(
      "loja-b.exemplo",
      "https://projetobbbbbbbbbbbbb.supabase.co",
    );
    const notificacaoB = await notificarComFichaEmCache(
      "loja-b.exemplo",
      respostaB,
    );
    expect(notificacaoB).toHaveBeenCalledExactlyOnceWith("Aviso", {
      body: "Mensagem",
      icon: `https://projetobbbbbbbbbbbbb.supabase.co/storage/v1/object/public/branding/v1/${"a".repeat(64)}/icon192.png`,
      badge: "/icons/badge-96x96.png",
      data: { url: "/pedido" },
    });

    const notificacaoA = await notificarComFichaEmCache(
      "loja-a.exemplo",
      respostaB,
    );
    // Hoje B também não tem badge próprio. O icon neutro distingue a
    // rejeição por host de aceitar indevidamente a ficha de B.
    expect(notificacaoA).toHaveBeenCalledExactlyOnceWith("Aviso", {
      body: "Mensagem",
      icon: "/icons/heart-96x96.png",
      badge: "/icons/badge-96x96.png",
      data: { url: "/pedido" },
    });
  });
});
