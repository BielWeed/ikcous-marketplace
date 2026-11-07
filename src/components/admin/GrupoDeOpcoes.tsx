import {
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  useLayoutEffect,
  useRef,
} from "react";

function opcoes(grupo: HTMLDivElement) {
  return Array.from(
    grupo.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
  ).filter(
    (botao) =>
      !botao.matches(":disabled") &&
      botao.getAttribute("aria-disabled") !== "true",
  );
}

function aoTeclar(evento: KeyboardEvent<HTMLDivElement>) {
  // Alt+← (voltar do navegador), Ctrl/Cmd+← etc. não são navegação do grupo.
  if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
  const direcao = new Map([
    ["ArrowRight", 1],
    ["ArrowDown", 1],
    ["ArrowLeft", -1],
    ["ArrowUp", -1],
  ]).get(evento.key);
  if (direcao === undefined && evento.key !== "Home" && evento.key !== "End")
    return;
  const botoes = opcoes(evento.currentTarget);
  const atual = botoes.findIndex((botao) => botao === evento.target);
  if (atual < 0) return;
  evento.preventDefault();
  const indice =
    evento.key === "Home"
      ? 0
      : evento.key === "End"
        ? botoes.length - 1
        : (atual + (direcao ?? 0) + botoes.length) % botoes.length;
  const alvo = botoes.at(indice);
  if (alvo && alvo !== evento.target) {
    // O mesmo clique mantém as guardas e os callbacks do formulário.
    alvo.click();
    alvo.focus();
  }
}

/** Uma parada de Tab; setas só escolhem quando a pessoa as aperta. */
export function GrupoDeOpcoes(props: ComponentPropsWithoutRef<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const botoes = opcoes(ref.current);
    const entrada =
      botoes.find((botao) => botao.getAttribute("aria-checked") === "true") ??
      botoes.at(0);
    for (const botao of botoes) botao.tabIndex = botao === entrada ? 0 : -1;
  });
  return (
    <div
      {...props}
      ref={ref}
      role="radiogroup"
      tabIndex={-1}
      onKeyDown={aoTeclar}
    />
  );
}
