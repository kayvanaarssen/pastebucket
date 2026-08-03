import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { CodeHighlighter } from '@/components/CodeHighlighter';
import { MarkdownPreview } from '@/components/MarkdownPreview';
import { Copy, Check, Trash2, Clock, Eye, Lock, Flame, Globe, Link2, EyeOff, Code2, FileText, LinkIcon, BookOpen, Pencil, Loader2, KeyRound, AlertTriangle, Unlock } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { usePage } from '@inertiajs/react';
import { apiFetch } from '@/lib/api';
import {
    buildShareUrl,
    consumePendingKey,
    decryptWithFragmentKey,
    decryptWithPassword,
    DecryptionError,
    isCryptoAvailable,
    readKeyFromFragment,
    writeKeyToFragment,
} from '@/lib/crypto';
import type { Paste, PageProps } from '@/types';

interface PasteViewProps extends PageProps {
    paste: Paste;
}

/**
 * Everything standing between the viewer and the plaintext. Legacy pastes start
 * out `ready`; encrypted ones have to get there.
 */
type DecryptionState =
    | { status: 'decrypting' }
    | { status: 'ready'; content: string }
    | { status: 'needs-password'; pending: boolean; error: string | null }
    | { status: 'missing-key' }
    | { status: 'failed'; message: string };

function initialDecryptionState(paste: Paste): DecryptionState {
    // Legacy pastes predate end-to-end encryption and arrive as plaintext.
    if (!paste.is_encrypted) return { status: 'ready', content: paste.content };

    if (!isCryptoAvailable()) {
        return {
            status: 'failed',
            message: 'This browser cannot decrypt pastes. WebCrypto is only available over a secure (https) connection.',
        };
    }

    if (!paste.encryption_meta) {
        return { status: 'failed', message: 'This paste is missing the parameters needed to decrypt it.' };
    }

    // Password mode has to wait on the viewer; fragment mode can start at once.
    return paste.encryption_meta.mode === 'password'
        ? { status: 'needs-password', pending: false, error: null }
        : { status: 'decrypting' };
}

/** DecryptionError already carries a viewer-facing message; nothing else does. */
function describeFailure(error: unknown): string {
    return error instanceof DecryptionError
        ? error.message
        : 'Something went wrong while decrypting this paste.';
}

/**
 * Recover the key for a paste this tab just created.
 *
 * The create flow attaches the key with history.replaceState only after Inertia
 * has swapped this page in, so the fragment is still empty on mount and
 * replaceState fires no event to wait on. The create page therefore stashes the
 * key before navigating; claiming it here is synchronous and cannot race. The
 * fragment is then filled in so reloads and copied links keep working.
 */
function claimKeyForNewPaste(): string | null {
    const key = consumePendingKey();
    if (key) writeKeyToFragment(key);
    return key;
}

export default function PasteView({ paste }: PasteViewProps) {
    const [copied, setCopied] = useState(false);
    const [urlCopied, setUrlCopied] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [showFormatted, setShowFormatted] = useState(paste.language === 'markdown');
    const [decryption, setDecryption] = useState<DecryptionState>(() => initialDecryptionState(paste));
    const [fragmentKey, setFragmentKey] = useState<string | null>(
        () => readKeyFromFragment() ?? claimKeyForNewPaste(),
    );
    const [password, setPassword] = useState('');
    const { flash } = usePage<PageProps>().props;
    const autoCopied = useRef(false);
    const burnAcked = useRef(false);

    // The fragment is the whole secret. A share URL without it is a link nobody
    // can ever decrypt, so every outbound URL is built through buildShareUrl.
    const shareUrl = buildShareUrl(paste.slug, fragmentKey);
    const rawUrl = fragmentKey ? `/p/${paste.slug}/raw#k=${fragmentKey}` : `/p/${paste.slug}/raw`;
    // The edit page cannot decrypt without the key either, and refuses to open a
    // blank editor over content it can't read -- so this link has to carry it too.
    const editUrl = fragmentKey ? `/p/${paste.slug}/edit#k=${fragmentKey}` : `/p/${paste.slug}/edit`;

    const plaintext = decryption.status === 'ready' ? decryption.content : null;

    // Auto-copy URL to clipboard when paste is just created
    useEffect(() => {
        if (!flash.just_created || autoCopied.current) return;

        // Hold off until the key has landed in the fragment, otherwise the very
        // first thing we hand the author is an undecryptable link.
        if (paste.is_encrypted && paste.encryption_meta?.mode === 'fragment' && !fragmentKey) return;

        autoCopied.current = true;
        navigator.clipboard.writeText(shareUrl).then(() => {
            setUrlCopied(true);
            setTimeout(() => setUrlCopied(false), 3000);
        });
    }, [flash.just_created, fragmentKey]);

    // Fragment mode asks the viewer for nothing -- the key is already in the URL.
    useEffect(() => {
        const meta = paste.encryption_meta;
        if (!paste.is_encrypted || !meta || meta.mode !== 'fragment' || !isCryptoAvailable()) return;

        let active = true;

        (async () => {
            // Storage-blocked tabs fall through to the create page's own fragment
            // write, which lands shortly after mount. Only a paste created in
            // this tab can be waiting on it, so nothing else pays for the wait.
            let key = fragmentKey ?? readKeyFromFragment();
            for (let attempt = 0; !key && flash.just_created && attempt < 20; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 50));
                key = readKeyFromFragment();
            }
            if (!active) return;

            if (!key) {
                setDecryption({ status: 'missing-key' });
                return;
            }

            setFragmentKey(key);

            try {
                const content = await decryptWithFragmentKey(paste.content, meta, key);
                if (active) setDecryption({ status: 'ready', content });
            } catch (error) {
                if (active) setDecryption({ status: 'failed', message: describeFailure(error) });
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    // The server cannot tell whether a viewer held a usable key, so it leaves
    // encrypted burn pastes alive until this ACK says one was actually read.
    // Exactly once, and never before a successful decrypt.
    useEffect(() => {
        if (decryption.status !== 'ready') return;
        if (!paste.is_encrypted || !paste.burn_after_read || paste.is_owner) return;
        if (burnAcked.current) return;

        burnAcked.current = true;
        // Best effort: a failed ACK leaves the paste alive for the next reader,
        // which beats nagging someone who has already read it.
        apiFetch(`/p/${paste.slug}/burn`, { method: 'POST' }).catch(() => {});
    }, [decryption.status]);

    const submitPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        const meta = paste.encryption_meta;
        if (!meta || decryption.status !== 'needs-password' || decryption.pending) return;

        setDecryption({ status: 'needs-password', pending: true, error: null });

        try {
            // Entirely local: the password never leaves the browser, so a wrong
            // guess costs a key derivation instead of a server round-trip.
            const content = await decryptWithPassword(paste.content, meta, password);
            setDecryption({ status: 'ready', content });
        } catch (error) {
            setDecryption({ status: 'needs-password', pending: false, error: describeFailure(error) });
        }
    };

    const copyToClipboard = async () => {
        if (!plaintext) return;
        await navigator.clipboard.writeText(plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const copyUrl = async () => {
        await navigator.clipboard.writeText(shareUrl);
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

    const lineCount = plaintext !== null ? plaintext.split('\n').length : null;

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
                            {/* Legacy pastes were stored before end-to-end encryption existed.
                                Worth stating plainly, not worth alarming anyone over. */}
                            {!paste.is_encrypted && (
                                <Badge
                                    variant="outline"
                                    className="gap-1 font-normal text-muted-foreground"
                                    title="Created before end-to-end encryption, so this paste is stored in plain text on the server."
                                >
                                    <Unlock className="h-3 w-3" />
                                    Stored unencrypted
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
                                <TooltipContent>
                                    {fragmentKey ? 'Copy paste URL, including its decryption key' : 'Copy paste URL to clipboard'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="outline" size="sm" onClick={copyToClipboard} disabled={plaintext === null}>
                                        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                                        {copied ? 'Copied!' : 'Copy'}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy paste content</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Button variant="outline" size="sm" asChild>
                            <a href={rawUrl} target="_blank">
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
                                    <Link href={editUrl}>
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
                    {lineCount !== null && <span>{lineCount} line{lineCount !== 1 ? 's' : ''}</span>}
                    {paste.expires_at && (
                        <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Expires in {timeUntilExpiry(paste.expires_at)}
                        </span>
                    )}
                </div>

                {/* Code block / Markdown preview -- never the ciphertext */}
                {decryption.status === 'ready' && (
                    <div className="overflow-x-auto rounded-lg border">
                        {paste.language === 'markdown' && showFormatted ? (
                            <MarkdownPreview content={decryption.content} />
                        ) : (
                            <CodeHighlighter code={decryption.content} language={paste.language ?? undefined} />
                        )}
                    </div>
                )}

                {decryption.status === 'decrypting' && (
                    <div className="flex items-center justify-center gap-2 rounded-lg border py-16 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Decrypting...
                    </div>
                )}

                {decryption.status === 'needs-password' && (
                    <form onSubmit={submitPassword} className="mx-auto w-full max-w-md space-y-4 rounded-lg border p-8">
                        <div className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                <Lock className="h-6 w-6 text-primary" />
                            </div>
                            <h2 className="font-semibold">Password Required</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                This paste is encrypted. It unlocks here in your browser -- the password is never sent to the server.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="paste-password">Password</Label>
                            <Input
                                id="paste-password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="Enter paste password"
                                autoFocus
                            />
                            {decryption.error && (
                                <p className="text-sm text-destructive">{decryption.error}</p>
                            )}
                        </div>
                        <Button type="submit" className="w-full" disabled={decryption.pending || password.length === 0}>
                            {decryption.pending ? 'Decrypting...' : 'Unlock Paste'}
                        </Button>
                    </form>
                )}

                {decryption.status === 'missing-key' && (
                    <div className="mx-auto w-full max-w-md rounded-lg border p-8 text-center">
                        <KeyRound className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
                        <h2 className="font-semibold">This link is missing its decryption key</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            The key rides in the <code className="rounded bg-muted px-1 py-0.5">#</code> part of the link and never
                            reaches the server, so it is lost whenever a link gets trimmed or retyped. Ask whoever shared this paste
                            for the complete URL.
                        </p>
                    </div>
                )}

                {decryption.status === 'failed' && (
                    <div className="mx-auto w-full max-w-md rounded-lg border p-8 text-center">
                        <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-destructive" />
                        <h2 className="font-semibold">Unable to decrypt this paste</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{decryption.message}</p>
                    </div>
                )}
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
