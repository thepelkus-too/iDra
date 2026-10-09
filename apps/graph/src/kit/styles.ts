// Base CSS every editor shares: buttons, banners, popovers, sheets, toasts, menus, keypad, code drawer, raw bodies.
export const BASE_CSS = `
:root{--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--c-num:#f2a65a;--c-fn:#c792ea;--c-arr:#a6da95;--c-ref:#8ab4f8;--c-var:#ffd479;--bad:#e5645f;--warn:#e6a23c;--ok:#53c27a;color-scheme:dark}
html,body{overflow:hidden;height:100%}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
input,textarea{-webkit-user-select:text;user-select:text}
#app{height:100%}
button{min-height:44px;min-width:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);padding:0 12px;cursor:pointer}
button:disabled{opacity:.4}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--hi-accent);outline-offset:1px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn.primary{background:var(--hi-accent);color:#04201f;border-color:transparent;font-weight:600}
.btn.on{border-color:var(--hi-accent);background:rgba(90,200,200,.18)}
.btn.danger,.item.danger{color:var(--bad)}
.btn.wide{width:100%}
.btn.sm{min-height:44px;min-width:44px;padding:0 10px}
.icon{width:44px;padding:0;font-size:18px;line-height:1}
.icon.on{border-color:var(--hi-accent);background:rgba(90,200,200,.18)}
.linkish{border:0;background:none;color:var(--hi-accent);min-height:32px;padding:0 4px;text-decoration:underline}
.sub{display:block;color:var(--hi-dim);font-size:13px;font-weight:400;margin-top:2px}
.empty{color:var(--hi-dim);padding:14px}
.name{flex:1 1 120px;min-width:90px;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px;font-size:16px}
.switch-slot{display:inline-block}
.switch-slot .hi-switch>button{min-height:44px}
.about-slot .hi-about a{padding:0 2px;min-height:44px;display:inline-flex;align-items:center}
.seg{display:inline-flex;border:1px solid var(--hi-line);border-radius:10px;overflow:hidden}
.seg button{border:0;border-radius:0;background:var(--hi-bg)}
.seg button.on{background:var(--hi-accent);color:#04201f;font-weight:600}
.pill{font-size:12px;border-radius:999px;padding:3px 9px;background:rgba(0,0,0,.6);border:1px solid var(--hi-line)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.pill.err{color:var(--bad);border-color:var(--bad)}
.stage{position:relative;width:100%;height:100%;background:#000}
.stage iframe,.stage canvas{display:block;width:100%;height:100%;border:0}

/* ---- banners */
.banners{display:flex;flex-direction:column;gap:6px;padding:6px 6px 0}
.banners:empty{display:none;padding:0}
.banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--hi-line);border-radius:10px;padding:8px 10px;font-size:14px;background:var(--hi-panel)}
.banner .actions{display:flex;gap:6px;flex-wrap:wrap;margin:0}
.banner.trust,.banner.warn{background:#3a2f1c;border-color:var(--warn)}
.banner.err{background:#3a1f1f;border-color:var(--bad)}
.banner.info{background:#1d2534}
.banner .parts{margin:4px 0 0;padding-left:18px;font-size:13px;width:100%}

/* ---- overlays */
.overlays{position:fixed;inset:0;pointer-events:none;z-index:40}
.overlays>*{pointer-events:auto}
.overlays>.toasts{pointer-events:none}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5)}
.scrim.clear{background:transparent}
.popover{position:fixed;background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.6);overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:10px;z-index:2}
.popover .arrow{display:none}
.sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 20px));max-height:calc(100vh - 40px);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:16px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.6);z-index:2}
.sheet.wide{width:min(760px,calc(100vw - 20px))}
.sheet-head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px 6px 16px;border-bottom:1px solid var(--hi-line)}
.sheet-body{padding:12px 14px 16px;overflow:auto;-webkit-overflow-scrolling:touch}
.toasts{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;z-index:5;pointer-events:none}
.toast{pointer-events:auto;display:flex;align-items:center;gap:12px;background:#2a303a;border:1px solid var(--hi-line);border-radius:12px;padding:4px 6px 4px 14px;box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:14px}
.toast button{border:0;background:transparent;color:var(--hi-accent);font-weight:600}
.hud{position:fixed;transform:translateX(-50%);background:rgba(20,24,30,.96);border:1px solid var(--hi-accent);border-radius:12px;padding:6px 14px;text-align:center;pointer-events:none;z-index:3;display:flex;flex-direction:column;min-width:80px}
.hud b{font:600 22px var(--mono);color:var(--c-num)}
.hud small{font-size:11px;color:var(--hi-dim)}

/* ---- menus */
.menu{display:flex;flex-direction:column}
.menu-title{font:12px var(--mono);color:var(--hi-dim);padding:2px 8px 6px}
.menu .item{display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;border:0;background:transparent;border-radius:8px;min-height:46px;padding:0 10px}
.menu .item:active,.menu .item.on{background:rgba(90,200,200,.15)}
.menu .item kbd{font:11px var(--mono);color:var(--hi-dim)}
.menu .sep{height:1px;background:var(--hi-line);margin:4px 0}

/* ---- keypad */
.keypad{display:flex;flex-direction:column;gap:6px}
.kp-head{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--hi-dim);padding:0 2px}
.kp-title{font:13px var(--mono);color:var(--hi-text)}
.kp-display{font:600 28px var(--mono);text-align:right;padding:6px 10px;background:var(--hi-bg);border-radius:10px;min-height:52px;color:var(--c-num);overflow:hidden}
.kp-display.fresh{color:#8d7b5d}
.kp-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.kp-grid .key{min-height:50px;font:20px var(--mono);padding:0}
.kp-grid .key.wide{grid-column:span 2}
.kp-grid .key.util{color:var(--hi-dim)}
.kp-grid .key.nudge{font-size:15px;color:var(--hi-accent)}
.kp-grid .key.ok{background:var(--hi-accent);color:#04201f;font-weight:700;border-color:transparent}
.kp-reset{border:0;background:transparent;color:var(--hi-dim);font-size:13px;min-height:36px}

/* ---- sheets */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
.card{display:flex;flex-direction:column;gap:4px;align-items:stretch;text-align:left;padding:6px;height:auto;min-height:120px}
.card.on{border-color:var(--hi-accent)}
.cthumb{display:block;aspect-ratio:16/9;background:#0b0d10;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.cthumb img{width:100%;height:100%;object-fit:cover}
.cname{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card small{color:var(--hi-dim)}
.open-actions,.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.name-in{width:100%;min-height:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);padding:0 10px;font-size:16px;margin-bottom:8px}
.about p{margin:8px 0}
.code-edit{width:100%;font:14px/1.45 var(--mono);background:var(--hi-bg);color:var(--hi-text);border:1px solid var(--hi-line);border-radius:8px;padding:8px;resize:vertical}
.code-edit.big{min-height:180px}

/* ---- code drawer */
.codedrawer{height:100%;display:flex;flex-direction:column;min-height:0;background:var(--hi-bg)}
.cd-head{display:flex;align-items:center;gap:8px;padding:4px 6px 4px 12px;border-bottom:1px solid var(--hi-line);background:var(--hi-panel)}
.cd-head strong{flex:1}
.switch{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 6px}
.switch input{width:22px;height:22px}
.cm-host{flex:1;min-height:0;overflow:hidden}
.cm-host .cm-editor{height:100%}
.code-status{padding:6px 10px;font-size:13px;border-top:1px solid var(--hi-line)}
.code-status.err{color:var(--bad);background:rgba(229,100,95,.1)}
.code-status.info{color:var(--hi-dim)}

/* ---- raw */
.raw-body{display:flex;gap:6px;align-items:flex-start;min-width:0}
.raw-body .raw-text{flex:1;min-width:0;text-align:left;background:#11141a;border-color:#2a303a;padding:6px 8px;white-space:pre-wrap;overflow:hidden;font:12.5px/1.4 var(--mono)}
.raw-body .raw-text em{color:var(--hi-dim);font-size:11px}
.raw-body.open{flex-direction:column;align-items:stretch}
.status-dot{flex:none;width:12px;height:12px;border-radius:50%;margin-top:6px;background:#6b7587}
.status-dot.blocks{background:var(--ok)}
.status-dot.error{background:var(--bad)}
.rawnote{font-size:12px;color:var(--hi-dim)}
.rawnote.error{color:var(--bad)}

/* ---- meters */
.meter{display:inline-block;width:56px;height:8px;border-radius:4px;background:#0b0d10;overflow:hidden;vertical-align:middle;border:1px solid var(--hi-line)}
.meter i{display:block;height:100%;background:linear-gradient(90deg,#53c27a,#e6a23c,#e5645f)}

@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`
