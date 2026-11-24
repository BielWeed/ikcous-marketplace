// @vitest-environment jsdom
// Quem decide "instale o app" (iPhone/iPad) e qual guia de liberar avisos
// aparece. Achados por mutação: o sinal `navigator.standalone` do iOS, o iPad
// que se apresenta como Mac e o guia de quem está no iPhone SEM o app
// instalado não eram provados por nenhum teste.
import {
  PASSOS_PARA_INSTALAR_NO_IOS,
  PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE,
  ehAparelhoDaApple,
  estaComoAppInstalado,
  passosParaLiberarOsAvisos,
} from "@/lib/avisos-do-aparelho";
import { afterEach, describe, expect, it, vi } from "vitest";

const CHAVES_DO_NAVEGADOR = [
  "standalone",
  "userAgent",
  "platform",
  "maxTouchPoints",
] as const;

function definirNoNavegador(
  chave: (typeof CHAVES_DO_NAVEGADOR)[number],
  valor: unknown,
) {
  Object.defineProperty(navigator, chave, { configurable: true, value: valor });
}

afterEach(() => {
  // Remover a propriedade da instância devolve o valor original do jsdom.
  for (const chave of CHAVES_DO_NAVEGADOR) {
    Reflect.deleteProperty(navigator, chave);
  }
  vi.unstubAllGlobals();
});

describe("estaComoAppInstalado", () => {
  it("aba comum, sem nenhum sinal: não está instalado", () => {
    expect(estaComoAppInstalado()).toBe(false);
  });

  it("iPhone com o app na Tela de Início (navigator.standalone) está instalado", () => {
    definirNoNavegador("standalone", true);
    expect(estaComoAppInstalado()).toBe(true);
  });

  it("navigator.standalone falso ou ausente não vale", () => {
    definirNoNavegador("standalone", false);
    expect(estaComoAppInstalado()).toBe(false);
  });

  it("Android/computador: display-mode standalone vale", () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta === "(display-mode: standalone)",
    }));
    expect(estaComoAppInstalado()).toBe(true);
  });

  it("matchMedia que diz 'não' e sem sinal do iOS: aba", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(estaComoAppInstalado()).toBe(false);
  });
});

describe("ehAparelhoDaApple", () => {
  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)"],
    ["iPad antigo", "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X)"],
    ["iPod", "Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X)"],
  ])("%s pelo user agent", (_nome, agente) => {
    definirNoNavegador("userAgent", agente);
    expect(ehAparelhoDaApple()).toBe(true);
  });

  it("iPad novo se apresenta como Mac, mas tem tela de toque", () => {
    definirNoNavegador("userAgent", "Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    definirNoNavegador("platform", "MacIntel");
    definirNoNavegador("maxTouchPoints", 5);
    expect(ehAparelhoDaApple()).toBe(true);
  });

  it("Mac de verdade (sem toque) não é aparelho de aviso do iOS", () => {
    definirNoNavegador("userAgent", "Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    definirNoNavegador("platform", "MacIntel");
    definirNoNavegador("maxTouchPoints", 0);
    expect(ehAparelhoDaApple()).toBe(false);
  });

  it("Android com toque não é Apple", () => {
    definirNoNavegador("userAgent", "Mozilla/5.0 (Linux; Android 14; Pixel 8)");
    definirNoNavegador("platform", "Linux armv81");
    definirNoNavegador("maxTouchPoints", 5);
    expect(ehAparelhoDaApple()).toBe(false);
  });

  it("Windows com tela de toque não é Apple", () => {
    definirNoNavegador(
      "userAgent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    definirNoNavegador("platform", "Win32");
    definirNoNavegador("maxTouchPoints", 10);
    expect(ehAparelhoDaApple()).toBe(false);
  });
});

describe("guia de como liberar os avisos bloqueados", () => {
  const voltar =
    "Depois de liberar, volte aqui e toque em Ligar avisos neste aparelho.";

  it("iPhone com o app instalado: vai pelos Ajustes do aparelho e cita o nome do app", () => {
    const passos = passosParaLiberarOsAvisos(
      { instalado: true, ehApple: true },
      "Minha Loja",
    );
    expect(passos[0]).toBe("Abra os Ajustes do aparelho.");
    expect(passos[1]).toContain("Minha Loja");
    expect(passos.at(-1)).toBe(voltar);
  });

  it("iPhone SEM o app instalado: não manda para os Ajustes de um app que não existe", () => {
    const passos = passosParaLiberarOsAvisos(
      { instalado: false, ehApple: true },
      "Minha Loja",
    );
    expect(passos.join(" ")).not.toContain("Ajustes");
    expect(passos.join(" ")).not.toContain("Minha Loja");
    expect(passos[0]).toContain("cadeado");
    expect(passos.at(-1)).toBe(voltar);
  });

  it("app instalado fora do iOS: mostra computador e celular, com o nome do app no celular", () => {
    const passos = passosParaLiberarOsAvisos(
      { instalado: true, ehApple: false },
      "Minha Loja",
    );
    expect(passos).toHaveLength(3);
    expect(passos[0]).toMatch(/^No computador:/);
    expect(passos[1]).toMatch(/^No celular:/);
    expect(passos[1]).toContain("Minha Loja");
    expect(passos.at(-1)).toBe(voltar);
  });

  it("aba do navegador: guia do cadeado ao lado do endereço", () => {
    const passos = passosParaLiberarOsAvisos(
      { instalado: false, ehApple: false },
      "Minha Loja",
    );
    expect(passos).toHaveLength(4);
    expect(passos[0]).toContain("cadeado");
    expect(passos.at(-1)).toBe(voltar);
  });
});

describe("passos para instalar no iPhone/iPad", () => {
  it("lojista fala em painel e cliente fala em loja, com os mesmos passos do meio", () => {
    expect(PASSOS_PARA_INSTALAR_NO_IOS).toHaveLength(5);
    expect(PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE).toHaveLength(5);
    expect(PASSOS_PARA_INSTALAR_NO_IOS[0]).toContain("painel");
    expect(PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE[0]).toContain("loja");
    expect(PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE.join(" ")).not.toContain(
      "painel",
    );
    expect(PASSOS_PARA_INSTALAR_NO_IOS.slice(1, 4)).toEqual(
      PASSOS_PARA_INSTALAR_NO_IOS_DA_CLIENTE.slice(1, 4),
    );
  });
});
