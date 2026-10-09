// Blocks styles (the shared chrome is in kit/styles.ts). Row heights are set inline from view.ts; widths follow the content.
export const CSS = `
:root{--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--bad:#e5645f;--warn:#e6a23c;--ok:#53c27a;
--t-src:#45b5b5;--t-coord:#6f9be8;--t-color:#e8944a;--t-combine:#b07ad8;--t-combineCoord:#d877bf;--t-unknown:#7d8592;--t-plugin:#7fbf6a;
--t-cap:#53c27a;--t-def:#8a9bb5;--t-setup:#9a8f6a;--t-rep:#e3c065;color-scheme:dark}
html,body{overflow:hidden;height:100%;overscroll-behavior:none}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
input,textarea{-webkit-user-select:text;user-select:text}
#app{height:100%}
button{min-height:44px;min-width:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);padding:0 12px;cursor:pointer}
button:disabled{opacity:.4}
button.on,.btn.on{border-color:var(--hi-accent);color:var(--hi-accent);background:rgba(90,200,200,.12)}
.btn.sm{min-height:34px;min-width:34px;padding:0 8px;font-size:13px}
.btn.danger{color:var(--bad)}
.app{position:relative;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--hi-bg)}
.topbar{display:flex;align-items:center;gap:6px;padding:6px max(8px,env(safe-area-inset-right)) 6px max(8px,env(safe-area-inset-left));padding-top:max(6px,env(safe-area-inset-top));border-bottom:1px solid var(--hi-line);background:var(--hi-panel);flex-wrap:wrap;position:relative;z-index:20}
.topbar .name{flex:0 1 220px;min-width:90px;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px;font-size:16px;color:var(--hi-text)}
.topbar .grow{flex:1}
.topbar .dice{font-size:20px}
.main{position:relative;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}
.app.code-open.lay-land .main{grid-template-columns:minmax(0,1fr) min(40%,500px)}
.app.code-open.lay-port .main{grid-template-rows:minmax(0,1fr) 36%}
.ws-col{position:relative;min-height:0;min-width:0;display:grid}
.codepane{min-height:0;min-width:0;border-left:1px solid var(--hi-line);background:var(--hi-bg);position:relative}
.app.lay-port .codepane{border-left:0;border-top:1px solid var(--hi-line)}
.codepane .codedrawer{position:absolute;inset:0}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 max(10px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(10px,env(safe-area-inset-left));border-top:1px solid var(--hi-line);background:var(--hi-panel);min-height:34px}
.foot .runinfo{font:11px var(--mono);color:var(--hi-dim);white-space:nowrap}
.banners-wrap{position:absolute;left:8px;right:8px;top:8px;z-index:6;pointer-events:none}
.app.lay-land.pal-open .banners-wrap{left:318px}
.banners-wrap>*{pointer-events:auto}

/* ---- workspace */
.workspace{position:relative;overflow:hidden;touch-action:none;min-height:0;background:var(--hi-bg);background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:24px 24px}
.world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.ws-empty{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);color:var(--hi-dim);font-size:15px;text-align:center;max-width:340px;pointer-events:none}
.app.lay-land.pal-open .ws-empty{left:calc(50% + 150px)}
.script{position:absolute;left:0;top:0;box-sizing:border-box}
.trash{position:absolute;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;background:rgba(229,100,95,.15);border:2px dashed var(--bad);z-index:7}
.trash.hot{background:rgba(229,100,95,.45);transform:translateX(-50%) scale(1.12)}

/* ---- blocks */
.t-src{--tc:var(--t-src)}.t-coord{--tc:var(--t-coord)}.t-color{--tc:var(--t-color)}.t-combine{--tc:var(--t-combine)}.t-combineCoord{--tc:var(--t-combineCoord)}.t-unknown{--tc:var(--t-unknown)}.t-plugin{--tc:var(--t-plugin)}
.stack{display:flex;flex-direction:column;align-items:flex-start;width:max-content}
.block{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:0 10px 0 8px;min-width:200px;width:100%;white-space:nowrap;
  background:color-mix(in srgb,var(--tc) 34%,#1a1d24);border:1px solid color-mix(in srgb,var(--tc) 70%,#000);border-left:6px solid var(--tc);border-radius:6px;color:#f1f3f6;touch-action:none;cursor:grab}
.block+.block{margin-top:-1px}
.block.hat{border-radius:22px 22px 6px 6px;padding-top:8px}
.block.stk::before{content:'';position:absolute;left:22px;top:-1px;width:22px;height:5px;border-radius:0 0 5px 5px;background:var(--hi-bg);opacity:.8}
.block .ticon{font-size:16px;width:18px;text-align:center;color:var(--tc);filter:brightness(1.35)}
.block .fname{font:700 15px var(--mono);color:#fff;padding:0 2px;min-height:0;min-width:0;background:transparent;border:0}
.block .unknown-name{border:1px dashed #aaa;border-radius:6px;min-height:34px;padding:0 8px}
.block.unknown{--tc:var(--t-unknown);background:#2b2e34;border-style:dashed}
.block.sel,.script.sel{box-shadow:0 0 0 3px var(--hi-accent)}
.block.err{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 2px var(--bad)}50%{box-shadow:0 0 0 7px rgba(229,100,95,.25)}}
.block .argtext{font:12px var(--mono);color:#cfd3da}
.block .addarg{border-style:dashed}
.folded-n{color:#d6dae1;font-size:13px}
.cap{box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:0 10px 0 8px;min-width:200px;width:100%;background:color-mix(in srgb,var(--t-cap) 26%,#1a1d24);border:1px solid color-mix(in srgb,var(--t-cap) 60%,#000);border-left:6px solid var(--t-cap);border-radius:6px 6px 18px 18px;margin-top:-1px;font-size:14px;color:#e8f5ec}
.cap .outpick{font:600 14px var(--mono)}
.cap.open{background:transparent;border:2px dashed #6b7280;border-left:6px dashed #6b7280;color:var(--hi-dim)}
.cap .nr{font-style:italic}
.script.unplugged>.stack{opacity:.62}
.script.shadowed>.stack{opacity:.55}
.badge{position:absolute;right:0;top:-22px;font-size:11px;border-radius:6px;padding:1px 6px;border:1px solid var(--hi-line);color:var(--hi-dim);white-space:nowrap}
.badge.shadow{color:var(--bad);border-color:var(--bad)}

/* inputs: round slots (numbers, reporters), square sockets (pictures) */
.slot{display:inline-flex;align-items:center;gap:4px;border-radius:20px;min-height:36px}
.slot>.nl{font-size:11px;color:#c8ccd4}
.slot .numslider{height:34px;border-radius:17px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);min-width:74px}
.numslider{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid var(--hi-line);overflow:hidden;touch-action:none;cursor:ew-resize}
.numslider .fill{position:absolute;left:0;top:0;bottom:0;background:rgba(242,166,90,.22);pointer-events:none}
.numslider .nl{position:relative;font-size:11px;color:#c8ccd4}
.numslider .nv{position:relative;font:600 14px var(--mono);color:#ffc387}
.numslider.dim .nv{color:#a99377;font-weight:400}
.numslider:focus-visible{outline:2px solid var(--hi-accent)}
.socket{position:relative;box-sizing:border-box;display:inline-flex;align-items:center;padding:10px 8px;min-width:140px;border:2px dashed rgba(255,255,255,.35);border-radius:8px;background:rgba(0,0,0,.28)}
.socket>.slabel{position:absolute;left:8px;top:-9px;font-size:10px;color:#c8ccd4;line-height:14px;padding:0 4px;background:#232730;border-radius:4px}
.socket>.stack{margin-top:2px}
.empty-socket{font-size:12px;color:#9aa1ab;font-style:italic;padding:0 4px}
.rep{display:inline-flex;align-items:center;gap:4px;min-height:36px;padding:0 10px;border-radius:999px;font:600 13px var(--mono);color:#1a1d24;background:var(--t-rep);border:1px solid rgba(0,0,0,.35);touch-action:none;cursor:grab;white-space:nowrap}
.rep .rname{font-weight:700}
.rep .numslider{height:30px;border-radius:15px;background:rgba(0,0,0,.55);min-width:64px}
.rep .btn.sm{min-height:30px;min-width:30px;padding:0 6px;font-size:12px;background:rgba(0,0,0,.5);color:#fff}
.r-out{background:#53c27a}.r-src{background:#5ac8c8}.r-var{background:#a8b6cc}
.r-js{background:#3a3f4a;color:#e7e9ee}
.r-js .jstext{min-height:30px;max-width:240px;overflow:hidden;text-overflow:ellipsis;background:transparent;border:0;font:12px var(--mono);color:#e7e9ee;padding:0 2px}
.r-math{background:#8bd17c}
.mhole{display:inline-flex;align-items:center;gap:3px;border-radius:999px;padding:0 2px}
.mhole.leaf{background:rgba(0,0,0,.18);padding:0 8px;min-height:30px}
.mhole .numslider{height:28px;min-width:54px;border-radius:14px;background:rgba(0,0,0,.55);padding:0 8px}
.r-pattern{background:#a6da95}
.r-pattern .bars{display:flex;align-items:flex-end;gap:2px;height:34px}
.r-pattern .bar{position:relative;width:26px;height:100%;border-radius:3px;background:rgba(0,0,0,.25);touch-action:none;cursor:ns-resize}
.r-pattern .bar i{position:absolute;left:0;right:0;bottom:0;background:#2f5d26;border-radius:3px}
.r-pattern .bar small{position:absolute;left:0;right:0;top:0;font-size:8px;overflow:hidden;text-align:center;color:#0d1a0a}

/* drop targets light up for what you hold; the one under the finger glows */
.workspace.d-tex .socket,.workspace.d-script .socket{border-color:var(--hi-accent);background:rgba(90,200,200,.12)}
.workspace.d-value .slot,.workspace.d-math .slot,.workspace.d-math .mhole,.workspace.d-value .mhole{outline:2px dashed rgba(255,212,121,.7);outline-offset:1px}
.workspace.d-stack .block,.workspace.d-cap .block,.workspace.d-stack .cap,.workspace.d-cap .cap{box-shadow:inset 0 -3px 0 rgba(255,255,255,.25)}
.hot{outline:3px solid #fff!important;outline-offset:2px;box-shadow:0 0 0 6px rgba(90,200,200,.45)!important}
.block.hot,.cap.hot{outline:0!important;box-shadow:inset 0 -6px 0 #fff,0 6px 0 -2px var(--hi-accent)!important}
.lifted{opacity:.35}
.ghost{opacity:.9;filter:drop-shadow(0 12px 18px rgba(0,0,0,.55))}
.ghost .block,.ghost .cap{width:auto}

/* other statements */
.bubble{display:flex;background:#f6e7a1;color:#2b2610;border-radius:12px 12px 12px 2px;box-shadow:0 4px 10px rgba(0,0,0,.3);touch-action:none;cursor:grab;overflow:hidden}
.bubble .bubtext{flex:1;min-height:0;border:0;background:transparent;color:inherit;text-align:left;white-space:pre;overflow:hidden;font-size:13px;line-height:18px;padding:9px 12px}
.rawblk{display:flex;flex-direction:column;background:#20242c;border:1px solid #4a5160;border-left:6px solid #8892a6;border-radius:8px;overflow:hidden;touch-action:none}
.rawblk .bhead{display:flex;align-items:center;gap:8px;padding:6px 10px;height:30px;box-sizing:border-box}
.rawblk .bhead small{color:var(--hi-dim)}
.rawblk textarea{flex:1;margin:0 8px 8px;font:12px/17px var(--mono);background:#14171c;color:#e5e7eb;border:1px solid var(--hi-line);border-radius:6px;resize:none;padding:4px 6px}
.defblk,.setup{display:flex;align-items:center;gap:8px;padding:0 10px 0 8px;white-space:nowrap;border-radius:8px;touch-action:none;cursor:grab;color:#f1f3f6}
.defblk{--tc:var(--t-def);background:color-mix(in srgb,var(--t-def) 32%,#1a1d24);border:1px solid color-mix(in srgb,var(--t-def) 70%,#000);border-left:6px solid var(--t-def)}
.defblk .defname{font:700 14px var(--mono)}
.setup{background:color-mix(in srgb,var(--t-setup) 30%,#1a1d24);border:1px solid color-mix(in srgb,var(--t-setup) 70%,#000);border-left:6px solid var(--t-setup);border-radius:22px 22px 8px 8px}
.setup .jsval{min-height:34px;max-width:170px;overflow:hidden;background:rgba(0,0,0,.3);border:1px solid var(--hi-line);border-radius:8px}
.setup .jsval code{font:12px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.loose{opacity:.75;outline:2px dashed #6b7280;outline-offset:4px;border-radius:6px;touch-action:none;cursor:grab}
.loose .block{pointer-events:none}
.loose-tag{position:absolute;left:0;top:-24px;font-size:11px;color:var(--hi-dim);white-space:nowrap}

/* ---- palette: left flyout (landscape), bottom drawer (portrait) */
.palette{position:absolute;z-index:8;background:var(--hi-panel);display:flex;flex-direction:column;box-shadow:0 0 30px rgba(0,0,0,.45)}
.app.lay-land .palette{left:0;top:0;bottom:0;width:300px;border-right:1px solid var(--hi-line);padding-left:env(safe-area-inset-left)}
.app.lay-port .palette{left:0;right:0;bottom:0;max-height:42%;border-top:1px solid var(--hi-line);padding-bottom:env(safe-area-inset-bottom)}
.palette[data-drop=trash]{outline:3px dashed var(--bad);outline-offset:-3px}
.palette.hot{background:rgba(229,100,95,.18)}
.pal-trash{position:absolute;inset:auto 0 0 0;padding:14px;text-align:center;color:var(--bad);font-weight:600;background:rgba(0,0,0,.4)}
.pal-head{display:flex;gap:6px;padding:8px}
.pal-search{flex:1;min-width:0;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);border-radius:10px;padding:0 10px;font-size:16px}
.pal-tabs{display:flex;gap:4px;padding:0 8px 6px;flex-wrap:wrap}
.app.lay-port .pal-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}
.pal-tabs .tab{white-space:nowrap;font-size:13px;padding:0 9px;border-left:4px solid var(--gc,#666)}
.g-Sources{--gc:var(--t-src)}.g-Geometry{--gc:var(--t-coord)}.g-Color{--gc:var(--t-color)}.g-Blend{--gc:var(--t-combine)}.g-Modulate{--gc:var(--t-combineCoord)}.g-Reporters{--gc:var(--t-rep)}.g-Math{--gc:#8bd17c}.g-Setup{--gc:var(--t-setup)}.g-Plugins{--gc:var(--t-plugin)}
.pal-items{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:4px 10px 12px;-webkit-overflow-scrolling:touch}
.app.lay-port .pal-items{flex-direction:row;flex-wrap:wrap;align-content:flex-start}
.pal-item{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:48px;padding:0 12px 0 8px;font:600 14px var(--mono);color:#fff;touch-action:none;cursor:grab;
  background:color-mix(in srgb,var(--tc,#777) 34%,#1a1d24);border:1px solid color-mix(in srgb,var(--tc,#777) 70%,#000);border-left:6px solid var(--tc,#777);border-radius:6px}
.pal-item.p-hat{border-radius:20px 20px 6px 6px}
.pal-item.p-rep{border-radius:999px;color:#1a1d24;background:var(--t-rep);border:1px solid rgba(0,0,0,.35)}
.pal-item.r-out{background:#53c27a}.pal-item.r-src{background:#5ac8c8}.pal-item.r-var{background:#a8b6cc}.pal-item.r-math{background:#8bd17c}
.pal-item.p-cap{--tc:var(--t-cap);border-radius:6px 6px 18px 18px}
.pal-item.p-setup{--tc:var(--t-setup)}
.pal-item .pthumb{width:56px;height:32px;border-radius:5px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--hi-dim);flex:none}
.pal-item .pthumb img{width:100%;height:100%;object-fit:cover}
.pal-item .ticon{width:18px;text-align:center}
.empty{color:var(--hi-dim);padding:12px;font-size:13px}
.helpcard{display:flex;flex-direction:column;gap:6px;padding:10px}
.helpcard p{margin:0;font-size:15px}
.helpcard small{color:var(--hi-dim);font:12px var(--mono)}

/* ---- selection bar */
.selbar{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));z-index:7;display:flex;align-items:center;gap:6px;padding:6px;border-radius:14px;background:var(--hi-panel);border:1px solid var(--hi-line);box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:calc(100% - 24px);overflow-x:auto}
.app.lay-land.pal-open .selbar{left:calc(50% + 150px);max-width:calc(100% - 324px)}
.app.lay-port.pal-open .selbar{bottom:calc(42% + 10px)}
.selbar .btn{white-space:nowrap}
.scrub{display:flex;align-items:center;gap:6px;padding:0 6px;font-size:18px}
.scrub input{width:140px;min-height:44px}
.scrub small{font:12px var(--mono);color:var(--hi-dim)}

/* ---- PiP output + full screen */
.pip{position:absolute;z-index:9;border-radius:12px;overflow:hidden;border:1px solid var(--hi-line);background:#000;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.pip .stage-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size}
.stage-slot>.stage{position:relative;width:100%;height:100%;flex:none}
@supports (width:1cqw){.stage-slot>.stage{width:min(100cqw,177.78cqh);height:min(100cqh,56.25cqw)}}
.pip-grip{position:absolute;left:0;right:0;top:0;height:40%;touch-action:none;cursor:move;display:flex;gap:4px;padding:4px;align-items:flex-start}
.pip-full{position:absolute;right:4px;top:4px;background:rgba(0,0,0,.5);border-color:transparent}
.pip-resize{position:absolute;right:0;bottom:0;width:36px;height:36px;touch-action:none;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,rgba(255,255,255,.35) 55%,rgba(255,255,255,.35) 62%,transparent 62%,transparent 72%,rgba(255,255,255,.35) 72%,rgba(255,255,255,.35) 79%,transparent 79%)}
.pip.perform{position:fixed;inset:0;border:0;border-radius:0;z-index:40}
.pip.perform .exit{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));background:rgba(0,0,0,.55)}
.pill{font-size:12px;border-radius:999px;padding:3px 9px;background:rgba(0,0,0,.6);border:1px solid var(--hi-line)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.pill.err{color:var(--bad);border-color:var(--bad)}

/* ---- starters */
.starters{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.starter{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px;text-align:left;min-height:120px}
.starter small{color:var(--hi-dim)}
.starter code{font:11px var(--mono);white-space:pre;color:#cfd3da;overflow:hidden;max-height:70px}
`
