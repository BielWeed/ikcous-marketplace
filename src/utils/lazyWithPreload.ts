import React, { lazy } from "react";
import type { ComponentType } from "react";

export interface PreloadableComponent<T extends ComponentType<any>>
  extends React.LazyExoticComponent<T> {
  preload: () => Promise<T>;
  getLoaded: () => T | null;
}

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let LoadedComponent: T | null = null;
  let factoryPromise: Promise<{ default: T }> | null = null;

  const LazyComponent = lazy(() => {
    if (LoadedComponent) {
      return Promise.resolve({ default: LoadedComponent });
    }
    if (!factoryPromise) {
      factoryPromise = factory().then((module) => {
        LoadedComponent = module.default;
        return module;
      });
    }
    return factoryPromise;
  });

  const preload = () => {
    if (LoadedComponent) return Promise.resolve(LoadedComponent);
    if (!factoryPromise) {
      factoryPromise = factory().then((module) => {
        LoadedComponent = module.default;
        return module;
      });
    }
    return factoryPromise.then((module) => module.default);
  };

  const getLoaded = () => LoadedComponent;

  return Object.assign(LazyComponent, { preload, getLoaded });
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
