// `src/lib/env.ts` mistura duas responsabilidades: o CÁLCULO dos valores de
// ambiente (puro) e o PORTÃO de boot (que lança e pinta a tela de erro na
// própria avaliação do módulo). Isso quebra qualquer arquivo que precise só
// do valor — como `useOnlineStatus.ts` — porque importar `@/lib/env` sem
// `.env` presente derruba o teste inteiro antes dele rodar.
//
// `src/lib/env-valores.ts` é a metade pura extraída: mesmos valores, ZERO
// efeito colateral. A propriedade que este arquivo prova é exatamente essa —
// importar com as duas chaves ausentes NÃO lança. Sem este teste, nada
// impede alguém de devolver o `throw` para cá no futuro.
//
// Mesmo cuidado de isolamento do teste irmão
// (env-publishable-key-com-fallback-para-legada.test.ts): existe `.env` real
// no repositório, e os valores vazam para `import.meta.env` se o teste não
// isolar com `vi.stubEnv` + `vi.resetModules()` por caso.
//
// As funções `lerSupabaseUrl`/`lerChaveSupabase`/`lerOrigemChaveSupabase`
// substituíram as constantes de módulo (`SUPABASE_URL` etc.) que existiam
// aqui antes: uma `const` de módulo ES congela o valor na avaliação do
// import, que acontece ANTES de qualquer `beforeEach` de quem importa o
// módulo estaticamente no topo do arquivo (era exatamente o caso de
// `tests/front/use-online-status-502-isolado-nao-marca-offline.test.tsx`,
// que usa `vi.stubEnv` dentro do `beforeEach` e nunca via um `vi.resetModules()`
// para esse hook). Com leitura ao vivo, cada chamada relê `import.meta.env`.
import { afterEach, describe, expect, it, vi } from "vitest";

async function importarValoresLimpo() {
  vi.resetModules();
  return import("@/lib/env-valores");
}

describe("env-valores.ts — módulo puro, sem efeito colateral", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("as duas chaves ausentes: importar NÃO lança — esta é a propriedade inteira do módulo", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    await expect(importarValoresLimpo()).resolves.toBeDefined();
  });

  it("as duas chaves ausentes: os valores lidos são string vazia, não undefined", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const mod = await importarValoresLimpo();

    expect(mod.lerSupabaseUrl()).toBe("");
    expect(mod.lerChaveSupabase()).toBe("");
  });

  it("publishable nova com fallback para a legada: mesma precedência de env.ts", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-legada-teste");

    const mod = await importarValoresLimpo();

    expect(mod.lerChaveSupabase()).toBe("chave-legada-teste");
    expect(mod.lerOrigemChaveSupabase()).toBe("VITE_SUPABASE_ANON_KEY");
  });

  it("cleanEnvVar remove o que não é ASCII imprimível", async () => {
    const mod = await importarValoresLimpo();

    expect(mod.cleanEnvVar("sb_publishable_x​")).toBe("sb_publishable_x");
  });

  it("lerSupabaseUrl e lerChaveSupabase leem AO VIVO: um import único, duas chamadas, dois valores diferentes", async () => {
    // Esta é a propriedade que uma `const` de módulo não tem: aqui o módulo é
    // importado UMA vez só (sem `vi.resetModules()` entre as leituras) e o
    // ambiente muda DEPOIS do import — exatamente a forma que
    // `useOnlineStatus.ts` precisa, porque ele é importado estaticamente no
    // topo de um arquivo de teste, antes do `beforeEach` rodar.
    const mod = await importarValoresLimpo();

    vi.stubEnv("VITE_SUPABASE_URL", "https://primeiro.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-primeira");
    expect(mod.lerSupabaseUrl()).toBe("https://primeiro.supabase.co");
    expect(mod.lerChaveSupabase()).toBe("chave-primeira");

    vi.stubEnv("VITE_SUPABASE_URL", "https://segundo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "chave-segunda");
    expect(mod.lerSupabaseUrl()).toBe("https://segundo.supabase.co");
    expect(mod.lerChaveSupabase()).toBe("chave-segunda");
  });
});
