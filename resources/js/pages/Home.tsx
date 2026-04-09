import { useState, useCallback, useRef } from 'react';
import { Head, useForm } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { languages, detectLanguage } from '@/lib/languages';
import { getExpiryOptions } from '@/lib/expiry';
import { Lock, EyeOff, Globe, Link2, Flame, Code2, Clock } from 'lucide-react';
import type { PageProps } from '@/types';

interface HomeProps extends PageProps {
    defaultExpiry: number;
    maxExpiry: number;
    isAuthenticated: boolean;
}

export default function Home({ defaultExpiry, maxExpiry, isAuthenticated }: HomeProps) {
    const { data, setData, post, processing, errors, transform } = useForm({
        title: '',
        content: '',
        language: '',
        password: '',
        visibility: 'unlisted' as 'public' | 'unlisted' | 'private',
        expiry_hours: defaultExpiry,
        burn_after_read: false,
    });

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [autoDetected, setAutoDetected] = useState<string | null>(null);
    const detectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const expiryOptions = getExpiryOptions(maxExpiry);

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
        if (!data.language && autoDetected) {
            setData('language', autoDetected);
        }
        transform((formData) => ({
            ...formData,
            language: formData.language || autoDetected || '',
        }));
        post('/paste');
    };

    const effectiveLanguage = data.language || autoDetected;

    return (
        <AppLayout>
            <Head title="New Paste" />
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
                </div>

                {/* Textarea */}
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
                    {errors.content && (
                        <p className="mt-1 text-sm text-destructive">{errors.content}</p>
                    )}
                </div>

                {/* Options bar */}
                <Card>
                    <CardContent className="flex flex-wrap items-end gap-x-3 gap-y-2 p-3">
                        <div className="space-y-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Code2 className="h-3 w-3" />
                                Language
                            </Label>
                            <Select
                                value={data.language}
                                onValueChange={v => setData('language', v === 'auto' ? '' : v)}
                            >
                                <SelectTrigger className="h-8 w-[130px] text-xs">
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
                        <div className="space-y-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Expires
                            </Label>
                            <Select
                                value={String(data.expiry_hours)}
                                onValueChange={v => setData('expiry_hours', Number(v))}
                            >
                                <SelectTrigger className="h-8 w-[100px] text-xs">
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
                        <div className="space-y-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Globe className="h-3 w-3" />
                                Visibility
                            </Label>
                            <Select
                                value={data.visibility}
                                onValueChange={v => setData('visibility', v as 'public' | 'unlisted' | 'private')}
                            >
                                <SelectTrigger className="h-8 w-[115px] text-xs">
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
                                    <SelectItem value="private" disabled={!isAuthenticated}>
                                        <span className="flex items-center gap-1.5">
                                            <EyeOff className="h-3 w-3" />
                                            Private {!isAuthenticated && '(login)'}
                                        </span>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Lock className="h-3 w-3" />
                                Password
                            </Label>
                            <Input
                                type="password"
                                placeholder="Optional"
                                value={data.password}
                                onChange={e => setData('password', e.target.value)}
                                className="h-8 w-[140px] text-xs py-0"
                            />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <Label className="text-xs flex items-center gap-1">
                                <Flame className="h-3 w-3 text-orange-500" />
                                Burn
                            </Label>
                            <div className="flex h-8 items-center">
                                <Switch
                                    checked={data.burn_after_read}
                                    onCheckedChange={v => setData('burn_after_read', v)}
                                />
                            </div>
                        </div>
                        {!isAuthenticated && (
                            <p className="text-xs text-muted-foreground self-center">
                                Login for 365d expiry
                            </p>
                        )}
                        <Button
                            type="submit"
                            className="ml-auto self-center"
                            disabled={processing || !data.content.trim()}
                        >
                            {processing ? 'Creating...' : 'Create Paste'}
                        </Button>
                    </CardContent>
                </Card>
            </form>
        </AppLayout>
    );
}
