import { FTS5Search } from './fts5';
export class Memory {
    fts;
    constructor(dbPath) {
        this.fts = new FTS5Search(dbPath);
    }
    async store(entry) {
        this.fts.index(entry.id, entry.content);
    }
    async search(query, limit = 10) {
        return this.fts.search(query, limit);
    }
    async recall(query) {
        const results = await this.search(query);
        return results.map(r => r.content);
    }
}
