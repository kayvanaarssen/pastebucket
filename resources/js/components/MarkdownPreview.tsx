import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
    content: string;
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
                        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
                            {children}
                        </pre>
                    ),
                    code: ({ children, className, ...props }) => {
                        const isInline = !className;
                        return isInline ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono" {...props}>
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
