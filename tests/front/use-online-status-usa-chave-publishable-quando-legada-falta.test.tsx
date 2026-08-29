// @vitest-environment jsdom
//
// INFRA-260 (#126): `useOnlineStatus` lia `import.meta.env.VITE_SUPABASE_ANON_KEY`
// cru, direto do `import.meta.env`, sem passar pelo portão `@/lib/env`. Quando
// a chave legada (`anon`) for desligada no Dashboard do Supabase — um botão,
// sem data marcada —, essa leitura crua vira `undefined` e a sonda de
// diagnóstico de conexão passa a mandar `apikey`/`Authorization` vazios,
// recebendo 401 do PostgREST em vez de medir latência de verdade.
//
// O hook NÃO importa `@/lib/env` (esse módulo lança na própria avaliação, e
// importá-lo de um hook derrubou 14 arquivos de teste no CI). Ele importa
// `@/lib/env-valores`, que é puro, e chama `lerSupabaseUrl()`/
// `lerChaveSupabase()` DENTRO da sonda — leitura viva, resolvida na chamada.
//
// A reimportação do zero (`vi.resetModules()` + `import()` dinâmico) fica
// mesmo assim, e não é sobra: ela isola o estado de módulo entre os casos e
// segue o padrão de `env-publishable-key-com-fallback-para-legada.test.ts` e
// `pagamento-online.test.tsx` (`importarLimpo`). O que mudou é o MOTIVO —
// antes ela era obrigatória porque o valor congelava na avaliação; hoje é
// higiene, e o `vi.stubEnv` do `beforeEach` alcança a leitura.
//
// Armadilha desta máquina: existe `.env` no repositório com
// `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` reais, e eles vazam para
// `import.meta.env` se o teste não isolar com `vi.stubEnv` + `vi.unstubAllEnvs()`.
//
// `createRoot` + `act` do React puro, sem `@testing-library/react` (não
// instalado neste projeto) — mesmo padrão de
// `use-online-status-502-isolado-nao-marca-offline.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function importarHookLimpo() {
  vi.resetModules();
  return import("@/hooks/useOnlineStatus");
}

describe("useOnlineStatus — a sonda usa a chave resolvida por @/lib/env, não a legada crua (INFRA-260)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
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
    vi.restoreAllMocks();
  });

  async function montarEDeixarSondaResolver(useOnlineStatus: () => boolean) {
    function Sonda() {
      const isOffline = useOnlineStatus();
      return <span data-testid="offline">{String(isOffline)}</span>;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("só a publishable definida, a legada ausente: a sonda manda a NOVA chave nos headers — hoje manda undefined", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste123");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { useOnlineStatus } = await importarHookLimpo();
    await montarEDeixarSondaResolver(useOnlineStatus);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_publishable_teste123");
    expect(headers.Authorization).toBe("Bearer sb_publishable_teste123");
  });

  it("controle — só a legada definida (estado real de produção hoje): a sonda continua funcionando com ela", async () => {
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-legada-teste");

    const fetchMock = vi.fn().mockResolvedValue({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { useOnlineStatus } = await importarHookLimpo();
    await montarEDeixarSondaResolver(useOnlineStatus);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("chave-legada-teste");
    expect(headers.Authorization).toBe("Bearer chave-legada-teste");
  });
});
