export const normalizeSqlDumpContent = (sqlContent) => {
    return String(sqlContent || '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/^\s*\\-\\-\s?/gm, '-- ')
        .replace(/^\s*\\#/gm, '#');
};

export const splitSqlStatements = (sqlContent) => {
    const statements = [];
    let delimiter = ';';
    let buffer = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let escapeNext = false;

    const pushStatement = () => {
        const trimmed = buffer.trim();
        if (trimmed) statements.push(trimmed);
        buffer = '';
    };

    const lines = normalizeSqlDumpContent(sqlContent)
        .replace(/^--.*$/gm, '')
        .replace(/^#.*$/gm, '')
        .replace(/\/\*!\d+\s*([\s\S]*?)\*\//g, '$1')
        .replace(/\/\*(?!\!)[\s\S]*?\*\//g, '');

    for (const rawLine of lines.split('\n')) {
        const delimiterMatch = rawLine.trim().match(/^DELIMITER\s+(.+)$/i);
        if (delimiterMatch) {
            if (buffer.trim()) pushStatement();
            delimiter = delimiterMatch[1];
            continue;
        }

        buffer += `${rawLine}\n`;
        const line = rawLine;
        const lineLength = line.length;

        for (let i = 0; i < lineLength; i += 1) {
            const char = line[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (!inDoubleQuote && !inBacktick && char === '\'') {
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (!inSingleQuote && !inBacktick && char === '"') {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (!inSingleQuote && !inDoubleQuote && char === '`') {
                inBacktick = !inBacktick;
            }
        }

        const trimmedLine = line.trimEnd();
        if (!inSingleQuote && !inDoubleQuote && !inBacktick && trimmedLine.endsWith(delimiter)) {
            const trailingWhitespaceLength = lineLength - trimmedLine.length;
            buffer = buffer.slice(0, buffer.length - trailingWhitespaceLength - delimiter.length - 1);
            pushStatement();
        }
    }

    if (buffer.trim()) pushStatement();
    return statements;
};
