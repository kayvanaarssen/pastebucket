import { Head, Link, router, useForm } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Trash2, Users, FileText, Activity, TrendingUp, Search, ExternalLink, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { PaginatedData, PageProps } from '@/types';

interface AdminPaste {
    id: number;
    slug: string;
    title: string | null;
    language: string | null;
    visibility: string;
    views: number;
    created_at: string;
    expires_at: string | null;
    user: { id: number; name: string; email: string } | null;
}

interface AdminDashboardProps extends PageProps {
    pastes: PaginatedData<AdminPaste>;
    stats: {
        total_pastes: number;
        total_users: number;
        active_pastes: number;
        pastes_today: number;
    };
    search: string | null;
    registration: {
        enabled: boolean;
        until: string | null;
    };
}

export default function AdminDashboard({ pastes, stats, search, registration }: AdminDashboardProps) {
    const [deletePasteSlug, setDeletePasteSlug] = useState<string | null>(null);
    const [regDuration, setRegDuration] = useState<string>('');
    const searchForm = useForm({ search: search || '' });

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        router.get('/admin', { search: searchForm.data.search }, { preserveState: true });
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    };

    return (
        <AppLayout>
            <Head title="Admin Dashboard" />
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Admin Dashboard</h1>
                    <Button asChild>
                        <Link href="/admin/users">
                            <Users className="mr-1.5 h-4 w-4" />
                            Manage Users
                        </Link>
                    </Button>
                </div>

                {/* Stats */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pastes</CardTitle>
                            <FileText className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.total_pastes}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Active Pastes</CardTitle>
                            <Activity className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.active_pastes}</div>
                        </CardContent>
                    </Card>
                    <Link href="/admin/users" className="block">
                        <Card className="transition-colors hover:border-primary/50">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
                                <Users className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.total_users}</div>
                            </CardContent>
                        </Card>
                    </Link>
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stats.pastes_today}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Registration Control */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <UserPlus className="h-5 w-5" />
                                Registration
                            </CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">
                                {registration.enabled ? (
                                    registration.until ? (
                                        <>Open until {new Date(registration.until).toLocaleString()}</>
                                    ) : (
                                        'Open indefinitely'
                                    )
                                ) : (
                                    'Currently disabled'
                                )}
                            </p>
                        </div>
                        <Badge variant={registration.enabled ? 'default' : 'secondary'}>
                            {registration.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-3">
                            {registration.enabled ? (
                                <Button
                                    variant="outline"
                                    onClick={() => router.post('/admin/registration', { enabled: false, duration: null })}
                                >
                                    Disable Registration
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        onClick={() => router.post('/admin/registration', { enabled: true, duration: null })}
                                    >
                                        Enable Permanently
                                    </Button>
                                    <div className="flex items-end gap-2">
                                        <div className="flex flex-col gap-1">
                                            <Label className="text-xs">Duration</Label>
                                            <Select value={regDuration} onValueChange={setRegDuration}>
                                                <SelectTrigger className="w-[160px]">
                                                    <SelectValue placeholder="Select duration" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="15">15 minutes</SelectItem>
                                                    <SelectItem value="30">30 minutes</SelectItem>
                                                    <SelectItem value="60">1 hour</SelectItem>
                                                    <SelectItem value="120">2 hours</SelectItem>
                                                    <SelectItem value="360">6 hours</SelectItem>
                                                    <SelectItem value="720">12 hours</SelectItem>
                                                    <SelectItem value="1440">24 hours</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Button
                                            variant="secondary"
                                            disabled={!regDuration}
                                            onClick={() => {
                                                router.post('/admin/registration', { enabled: true, duration: parseInt(regDuration) });
                                                setRegDuration('');
                                            }}
                                        >
                                            Enable Temporarily
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Search */}
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search by title, slug, or author..."
                            value={searchForm.data.search}
                            onChange={e => searchForm.setData('search', e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <Button type="submit">Search</Button>
                </form>

                {/* Pastes table */}
                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="px-4 py-3 text-left font-medium">Title</th>
                                        <th className="px-4 py-3 text-left font-medium">Author</th>
                                        <th className="px-4 py-3 text-left font-medium">Visibility</th>
                                        <th className="px-4 py-3 text-left font-medium">Views</th>
                                        <th className="px-4 py-3 text-left font-medium">Created</th>
                                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pastes.data.map(paste => (
                                        <tr key={paste.id} className="border-b last:border-0">
                                            <td className="px-4 py-3">
                                                <Link href={`/p/${paste.slug}`} className="hover:text-primary font-medium">
                                                    {paste.title || paste.slug}
                                                </Link>
                                                {paste.language && (
                                                    <Badge variant="secondary" className="ml-2 text-xs">{paste.language}</Badge>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">
                                                {paste.user?.name || 'Anonymous'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="outline">{paste.visibility}</Badge>
                                            </td>
                                            <td className="px-4 py-3">{paste.views}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{formatDate(paste.created_at)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                                        <Link href={`/p/${paste.slug}`}>
                                                            <ExternalLink className="h-4 w-4" />
                                                        </Link>
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                        onClick={() => setDeletePasteSlug(paste.slug)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Pagination */}
                {pastes.last_page > 1 && (
                    <div className="flex items-center justify-center gap-2">
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

            <Dialog open={!!deletePasteSlug} onOpenChange={() => setDeletePasteSlug(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Paste</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this paste? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeletePasteSlug(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deletePasteSlug) router.delete(`/admin/paste/${deletePasteSlug}`);
                                setDeletePasteSlug(null);
                            }}
                        >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </AppLayout>
    );
}
