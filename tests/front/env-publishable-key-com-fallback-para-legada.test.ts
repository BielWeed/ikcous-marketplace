// INFRA-260 (#126): o Supabase está trocando as chaves de API — `anon`
// (legada, formato JWT) dá lugar a `publishable` (`sb_publishable_...`). As
// legadas funcionam até o dono desligá-las num clique no Dashboard, sem
// data. `src/lib/env.ts` lia só `VITE_SUPABASE_ANON_KEY` e o portão de boot
// derrubava a loja inteira se ela faltasse — no instante do desligamento, o
// front para de carregar mesmo com a chave nova disponível.
//
// `env.ts` faz trabalho no TOPO do módulo (o portão de boot roda na própria
// avaliação, e pode lançar) — por isso cada teste reimporta do zero com
// `vi.resetModules()` + `import()` dinâmico, mesmo padrão de
// `pagamento-online.test.tsx` (`importarLimpo`). Importar uma vez só e
// esperar comportamentos diferentes entre casos não funciona aqui.
//
// Armadilha desta máquina: existe `.env` no repositório com
// `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` de verdade, e esses valores
// vazam para `import.meta.env` se o teste não isolar. `vi.stubEnv` sobrepõe
// o valor (inclusive para string vazia) para a chamada corrente; sem
// `vi.unstubAllEnvs()` no `afterEach`, um teste contamina o próximo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importarEnvLimpo() {
  vi.resetModules();
  return import("@/lib/env");
}

describe("env.ts — publishable key nova com fallback para a anon legada (INFRA-260)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Sempre restaura os spies aqui, não só no fim de cada `it` — se uma
    // asserção falhar ANTES do `espiao.mockRestore()` manual, o spy de
    // console.info vazaria pro próximo teste e cascatearia falhas que não
    // têm nada a ver com a causa real.
    vi.restoreAllMocks();
  });

  it("só a publishable definida, a legada ausente: resolve a chave e NÃO derruba o boot — este é o caso que hoje falha", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste123");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const env = await importarEnvLimpo();

    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_teste123");
    // Alias de compatibilidade: hoje nenhum módulo importa `SUPABASE_ANON_KEY`
    // de `@/lib/env` (grep confirma: só `SUPABASE_PUBLISHABLE_KEY` e
    // `SUPABASE_URL` são importados em `supabase.ts`). Este export é o ponto
    // de pouso para a migração futura de `useOnlineStatus.ts:48`, que hoje lê
    // `import.meta.env.VITE_SUPABASE_ANON_KEY` cru — tem que apontar para o
    // MESMO valor resolvido, não para a legada vazia.
    expect(env.SUPABASE_ANON_KEY).toBe("sb_publishable_teste123");
  });

  it("controle — só a legada definida (estado real de produção hoje): continua funcionando", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-legada-teste");

    const env = await importarEnvLimpo();

    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("chave-legada-teste");
  });

  it("nenhuma das duas definida: o portão de boot dispara nomeando as DUAS variáveis", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    await expect(importarEnvLimpo()).rejects.toThrow(
      /VITE_SUPABASE_PUBLISHABLE_KEY/,
    );
    // Reimporta (o `throw` acima já consumiu o resetModules certo, mas o
    // módulo quebrado não fica em cache utilizável) para conferir que a
    // legada TAMBÉM é nomeada na mesma mensagem — quem for depurar não pode
    // procurar só uma das duas.
    let mensagem = "";
    try {
      await importarEnvLimpo();
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toContain("VITE_SUPABASE_ANON_KEY");
  });

  it("precedência: com as duas definidas e valores diferentes, vale a publishable", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_nova");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-legada-antiga");

    const env = await importarEnvLimpo();

    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_nova");
  });

  it("publishable suja com zero-width: a limpeza roda ANTES do fallback, não só na legada", async () => {
    // Mutante M7 (tirar o cleanEnvVar da chave nova): com ele, o valor sujo
    // sobrevive por inteiro e o teste abaixo falharia comparando com a
    // string ainda contendo o caractere invisível.
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x​");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const env = await importarEnvLimpo();

    expect(env.SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_x");
  });

  it("publishable resolvida: avisa por console.info QUAL variável venceu, sem vazar o valor", async () => {
    const espiao = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste123");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    await importarEnvLimpo();

    expect(espiao).toHaveBeenCalledTimes(1);
    const [mensagem] = espiao.mock.calls[0] as [string];
    expect(mensagem).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(mensagem).not.toContain("sb_publishable_teste123");
    espiao.mockRestore();
  });

  it("fallback para a legada: o console.info nomeia VITE_SUPABASE_ANON_KEY, não a publishable", async () => {
    const espiao = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-legada-teste");

    await importarEnvLimpo();

    expect(espiao).toHaveBeenCalledTimes(1);
    const [mensagem] = espiao.mock.calls[0] as [string];
    expect(mensagem).toContain("VITE_SUPABASE_ANON_KEY");
    expect(mensagem).not.toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(mensagem).not.toContain("chave-legada-teste");
    espiao.mockRestore();
  });

  it("nenhuma das duas definida: o caminho de erro NÃO emite o console.info de sucesso", async () => {
    const espiao = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    await expect(importarEnvLimpo()).rejects.toThrow();

    expect(espiao).not.toHaveBeenCalled();
    espiao.mockRestore();
  });
});
