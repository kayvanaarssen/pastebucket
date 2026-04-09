import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { useTheme } from '@/components/ThemeProvider';
import { Copy, Check, Trash2, ExternalLink, Clock, Eye, Lock, Flame, Globe, Link2, EyeOff, Code2, FileText } from 'lucide-react';
import { useState } from 'react';
import type { Paste, PageProps } from '@/types';

interface PasteViewProps extends PageProps {
    paste: Paste;
}

export default function PasteView({ paste }: PasteViewProps) {
    const { resolvedTheme } = useTheme();
    const [copied, setCopied] = useState(false);

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(paste.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const timeUntilExpiry = (dateStr: string) => {
        const diff = new Date(dateStr).getTime() - Date.now();
        if (diff <= 0) return 'Expired';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ${hours % 24}h`;
        const minutes = Math.floor(diff / (1000 * 60));
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        return `${minutes}m`;
    };

    const visibilityIcon = {
        public: <Globe className="h-3.5 w-3.5" />,
        unlisted: <Link2 className="h-3.5 w-3.5" />,
        private: <EyeOff className="h-3.5 w-3.5" />,
    };

    const lineCount = paste.content.split('\n').length;

    return (
        <AppLayout>
            <Head title={paste.title || paste.slug} />
            <div className="space-y-4">
                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold">
                            {paste.title || 'Untitled Paste'}
                        </h1>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {paste.author && <span>by {paste.author}</span>}
                            <span>{formatDate(paste.created_at)}</span>
                            <Badge variant="outline" className="gap-1">
                                {visibilityIcon[paste.visibility]}
                                {paste.visibility}
                            </Badge>
                            {paste.language && (
                                <Badge variant="secondary" className="gap-1">
                                    <Code2 className="h-3 w-3" />
                                    {paste.language}
                                </Badge>
                            )}
                            {paste.is_password_protected && (
                                <Badge variant="secondary" className="gap-1">
                                    <Lock className="h-3 w-3" />
                                    Protected
                                </Badge>
                            )}
                            {paste.burn_after_read && (
                                <Badge variant="destructive" className="gap-1">
                                    <Flame className="h-3 w-3" />
                                    Burns after read
                                </Badge>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="sm" onClick={copyToClipboard}>
                                        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                                        {copied ? 'Copied!' : 'Copy'}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy paste content</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Button variant="outline" size="sm" asChild>
                            <a href={`/p/${paste.slug}/raw`} target="_blank">
                                <FileText className="mr-1.5 h-4 w-4" />
                                Raw
                            </a>
                        </Button>
                        {paste.is_owner && (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                    if (confirm('Delete this paste?')) {
                                        router.delete(`/p/${paste.slug}`);
                                    }
                                }}
                            >
                                <Trash2 className="mr-1.5 h-4 w-4" />
                                Delete
                            </Button>
                        )}
                    </div>
                </div>

                {/* Stats bar */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" />
                        {paste.views} view{paste.views !== 1 ? 's' : ''}
                    </span>
                    <span>{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
                    {paste.expires_at && (
                        <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Expires in {timeUntilExpiry(paste.expires_at)}
                        </span>
                    )}
                </div>

                {/* Code block */}
                <div className="overflow-x-auto rounded-lg border">
                    <SyntaxHighlighter
                        key={resolvedTheme}
                        language={paste.language || 'text'}
                        style={resolvedTheme === 'dark' ? vscDarkPlus : oneLight}
                        showLineNumbers
                        wrapLongLines
                        customStyle={{
                            margin: 0,
                            borderRadius: 0,
                            fontSize: '0.8125rem',
                            lineHeight: '1.6',
                            padding: '0.75rem',
                        }}
                        lineNumberStyle={{
                            minWidth: '2.5em',
                            paddingRight: '0.75em',
                            opacity: 0.5,
                            userSelect: 'none',
                        }}
                    >
                        {paste.content}
                    </SyntaxHighlighter>
                </div>
            </div>
        </AppLayout>
    );
}
