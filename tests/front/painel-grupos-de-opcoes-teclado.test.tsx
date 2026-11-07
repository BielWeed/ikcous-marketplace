// @vitest-environment jsdom
import { GrupoDeOpcoes } from "@/components/admin/GrupoDeOpcoes";
import { QuemPodeUsarOCupom } from "@/components/admin/coupons/QuemPodeUsarOCupom";
import { AparenciaDoPainel } from "@/components/admin/settings/AparenciaDoPainel";
import { EstrategiaNacionalBloco } from "@/components/admin/shipping/EstrategiaNacionalBloco";
import { FreteGratisBloco } from "@/components/admin/shipping/FreteGratisBloco";
import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { type ReactNode, act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  delete document.documentElement.dataset.adminTema;
  vi.stubGlobal("localStorage", { setItem: vi.fn() });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.adminTema;
});
function montar(node: ReactNode) {
  act(() => root.render(node));
}
function radios(nome: string) {
  const grupo = host.querySelector(`[role="radiogroup"][aria-label="${nome}"]`);
  if (!grupo) throw new Error(`Grupo ausente: ${nome}`);
  return Array.from(
    grupo.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  );
}
function tecla(botao: HTMLButtonElement, key: string) {
  act(() => {
    botao.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}
function navegar(nome: string, mudar: ReturnType<typeof vi.fn>, valor: string) {
  const [primeiro, segundo] = radios(nome);
  primeiro.focus();
  // Foco e Tab nunca escolhem por conta própria.
  tecla(primeiro, "Tab");
  expect(mudar).not.toHaveBeenCalled();
  tecla(primeiro, "ArrowRight");
  expect(mudar).toHaveBeenCalledExactlyOnceWith(valor);
  expect(document.activeElement).toBe(segundo);
}
const nacional = {
  estrategia: "desligado" as const,
  minimo: 0,
  tipoDesconto: null,
  valorDesconto: 0,
  alcance: "mais_barata" as const,
  onEscolherEstrategia: vi.fn(),
  onMinimo: vi.fn(),
  onTipoDesconto: vi.fn(),
  onValorDesconto: vi.fn(),
  onAlcance: vi.fn(),
};
it("aparência: uma parada de Tab, setas com volta, Home e End selecionam e focam", () => {
  montar(<AparenciaDoPainel />);
  const [escuro, claro, confortavel] = radios("Aparência do painel");
  expect([escuro.tabIndex, claro.tabIndex, confortavel.tabIndex]).toEqual([
    0, -1, -1,
  ]);
  escuro.focus();
  tecla(escuro, "ArrowDown");
  expect(claro.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(claro);
  expect([escuro.tabIndex, claro.tabIndex, confortavel.tabIndex]).toEqual([
    -1, 0, -1,
  ]);
  tecla(claro, "End");
  expect(confortavel.getAttribute("aria-checked")).toBe("true");
  tecla(confortavel, "ArrowRight");
  expect(escuro.getAttribute("aria-checked")).toBe("true");
  tecla(escuro, "ArrowLeft");
  expect(confortavel.getAttribute("aria-checked")).toBe("true");
  tecla(confortavel, "Home");
  expect(document.activeElement).toBe(escuro);
});
it("atalhos do navegador (Alt, Ctrl, Cmd + seta) não mexem na escolha nem são engolidos", () => {
  montar(<AparenciaDoPainel />);
  const [escuro, claro] = radios("Aparência do painel");
  escuro.focus();
  for (const modificador of ["altKey", "ctrlKey", "metaKey"] as const) {
    const evento = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
      [modificador]: true,
    });
    act(() => {
      escuro.dispatchEvent(evento);
    });
    expect(evento.defaultPrevented).toBe(false);
    expect(escuro.getAttribute("aria-checked")).toBe("true");
    expect(claro.getAttribute("aria-checked")).toBe("false");
  }
});
it("cupom: seta escolhe pelo callback do clique, sem salvar o formulário", () => {
  const mudar = vi.fn();
  montar(
    <QuemPodeUsarOCupom
      alcance="codigo"
      onAlcance={mudar}
      clientes={[]}
      onClientes={vi.fn()}
      carregandoClientes={false}
      buscarClientes={vi.fn()}
      semLimiteNemValidade={false}
      desabilitado={false}
    />,
  );
  navegar("Quem pode usar", mudar, "vitrine");
});
it("frete local: seta escolhe a estratégia", () => {
  const mudar = vi.fn();
  montar(
    <FreteGratisBloco
      preset="desligado"
      acimaDe={0}
      onEscolher={mudar}
      onAcimaDe={vi.fn()}
    />,
  );
  navegar("Estratégia de frete local", mudar, "acima_de_valor");
});
it("entrega na cidade: seta escolhe o modo", () => {
  const mudar = vi.fn();
  montar(
    <FreteLocalBloco
      valor={10}
      onValor={vi.fn()}
      faixa="38400"
      onFaixa={vi.fn()}
      coverage="local"
      onCoverage={vi.fn()}
      cepDaLoja="38400-100"
      cidade="Cidade"
      uf="MG"
      modo="entrego"
      onModo={mudar}
      enderecoDaLoja="Rua de teste, 1"
    />,
  );
  navegar("Como o cliente da sua região recebe", mudar, "entrego_e_retiro");
});
it("alcance local sem marcado: primeiro é entrada de Tab, seta abre os CEPs sem gravar faixa", () => {
  const mudar = vi.fn();
  montar(
    <FreteLocalBloco
      valor={10}
      onValor={vi.fn()}
      faixa=""
      onFaixa={mudar}
      coverage="local"
      onCoverage={vi.fn()}
      cepDaLoja="38400-100"
      cidade="Cidade"
      uf="MG"
    />,
  );
  const [primeiro, segundo] = radios("Até onde você entrega");
  expect([primeiro.tabIndex, segundo.tabIndex]).toEqual([0, -1]);
  primeiro.focus();
  tecla(primeiro, "ArrowRight");
  expect(segundo.getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(segundo);
  expect(mudar).not.toHaveBeenCalled();
});
it("nacional: seta escolhe estratégia", () => {
  const mudar = vi.fn();
  montar(
    <EstrategiaNacionalBloco {...nacional} onEscolherEstrategia={mudar} />,
  );
  navegar("Estratégia de frete nacional", mudar, "acima_de_valor");
});
it("desconto sem marcado: primeiro é entrada e seta escolhe o tipo", () => {
  const mudar = vi.fn();
  montar(
    <EstrategiaNacionalBloco
      {...nacional}
      estrategia="desconto_na_mais_barata"
      onTipoDesconto={mudar}
    />,
  );
  expect(radios("Tipo de desconto").map((r) => r.tabIndex)).toEqual([0, -1]);
  navegar("Tipo de desconto", mudar, "fixo");
});
it("alcance nacional: seta escolhe qualquer entrega", () => {
  const mudar = vi.fn();
  montar(
    <EstrategiaNacionalBloco
      {...nacional}
      estrategia="sempre"
      onAlcance={mudar}
    />,
  );
  navegar("Alcance do frete grátis nacional", mudar, "todas");
});
it("pula opção desabilitada, segue mudança externa e não envia o formulário", () => {
  const enviar = vi.fn();
  const escolher = vi.fn();
  function Formulario() {
    const [valor, mudar] = useState("a");
    return (
      <form onSubmit={enviar}>
        <button type="button" onClick={() => mudar("c")}>
          Mudar por fora
        </button>
        <GrupoDeOpcoes aria-label="Teste">
          {["a", "b", "c"].map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              disabled={id === "b"}
              aria-checked={valor === id}
              onClick={() => {
                escolher(id);
                mudar(id);
              }}
            >
              {id}
            </button>
          ))}
        </GrupoDeOpcoes>
      </form>
    );
  }
  montar(<Formulario />);
  const [a, b, c] = radios("Teste");
  a.focus();
  tecla(a, "ArrowDown");
  expect(document.activeElement).toBe(c);
  expect(escolher).toHaveBeenCalledExactlyOnceWith("c");
  expect(b.disabled).toBe(true);
  expect(enviar).not.toHaveBeenCalled();
  tecla(c, "Home");
  expect(a.tabIndex).toBe(0);
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect([a.tabIndex, c.tabIndex]).toEqual([-1, 0]);
});
it("grupo desabilitado não escolhe com seta", () => {
  const mudar = vi.fn();
  montar(
    <QuemPodeUsarOCupom
      alcance="codigo"
      onAlcance={mudar}
      clientes={[]}
      onClientes={vi.fn()}
      carregandoClientes={false}
      buscarClientes={vi.fn()}
      semLimiteNemValidade={false}
      desabilitado
    />,
  );
  tecla(radios("Quem pode usar")[0], "ArrowRight");
  expect(mudar).not.toHaveBeenCalled();
});
