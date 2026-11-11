import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { digitosDoTelefoneDoCampo } from "@/lib/telefone-br";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";

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
  /** Mantém dígitos excedentes para o validador do WhatsApp da loja recusar. */
  readonly preservarExcessoTelefone?: boolean;
  /** Só com `mask="currency"`: preserva o sinal na exibição e no onFlush. */
  readonly permiteNegativo?: boolean;
  /**
   * Só com `mask="currency"`: o zero DIGITADO vira campo vazio. A máscara nunca
   * deixa o campo vazio sozinha (apagar o "0,05" com backspace dá "0,0", lido
   * como "00" e mostrado como "0,00"), e onde vazio quer dizer "sem preço
   * próprio" esse "0,00" virava preço zero. O valor que já veio salvo (prop
   * `value`) continua sendo mostrado como está, zero inclusive.
   */
  readonly zeroVazio?: boolean;
  /**
   * Só com `zeroVazio`: o zero que a pessoa ESCREVE (ou cola) vale e fica como
   * "0,00"; só APAGAR até sobrar zero esvazia o campo. É o custo do produto:
   * vazio = "sem custo", 0,00 = brinde. Sem `inputType` no evento (teste
   * sintético), vale o esvaziar de antes quando o texto bruto tem vírgula.
   */
  readonly zeroDigitadoVale?: boolean;
  /**
   * Ao sair do campo, escreve de volta o texto já normalizado (o mesmo que o
   * `onFlush` entrega ao pai). Sem isto, o campo seguia mostrando o que foi
   * digitado ("verão 10") enquanto outro texto ("VERAO10") era gravado.
   */
  readonly normalizarAoSair?: (val: string) => string;
}

// Com erro, o campo aponta para a mensagem (leitor de tela a lê junto do
// campo), sem apagar um `aria-describedby` que o chamador já tenha passado.
const descritoPor = (
  existente: string | undefined,
  erroId: string,
  erro: string | null,
) => (erro ? [existente, erroId].filter(Boolean).join(" ") : existente);

const formatPhone = (
  val: string,
  anterior?: string,
  preservarExcesso = false,
) => {
  const clean = digitosDoTelefoneDoCampo(val, anterior);
  // Excedente precisa chegar à validação, não virar outro número válido.
  if (preservarExcesso && clean.length > 11) return clean;
  if (clean.length === 0) return "";
  if (clean.length <= 2) return `(${clean}`;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10)
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
};

const sinalDaMoeda = (val: string, permiteNegativo: boolean) => {
  if (!permiteNegativo) return "";
  const texto = val.replace(/R\$/gi, "").replace(/\s/g, "");
  return /^[-−]|[-−]$/.test(texto) ||
    (texto.startsWith("(") && texto.endsWith(")"))
    ? "-"
    : "";
};

// Dígitos sem fim chegam a 1e21 (o `toFixed` devolveria "1e+21", lido depois
// como 121) e a Infinity (a tela mostraria "∞"). O número é limitado antes de
// virar texto; 1e18 continua acima de qualquer teto de preço.
const reaisDosCentavos = (clean: string) =>
  Math.min(Number.parseFloat(clean) / 100, 1e18);

const formatCurrency = (val: string, permiteNegativo = false) => {
  const sinal = sinalDaMoeda(val, permiteNegativo);
  const clean = val.replace(/\D/g, "");
  if (clean.length === 0) return sinal;
  const num = reaisDosCentavos(clean);
  return (
    sinal +
    num.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
};

const parseCurrencyToFloatString = (val: string, permiteNegativo = false) => {
  const sinal = sinalDaMoeda(val, permiteNegativo);
  const clean = val.replace(/\D/g, "");
  if (clean.length === 0) return sinal;
  const num = reaisDosCentavos(clean);
  return sinal + num.toFixed(2);
};

// Colagem: lê o texto como número brasileiro (vírgula decimal, ponto de milhar;
// "R$", espaços e sinal ignorados) e devolve os centavos, ou "" se não for número.
// Ponto sem vírgula: 1-2 dígitos depois é decimal ("12.5"), 3 é milhar ("1.234").
const centavosDaColagem = (texto: string) => {
  const t = texto.replace(/[^\d.,]/g, "");
  if (!/\d/.test(t)) return "";
  const [inteira, decimal = "", ...resto] = t.split(",");
  const grupos = inteira.split(".");
  const milhar =
    grupos.length > 1 &&
    grupos[0].length > 0 &&
    grupos[0].length <= 3 &&
    grupos.slice(1).every((g) => g.length === 3);
  let n = "";
  if (resto.length === 0 && /^\d*$/.test(decimal)) {
    if (grupos.length === 1 || milhar)
      n = `${grupos.join("") || 0}.${decimal || 0}`;
    else if (t === inteira && /^\d+\.\d{1,2}$/.test(t)) n = t;
  }
  return n ? String(Math.round(Number(n) * 100)) : "";
};

// O valor que chega pela prop `value` já está em reais (ex.: 100 ou "100.00"),
// diferente do que o usuário digita, que é interpretado em centavos.
// Converter para centavos antes de formatar, senão R$ 100,00 é exibido como R$ 1,00.
const decimalToCurrencyDisplay = (val: string, permiteNegativo = false) => {
  if (val.trim() === "") return "";
  if (permiteNegativo && val.trim() === "-") return "-";
  const floatVal = Number.parseFloat(val);
  if (Number.isNaN(floatVal)) return "";
  return formatCurrency(Math.round(floatVal * 100).toString(), permiteNegativo);
};

export const LocalBufferedInput = memo(function LocalBufferedInput({
  value,
  onFlush,
  useShadcn = false,
  delay = 200,
  className,
  validate,
  mask,
  preservarExcessoTelefone = false,
  permiteNegativo = false,
  zeroVazio = false,
  zeroDigitadoVale = false,
  normalizarAoSair,
  ...props
}: LocalBufferedInputProps) {
  const formatValue = useCallback(
    (val: string | number) => {
      const str = val !== undefined && val !== null ? val.toString() : "";
      if (mask === "phone") {
        // O próprio onFlush já entrega dígitos nacionais. Não ler novamente
        // o 55 excedente como país quando o pai devolve esse valor pela prop.
        return formatPhone(
          str,
          preservarExcessoTelefone ? str : undefined,
          preservarExcessoTelefone,
        );
      }
      if (mask === "currency") {
        return decimalToCurrencyDisplay(str, permiteNegativo);
      }
      return str;
    },
    [mask, permiteNegativo, preservarExcessoTelefone],
  );

  const [localVal, setLocalVal] = useState(() => formatValue(value));
  const [error, setError] = useState<string | null>(null);
  const erroId = useId();
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
      val = formatPhone(val, localVal.toString(), preservarExcessoTelefone);
      rawVal = val.replace(/\D/g, "");
    } else if (mask === "currency") {
      const { inputType: tipo, data } = e.nativeEvent as InputEvent;
      if (tipo === "insertFromPaste" || tipo === "insertFromDrop") {
        // Colar/soltar não é "máscara de centavos": o texto vale como número e
        // substitui o campo. `data` é só o trecho inserido (o campo já vem
        // misturado com o que havia); sem ele, vale o campo inteiro.
        const colado = data ?? val;
        const centavos = centavosDaColagem(colado);
        if (!centavos) return; // não é número: ignora, o campo volta ao que era
        val = sinalDaMoeda(colado, permiteNegativo) + centavos;
      }
      const textoBruto = val;
      val = formatCurrency(val, permiteNegativo);
      rawVal = parseCurrencyToFloatString(val, permiteNegativo);
      const zeroEscrito =
        zeroDigitadoVale &&
        (tipo === undefined
          ? !textoBruto.includes(",")
          : !tipo.startsWith("delete"));
      if (zeroVazio && !zeroEscrito && Number.parseFloat(rawVal) === 0) {
        val = "";
        rawVal = "";
      }
    }

    setLocalVal(val);

    if (validate) {
      setError(validate(rawVal));
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onFlushRef.current(rawVal);
    }, delay);
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = true;
    if (props.onFocus) {
      props.onFocus(e);
    }
  };

  const flushBufferedValue = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const val =
      localVal !== undefined && localVal !== null ? localVal.toString() : "";
    let rawVal = val;
    if (mask === "phone") {
      rawVal = val.replace(/\D/g, "");
    } else if (mask === "currency") {
      rawVal = parseCurrencyToFloatString(val, permiteNegativo);
    }
    onFlushRef.current(rawVal);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocusedRef.current = false;
    flushBufferedValue();
    if (normalizarAoSair) setLocalVal(normalizarAoSair(String(localVal)));
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === "Enter" &&
      !e.nativeEvent.isComposing &&
      timerRef.current !== null
    ) {
      flushBufferedValue();
    }
    if (props.onKeyDown) {
      props.onKeyDown(e);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    if (props.type === "number" && document.activeElement === e.currentTarget) {
      e.currentTarget.blur();
    }
    props.onWheel?.(e);
  };

  // Teclado do celular: a máscara roda por JS sobre um input de texto, então o
  // aparelho não sabe que só entram dígitos. Moeda com sinal fica sem dica (o
  // teclado numérico do iPhone não tem o "-"). O `inputMode` do chamador vence.
  let modoDoTeclado = props.inputMode;
  if (modoDoTeclado === undefined) {
    if (mask === "phone") modoDoTeclado = "tel";
    else if (mask === "currency" && !permiteNegativo) modoDoTeclado = "numeric";
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {useShadcn ? (
        <Input
          {...(props as any)}
          // Um `type` explícito do chamador vence a máscara (ex.: type="tel"
          // no WhatsApp do Atendimento — teclado numérico no celular). A
          // máscara funciona por JS sobre o valor, não pelo tipo do input.
          type={props.type ?? (mask ? "text" : undefined)}
          inputMode={modoDoTeclado}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={descritoPor(
            props["aria-describedby"],
            erroId,
            error,
          )}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus-visible:ring-red-500/30 focus-visible:border-red-500",
          )}
        />
      ) : (
        <input
          {...props}
          type={props.type ?? (mask ? "text" : undefined)}
          inputMode={modoDoTeclado}
          value={localVal}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={descritoPor(
            props["aria-describedby"],
            erroId,
            error,
          )}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus:ring-red-500/30 focus:border-red-500",
          )}
        />
      )}
      {error && (
        <p
          id={erroId}
          role="alert"
          className="ml-1 flex items-center gap-1 text-[11px] font-bold text-red-400 duration-200 animate-in slide-in-from-top-1"
        >
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
  const erroId = useId();
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
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={descritoPor(
            props["aria-describedby"],
            erroId,
            error,
          )}
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
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={descritoPor(
            props["aria-describedby"],
            erroId,
            error,
          )}
          className={cn(
            className,
            error &&
              "border-red-500/50 focus:ring-red-500/30 focus:border-red-500",
          )}
        />
      )}
      {error && (
        <p
          id={erroId}
          role="alert"
          className="ml-1 flex items-center gap-1 text-[11px] font-bold text-red-400 duration-200 animate-in slide-in-from-top-1"
        >
          <AlertTriangle className="size-3.5 text-red-500" />
          {error}
        </p>
      )}
    </div>
  );
});
