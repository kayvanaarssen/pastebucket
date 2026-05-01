import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { CodeHighlighter } from '@/components/CodeHighlighter';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { Copy, Check, Trash2, ExternalLink, Clock, Eye, Lock, Flame, Globe, Link2, EyeOff, Code2, FileText, LinkIcon, BookOpen, Pencil } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { usePage } from '@inertiajs/react';
import type { Paste, PageProps } from '@/types';

interface PasteViewProps extends PageProps {
    paste: Paste;
}

export default function PasteView({ paste }: PasteViewProps) {
    const [copied, setCopied] = useState(false);
    const [urlCopied, setUrlCopied] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [showFormatted, setShowFormatted] = useState(paste.language === 'markdown');
    const { flash } = usePage<PageProps>().props;
    const autoCopied = useRef(false);

    const pasteUrl = `${window.location.origin}/p/${paste.slug}`;

    // Auto-copy URL to clipboard when paste is just created
    useEffect(() => {
        if (flash.just_created && !autoCopied.current) {
            autoCopied.current = true;
            navigator.clipboard.writeText(pasteUrl).then(() => {
                setUrlCopied(true);
                setTimeout(() => setUrlCopied(false), 3000);
            });
        }
    }, [flash.just_created]);

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(paste.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const copyUrl = async () => {
        await navigator.clipboard.writeText(pasteUrl);
        setUrlCopied(true);
        setTimeout(() => setUrlCopied(false), 2000);
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
                                    <Button size="sm" onClick={copyUrl} className={urlCopied ? 'bg-green-600 hover:bg-green-700 text-white' : ''}>
                                        {urlCopied ? <Check className="mr-1.5 h-4 w-4" /> : <LinkIcon className="mr-1.5 h-4 w-4" />}
                                        {urlCopied ? 'URL Copied!' : 'Copy URL'}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy paste URL to clipboard</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
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
                        {paste.language === 'markdown' && (
                            <Button
                                variant={showFormatted ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setShowFormatted(!showFormatted)}
                            >
                                {showFormatted ? <Code2 className="mr-1.5 h-4 w-4" /> : <BookOpen className="mr-1.5 h-4 w-4" />}
                                {showFormatted ? 'Source' : 'Formatted'}
                            </Button>
                        )}
                        {paste.is_owner && (
                            <>
                                <Button variant="outline" size="sm" asChild>
                                    <Link href={`/p/${paste.slug}/edit`}>
                                        <Pencil className="mr-1.5 h-4 w-4" />
                                        Edit
                                    </Link>
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                                    onClick={() => setDeleteOpen(true)}
                                >
                                    <Trash2 className="mr-1.5 h-4 w-4" />
                                    Delete
                                </Button>
                            </>
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

                {/* Code block / Markdown preview */}
                <div className="overflow-x-auto rounded-lg border">
                    {paste.language === 'markdown' && showFormatted ? (
                        <MarkdownPreview content={paste.content} />
                    ) : (
                        <CodeHighlighter code={paste.content} language={paste.language} />
                    )}
                </div>
            </div>

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Paste</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this paste? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => router.delete(`/p/${paste.slug}`)}>
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
