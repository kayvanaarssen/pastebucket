import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import vs2015 from 'react-syntax-highlighter/dist/esm/styles/hljs/vs2015';
import atomOneLight from 'react-syntax-highlighter/dist/esm/styles/hljs/atom-one-light';
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java';
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp';
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp';
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c';
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust';
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php';
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby';
import swift from 'react-syntax-highlighter/dist/esm/languages/hljs/swift';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/hljs/kotlin';
import scala from 'react-syntax-highlighter/dist/esm/languages/hljs/scala';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import scss from 'react-syntax-highlighter/dist/esm/languages/hljs/scss';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import powershell from 'react-syntax-highlighter/dist/esm/languages/hljs/powershell';
import dockerfile from 'react-syntax-highlighter/dist/esm/languages/hljs/dockerfile';
import nginx from 'react-syntax-highlighter/dist/esm/languages/hljs/nginx';
import lua from 'react-syntax-highlighter/dist/esm/languages/hljs/lua';
import perl from 'react-syntax-highlighter/dist/esm/languages/hljs/perl';
import r from 'react-syntax-highlighter/dist/esm/languages/hljs/r';
import dart from 'react-syntax-highlighter/dist/esm/languages/hljs/dart';
import elixir from 'react-syntax-highlighter/dist/esm/languages/hljs/elixir';
import haskell from 'react-syntax-highlighter/dist/esm/languages/hljs/haskell';
import protobuf from 'react-syntax-highlighter/dist/esm/languages/hljs/protobuf';
import ini from 'react-syntax-highlighter/dist/esm/languages/hljs/ini';
import diff from 'react-syntax-highlighter/dist/esm/languages/hljs/diff';
import plaintext from 'react-syntax-highlighter/dist/esm/languages/hljs/plaintext';
import apache from 'react-syntax-highlighter/dist/esm/languages/hljs/apache';
import { useTheme } from '@/components/ThemeProvider';

SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('java', java);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c', c);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('php', php);
SyntaxHighlighter.registerLanguage('ruby', ruby);
SyntaxHighlighter.registerLanguage('swift', swift);
SyntaxHighlighter.registerLanguage('kotlin', kotlin);
SyntaxHighlighter.registerLanguage('scala', scala);
SyntaxHighlighter.registerLanguage('html', xml);
SyntaxHighlighter.registerLanguage('xml', xml);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('scss', scss);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('toml', ini);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('powershell', powershell);
SyntaxHighlighter.registerLanguage('docker', dockerfile);
SyntaxHighlighter.registerLanguage('nginx', nginx);
SyntaxHighlighter.registerLanguage('apache', apache);
SyntaxHighlighter.registerLanguage('lua', lua);
SyntaxHighlighter.registerLanguage('perl', perl);
SyntaxHighlighter.registerLanguage('r', r);
SyntaxHighlighter.registerLanguage('dart', dart);
SyntaxHighlighter.registerLanguage('elixir', elixir);
SyntaxHighlighter.registerLanguage('haskell', haskell);
SyntaxHighlighter.registerLanguage('graphql', plaintext);
SyntaxHighlighter.registerLanguage('protobuf', protobuf);
SyntaxHighlighter.registerLanguage('ini', ini);
SyntaxHighlighter.registerLanguage('diff', diff);
SyntaxHighlighter.registerLanguage('text', plaintext);

interface CodeHighlighterProps {
    code: string;
    language?: string;
    showLineNumbers?: boolean;
}

export function CodeHighlighter({ code, language = 'text', showLineNumbers = true }: CodeHighlighterProps) {
    const { resolvedTheme } = useTheme();

    return (
        <SyntaxHighlighter
            key={resolvedTheme}
            language={language || 'text'}
            style={resolvedTheme === 'dark' ? vs2015 : atomOneLight}
            showLineNumbers={showLineNumbers}
            wrapLongLines={false}
            customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: '0.8125rem',
                lineHeight: '1.6',
                padding: '0.75rem',
            }}
            lineNumberStyle={{
                minWidth: '2.5em',
                paddingRight: '0.75em',
                opacity: 0.5,
                userSelect: 'none',
            }}
        >
            {code}
        </SyntaxHighlighter>
    );
}
