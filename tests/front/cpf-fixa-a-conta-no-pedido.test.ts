// O SDK real relê o storage no fetch: a conta conferida e o token enviado
// precisam vir do mesmo retrato, mesmo quando outra aba troca a sessão.
import { type Session, createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const alvo = vi.hoisted(() => ({ cliente: null as unknown }));
vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return alvo.cliente;
  },
}));

import { gravarCpfDaConta } from "@/lib/cpf-da-conta";

const CONTA_A = "00000000-0000-4000-8000-00000000000a";
const CONTA_B = "00000000-0000-4000-8000-00000000000b";
const CPF = "12345678909"; // Fixture sintética calculada por dígitos verificadores.
let numeroDaSonda = 0;
const pararSondas: (() => Promise<void>)[] = [];

function sessao(userId: string, validade = 3600): Session {
  const agora = Math.floor(Date.now() / 1000);
  const payload = { sub: userId, iat: agora, exp: agora + validade };
  const codificar = (valor: unknown) =>
    Buffer.from(JSON.stringify(valor)).toString("base64url");
  return {
    access_token: `${codificar({ alg: "HS256", typ: "JWT" })}.${codificar(payload)}.assinatura-sintetica`,
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
  const chave = `cpf-sonda-${++numeroDaSonda}`;
  const dados = new Map<string, string>();
  // Duas interfaces independentes para o mesmo armazenamento, como duas abas.
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
    renovar: null as (() => void) | null,
    lerSessao: null as (() => void) | null,
  };
  const cliente = createClient("https://cpf-sonda.invalid", "chave-sintetica", {
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
        if (!url.endsWith("/rest/v1/rpc/set_my_cpf")) {
          throw new Error("Pedido inesperado na sonda de CPF");
        }
        pedidos.push({
          authorization: new Headers(init?.headers).get("Authorization"),
          corpo: init?.body,
        });
        return Response.json(null);
      },
    },
  });
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

describe("CPF fixa a conta no pedido com supabase-js real", () => {
  it("C1: armazenamento já tem B e a operação pertence a A: recusa sem enviar", async () => {
    const teste = await sonda();
    teste.entrarNaB();

    expect(await gravarCpfDaConta(CPF, CONTA_A)).toEqual({
      ok: false,
      motivo: "conta_trocada",
    });
    expect(teste.pedidos).toEqual([]);
    expect(teste.renovacoes).toEqual([]);
  });

  it("I0: sem troca envia exatamente o token de A e apenas p_cpf normalizado", async () => {
    const teste = await sonda();
    const original = sessao(CONTA_A);
    teste.entrarNaA(original);

    expect(await gravarCpfDaConta("123.456.789-09", CONTA_A)).toEqual({
      ok: true,
    });
    expect(teste.pedidos).toEqual([
      {
        authorization: `Bearer ${original.access_token}`,
        corpo: `{"p_cpf":"${CPF}"}`,
      },
    ]);
  });

  it("troca depois do retrato: o fetch relê B mas mantém o Authorization de A", async () => {
    const teste = await sonda();
    const original = sessao(CONTA_A);
    teste.entrarNaA(original);
    teste.durante.lerSessao = () => teste.entrarNaB();

    expect(await gravarCpfDaConta(CPF, CONTA_A)).toEqual({ ok: true });
    expect(teste.pedidos).toEqual([
      {
        authorization: `Bearer ${original.access_token}`,
        corpo: `{"p_cpf":"${CPF}"}`,
      },
    ]);
  });

  it("C2: renovação de A perto de vencer é descartada após B entrar: nunca envia como B", async () => {
    const teste = await sonda();
    teste.entrarNaA(sessao(CONTA_A, 30));
    teste.durante.renovar = () => teste.entrarNaB();

    expect(await gravarCpfDaConta(CPF, CONTA_A)).toEqual({
      ok: false,
      motivo: "conta_trocada",
    });
    expect(teste.renovacoes).toHaveLength(1);
    expect(teste.pedidos).toEqual([]);
  });

  it("sem sessão: recusa sem pedido de gravação nem renovação", async () => {
    const teste = await sonda();

    expect(await gravarCpfDaConta(CPF, CONTA_A)).toEqual({
      ok: false,
      motivo: "sem_sessao",
    });
    expect(teste.pedidos).toEqual([]);
    expect(teste.renovacoes).toEqual([]);
  });
});
