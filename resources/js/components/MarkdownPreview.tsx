import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownPreviewProps {
    content: string;
}

function CodeBlock({ children }: { children: ReactNode }) {
    const [copied, setCopied] = useState(false);

    const getTextContent = (node: ReactNode): string => {
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) return node.map(getTextContent).join('');
        if (node && typeof node === 'object' && 'props' in node) {
            return getTextContent((node as any).props.children);
        }
        return '';
    };

    const copyCode = () => {
        navigator.clipboard.writeText(getTextContent(children));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="group relative">
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 text-zinc-100 p-4 text-[0.9rem] leading-relaxed dark:bg-zinc-800">
                {children}
            </pre>
            <button
                onClick={copyCode}
                className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-zinc-700/60 hover:bg-zinc-600 text-zinc-300 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copy code"
            >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
        </div>
    );
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
    return (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4 sm:p-6">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    a: ({ children, ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer">
                            {children}
                        </a>
                    ),
                    pre: ({ children }) => (
                        <CodeBlock>{children}</CodeBlock>
                    ),
                    code: ({ children, className, ...props }) => {
                        const isInline = !className;
                        return isInline ? (
                            <code className="rounded bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 text-[0.9rem] font-mono text-foreground" {...props}>
                                {children}
                            </code>
                        ) : (
                            <code className={className} {...props}>
                                {children}
                            </code>
                        );
                    },
                    table: ({ children }) => (
                        <div className="overflow-x-auto">
                            <table className="w-full">{children}</table>
                        </div>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
