export const CSS = `
#app{max-width:1200px;margin:0 auto;padding:16px 16px 32px;display:grid;gap:12px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
h1{margin:0;font-size:22px}
h2{margin:0 0 8px;font-size:18px}
.row{display:flex;gap:8px;align-items:center}
.row.wrap{flex-wrap:wrap}
.row.end{justify-content:flex-end;margin-top:12px}
.dim{color:var(--hi-dim);font-size:13px}
.pad{padding:10px 12px}
button,.btn,input[type=text],select{min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text)}
button:active{filter:brightness(1.2)}
button.primary{background:var(--hi-accent);border-color:transparent;color:#04201f;font-weight:600}
button.danger{color:var(--hi-bad);border-color:var(--hi-bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;align-items:start}
.empty{grid-column:1/-1;color:var(--hi-dim)}
.card{position:relative;background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:14px;padding:10px;display:grid;gap:8px}
.card.hl{outline:2px solid var(--hi-accent)}
.card .open{display:block;text-decoration:none}
.thumb{aspect-ratio:16/9;border-radius:10px;background-size:cover;background-position:center;display:grid;place-items:center;color:rgba(255,255,255,.8);font-size:34px;font-weight:700}
.meta .name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.risk{color:var(--hi-warn)}
.card .row button:first-child{flex:1}
.menu{position:absolute;right:10px;left:10px;bottom:56px;z-index:20;background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:12px;padding:6px;box-shadow:0 10px 30px rgba(0,0,0,.45);display:grid}
.menu[hidden]{display:none}
.menu a,.menu button{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:0;background:transparent;color:var(--hi-text);text-decoration:none;border-radius:8px;text-align:left}
.menu a:hover,.menu button:hover{background:var(--hi-bg)}
.menu small{color:var(--hi-dim)}
.modal-back{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:1000;padding:16px}
.modal{width:min(560px,100%);max-height:90vh;overflow:auto;background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:16px;padding:16px;display:grid;gap:10px}
.modal textarea{width:100%;min-height:180px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);padding:10px;font:13px/1.4 ui-monospace,Menlo,monospace}
.modal input[type=text]{width:100%}
.check{display:flex;gap:8px;align-items:center}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0}
.facts dt{color:var(--hi-dim)}
.facts dd{margin:0}
.note-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));background:var(--hi-panel);border:1px solid var(--hi-line);padding:10px 14px;border-radius:12px;z-index:2000;max-width:90vw}
.storage{margin:0}
footer{padding-top:12px;border-top:1px solid var(--hi-line)}
`
