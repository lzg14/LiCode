import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
export class Storage {
    path;
    cache = new Map();
    constructor(name = 'tui') {
        this.path = join(process.env.HOME ?? '.', '.licode', `${name}.json`);
        this.load();
    }
    load() {
        try {
            if (existsSync(this.path)) {
                const data = JSON.parse(readFileSync(this.path, 'utf-8'));
                Object.entries(data).forEach(([k, v]) => this.cache.set(k, v));
            }
        }
        catch {
            // ignore
        }
    }
    get(key, defaultValue) {
        return this.cache.get(key) ?? defaultValue;
    }
    set(key, value) {
        this.cache.set(key, value);
        this.persist();
    }
    delete(key) {
        this.cache.delete(key);
        this.persist();
    }
    persist() {
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const data = Object.fromEntries(this.cache);
            writeFileSync(this.path, JSON.stringify(data, null, 2));
        }
        catch {
            // ignore
        }
    }
}
export const storage = new Storage();
