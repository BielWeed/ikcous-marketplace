// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useLeaderElection", () => ({ useLeaderElection: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("loja sem BroadcastChannel (Safari antigo)", () => {
  it("carrega o motor de sincronização sem derrubar a abertura", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    await expect(import("@/lib/realtimeSyncEngine")).resolves.toHaveProperty(
      "RealtimeSyncEngine",
    );
  });

  it("carrega as perguntas sem derrubar a página do produto", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    await expect(import("@/hooks/useQuestions")).resolves.toHaveProperty(
      "useQuestions",
    );
  });

  it("carrega as avaliações sem a API existir no navegador", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    await expect(import("@/hooks/useReviews")).resolves.toHaveProperty(
      "useReviews",
    );
  });

  it("carrega os módulos mesmo quando o construtor recusa o canal", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("Canal bloqueado", "SecurityError");
        }
      },
    );
    await expect(import("@/lib/realtimeSyncEngine")).resolves.toBeDefined();
    await expect(import("@/hooks/useQuestions")).resolves.toBeDefined();
    await expect(import("@/hooks/useReviews")).resolves.toBeDefined();
  });

  it("continua abrindo os canais quando a API existe", async () => {
    const canais: string[] = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor(nome: string) {
          canais.push(nome);
        }
      },
    );
    await import("@/lib/realtimeSyncEngine");
    await import("@/hooks/useQuestions");
    await import("@/hooks/useReviews");
    expect(canais).toEqual([
      "ikcous_realtime_db_sync",
      "ikcous_questions_sync",
      "ikcous_reviews_sync",
    ]);
  });
});
