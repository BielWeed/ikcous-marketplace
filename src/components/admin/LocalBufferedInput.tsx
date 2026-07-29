import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

interface LocalBufferedInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value"
  > {
  readonly value: string | number;
  readonly onFlush: (val: string) => void;
  readonly useShadcn?: boolean;
  readonly delay?: number;
  readonly validate?: (val: string) => string | null;
  readonly mask?: "phone" | "currency";
}

const formatPhone = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length === 0) return "";
  if (clean.length <= 2) return `(${clean}`;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10)
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
};

const formatCurrency = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length === 0) return "";
  const num = Number.parseFloat(clean) / 100;
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const parseCurrencyToFloatString = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length === 0) return "";
  const num = Number.parseFloat(clean) / 100;
  return num.toFixed(2);
};

// O valor que chega pela prop `value` já está em reais (ex.: 100 ou "100.00"),
// diferente do que o usuário digita, que é interpretado em centavos.
// Converter para centavos antes de formatar, senão R$ 100,00 é exibido como R$ 1,00.
const decimalToCurrencyDisplay = (val: string) => {
  if (val.trim() === "") return "";
  const floatVal = Number.parseFloat(val);
  if (Number.isNaN(floatVal)) return "";
  return formatCurrency(Math.round(floatVal * 100).toString());
};

export const LocalBufferedInput = memo(function LocalBufferedInput({
  value,
  onFlush,
  useShadcn = false,
  delay = 200,
  className,
  validate,
  mask,
  ...props
}: LocalBufferedInputProps) {
  const formatValue = useCallback(
    (val: string | number) => {
      const str = val !== undefined && val !== null ? val.toString() : "";
      if (mask === "phone") {
        return formatPhone(str);
      }
      if (mask === "currency") {
        return decimalToCurrencyDisplay(str);
      }
      return str;
    },
    [mask],
  );

  const [localVal, setLocalVal] = useState(() => formatValue(value));
  const [error, setError] = useState<string | null>(null);
  const onFlushRef = useRef(onFlush);
  const isFocusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(formatValue(value));
      if (validate) {
        let rawVal = value.toString();
        if (mask === "phone") {
          rawVal = rawVal.replace(/\D/g, "");
        } else if (mask === "currency") {
          // `value` já vem em reais: normalizar sem reinterpretar como centavos.
          const floatVal = Number.parseFloat(rawVal);
          rawVal = Number.isNaN(floatVal) ? "" : floatVal.toFixed(2);
        }
        setError(validate(rawVal));
      }
    }
  }, [value, validate, mask, formatValue]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value;
    let rawVal = val;

    if (mask === "phone") {
      val = formatPhone(val);
      rawVal = val.replace(/\D/g, "");
    } else if (mask === "currency") {
      val = formatCurrency(val);
      rawVal = parseCurrencyToFloatString(val);
    }

    setLocalVal(val);

    if (validate) {
      setError(validate(rawVal));
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onFlushRef.current(rawVal);
    }, delay);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    if (props.onFocus) {
      props.onFocus(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const val =
      localVal !== undefined && localVal !== null ? localVal.toString() : "";
    let rawVal = val;
    if (mask === "phone") {
      rawVal = val.replace(/\D/g, "");
    } else if (mask === "currency") {
      rawVal = parseCurrencyToFloatString(val);
    }
    onFlushRef.current(rawVal);
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      {useShadcn ? (
        <Input
          {...(props as any)}
          type={mask ? "text" : props.type}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus-visible:ring-red-500/30 focus-visible:border-red-500",
          )}
        />
      ) : (
        <input
          {...props}
          type={mask ? "text" : props.type}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus:ring-red-500/30 focus:border-red-500",
          )}
        />
      )}
      {error && (
        <p className="ml-1 flex items-center gap-1 text-[10px] font-bold text-red-400 duration-200 animate-in slide-in-from-top-1">
          <AlertTriangle className="size-3.5 text-red-500" />
          {error}
        </p>
      )}
    </div>
  );
});

interface LocalBufferedTextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "onChange" | "value"
  > {
  readonly value: string;
  readonly onFlush: (val: string) => void;
  readonly useShadcn?: boolean;
  readonly delay?: number;
  readonly validate?: (val: string) => string | null;
}

export const LocalBufferedTextarea = memo(function LocalBufferedTextarea({
  value,
  onFlush,
  useShadcn = false,
  delay = 200,
  className,
  validate,
  ...props
}: LocalBufferedTextareaProps) {
  const [localVal, setLocalVal] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const onFlushRef = useRef(onFlush);
  const isFocusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(value);
      if (validate) {
        setError(validate(value));
      }
    }
  }, [value, validate]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setLocalVal(val);

    if (validate) {
      setError(validate(val));
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onFlushRef.current(val);
    }, delay);
  };

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    isFocusedRef.current = true;
    if (props.onFocus) {
      props.onFocus(e);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    isFocusedRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const val =
      localVal !== undefined && localVal !== null ? localVal.toString() : "";
    onFlushRef.current(val);
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  return (
    <div className="flex w-full flex-col gap-1.5">
      {useShadcn ? (
        <Textarea
          {...(props as any)}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus-visible:ring-red-500/30 focus-visible:border-red-500",
          )}
        />
      ) : (
        <textarea
          {...props}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus:ring-red-500/30 focus:border-red-500",
          )}
        />
      )}
      {error && (
        <p className="ml-1 flex items-center gap-1 text-[10px] font-bold text-red-400 duration-200 animate-in slide-in-from-top-1">
          <AlertTriangle className="size-3.5 text-red-500" />
          {error}
        </p>
      )}
    </div>
  );
});
