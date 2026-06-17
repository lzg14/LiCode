import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
export class FTS5Search {
    dbPath;
    indexPath;
    documents = new Map();
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.indexPath = dbPath.replace('.db', '.index.json');
        this.load();
    }
    load() {
        try {
            if (existsSync(this.indexPath)) {
                const data = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
                this.documents = new Map(data);
            }
        }
        catch {
            // ignore
        }
    }
    persist() {
        try {
            mkdirSync(dirname(this.indexPath), { recursive: true });
            writeFileSync(this.indexPath, JSON.stringify([...this.documents.entries()]));
        }
        catch {
            // ignore
        }
    }
    search(query, limit = 10) {
        const results = [];
        const q = query.toLowerCase();
        for (const [id, content] of this.documents.entries()) {
            if (content.toLowerCase().includes(q)) {
                results.push({ id, content, score: 1 });
            }
            if (results.length >= limit)
                break;
        }
        return results;
    }
    index(id, content) {
        this.documents.set(id, content);
        this.persist();
    }
}
