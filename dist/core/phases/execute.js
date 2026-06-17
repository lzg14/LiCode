export async function execute(ctx) {
    return {
        phase: 'VERIFY',
        deliverable: ctx.intermediateResults,
    };
}
