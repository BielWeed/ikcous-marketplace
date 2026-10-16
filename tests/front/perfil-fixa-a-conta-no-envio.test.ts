// O token do perfil pertence ao mesmo retrato da conta conferida, mesmo
// com duas abas compartilhando o storage e o supabase-js real no envio.
import { type Session, createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const alvo = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return alvo.cliente;
  },
}));

import { gravarPerfilDaConta, mensagemFalhaCpf } from "@/lib/cpf-da-conta";

const CONTA_A = "00000000-0000-4000-8000-00000000000a";
const CONTA_B = "00000000-0000-4000-8000-00000000000b";
const PERFIL = {
  p_full_name: "Nome de A",
  p_whatsapp: null,
  p_avatar_url: "https://perfil.invalid/avatar-a.png",
  p_cover_url: "https://perfil.invalid/capa-a.png",
};
let numeroDaSonda = 0;
const pararSondas: (() => Promise<void>)[] = [];

function sessao(userId: string, validade = 3600): Session {
  const agora = Math.floor(Date.now() / 1000);
  const codificar = (valor: unknown) =>
    Buffer.from(JSON.stringify(valor)).toString("base64url");
  return {
    access_token: `${codificar({ alg: "HS256", typ: "JWT" })}.${codificar({ sub: userId, iat: agora, exp: agora + validade })}.assinatura-sintetica`,
    refresh_token: `refresh-sintetico-${userId}-${validade}`,
    expires_in: validade,
    expires_at: agora + validade,
    token_type: "bearer",
    user: {
      id: userId,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

async function sonda() {
  const chave = `perfil-sonda-${++numeroDaSonda}`;
  const dados = new Map<string, string>();
  const storage = () => ({
    getItem: (nome: string) => dados.get(nome) ?? null,
    setItem: (nome: string, valor: string) => {
      dados.set(nome, valor);
    },
    removeItem: (nome: string) => {
      dados.delete(nome);
    },
  });
  const abaA = storage();
  const abaB = storage();
  const pedidos: { authorization: string | null; corpo: unknown }[] = [];
  const renovacoes: string[] = [];
  const durante = {
    lerSessao: null as (() => void) | null,
    renovar: null as (() => void) | null,
    resposta: () => Response.json(null),
  };
  const cliente = createClient(
    "https://perfil-sonda.invalid",
    "chave-sintetica",
    {
      auth: {
        storageKey: chave,
        storage: {
          ...abaA,
          getItem: (nome: string) => {
            const valor = abaA.getItem(nome);
            if (nome === chave) durante.lerSessao?.();
            return valor;
          },
        },
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const url = String(input);
          if (url.includes("/auth/v1/token")) {
            renovacoes.push(url);
            durante.renovar?.();
            return Response.json(sessao(CONTA_A));
          }
          if (!url.endsWith("/rest/v1/rpc/update_my_profile_secure")) {
            throw new Error("Pedido inesperado na sonda de perfil");
          }
          pedidos.push({
            authorization: new Headers(init?.headers).get("Authorization"),
            corpo: init?.body,
          });
          return durante.resposta();
        },
      },
    },
  );
  pararSondas.push(() => cliente.auth.stopAutoRefresh());
  await cliente.auth.initialize();
  alvo.cliente = cliente;
  return {
    pedidos,
    renovacoes,
    durante,
    entrarNaA: (valor: Session) => abaA.setItem(chave, JSON.stringify(valor)),
    entrarNaB: () => abaB.setItem(chave, JSON.stringify(sessao(CONTA_B))),
  };
}

afterEach(async () => {
  for (const parar of pararSondas.splice(0)) await parar();
});

describe("Perfil fixa a conta no envio com supabase-js real", () => {
  it("troca depois do retrato: fetch mantém o Authorization de A e o corpo original", async () => {
    const teste = await sonda();
    const original = sessao(CONTA_A);
    teste.entrarNaA(original);
    teste.durante.lerSessao = () => teste.entrarNaB();

    expect(await gravarPerfilDaConta(PERFIL, CONTA_A)).toEqual({ ok: true });
    expect(teste.pedidos).toEqual([
      {
        authorization: `Bearer ${original.access_token}`,
        corpo: JSON.stringify(PERFIL),
      },
    ]);
  });

  it("storage já tem B: recusa antes do RPC com motivo para a mensagem fixa", async () => {
    const teste = await sonda();
    teste.entrarNaB();

    const resultado = await gravarPerfilDaConta(PERFIL, CONTA_A);
    expect(resultado).toEqual({ ok: false, motivo: "conta_trocada" });
    if (!resultado.ok) {
      expect(mensagemFalhaCpf(resultado.motivo)).toBe(
        "A conta mudou durante a operação: nada foi salvo. Confira a conta e tente de novo.",
      );
    }
    expect(teste.pedidos).toEqual([]);
    expect(teste.renovacoes).toEqual([]);
  });

  it("sem sessão: recusa sem pedido de gravação nem renovação", async () => {
    const teste = await sonda();

    expect(await gravarPerfilDaConta(PERFIL, CONTA_A)).toEqual({
      ok: false,
      motivo: "sem_sessao",
    });
    expect(teste.pedidos).toEqual([]);
    expect(teste.renovacoes).toEqual([]);
  });

  it.each([null, "(34) 99999-8888"])(
    "sem troca: preserva os quatro parâmetros, inclusive WhatsApp %s",
    async (p_whatsapp) => {
      const teste = await sonda();
      const original = sessao(CONTA_A);
      teste.entrarNaA(original);
      const args = { ...PERFIL, p_whatsapp };

      expect(await gravarPerfilDaConta(args, CONTA_A)).toEqual({ ok: true });
      expect(teste.pedidos).toEqual([
        {
          authorization: `Bearer ${original.access_token}`,
          corpo: JSON.stringify(args),
        },
      ]);
    },
  );

  it("edição só de nome/WhatsApp preserva os parâmetros omitidos da tela", async () => {
    const teste = await sonda();
    teste.entrarNaA(sessao(CONTA_A));
    const args = { p_full_name: "Nome de A", p_whatsapp: null };

    expect(await gravarPerfilDaConta(args, CONTA_A)).toEqual({ ok: true });
    expect(teste.pedidos[0].corpo).toBe(JSON.stringify(args));
  });

  it("renovação de A é descartada após B entrar: recusa sem enviar como B", async () => {
    const teste = await sonda();
    teste.entrarNaA(sessao(CONTA_A, 30));
    teste.durante.renovar = () => teste.entrarNaB();

    expect(await gravarPerfilDaConta(PERFIL, CONTA_A)).toEqual({
      ok: false,
      motivo: "conta_trocada",
    });
    expect(teste.renovacoes).toHaveLength(1);
    expect(teste.pedidos).toEqual([]);
  });

  it("erro do servidor não devolve texto que possa carregar dados pessoais", async () => {
    const teste = await sonda();
    teste.entrarNaA(sessao(CONTA_A));
    teste.durante.resposta = () =>
      Response.json(
        { code: "23514", message: "Nome de A", details: "(34) 99999-8888" },
        { status: 400 },
      );

    expect(await gravarPerfilDaConta(PERFIL, CONTA_A)).toEqual({
      ok: false,
      motivo: "falha",
    });
  });
});
