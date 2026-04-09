export const languages = [
    { value: 'text', label: 'Plain Text' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'python', label: 'Python' },
    { value: 'java', label: 'Java' },
    { value: 'csharp', label: 'C#' },
    { value: 'cpp', label: 'C++' },
    { value: 'c', label: 'C' },
    { value: 'go', label: 'Go' },
    { value: 'rust', label: 'Rust' },
    { value: 'php', label: 'PHP' },
    { value: 'ruby', label: 'Ruby' },
    { value: 'swift', label: 'Swift' },
    { value: 'kotlin', label: 'Kotlin' },
    { value: 'scala', label: 'Scala' },
    { value: 'html', label: 'HTML' },
    { value: 'css', label: 'CSS' },
    { value: 'scss', label: 'SCSS' },
    { value: 'json', label: 'JSON' },
    { value: 'xml', label: 'XML' },
    { value: 'yaml', label: 'YAML' },
    { value: 'toml', label: 'TOML' },
    { value: 'markdown', label: 'Markdown' },
    { value: 'sql', label: 'SQL' },
    { value: 'bash', label: 'Bash' },
    { value: 'powershell', label: 'PowerShell' },
    { value: 'docker', label: 'Dockerfile' },
    { value: 'nginx', label: 'Nginx' },
    { value: 'apache', label: 'Apache' },
    { value: 'lua', label: 'Lua' },
    { value: 'perl', label: 'Perl' },
    { value: 'r', label: 'R' },
    { value: 'dart', label: 'Dart' },
    { value: 'elixir', label: 'Elixir' },
    { value: 'haskell', label: 'Haskell' },
    { value: 'graphql', label: 'GraphQL' },
    { value: 'protobuf', label: 'Protocol Buffers' },
    { value: 'ini', label: 'INI' },
    { value: 'diff', label: 'Diff' },
];

export function detectLanguage(code: string): string | null {
    const lines = code.trim().split('\n').slice(0, 15);
    const joined = lines.join('\n');

    // PowerShell: must check before PHP due to shared $ prefix
    if (/\b(Get-|Set-|New-|Remove-|Connect-|Invoke-|Write-|Select-Object|Where-Object|ForEach-Object|Out-File)\b/.test(joined)) return 'powershell';
    if (/\$\w+\s*=\s*.*(Get-|@\{|\|)/.test(joined)) return 'powershell';
    if (/\[PSCustomObject\]|@\{[\s\S]*\}|-ErrorAction\b|-like\b/m.test(joined)) return 'powershell';

    if (/^<(!DOCTYPE|html|div|span|p |a |img )/im.test(joined)) return 'html';
    if (/^(import|from|def |class |if __name__|print\()/m.test(joined) && !/(const |let |var |=>|function )/m.test(joined)) return 'python';
    if (/(const |let |var |=>|function |import .* from)/m.test(joined) && /[;{}]/.test(joined)) {
        if (/:\s*(string|number|boolean|any|void|interface |type )/m.test(joined)) return 'typescript';
        return 'javascript';
    }
    if (/^(package |import "|\tfunc |func )/m.test(joined)) return 'go';
    if (/^(use |fn |let mut |pub |mod |struct |impl )/m.test(joined)) return 'rust';
    // PHP: require <?php tag or -> operator with $ vars, not just bare $ vars
    if (/^<\?php/m.test(joined)) return 'php';
    if (/(\$\w+->|\$this->|->where\(|->get\()/.test(joined)) return 'php';
    if (/^(public class|private class|import java\.|System\.out)/m.test(joined)) return 'java';
    if (/^(using System|namespace |public class|private class|Console\.)/m.test(joined)) return 'csharp';
    if (/^(#include|int main|std::|cout|cin|printf|scanf)/m.test(joined)) return 'cpp';
    if (/^(SELECT |INSERT |UPDATE |DELETE |CREATE |ALTER |DROP |FROM )/im.test(joined)) return 'sql';
    if (/^(---|  \w+:|apiVersion:|kind:)/m.test(joined)) return 'yaml';
    if (/^\{[\s\n]*"/.test(joined)) return 'json';
    if (/^#!\/bin\/(ba)?sh/m.test(joined) || /\b(echo|grep|awk|sed|curl|apt|yum|brew)\b/.test(joined)) return 'bash';
    if (/^(FROM |RUN |CMD |COPY |EXPOSE |WORKDIR )/m.test(joined)) return 'docker';
    if (/^(class |def |require |puts |gem )/m.test(joined)) return 'ruby';
    if (/^(---\n|^-\s|^\+\s|^@@)/m.test(joined)) return 'diff';

    return null;
}
