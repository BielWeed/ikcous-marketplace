// @vitest-environment jsdom
//
// `cofreVivo` (realtimeSyncEngine): quem segura uma instância do cofre
// capturada há tempo pode estar segurando uma CONEXÃO MORTA (outra aba subiu a
// versão do cofre e a fechou). Escrever nela é erro silencioso, e ler com
// `getAll` devolve `[]`, que a rodada leria como "cofre vazio" e apagaria o
// catálogo do aparelho. Por isso nas bordas assíncronas a instância é
// re-resolvida: a viva volta como está; a fechada é trocada pela reaberta.
//
// Bordas: instância SADIA nunca é reaberta (reabrir à toa derrubaria quem
// ainda a usa); instância sem `isClosed` (dublês, versões antigas) passa
// direto; a reabertura avisa o console UMA vez.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { DataVault } = await import("@/lib/dataVault");
const { cofreVivo } = await import("@/lib/realtimeSyncEngine");

// O construtor do cofre é privado: o tipo da instância vem do `init`.
type Cofre = Awaited<ReturnType<typeof DataVault.init>>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cofreVivo", () => {
  it("cofre FECHADO é trocado pelo reaberto, com um aviso no console", async () => {
    const reaberto = { reaberto: true } as unknown as Cofre;
    const abrir = vi.spyOn(DataVault, "init").mockResolvedValue(reaberto);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const morto = { isClosed: () => true } as unknown as Cofre;

    await expect(cofreVivo(morto)).resolves.toBe(reaberto);

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("cofre ABERTO volta como está: não reabre nada e não avisa", async () => {
    const abrir = vi.spyOn(DataVault, "init");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vivo = { isClosed: () => false } as unknown as Cofre;

    await expect(cofreVivo(vivo)).resolves.toBe(vivo);

    expect(abrir).not.toHaveBeenCalled();
    expect(aviso).not.toHaveBeenCalled();
  });

  it.each([
    ["sem isClosed (dublê ou versão antiga)", {}],
    ["isClosed que não é função", { isClosed: true }],
  ])(
    "instância %s passa direto, mesmo que 'isClosed' pareça verdadeiro",
    async (_nome, instancia) => {
      const abrir = vi.spyOn(DataVault, "init");
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const entrada = instancia as unknown as Cofre;

      await expect(cofreVivo(entrada)).resolves.toBe(entrada);

      expect(abrir).not.toHaveBeenCalled();
      expect(aviso).not.toHaveBeenCalled();
    },
  );
});
