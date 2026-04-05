import React from 'react';

/**
 * A simple markdown-like renderer that handles:
 * - Line breaks (\n)
 * - Bold (**text**)
 * - Simple headers (### Header)
 * - Lists (* Item)
 * - Emojis (already supported by unicode strings)
 */
interface MarkdownRendererProps {
    content: string;
    className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
    if (!content) return null;

    // Split by double newlines for paragraphs
    const paragraphs = content.split(/\n\n+/);

    return (
        <div className={`space-y-4 ${className}`}>
            {paragraphs.map((para, i) => {
                // Check if it's a header
                if (para.startsWith('###')) {
                    return (
                        <h3 key={i} className="text-lg font-black text-zinc-900 mt-6 mb-2">
                            {para.replace('###', '').trim()}
                        </h3>
                    );
                }

                // Process line breaks and bold within the paragraph
                const lines = para.split('\n');

                return (
                    <p key={i} className="text-sm text-gray-600 leading-relaxed">
                        {lines.map((line, lineIdx) => (
                            <React.Fragment key={lineIdx}>
                                {processInline(line)}
                                {lineIdx < lines.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </p>
                );
            })}
        </div>
    );
}

function processInline(text: string) {
    // Simple regex for bold **text**
    const parts = text.split(/(\*\*.*?\*\*)/g);

    return parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return (
                <strong key={index} className="font-black text-zinc-900">
                    {part.slice(2, -2)}
                </strong>
            );
        }
        return part;
    });
}
