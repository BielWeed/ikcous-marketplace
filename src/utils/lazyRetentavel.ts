import { createElement, lazy } from "react";
import type { ComponentProps, ComponentType } from "react";

/**
 * Pedaço da tela carregado sob demanda que sabe ser pedido DE NOVO.
 *
 * O `React.lazy` guarda a rejeição: depois de uma falha de rede ele devolve o
 * mesmo erro para sempre, mesmo com a rede de volta. Aqui `tentarDeNovo()`
 * troca o `lazy` por um novo (outra chamada ao `import()`), e o próximo
 * desenho do pedaço volta a pedir o arquivo. Quem chama é o limite de erro
 * (`LimiteDePedaco`), depois que o pedaço já saiu da tela — nunca no meio de
 * um desenho em andamento.
 *
 * Limite honesto: o navegador também pode MEMORIZAR a falha de um mesmo
 * endereço de arquivo (Chromium, medido). Então esta nova tentativa cura o
 * soluço de rede em quem não memoriza e a falha passageira antes da
 * memorização; quando o arquivo realmente sumiu do servidor (versão nova no
 * ar) só uma recarga da página resolve, e este limite NÃO a aciona: quem
 * troca a versão é a atualização obrigatória (checagem de 3 em 3 minutos, no
 * próximo momento seguro). Até lá, "Tentar de novo" pode falhar de novo.
 */
export type PedacoRetentavel<T extends ComponentType<any>> = ComponentType<
  ComponentProps<T>
> & {
  readonly tentarDeNovo: () => void;
};

export function lazyRetentavel<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PedacoRetentavel<T> {
  let atual = lazy(factory);
  // Lê `atual` a cada desenho: trocar o `lazy` vale para o próximo mount.
  const Pedaco = (props: ComponentProps<T>) =>
    createElement(atual as ComponentType<any>, props);
  return Object.assign(Pedaco, {
    tentarDeNovo: () => {
      atual = lazy(factory);
    },
  });
}
