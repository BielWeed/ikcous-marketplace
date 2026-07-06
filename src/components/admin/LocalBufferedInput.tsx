import React, { useState, useEffect, useRef, memo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface LocalBufferedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  readonly value: string | number;
  readonly onFlush: (val: string) => void;
  readonly useShadcn?: boolean;
  readonly delay?: number;
}

export const LocalBufferedInput = memo(function LocalBufferedInput({
  value,
  onFlush,
  useShadcn = false,
  delay = 200,
  className,
  ...props
}: LocalBufferedInputProps) {
  const [localVal, setLocalVal] = useState(value);
  const onFlushRef = useRef(onFlush);
  const isFocusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(value);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalVal(val);
    
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onFlushRef.current(val);
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
    const val = localVal !== undefined && localVal !== null ? localVal.toString() : '';
    onFlushRef.current(val);
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  if (useShadcn) {
    return (
      <Input
        {...(props as any)}
        value={localVal}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={className}
      />
    );
  }

  return (
    <input
      {...props}
      value={localVal}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
    />
  );
});

interface LocalBufferedTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  readonly value: string;
  readonly onFlush: (val: string) => void;
  readonly useShadcn?: boolean;
  readonly delay?: number;
}

export const LocalBufferedTextarea = memo(function LocalBufferedTextarea({
  value,
  onFlush,
  useShadcn = false,
  delay = 200,
  className,
  ...props
}: LocalBufferedTextareaProps) {
  const [localVal, setLocalVal] = useState(value);
  const onFlushRef = useRef(onFlush);
  const isFocusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalVal(value);
    }
  }, [value]);

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
    const val = localVal !== undefined && localVal !== null ? localVal.toString() : '';
    onFlushRef.current(val);
    if (props.onBlur) {
      props.onBlur(e);
    }
  };

  if (useShadcn) {
    return (
      <Textarea
        {...(props as any)}
        value={localVal}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={className}
      />
    );
  }

  return (
    <textarea
      {...props}
      value={localVal}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
    />
  );
});
