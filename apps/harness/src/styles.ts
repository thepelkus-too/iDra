export const CSS = `
html,body{overflow:hidden}
#app{height:100%;display:grid;grid-template-rows:auto 1fr auto;gap:0}
.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--hi-line);background:var(--hi-panel)}
.top .name{flex:1;min-width:120px;min-height:40px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px}
button,select{min-height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text)}
button.primary{background:var(--hi-accent);color:#04201f;border-color:transparent;font-weight:600}
button.warn{border-color:var(--hi-warn);color:var(--hi-warn)}
.main{display:grid;grid-template-columns:minmax(300px,42%) 1fr;min-height:0}
@media (max-width:760px){.main{grid-template-columns:1fr;grid-template-rows:45% 1fr}.stage-wrap{order:-1}}
.panel{display:grid;grid-template-rows:auto 1fr;min-height:0;border-right:1px solid var(--hi-line)}
.tabs{display:flex;gap:4px;padding:6px;border-bottom:1px solid var(--hi-line);overflow:auto}
.tabs button{flex:0 0 auto}
.tabs button[aria-selected=true]{background:var(--hi-accent);color:#04201f;border-color:transparent}
.tab{overflow:auto;padding:10px;min-height:0;display:none}
.tab.on{display:block}
#tab-code.on{display:flex;flex-direction:column;gap:6px}
textarea.code{width:100%;flex:1;min-height:140px;resize:none;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);padding:10px;font:13px/1.45 ui-monospace,Menlo,Consolas,monospace;tab-size:2}
.status{font-size:12px;color:var(--hi-dim);padding:6px 2px;min-height:40px}
.stage-wrap{position:relative;background:#000;min-height:0}
.stage{position:absolute;inset:0}
.errors{position:absolute;left:8px;right:8px;bottom:8px;max-height:40%;overflow:auto;display:grid;gap:4px;pointer-events:none}
.errors .err{pointer-events:auto;background:rgba(40,10,10,.92);color:#ffd7d3;border:1px solid var(--hi-bad);border-radius:8px;padding:6px 10px;font:12px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
.errors .err.warning{background:rgba(40,30,5,.92);border-color:var(--hi-warn);color:#ffe8b8}
.banner{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:rgba(230,162,60,.14);border:1px solid var(--hi-warn);border-radius:10px;padding:8px 10px;margin-bottom:8px}
.banner[hidden]{display:none}
.knob{display:grid;grid-template-columns:1fr 84px;gap:2px 8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--hi-line)}
.knob label{color:var(--hi-dim);font-size:12px;grid-column:1/-1}
.knob input[type=range]{width:100%;min-height:32px}
.knob input[type=number]{width:100%;min-height:36px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);padding:0 6px}
table.caps,table.caps tbody{display:block;width:100%;font-size:13px}
table.caps tr{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:7px 2px;border-bottom:1px solid var(--hi-line)}
table.caps td{display:block;padding:0}
table.caps td:first-child{font-weight:600}
table.caps td:nth-child(2){text-align:right;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
table.caps td:nth-child(3){grid-column:1/-1;color:var(--hi-dim);word-break:break-word}
.st-yes{color:#53c27a}.st-no{color:var(--hi-bad)}.st-partial{color:var(--hi-warn)}.st-unknown{color:var(--hi-dim)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}
pre.report{white-space:pre-wrap;font-size:12px;background:var(--hi-bg);border:1px solid var(--hi-line);border-radius:8px;padding:8px}
input[type=text]{min-height:40px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);padding:0 10px}
.foot{padding:2px 10px;border-top:1px solid var(--hi-line);background:var(--hi-panel)}
`
