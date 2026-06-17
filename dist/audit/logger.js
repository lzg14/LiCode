import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
export class AuditLogger {
    logDir;
    constructor(logDir) {
        this.logDir = logDir;
    }
    init() {
        mkdirSync(this.logDir, { recursive: true });
    }
    log(event) {
        const date = new Date().toISOString().split('T')[0];
        const file = join(this.logDir, `audit-${date}.jsonl`);
        // 确保目录存在
        const dir = dirname(file);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const line = JSON.stringify(event) + '\n';
        appendFileSync(file, line, { encoding: 'utf-8' });
    }
    logSecurity(event) {
        this.log({
            session: event.session ?? 'unknown',
            user: event.user ?? 'unknown',
            ...event,
        });
    }
}
