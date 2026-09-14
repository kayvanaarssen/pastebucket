import { Head, useForm, usePage, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, Copy, Fingerprint, KeyRound, Plus, Terminal, Trash2, User, Lock } from 'lucide-react';
import { useState, useCallback } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { apiFetch } from '@/lib/api';
import type { PageProps } from '@/types';

interface PasskeyInfo {
    id: number;
    name: string;
    last_used_at: string | null;
    created_at: string;
}

interface ApiTokenInfo {
    id: number;
    name: string;
    abilities: string[];
    last_used_at: string | null;
    expires_at: string | null;
    created_at: string;
    is_expired: boolean;
}

interface ApiTokenOptions {
    abilities: { value: string; label: string }[];
    expiry_days: number[];
}

interface ProfileProps extends PageProps {
    passkeys: PasskeyInfo[];
    api_tokens: ApiTokenInfo[];
    api_token_options: ApiTokenOptions;
}

/** Laravel validation answers carry per-field arrays; show the first one. */
function firstError(data: unknown): string | null {
    const body = data as { errors?: Record<string, string[]>; message?: string } | null;
    const fieldErrors = body?.errors ? Object.values(body.errors)[0] : null;
    return fieldErrors?.[0] ?? body?.message ?? null;
}

/**
 * Personal API tokens for the MCP server and CLI.
 *
 * The token is shown exactly once, straight from the create response. The
 * server keeps only a SHA-256 hash, so closing the dialog without copying it
 * means creating a new one -- which the dialog says before it can be closed.
 */
function ApiTokensCard({ tokens, options }: { tokens: ApiTokenInfo[]; options: ApiTokenOptions }) {
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [abilities, setAbilities] = useState<string[]>(() => options.abilities.map(a => a.value));
    const [expiryDays, setExpiryDays] = useState<number>(() =>
        options.expiry_days.includes(90) ? 90 : options.expiry_days[0],
    );
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [revokeId, setRevokeId] = useState<number | null>(null);

    const reloadTokens = () => router.reload({ only: ['api_tokens'] });

    const createToken = async () => {
        if (!name.trim() || abilities.length === 0 || creating) return;
        setCreating(true);
        setError(null);

        try {
            const res = await apiFetch('/profile/tokens', {
                method: 'POST',
                body: JSON.stringify({ name: name.trim(), abilities, expires_in_days: expiryDays }),
            });
            const data = await res.json().catch(() => null);

            if (!res.ok) {
                setError(firstError(data) ?? 'Could not create the token.');
                return;
            }

            setCreateOpen(false);
            setName('');
            setNewToken(data.token as string);
            reloadTokens();
        } catch {
            setError('Could not create the token.');
        } finally {
            setCreating(false);
        }
    };

    const revokeToken = async (id: number) => {
        setError(null);
        try {
            const res = await apiFetch(`/profile/tokens/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                setError(firstError(await res.json().catch(() => null)) ?? 'Could not revoke the token.');
                return;
            }
            setRevokeId(null);
        } catch {
            setError('Could not revoke the token.');
        } finally {
            reloadTokens();
        }
    };

    const copyToken = async () => {
        if (!newToken) return;
        await navigator.clipboard.writeText(newToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const toggleAbility = (value: string, checked: boolean) =>
        setAbilities(current => (checked ? [...new Set([...current, value])] : current.filter(a => a !== value)));

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Terminal className="h-5 w-5" />
                            API Tokens
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                            Let the Pastebucket MCP server or CLI publish encrypted pastes on your behalf.
                            A token never grants access to other users' pastes.
                        </p>
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => { setError(null); setCreateOpen(true); }}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        New Token
                    </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                    {error && !createOpen && <p className="text-sm text-destructive">{error}</p>}
                    {tokens.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No API tokens yet.</p>
                    ) : (
                        tokens.map(token => (
                            <div key={token.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                                <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span className="truncate text-sm font-medium">{token.name}</span>
                                        {token.is_expired && <Badge variant="destructive">Expired</Badge>}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {token.abilities.map(ability => (
                                            <Badge key={ability} variant="secondary" className="font-mono text-[11px]">{ability}</Badge>
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Created {formatDate(token.created_at)}
                                        {token.expires_at && ` · ${token.is_expired ? 'Expired' : 'Expires'} ${formatDate(token.expires_at)}`}
                                        {` · ${token.last_used_at ? `Last used ${formatDate(token.last_used_at)}` : 'Never used'}`}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                    onClick={() => setRevokeId(token.id)}
                                    title="Revoke token"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create API Token</DialogTitle>
                        <DialogDescription>
                            Give only the abilities the integration needs. The token is shown once.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="token-name">Name</Label>
                            <Input
                                id="token-name"
                                placeholder="e.g. Claude Code on my laptop"
                                value={name}
                                maxLength={100}
                                onChange={e => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Abilities</Label>
                            {options.abilities.map(ability => (
                                <label key={ability.value} className="flex items-start gap-2 text-sm">
                                    <Checkbox
                                        className="mt-0.5"
                                        checked={abilities.includes(ability.value)}
                                        onCheckedChange={checked => toggleAbility(ability.value, checked === true)}
                                    />
                                    <span>
                                        <span className="font-mono text-xs">{ability.value}</span>
                                        <span className="block text-muted-foreground">{ability.label}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <Label>Expires after</Label>
                            <Select value={String(expiryDays)} onValueChange={v => setExpiryDays(Number(v))}>
                                <SelectTrigger className="w-[160px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.expiry_days.map(days => (
                                        <SelectItem key={days} value={String(days)}>{days} days</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button onClick={createToken} disabled={creating || !name.trim() || abilities.length === 0}>
                            {creating ? 'Creating...' : 'Create Token'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Not dismissable by clicking outside: the token cannot be shown again. */}
            <Dialog open={newToken !== null} onOpenChange={open => { if (!open) { setNewToken(null); setCopied(false); } }}>
                <DialogContent onInteractOutside={e => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>Copy your new token</DialogTitle>
                        <DialogDescription>
                            Store it as PASTEBUCKET_API_TOKEN for the MCP server or CLI.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Input
                                readOnly
                                value={newToken ?? ''}
                                onFocus={e => e.currentTarget.select()}
                                className="font-mono text-xs"
                            />
                            <Button size="icon" variant="outline" className="shrink-0" onClick={copyToken} title="Copy token">
                                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                            </Button>
                        </div>
                        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            This is the only time the token is shown. Only a hash is stored, so it cannot be recovered later.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => { setNewToken(null); setCopied(false); }}>I have stored it</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={revokeId !== null} onOpenChange={open => { if (!open) setRevokeId(null); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Revoke API Token</DialogTitle>
                        <DialogDescription>
                            Integrations using this token stop working immediately. Pastes already published stay online until they expire.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={() => revokeId !== null && revokeToken(revokeId)}>
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Revoke
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export default function Profile({ passkeys: initialPasskeys, api_tokens, api_token_options }: ProfileProps) {
    const { auth } = usePage<PageProps>().props;

    const profileForm = useForm({
        name: auth.user?.name ?? '',
        email: auth.user?.email ?? '',
    });

    const passwordForm = useForm({
        current_password: '',
        password: '',
        password_confirmation: '',
    });

    const [passkeys, setPasskeys] = useState<PasskeyInfo[]>(initialPasskeys);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [passkeyName, setPasskeyName] = useState('');
    const [registering, setRegistering] = useState(false);
    const [passkeyError, setPasskeyError] = useState<string | null>(null);
    const [deletePasskeyId, setDeletePasskeyId] = useState<number | null>(null);

    const supportsPasskeys = typeof window !== 'undefined' && browserSupportsWebAuthn();

    const submitProfile = (e: React.FormEvent) => {
        e.preventDefault();
        profileForm.put('/profile');
    };

    const submitPassword = (e: React.FormEvent) => {
        e.preventDefault();
        passwordForm.put('/profile/password', {
            onSuccess: () => passwordForm.reset(),
        });
    };

    const fetchPasskeys = async () => {
        const res = await apiFetch('/passkeys');
        setPasskeys(await res.json());
    };

    const registerPasskey = async () => {
        if (!passkeyName.trim()) return;
        setPasskeyError(null);
        setRegistering(true);
        try {
            const optionsRes = await apiFetch('/passkey/register/options', { method: 'POST' });
            const options = await optionsRes.json();
            const credential = await startRegistration({ optionsJSON: options });

            const res = await apiFetch('/passkey/register', {
                method: 'POST',
                body: JSON.stringify({ name: passkeyName, credential }),
            });

            if (res.ok) {
                setRegisterOpen(false);
                setPasskeyName('');
                fetchPasskeys();
            } else {
                const data = await res.json().catch(() => null);
                setPasskeyError(data?.error || data?.message || 'Registration failed.');
            }
        } catch (err: any) {
            setPasskeyError(err.name === 'NotAllowedError' ? 'Registration was cancelled.' : 'Failed to register passkey.');
        } finally {
            setRegistering(false);
        }
    };

    const deletePasskey = async (id: number) => {
        setPasskeyError(null);
        try {
            const res = await apiFetch(`/passkey/${id}`, { method: 'DELETE' });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                setPasskeyError(data?.error || data?.message || 'Failed to remove passkey.');
                return;
            }

            setDeletePasskeyId(null);
        } catch {
            setPasskeyError('Failed to remove passkey.');
        } finally {
            fetchPasskeys();
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
    };

    return (
        <AppLayout>
            <Head title="Profile" />
            <div className="space-y-6 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold">Profile Settings</h1>

                {/* Profile info */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Account Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submitProfile} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    value={profileForm.data.name}
                                    onChange={e => profileForm.setData('name', e.target.value)}
                                />
                                {profileForm.errors.name && <p className="text-sm text-destructive">{profileForm.errors.name}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={profileForm.data.email}
                                    onChange={e => profileForm.setData('email', e.target.value)}
                                />
                                {profileForm.errors.email && <p className="text-sm text-destructive">{profileForm.errors.email}</p>}
                            </div>
                            <Button type="submit" disabled={profileForm.processing}>
                                {profileForm.processing ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Change password */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Lock className="h-5 w-5" />
                            Change Password
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submitPassword} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="current_password">Current Password</Label>
                                <Input
                                    id="current_password"
                                    type="password"
                                    value={passwordForm.data.current_password}
                                    onChange={e => passwordForm.setData('current_password', e.target.value)}
                                />
                                {passwordForm.errors.current_password && <p className="text-sm text-destructive">{passwordForm.errors.current_password}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="new_password">New Password</Label>
                                <Input
                                    id="new_password"
                                    type="password"
                                    value={passwordForm.data.password}
                                    onChange={e => passwordForm.setData('password', e.target.value)}
                                />
                                {passwordForm.errors.password && <p className="text-sm text-destructive">{passwordForm.errors.password}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password_confirmation">Confirm New Password</Label>
                                <Input
                                    id="password_confirmation"
                                    type="password"
                                    value={passwordForm.data.password_confirmation}
                                    onChange={e => passwordForm.setData('password_confirmation', e.target.value)}
                                />
                            </div>
                            <Button type="submit" disabled={passwordForm.processing}>
                                {passwordForm.processing ? 'Updating...' : 'Update Password'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* Passkeys */}
                {supportsPasskeys && (
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Fingerprint className="h-5 w-5" />
                                    Passkeys
                                </CardTitle>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Sign in with Face ID, Touch ID, or Windows Hello
                                </p>
                            </div>
                            <Button size="sm" onClick={() => setRegisterOpen(true)}>
                                <Plus className="mr-1.5 h-4 w-4" />
                                Add Passkey
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {passkeys.length === 0 ? (
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
                                                onClick={() => setDeletePasskeyId(pk.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                <ApiTokensCard tokens={api_tokens} options={api_token_options} />
            </div>

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
                        {passkeyError && <p className="text-sm text-destructive">{passkeyError}</p>}
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

            <Dialog open={!!deletePasskeyId} onOpenChange={() => setDeletePasskeyId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Remove Passkey</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to remove this passkey? You won't be able to sign in with it anymore.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeletePasskeyId(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => deletePasskeyId && deletePasskey(deletePasskeyId)}
                        >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
