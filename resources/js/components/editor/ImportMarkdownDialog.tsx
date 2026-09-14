import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { checkMarkdownEditable, markdownToDoc } from '@/lib/markdown-doc';
import { ConversionIssueList } from './ConversionIssues';

/** Larger files are refused in the browser rather than freezing the tab. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

interface ImportMarkdownDialogProps {
    editor: Editor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Explicit Markdown import: paste Markdown text or pick a local .md file, see
 * what would not carry over, then insert or replace. The file is read in the
 * browser only; nothing is uploaded until the paste itself is encrypted and saved.
 */
export function ImportMarkdownDialog({ editor, open, onOpenChange }: ImportMarkdownDialogProps) {
    const [markdown, setMarkdown] = useState('');
    const [fileName, setFileName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    // Checking re-parses the whole text; defer it so typing stays responsive.
    const deferred = useDeferredValue(markdown);
    const issues = useMemo(() => (deferred.trim() ? checkMarkdownEditable(deferred) : []), [deferred]);

    useEffect(() => {
        if (open) return;
        setMarkdown('');
        setFileName(null);
        setError(null);
    }, [open]);

    const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        if (file.size > MAX_IMPORT_BYTES) {
            setError('That file is larger than 5 MB. Split it up or publish it through the API instead.');
            return;
        }

        setError(null);
        setMarkdown(await file.text());
        setFileName(file.name);
    };

    const importInto = (mode: 'insert' | 'replace') => {
        const { doc } = markdownToDoc(markdown);
        if (mode === 'replace') {
            editor.chain().focus().setContent(doc).run();
        } else {
            editor.chain().focus().insertContent(doc.content ?? []).run();
        }
        onOpenChange(false);
    };

    const hasContent = markdown.trim() !== '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Import Markdown</DialogTitle>
                    <DialogDescription>
                        Headings, lists, checklists, tables, links and code blocks become formatted text. The Markdown is
                        treated as content only. Images, HTML and footnotes are listed below if they cannot be carried over.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="import-markdown">Markdown</Label>
                        <div className="flex items-center gap-2">
                            {fileName && <span className="max-w-[12rem] truncate text-xs text-muted-foreground">{fileName}</span>}
                            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                                <FileUp />
                                Open .md file
                            </Button>
                            <input
                                ref={fileInput}
                                type="file"
                                accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
                                className="hidden"
                                onChange={readFile}
                            />
                        </div>
                    </div>
                    <textarea
                        id="import-markdown"
                        value={markdown}
                        onChange={event => {
                            setMarkdown(event.target.value);
                            setFileName(null);
                        }}
                        placeholder={'# Heading\n\n- item\n- [ ] task\n\n| a | b |\n| - | - |\n| 1 | 2 |'}
                        className="h-56 w-full resize-y rounded-lg border bg-card p-3 font-mono text-sm leading-relaxed text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        spellCheck={false}
                        style={{ tabSize: 4 }}
                    />
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>

                <ConversionIssueList issues={issues} />

                <DialogFooter className="flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" variant="outline" disabled={!hasContent} onClick={() => importInto('insert')}>
                        Insert at cursor
                    </Button>
                    <Button type="button" disabled={!hasContent} onClick={() => importInto('replace')}>
                        Replace document
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
