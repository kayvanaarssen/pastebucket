import { type ReactNode, useState } from 'react';
import { Link, usePage, router } from '@inertiajs/react';
import type { PageProps } from '@/types';
import { Logo } from '@/components/Logo';
import { useTheme } from '@/components/ThemeProvider';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sun, Moon, Monitor, LogOut, LayoutDashboard, Shield, Plus, Menu, X } from 'lucide-react';

interface AppLayoutProps {
    children: ReactNode;
    title?: string;
}

export default function AppLayout({ children, title }: AppLayoutProps) {
    const { auth, flash } = usePage<PageProps>().props;
    const { setTheme, resolvedTheme } = useTheme();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
                <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
                    {/* Left: Logo + desktop nav */}
                    <div className="flex items-center gap-4">
                        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground hover:text-primary transition-colors">
                            <Logo size={26} />
                            <span className="text-lg hidden xs:inline">PasteBucket</span>
                        </Link>
                        <nav className="hidden md:flex items-center gap-1">
                            <Button variant="ghost" size="sm" asChild>
                                <Link href="/">
                                    <Plus className="mr-1.5 h-4 w-4" />
                                    New Paste
                                </Link>
                            </Button>
                            {auth.user && (
                                <Button variant="ghost" size="sm" asChild>
                                    <Link href="/dashboard">
                                        <LayoutDashboard className="mr-1.5 h-4 w-4" />
                                        My Pastes
                                    </Link>
                                </Button>
                            )}
                        </nav>
                    </div>

                    {/* Right: Admin + Theme + User + Mobile toggle */}
                    <div className="flex items-center gap-1.5">
                        {/* Admin link - right-aligned next to theme toggle */}
                        {auth.user?.is_admin && (
                            <Button variant="ghost" size="icon" className="h-9 w-9 hidden sm:inline-flex" asChild>
                                <Link href="/admin" title="Admin Panel">
                                    <Shield className="h-4 w-4" />
                                </Link>
                            </Button>
                        )}

                        {/* Theme toggle */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-9 w-9">
                                    {resolvedTheme === 'dark' ? (
                                        <Moon className="h-4 w-4" />
                                    ) : (
                                        <Sun className="h-4 w-4" />
                                    )}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setTheme('light')}>
                                    <Sun className="mr-2 h-4 w-4" />
                                    Light
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setTheme('dark')}>
                                    <Moon className="mr-2 h-4 w-4" />
                                    Dark
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setTheme('system')}>
                                    <Monitor className="mr-2 h-4 w-4" />
                                    System
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* User menu (desktop) */}
                        {auth.user ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="hidden sm:inline-flex gap-2">
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                                            {auth.user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="hidden lg:inline">{auth.user.name}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuLabel>{auth.user.email}</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                        <Link href="/dashboard">
                                            <LayoutDashboard className="mr-2 h-4 w-4" />
                                            My Pastes
                                        </Link>
                                    </DropdownMenuItem>
                                    {auth.user.is_admin && (
                                        <DropdownMenuItem asChild>
                                            <Link href="/admin">
                                                <Shield className="mr-2 h-4 w-4" />
                                                Admin Panel
                                            </Link>
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => router.post('/logout')}
                                        className="text-destructive"
                                    >
                                        <LogOut className="mr-2 h-4 w-4" />
                                        Logout
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <div className="hidden sm:flex items-center gap-1.5">
                                <Button variant="ghost" size="sm" asChild>
                                    <Link href="/login">Login</Link>
                                </Button>
                                <Button size="sm" asChild>
                                    <Link href="/register">Register</Link>
                                </Button>
                            </div>
                        )}

                        {/* Mobile menu toggle */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 sm:hidden"
                            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        >
                            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </Button>
                    </div>
                </div>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                    <div className="border-t bg-background px-4 py-3 sm:hidden">
                        <nav className="flex flex-col gap-1">
                            <Button variant="ghost" size="sm" className="justify-start" asChild>
                                <Link href="/" onClick={() => setMobileMenuOpen(false)}>
                                    <Plus className="mr-2 h-4 w-4" />
                                    New Paste
                                </Link>
                            </Button>
                            {auth.user && (
                                <Button variant="ghost" size="sm" className="justify-start" asChild>
                                    <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)}>
                                        <LayoutDashboard className="mr-2 h-4 w-4" />
                                        My Pastes
                                    </Link>
                                </Button>
                            )}
                            {auth.user?.is_admin && (
                                <Button variant="ghost" size="sm" className="justify-start" asChild>
                                    <Link href="/admin" onClick={() => setMobileMenuOpen(false)}>
                                        <Shield className="mr-2 h-4 w-4" />
                                        Admin Panel
                                    </Link>
                                </Button>
                            )}
                            {auth.user ? (
                                <>
                                    <div className="my-1 border-t" />
                                    <div className="px-3 py-1.5 text-sm text-muted-foreground">{auth.user.email}</div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="justify-start text-destructive hover:text-destructive"
                                        onClick={() => { router.post('/logout'); setMobileMenuOpen(false); }}
                                    >
                                        <LogOut className="mr-2 h-4 w-4" />
                                        Logout
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <div className="my-1 border-t" />
                                    <Button variant="ghost" size="sm" className="justify-start" asChild>
                                        <Link href="/login" onClick={() => setMobileMenuOpen(false)}>Login</Link>
                                    </Button>
                                    <Button size="sm" className="justify-start" asChild>
                                        <Link href="/register" onClick={() => setMobileMenuOpen(false)}>Register</Link>
                                    </Button>
                                </>
                            )}
                        </nav>
                    </div>
                )}
            </header>

            {/* Flash messages */}
            {(flash.success || flash.error) && (
                <div className="mx-auto max-w-6xl px-4 pt-4">
                    {flash.success && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                            {flash.success}
                        </div>
                    )}
                    {flash.error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                            {flash.error}
                        </div>
                    )}
                </div>
            )}

            <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
                {children}
            </main>

            <footer className="border-t py-4 sm:py-6">
                <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
                    PasteBucket — Self-hosted code sharing
                </div>
            </footer>
        </div>
    );
}
