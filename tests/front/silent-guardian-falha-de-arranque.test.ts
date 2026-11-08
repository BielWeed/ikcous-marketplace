import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @vitest-environment jsdom
//
// O arquivo principal do app (o script de módulo do index.html) não baixou,
// ou nem chegou a ligar o app: antes, a pessoa via uma página branca com uma
// rodinha girando para sempre, sem aviso e sem botão (o app instalado no
// iPhone nem tem botão de recarregar). Os tratadores de erro do app moram
// DENTRO desse arquivo principal, então não existem nesse momento: quem
// avisa é o `public/silent-guardian.js`, que é estático e já está na página.
//
// O teste roda o ARQUIVO REAL (lido como texto e executado), sem mock, e
// afirma o efeito na tela: frase em português + botão "Tentar de novo" que
// recarrega, no lugar da rodinha.
import guardianFonte from "../../public/silent-guardian.js?raw";

const FRASE =
  "Não conseguimos abrir o app. Confira a internet e tente de novo.";

type Registro = {
  alvo: EventTarget;
  args: Parameters<EventTarget["addEventListener"]>;
};
let registrados: Registro[] = [];
const globaisAntes = new Set<string>();

function montarPaginaDoApp() {
  document.documentElement.className = "";
  document.body.innerHTML =
    '<div id="silent-guardian-loader"><div id="guardian-progress-fill"></div>' +
    '<div id="guardian-progress-pct">0%</div></div>' +
    '<div id="root"><div class="loading-spinner"></div></div>' +
    '<script type="module" src="/assets/index-abc123.js"></script>';
}

/** Executa o silent-guardian.js de verdade e guarda o que ele registrou. */
function rodarGuardian() {
  const doc = document.addEventListener.bind(document);
  const win = globalThis.addEventListener.bind(globalThis);
  vi.spyOn(document, "addEventListener").mockImplementation(
    (...args: Parameters<Document["addEventListener"]>) => {
      registrados.push({ alvo: document, args });
      return doc(...args);
    },
  );
  vi.spyOn(globalThis, "addEventListener").mockImplementation(
    (...args: Parameters<Window["addEventListener"]>) => {
      registrados.push({ alvo: globalThis, args });
      return win(...args);
    },
  );
  new Function(guardianFonte)();
}

function falharScriptPrincipal() {
  const script = document.querySelector('script[type="module"]');
  expect(script).not.toBeNull();
  script?.dispatchEvent(new Event("error"));
}

function botaoTentarDeNovo(): HTMLButtonElement | null {
  return (
    (Array.from(document.querySelectorAll("#root button")).find(
      (b) => b.textContent?.trim() === "Tentar de novo",
    ) as HTMLButtonElement | undefined) ?? null
  );
}

describe("silent-guardian.js — app que não abre mostra aviso e botão em vez da rodinha", () => {
  let recarregar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    registrados = [];
    globaisAntes.clear();
    for (const chave of [
      "removeSilentGuardianLoader",
      "guardianProgressInterval",
    ]) {
      if (chave in globalThis) globaisAntes.add(chave);
    }
    sessionStorage.clear();
    montarPaginaDoApp();
    recarregar = vi.fn();
    vi.stubGlobal("location", { ...globalThis.location, reload: recarregar });
  });

  afterEach(() => {
    for (const { alvo, args } of registrados) {
      alvo.removeEventListener(
        ...(args as [string, EventListenerOrEventListenerObject, boolean?]),
      );
    }
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "removeSilentGuardianLoader");
    document.body.innerHTML = "";
  });

  it("o script principal falhou ao baixar: aviso e botão aparecem NA HORA, sem esperar os 20 s", () => {
    rodarGuardian();
    falharScriptPrincipal();

    const root = document.getElementById("root") as HTMLElement;
    expect(root.textContent).toContain(FRASE);
    expect(root.querySelector(".loading-spinner")).toBeNull();
    // O splash cobre a tela inteira: se ficasse, esconderia o aviso.
    expect(document.getElementById("silent-guardian-loader")).toBeNull();
    expect(botaoTentarDeNovo()).not.toBeNull();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("o botão Tentar de novo recarrega a página", () => {
    rodarGuardian();
    falharScriptPrincipal();
    expect(recarregar).not.toHaveBeenCalled();

    botaoTentarDeNovo()?.click();

    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("o app nunca ligou (nem erro de rede): aos 20 s o aviso também aparece", () => {
    rodarGuardian();
    vi.advanceTimersByTime(19_000);
    expect(document.getElementById("root")?.textContent ?? "").not.toContain(
      FRASE,
    );

    vi.advanceTimersByTime(2_000);

    expect(document.getElementById("root")?.textContent).toContain(FRASE);
    expect(document.querySelector("#root .loading-spinner")).toBeNull();
    expect(botaoTentarDeNovo()).not.toBeNull();
  });

  it("erro de rede E prazo estourado juntos: um aviso só, um botão só", () => {
    rodarGuardian();
    falharScriptPrincipal();
    vi.advanceTimersByTime(25_000);

    expect(document.querySelectorAll('#root [role="alert"]')).toHaveLength(1);
    expect(document.querySelectorAll("#root button")).toHaveLength(1);
  });

  it("app ligado (main.tsx definiu removeSilentGuardianLoader): NADA muda, nem aos 20 s nem com erro de script", () => {
    (globalThis as Record<string, unknown>).removeSilentGuardianLoader =
      () => {};
    rodarGuardian();

    falharScriptPrincipal();
    vi.advanceTimersByTime(25_000);

    const root = document.getElementById("root") as HTMLElement;
    expect(root.textContent).not.toContain(FRASE);
    expect(botaoTentarDeNovo()).toBeNull();
    // A rodinha segue como antes: quem a troca é o React, não o guardian.
    expect(root.querySelector(".loading-spinner")).not.toBeNull();
  });

  it("o React já pintou algo em #root (ex.: a tela de manutenção da ficha inválida): o aviso não pisa nisso", () => {
    const root = document.getElementById("root") as HTMLElement;
    root.innerHTML = "<h1>Loja em manutenção</h1>";
    rodarGuardian();

    vi.advanceTimersByTime(25_000);

    expect(root.innerHTML).toBe("<h1>Loja em manutenção</h1>");
  });

  it("falha de OUTRO script que não é o de módulo do app não derruba a tela", () => {
    rodarGuardian();
    const outro = document.createElement("script");
    outro.src = "https://sdk.mercadopago.com/js/v2";
    document.body.appendChild(outro);

    outro.dispatchEvent(new Event("error"));

    expect(document.getElementById("root")?.textContent ?? "").not.toContain(
      FRASE,
    );
    expect(document.querySelector("#root .loading-spinner")).not.toBeNull();
  });

  it("o aviso é montado por texto, nunca por HTML (sem innerHTML nem atributo de evento)", () => {
    rodarGuardian();
    falharScriptPrincipal();

    const html = document.getElementById("root")?.innerHTML ?? "";
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toContain("<script");
    expect(guardianFonte).not.toContain("innerHTML");
  });

  it("o splash de quem abre normalmente não muda: splash_shown segue escondendo o loader pela classe do <html>, e o loader fica no DOM", () => {
    sessionStorage.setItem("splash_shown", "true");
    rodarGuardian();

    expect(document.documentElement.classList.contains("splash-shown")).toBe(
      true,
    );
    expect(document.getElementById("silent-guardian-loader")).not.toBeNull();
  });
});
