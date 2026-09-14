import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isSafeUrl } from '@/lib/safe-url';

/**
 * Turn what the author typed into a link target: "example.com" means https,
 * "name@example.com" means mailto. Anything that already names a scheme is
 * taken as written and then has to pass the safety check.
 */
export function normalizeLinkInput(value: string): string {
    const input = value.trim();
    if (input === '') return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(input) || input.startsWith('/') || input.startsWith('#')) return input;
    if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(input)) return `mailto:${input}`;
    return `https://${input}`;
}

export function isAcceptableLink(url: string): boolean {
    return /^(https?:|mailto:|\/|#)/i.test(url) && isSafeUrl(url);
}

interface LinkDialogProps {
    editor: Editor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LinkDialog({ editor, open, onOpenChange }: LinkDialogProps) {
    const [href, setHref] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setHref((editor.getAttributes('link').href as string | undefined) ?? '');
        setError(null);
    }, [open, editor]);

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const url = normalizeLinkInput(href);

        if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            onOpenChange(false);
            return;
        }

        if (!isAcceptableLink(url)) {
            setError('Only web (http, https) and e-mail (mailto) links are allowed.');
            return;
        }

        if (editor.state.selection.empty && !editor.isActive('link')) {
            // Nothing selected to turn into a link: insert the address itself.
            editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
        } else {
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <form onSubmit={submit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>{editor.isActive('link') ? 'Edit link' : 'Add link'}</DialogTitle>
                        <DialogDescription>
                            Links open in a new tab for the reader. Leave the address empty to remove the link.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="link-href">Address</Label>
                        <Input
                            id="link-href"
                            value={href}
                            onChange={event => {
                                setHref(event.target.value);
                                setError(null);
                            }}
                            placeholder="https://example.com"
                            autoFocus
                            autoComplete="off"
                        />
                        {error && <p className="text-sm text-destructive">{error}</p>}
                    </div>
                    <DialogFooter className="gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">Save link</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
