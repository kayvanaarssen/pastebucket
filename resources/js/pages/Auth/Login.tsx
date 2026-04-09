import { Head, Link, useForm, router } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Fingerprint } from 'lucide-react';
import { useState } from 'react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';

export default function Login() {
    const { data, setData, post, processing, errors } = useForm({
        email: '',
        password: '',
        remember: false,
    });
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    const [passkeyError, setPasskeyError] = useState<string | null>(null);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        post('/login');
    };

    const loginWithPasskey = async () => {
        setPasskeyError(null);
        setPasskeyLoading(true);
        try {
            const optionsRes = await fetch('/passkey/authenticate/options', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? ''),
                },
            });
            const options = await optionsRes.json();

            const credential = await startAuthentication({ optionsJSON: options });

            const verifyRes = await fetch('/passkey/authenticate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? ''),
                },
                body: JSON.stringify({ credential }),
            });

            const result = await verifyRes.json();
            if (verifyRes.ok && result.redirect) {
                router.visit(result.redirect);
            } else {
                setPasskeyError(result.error || 'Authentication failed.');
            }
        } catch (err: any) {
            if (err.name === 'NotAllowedError') {
                setPasskeyError('Authentication was cancelled.');
            } else {
                setPasskeyError('Passkey authentication failed.');
            }
        } finally {
            setPasskeyLoading(false);
        }
    };

    const supportsPasskeys = typeof window !== 'undefined' && browserSupportsWebAuthn();

    return (
        <AppLayout>
            <Head title="Login" />
            <div className="flex items-center justify-center py-16">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl">Welcome back</CardTitle>
                        <CardDescription>Sign in to your account</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {supportsPasskeys && (
                            <>
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={loginWithPasskey}
                                    disabled={passkeyLoading}
                                >
                                    <Fingerprint className="mr-2 h-4 w-4" />
                                    {passkeyLoading ? 'Authenticating...' : 'Sign in with Passkey'}
                                </Button>
                                {passkeyError && (
                                    <p className="text-sm text-destructive text-center">{passkeyError}</p>
                                )}
                                <div className="relative">
                                    <Separator />
                                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                                        or
                                    </span>
                                </div>
                            </>
                        )}
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={data.email}
                                    onChange={e => setData('email', e.target.value)}
                                    placeholder="you@example.com"
                                    autoFocus
                                />
                                {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={data.password}
                                    onChange={e => setData('password', e.target.value)}
                                />
                                {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                            </div>
                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="remember"
                                    checked={data.remember}
                                    onCheckedChange={(checked) => setData('remember', checked === true)}
                                />
                                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                                    Remember me
                                </Label>
                            </div>
                            <Button type="submit" className="w-full" disabled={processing}>
                                {processing ? 'Signing in...' : 'Sign In'}
                            </Button>
                        </form>
                    </CardContent>
                    <CardFooter className="justify-center">
                        <p className="text-sm text-muted-foreground">
                            Don't have an account?{' '}
                            <Link href="/register" className="text-primary hover:underline">
                                Register
                            </Link>
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </AppLayout>
    );
}
