import { Head, useForm, usePage, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Fingerprint, KeyRound, Plus, Trash2, User, Lock } from 'lucide-react';
import { useState } from 'react';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PageProps } from '@/types';

interface PasskeyInfo {
    id: number;
    name: string;
    last_used_at: string | null;
    created_at: string;
}

interface ProfileProps extends PageProps {
    passkeys: PasskeyInfo[];
}

export default function Profile({ passkeys: initialPasskeys }: ProfileProps) {
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
        const res = await fetch('/passkeys');
        setPasskeys(await res.json());
    };

    const registerPasskey = async () => {
        if (!passkeyName.trim()) return;
        setPasskeyError(null);
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
            } else {
                const data = await res.json();
                setPasskeyError(data.errors?.error || 'Registration failed.');
            }
        } catch (err: any) {
            setPasskeyError(err.name === 'NotAllowedError' ? 'Registration was cancelled.' : 'Failed to register passkey.');
        } finally {
            setRegistering(false);
        }
    };

    const deletePasskey = async (id: number) => {
        if (!confirm('Remove this passkey?')) return;
        await fetch(`/passkey/${id}`, {
            method: 'DELETE',
            headers: { 'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '') },
        });
        fetchPasskeys();
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
                )}
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
        </AppLayout>
    );
}
