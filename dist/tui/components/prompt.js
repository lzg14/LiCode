import * as readline from 'readline';
import { bus, TUI_EVENTS } from '../bus';
import { state } from '../state';
export class Prompt {
    rl;
    currentInput = '';
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }
    async read() {
        return new Promise((resolve) => {
            const question = () => {
                this.rl.question('> ', (answer) => {
                    if (answer.trim()) {
                        resolve(answer);
                    }
                    else {
                        question();
                    }
                });
            };
            question();
        });
    }
    async run() {
        while (true) {
            const input = await this.read();
            state.currentInput = input;
            bus.emit(TUI_EVENTS.USER_INPUT, input);
            if (input.toLowerCase() === 'exit') {
                break;
            }
        }
    }
    close() {
        this.rl.close();
    }
}
