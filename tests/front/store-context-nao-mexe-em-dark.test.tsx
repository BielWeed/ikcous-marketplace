// @vitest-environment jsdom
//
// Prova da correção do ADMIN-100 (issue #102): dois efeitos disputavam a
// classe `dark` no elemento html -- o App.tsx adiciona quando a view começa
// com "admin", e o StoreContext removia sempre que primaryColor ou themeMode
// mudavam. Salvar a cor primária no painel (que só muda `primaryColor`, não
// `currentView` nem `config.themeMode`) fazia o StoreContext recalcular com
// base no themeMode (default "light") e remover o "dark" que o App.tsx tinha
// colocado por estar em rota de admin -- o admin virava tema claro no meio
// da sessão, com texto branco sobre branco, porque o efeito do App.tsx não
// tinha motivo para re-rodar (as deps dele não mudaram).
//
// Este teste reproduz exatamente esse cenário: simula o `dark` já presente
// (como o App.tsx teria colocado por estar no admin) e chama updateConfig
// só com `primaryColor` -- o único dono da classe `dark` agora é o App.tsx,
// então o StoreContext não pode mais mexer nela.
//
// POR QUE RENDER DE VERDADE DO StoreProvider (react-dom/client + jsdom): o
// bug vive na interação entre dois useEffect reais: um dublê de contexto não
// prova nada sobre QUEM chama classList.add/remove.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Import estático: os `vi.mock` abaixo são hoistados pelo Vitest para ANTES
// de qualquer import deste arquivo, então StoreContext já enxerga as
// dependências dubladas mesmo importado no topo (sem precisar de import()
// dinâmico dentro de cada `it`, como checkout-view-flag-off.test.tsx faz
// para módulos que leem estado por-teste na hora do import).
import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// DataVault real faz IndexedDB de verdade (indisponível no jsdom puro) --
// `getById` resolvendo `null` pula o ramo que aplicaria config de cache, e
// isola este teste no efeito que a issue #102 aponta como o culpado
// (config.primaryColor / config.themeMode), sem o ramo de carregamento de
// cache interferindo.
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

// Builder encadeável e "thenable": cobre `.from().select().single()` (usado
// por fetchConfig) e `.from().select().is().limit().order()` (fetchProducts)
// sem precisar replicar a assinatura exata de cada chamada -- qualquer
// método devolve o próprio proxy, e `await` nele resolve para `resultado`.
function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel({ data: [], error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfigFn = (updates: Record<string, unknown>) => Promise<boolean>;

// Componente pequeno só para tirar `updateConfig` do contexto e devolver
// para o corpo do teste via callback -- StoreProvider não expõe um jeito de
// chamar seus métodos de fora da árvore React.
function Capturador({ onReady }: { onReady: (fn: UpdateConfigFn) => void }) {
  const { updateConfig } = useStore();
  const onReadyRef = useRef(onReady);
  // A escrita no ref vai num efeito, não no corpo do render: escrever em ref
  // durante o render é erro de eslint (`react-hooks`, "Cannot access refs
  // during render") e o teto da catraca é 0 erro. O padrão de dois efeitos é
  // o "latest ref" canônico -- o primeiro mantém o ref atual, o segundo só
  // dispara quando `updateConfig` muda de identidade.
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    onReadyRef.current(updateConfig);
  }, [updateConfig]);
  return null;
}

describe("StoreContext — quem é o dono da classe dark (ADMIN-100, #102)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.documentElement.classList.remove("dark");
  });

  it("salvar a cor primária não remove a classe dark que o App.tsx colocou por estar em rota de admin", async () => {
    // Simula o que o App.tsx já teria feito ao entrar numa rota de admin,
    // ANTES de qualquer render do StoreProvider -- exatamente como acontece
    // na app de verdade, onde currentView já começa com "admin".
    document.documentElement.classList.add("dark");

    const updateConfigRef: { current: UpdateConfigFn | null } = {
      current: null,
    };

    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador
            onReady={(fn) => {
              updateConfigRef.current = fn;
            }}
          />
        </StoreProvider>,
      );
    });

    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () => {
      await updateConfigRef.current!({ primaryColor: "#111111" });
    });

    // A garantia central do ADMIN-100: só mudar a cor primária não pode
    // desfazer o "dark" que outra parte do app colocou.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
