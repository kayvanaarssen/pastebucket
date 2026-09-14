import { Head, Link } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Ban, Clock, LinkIcon } from 'lucide-react';

interface PasteUnavailableProps {
    reason: 'expired' | 'revoked' | 'not_found';
    /** When it expired or was revoked, if the server still knew. */
    at: string | null;
}

/**
 * Every dead paste link lands here, whichever route it came in by. The wording
 * is written for a customer who was sent a link, not for the person who made
 * it: say what happened, when, and what to do next.
 */
export default function PasteUnavailable({ reason, at }: PasteUnavailableProps) {
    const when = at
        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(at))
        : null;

    const copy = {
        expired: {
            icon: <Clock className="h-6 w-6 text-muted-foreground" />,
            title: 'This link has expired',
            body: when
                ? `It was available until ${when}. Expired links cannot be reopened.`
                : 'Its availability period has ended. Expired links cannot be reopened.',
        },
        revoked: {
            icon: <Ban className="h-6 w-6 text-destructive" />,
            title: 'This link has been withdrawn',
            body: when
                ? `The sender revoked it on ${when}. Its content has been removed.`
                : 'The sender revoked it and its content has been removed.',
        },
        not_found: {
            icon: <LinkIcon className="h-6 w-6 text-muted-foreground" />,
            title: 'This link is not valid',
            body: 'Nothing was found at this address. The link may be incomplete, or it may have expired and been removed.',
        },
    }[reason];

    return (
        <AppLayout>
            <Head title={copy.title}>
                <meta name="robots" content="noindex, nofollow" />
            </Head>
            <div className="flex items-center justify-center py-16 sm:py-24">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                            {copy.icon}
                        </div>
                        <CardTitle>{copy.title}</CardTitle>
                        <CardDescription>{copy.body}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center gap-3 text-center">
                        <p className="text-sm text-muted-foreground">
                            If you still need this content, ask the person who shared it for a new link.
                        </p>
                        <Button variant="outline" size="sm" asChild>
                            <Link href="/">Go to PasteBucket</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
