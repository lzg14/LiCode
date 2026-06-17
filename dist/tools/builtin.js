import { readFile, writeFile, stat } from 'fs/promises';
import { glob } from 'glob';
import { globalToolRegistry } from './registry';
export function registerBuiltinTools() {
    // Read tool
    globalToolRegistry.register({
        name: 'read',
        description: 'Read file content',
        inputSchema: { path: 'string' },
        handler: async ({ path }) => {
            try {
                const content = await readFile(path, 'utf-8');
                return { success: true, output: content };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        },
    });
    // Write tool
    globalToolRegistry.register({
        name: 'write',
        description: 'Write content to file',
        inputSchema: { path: 'string', content: 'string' },
        handler: async ({ path, content }) => {
            try {
                await writeFile(path, content, 'utf-8');
                return { success: true, output: `Written to ${path}` };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        },
    });
    // Glob tool
    globalToolRegistry.register({
        name: 'glob',
        description: 'Find files matching pattern',
        inputSchema: { pattern: 'string' },
        handler: async ({ pattern }) => {
            try {
                const files = await glob(pattern);
                return { success: true, output: files.join('\n') };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        },
    });
    // Stat tool
    globalToolRegistry.register({
        name: 'stat',
        description: 'Get file statistics',
        inputSchema: { path: 'string' },
        handler: async ({ path }) => {
            try {
                const info = await stat(path);
                return {
                    success: true,
                    output: JSON.stringify({
                        size: info.size,
                        mtime: info.mtime.toISOString(),
                        isFile: info.isFile(),
                        isDirectory: info.isDirectory(),
                    }),
                };
            }
            catch (e) {
                return { success: false, error: String(e) };
            }
        },
    });
}
