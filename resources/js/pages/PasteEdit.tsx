import { useState, useCallback, useEffect, useRef } from 'react';
import { Head, useForm, Link } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { languages, detectLanguage } from '@/lib/languages';
import { getExpiryOptions } from '@/lib/expiry';
import { CodeHighlighter } from '@/components/CodeHighlighter';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, EyeOff, Globe, Link2, Flame, Code2, Clock, Eye, Info, ArrowLeft, X, ShieldAlert, KeyRound } from 'lucide-react';
import {
    DecryptionError,
    ENCRYPTION_VERSION,
    decryptWithCek,
    encryptContent,
    importFragmentKey,
    isCryptoAvailable,
    readKeyFromFragment,
    reEncryptWithCek,
    stashPendingKey,
    unwrapCekWithPassword,
    writeKeyToFragment,
} from '@/lib/crypto';
import type { EncryptionMeta, PageProps, Paste } from '@/types';

interface PasteEditProps extends PageProps {
    paste: Pick<Paste, 'slug' | 'title' | 'content' | 'language' | 'visibility' | 'burn_after_read' | 'expires_at' | 'is_password_protected' | 'encryption_version' | 'encryption_meta' | 'is_encrypted'>;
    maxExpiry: number;
    currentExpiryHours: number;
}

const NO_CRYPTO_MESSAGE =
    'This page cannot encrypt or decrypt: WebCrypto is unavailable, which usually means '
    + 'the site was loaded over plain http rather than https. Editing is disabled here so '
    + 'a save cannot overwrite this paste with content nobody can read.';

const NO_KEY_MESSAGE =
    'This paste is encrypted with a key that only lives in the link fragment (#k=...), and '
    + 'the address you arrived on does not carry one. Open the paste from its full link and '
    + 'start editing from there -- saving without the key would replace the paste with '
    + 'unreadable text.';

const BROKEN_ENVELOPE_MESSAGE =
    'This paste is marked as encrypted but its encryption parameters are missing, so there '
    + 'is nothing here to decrypt it with. Editing is disabled to avoid overwriting it.';

/**
 * What the editor is allowed to do right now. Anything other than `ready` must
 * keep the form off the screen: an editor holding the wrong text saves the
 * wrong text, and for an encrypted paste that is unrecoverable.
 */
type EditorGate =
    | { status: 'unlocking' }
    | { status: 'password' }
    | { status: 'ready' }
    | { status: 'locked'; message: string };

/** The ciphertext and envelope a single save will send. */
interface SaveEnvelope {
    content: string;
    encryption_version: number;
    encryption_meta: EncryptionMeta;
    /**
     * The key that has to be in the URL once the save lands -- freshly minted,
     * or the one we arrived with, since the redirect to /p/{slug} drops the
     * fragment either way. Null for password mode, which has no key in the URL.
     */
    fragmentKey: string | null;
}

/** Decryption failures are deliberately vague; anything else is a real bug. */
function describeFailure(error: unknown): string {
    return error instanceof DecryptionError ? error.message : 'Unable to decrypt this paste.';
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

    const { data, setData, put, processing, errors, transform } = useForm({
        title: paste.title || '',
        // Ciphertext must never reach the textarea. It would be edited as if it
        // were the paste and then saved straight over the real content.
        content: paste.is_encrypted ? '' : paste.content,
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
    // The CEK recovered at unlock. Re-encrypting under it is the whole reason an
    // edit does not break links that already carry this paste's key.
    const cekRef = useRef<CryptoKey | null>(null);
    // Kept so it can be put back in the URL after saving, because the redirect
    // to /p/{slug} arrives without a fragment.
    const fragmentKeyRef = useRef<string | null>(null);
    const [gate, setGate] = useState<EditorGate>(() => {
        if (!isCryptoAvailable()) return { status: 'locked', message: NO_CRYPTO_MESSAGE };
        if (!paste.is_encrypted) return { status: 'ready' };
        if (!paste.encryption_meta) return { status: 'locked', message: BROKEN_ENVELOPE_MESSAGE };
        if (paste.encryption_meta.mode === 'password') return { status: 'password' };
        return readKeyFromFragment()
            ? { status: 'unlocking' }
            : { status: 'locked', message: NO_KEY_MESSAGE };
    });
    const [unlockPassword, setUnlockPassword] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [unlockError, setUnlockError] = useState<string | null>(null);
    // Encryption runs before the request starts, so `processing` is still false
    // while it happens and cannot be used to guard against a double submit.
    const [encrypting, setEncrypting] = useState(false);
    const [cryptoError, setCryptoError] = useState<string | null>(null);

    // Fragment mode needs nothing from the user, so it unlocks on mount. The
    // gate only ever leaves 'unlocking' from here, which is why this runs once.
    useEffect(() => {
        const meta = paste.encryption_meta;
        const rawKey = readKeyFromFragment();
        if (gate.status !== 'unlocking' || !meta || !rawKey) return;

        let cancelled = false;

        void (async () => {
            try {
                const cek = await importFragmentKey(rawKey);
                const plaintext = await decryptWithCek(paste.content, meta, cek);
                if (cancelled) return;
                cekRef.current = cek;
                fragmentKeyRef.current = rawKey;
                setData('content', plaintext);
                setGate({ status: 'ready' });
            } catch (error) {
                if (cancelled) return;
                setGate({ status: 'locked', message: describeFailure(error) });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const unlock = async (e: React.FormEvent) => {
        e.preventDefault();
        const meta = paste.encryption_meta;
        if (!meta || unlocking) return;

        setUnlockError(null);
        setUnlocking(true);

        try {
            const cek = await unwrapCekWithPassword(unlockPassword, meta);
            const plaintext = await decryptWithCek(paste.content, meta, cek);
            cekRef.current = cek;
            setData('content', plaintext);
            // The CEK is what the rest of the page needs; the password itself has
            // no further use, so stop holding it.
            setUnlockPassword('');
            setGate({ status: 'ready' });
        } catch (error) {
            setUnlockError(describeFailure(error));
        } finally {
            setUnlocking(false);
        }
    };

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

    // A legacy paste's password is checked by the server. Encrypting moves that
    // check into the key wrapping, and we cannot re-wrap under a password we
    // never see -- so make the user choose instead of dropping it silently.
    const needsPasswordChoice =
        !paste.is_encrypted && paste.is_password_protected && !data.password && !data.remove_password;

    /**
     * Build the envelope for this save. The key may only change when the user
     * asks for a different password: every link already shared carries the old
     * one, and minting a new key would silently break all of them.
     */
    const buildEnvelope = async (): Promise<SaveEnvelope> => {
        const cek = cekRef.current;
        const meta = paste.encryption_meta;

        if (cek && meta && !data.password && !data.remove_password) {
            const { content, iv } = await reEncryptWithCek(data.content, cek);
            // Only the IV moves. mode, salt, wrapped_key and wrap_iv still
            // describe the same CEK, so existing links and the existing password
            // keep working.
            return {
                content,
                encryption_version: paste.encryption_version ?? ENCRYPTION_VERSION,
                encryption_meta: { ...meta, iv },
                fragmentKey: fragmentKeyRef.current,
            };
        }

        // Re-keying: a legacy paste has no key yet, and a password change has to
        // discard the wrapped copy of the CEK that the old password unlocked.
        const encrypted = await encryptContent(data.content, data.password || null);
        return {
            content: encrypted.content,
            encryption_version: encrypted.encryption_version,
            encryption_meta: encrypted.encryption_meta,
            fragmentKey: encrypted.fragmentKey ?? null,
        };
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (gate.status !== 'ready' || encrypting || needsPasswordChoice) return;

        if (!data.language && autoDetected) {
            setData('language', autoDetected);
        }

        // Inertia's transform is synchronous, so the ciphertext has to exist
        // before the request is built. Encrypt first, then let transform close
        // over the result -- that keeps useForm owning the validation errors.
        setCryptoError(null);
        setEncrypting(true);

        const envelope = await buildEnvelope().catch(() => null);
        setEncrypting(false);
        if (!envelope) {
            setCryptoError('Encryption failed, so nothing was sent. The paste is unchanged.');
            return;
        }

        // The server redirects to /p/{slug} and a redirect cannot carry a
        // fragment, so the key -- new or unchanged -- is reattached afterwards.
        const fragmentKey = envelope.fragmentKey;

        transform((formData) => ({
            ...formData,
            language: formData.language || autoDetected || '',
            content: envelope.content,
            // The password was consumed locally to wrap the content key. Sending
            // it would hand the server the one thing it needs to unwrap it, and
            // an encrypted paste stores no password server-side at all.
            password: '',
            remove_password: false,
            encryption_version: envelope.encryption_version,
            encryption_meta: envelope.encryption_meta,
        }));

        // The PUT redirects to /p/{slug}, and a redirect carries no fragment. The
        // view page mounts before onSuccess runs, so stash the key first and let
        // it be claimed on the other side; the write below is the storage-blocked
        // fallback rather than the primary path.
        if (fragmentKey) stashPendingKey(fragmentKey);

        put(`/p/${paste.slug}`, {
            onSuccess: () => {
                if (fragmentKey) writeKeyToFragment(fragmentKey);
            },
        });
    };

    // Anything that re-keys the paste has to be said before the user commits to
    // it, not after the old links have already stopped working.
    const keyChangeWarning = (() => {
        if (!paste.is_encrypted) {
            return data.password
                ? 'Saving encrypts this paste in your browser. From then on its password is '
                    + 'checked here rather than by the server, and the paste cannot be read '
                    + 'without it -- there is no reset.'
                : 'Saving encrypts this paste in your browser and puts its key in the link. '
                    + 'The new link appears in your address bar once the save completes; '
                    + 'without that key the paste can no longer be read.';
        }
        if (data.password) {
            return 'Changing the password re-keys this paste. Links you have already shared '
                + 'will stop working, and the old password will no longer open it.';
        }
        if (data.remove_password) {
            return 'Removing the password re-keys this paste and moves its key into the link. '
                + 'The new link appears in your address bar once the save completes.';
        }
        return null;
    })();

    const effectiveLanguage = data.language || autoDetected;

    const backLink = (
        <div className="mb-4">
            <Link
                href={`/p/${paste.slug}`}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to paste
            </Link>
        </div>
    );

    if (gate.status === 'locked') {
        return (
            <AppLayout>
                <Head title={`Edit: ${paste.title || paste.slug}`} />
                {backLink}
                <div className="flex items-center justify-center py-20">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                                <ShieldAlert className="h-6 w-6 text-destructive" />
                            </div>
                            <CardTitle>Cannot Edit This Paste</CardTitle>
                            <CardDescription>{gate.message}</CardDescription>
                        </CardHeader>
                    </Card>
                </div>
            </AppLayout>
        );
    }

    if (gate.status === 'unlocking') {
        return (
            <AppLayout>
                <Head title={`Edit: ${paste.title || paste.slug}`} />
                {backLink}
                <p className="py-20 text-center text-sm text-muted-foreground">Decrypting paste...</p>
            </AppLayout>
        );
    }

    if (gate.status === 'password') {
        return (
            <AppLayout>
                <Head title={`Edit: ${paste.title || paste.slug}`} />
                {backLink}
                <div className="flex items-center justify-center py-20">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                <Lock className="h-6 w-6 text-primary" />
                            </div>
                            <CardTitle>Password Required</CardTitle>
                            <CardDescription>
                                This paste is encrypted. Enter its password to decrypt it for editing.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={unlock} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="unlock-password">Password</Label>
                                    <Input
                                        id="unlock-password"
                                        type="password"
                                        value={unlockPassword}
                                        onChange={e => setUnlockPassword(e.target.value)}
                                        placeholder="Enter paste password"
                                        autoFocus
                                    />
                                    {unlockError && (
                                        <p className="text-sm text-destructive">{unlockError}</p>
                                    )}
                                </div>
                                <Button type="submit" className="w-full" disabled={unlocking || !unlockPassword}>
                                    {unlocking ? 'Decrypting...' : 'Unlock for Editing'}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </AppLayout>
        );
    }

    return (
        <AppLayout>
            <Head title={`Edit: ${paste.title || paste.slug}`} />

            {backLink}

            <form onSubmit={submit} className="space-y-3">
                {cryptoError && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{cryptoError}</span>
                    </div>
                )}

                {keyChangeWarning && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                            {keyChangeWarning}
                            {needsPasswordChoice && (
                                <>
                                    {' '}
                                    Re-enter the password to keep it, or clear it with the button
                                    next to the password field.
                                </>
                            )}
                        </span>
                    </div>
                )}

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
                            disabled={processing || encrypting || needsPasswordChoice || !data.content.trim()}
                        >
                            {encrypting ? 'Encrypting...' : processing ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </CardContent>
                </Card>
            </form>
        </AppLayout>
    );
}
