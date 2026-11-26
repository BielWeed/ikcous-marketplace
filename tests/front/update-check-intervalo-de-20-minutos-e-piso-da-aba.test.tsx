// @vitest-environment jsdom
// Cada rodada da checagem são 2 pedidos à CDN (/version.json + sw.js pelo
// registration.update()). A cada 3 min, um painel aberto 8 h/dia gastava
// ~9.600 pedidos/mês (medido em 26/11/2026) — com 60 lojas, mais da metade do
// limite mensal do plano. O intervalo passa a 20 min; a volta à aba continua
// checando, mas não duas vezes em menos de 1 min (troca rápida de aba).
//
// Mesma técnica de update-check-pausa-na-aba-escondida: o módulo virtual do
// PWA não resolve neste runner, então executa o efeito REAL lido do fonte.
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

const MINUTO = 60_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function montarEfeito() {
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  const efeito = fonte.slice(inicio, fim + fimDoEfeito.length);
  const visibilidade = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
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
  const voltarParaAba = async () => {
    visibilidade.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibilidade.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  };
  return { lerVersao, atualizar, voltarParaAba, limpar: () => limpar?.() };
}

it("com a aba visível, confere a versão a cada 20 min — nada aos 3, 10 nem 19 min", async () => {
  vi.useFakeTimers();
  const { lerVersao, atualizar, limpar } = montarEfeito();
  try {
    await vi.advanceTimersByTimeAsync(3 * MINUTO);
    expect(lerVersao).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(16 * MINUTO);
    expect(lerVersao).not.toHaveBeenCalled();
    expect(atualizar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1 * MINUTO);
    expect(lerVersao).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(20 * MINUTO);
    expect(lerVersao).toHaveBeenCalledTimes(2);
    expect(atualizar).toHaveBeenCalledTimes(2);
  } finally {
    limpar();
  }
});

it("voltar à aba confere, mas trocar de aba de novo em menos de 1 min não repete a checagem", async () => {
  vi.useFakeTimers();
  const { lerVersao, atualizar, voltarParaAba, limpar } = montarEfeito();
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    await voltarParaAba();
    expect(lerVersao).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);

    // Troca rápida de aba: 20 s e 50 s depois da checagem.
    await vi.advanceTimersByTimeAsync(20_000);
    await voltarParaAba();
    await vi.advanceTimersByTimeAsync(30_000);
    await voltarParaAba();
    expect(lerVersao).toHaveBeenCalledTimes(1);
    expect(atualizar).toHaveBeenCalledTimes(1);

    // Passado o piso de 1 min, a volta à aba confere de novo.
    await vi.advanceTimersByTimeAsync(11_000);
    await voltarParaAba();
    expect(lerVersao).toHaveBeenCalledTimes(2);
    expect(atualizar).toHaveBeenCalledTimes(2);
  } finally {
    limpar();
  }
});
