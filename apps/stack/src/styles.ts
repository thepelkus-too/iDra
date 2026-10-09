export const CSS = `
:root{--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--c-fn:#5ac8c8;--c-num:#f2a65a;--c-ƒ:#c792ea;--c-arr:#a6da95;--c-ref:#8ab4f8;--c-var:#ffd479;--c-p:#68738a;--sel:rgba(90,200,200,.12);--bad:#e5645f;--warn:#e6a23c;--ok:#53c27a;color-scheme:dark}
html,body{overflow:hidden;height:100%}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
input,textarea{-webkit-user-select:text;user-select:text}
#app{height:100%}
.app{height:100%;display:grid;grid-template-rows:auto auto minmax(0,1fr);background:var(--hi-bg)}
button{min-height:44px;min-width:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-panel);color:var(--hi-text);padding:0 12px;cursor:pointer}
button:disabled{opacity:.4}
button:focus-visible,.tok:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--hi-accent);outline-offset:1px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.btn.primary{background:var(--hi-accent);color:#04201f;border-color:transparent;font-weight:600}
.btn.danger,.item.danger{color:var(--bad)}
.btn.wide{width:100%}
.btn.sm{min-height:36px;min-width:36px;padding:0 10px}
.icon{width:44px;padding:0;font-size:18px;line-height:1}
.icon.small{width:36px;min-height:36px;min-width:36px;font-size:15px;background:rgba(0,0,0,.55);border-color:rgba(255,255,255,.2)}
.linkish{border:0;background:none;color:var(--hi-accent);min-height:32px;padding:0 4px;text-decoration:underline}
.lbl{color:var(--hi-dim);font-size:12px;margin-right:2px}
.note{color:var(--hi-dim);font-size:12.5px;margin:6px 2px}
.note.bad,.rawnote.error{color:var(--bad)}
.empty{color:var(--hi-dim);padding:14px}
.sub{display:block;color:var(--hi-dim);font-size:13px;font-weight:400;margin-top:2px}

/* ---- top bar */
.topbar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--hi-line);background:var(--hi-panel);flex-wrap:wrap}
.topbar .switch-slot{display:inline-block}
.topbar .name{flex:1 1 120px;min-width:100px;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px;font-size:16px}
.seg{display:inline-flex;border:1px solid var(--hi-line);border-radius:10px;overflow:hidden}
.seg button{border:0;border-radius:0;background:var(--hi-bg)}
.seg button.on{background:var(--hi-accent);color:#04201f;font-weight:600}
.seg.small button{min-height:36px;padding:0 10px;font-size:13px}
.dice{white-space:nowrap}
.seedno{font:12px var(--mono);color:var(--hi-dim)}

/* ---- strip */
.strip{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid var(--hi-line);background:var(--hi-bg)}
.chips-scroll{display:flex;align-items:center;gap:6px;overflow-x:auto;flex:1;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:2px 0}
.chips-scroll::-webkit-scrollbar{display:none}
.chipwrap{display:inline-flex;gap:4px;align-items:center;flex:0 0 auto}
.chipbtn{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;min-height:40px;font-size:14px}
.chipbtn b{font-family:var(--mono)}
.chipbtn small{color:var(--hi-dim);font-family:var(--mono)}
.chipbtn.on{border-color:var(--hi-accent);background:rgba(90,200,200,.14)}
.chipbtn.shadowed{opacity:.65;text-decoration:line-through}
.chipbtn.shadowed .tag,.chipbtn .tag{text-decoration:none;display:inline-block}
.chipbtn.not-rendered{border-style:dashed;border-color:var(--warn)}
.chipbtn .tag{font-style:normal;font-size:11px;color:var(--warn);border:1px solid var(--warn);border-radius:6px;padding:0 4px}
.chipbtn.act{border-color:var(--hi-accent);color:var(--hi-accent)}

/* ---- body layout */
.body{display:grid;min-height:0;position:relative}
.app.land .body{grid-template-columns:45% minmax(0,1fr)}
.app.port .body{grid-template-rows:40% minmax(0,1fr)}
.app.port.pip .body{grid-template-rows:minmax(0,1fr)}
.pane{min-height:0;min-width:0;position:relative}
.stack-pane{display:flex;flex-direction:column;border-right:1px solid var(--hi-line);overflow:hidden}
.app.port .stack-pane{order:2;border-right:0}
.app.port .preview-pane{order:1;border-bottom:1px solid var(--hi-line)}
.scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px 6px 90px}
.mode-code .scroll{padding:0;overflow:hidden}
.preview-pane{background:#000}
.stage-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size}
.stage-slot>.stage{position:relative;width:100%;height:100%;flex:none}
@supports (width:1cqw){.stage-slot>.stage{width:min(100cqw,177.78cqh);height:min(100cqh,56.25cqw)}}
.preview-tools{position:absolute;right:6px;top:6px;display:flex;gap:6px;align-items:center;z-index:2}
.pill{font-size:12px;border-radius:999px;padding:3px 9px;background:rgba(0,0,0,.6);border:1px solid var(--hi-line)}
.pill.warn{color:var(--warn);border-color:var(--warn)}
.pill.err{color:var(--bad);border-color:var(--bad)}
.app.pip .preview-pane{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(60px,calc(env(safe-area-inset-bottom) + 52px));width:min(200px,42vw);aspect-ratio:16/9;height:auto;z-index:30;border:1px solid var(--hi-line);border-radius:12px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.5)}
.app.pip .preview-tools .pill{display:none}
.pip-hit{position:absolute;inset:0;background:transparent;border:0;border-radius:0;z-index:1}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;border-top:1px solid var(--hi-line);background:var(--hi-panel);min-height:34px}
.foot .runinfo{font:11px var(--mono);color:var(--hi-dim);white-space:nowrap}
.about-slot .hi-about a{padding:6px 2px}

/* ---- statements */
.stack-list{display:flex;flex-direction:column;gap:8px}
.stmt{display:grid;grid-template-columns:40px minmax(0,1fr);border:1px solid var(--hi-line);border-radius:12px;background:var(--hi-panel);position:relative}
.stmt.selected{border-color:rgba(90,200,200,.55)}
.stmt.flash,.crow.flash{animation:flash 1.1s ease}
@keyframes flash{0%{box-shadow:0 0 0 3px var(--hi-accent)}100%{box-shadow:0 0 0 0 transparent}}
.stmt.dragging{box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:.95}
.gutter{display:flex;flex-direction:column;align-items:center;padding:2px 0}
.stmt-main{min-width:0;padding:4px 4px 4px 0}
.handle{width:40px;height:44px;min-width:40px;padding:0;border:0;background:transparent;color:var(--hi-dim);font-size:18px;touch-action:none;display:inline-flex;align-items:center;justify-content:center}
.handle.stmt-handle{width:40px}
.handle.pinned{color:#4d596e}
.flags{display:flex;flex-wrap:wrap;gap:6px;padding:4px 6px}
.flag{font-size:12.5px;border-radius:8px;padding:0 8px;min-height:32px;display:inline-flex;align-items:center;border:1px solid var(--hi-line);background:transparent}
.flag.warn{color:var(--warn);border-color:var(--warn)}
.flag.info{color:var(--hi-dim)}
.flag.act{color:var(--hi-accent);border-color:var(--hi-accent);font-weight:600}

/* ---- call rows */
.chain .rows{display:flex;flex-direction:column;position:relative}
.crow{display:flex;flex-wrap:wrap;align-items:center;min-height:52px;padding:0 0 0 6px;border-radius:10px;position:relative;font:16px/1.2 var(--mono);touch-action:pan-y;background:transparent;transition:background .12s}
.crow.mod{padding-left:20px}
.crow.out{padding-left:20px}
.crow.plain{padding-left:6px}
.crow.selected{background:var(--sel)}
.crow.swiping[data-swipe=pending]{background:rgba(229,100,95,.1)}
.crow.swiping[data-swipe=commit]{background:rgba(229,100,95,.28)}
.crow.dragging{background:var(--hi-panel);box-shadow:0 8px 24px rgba(0,0,0,.5);border:1px solid var(--hi-accent)}
.crow .handle{position:absolute;right:0;top:4px}
.crow:not(.out):not(.plain){padding-right:42px}
.crow.plain{padding-right:6px}
.crow.unknown .fname{color:var(--warn)}
.p{color:var(--c-p);padding:0 1px}
.p.comma{margin-right:2px}
.tok{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:44px;min-height:44px;padding:0 8px;border-radius:10px;font:16px var(--mono);cursor:pointer;touch-action:pan-y;white-space:nowrap}
.tok.fname{color:var(--c-fn);font-weight:600;justify-content:flex-start;padding:0 4px 0 2px;min-width:44px}
.tok.fname.dim{color:var(--hi-dim);cursor:default}
.tok.num{color:var(--c-num);background:rgba(242,166,90,.09)}
.tok.num.dim{color:#9a8566;background:transparent;border:1px dashed #3a4350}
.tok.num.scrubbing{background:rgba(242,166,90,.3)}
.tok i{font-style:normal}
.tok.fn{color:var(--c-ƒ);background:rgba(199,146,234,.11);max-width:260px;overflow:hidden}
.tok.fn .txt{overflow:hidden;text-overflow:ellipsis}
.tok.fn .mark{opacity:.8}
.tok.arr{color:var(--c-arr);background:rgba(166,218,149,.1);max-width:230px;overflow:hidden}
.tok.arr em{font-style:normal;color:#6f9a63;margin-left:4px;font-size:13px}
.tok.ref{color:var(--c-ref);background:rgba(138,180,248,.1)}
.tok.ref.none{color:var(--hi-dim);border:1px dashed var(--hi-line);background:transparent}
.tok.var{color:var(--c-var);background:rgba(255,212,121,.09)}
.tok.var.bad{color:var(--bad);background:rgba(229,100,95,.12)}
.tok.js{color:#d9dde5;background:rgba(255,255,255,.06);max-width:220px;overflow:hidden}
.tok.texmissing{color:var(--bad);border:1px dashed var(--bad);background:rgba(229,100,95,.08)}
.tok.vec{background:transparent;padding:0;gap:0}
.tok.vec.dim{color:#9a8566}
.tok.varname{color:var(--c-var);font-weight:600}
.tok.addarg{min-width:44px;color:var(--hi-dim);border:1px dashed var(--hi-line);background:transparent}
.dimtxt{color:var(--hi-dim)}
.spark{display:inline-flex;align-items:flex-end;gap:2px;height:20px;width:auto}
.spark i{display:block;width:4px;background:var(--c-arr);border-radius:1px;min-height:2px}
.meter{display:inline-block;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;position:relative}
.meter.v{width:10px;height:36px}
.meter.h{width:30px;height:6px}
.meter i{position:absolute;left:0;bottom:0;background:var(--ok);display:block}
.meter.v i{width:100%;height:0}
.meter.h i{height:100%;width:0}
.dot{min-width:22px;width:22px;min-height:44px;height:44px;padding:0;border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center;margin-left:-4px}
.dot i{display:block;width:9px;height:9px;border-radius:50%}
.dot.err i{background:var(--bad)}
.dot.warn i{background:var(--warn)}
.addrow{padding:0 0 0 20px}
.add{min-height:40px;border-style:dashed;color:var(--hi-dim);background:transparent;font-size:14px}
.chain.nested .rows{border-left:2px solid #394253;margin-left:2px}
.pocket{display:inline-flex;flex-direction:column;align-items:stretch;position:relative;border:1px solid #3a4558;border-radius:10px;background:rgba(138,180,248,.05);padding:2px 2px 2px 4px;margin:2px 4px;min-width:150px;max-width:100%;font-size:14px}
.pocket .crow{font-size:15px;min-height:46px}
.pocket .crow.mod{padding-left:10px}
.pocket .chain.nested .rows{border-left:0;margin:0}
.pocket .addrow{padding:0 0 0 6px}
.pocket .add{min-height:34px;font-size:13px}
.pocket-menu{position:absolute;right:2px;bottom:2px;min-width:30px;min-height:30px;width:30px;height:30px;padding:0;border-radius:8px;font-size:14px;background:rgba(0,0,0,.35);color:var(--hi-dim);z-index:1}

/* ---- other rows */
.defrow{display:flex;flex-wrap:wrap;align-items:center;min-height:52px;font:16px var(--mono);padding-left:4px}
.decl{color:#c792ea;margin-right:4px;font-size:14px}
.uses{margin-left:auto;margin-right:8px;font-size:12px;color:var(--hi-dim)}
.uses.none{color:#6b7587}
.note-row{display:flex;align-items:flex-start;gap:6px;min-height:52px;padding:8px 6px;font:italic 15px var(--mono);color:#7b879b}
.slashes{opacity:.6;padding-top:8px}
.note-text{padding:8px 4px;min-height:44px;flex:1;cursor:text;white-space:pre-wrap;word-break:break-word}
.note-edit,.code-edit{width:100%;background:var(--hi-bg);border:1px solid var(--hi-line);color:var(--hi-text);border-radius:8px;padding:8px;font:15px/1.45 var(--mono);resize:vertical;-webkit-user-select:text;user-select:text}
.note-edit{flex:1;font-style:italic}
.code-edit.big{min-height:200px}
.raw-row{display:flex;align-items:flex-start;gap:8px;min-height:52px;padding:4px 6px 4px 4px;font:15px var(--mono)}
.raw-row .status{flex:0 0 10px;width:10px;height:10px;border-radius:50%;margin-top:17px;background:#6b7587}
.raw-row .status.blocks{background:var(--ok)}
.raw-row .status.error{background:var(--bad)}
.raw-row .status.code{background:var(--warn)}
.raw-text{flex:1;min-width:0;padding:12px 4px;cursor:text;display:flex;align-items:baseline;gap:6px;overflow:hidden}
.raw-text code{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#d3d9e4;font:15px var(--mono)}
.raw-text em{color:var(--hi-dim);font-size:12px;white-space:nowrap;font-style:normal}
.raw-edit{flex:1;min-width:0}
.rawnote{font:12px var(--mono);color:var(--hi-dim);padding:2px 2px}
.rawnote.blocks{color:var(--ok)}
.argtext{min-width:120px;width:160px;min-height:44px;background:var(--hi-bg);border:1px solid var(--hi-line);border-radius:10px;color:var(--hi-text);padding:0 8px;font:16px var(--mono)}
.addbar{padding:10px 6px}

/* ---- banners */
.banners{display:flex;flex-direction:column;gap:6px;padding:6px 6px 0}
.banners:empty{display:none;padding:0}
.banner{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--hi-line);border-radius:10px;padding:8px 10px;font-size:14px}
.banner .actions{display:flex;gap:6px;flex-wrap:wrap}
.banner.trust,.banner.warn{background:rgba(230,162,60,.13);border-color:var(--warn)}
.banner.err{background:rgba(229,100,95,.12);border-color:var(--bad)}
.banner.info{background:rgba(138,180,248,.08)}
.banner .sub{margin-top:2px}
.parts{margin:4px 0 0 18px;padding:0;font-size:12px;width:100%}
.parts code{font-family:var(--mono);color:var(--hi-dim)}

/* ---- overlays */
.overlays{position:fixed;inset:0;pointer-events:none;z-index:1000}
.overlays>*{pointer-events:auto}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5)}
.scrim.clear{background:transparent}
.popover{position:fixed;background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.6);overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:10px;z-index:2;-webkit-user-select:none;user-select:none}
.popover .arrow{display:none}
.sheet{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 20px));max-height:calc(100vh - 40px);background:var(--hi-panel);border:1px solid var(--hi-line);border-radius:16px;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.6);z-index:2}
.sheet.wide{width:min(720px,calc(100vw - 20px))}
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
.key{min-height:50px;font:600 19px var(--mono);padding:0}
.key.nudge{color:var(--hi-accent);font-size:16px}
.key.util{color:var(--hi-dim)}
.key.wide{grid-column:span 2}
.key.ok{background:var(--hi-accent);color:#04201f;border-color:transparent}
.kp-reset{border:0;background:transparent;color:var(--hi-dim);font-size:13px;min-height:36px}

/* ---- editors */
.ed-head{display:flex;justify-content:space-between;align-items:center;gap:8px;font:13px var(--mono);margin-bottom:8px;color:var(--hi-text)}
.ed-head small{color:var(--hi-dim);font-family:system-ui}
.ed-src{color:var(--hi-dim);font-size:11px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.chip{min-height:40px;padding:0 12px;border-radius:999px;font:14px var(--mono);background:var(--hi-bg)}
.chip.on{border-color:var(--hi-accent);background:rgba(90,200,200,.16);color:var(--hi-text)}
.expr-row{display:flex;align-items:center;gap:6px}
.expr-row .big{font:15px var(--mono);color:var(--hi-dim)}
.expr{flex:1;min-width:0;min-height:48px;background:var(--hi-bg);border:1px solid var(--hi-line);border-radius:10px;color:var(--hi-text);padding:0 10px;font:18px var(--mono);width:100%}
.expr.bad{border-color:var(--bad)}
.bins{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px}
.chip.bin{min-width:44px;justify-content:center}
.wrap-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}
.arr-editor .steps{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono)}
.bars{display:flex;gap:6px;align-items:stretch;overflow-x:auto;padding-bottom:4px}
.barcol{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1 0 48px;max-width:90px;border-radius:8px}
.barcol.head{background:rgba(90,200,200,.1);outline:1px solid rgba(90,200,200,.5)}
.bartrack{height:120px;width:100%;background:var(--hi-bg);border-radius:8px;position:relative;touch-action:none;display:flex;align-items:flex-end;overflow:hidden}
.barfill{width:100%;background:var(--c-arr);opacity:.8;border-radius:6px 6px 0 0}
.barval{min-height:36px;width:100%;padding:0;font:13px var(--mono);color:var(--c-num)}
.mods{display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:10px;align-items:center}
.mod{display:inline-flex;align-items:center;gap:4px}
.mod .x{min-width:30px;min-height:30px;width:30px;padding:0;border:0;background:transparent;color:var(--hi-dim)}
.kind-menu .km-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;font:14px var(--mono)}
.kind-menu .km-head small{color:var(--hi-dim);font-family:system-ui}
.km-kinds{display:flex;flex-wrap:wrap;gap:6px}
.kbtn{flex:1 1 80px;min-height:46px}
.kbtn.on{background:rgba(90,200,200,.2);border-color:var(--hi-accent)}
.km-sub{margin-top:10px;display:flex;flex-direction:column;gap:4px}
.refrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.km-actions{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}
.ref-picker{display:flex;flex-direction:column;gap:8px}
.js-editor,.rename{display:flex;flex-direction:column;gap:8px}

/* ---- function picker */
.picker{display:flex;flex-direction:column;gap:8px;max-height:70vh}
.picker-search input{width:100%;min-height:44px;border-radius:10px;border:1px solid var(--hi-line);background:var(--hi-bg);padding:0 12px;font-size:16px}
.picker-scroll{overflow:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;max-height:calc(70vh - 60px)}
.picker h4{margin:10px 2px 6px;font:600 12px system-ui;letter-spacing:.06em;text-transform:uppercase;color:var(--hi-dim);position:sticky;top:0;background:var(--hi-panel);padding:2px 0;z-index:1}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
.fcard{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;min-height:104px;border-radius:12px}
.fcard.on{border-color:var(--hi-accent);background:rgba(90,200,200,.12)}
.fcard .fname{font:12px var(--mono);color:var(--hi-text);max-width:100%;overflow-wrap:anywhere;text-align:center;line-height:1.15}
.fcard small{font-size:10px;color:var(--hi-dim)}
.fcard.custom{min-height:44px;flex-direction:row;justify-content:center;width:100%;margin-bottom:6px}
.thumb{width:64px;height:64px;border-radius:8px;background:#0b0d10;display:flex;align-items:center;justify-content:center;overflow:hidden}
.thumb img{display:block;width:64px;height:64px;object-fit:cover}
.thumb .glyph{color:#4d596e;font:20px var(--mono)}

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
.setup-list{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.setup-item{display:flex;justify-content:space-between;align-items:center;text-align:left}
.setup-item small{color:var(--hi-dim)}
.about p{margin:8px 0}

/* ---- code view */
.codeview{height:100%;display:flex;flex-direction:column;min-height:0}
.cm-host{flex:1;min-height:0;overflow:hidden}
.cm-host .cm-editor{height:100%}
.code-status{padding:6px 10px;font-size:13px;border-top:1px solid var(--hi-line)}
.code-status.err{color:var(--bad);background:rgba(229,100,95,.1)}
.code-status.info{color:var(--hi-dim)}

@media (max-width:520px){
  .topbar .name{order:9;flex-basis:100%}
  .app.port .body{grid-template-rows:34% minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`
