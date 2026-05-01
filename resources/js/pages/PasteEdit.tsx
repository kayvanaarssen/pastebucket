import { useState, useCallback, useRef } from 'react';
import { Head, useForm, Link } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { languages, detectLanguage } from '@/lib/languages';
import { getExpiryOptions } from '@/lib/expiry';
import { CodeHighlighter } from '@/components/CodeHighlighter';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, EyeOff, Globe, Link2, Flame, Code2, Clock, Eye, Info, ArrowLeft, X } from 'lucide-react';
import type { PageProps, Paste } from '@/types';

interface PasteEditProps extends PageProps {
    paste: Pick<Paste, 'slug' | 'title' | 'content' | 'language' | 'visibility' | 'burn_after_read' | 'expires_at' | 'is_password_protected'>;
    maxExpiry: number;
    currentExpiryHours: number;
}

export default function PasteEdit({ paste, maxExpiry, currentExpiryHours }: PasteEditProps) {
    const expiryOptions = getExpiryOptions(maxExpiry, true);

    // Find the closest matching expiry option for current value
    const findClosestExpiry = (hours: number): number => {
        if (hours === 0) return 0; // Never
        const optionValues = expiryOptions.map(o => o.value).filter(v => v > 0);
        let closest = optionValues[0];
        for (const val of optionValues) {
            if (Math.abs(val - hours) < Math.abs(closest - hours)) {
                closest = val;
            }
        }
        return closest;
    };

    const initialExpiry = paste.expires_at ? findClosestExpiry(currentExpiryHours) : 0;

    const { data, setData, put, processing, errors } = useForm({
        title: paste.title || '',
        content: paste.content,
        language: paste.language || '',
        password: '',
        remove_password: false,
        visibility: paste.visibility,
        expiry_hours: initialExpiry,
        burn_after_read: paste.burn_after_read,
    });

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [autoDetected, setAutoDetected] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleContentChange = useCallback((value: string) => {
        setData('content', value);

        if (detectTimeoutRef.current) clearTimeout(detectTimeoutRef.current);
        if (!data.language || data.language === '') {
            detectTimeoutRef.current = setTimeout(() => {
                const detected = detectLanguage(value);
                if (detected) setAutoDetected(detected);
            }, 500);
        }
    }, [data.language, setData]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = e.currentTarget;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const value = ta.value;
            const newValue = value.substring(0, start) + '\t' + value.substring(end);
            setData('content', newValue);
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + 1;
            });
        }
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        put(`/p/${paste.slug}`);
    };

    const effectiveLanguage = data.language || autoDetected;

    return (
        <AppLayout>
            <Head title={`Edit: ${paste.title || paste.slug}`} />

            <div className="mb-4">
                <Link
                    href={`/p/${paste.slug}`}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to paste
                </Link>
            </div>

            <form onSubmit={submit} className="space-y-3">
                {/* Title + language badge */}
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <Input
                            placeholder="Paste title (optional)"
                            value={data.title}
                            onChange={e => setData('title', e.target.value)}
                            className="h-10"
                        />
                    </div>
                    {effectiveLanguage && (
                        <div className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground">
                            <Code2 className="h-3.5 w-3.5" />
                            {languages.find(l => l.value === effectiveLanguage)?.label || effectiveLanguage}
                            {!data.language && autoDetected && (
                                <span className="text-xs text-muted-foreground">(detected)</span>
                            )}
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPreview(!showPreview)}
                        disabled={!data.content.trim()}
                        className="text-xs"
                    >
                        {showPreview ? <EyeOff className="mr-1.5 h-3.5 w-3.5" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}
                        {showPreview ? 'Edit' : 'Preview'}
                    </Button>
                </div>

                {/* Textarea / Preview */}
                <div>
                    {showPreview && data.content.trim() ? (
                        <div className="overflow-x-auto rounded-lg border min-h-[200px] sm:min-h-[300px]">
                            {effectiveLanguage === 'markdown' ? (
                                <MarkdownPreview content={data.content} />
                            ) : (
                                <CodeHighlighter code={data.content} language={effectiveLanguage || 'text'} showLineNumbers={false} />
                            )}
                        </div>
                    ) : (
                        <div className="relative">
                            <textarea
                                ref={textareaRef}
                                value={data.content}
                                onChange={e => handleContentChange(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Paste your code here..."
                                className="min-h-[200px] sm:min-h-[300px] w-full resize-y rounded-lg border bg-card p-3 sm:p-4 font-mono text-sm leading-relaxed text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring overflow-auto"
                                spellCheck={false}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                style={{ tabSize: 4 }}
                            />
                        </div>
                    )}
                    {errors.content && (
                        <p className="text-sm text-destructive">{errors.content}</p>
                    )}
                </div>

                {/* Options bar */}
                <Card>
                    <CardContent className="flex flex-wrap items-end gap-x-3 gap-y-2 p-3">
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Code2 className="h-3 w-3" />
                                Language
                            </Label>
                            <Select
                                value={data.language}
                                onValueChange={v => setData('language', v === 'auto' ? '' : v)}
                            >
                                <SelectTrigger className="w-[130px] text-xs">
                                    <SelectValue placeholder="Auto-detect" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">Auto-detect</SelectItem>
                                    {languages.map(lang => (
                                        <SelectItem key={lang.value} value={lang.value}>
                                            {lang.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Expires
                            </Label>
                            <Select
                                value={String(data.expiry_hours)}
                                onValueChange={v => setData('expiry_hours', Number(v))}
                            >
                                <SelectTrigger className="w-[100px] text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {expiryOptions.map(opt => (
                                        <SelectItem key={opt.value} value={String(opt.value)}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                Visibility
                            </Label>
                            <Select
                                value={data.visibility}
                                onValueChange={v => setData('visibility', v as 'public' | 'unlisted' | 'private')}
                            >
                                <SelectTrigger className="w-[115px] text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="public">
                                        <span className="flex items-center gap-1.5">
                                            <Globe className="h-3 w-3" />
                                            Public
                                        </span>
                                    </SelectItem>
                                    <SelectItem value="unlisted">
                                        <span className="flex items-center gap-1.5">
                                            <Link2 className="h-3 w-3" />
                                            Unlisted
                                        </span>
                                    </SelectItem>
                                    <SelectItem value="private">
                                        <span className="flex items-center gap-1.5">
                                            <EyeOff className="h-3 w-3" />
                                            Private
                                        </span>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                Password
                            </Label>
                            <div className="flex items-center gap-1">
                                <Input
                                    type="password"
                                    placeholder={paste.is_password_protected ? '••••••' : 'Optional'}
                                    value={data.password}
                                    onChange={e => {
                                        setData('password', e.target.value);
                                        if (e.target.value) setData('remove_password', false);
                                    }}
                                    disabled={data.remove_password}
                                    className="w-[120px] text-xs md:text-xs"
                                />
                                {paste.is_password_protected && (
                                    <TooltipProvider delayDuration={300}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant={data.remove_password ? 'destructive' : 'outline'}
                                                    size="icon"
                                                    className="h-9 w-9 shrink-0"
                                                    onClick={() => {
                                                        setData('remove_password', !data.remove_password);
                                                        if (!data.remove_password) setData('password', '');
                                                    }}
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top">
                                                {data.remove_password ? 'Keep password' : 'Remove password'}
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Flame className="h-3 w-3 text-orange-500" />
                                Burn
                                <TooltipProvider delayDuration={300}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-[200px] text-center">
                                            Paste will be deleted after being viewed once
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </Label>
                            <div className="flex h-9 items-center">
                                <Switch
                                    checked={data.burn_after_read}
                                    onCheckedChange={v => setData('burn_after_read', v)}
                                />
                            </div>
                        </div>
                        <Button
                            type="submit"
                            className="ml-auto self-center"
                            disabled={processing || !data.content.trim()}
                        >
                            {processing ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </CardContent>
                </Card>
            </form>
        </AppLayout>
    );
}
