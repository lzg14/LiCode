const DEFAULT_WHITELIST = [
    'git', 'cargo', 'npm', 'npx', 'pnpm',
    'ruff', 'mypy', 'eslint', 'prettier', 'biome', 'tsc',
    'psql', 'mysql', 'docker', 'playwright',
    'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'tree',
    'curl', 'wget', 'gh',
    'pip', 'uv',
    'vitest', 'prisma',
    'node', 'next',
];
const BLOCKED_COMMANDS = [
    'bash', 'sh', 'zsh',
    'rm', 'del',
    'sudo', 'su',
    'chmod', 'chown',
    'python', 'python3',
    'exec', 'eval',
];
export function isCommandAllowed(command) {
    const base = command.split(' ')[0];
    if (BLOCKED_COMMANDS.includes(base))
        return false;
    return DEFAULT_WHITELIST.includes(base);
}
export { DEFAULT_WHITELIST, BLOCKED_COMMANDS };
