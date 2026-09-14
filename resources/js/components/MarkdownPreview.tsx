import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState, type ReactNode } from 'react';
import { Copy, Check, ImageOff } from 'lucide-react';

interface MarkdownPreviewProps {
    content: string;
    /**
     * `preview` is the original compact rendering used for Markdown code pastes
     * and editor previews. `document` is the reading view for formatted-text
     * pastes: calmer typography, and nothing is fetched from elsewhere.
     */
    variant?: 'preview' | 'document';
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
        <div className="not-prose relative">
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 text-zinc-100 p-4 pr-12 text-[0.95rem] leading-relaxed dark:bg-zinc-800 font-mono [color-scheme:dark]">
                {children}
            </pre>
            <button
                onClick={copyCode}
                className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-white/20 hover:bg-white/30 text-white transition-colors"
                title="Copy code"
            >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
        </div>
    );
}

const sharedComponents: Components = {
    pre: ({ children }) => (
        <CodeBlock>{children}</CodeBlock>
    ),
    code: ({ children, className, node: _node, ...props }) => {
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
};

const previewComponents: Components = {
    ...sharedComponents,
    a: ({ children, node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    ),
};

/**
 * The document view never loads a remote image. A published document is read
 * by a customer who did not choose where its images live; fetching them would
 * tell a third party who opened the link, and when. The address stays
 * available as an explicit link the reader can choose to follow.
 */
const documentComponents: Components = {
    ...sharedComponents,
    a: ({ children, node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer nofollow" className="break-words">
            {children}
        </a>
    ),
    img: ({ src, alt }) => {
        const label = (
            <>
                <ImageOff className="h-3.5 w-3.5 shrink-0" />
                <span>Image{alt ? `: ${alt}` : ''} (not loaded)</span>
            </>
        );
        const className = 'not-prose inline-flex items-center gap-1.5 rounded border border-dashed px-2 py-0.5 text-sm text-muted-foreground';
        // react-markdown's default URL transform has already blanked unsafe schemes.
        return typeof src === 'string' && src !== '' ? (
            <a href={src} target="_blank" rel="noopener noreferrer nofollow" className={`${className} hover:text-foreground`}>
                {label}
            </a>
        ) : (
            <span className={className}>{label}</span>
        );
    },
};

export function MarkdownPreview({ content, variant = 'preview' }: MarkdownPreviewProps) {
    if (variant === 'document') {
        return (
            // The typography plugin draws literal backticks around inline code and
            // bullets in front of checkboxes; neither belongs in a document read
            // by someone who never saw the Markdown.
            <article className="prose prose-base dark:prose-invert mx-auto max-w-3xl px-4 py-6 leading-relaxed sm:px-8 sm:py-10 prose-headings:font-semibold prose-li:my-1 prose-table:my-0 prose-code:before:content-none prose-code:after:content-none [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0 [&_.contains-task-list_.contains-task-list]:pl-6 [&_.task-list-item]:pl-0 [&_.task-list-item_input]:mr-2">

                <ReactMarkdown remarkPlugins={[remarkGfm]} components={documentComponents}>
                    {content}
                </ReactMarkdown>
            </article>
        );
    }

    return (
        <div className="prose prose-sm dark:prose-invert max-w-none p-4 sm:p-6">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={previewComponents}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
