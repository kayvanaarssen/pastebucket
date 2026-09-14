import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import {
    Bold,
    Code,
    FileDown,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    Link2,
    List,
    ListChecks,
    ListOrdered,
    Minus,
    Pilcrow,
    Quote,
    Redo2,
    SquareCode,
    Strikethrough,
    Table,
    Undo2,
    Unlink,
    X,
    AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { cleanPastedHtml, describeDropped, emptyDropped, hasDropped, mergeDropped, type DroppedContent } from '@/lib/paste-cleanup';
import { editorExtensions } from './extensions';
import { LinkDialog } from './LinkDialog';
import { ImportMarkdownDialog } from './ImportMarkdownDialog';

interface RichTextEditorProps {
    /** Loaded once. To load a different document, change the component's `key`. */
    initialContent: JSONContent;
    onReady?: (editor: Editor) => void;
    /** Fires only when the document itself changes, never on selection moves. */
    onChange?: (editor: Editor) => void;
    placeholder?: string;
    disabled?: boolean;
}

/**
 * The visual editor for formatted-text pastes.
 *
 * It edits a document whose schema is limited to what Markdown can store (see
 * extensions.ts), so the toolbar only offers formatting that survives a save.
 * Pasted HTML goes through cleanPastedHtml first, and anything left out --
 * images, attachments, embeds -- is listed under the toolbar rather than
 * vanishing without a word.
 */
export function RichTextEditor({ initialContent, onReady, onChange, placeholder, disabled = false }: RichTextEditorProps) {
    const [dropped, setDropped] = useState<DroppedContent | null>(null);
    const onChangeRef = useRef(onChange);
    const onReadyRef = useRef(onReady);
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;

    // The editor's props are fixed at creation, so they report through a ref.
    const reportDropped = useRef((next: DroppedContent) => {
        if (!hasDropped(next)) return;
        setDropped(current => mergeDropped(current ?? emptyDropped(), next));
    });

    const editor = useEditor({
        extensions: editorExtensions({ placeholder }),
        content: initialContent,
        editable: !disabled,
        immediatelyRender: true,
        shouldRerenderOnTransaction: false,
        editorProps: {
            attributes: {
                class: 'tiptap-content prose prose-sm sm:prose-base dark:prose-invert max-w-none min-h-[200px] sm:min-h-[300px] p-3 sm:p-4 focus:outline-none',
                'aria-label': 'Formatted text editor',
                spellcheck: 'true',
            },
            transformPastedHTML: html => {
                const cleaned = cleanPastedHtml(html);
                reportDropped.current(cleaned.dropped);
                return cleaned.html;
            },
            handlePaste: (_view, event) => {
                const data = event.clipboardData;
                const files = data?.files.length ?? 0;
                // Office apps put a picture of the selection on the clipboard
                // next to the real HTML. Only a paste that is nothing *but*
                // files is an attachment the author meant to add.
                const hasText = Array.from(data?.types ?? []).some(type => type === 'text/html' || type === 'text/plain');
                if (files > 0 && !hasText) {
                    reportDropped.current({ ...emptyDropped(), files });
                    return true;
                }
                return false;
            },
            handleDrop: (_view, event) => {
                const files = (event as DragEvent).dataTransfer?.files.length ?? 0;
                if (files > 0) {
                    reportDropped.current({ ...emptyDropped(), files });
                    return true;
                }
                return false;
            },
        },
        onUpdate: ({ editor }) => onChangeRef.current?.(editor as Editor),
    });

    // Reported from an effect rather than onCreate, which can fire after the
    // parent has already rendered: the page reads the document to save from
    // this instance, and must never fall back to a stale copy.
    useEffect(() => {
        if (editor) onReadyRef.current?.(editor);
    }, [editor]);

    useEffect(() => {
        editor?.setEditable(!disabled);
    }, [editor, disabled]);

    if (!editor) return null;

    return (
        <div className="tiptap-editor overflow-hidden rounded-lg border bg-card text-card-foreground focus-within:ring-2 focus-within:ring-ring">
            <EditorToolbar editor={editor} disabled={disabled} />
            {dropped && (
                <div
                    role="status"
                    className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex-1">
                        <p>Not carried over from what you pasted or dropped. Nothing was uploaded or loaded:</p>
                        <ul className="mt-1 list-disc pl-5">
                            {describeDropped(dropped).map(line => <li key={line}>{line}</li>)}
                        </ul>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDropped(null)}
                        className="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900"
                        aria-label="Dismiss"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
            <EditorContent editor={editor} />
        </div>
    );
}

interface ToolButtonProps {
    label: string;
    shortcut?: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}

function ToolButton({ label, shortcut, active = false, disabled = false, onClick, children }: ToolButtonProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('h-8 w-8', active && 'bg-secondary text-secondary-foreground')}
                    aria-label={label}
                    aria-pressed={active}
                    disabled={disabled}
                    // Keep the editor's selection: a toolbar click must not blur it.
                    onMouseDown={event => event.preventDefault()}
                    onClick={onClick}
                >
                    {children}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
                {label}
                {shortcut && <span className="ml-1.5 text-muted-foreground">{shortcut}</span>}
            </TooltipContent>
        </Tooltip>
    );
}

function Divider() {
    return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;
}

function EditorToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
    const [linkOpen, setLinkOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const state = useEditorState({
        editor,
        selector: ({ editor: e }) => ({
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            taskList: e.isActive('taskList'),
            blockquote: e.isActive('blockquote'),
            codeBlock: e.isActive('codeBlock'),
            link: e.isActive('link'),
            table: e.isActive('table'),
            heading: ([1, 2, 3] as const).find(level => e.isActive('heading', { level })) ?? 0,
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
            language: (e.getAttributes('codeBlock').language as string | null) ?? '',
        }),
    });

    const chain = () => editor.chain().focus();
    const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1" role="toolbar" aria-label="Formatting">
                <ToolButton label="Undo" shortcut={`${mod}Z`} disabled={disabled || !state.canUndo} onClick={() => chain().undo().run()}>
                    <Undo2 />
                </ToolButton>
                <ToolButton label="Redo" shortcut={`${mod}Shift+Z`} disabled={disabled || !state.canRedo} onClick={() => chain().redo().run()}>
                    <Redo2 />
                </ToolButton>
                <Divider />
                <ToolButton label="Paragraph" active={!state.heading && !state.codeBlock} disabled={disabled} onClick={() => chain().setParagraph().run()}>
                    <Pilcrow />
                </ToolButton>
                <ToolButton label="Heading 1" active={state.heading === 1} disabled={disabled} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
                    <Heading1 />
                </ToolButton>
                <ToolButton label="Heading 2" active={state.heading === 2} disabled={disabled} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
                    <Heading2 />
                </ToolButton>
                <ToolButton label="Heading 3" active={state.heading === 3} disabled={disabled} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
                    <Heading3 />
                </ToolButton>
                <Divider />
                <ToolButton label="Bold" shortcut={`${mod}B`} active={state.bold} disabled={disabled} onClick={() => chain().toggleBold().run()}>
                    <Bold />
                </ToolButton>
                <ToolButton label="Italic" shortcut={`${mod}I`} active={state.italic} disabled={disabled} onClick={() => chain().toggleItalic().run()}>
                    <Italic />
                </ToolButton>
                <ToolButton label="Strikethrough" shortcut={`${mod}Shift+S`} active={state.strike} disabled={disabled} onClick={() => chain().toggleStrike().run()}>
                    <Strikethrough />
                </ToolButton>
                <ToolButton label="Inline code" shortcut={`${mod}E`} active={state.code} disabled={disabled} onClick={() => chain().toggleCode().run()}>
                    <Code />
                </ToolButton>
                <ToolButton label={state.link ? 'Edit link' : 'Add link'} active={state.link} disabled={disabled} onClick={() => setLinkOpen(true)}>
                    <Link2 />
                </ToolButton>
                {state.link && (
                    <ToolButton label="Remove link" disabled={disabled} onClick={() => chain().extendMarkRange('link').unsetLink().run()}>
                        <Unlink />
                    </ToolButton>
                )}
                <Divider />
                <ToolButton label="Bulleted list" active={state.bulletList} disabled={disabled} onClick={() => chain().toggleBulletList().run()}>
                    <List />
                </ToolButton>
                <ToolButton label="Numbered list" active={state.orderedList} disabled={disabled} onClick={() => chain().toggleOrderedList().run()}>
                    <ListOrdered />
                </ToolButton>
                <ToolButton label="Checklist" active={state.taskList} disabled={disabled} onClick={() => chain().toggleTaskList().run()}>
                    <ListChecks />
                </ToolButton>
                <ToolButton label="Quote" active={state.blockquote} disabled={disabled} onClick={() => chain().toggleBlockquote().run()}>
                    <Quote />
                </ToolButton>
                <ToolButton label="Code block" active={state.codeBlock} disabled={disabled} onClick={() => chain().toggleCodeBlock().run()}>
                    <SquareCode />
                </ToolButton>
                <ToolButton label="Horizontal line" disabled={disabled} onClick={() => chain().setHorizontalRule().run()}>
                    <Minus />
                </ToolButton>

                <DropdownMenu>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className={cn('h-8 w-8', state.table && 'bg-secondary text-secondary-foreground')}
                                    aria-label="Table"
                                    disabled={disabled}
                                >
                                    <Table />
                                </Button>
                            </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Table</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="start" onCloseAutoFocus={event => event.preventDefault()}>
                        <DropdownMenuItem onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                            Insert table
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!state.table} onSelect={() => chain().addRowAfter().run()}>Add row below</DropdownMenuItem>
                        <DropdownMenuItem disabled={!state.table} onSelect={() => chain().addColumnAfter().run()}>Add column right</DropdownMenuItem>
                        <DropdownMenuItem disabled={!state.table} onSelect={() => chain().deleteRow().run()}>Delete row</DropdownMenuItem>
                        <DropdownMenuItem disabled={!state.table} onSelect={() => chain().deleteColumn().run()}>Delete column</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!state.table} className="text-destructive" onSelect={() => chain().deleteTable().run()}>
                            Delete table
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {state.codeBlock && (
                    <Input
                        aria-label="Code block language"
                        placeholder="language"
                        value={state.language}
                        disabled={disabled}
                        onChange={event => editor.chain().updateAttributes('codeBlock', { language: event.target.value || null }).run()}
                        className="ml-1 h-7 w-28 text-xs md:text-xs"
                    />
                )}

                <div className="ml-auto">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" disabled={disabled} onClick={() => setImportOpen(true)}>
                                <FileDown />
                                Import Markdown
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Paste or open Markdown and turn it into formatted text</TooltipContent>
                    </Tooltip>
                </div>
            </div>

            <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
            <ImportMarkdownDialog editor={editor} open={importOpen} onOpenChange={setImportOpen} />
        </TooltipProvider>
    );
}
