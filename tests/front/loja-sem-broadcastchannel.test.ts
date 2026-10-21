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
    await expect(import("@/lib/realtimeSyncEngine")).resolves.toHaveProperty(
      "RealtimeSyncEngine",
    );
  });

  it("carrega as perguntas sem derrubar a página do produto", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    await expect(import("@/hooks/useQuestions")).resolves.toHaveProperty(
      "useQuestions",
    );
  });

  it("continua abrindo os dois canais quando a API existe", async () => {
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
    expect(canais).toEqual([
      "ikcous_realtime_db_sync",
      "ikcous_questions_sync",
    ]);
  });
});
