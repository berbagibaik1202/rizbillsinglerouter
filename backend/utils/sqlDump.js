const IGNORED_TABLE_PATTERNS = [/database_restore_jobs/i];

const shouldSkipStatement = (statement) =>
    IGNORED_TABLE_PATTERNS.some((pattern) => pattern.test(statement));

export const normalizeSqlDumpContent = (content = '') => {
    const text = String(content ?? '');

    return text
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\/\*!\d+\s*([\s\S]*?)\*\//g, '$1')
        .replace(/\/\*(?!\!)[\s\S]*?\*\//g, '')
        .replace(/^\s*--.*$/gm, '')
        .replace(/^\s*#.*$/gm, '');
};

export const splitSqlStatements = (sqlDump = '') => {
    const sql = normalizeSqlDumpContent(sqlDump);
    const statements = [];

    let delimiter = ';';
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inBacktick = false;
    let escapeNext = false;

    const flush = () => {
        const statement = current.trim();
        if (statement && !shouldSkipStatement(statement)) {
            statements.push(statement);
        }
        current = '';
    };

    for (const line of sql.split('\n')) {
        const delimiterMatch = !inSingleQuote && !inDoubleQuote && !inBacktick
            ? line.trim().match(/^DELIMITER\s+(.+)$/i)
            : null;

        if (delimiterMatch) {
            flush();
            delimiter = delimiterMatch[1].trim() || ';';
            continue;
        }

        if (!line && !current) {
            continue;
        }

        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            current += char;

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (inSingleQuote) {
                if (char === '\\') {
                    escapeNext = true;
                } else if (char === '\'') {
                    inSingleQuote = false;
                }
                continue;
            }

            if (inDoubleQuote) {
                if (char === '\\') {
                    escapeNext = true;
                } else if (char === '"') {
                    inDoubleQuote = false;
                }
                continue;
            }

            if (inBacktick) {
                if (char === '`') {
                    inBacktick = false;
                }
                continue;
            }

            if (char === '\'') {
                inSingleQuote = true;
                continue;
            }

            if (char === '"') {
                inDoubleQuote = true;
                continue;
            }

            if (char === '`') {
                inBacktick = true;
                continue;
            }

            if (delimiter && current.trimEnd().endsWith(delimiter)) {
                current = current.slice(0, -delimiter.length).trimEnd();
                flush();
            }
        }

        if (current && !current.endsWith('\n')) {
            current += '\n';
        }
    }

    flush();
    return statements;
};
