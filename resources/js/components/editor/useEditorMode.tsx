import { useCallback, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { Code2, RotateCcw, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    checkDocStorable,
    checkMarkdownEditable,
    docToMarkdown,
    docsEqual,
    emptyDoc,
    markdownToDoc,
    planConversion,
    type ConversionIssue,
    type ConversionPlan,
    type EditorMode,
} from '@/lib/markdown-doc';
import { ConversionIssueList, IssuesConfirmDialog } from './ConversionIssues';

export type { EditorMode };

export const MODE_LABELS: Record<EditorMode, string> = {
    code: 'Code / plain text',
    rich: 'Formatted text',
};

/** What the page looked like before the first conversion, so it can be put back exactly. */
type Snapshot =
    | { mode: 'code'; content: string; language: string }
    | { mode: 'rich'; doc: JSONContent; source: { doc: JSONContent; markdown: string } | null };

interface CodeState {
    content: string;
    /** The language as chosen (empty for auto-detect), restored verbatim. */
    language: string;
    /** Chosen or auto-detected, used to decide how to read the text. */
    effectiveLanguage: string;
}

interface UseEditorModeOptions {
    initialMode?: EditorMode;
    getCode: () => CodeState;
    setCode: (content: string, language: string) => void;
}

/**
 * State for switching between the code editor and the visual editor.
 *
 * Every switch is planned before it happens (see planConversion). A lossless
 * switch just happens; anything else asks first, with Cancel as the way out.
 * The state from before the first conversion is kept until the page is left
 * or saved, so "Restore original" can always undo a conversion exactly.
 *
 * Markdown that was loaded into the visual editor is saved back byte for byte
 * as long as the document still matches it, so opening and saving a document
 * never rewrites its source.
 */
export function useEditorMode({ initialMode = 'code', getCode, setCode }: UseEditorModeOptions) {
    const [mode, setMode] = useState<EditorMode>(initialMode);
    const [richKey, setRichKey] = useState(0);
    const [richDoc, setRichDoc] = useState<JSONContent>(emptyDoc);
    const [richEmpty, setRichEmpty] = useState(true);
    const [original, setOriginal] = useState<Snapshot | null>(null);
    const [pending, setPending] = useState<ConversionPlan | null>(null);
    const [saveIssues, setSaveIssues] = useState<ConversionIssue[] | null>(null);

    const editorRef = useRef<Editor | null>(null);
    const sourceRef = useRef<{ doc: JSONContent; markdown: string } | null>(null);
    const saveResolver = useRef<((confirmed: boolean) => void) | null>(null);

    const currentDoc = useCallback(() => editorRef.current?.getJSON() ?? richDoc, [richDoc]);

    /** Markdown for the current document: the loaded source if nothing changed. */
    const currentMarkdown = useCallback((doc: JSONContent) => {
        const source = sourceRef.current;
        return source && docsEqual(doc, source.doc) ? source.markdown : docToMarkdown(doc);
    }, []);

    const loadRich = useCallback((doc: JSONContent, sourceMarkdown: string | null) => {
        editorRef.current = null;
        sourceRef.current = sourceMarkdown !== null ? { doc, markdown: sourceMarkdown } : null;
        setRichDoc(doc);
        setRichEmpty(!(doc.content ?? []).some(node => node.type !== 'paragraph' || (node.content ?? []).length > 0));
        setRichKey(key => key + 1);
        setMode('rich');
    }, []);

    const snapshot = (): Snapshot => {
        if (mode === 'code') {
            const { content, language } = getCode();
            return { mode: 'code', content, language };
        }
        return { mode: 'rich', doc: currentDoc(), source: sourceRef.current };
    };

    /** Nothing typed yet: a switch then has no original worth offering back. */
    const isBlank = () => (mode === 'code'
        ? getCode().content.trim() === ''
        : (editorRef.current?.isEmpty ?? richEmpty));

    const apply = (plan: ConversionPlan, choice?: 'codeBlock' | 'markdown') => {
        const blank = isBlank();
        setOriginal(existing => existing ?? (blank ? null : snapshot()));
        setPending(null);

        if (plan.to === 'code') {
            setCode(plan.markdown, 'markdown');
            setMode('code');
            return;
        }

        if (plan.kind === 'choice') {
            loadRich(choice === 'codeBlock' ? plan.asCodeBlock : plan.asMarkdown.doc, null);
        } else {
            loadRich(plan.doc, plan.kind === 'lossless' ? plan.markdownSource : null);
        }
    };

    const requestMode = (to: EditorMode) => {
        if (to === mode) return;

        if (to === 'code') {
            const doc = currentDoc();
            const source = sourceRef.current;
            // Untouched Markdown goes back to the code editor as it came.
            if (source && docsEqual(doc, source.doc)) {
                apply({ kind: 'lossless', to: 'code', markdown: source.markdown });
                return;
            }
            const plan = planConversion({ from: 'rich', to: 'code', doc });
            plan.kind === 'lossless' ? apply(plan) : setPending(plan);
            return;
        }

        const { content, effectiveLanguage } = getCode();
        const plan = planConversion({ from: 'code', to: 'rich', content, language: effectiveLanguage });
        plan.kind === 'lossless' ? apply(plan) : setPending(plan);
    };

    const restore = () => {
        if (!original) return;
        if (original.mode === 'code') {
            setCode(original.content, original.language);
            setMode('code');
        } else {
            loadRich(original.doc, null);
            sourceRef.current = original.source;
        }
        setOriginal(null);
    };

    /**
     * Open stored Markdown in the visual editor if that is lossless. Returns
     * the issues otherwise, and leaves the page in the code editor.
     */
    const loadMarkdownDocument = (markdown: string): ConversionIssue[] => {
        const issues = checkMarkdownEditable(markdown);
        if (issues.length === 0) loadRich(markdownToDoc(markdown).doc, markdown);
        return issues;
    };

    /**
     * The Markdown to save from the visual editor, or null when the author
     * cancelled because the document cannot be stored exactly.
     */
    const markdownForSave = async (): Promise<string | null> => {
        const doc = currentDoc();
        const source = sourceRef.current;
        if (source && docsEqual(doc, source.doc)) return source.markdown;

        const issues = checkDocStorable(doc);
        if (issues.length) {
            const confirmed = await new Promise<boolean>(resolve => {
                saveResolver.current = resolve;
                setSaveIssues(issues);
            });
            setSaveIssues(null);
            saveResolver.current = null;
            if (!confirmed) return null;
        }
        return currentMarkdown(doc);
    };

    // Passed separately from the props: React warns about spreading `key`.
    const editorKey = `rich-${richKey}`;
    const richProps = {
        initialContent: richDoc,
        onReady: (editor: Editor) => {
            editorRef.current = editor;
            setRichEmpty(editor.isEmpty);
        },
        onChange: (editor: Editor) => {
            editorRef.current = editor;
            setRichEmpty(editor.isEmpty);
        },
    };

    const pendingTo = pending?.to ?? 'rich';

    const dialogs = (
        <>
            <IssuesConfirmDialog
                open={pending?.kind === 'lossy'}
                title={pendingTo === 'rich' ? 'Some content cannot be shown in the visual editor' : 'Some formatting cannot be kept as Markdown'}
                description={
                    <>
                        Switching to {MODE_LABELS[pendingTo]} changes the parts listed below. Until you save, “Restore
                        original” puts everything back exactly as it was.
                    </>
                }
                issues={pending?.kind === 'lossy' ? pending.issues : []}
                confirmLabel="Convert anyway"
                onCancel={() => setPending(null)}
                onConfirm={() => pending && apply(pending)}
            />

            <Dialog open={pending?.kind === 'choice'} onOpenChange={open => !open && setPending(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>How should this text become formatted text?</DialogTitle>
                        <DialogDescription>
                            It was written in the code editor, so it could be code or prose. Until you save, “Restore
                            original” puts it back exactly as it was.
                        </DialogDescription>
                    </DialogHeader>
                    {pending?.kind === 'choice' && (
                        <div className="grid gap-3">
                            <div className="rounded-lg border p-3">
                                <p className="font-medium">Keep it as a code block</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Every character, indent and line break stays exactly as it is. Best for code, logs and configuration.
                                </p>
                                <Button type="button" size="sm" className="mt-3" onClick={() => apply(pending, 'codeBlock')}>
                                    Use a code block
                                </Button>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="font-medium">Read it as Markdown</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Headings, lists, links and tables become formatting; line breaks are kept. Spacing at the
                                    start of lines and repeated blank lines are not.
                                </p>
                                {pending.asMarkdown.issues.length > 0 && (
                                    <div className="mt-2">
                                        <ConversionIssueList issues={pending.asMarkdown.issues} />
                                    </div>
                                )}
                                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => apply(pending, 'markdown')}>
                                    Read as Markdown
                                </Button>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setPending(null)} autoFocus>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <IssuesConfirmDialog
                open={saveIssues !== null}
                title="Some formatting cannot be saved exactly"
                description="Formatted text is stored as Markdown. The parts listed below will look different after saving."
                issues={saveIssues ?? []}
                confirmLabel="Save anyway"
                onCancel={() => saveResolver.current?.(false)}
                onConfirm={() => saveResolver.current?.(true)}
            />
        </>
    );

    return {
        mode,
        requestMode,
        restore,
        original,
        editorKey,
        richProps,
        richEmpty,
        loadMarkdownDocument,
        markdownForSave,
        dialogs,
    };
}

export function EditorModeSwitch({ mode, onChange, disabled = false }: { mode: EditorMode; onChange: (mode: EditorMode) => void; disabled?: boolean }) {
    return (
        <Tabs value={mode} onValueChange={value => onChange(value as EditorMode)}>
            <TabsList aria-label="Editor">
                <TabsTrigger value="code" disabled={disabled} className="gap-1.5 text-xs sm:text-sm">
                    <Code2 className="h-3.5 w-3.5" />
                    {MODE_LABELS.code}
                </TabsTrigger>
                <TabsTrigger value="rich" disabled={disabled} className="gap-1.5 text-xs sm:text-sm">
                    <Type className="h-3.5 w-3.5" />
                    {MODE_LABELS.rich}
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}

export function ConvertedBanner({ from, onRestore }: { from: EditorMode; onRestore: () => void }) {
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            <span className="flex-1">
                Converted from {MODE_LABELS[from]}. The original is kept until you save.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onRestore}>
                <RotateCcw />
                Restore original
            </Button>
        </div>
    );
}
