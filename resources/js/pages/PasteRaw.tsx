import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Copy, Download, Lock, ShieldAlert } from 'lucide-react';
import {
    DecryptionError,
    decryptWithFragmentKey,
    decryptWithPassword,
    isCryptoAvailable,
    readKeyFromFragment,
} from '@/lib/crypto';
import type { EncryptionMeta } from '@/types';

interface PasteRawProps {
    paste: {
        slug: string;
        title: string | null;
        /** Ciphertext. It is never rendered — a failed decrypt shows an error instead. */
        content: string;
        encryption_version: number | null;
        encryption_meta: EncryptionMeta | null;
        is_password_protected: boolean;
    };
}

/**
 * The raw view of an encrypted paste. The server has no plaintext to serve as
 * text/plain, so the browser decrypts here and prints the result with as little
 * chrome as the old response had.
 */
export default function PasteRaw({ paste }: PasteRawProps) {
    const meta = paste.encryption_meta;

    const [plaintext, setPlaintext] = useState<string | null>(null);
    const [needsPassword, setNeedsPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // DecryptionError messages are written for the viewer; anything else is a
    // bug or a hostile payload, so it gets the generic text.
    const describeFailure = (err: unknown): string =>
        err instanceof DecryptionError ? err.message : 'Unable to decrypt this paste.';

    useEffect(() => {
        if (!isCryptoAvailable()) {
            setError(
                'This browser cannot decrypt pastes. WebCrypto is only available over HTTPS or on localhost.',
            );
            return;
        }

        if (!meta) {
            setError('This paste is missing its encryption parameters and can no longer be read.');
            return;
        }

        if (meta.mode === 'password') {
            setNeedsPassword(true);
            return;
        }

        const fragmentKey = readKeyFromFragment();
        if (!fragmentKey) {
            setError(
                'The decryption key is missing from this link. Raw view needs the full link including the part after the "#", which is never sent to the server.',
            );
            return;
        }

        decryptWithFragmentKey(paste.content, meta, fragmentKey)
            .then(setPlaintext)
            .catch(err => setError(describeFailure(err)));
        // Props are fixed for the lifetime of this page; a re-run would only
        // re-decrypt the same ciphertext.
    }, []);

    const unlock = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!meta) return;

        setUnlocking(true);
        setError(null);

        try {
            setPlaintext(await decryptWithPassword(paste.content, meta, password));
            setNeedsPassword(false);
        } catch (err) {
            setError(describeFailure(err));
        } finally {
            setUnlocking(false);
        }
    };

    const copyToClipboard = async () => {
        if (plaintext === null) return;
        await navigator.clipboard.writeText(plaintext);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const download = () => {
        if (plaintext === null) return;

        const url = URL.createObjectURL(new Blob([plaintext], { type: 'text/plain' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${paste.slug}.txt`;
        link.click();
        // Safari cancels an in-flight download if the object URL dies in the
        // same tick, so let the click settle first.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const headTitle = `${paste.title || paste.slug} (raw)`;

    if (needsPassword) {
        return (
            <>
                <Head title={headTitle} />
                <div className="flex min-h-screen items-center justify-center p-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                <Lock className="h-6 w-6 text-primary" />
                            </div>
                            <CardTitle>Password Required</CardTitle>
                            <CardDescription>
                                {paste.title ? `"${paste.title}" is` : 'This paste is'} encrypted.
                                The password unlocks it in your browser and is never sent.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={unlock} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="password">Password</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="Enter paste password"
                                        autoFocus
                                    />
                                    {error && <p className="text-sm text-destructive">{error}</p>}
                                </div>
                                <Button type="submit" className="w-full" disabled={unlocking}>
                                    {unlocking ? 'Decrypting...' : 'Decrypt Paste'}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Head title={headTitle} />
                <div className="flex min-h-screen items-center justify-center p-4">
                    <Card className="w-full max-w-md">
                        <CardHeader className="text-center">
                            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                                <ShieldAlert className="h-6 w-6 text-destructive" />
                            </div>
                            <CardTitle>Unable to Decrypt</CardTitle>
                            <CardDescription>{error}</CardDescription>
                        </CardHeader>
                    </Card>
                </div>
            </>
        );
    }

    if (plaintext === null) {
        return (
            <>
                <Head title={headTitle} />
                <p className="p-4 font-mono text-sm text-muted-foreground">Decrypting...</p>
            </>
        );
    }

    return (
        <>
            <Head title={headTitle} />
            <div className="sticky top-0 flex justify-end gap-1 bg-background/80 p-2 backdrop-blur-sm">
                <Button variant="ghost" size="sm" onClick={copyToClipboard}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied!' : 'Copy'}
                </Button>
                <Button variant="ghost" size="sm" onClick={download}>
                    <Download className="h-4 w-4" />
                    Download
                </Button>
            </div>
            {/* Wrapping rather than overflowing keeps a single long line from
                pushing the whole page sideways. */}
            <pre className="whitespace-pre-wrap break-words px-4 pb-4 font-mono text-sm">{plaintext}</pre>
        </>
    );
}
