// Patch Graph styles (the shared chrome is in kit/styles.ts). Node geometry must match view.ts: HEAD=44, ROW=40.
export const CSS = `
:root{--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--bad:#e5645f;--warn:#e6a23c;--ok:#53c27a;
--t-src:#5ac8c8;--t-coord:#8ab4f8;--t-color:#f2a65a;--t-combine:#c792ea;--t-combineCoord:#e98bd0;--t-out:#53c27a;--t-def:#8a9bb5;--t-mod:#ffd479;--t-plugin:#a6da95;color-scheme:dark}
html,body{overflow:hidden;height:100%;overscroll-behavior:none}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
input,textarea{-webkit-user-select:text;user-select:text}
#app{height:100%}
button{min-height:44px;min-width:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);padding:0 12px;cursor:pointer}
button:disabled{opacity:.4}
button.on,.btn.on{border-color:var(--hi-accent);color:var(--hi-accent);background:rgba(90,200,200,.12)}
.app{position:relative;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:var(--hi-bg)}
.topbar{display:flex;align-items:center;gap:6px;padding:6px max(8px,env(safe-area-inset-right)) 6px max(8px,env(safe-area-inset-left));padding-top:max(6px,env(safe-area-inset-top));border-bottom:1px solid var(--hi-line);background:var(--hi-panel);flex-wrap:wrap;z-index:5}
.topbar .name{flex:0 1 220px;min-width:90px;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px;font-size:16px;color:var(--hi-text)}
.topbar .grow{flex:1}
.main{position:relative;min-height:0;display:grid;grid-template-columns:minmax(0,1fr)}
.app.code-open.lay-land .main{grid-template-columns:minmax(0,1fr) min(42%,520px)}
.app.code-open.lay-port .main{grid-template-rows:minmax(0,1fr) 38%}
.canvas-col{position:relative;min-height:0;min-width:0;display:grid}
.codepane{min-height:0;min-width:0;border-left:1px solid var(--hi-line);background:var(--hi-bg);position:relative}
.app.lay-port .canvas-col{position:relative;min-height:0;min-width:0;display:grid}
.codepane{border-left:0;border-top:1px solid var(--hi-line)}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 max(10px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(10px,env(safe-area-inset-left));border-top:1px solid var(--hi-line);background:var(--hi-panel);min-height:34px}
.foot .runinfo{font:11px var(--mono);color:var(--hi-dim);white-space:nowrap}
.banners-wrap{position:absolute;left:8px;right:8px;top:8px;z-index:6;pointer-events:none}
.banners-wrap>*{pointer-events:auto}

/* ---- canvas */
.canvas{position:relative;overflow:hidden;touch-action:none;min-height:0;background:var(--hi-bg);background-image:radial-gradient(rgba(255,255,255,.07) 1px,transparent 1px);background-size:24px 24px;--k:1}
.canvas.mode-lasso{cursor:crosshair}
.world{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.cables{position:absolute;overflow:visible;pointer-events:none}
.cable .line{fill:none;stroke:#7d8aa3;stroke-width:3;pointer-events:none}
.cable.tex .line{stroke:#8fb3d9}
.cable.num .line{stroke:var(--t-mod);stroke-dasharray:6 5}
.cable.fb .line{stroke:var(--t-out)}
.cable.byp .line{opacity:.45}
.cable.sel .line{stroke:var(--hi-accent);stroke-width:5}
.cable .hitpath{fill:none;stroke:transparent;stroke-width:26;pointer-events:stroke;cursor:pointer}
.cable-temp{fill:none;stroke:var(--hi-accent);stroke-width:3;stroke-dasharray:8 6;pointer-events:none}
.cable-rejected{fill:none;stroke:var(--bad);stroke-width:5;stroke-dasharray:10 6;pointer-events:none;animation:rej 1.6s ease forwards}
@keyframes rej{0%,70%{opacity:1}100%{opacity:0}}
.lasso{position:absolute;display:none;border:1.5px dashed var(--hi-accent);background:rgba(90,200,200,.08);pointer-events:none;z-index:3}
.drag-ghost{position:fixed;left:0;top:0;display:none;z-index:60;pointer-events:none;padding:10px 14px;border-radius:10px;background:var(--hi-panel);border:1px solid var(--hi-accent);font:15px var(--mono);box-shadow:0 10px 30px rgba(0,0,0,.5)}
.xchip{position:absolute;left:0;top:0;width:36px;height:36px;min-width:36px;min-height:36px;padding:0;border-radius:50%;background:var(--bad);color:#fff;border:0;font-size:16px;z-index:4;box-shadow:0 4px 12px rgba(0,0,0,.5)}

/* ---- nodes */
.node{position:absolute;left:0;top:0;box-sizing:border-box;border:1px solid var(--hi-line);border-radius:12px;background:var(--hi-panel);box-shadow:0 4px 14px rgba(0,0,0,.35);font-size:13px;--tc:#7d8aa3}
.node.sel{border-color:var(--hi-accent);box-shadow:0 0 0 2px var(--hi-accent),0 6px 18px rgba(0,0,0,.45)}
.node.call{border-top:3px solid var(--tc)}
.node.t-src{--tc:var(--t-src)}.node.t-coord{--tc:var(--t-coord)}.node.t-color{--tc:var(--t-color)}.node.t-combine{--tc:var(--t-combine)}.node.t-combineCoord{--tc:var(--t-combineCoord)}
.node.plugin{--tc:var(--t-plugin)}
.node.unknown{border-style:dashed;border-color:var(--warn)}
.node.bypassed{opacity:.55;border-style:dashed}
.node.shadowed{opacity:.7}
.node.err{animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 2px var(--bad)}50%{box-shadow:0 0 0 7px rgba(229,100,95,.25)}}
.nhead{position:relative;height:44px;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:0 22px 0 18px;border-bottom:1px solid var(--hi-line);cursor:grab}
.node.call .nhead{height:41px}
.nhead b{font:600 15px var(--mono)}
.nhead small{color:var(--hi-dim);font-size:11px;margin-left:auto}
.ticon{color:var(--tc);font-size:15px;width:16px;text-align:center}
.fname{min-height:36px;min-width:0;padding:0 6px;border:0;background:transparent;font:600 15px var(--mono);color:var(--tc);text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.badge{font-size:11px;border-radius:6px;padding:1px 5px;border:1px solid var(--hi-line);color:var(--hi-dim);white-space:nowrap;min-height:0;min-width:0}
.badge.dup{color:var(--warn);border-color:var(--warn);min-height:30px;padding:0 6px}
.badge.byp{color:var(--warn)}
.badge.shadow{color:var(--bad);border-color:var(--bad)}
.nbody{display:flex;flex-direction:column}
.nbody.pad{padding:6px 8px}
.nrow{position:relative;display:flex;align-items:center;padding:0 8px 0 18px;box-sizing:border-box}
.nrow>*{flex:1;min-width:0}
.nrow.tex{background:rgba(143,179,217,.05)}
.nl{color:var(--hi-dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wired{display:flex;align-items:center;gap:6px;font-size:12px}
.wired .wfrom{color:var(--hi-text);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wired.missing .wfrom{color:var(--bad)}
.jsval{display:flex;align-items:center;gap:6px;min-height:34px;padding:0 6px;background:rgba(255,255,255,.04);border:1px solid var(--hi-line);border-radius:8px;font-size:12px;text-align:left;overflow:hidden}
.jsval code{font:12px var(--mono);color:#d9dde5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jsval.tall{min-height:100px;align-items:flex-start;padding:6px;margin:6px 8px}
.jsval.tall code{white-space:pre-wrap}
.vec{display:flex;align-items:center;gap:3px}
.vbit{min-height:32px;min-width:0;flex:1;padding:0 2px;font:12px var(--mono)}
.addarg{min-height:30px;margin:2px 18px;border-style:dashed;color:var(--hi-dim);font-size:12px}
.nerr{position:absolute;left:0;right:0;top:100%;margin-top:4px;font-size:11px;color:var(--bad);background:rgba(20,10,10,.9);border:1px solid var(--bad);border-radius:8px;padding:4px 6px;z-index:2}
.nthumb{position:absolute;left:0;bottom:100%;margin-bottom:8px;width:192px;height:108px;border-radius:8px;overflow:hidden;border:1px solid var(--hi-accent);background:#000;pointer-events:none}
.nthumb::after{content:'preview';position:absolute;right:4px;top:3px;font-size:10px;color:var(--hi-accent);background:rgba(0,0,0,.6);border-radius:4px;padding:0 4px}
.nthumb-frame{position:absolute;inset:0}
.nthumb-frame>*{width:100%!important;height:100%!important;border:0}
.node.out{--tc:var(--t-out);border-color:var(--t-out);background:#14261c}
.node.out.unused{opacity:.55;border-style:dashed}
.node.out .nhead,.node.srcn .nhead{border:0;height:30px;padding-left:16px}
.osub{font-size:11px;color:var(--hi-dim);padding:0 16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.render-btn{position:absolute;left:16px;right:16px;bottom:6px;min-height:28px!important;height:28px;font-size:12px}
.node.srcn{--tc:var(--t-src);background:#132527}
.node.mod{--tc:var(--t-mod);border-top:3px solid var(--t-mod)}
.node.def{--tc:var(--t-def);background:#1c222c;border-top:3px solid var(--t-def)}
.node.note{background:#3a3523;border-color:#6d6233;color:#f3e7b5}
.node.note{overflow:hidden}
.node.note .nhead{border-color:#6d6233;height:22px}
.notetext{display:block;width:100%;min-height:0;text-align:left;border:0;border-radius:0;background:transparent;color:inherit;white-space:pre;overflow:hidden;text-overflow:ellipsis;font-size:13px;line-height:18px;padding:2px 10px}
.node.raw{background:#1d1f25;border-color:#5a6070;overflow:hidden}
.node.raw:focus-within{height:auto!important;min-height:fit-content;overflow:visible;z-index:5}
.node.raw .raw-body{padding:4px 8px}
.node.setup{background:#1a1e26}
.node.setup .nhead{height:30px}
.node.setup .nbody.pad{padding:4px 8px}
.node.setup .seg.small button{height:34px;min-height:34px}
.srcbody{display:flex;flex-direction:column;gap:6px}
.seg.small button{min-height:34px;min-width:34px;padding:0 8px;font-size:12px}
.macro{display:flex;align-items:center;gap:8px;width:212px;height:60px;padding:0 20px;border:2px solid var(--hi-accent);background:#16262a;box-sizing:border-box}
.macro b{font:600 15px var(--mono)}
.macro small{color:var(--hi-dim);font:11px var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.term{position:absolute;left:0;top:0;width:120px;height:56px;box-sizing:border-box;border:2px dashed var(--warn);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--warn);font-size:11px}
.term .btn{min-height:30px;font-size:12px}

/* ports: 28pt hit targets, an 12px dot */
.port{position:absolute;width:28px;height:28px;z-index:2;touch-action:none;cursor:crosshair}
.port::after{content:'';position:absolute;left:8px;top:8px;width:12px;height:12px;border-radius:50%;background:var(--hi-bg);border:2px solid var(--tc,#7d8aa3);box-sizing:border-box}
.port.in{left:-14px;top:calc(50% - 14px)}
.port.out{right:-14px;top:calc(50% - 14px)}
.nhead .port.in{top:6px}
.nhead .port.out{top:6px}
.node.call .nhead .port{top:5px}
.nrow .port.in{left:-14px;top:6px}
.port.nump::after{border-color:var(--t-mod);border-radius:3px}
.port.texp::after{border-color:#8fb3d9}
.node.out>.port.in,.node.out>.port.out,.node.srcn>.port.out{top:calc(50% - 14px)}
.node.def .nhead .port,.node.mod .nhead .port{top:5px}
.port.ok::after{background:var(--hi-accent);border-color:var(--hi-accent);transform:scale(1.35)}
.canvas.wiring .port:not(.ok)::after{opacity:.35}

/* number sliders on nodes */
.numslider{position:relative;display:flex;align-items:center;justify-content:space-between;gap:6px;height:32px;padding:0 8px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid var(--hi-line);overflow:hidden;touch-action:none;cursor:ew-resize}
.numslider .fill{position:absolute;left:0;top:0;bottom:0;background:rgba(242,166,90,.2);pointer-events:none}
.numslider .nl{position:relative}
.numslider .nv{position:relative;font:600 13px var(--mono);color:#f2a65a}
.numslider.dim .nv{color:#9a8566;font-weight:400}
.numslider:focus-visible{outline:2px solid var(--hi-accent)}

/* modulator bodies */
.nbody.steps{padding:6px 8px;gap:6px}
.bars{display:flex;align-items:flex-end;gap:3px;height:48px}
.bar{flex:1;min-width:0;min-height:0;padding:0;border-radius:3px;background:rgba(166,218,149,.35);border:0;align-self:stretch;position:relative}
.bar i{position:absolute;left:0;right:0;bottom:0;background:#a6da95;border-radius:3px}
.steptools{display:flex;gap:4px}
.steptools .btn{min-height:30px;min-width:30px;padding:0 6px;font-size:12px}

/* ---- palette (bottom drawer) */
.palette{position:absolute;left:0;right:0;bottom:0;z-index:8;background:var(--hi-panel);border-top:1px solid var(--hi-line);box-shadow:0 -10px 30px rgba(0,0,0,.45);display:flex;flex-direction:column;max-height:46%;padding-bottom:env(safe-area-inset-bottom)}
.pal-head{display:flex;gap:6px;padding:8px}
.pal-search{flex:1;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);border-radius:10px;padding:0 10px;font-size:16px}
.pal-tabs{display:flex;gap:4px;padding:0 8px 6px;overflow-x:auto;scrollbar-width:none}
.pal-tabs button{white-space:nowrap;font-size:13px}
.pal-items{display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,auto);grid-auto-columns:120px;gap:6px;padding:4px 8px 8px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}
.pal-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;min-height:84px;touch-action:pan-x;font:13px var(--mono)}
.pal-item .pthumb{width:96px;height:44px;border-radius:6px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--hi-dim)}
.pal-item .pthumb img{width:100%;height:100%;object-fit:cover}
.pal-item .plabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pal-hint{font-size:11px;color:var(--hi-dim);padding:0 10px 6px}
.addmenu{display:flex;flex-direction:column;gap:6px;padding:6px;max-height:min(60vh,460px)}
.am-list{overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.am-item{display:flex;align-items:center;gap:8px;text-align:left;border:0;background:transparent;font:14px var(--mono)}
.am-item small{margin-left:auto;color:var(--hi-dim);font-family:inherit;font-size:11px}
.am-item.on{color:var(--hi-accent)}

/* ---- selection bar */
.selbar{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));z-index:7;display:flex;align-items:center;gap:6px;padding:6px;border-radius:14px;background:var(--hi-panel);border:1px solid var(--hi-line);box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:calc(100% - 24px);overflow-x:auto}
.selbar .count{font:13px var(--mono);color:var(--hi-dim);padding:0 6px;white-space:nowrap}
.selbar .btn{white-space:nowrap}
.app.pal-open .selbar{bottom:calc(46% + 10px)}

/* ---- PiP output + performance */
.pip{position:absolute;z-index:9;border-radius:12px;overflow:hidden;border:1px solid var(--hi-line);background:#000;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.pip .stage-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size}
.stage-slot>.stage{position:relative;width:100%;height:100%;flex:none}
@supports (width:1cqw){.stage-slot>.stage{width:min(100cqw,177.78cqh);height:min(100cqh,56.25cqw)}}
.pip-grip{position:absolute;left:0;right:0;top:0;height:40%;touch-action:none;cursor:move;display:flex;gap:4px;padding:4px;align-items:flex-start}
.pip-resize{position:absolute;right:0;bottom:0;width:36px;height:36px;touch-action:none;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,rgba(255,255,255,.35) 55%,rgba(255,255,255,.35) 62%,transparent 62%,transparent 72%,rgba(255,255,255,.35) 72%,rgba(255,255,255,.35) 79%,transparent 79%)}
.pip.perform{position:fixed;inset:0;border:0;border-radius:0;z-index:40}
.pill{font-size:12px;border-radius:999px;padding:3px 9px;background:rgba(0,0,0,.6);border:1px solid var(--hi-line)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.pill.err{color:var(--bad);border-color:var(--bad)}
.perform-ui{position:absolute;inset:0;pointer-events:none}
.perform-ui>*{pointer-events:auto}
.perform-ui .exit{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));background:rgba(0,0,0,.55)}
.pins{position:absolute;left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}
.pins .numslider{height:52px;background:rgba(0,0,0,.55);font-size:14px}
.pins .hint{color:#ccc;background:rgba(0,0,0,.55);padding:8px 12px;border-radius:10px;font-size:13px}
.codepane .codedrawer{position:absolute;inset:0}

/* ---- backdrop (contract §6): the output fills the screen behind everything; panels sit on a veil, stacked top to bottom
   so the switcher's drop-down opens over what is below it. The output's ancestors carry no transform/filter/contain. */
html.hi-backdrop .app{background:transparent}
html.hi-backdrop .topbar{position:relative;z-index:5;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .topbar .name{background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .foot{position:relative;z-index:1;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .foot .runinfo,html.hi-backdrop .foot a{text-shadow:var(--hi-ink-shadow)}
html.hi-backdrop .codepane{z-index:1;background:transparent;border-color:var(--hi-veil-line)}
html.hi-backdrop .canvas{z-index:1;background-color:transparent;background-image:radial-gradient(rgba(255,255,255,.14) 1px,transparent 1px)}
html.hi-backdrop .palette,html.hi-backdrop .selbar{background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .node{box-shadow:0 4px 18px rgba(0,0,0,.6)}
html.hi-backdrop .stage-slot>.stage{width:100%;height:100%}
`
