import { watch, existsSync, readFileSync } from 'fs';
import { globalSkillRegistry } from './registry';
export class SkillHotReload {
    watchers = new Map();
    watch(skillPath) {
        if (!existsSync(skillPath))
            return;
        const watcher = watch(skillPath, (eventType) => {
            if (eventType === 'change') {
                this.reload(skillPath);
            }
        });
        this.watchers.set(skillPath, () => watcher.close());
    }
    reload(skillPath) {
        try {
            const content = readFileSync(skillPath, 'utf-8');
            const skill = JSON.parse(content);
            globalSkillRegistry.register(skill);
            console.log(`Skill reloaded: ${skill.name}`);
        }
        catch (e) {
            console.error(`Failed to reload skill: ${skillPath}`, e);
        }
    }
    unwatch(skillPath) {
        const close = this.watchers.get(skillPath);
        if (close) {
            close();
            this.watchers.delete(skillPath);
        }
    }
    unwatchAll() {
        for (const close of this.watchers.values()) {
            close();
        }
        this.watchers.clear();
    }
}
export const skillHotReload = new SkillHotReload();
