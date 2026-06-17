import { observe } from './phases/observe';
import { think } from './phases/think';
import { plan } from './phases/plan';
import { build } from './phases/build';
import { execute } from './phases/execute';
import { verify } from './phases/verify';
import { learn } from './phases/learn';
const PHASE_ORDER = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN'];
export class CoreLoop {
    config;
    llm;
    constructor(config, llm) {
        this.config = config;
        this.llm = llm;
    }
    async run(ctx) {
        // 如果外部没有传入 llm，使用构造时注入的
        const effectiveLlm = ctx.llm ?? this.llm;
        ctx = { ...ctx, llm: effectiveLlm };
        let currentPhase = ctx.phase;
        while (currentPhase !== 'DONE') {
            const result = await this.executePhase(currentPhase, ctx);
            ctx = { ...ctx, ...result };
            const nextIndex = PHASE_ORDER.indexOf(currentPhase) + 1;
            currentPhase = nextIndex < PHASE_ORDER.length ? PHASE_ORDER[nextIndex] : 'DONE';
        }
        return ctx.userInput;
    }
    async executePhase(phase, ctx) {
        switch (phase) {
            case 'OBSERVE':
                return observe(ctx);
            case 'THINK':
                return think(ctx);
            case 'PLAN':
                return plan(ctx);
            case 'BUILD':
                return build(ctx);
            case 'EXECUTE':
                return execute(ctx);
            case 'VERIFY':
                return verify(ctx);
            case 'LEARN':
                return learn(ctx);
            default:
                throw new Error(`Unknown phase: ${phase}`);
        }
    }
}
