import { useCallback, useEffect, useRef, useState } from "react";

function lerValorCompativel<T>(item: string | null, initialValue: T): T {
  if (!item) return initialValue;
  const value: unknown = JSON.parse(item);
  // Protege a estrutura sem descartar uniões primitivas como number | "all".
  if (
    (typeof value === "object") !== (typeof initialValue === "object") ||
    (value === null) !== (initialValue === null) ||
    Array.isArray(value) !== Array.isArray(initialValue)
  ) {
    return initialValue;
  }
  return value as T;
}

// `entreAbas`: a chave é compartilhada entre abas (favoritos do visitante).
// Grava a partir do DISCO, não da memória da aba, e ouve o evento `storage`:
// sem isso, duas abas se apagam (a lista velha de uma sobrescreve a da outra).
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  { entreAbas = false }: { entreAbas?: boolean } = {},
): [T, (value: T | ((prev: T) => T)) => void] {
  // Leitura única do disco na montagem: o texto fica de referência (abaixo).
  const [lido] = useState(() => {
    if (typeof window === "undefined")
      return { texto: null, valor: initialValue };
    try {
      const texto = window.localStorage.getItem(key);
      return { texto, valor: lerValorCompativel(texto, initialValue) };
    } catch (error) {
      console.error("Error reading from localStorage:", error);
      return { texto: null, valor: initialValue };
    }
  });
  const [storedValue, setStoredValue] = useState<T>(lido.valor);
  // Último texto que esta aba sabe que está no disco (lido ou gravado). Se o
  // disco é outro, foi OUTRA aba que mexeu; se é o mesmo, a memória manda
  // (inclusive quando a gravação falhou e o disco ficou para trás dela).
  const textoNoDiscoRef = useRef<string | null>(lido.texto);

  const isFirstRender = useRef(true);
  // `initialValue` costuma chegar como literal novo a cada render (`[]`, `{}`):
  // nas deps do efeito de sync ele o re-rodaria a cada render. Fica em ref.
  const initialValueRef = useRef(initialValue);
  useEffect(() => {
    initialValueRef.current = initialValue;
  });
  // Último valor conhecido, síncrono: permite gravar FORA do updater do
  // setState (o updater tem de ser puro e roda dentro do render).
  const valorRef = useRef(storedValue);
  useEffect(() => {
    valorRef.current = storedValue;
  }, [storedValue]);
  useEffect(() => {
    if (!entreAbas || typeof window === "undefined") return;
    const aoMudarNoDisco = (e: StorageEvent) => {
      if (e.key !== key && e.key !== null) return;
      try {
        const texto = window.localStorage.getItem(key);
        const novo = lerValorCompativel(texto, initialValueRef.current);
        textoNoDiscoRef.current = texto;
        valorRef.current = novo;
        setStoredValue(novo);
      } catch (error) {
        console.error("Error reading from localStorage:", error);
      }
    };
    window.addEventListener("storage", aoMudarNoDisco);
    return () => window.removeEventListener("storage", aoMudarNoDisco);
  }, [entreAbas, key]);

  // Sync with localStorage when key changes
  useEffect(() => {
    // Only run if not the first render to avoid double-init
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    try {
      const item = window.localStorage.getItem(key);
      const newValue = lerValorCompativel(item, initialValueRef.current);

      // Update state only if it actually changed to prevent loops
      // Wrap in setTimeout to move out of the render cycle and suppress lint warnings
      // about cascading renders if this update happens synchronously.
      setTimeout(() => {
        setStoredValue((prev) => {
          if (JSON.stringify(prev) !== JSON.stringify(newValue)) {
            return newValue;
          }
          return prev;
        });
      }, 0);
    } catch (error) {
      console.error("Error syncing with localStorage:", error);
    }
  }, [key]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        let base = valorRef.current;
        if (entreAbas && typeof window !== "undefined") {
          try {
            const noDisco = window.localStorage.getItem(key);
            if (noDisco !== textoNoDiscoRef.current) {
              base = lerValorCompativel(noDisco, initialValueRef.current);
            }
          } catch {
            // Disco ilegível: segue com a memória e regrava uma lista válida.
          }
        }
        const valueToStore = value instanceof Function ? value(base) : value;
        valorRef.current = valueToStore;
        setStoredValue(valueToStore);
        if (typeof window !== "undefined") {
          const texto = JSON.stringify(valueToStore);
          window.localStorage.setItem(key, texto);
          textoNoDiscoRef.current = texto;
        }
      } catch (error) {
        console.error("Error saving to localStorage:", error);
      }
    },
    [key, entreAbas],
  );

  return [storedValue, setValue];
}
