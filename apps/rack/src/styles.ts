// Rack styles: a dark hardware panel. Lanes scroll sideways, the rack scrolls down; every target is at least 44 px.
export const CSS = `
:root{--k-src:#5ac8c8;--k-coord:#8ab4f8;--k-color:#f2a65a;--k-combine:#c792ea;--k-combineCoord:#e5839b;--k-mod:#ffd479;--k-plugin:#a6da95}
.app{position:relative;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;background:var(--hi-bg)}
.topbar{display:flex;align-items:center;gap:6px;padding:6px max(8px,env(safe-area-inset-right)) 6px max(8px,env(safe-area-inset-left));padding-top:max(6px,env(safe-area-inset-top));border-bottom:1px solid var(--hi-line);background:var(--hi-panel);flex-wrap:wrap;position:relative;z-index:20}
.topbar .name{flex:0 1 200px;min-width:90px;min-height:44px;border:1px solid var(--hi-line);background:var(--hi-bg);border-radius:10px;padding:0 10px;font-size:16px;color:var(--hi-text)}
.topbar .grow{flex:1}
.tempo{display:flex;align-items:center;gap:4px}
.tempo .numslider{width:96px}
.perform-btn{font-weight:600}
.main{position:relative;min-height:0;display:grid;grid-template-columns:auto minmax(0,1fr) auto}
.app.code-open.lay-land .main{grid-template-columns:auto minmax(0,1fr) auto min(36%,460px)}
.app.lay-port .main{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto minmax(0,1fr)}
.app.lay-port .mixer{grid-column:1 / -1}
.app.code-open.lay-port .main{grid-template-rows:auto minmax(0,1fr) 34%}
.app.code-open.lay-port .codepane{grid-column:1 / -1}
.codepane{min-height:0;min-width:0;border-left:1px solid var(--hi-line);background:var(--hi-bg);position:relative}
.app.lay-port .codepane{border-left:0;border-top:1px solid var(--hi-line)}
.codepane .codedrawer{position:absolute;inset:0}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 max(10px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(10px,env(safe-area-inset-left));border-top:1px solid var(--hi-line);background:var(--hi-panel);min-height:34px}
.foot .runinfo{font:11px var(--mono);color:var(--hi-dim);white-space:nowrap}

/* ---- mixer */
.mixer{display:flex;flex-direction:column;gap:10px;padding:8px;padding-left:max(8px,env(safe-area-inset-left));border-right:1px solid var(--hi-line);background:var(--hi-panel);overflow-y:auto;min-height:0;width:200px}
.app.lay-port .mixer{flex-direction:row;flex-wrap:wrap;width:auto;border-right:0;border-bottom:1px solid var(--hi-line);align-items:flex-start;gap:14px;overflow:visible}
.mixgroup{display:flex;flex-direction:column;gap:4px}
.mixgroup>small{color:var(--hi-dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.mixer .render{flex-wrap:wrap}
.mixer .render button{min-width:36px;padding:0 6px;font-size:13px}
.matrix{border-collapse:collapse;font-size:11px;color:var(--hi-dim)}
.matrix th{font-weight:500;padding:0 2px;text-align:center}
.matrix td{padding:1px}
.matrix .cell{min-width:36px;min-height:36px;width:36px;height:36px;padding:0;border-radius:8px;background:var(--hi-bg)}
.matrix .cell.fb{border-style:dashed}
.matrix .cell.on{background:var(--hi-accent);border-color:var(--hi-accent)}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:36px;padding:0 8px;border-radius:999px;border:1px solid var(--c-ref);color:var(--c-ref);font:12px var(--mono);background:rgba(138,180,248,.08)}
.lanechip{touch-action:none;cursor:grab}
.srcchip{border-color:var(--c-arr);color:var(--c-arr);background:rgba(166,218,149,.08)}

/* ---- rack, lanes */
.rack-col{position:relative;min-height:0;min-width:0;display:flex;flex-direction:column}
.rack{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 8px 40px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
.lane{display:grid;grid-template-columns:54px minmax(0,1fr);border:1px solid var(--hi-line);border-radius:12px;background:rgba(255,255,255,.02)}
.lane.onscreen{border-color:rgba(90,200,200,.55)}
.lane.frozen .lanebody{background-image:repeating-linear-gradient(135deg,transparent 0 12px,rgba(255,255,255,.025) 12px 24px)}
.lanehead{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;border-right:1px solid var(--hi-line)}
.lanehead .lname{font:600 15px var(--mono);color:var(--hi-accent)}
.lanehead .icon.sm{width:44px;min-height:40px;font-size:15px}
.lanebody{min-width:0;overflow-x:auto;display:flex;flex-direction:column;gap:6px;padding:6px;-webkit-overflow-scrolling:touch}
.lanerow{position:relative;display:flex;align-items:stretch;gap:6px;min-width:min-content}
.lanerow.shadowed{opacity:.45}
.lanerow .tag{position:absolute;left:4px;top:-2px;z-index:1;font-size:10px;padding:1px 6px;border-radius:6px;background:#3a2f1c;color:var(--warn)}
.chainrow{display:flex;align-items:stretch;gap:6px}
.chainrow.d1,.chainrow.d2{padding:6px;border-radius:10px;background:rgba(0,0,0,.25);border:1px dashed var(--hi-line)}
.addgen,.addmod{min-height:44px;border-style:dashed;color:var(--hi-dim);background:transparent}
.addmod{display:flex;flex-direction:column;align-items:center;justify-content:center;width:64px;font-size:20px}
.addmod small{font-size:11px}
.addgen{align-self:flex-start;padding:0 18px}
.outtile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:72px;flex:none;border-radius:12px;background:var(--hi-bg)}
.outtile .arrow{color:var(--hi-dim)}
.outtile b{font:600 15px var(--mono)}
.outtile small{font-size:10px;color:var(--hi-dim)}
.outtile.on{border-color:var(--hi-accent)}
.outtile.on small{color:var(--hi-accent)}

/* ---- modules */
.module{flex:none;display:flex;flex-direction:column;border:1px solid var(--hi-line);border-top:3px solid var(--k-c,var(--hi-line));border-radius:12px;background:linear-gradient(#24272d,#1b1d22);min-width:120px}
.module.t-src{--k-c:var(--k-src)}
.module.t-coord{--k-c:var(--k-coord)}
.module.t-color{--k-c:var(--k-color)}
.module.t-combine{--k-c:var(--k-combine)}
.module.t-combineCoord{--k-c:var(--k-combineCoord)}
.module.plugin{--k-c:var(--k-plugin)}
.module.unknown{--k-c:#777;background:#2a2a2a;filter:saturate(0)}
.module.sel{box-shadow:0 0 0 2px var(--hi-accent)}
.module.ghost{opacity:.45;border-style:dashed;min-width:90px}
.mhead{display:flex;align-items:center;gap:2px;padding:2px 2px 0 6px}
.mhead .ticon{color:var(--k-c);font-size:13px;width:16px}
.mname{flex:1;border:0;background:transparent;font:600 14px var(--mono);text-align:left;padding:0 6px;min-width:0;color:var(--hi-text)}
.mhead .icon.sm{width:36px;min-width:36px;min-height:40px;font-size:14px;border-color:transparent;background:transparent}
.mhead .icon.sm.on{color:var(--hi-accent)}
.mbody{display:flex;flex-wrap:nowrap;align-items:flex-start;gap:4px;padding:4px 8px 8px}
.mbody .noknobs,.mbody small{color:var(--hi-dim);font-size:11px;align-self:center}
.rawmod{min-width:0;flex:1;border-top-color:#777;padding:6px}

/* ---- knobs */
.knob{position:relative;display:flex;flex-direction:column;align-items:center;width:72px;touch-action:none;cursor:ns-resize;border-radius:12px;padding:2px 0}
.knob.mini{width:52px}
.knob svg{display:block}
.knob .ktrack{fill:none;stroke:#3a3e46;stroke-width:5;stroke-linecap:round}
.knob .kfill{fill:none;stroke:var(--k-c,var(--hi-accent));stroke-width:5;stroke-linecap:round}
.knob .kring{fill:none;stroke:var(--k-mod);stroke-width:3.5;stroke-linecap:round}
.knob .kring.grow{stroke-dasharray:3 3}
.knob .klink{fill:none;stroke:var(--c-var);stroke-width:2;stroke-dasharray:4 3}
.knob .kptr{stroke:var(--hi-text);stroke-width:3.5;stroke-linecap:round}
.knob .kv{position:absolute;top:24px;left:0;right:0;text-align:center;font:600 12px var(--mono);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 10px}
.knob.mini .kv{top:16px;font-size:10px}
.knob .kl{font-size:11px;color:var(--hi-dim);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.knob.dim .kv,.fader.dim .kv{color:var(--hi-dim);font-weight:400}
.knob.dim .kfill{stroke:#55606a}
.knob.f-mod .kv{color:var(--k-mod);font-size:16px}
.knob.f-var .kv{color:var(--c-var)}
.knob.f-expr .kv{color:var(--c-fn);font-size:16px}
.knob.pinned::after,.fader.pinned::after{content:'📌';position:absolute;right:2px;top:0;font-size:10px}
.knob.hot,.fader.hot,.jack.hot{background:rgba(255,212,121,.22);box-shadow:0 0 0 2px var(--k-mod)}
body.dragging-mod .knob,body.dragging-mod .fader,.app.arming .knob,.app.arming .fader{background:rgba(255,212,121,.07);outline:1px dashed rgba(255,212,121,.6)}
body.dragging-lane .jack{outline:1px dashed var(--c-ref)}
.fader{position:relative;display:flex;flex-direction:column;align-items:center;width:40px;touch-action:none;cursor:ns-resize;border-radius:8px;padding:2px 0}
.fader .ftrack{position:relative;width:14px;height:74px;border-radius:7px;background:#3a3e46;overflow:hidden}
.fader .ffill{position:absolute;left:0;right:0;bottom:0;background:var(--k-c,var(--hi-accent))}
.fader .fring{position:absolute;left:-2px;right:-2px;background:rgba(255,212,121,.55)}
.fader .kv{font:600 11px var(--mono);margin-top:2px}
.fader .kl{font-size:11px;color:var(--hi-dim)}
.rgba{display:flex;align-items:flex-end;gap:2px}
.rgba .swatch{width:22px;height:74px;border-radius:6px;border:1px solid var(--hi-line);align-self:flex-start;margin-top:2px;background-image:none}

/* ---- xy pads */
.xy{display:flex;flex-direction:column;align-items:center;gap:2px}
.xypad,.mousepad{position:relative;width:112px;height:88px;border-radius:10px;background:radial-gradient(circle at 50% 50%,#2a2e36,#16181c);border:1px solid var(--hi-line);touch-action:none;overflow:hidden}
.xypad .xh{position:absolute;left:0;right:0;height:1px;background:rgba(255,255,255,.2)}
.xypad .xv{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.2)}
.xdot{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:var(--k-c,var(--hi-accent));box-shadow:0 0 10px var(--k-c,var(--hi-accent));pointer-events:none;left:50%;top:50%}
.xlock{position:absolute;left:4px;bottom:2px;font-size:10px;color:var(--k-mod)}
.xyknobs{display:flex}
.vec{display:flex;flex-direction:column;gap:2px;max-width:120px}
.vec code{font:11px var(--mono);color:var(--c-num)}

/* ---- jacks */
.jack{display:flex;flex-direction:column;gap:2px;align-items:flex-start;border-radius:10px;padding:2px}
.jack .jl{font-size:11px;color:var(--hi-dim)}
.plug{display:inline-flex;align-items:center;gap:6px;font:600 13px var(--mono);color:var(--c-ref);border-radius:999px;padding:0 12px}
.plug .hole{width:14px;height:14px;border-radius:50%;background:#000;border:3px solid #6b717c}
.plug.empty{color:var(--hi-dim);border-style:dashed}
.mini{display:flex;flex-direction:column;gap:4px}
.minihead{display:flex;gap:2px}
.minibtn{font:600 13px var(--mono);color:var(--k-src);text-align:left}
.mini .deep{max-width:160px;color:var(--hi-dim);font-size:11px}

/* ---- trays */
.trays{display:flex;flex-direction:column;gap:8px}
.tray{border:1px solid var(--hi-line);border-radius:12px;padding:6px 8px;overflow-x:auto}
.tray h3{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--hi-dim);text-transform:uppercase;letter-spacing:.05em}
.tray.unplugged{border-style:dashed}
.tray .lanerow{margin-bottom:6px}
.outtile.plug-in{border-style:dashed}
.varrow,.noterow,.setuprow{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
.var{display:flex;align-items:center;gap:6px;border:1px solid var(--hi-line);border-radius:12px;padding:4px 8px;background:rgba(255,212,121,.04)}
.var.sel{box-shadow:0 0 0 2px var(--c-var)}
.vname{font:600 13px var(--mono);color:var(--c-var);border:0;background:transparent}
.note{font-size:13px;text-align:left;color:#9aa0a6;font-style:italic;max-width:420px;white-space:pre-wrap;padding:6px 10px;min-height:44px}
.setupitem .numslider{width:140px}
.empty-rack{color:var(--hi-dim);padding:12px}

/* ---- mod bay */
.bay{display:flex;align-items:stretch;gap:8px;padding:6px max(8px,env(safe-area-inset-right)) 6px max(8px,env(safe-area-inset-left));border-top:1px solid var(--hi-line);background:var(--hi-panel);min-width:0}
.tiles{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.tile{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:68px;min-height:64px;border-radius:12px;border:1px solid rgba(255,212,121,.35);background:rgba(255,212,121,.06);touch-action:none;cursor:grab}
.tile b{font-size:20px;color:var(--k-mod)}
.tile span{font-size:11px}
.tile .meter{width:50px}
.tile.armed{background:var(--k-mod);color:#000}
.tile.armed b{color:#000}
.mousepad{width:120px;height:64px;flex:none}
.mousepad small{position:absolute;left:6px;top:4px;font-size:10px;color:var(--hi-dim)}
.drag-ghost{position:fixed;left:0;top:0;z-index:100;pointer-events:none;padding:8px 12px;border-radius:12px;background:var(--k-mod);color:#000;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.5)}

/* ---- scenes */
.scenes{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;padding-right:max(6px,env(safe-area-inset-right));border-left:1px solid var(--hi-line);background:var(--hi-panel);overflow-y:auto;min-height:0}
.scenes>small{font-size:10px;color:var(--hi-dim);text-transform:uppercase}
.scene{width:52px;min-height:44px;font:600 15px var(--mono);color:var(--hi-dim);touch-action:none}
.scene.full{color:var(--hi-text);border-color:var(--k-mod);background:rgba(255,212,121,.1)}
.scene.fading{animation:pulse .5s infinite alternate}
@keyframes pulse{to{background:rgba(255,212,121,.45)}}
.scenes .fade{width:52px;font-size:13px}

/* ---- mod editor popover */
.modedit{display:flex;flex-direction:column;gap:8px;padding:10px}
.modhead{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.modhead span{font-size:12px;color:var(--hi-dim)}
.modedit .seg{flex-wrap:wrap;align-items:center}
.modedit .seg small{padding:0 8px;color:var(--hi-dim)}
.modedit .steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:4px}
.modedit .row{display:flex;gap:6px}
.modedit .note,.sources .note{font-size:12px;color:var(--hi-dim);margin:0}
.modedit .expr{display:flex;flex-direction:column;gap:6px}
.modedit textarea{font:13px var(--mono);background:var(--hi-bg);color:var(--hi-text);border:1px solid var(--hi-line);border-radius:8px;padding:6px}
.picker{padding:8px;max-height:min(70vh,560px);overflow-y:auto}
.picker h4{margin:8px 0 4px;font-size:11px;color:var(--hi-dim);text-transform:uppercase}
.pick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:4px}
.pick{font:13px var(--mono);padding:0 6px;border-left:3px solid var(--k-c,var(--hi-line))}
.pick.t-src{--k-c:var(--k-src)}.pick.t-coord{--k-c:var(--k-coord)}.pick.t-color{--k-c:var(--k-color)}.pick.t-combine{--k-c:var(--k-combine)}.pick.t-combineCoord{--k-c:var(--k-combineCoord)}
.pick.on{background:rgba(90,200,200,.18)}
.sources{display:flex;flex-direction:column;gap:8px}
.srcrow{display:flex;align-items:center;gap:10px}
.srcrow .grow{flex:1;font:12px var(--mono);color:var(--hi-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- PiP output + performance mode */
.banners-wrap{position:relative;z-index:6}
.pip{position:absolute;z-index:9;border-radius:12px;overflow:hidden;border:1px solid var(--hi-line);background:#000;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.pip .stage-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;container-type:size}
.stage-slot>.stage{position:relative;width:100%;height:100%;flex:none}
@supports (width:1cqw){.stage-slot>.stage{width:min(100cqw,177.78cqh);height:min(100cqh,56.25cqw)}}
.pip-grip{position:absolute;left:0;right:0;top:0;height:40%;touch-action:none;cursor:move;display:flex;gap:4px;padding:4px;align-items:flex-start}
.pip-full{position:absolute;right:4px;top:4px;background:rgba(0,0,0,.5);border-color:transparent}
.pip-resize{position:absolute;right:0;bottom:0;width:36px;height:36px;touch-action:none;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,rgba(255,255,255,.35) 55%,rgba(255,255,255,.35) 62%,transparent 62%,transparent 72%,rgba(255,255,255,.35) 72%,rgba(255,255,255,.35) 79%,transparent 79%)}
.pip.perform{position:fixed;inset:0;border:0;border-radius:0;z-index:40}
.perform-ui{position:absolute;inset:0;pointer-events:none}
.perform-ui>*{pointer-events:auto}
.perform-ui .exit{position:absolute;right:max(12px,env(safe-area-inset-right));top:max(12px,env(safe-area-inset-top));background:rgba(0,0,0,.55)}
.pins{position:absolute;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;padding:8px 10px;border-radius:18px;background:rgba(0,0,0,.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);max-width:calc(100% - 24px);overflow-x:auto}
.pins .knob{opacity:.88}
.pins .knob .kl{color:#ddd}
.nopins{color:#ddd;padding:8px}
.pscenes{position:absolute;right:max(12px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:6px}
.pscenes .scene{background:rgba(0,0,0,.45)}

/* ---- backdrop (contract §6): the output fills the screen behind everything; panels sit on a veil, stacked top to bottom
   so the switcher's drop-down opens over what is below it. The output's ancestors carry no transform/filter/contain. */
html.hi-backdrop .app{background:transparent}
html.hi-backdrop .topbar{position:relative;z-index:4;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .topbar .name{background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .foot{position:relative;z-index:1;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .foot .runinfo,html.hi-backdrop .foot a{text-shadow:var(--hi-ink-shadow)}
html.hi-backdrop .codepane{z-index:1;background:transparent;border-color:var(--hi-veil-line)}
html.hi-backdrop .mixer{position:relative;z-index:3;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .rack-col{z-index:2}
html.hi-backdrop .scenes,html.hi-backdrop .bay{position:relative;z-index:1;background:var(--hi-veil);border-color:var(--hi-veil-line)}
html.hi-backdrop .lane,html.hi-backdrop .tray{background:transparent;border-color:var(--hi-veil-line)}
html.hi-backdrop .lanehead{background:var(--hi-veil);border-color:var(--hi-veil-line);border-radius:12px 0 0 12px}
html.hi-backdrop .module{background:var(--hi-veil)}
html.hi-backdrop .module.unknown{background:rgba(42,42,42,var(--hi-veil-a,.55))}
html.hi-backdrop .outtile,html.hi-backdrop .addmod,html.hi-backdrop .addgen,html.hi-backdrop .var,html.hi-backdrop .note,html.hi-backdrop .setupitem .btn{background:var(--hi-veil)}
html.hi-backdrop .tray h3,html.hi-backdrop .mixgroup>small,html.hi-backdrop .scenes>small,html.hi-backdrop .knob .kl,html.hi-backdrop .knob .kv,html.hi-backdrop .lanerow .tag{text-shadow:var(--hi-ink-shadow)}
html.hi-backdrop .stage-slot>.stage{width:100%;height:100%}
`
