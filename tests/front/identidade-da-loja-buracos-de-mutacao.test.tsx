// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em IdentitySettingsSection (a seção de
// imagens da marca da loja). O editor (hook) é um dublê: aqui se prova o que
// a TELA decide sobre as imagens:
//  - que tipos de arquivo cada envio aceita (ícone e compartilhamento só PNG);
//  - o limite de oito fontes guardadas, para adicionar e para guardar;
//  - sempre sobra ao menos uma fonte (retirar trava na última);
//  - "Usar também na abertura" leva o cabeçalho e a abertura juntos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estado } = vi.hoisted(() => ({
  estado: {
    originais: ["fonte-1.png"] as string[],
    nome: "Loja de Teste",
    locked: false,
    upload: vi.fn(),
    keepSource: vi.fn(),
    removeSource: vi.fn(),
  },
}));

vi.mock("@/hooks/useStoreIdentityEditor", () => ({
  useStoreIdentityEditor: () => {
    const ativo = (nome: string) => ({ path: nome });
    return {
      allowed: true,
      origin: "https://exemplo-de-teste.invalid",
      phase: "editing",
      message: null,
      busy: false,
      dirty: false,
      locked: estado.locked,
      progress: null,
      current: null,
      draft: {
        fields: {
          storeName: estado.nome,
          storeCity: "Cidade",
          storeState: "MG",
          primaryColor: "#112233",
          secondaryColor: "#223344",
          accentColor: "#334455",
        },
        assets: {
          version: 1,
          originals: estado.originais.map(ativo),
          header: ativo("header.png"),
          loader: ativo("loader.png"),
          favicon: ativo("favicon.png"),
          apple_touch: ativo("apple.png"),
          icon_192: ativo("i192.png"),
          icon_512: ativo("i512.png"),
          maskable_512: ativo("mask.png"),
          og: ativo("og.png"),
        },
      },
      read: vi.fn(),
      setField: vi.fn(),
      upload: estado.upload,
      cancelUpload: vi.fn(),
      save: vi.fn(),
      resolveConflict: vi.fn(),
      discard: vi.fn(),
      keepSource: estado.keepSource,
      removeSource: estado.removeSource,
    };
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  estado.originais = ["fonte-1.png"];
  estado.nome = "Loja de Teste";
  estado.locked = false;
  estado.upload.mockReset();
  estado.keepSource.mockReset();
  estado.removeSource.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

async function montar() {
  const { IdentitySettingsSection } = await import(
    "@/components/admin/settings/IdentitySettingsSection"
  );
  await act(async () => {
    raiz.render(<IdentitySettingsSection />);
  });
}

function campoDeArquivo(rotulo: string): HTMLInputElement {
  const label = Array.from(host.querySelectorAll("label")).find(
    (l) => l.textContent?.trim() === rotulo,
  );
  const campo = label?.control as HTMLInputElement | null | undefined;
  if (!campo) throw new Error(`campo de arquivo "${rotulo}" não existe`);
  return campo;
}
const botao = (texto: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );

function enviar(rotulo: string, nome = "arquivo.png") {
  const campo = campoDeArquivo(rotulo);
  const arquivo = new File(["x"], nome, { type: "image/png" });
  act(() => {
    Object.defineProperty(campo, "files", {
      value: [arquivo],
      configurable: true,
    });
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return arquivo;
}

describe("IdentitySettingsSection (buracos de mutação)", () => {
  describe("tipos de arquivo aceitos", () => {
    it.each([
      ["TROCAR ÍCONE DO APLICATIVO", true],
      ["TROCAR COMPARTILHAMENTO", true],
      ["TROCAR ARTE DE COMPARTILHAMENTO", true],
      ["TROCAR CABEÇALHO", false],
      ["TROCAR ABERTURA", false],
      ["TROCAR ÍCONE DA ABA DO NAVEGADOR", false],
      ["ADICIONAR FONTE", false],
    ])("%s aceita só PNG? %s", async (rotulo, soPng) => {
      await montar();
      // O rótulo vem em maiúsculas só pelo CSS: o texto do DOM é o original.
      const original = Array.from(host.querySelectorAll("label")).find(
        (l) => l.textContent?.toUpperCase() === rotulo,
      )?.textContent as string;
      const accept = campoDeArquivo(original).getAttribute("accept");
      if (soPng) expect(accept).toBe("image/png");
      else {
        expect(accept).toContain("image/svg+xml");
        expect(accept).toContain("image/jpeg");
        expect(accept).toContain(".ico");
      }
    });
  });

  describe("nome da loja", () => {
    it("nome com conteúdo visível não é marcado como inválido", async () => {
      await montar();
      const campo = host.querySelector<HTMLInputElement>("#store-name");
      expect(campo?.getAttribute("aria-invalid")).toBe("false");
    });

    it("nome só de caracteres invisíveis é marcado como inválido", async () => {
      estado.nome = "​​";
      await montar();
      const campo = host.querySelector<HTMLInputElement>("#store-name");
      expect(campo?.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("fontes guardadas", () => {
    it("com sete fontes ainda dá para adicionar outra", async () => {
      estado.originais = Array.from({ length: 7 }, (_, i) => `f${i}.png`);
      await montar();
      expect(campoDeArquivo("Adicionar fonte").disabled).toBe(false);
      expect(host.textContent).not.toContain("Limite de oito fontes");
      expect(host.textContent).toContain("Fontes guardadas (7/8)");
    });

    it("com oito fontes trava o envio de nova fonte, os botões de guardar e avisa o limite", async () => {
      estado.originais = Array.from({ length: 8 }, (_, i) => `f${i}.png`);
      await montar();
      expect(campoDeArquivo("Adicionar fonte").disabled).toBe(true);
      expect(host.textContent).toContain("Limite de oito fontes");
      expect(botao("Guardar cabeçalho como fonte")?.disabled).toBe(true);
      // Substituir uma fonte existente continua possível.
      expect(campoDeArquivo("Substituir fonte 1").disabled).toBe(false);
    });

    it("com uma só fonte, 'Retirar referência' fica travado (sobra ao menos uma)", async () => {
      estado.originais = ["so-uma.png"];
      await montar();
      expect(botao("Retirar referência 1")?.disabled).toBe(true);
    });

    it("com duas fontes dá para retirar, e o índice certo chega ao editor", async () => {
      estado.originais = ["a.png", "b.png"];
      await montar();
      const retirar = botao("Retirar referência 2");
      expect(retirar?.disabled).toBe(false);
      act(() => retirar?.click());
      expect(estado.removeSource).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("guardar uma imagem como fonte leva o ativo e o endereço público dele", async () => {
      await montar();
      act(() => botao("Guardar cabeçalho como fonte")?.click());
      expect(estado.keepSource).toHaveBeenCalledExactlyOnceWith({
        asset: { path: "header.png" },
        url: "https://exemplo-de-teste.invalid/storage/v1/object/public/branding/header.png",
      });
    });

    it("imagem que já é uma das fontes não pode ser guardada de novo", async () => {
      estado.originais = ["header.png", "outra.png"];
      await montar();
      expect(botao("Guardar cabeçalho como fonte")?.disabled).toBe(true);
      expect(botao("Guardar abertura como fonte")?.disabled).toBe(false);
    });
  });

  describe("envio de imagem", () => {
    it("cabeçalho sem 'Usar também na abertura' troca só o cabeçalho", async () => {
      await montar();
      const arquivo = enviar("Trocar cabeçalho");
      expect(estado.upload).toHaveBeenCalledExactlyOnceWith(arquivo, {
        kind: "asset",
        roles: ["header"],
      });
    });

    it("cabeçalho com 'Usar também na abertura' troca cabeçalho e abertura juntos", async () => {
      await montar();
      const caixa = host.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      act(() => caixa?.click());
      const arquivo = enviar("Trocar cabeçalho");
      expect(estado.upload).toHaveBeenCalledExactlyOnceWith(arquivo, {
        kind: "asset",
        roles: ["header", "loader"],
      });
    });

    it("a marcação 'também na abertura' não vaza para o envio da abertura nem do ícone", async () => {
      await montar();
      act(() =>
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(),
      );
      const a1 = enviar("Trocar abertura");
      expect(estado.upload).toHaveBeenLastCalledWith(a1, {
        kind: "asset",
        roles: ["loader"],
      });
      const a2 = enviar("Trocar ícone do aplicativo");
      expect(estado.upload).toHaveBeenLastCalledWith(a2, { kind: "app-icons" });
    });

    it("editor travado desliga todos os envios", async () => {
      estado.locked = true;
      await montar();
      expect(campoDeArquivo("Trocar cabeçalho").disabled).toBe(true);
      expect(campoDeArquivo("Adicionar fonte").disabled).toBe(true);
    });
  });
});
