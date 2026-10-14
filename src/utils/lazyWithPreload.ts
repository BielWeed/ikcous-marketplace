import React, { lazy } from "react";
import type { ComponentType } from "react";

export interface PreloadableComponent<T extends ComponentType<any>>
  extends React.LazyExoticComponent<T> {
  preload: () => Promise<T>;
  getLoaded: () => T | null;
}

/** Uma entrada por componente criado aqui (são poucos, todos de módulo).
 * `falhou` = a última tentativa de carregar o chunk rejeitou. */
interface EntradaDeCarga {
  falhou: boolean;
  reiniciar: () => void;
}
const entradas = new Set<EntradaDeCarga>();

/** "Tentar de novo" depois de um chunk que não baixou (3G que caiu no meio).
 * O React.lazy guarda a rejeição no próprio objeto para sempre, então basta
 * esquecer a promessa: quem falhou ganha um lazy NOVO, que refaz o import
 * quando o componente for montado outra vez. Quem já carregou não é tocado. */
export function reiniciarCargasQueFalharam(): void {
  for (const entrada of entradas) {
    if (entrada.falhou) entrada.reiniciar();
  }
}

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let LoadedComponent: T | null = null;
  let factoryPromise: Promise<{ default: T }> | null = null;

  const entrada: EntradaDeCarga = { falhou: false, reiniciar: () => {} };
  entradas.add(entrada);

  // Promessa compartilhada entre o preload e o lazy. A que REJEITA é
  // esquecida na hora: a próxima tentativa refaz o import de verdade.
  const carregar = (): Promise<{ default: T }> => {
    if (LoadedComponent) {
      return Promise.resolve({ default: LoadedComponent });
    }
    if (!factoryPromise) {
      factoryPromise = factory().then(
        (module) => {
          LoadedComponent = module.default;
          entrada.falhou = false;
          return module;
        },
        (erro: unknown) => {
          factoryPromise = null;
          entrada.falhou = true;
          throw erro;
        },
      );
    }
    return factoryPromise;
  };

  let LazyAtual = lazy(carregar);
  entrada.reiniciar = () => {
    entrada.falhou = false;
    factoryPromise = null;
    LazyAtual = lazy(carregar);
  };

  // Identidade estável para quem importa o componente; o lazy de dentro é
  // trocável (um lazy rejeitado nunca se recupera sozinho).
  const LazyComponent = (props: React.ComponentProps<T>) =>
    React.createElement(LazyAtual as ComponentType<any>, props);

  const preload = () => carregar().then((module) => module.default);

  const getLoaded = () => LoadedComponent;

  return Object.assign(
    LazyComponent as unknown as React.LazyExoticComponent<T>,
    { preload, getLoaded },
  );
}

export function PreloadedOrLazy<T extends ComponentType<any>>({
  component,
  props,
  fallback,
}: {
  readonly component: any;
  readonly props: React.ComponentProps<T>;
  readonly fallback?: React.ReactNode;
}) {
  const Loaded = component.getLoaded ? component.getLoaded() : null;
  if (Loaded) {
    return React.createElement(Loaded, props);
  }
  const Lazy = component;
  if (fallback) {
    return React.createElement(
      React.Suspense,
      { fallback },
      React.createElement(Lazy, props),
    );
  }
  return React.createElement(Lazy, props);
}
