export class SkillSelfImproveImpl {
    executions = new Map();
    recordExecution(skillName, success, feedback) {
        const records = this.executions.get(skillName) ?? [];
        records.push({
            skillName,
            timestamp: Date.now(),
            success,
            feedback,
        });
        // 保留最近 100 条
        if (records.length > 100)
            records.shift();
        this.executions.set(skillName, records);
    }
    async generateImprovement(skillName) {
        const records = this.executions.get(skillName) ?? [];
        const failures = records.filter(r => !r.success);
        if (failures.length < 3)
            return null;
        const feedback = failures
            .map(f => f.feedback)
            .filter(Boolean)
            .join('\n');
        return `Based on ${failures.length} failures:\n${feedback}`;
    }
}
export const skillSelfImprove = new SkillSelfImproveImpl();
