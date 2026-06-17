export class SafeBoundaryImpl {
    baseline = null;
    canProceed() {
        return this.baseline !== null;
    }
    getSnapshot() {
        return {
            baseline: [],
            midConversationMessages: [],
            timestamp: Date.now(),
        };
    }
    validateChanges(snapshot) {
        return true;
    }
    setBaseline(baseline) {
        this.baseline = baseline;
    }
}
