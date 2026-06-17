export class SkillRegistry {
    skills = new Map();
    register(skill) {
        this.skills.set(skill.name, skill);
    }
    findByTrigger(word) {
        for (const skill of this.skills.values()) {
            if (skill.triggerWords.some(tw => word.includes(tw))) {
                return skill;
            }
        }
        return undefined;
    }
    findByName(name) {
        return this.skills.get(name);
    }
    list() {
        return Array.from(this.skills.values());
    }
    unregister(name) {
        return this.skills.delete(name);
    }
}
export const globalSkillRegistry = new SkillRegistry();
