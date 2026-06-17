import { themes } from './theme';
export const state = {
    theme: themes.dark,
    phase: 'OBSERVE',
    currentInput: '',
    isProcessing: false,
    messages: [],
    activeDialog: null,
};
