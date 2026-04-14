import { Head, useForm } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface AcceptInviteProps {
    token: string;
    email: string;
    expires_at: string;
}

export default function AcceptInvite({ token, email, expires_at }: AcceptInviteProps) {
    const form = useForm({
        name: '',
        password: '',
        password_confirmation: '',
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.post(`/invite/${token}`);
    };

    return (
        <AppLayout>
            <Head title="Accept Invite" />
            <div className="flex items-center justify-center py-16">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl">You're invited</CardTitle>
                        <CardDescription>
                            Create your PasteBucket account for <strong>{email}</strong>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={submit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    value={form.data.name}
                                    onChange={e => form.setData('name', e.target.value)}
                                    placeholder="Your name"
                                    autoFocus
                                />
                                {form.errors.name && <p className="text-sm text-destructive">{form.errors.name}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={form.data.password}
                                    onChange={e => form.setData('password', e.target.value)}
                                    autoComplete="new-password"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Minimum 10 characters with uppercase, lowercase, number and symbol.
                                </p>
                                {form.errors.password && <p className="text-sm text-destructive">{form.errors.password}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password_confirmation">Confirm Password</Label>
                                <Input
                                    id="password_confirmation"
                                    type="password"
                                    value={form.data.password_confirmation}
                                    onChange={e => form.setData('password_confirmation', e.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                            <Button type="submit" className="w-full" disabled={form.processing}>
                                {form.processing ? 'Creating account...' : 'Create Account'}
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                                After creating your account you can add a passkey from your profile.
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                                Invite expires {new Date(expires_at).toLocaleString()}
                            </p>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
