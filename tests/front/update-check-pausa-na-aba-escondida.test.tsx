// @vitest-environment jsdom
// O módulo virtual do PWA não resolve neste runner (ver use-update-check-contrato).
// Executa o efeito REAL lido do fonte, sem copiar seu corpo nem alterar produção.
import { afterEach, expect, it, vi } from "vitest";

const fontes = import.meta.glob<string>("/src/hooks/useUpdateCheck.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const fonte = Object.values(fontes)[0] ?? "";
const inicio = fonte.indexOf(
  "  useEffect(() => {\n    if (!registration) return;",
);
const fimDoEfeito =
  "  }, [registration, fetchServerVersion, SAFE_APP_VERSION]);";
const fim = fonte.indexOf(fimDoEfeito, inicio);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("não consulta versão nem SW em 3 minutos escondida; consulta ao voltar e no próximo intervalo visível", async () => {
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  const efeito = fonte.slice(inicio, fim + fimDoEfeito.length);
  vi.useFakeTimers();
  const visibilidade = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const lerVersao = vi.fn(async () => "0.0.0-dev");
  const atualizar = vi.fn(async () => {});
  let limpar: (() => void) | undefined;
  const executar = new Function(
    "useEffect",
    "registration",
    "fetchServerVersion",
    "SAFE_APP_VERSION",
    "setNewVersion",
    efeito,
  );
  executar(
    (corpo: () => () => void) => {
      limpar = corpo();
    },
    { update: atualizar },
    lerVersao,
    "0.0.0-dev",
    vi.fn(),
  );
  try {
    await vi.advanceTimersByTimeAsync(180_000);
    expect(lerVersao).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();

    visibilidade.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(lerVersao).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(180_000);
    expect(lerVersao).toHaveBeenCalledTimes(2);
    expect(atualizar).toHaveBeenCalledTimes(2);
  } finally {
    limpar?.();
  }
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(180_000);
  expect(lerVersao).toHaveBeenCalledTimes(2);
  expect(atualizar).toHaveBeenCalledTimes(2);
});
