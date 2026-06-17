export const themes = {
    dark: {
        name: 'dark',
        bg: '#1e1e2e',
        fg: '#cdd6f4',
        accent: '36', // ANSI cyan
        error: '91', // ANSI red
        warning: '93', // ANSI yellow
        success: '92', // ANSI green
        dim: '90', // ANSI bright black
    },
    light: {
        name: 'light',
        bg: '#eff1f5',
        fg: '#4c4f69',
        accent: '34', // ANSI blue
        error: '196', // ANSI red
        warning: '208', // ANSI orange
        success: '28', // ANSI green
        dim: '246', // ANSI gray
    },
};
export function getTheme() {
    return themes.dark; // 默认 dark
}
