// Lote 257 (caça 13-C, achado 4): `sessaoAindaEhDoDono` devolve `false` tanto
// quando a sessão NÃO existe quanto quando o supabase-js não conseguiu
// RENOVAR o token por falta de internet — e o checkout dizia "Sua sessão
// expirou, entre de novo" nos dois. Agora quem chama pode saber que foi a
// rede (segundo parâmetro), sem mudar o `true/false` que 30 telas e filas
// já usam: o `false` NUNCA vira `true`, e "não sei" continua sem enviar.
//
// Sem dublê de resultado: o cliente é o supabase-js REAL (versão instalada),
// com o armazenamento e o `fetch` trocados. Assim o teste prova o que a caça
// não tinha medido -- que, com o token vencido e a rede fora, `getSession()`
// devolve `session: null` COM um erro de rede (e não "sem sessão" puro).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { rede } = vi.hoisted(() => ({
  rede: {
    /** O que o servidor de autenticação responde ao pedido de renovar. */
    resposta: "fora-do-ar" as "fora-do-ar" | "token-rejeitado" | "indisponivel",
    pedidos: 0,
  },
}));

const CHAVE = "teste-da-sessao";
const armazem = new Map<string, string>();

vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const cliente = createClient("http://localhost:54321", "chave-anonima", {
    auth: {
      storageKey: CHAVE,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (k: string) => armazem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          armazem.set(k, v);
        },
        removeItem: (k: string) => {
          armazem.delete(k);
        },
      },
    },
    global: {
      fetch: async () => {
        rede.pedidos++;
        if (rede.resposta === "fora-do-ar") {
          throw new TypeError("Failed to fetch");
        }
        if (rede.resposta === "indisponivel") {
          return new Response("{}", { status: 503 });
        }
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid Refresh Token: Already Used",
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      },
    },
  });
  return { supabase: cliente };
});

// O supabase-js guarda a última falha de renovação POR token de renovação (para
// não martelar o servidor): cada caso usa um token novo, senão herdaria a falha
// do caso anterior.
let contadorDeTokens = 0;

function guardarSessao(expiraEmSegundos: number, userId = "user-1") {
  armazem.set(
    CHAVE,
    JSON.stringify({
      access_token: "acesso",
      refresh_token: `renovacao-${++contadorDeTokens}`,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + expiraEmSegundos,
      user: { id: userId, aud: "authenticated", app_metadata: {} },
    }),
  );
}

describe("sessaoAindaEhDoDono — separa 'sem internet' de 'sem sessão'", () => {
  let aoFalharPorRede: Mock<() => void>;

  // Sem rede, o supabase-js TENTA RENOVAR com espera crescente (200 ms, 400 ms,
  // 800 ms...) por até ~25 s antes de desistir. O relógio é falso para o teste
  // não esperar isso de verdade.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    armazem.clear();
    rede.resposta = "fora-do-ar";
    rede.pedidos = 0;
    aoFalharPorRede = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Deixa passar o tempo todo das tentativas de renovação. */
  const passarAsTentativas = () => vi.advanceTimersByTimeAsync(40_000);

  async function conferir(userId = "user-1") {
    const { sessaoAindaEhDoDono } = await import(
      "@/lib/sessao-ainda-e-do-dono"
    );
    const resposta = sessaoAindaEhDoDono(userId, aoFalharPorRede);
    await passarAsTentativas();
    return resposta;
  }

  it("sanidade do dublê: o cliente é o supabase-js real e não renova sem rede", async () => {
    guardarSessao(-60);
    const { supabase } = await import("@/lib/supabase");
    const leitura = (supabase as SupabaseClient).auth.getSession();
    await passarAsTentativas();
    const { data, error } = await leitura;
    expect(data.session).toBeNull();
    expect(error?.name).toBe("AuthRetryableFetchError");
    expect(rede.pedidos).toBeGreaterThan(0);
  });

  it("token vencido e internet fora: false E avisa que foi a rede", async () => {
    guardarSessao(-60);
    expect(await conferir()).toBe(false);
    expect(aoFalharPorRede).toHaveBeenCalledTimes(1);
  });

  it("token vencido e servidor de autenticação indisponível (503): false E avisa que foi a rede", async () => {
    rede.resposta = "indisponivel";
    guardarSessao(-60);
    expect(await conferir()).toBe(false);
    expect(aoFalharPorRede).toHaveBeenCalledTimes(1);
  });

  it("renovação RECUSADA pelo servidor (token já usado): é sessão perdida de verdade, não rede", async () => {
    rede.resposta = "token-rejeitado";
    guardarSessao(-60);
    expect(await conferir()).toBe(false);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
  });

  it("sem sessão guardada: false e NÃO é rede", async () => {
    expect(await conferir()).toBe(false);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
    expect(rede.pedidos).toBe(0);
  });

  it("sessão de OUTRA conta: false e NÃO é rede", async () => {
    guardarSessao(3600, "user-2");
    expect(await conferir("user-1")).toBe(false);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
  });

  it("sessão do dono ainda válida: true, sem pedir nada à rede e sem avisar", async () => {
    guardarSessao(3600);
    expect(await conferir()).toBe(true);
    expect(aoFalharPorRede).not.toHaveBeenCalled();
    expect(rede.pedidos).toBe(0);
  });

  it("quem chama sem o segundo parâmetro (filas offline, produtos) segue recebendo só true/false", async () => {
    guardarSessao(-60);
    const { sessaoAindaEhDoDono } = await import(
      "@/lib/sessao-ainda-e-do-dono"
    );
    const resposta = sessaoAindaEhDoDono("user-1");
    await passarAsTentativas();
    expect(await resposta).toBe(false);
  });
});
