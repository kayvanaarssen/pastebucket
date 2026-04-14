import { Head, Link } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

interface InviteInvalidProps {
    reason: 'not_found' | 'used' | 'expired';
}

const messages = {
    not_found: 'This invite link is invalid or does not exist.',
    used: 'This invite has already been used.',
    expired: 'This invite has expired. Ask an administrator for a new one.',
};

export default function InviteInvalid({ reason }: InviteInvalidProps) {
    return (
        <AppLayout>
            <Head title="Invalid Invite" />
            <div className="flex items-center justify-center py-16">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="flex justify-center mb-2">
                            <AlertCircle className="h-10 w-10 text-destructive" />
                        </div>
                        <CardTitle className="text-2xl">Invite Invalid</CardTitle>
                        <CardDescription>{messages[reason]}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Button asChild>
                            <Link href="/login">Back to Login</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
