/**
 * Минимальные стили в <head>: если внешний CSS не дошёл (Safari-кэш, обрыв),
 * страница всё равно читаема до автоперезагрузки SafariStylesRecovery.
 */
export const CRITICAL_CSS = `
:root{--background:#fff8ff;--foreground:#1f1633;--dogood-pink:#e11d8d}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.5}
a{color:inherit;text-decoration:none}
.flex{display:flex}
.hidden{display:none!important}
@media(min-width:64rem){.lg\\:hidden{display:none!important}.lg\\:flex{display:flex!important}}
.site-color-bg{background:linear-gradient(180deg,#fff8ff 0%,#fffef7 55%,#f8f4ff 100%)}
`.trim();
