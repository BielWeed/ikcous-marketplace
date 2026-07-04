import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';

interface DebouncedSearchInputProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
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
    name
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
