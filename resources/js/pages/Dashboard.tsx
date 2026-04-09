import { Head, Link, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Eye, Trash2, ExternalLink, Clock, Globe, Link2, EyeOff, Lock, Flame, Plus, Code2, Fingerprint, KeyRound } from 'lucide-react';
import { useState, useEffect } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PaginatedData, PageProps } from '@/types';

interface DashboardPaste {
    id: number;
    slug: string;
    title: string | null;
    language: string | null;
    visibility: 'public' | 'unlisted' | 'private';
    views: number;
    burn_after_read: boolean;
    password: string | null;
    expires_at: string | null;
    created_at: string;
}

interface DashboardProps extends PageProps {
    pastes: PaginatedData<DashboardPaste>;
}

interface PasskeyInfo {
    id: number;
    name: string;
    last_used_at: string | null;
    created_at: string;
}

function PasskeyManager() {
    const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [passkeyName, setPasskeyName] = useState('');
    const [registering, setRegistering] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const supportsPasskeys = typeof window !== 'undefined' && browserSupportsWebAuthn();

    const fetchPasskeys = async () => {
        const res = await fetch('/passkeys');
        const data = await res.json();
        setPasskeys(data);
        setLoading(false);
    };

    useEffect(() => { fetchPasskeys(); }, []);

    const registerPasskey = async () => {
        if (!passkeyName.trim()) return;
        setError(null);
        setRegistering(true);
        try {
            const optionsRes = await fetch('/passkey/register/options', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? ''),
                },
            });
            const options = await optionsRes.json();

            const credential = await startRegistration({ optionsJSON: options });

            const res = await fetch('/passkey/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? ''),
                },
                body: JSON.stringify({ name: passkeyName, credential }),
            });

            if (res.ok) {
                setRegisterOpen(false);
                setPasskeyName('');
                fetchPasskeys();
                router.reload({ only: ['flash'] });
            } else {
                const data = await res.json();
                setError(data.errors?.error || 'Registration failed.');
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') {
                setError('Registration was cancelled.');
            } else {
                setError('Failed to register passkey.');
            }
        } finally {
            setRegistering(false);
        }
    };

    const deletePasskey = async (id: number) => {
        if (!confirm('Remove this passkey?')) return;
        await fetch(`/passkey/${id}`, {
            method: 'DELETE',
            headers: {
                'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? ''),
            },
        });
        fetchPasskeys();
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    };

    if (!supportsPasskeys) return null;

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Fingerprint className="h-5 w-5" />
                            Passkeys
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            Sign in securely with Face ID, Touch ID, or Windows Hello
                        </p>
                    </div>
                    <Button size="sm" onClick={() => setRegisterOpen(true)}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        Add Passkey
                    </Button>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-sm text-muted-foreground">Loading...</p>
                    ) : passkeys.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {passkeys.map(pk => (
                                <div key={pk.id} className="flex items-center justify-between rounded-lg border p-3">
                                    <div className="flex items-center gap-3">
                                        <KeyRound className="h-4 w-4 text-muted-foreground" />
                                        <div>
                                            <p className="text-sm font-medium">{pk.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                Added {formatDate(pk.created_at)}
                                                {pk.last_used_at && ` \u00b7 Last used ${formatDate(pk.last_used_at)}`}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={() => deletePasskey(pk.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Register Passkey</DialogTitle>
                        <DialogDescription>
                            Give your passkey a name to identify it later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="passkey-name">Passkey Name</Label>
                            <Input
                                id="passkey-name"
                                placeholder="e.g. MacBook Touch ID"
                                value={passkeyName}
                                onChange={e => setPasskeyName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && registerPasskey()}
                            />
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRegisterOpen(false)}>Cancel</Button>
                        <Button onClick={registerPasskey} disabled={registering || !passkeyName.trim()}>
                            <Fingerprint className="mr-1.5 h-4 w-4" />
                            {registering ? 'Registering...' : 'Register'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default function Dashboard({ pastes }: DashboardProps) {
    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    };

    const visibilityIcon = {
        public: <Globe className="h-3.5 w-3.5" />,
        unlisted: <Link2 className="h-3.5 w-3.5" />,
        private: <EyeOff className="h-3.5 w-3.5" />,
    };

    return (
        <AppLayout>
            <Head title="My Pastes" />
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">My Pastes</h1>
                        <p className="text-muted-foreground">{pastes.total} paste{pastes.total !== 1 ? 's' : ''} total</p>
                    </div>
                    <Button asChild>
                        <Link href="/">
                            <Plus className="mr-1.5 h-4 w-4" />
                            New Paste
                        </Link>
                    </Button>
                </div>

                {pastes.data.length === 0 ? (
                    <Card>
                        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                            <Code2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
                            <h3 className="text-lg font-medium">No pastes yet</h3>
                            <p className="mt-1 text-sm text-muted-foreground">Create your first paste to get started</p>
                            <Button className="mt-4" asChild>
                                <Link href="/">Create Paste</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-3">
                        {pastes.data.map(paste => (
                            <Card key={paste.id} className="transition-colors hover:bg-accent/50">
                                <CardContent className="flex items-center justify-between p-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Link
                                                href={`/p/${paste.slug}`}
                                                className="font-medium hover:text-primary truncate"
                                            >
                                                {paste.title || 'Untitled'}
                                            </Link>
                                            <Badge variant="outline" className="shrink-0 gap-1">
                                                {visibilityIcon[paste.visibility]}
                                                {paste.visibility}
                                            </Badge>
                                            {paste.language && (
                                                <Badge variant="secondary" className="shrink-0">{paste.language}</Badge>
                                            )}
                                            {paste.burn_after_read && (
                                                <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                                            )}
                                            {paste.password && (
                                                <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                            )}
                                        </div>
                                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                            <span>{formatDate(paste.created_at)}</span>
                                            <span className="flex items-center gap-1">
                                                <Eye className="h-3 w-3" /> {paste.views}
                                            </span>
                                            {paste.expires_at && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    Expires {formatDate(paste.expires_at)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 ml-4">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                            <Link href={`/p/${paste.slug}`}>
                                                <ExternalLink className="h-4 w-4" />
                                            </Link>
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                            onClick={() => {
                                                if (confirm('Delete this paste?')) {
                                                    router.delete(`/p/${paste.slug}`);
                                                }
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {/* Pagination */}
                        {pastes.last_page > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-4">
                                {pastes.links.map((link, i) => (
                                    <Button
                                        key={i}
                                        variant={link.active ? 'default' : 'outline'}
                                        size="sm"
                                        disabled={!link.url}
                                        asChild={!!link.url}
                                    >
                                        {link.url ? (
                                            <Link href={link.url} dangerouslySetInnerHTML={{ __html: link.label }} />
                                        ) : (
                                            <span dangerouslySetInnerHTML={{ __html: link.label }} />
                                        )}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <PasskeyManager />
            </div>
        </AppLayout>
    );
}
