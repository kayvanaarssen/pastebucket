import { Head, router, useForm } from '@inertiajs/react';
import AppLayout from '@/layouts/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trash2, Shield, ShieldOff, Plus, Pencil, Mail, Copy, X } from 'lucide-react';
import { useState } from 'react';
import type { PaginatedData, PageProps } from '@/types';
import { Link } from '@inertiajs/react';

interface AdminUser {
    id: number;
    name: string;
    email: string;
    role: 'user' | 'admin';
    pastes_count: number;
    created_at: string;
}

interface Invite {
    id: number;
    email: string;
    role: 'user' | 'admin';
    expires_at: string;
    created_at: string;
    invited_by: string | null;
    url: string;
}

interface UsersProps extends PageProps {
    users: PaginatedData<AdminUser>;
    invites: Invite[];
}

function UserDialog({ user, open, onOpenChange }: {
    user: AdminUser | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const isEditing = !!user;
    const form = useForm({
        name: user?.name ?? '',
        email: user?.email ?? '',
        password: '',
        role: user?.role ?? 'user' as 'user' | 'admin',
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isEditing) {
            form.put(`/admin/user/${user.id}`, {
                onSuccess: () => onOpenChange(false),
            });
        } else {
            form.post('/admin/user', {
                onSuccess: () => onOpenChange(false),
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{isEditing ? 'Edit User' : 'Create User'}</DialogTitle>
                    <DialogDescription>
                        {isEditing ? 'Update user details.' : 'Add a new user to the system.'}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            value={form.data.name}
                            onChange={e => form.setData('name', e.target.value)}
                        />
                        {form.errors.name && <p className="text-sm text-destructive">{form.errors.name}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={form.data.email}
                            onChange={e => form.setData('email', e.target.value)}
                        />
                        {form.errors.email && <p className="text-sm text-destructive">{form.errors.email}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">
                            Password {isEditing && <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>}
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            value={form.data.password}
                            onChange={e => form.setData('password', e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Minimum 10 characters with uppercase, lowercase, number and symbol.
                        </p>
                        {form.errors.password && <p className="text-sm text-destructive">{form.errors.password}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select
                            value={form.data.role}
                            onValueChange={v => form.setData('role', v as 'user' | 'admin')}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                        {form.errors.role && <p className="text-sm text-destructive">{form.errors.role}</p>}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.processing}>
                            {form.processing ? 'Saving...' : isEditing ? 'Save Changes' : 'Create User'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const form = useForm({
        email: '',
        role: 'user' as 'user' | 'admin',
        expiry_hours: 48,
    });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        form.post('/admin/invite', {
            onSuccess: () => {
                form.reset();
                onOpenChange(false);
            },
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Invite</DialogTitle>
                    <DialogDescription>
                        Generate a secure invite link the user can use to set their own password.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="invite-email">Email</Label>
                        <Input
                            id="invite-email"
                            type="email"
                            value={form.data.email}
                            onChange={e => form.setData('email', e.target.value)}
                            placeholder="user@example.com"
                        />
                        {form.errors.email && <p className="text-sm text-destructive">{form.errors.email}</p>}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="invite-role">Role</Label>
                        <Select
                            value={form.data.role}
                            onValueChange={v => form.setData('role', v as 'user' | 'admin')}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="invite-expiry">Valid for</Label>
                        <Select
                            value={String(form.data.expiry_hours)}
                            onValueChange={v => form.setData('expiry_hours', parseInt(v))}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="1">1 hour</SelectItem>
                                <SelectItem value="6">6 hours</SelectItem>
                                <SelectItem value="24">24 hours</SelectItem>
                                <SelectItem value="48">2 days</SelectItem>
                                <SelectItem value="168">7 days</SelectItem>
                                <SelectItem value="720">30 days</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={form.processing}>
                            {form.processing ? 'Creating...' : 'Create Invite'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default function Users({ users, invites }: UsersProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [deleteUserId, setDeleteUserId] = useState<{ id: number; name: string } | null>(null);
    const [copiedId, setCopiedId] = useState<number | null>(null);

    const copyInviteUrl = (invite: Invite) => {
        navigator.clipboard.writeText(invite.url);
        setCopiedId(invite.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    };

    const openCreate = () => {
        setEditingUser(null);
        setDialogOpen(true);
    };

    const openEdit = (user: AdminUser) => {
        setEditingUser(user);
        setDialogOpen(true);
    };

    return (
        <AppLayout>
            <Head title="Manage Users" />
            <div className="space-y-6">
                <div className="flex items-center justify-between flex-wrap gap-2">
                    <h1 className="text-2xl font-bold">Manage Users</h1>
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="secondary" onClick={() => setInviteDialogOpen(true)}>
                            <Mail className="mr-1.5 h-4 w-4" />
                            Create Invite
                        </Button>
                        <Button onClick={openCreate}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Create User
                        </Button>
                        <Button variant="outline" asChild>
                            <Link href="/admin">Back to Admin</Link>
                        </Button>
                    </div>
                </div>

                {invites.length > 0 && (
                    <Card>
                        <CardContent className="p-0">
                            <div className="px-4 py-3 border-b bg-muted/30">
                                <h2 className="text-sm font-semibold">Pending Invites ({invites.length})</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b bg-muted/50">
                                            <th className="px-4 py-3 text-left font-medium">Email</th>
                                            <th className="px-4 py-3 text-left font-medium">Role</th>
                                            <th className="px-4 py-3 text-left font-medium">Invited By</th>
                                            <th className="px-4 py-3 text-left font-medium">Expires</th>
                                            <th className="px-4 py-3 text-right font-medium">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invites.map(invite => (
                                            <tr key={invite.id} className="border-b last:border-0">
                                                <td className="px-4 py-3 font-medium">{invite.email}</td>
                                                <td className="px-4 py-3">
                                                    <Badge variant={invite.role === 'admin' ? 'default' : 'secondary'}>
                                                        {invite.role}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-3 text-muted-foreground">{invite.invited_by ?? '—'}</td>
                                                <td className="px-4 py-3 text-muted-foreground">{formatDate(invite.expires_at)}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => copyInviteUrl(invite)}
                                                            title="Copy invite link"
                                                        >
                                                            <Copy className={`h-4 w-4 ${copiedId === invite.id ? 'text-green-600' : ''}`} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-destructive hover:text-destructive"
                                                            onClick={() => router.delete(`/admin/invite/${invite.id}`)}
                                                            title="Revoke invite"
                                                        >
                                                            <X className="h-4 w-4" />
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
                )}

                <Card>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b bg-muted/50">
                                        <th className="px-4 py-3 text-left font-medium">Name</th>
                                        <th className="px-4 py-3 text-left font-medium">Email</th>
                                        <th className="px-4 py-3 text-left font-medium">Role</th>
                                        <th className="px-4 py-3 text-left font-medium">Pastes</th>
                                        <th className="px-4 py-3 text-left font-medium">Joined</th>
                                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.data.map(user => (
                                        <tr key={user.id} className="border-b last:border-0">
                                            <td className="px-4 py-3 font-medium">{user.name}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                                            <td className="px-4 py-3">
                                                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                                                    {user.role}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3">{user.pastes_count}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{formatDate(user.created_at)}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => openEdit(user)}
                                                        title="Edit user"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                        onClick={() => {
                                                            router.post(`/admin/user/${user.id}/toggle-admin`);
                                                        }}
                                                        title={user.role === 'admin' ? 'Remove admin' : 'Make admin'}
                                                    >
                                                        {user.role === 'admin' ? (
                                                            <ShieldOff className="h-4 w-4" />
                                                        ) : (
                                                            <Shield className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                                        onClick={() => setDeleteUserId({ id: user.id, name: user.name })}
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

                {users.last_page > 1 && (
                    <div className="flex items-center justify-center gap-2">
                        {users.links.map((link, i) => (
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

            <UserDialog
                key={editingUser?.id ?? 'create'}
                user={editingUser}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
            />

            <InviteDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />

            <Dialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete User</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete {deleteUserId?.name}? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteUserId(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deleteUserId) router.delete(`/admin/user/${deleteUserId.id}`);
                                setDeleteUserId(null);
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
