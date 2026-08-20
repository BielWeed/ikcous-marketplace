import { Input } from "@/components/ui/input";
import React, { useState, useEffect, useRef } from "react";

interface DebouncedSearchInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Chamado com `false` sempre que a caixa e o `value` de cima passam a
   * coincidir — inclusive **na montagem**, antes de alguem digitar. Os 5
   * consumidores de hoje so trocam um icone, entao o evento inicial e
   * inofensivo; quem for fazer algo nao idempotente aqui precisa tratar
   * isso. Nunca chama `true` sem digitacao. */
  readonly onTyping?: (isTyping: boolean) => void;
  readonly delay?: number;
  readonly placeholder?: string;
  readonly className?: string;
  readonly id?: string;
  readonly name?: string;
}

export const DebouncedSearchInput = React.memo(function DebouncedSearchInput({
  value,
  onChange,
  onTyping,
  delay = 400,
  placeholder = "Buscar...",
  className = "",
  id,
  name,
}: DebouncedSearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const onChangeRef = useRef(onChange);
  const onTypingRef = useRef(onTyping);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onTypingRef.current = onTyping;
  }, [onTyping]);

  useEffect(() => {
    return () => {
      onTypingRef.current?.(false);
    };
  }, []);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (localValue !== value) {
      onTypingRef.current?.(true);
    } else {
      // Os dois já coincidem — "digitando" significa exatamente "o que
      // está na caixa ainda não chegou no estado de cima", e isso deixou
      // de ser verdade. Vale tanto para quem terminou de digitar (o efeito
      // seguinte já cobria) quanto para quem zerou o valor DE FORA
      // (`setSearchQuery("")` num clique de botão, por exemplo): nesse
      // caso o valor externo muda primeiro, o efeito `[value]` agenda o
      // `localValue` para alcançá-lo, e o commit em que os dois já batem
      // nunca passava por aqui — ninguém desligava o "digitando", e a lupa
      // girava para sempre.
      onTypingRef.current?.(false);
    }

    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChangeRef.current(localValue);
        onTypingRef.current?.(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [localValue, value, delay]);

  return (
    <Input
      id={id}
      name={name}
      placeholder={placeholder}
      className={className}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      autoComplete="off"
    />
  );
});
