// `resolverConexao` é o outro ponto de onde nasce "loja A com dado de loja
// B" (parecer do sócio, PARA A HUB): decide QUAL banco o porteiro vai
// perguntar. Caminho (a) = caderneta central (`resolver_loja`, injetada —
// nunca fetch de verdade aqui, isto é teste de unidade); caminho (b) = o
// ambiente do próprio projeto Vercel, mesma limpeza (`cleanEnvVar`) e
// precedência (publishable > anon) que o resto do repo usa. Rodada B
// (11/09/2026, brief T3b): `resolverConexao` devolve também `caderneta`
// ("hit"|"miss"|"erro"|"ausente") — "cair em (b) nunca é silencioso" — e a
// caderneta passa a exigir TRÊS variáveis (`IKCOUS_FROTA_URL`/`_APIKEY`/
// `_CHAVE`), e o callback injetado devolve um `ResultadoCaderneta`
// (`{tipo:"hit",conexao}` | `{tipo:"miss"}` | `{tipo:"erro"}`) em vez de
// `ConexaoResolvida | null`.
import { describe, expect, it } from "vitest";

import { resolverConexao } from "@/hospedagem/porteiro";
import type {
  ResolverLojaNaCaderneta,
  ResultadoCaderneta,
} from "@/hospedagem/porteiro";

// JWT legado sintético, só para o classificador de chave (`publicSupabaseKey.ts`)
// reconhecer o papel — assinatura fictícia, nenhuma chave real.
function jwtDeTeste(role: string): string {
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.assinatura`;
}

const AMBIENTE_FROTA_COMPLETO = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_da_principal",
  IKCOUS_FROTA_CHAVE: "segredo-da-frota",
};

describe("resolverConexao — caminho (a), a caderneta central", () => {
  it("com as TRÊS variáveis no ambiente e a caderneta devolve hit -> usa a caderneta, estado 'hit'", async () => {
    const chamadas: Array<[string, string, string, string]> = [];
    const caderneta: ResolverLojaNaCaderneta = async (
      host,
      url,
      apikey,
      chave,
    ) => {
      chamadas.push([host, url, apikey, chave]);
      return {
        tipo: "hit",
        conexao: {
          supabaseUrl: "https://frota-encontrou.supabase.co",
          publishableKey: "sb_publishable_da_frota",
          origem: "caderneta",
        },
      };
    };
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      {
        ...AMBIENTE_FROTA_COMPLETO,
        VITE_SUPABASE_URL: "https://nao-deveria-usar.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_nao_deveria_usar",
      },
      caderneta,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://frota-encontrou.supabase.co",
        publishableKey: "sb_publishable_da_frota",
        origem: "caderneta",
      },
      caderneta: "hit",
    });
    expect(chamadas).toEqual([
      [
        "loja-a.exemplo",
        "https://principal.supabase.co",
        "sb_publishable_da_principal",
        "segredo-da-frota",
      ],
    ]);
  });

  it("frota configurada mas a caderneta devolve miss (zero linhas) -> cai no caminho (b), estado 'miss'", async () => {
    const caderneta: ResolverLojaNaCaderneta = async () => ({ tipo: "miss" });
    const resultado = await resolverConexao(
      "loja-nova.exemplo",
      {
        ...AMBIENTE_FROTA_COMPLETO,
        VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
      },
      caderneta,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://projeto-proprio.supabase.co",
        publishableKey: "sb_publishable_do_projeto",
        origem: "projeto",
      },
      caderneta: "miss",
    });
  });

  it("a caderneta devolve erro (HTTP não-2xx ou rede, já classificado por quem a implementa) -> cai no caminho (b), estado 'erro'", async () => {
    const caderneta: ResolverLojaNaCaderneta = async () => ({ tipo: "erro" });
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      {
        ...AMBIENTE_FROTA_COMPLETO,
        VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
      },
      caderneta,
    );
    expect(resultado.caderneta).toBe("erro");
    expect(resultado.conexao?.origem).toBe("projeto");
  });

  it("uma chave service_role devolvida pela caderneta (hit) NUNCA é repassada — cai no caminho (b), estado 'erro' (resposta anômala, nunca 'hit')", async () => {
    // Defesa em profundidade: o porteiro não confia cegamente na fonte (a),
    // mesmo sendo a caderneta central — service_role no Edge é "chave de
    // tudo no banco da principal" (parecer, item 6 da tabela).
    const caderneta: ResolverLojaNaCaderneta =
      async (): Promise<ResultadoCaderneta> => ({
        tipo: "hit",
        conexao: {
          supabaseUrl: "https://frota-com-bug.supabase.co",
          publishableKey: jwtDeTeste("service_role"),
          origem: "caderneta",
        },
      });
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      {
        ...AMBIENTE_FROTA_COMPLETO,
        VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
      },
      caderneta,
    );
    expect(resultado.conexao?.publishableKey).toBe("sb_publishable_do_projeto");
    expect(resultado.conexao?.origem).toBe("projeto");
    expect(resultado.caderneta).toBe("erro");
  });

  it("falta só IKCOUS_FROTA_APIKEY (as outras duas presentes) -> estado 'ausente', nunca chama a caderneta", async () => {
    let chamou = false;
    const caderneta: ResolverLojaNaCaderneta = async () => {
      chamou = true;
      return { tipo: "miss" };
    };
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      {
        IKCOUS_FROTA_URL: "https://principal.supabase.co",
        IKCOUS_FROTA_CHAVE: "segredo-da-frota",
        VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
      },
      caderneta,
    );
    expect(chamou).toBe(false);
    expect(resultado.caderneta).toBe("ausente");
    expect(resultado.conexao?.origem).toBe("projeto");
  });
});

describe("resolverConexao — caminho (b), o ambiente do próprio projeto", () => {
  it("sem as três variáveis da frota -> cai direto no ambiente do projeto, estado 'ausente', sem chamar a caderneta", async () => {
    let chamou = false;
    const caderneta: ResolverLojaNaCaderneta = async () => {
      chamou = true;
      return { tipo: "miss" };
    };
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      {
        VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
      },
      caderneta,
    );
    expect(chamou).toBe(false);
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://projeto-proprio.supabase.co",
        publishableKey: "sb_publishable_do_projeto",
        origem: "projeto",
      },
      caderneta: "ausente",
    });
  });

  it("nenhuma função de caderneta injetada, mesmo com as três variáveis presentes -> também 'ausente' (defensivo)", async () => {
    const resultado = await resolverConexao("loja-a.exemplo", {
      ...AMBIENTE_FROTA_COMPLETO,
      VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto",
    });
    expect(resultado.caderneta).toBe("ausente");
    expect(resultado.conexao?.origem).toBe("projeto");
  });

  it("publishable ausente cai para a anon legada, mesma precedência de resolverValoresPublicosSupabase", async () => {
    const resultado = await resolverConexao("loja-a.exemplo", {
      VITE_SUPABASE_URL: "https://projeto-proprio.supabase.co",
      VITE_SUPABASE_ANON_KEY: jwtDeTeste("anon"),
    });
    expect(resultado.caderneta).toBe("ausente");
    expect(resultado.conexao?.publishableKey.includes("eyJ")).toBe(true);
  });

  it("nem url nem chave configuradas -> conexão null (sem-loja mais adiante), caderneta 'ausente'", async () => {
    const resultado = await resolverConexao("loja-a.exemplo", {});
    expect(resultado).toEqual({ conexao: null, caderneta: "ausente" });
  });

  it("valor de env sujo (espaço colado) é limpo antes de usar — mesma `cleanEnvVar` do resto do repo", async () => {
    const resultado = await resolverConexao("loja-a.exemplo", {
      VITE_SUPABASE_URL: " https://projeto-proprio.supabase.co ",
      VITE_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_do_projeto ",
    });
    expect(resultado.conexao?.supabaseUrl).toBe(
      "https://projeto-proprio.supabase.co",
    );
    expect(resultado.conexao?.publishableKey).toBe("sb_publishable_do_projeto");
  });
});
