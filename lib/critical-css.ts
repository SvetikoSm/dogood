/**
 * Стили в <head>: лендинг читаем и с фото даже если основной CSS оборвался на мобиле.
 */
export const CRITICAL_CSS = `
:root{
  --background:#fff8ff;--foreground:#1f1633;--primary:#e11d8d;--primary-foreground:#fff;
  --muted-foreground:#6b5a81;--dogood-pink:#e11d8d;--dogood-muted:#6b5a81;--dogood-yellow:#facc15;
  --radius:0.75rem
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--background);color:var(--foreground);
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}
img,video{max-width:100%;height:auto;display:block}
a{color:inherit;text-decoration:none}
button,input,select,textarea{font:inherit}
.flex{display:flex}.inline-flex{display:inline-flex}.grid{display:grid}
.hidden{display:none!important}.block{display:block}.contents{display:contents}
.relative{position:relative}.absolute{position:absolute}.sticky{position:sticky}
.inset-0{inset:0}.top-0{top:0}.left-0{left:0}.right-0{right:0}
.w-full{width:100%}.h-full{height:100%}.min-w-0{min-width:0}.max-w-full{max-width:100%}
.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.flex-col{flex-direction:column}
.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.justify-center{justify-content:center}
.justify-between{justify-content:space-between}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}
.mx-auto{margin-left:auto;margin-right:auto}.max-w-6xl{max-width:72rem}
.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}
.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}
.text-center{text-align:center}.uppercase{text-transform:uppercase}.font-bold{font-weight:700}
.font-semibold{font-weight:600}.text-xs{font-size:.75rem;line-height:1rem}
.text-sm{font-size:.875rem;line-height:1.25rem}.text-base{font-size:1rem;line-height:1.5rem}
.text-lg{font-size:1.125rem;line-height:1.75rem}
.text-foreground{color:var(--foreground)}.text-muted-foreground{color:var(--muted-foreground)}
.text-fuchsia-700{color:#a21caf}.text-neutral-700{color:#404040}.text-neutral-900{color:#171717}
.bg-white{background:#fff}.bg-background{background:var(--background)}
.bg-white\\/65{background:rgba(255,255,255,.65)}.bg-white\\/75{background:rgba(255,255,255,.75)}
.bg-white\\/80{background:rgba(255,255,255,.8)}.bg-fuchsia-600{background:#c026d3}
.rounded-full{border-radius:9999px}.rounded-xl{border-radius:.75rem}.rounded-2xl{border-radius:1rem}
.border{border:1px solid rgba(171,112,211,.28)}.border-fuchsia-200{border-color:#f5d0fe}
.border-t{border-top:1px solid rgba(171,112,211,.28)}
.overflow-hidden{overflow:hidden}.overflow-x-auto{overflow-x:auto}
.whitespace-nowrap{white-space:nowrap}.scroll-mt-24{scroll-margin-top:6rem}
.z-10{z-index:10}.z-50{z-index:50}
.object-cover{object-fit:cover}.object-contain{object-fit:contain}
.product-photo-frame{aspect-ratio:4/5;width:100%;min-width:0;max-width:100%;overflow:hidden;
  border-radius:.75rem;background:#fff;position:relative}
.product-photo-frame img{width:100%;height:100%;object-fit:cover;display:block}
.site-color-bg{background:linear-gradient(180deg,#fff8ff 0%,#fffef7 55%,#f8f4ff 100%)}
@media(min-width:64rem){
  .lg\\:hidden{display:none!important}
  .lg\\:flex{display:flex!important}
  .lg\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`.trim();
