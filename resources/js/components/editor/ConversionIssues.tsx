import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ConversionIssue } from '@/lib/markdown-doc';

/** The list of what a conversion or save would change, in the author's terms. */
export function ConversionIssueList({ issues }: { issues: ConversionIssue[] }) {
    if (!issues.length) return null;

    return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Not carried over exactly
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-6">
                {issues.map(issue => (
                    <li key={issue.code}>
                        {issue.label}
                        {issue.count > 1 && <span className="text-amber-700 dark:text-amber-400"> ×{issue.count}</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
}

interface IssuesConfirmDialogProps {
    open: boolean;
    title: string;
    description: React.ReactNode;
    issues: ConversionIssue[];
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Asks before anything lossy happens. Cancel is the default action and the
 * content stays exactly as it was.
 */
export function IssuesConfirmDialog({ open, title, description, issues, confirmLabel, onCancel, onConfirm }: IssuesConfirmDialogProps) {
    return (
        <Dialog open={open} onOpenChange={next => !next && onCancel()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <ConversionIssueList issues={issues} />
                <DialogFooter className="gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} autoFocus>
                        Cancel
                    </Button>
                    <Button type="button" onClick={onConfirm}>
                        {confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
