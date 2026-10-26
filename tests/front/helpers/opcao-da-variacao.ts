// O botão de uma opção de variação pelo valor, sem depender do estado que o
// nome acessível carrega: "Preta", "Preta, indisponível com a sua escolha" ou
// "Preta, esgotado" são o mesmo botão. Prefixo puro (`^=`) erraria: "P" casaria
// com "PP".
export function opcaoDaVariacao(
  raiz: ParentNode,
  valor: string,
): HTMLButtonElement | null {
  return (
    [...raiz.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find(
      (b) => {
        const nome = b.getAttribute("aria-label") ?? "";
        return nome === valor || nome.startsWith(`${valor}, `);
      },
    ) ?? null
  );
}
