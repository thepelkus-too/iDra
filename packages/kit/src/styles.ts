// The kit's base CSS: popovers, sheets, toasts, the scrub HUD, the keypad, the number editor, the ladder and the pads. Editors put it into their own stylesheet
// (BASE_CSS) and may override it after; the number controls' own look (.numslider sizes, .tok.num) stays with each editor.
export const KIT_CSS = `
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

/* ---- number editor */
.numed{display:flex;flex-direction:column;gap:8px}
.numed-tabs{display:flex;width:100%}
.numed-tabs button{flex:1;min-height:40px;font-size:14px}
.glide{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--hi-line);padding-top:6px}
.glide-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.glide-row .switch{min-height:40px;font-weight:600}
.glide-dur{width:64px;min-height:40px;border-radius:8px;border:1px solid var(--hi-line);background:var(--hi-bg);color:var(--hi-text);font:16px var(--mono);padding:0 8px}
.glide-dur.bad{border-color:var(--bad)}
.glide-sec{color:var(--hi-dim);font-size:12px}
.glide-durs,.curves{display:flex;flex-wrap:wrap;gap:4px}
.glide-durs .chip{min-height:34px;min-width:40px;padding:0 6px;font:13px var(--mono);border-radius:8px}
.chip.on,.curve.on{border-color:var(--hi-accent);background:rgba(90,200,200,.18)}
.curve{min-height:36px;min-width:40px;padding:2px 4px;border-radius:8px}
.curve svg path{fill:none;stroke:var(--c-num);stroke-width:2}
.glide-status{flex:1;font:12px var(--mono);color:var(--hi-dim)}
.glide .btn.wide{min-height:40px;font-size:14px}

/* ---- ladder */
.ladder{position:fixed;transform:translateX(-50%);width:96px;pointer-events:none;z-index:6;display:flex;flex-direction:column}
.overlays>.ladder{pointer-events:none}
.ladder .rung,.ladder-panel .rung{display:flex;align-items:center;justify-content:center;border:1px solid var(--hi-line);background:rgba(20,24,30,.92);font:600 15px var(--mono);color:var(--hi-dim);margin-top:-1px}
.ladder .ladder-value+.rung{border-radius:10px 10px 0 0}
.ladder .rung:last-child{border-radius:0 0 10px 10px}
.ladder .rung.on,.ladder-panel .rung.on{background:var(--hi-accent);color:#04201f;animation:ladder-tick .14s ease-out}
.ladder-value{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(20,24,30,.96);border:1px solid var(--hi-accent);border-radius:12px;padding:4px 12px;text-align:center;display:flex;flex-direction:column}
.ladder-value b{font:600 22px var(--mono);color:var(--c-num)}
.ladder-value small{font-size:11px;color:var(--hi-dim)}
@keyframes ladder-tick{from{transform:scale(1.12)}to{transform:scale(1)}}
.ladder-panel{display:flex;flex-direction:column;gap:8px}
.lp-value{display:flex;align-items:baseline;justify-content:space-between;padding:4px 8px;background:var(--hi-bg);border-radius:10px}
.lp-value b{font:600 26px var(--mono);color:var(--c-num)}
.lp-value small{color:var(--hi-dim);font-size:12px}
.lp-body{display:flex;flex-direction:column;touch-action:none;border-radius:10px;overflow:hidden;outline-offset:2px}
.lp-body .rung{cursor:ew-resize}
.lp-steps{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.lp-steps .btn{min-height:48px;font:600 17px var(--mono)}
.lp-hint{margin:0;font-size:12px;color:var(--hi-dim)}

/* ---- pads */
.padtab,.padeditor{display:flex;flex-direction:column;gap:8px}
.pad-note{margin:0;font-size:13px;line-height:1.4;color:var(--hi-dim)}
.pad-note code,.pe-head code{font:12px var(--mono);color:var(--hi-text)}
.pe-head{display:flex;flex-direction:column;gap:2px}
.pad-inert{color:var(--warn);font-size:12px}
.pe-pad{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--hi-line);padding-top:6px}
.pe-modes{display:flex}
.pe-modes button{flex:1}
.pe-hint{color:var(--hi-dim);font-size:12px}
.pe-try{display:flex;justify-content:center}
.pe-try .pad{width:140px;height:72px}
.pad{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:100%;height:76px;border-radius:14px;border:2px solid var(--hi-line);background:#1b2028;color:var(--hi-text);touch-action:none;-webkit-user-select:none;user-select:none;padding:4px 6px}
.pad b{font-size:14px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pad small{font:11px var(--mono);color:var(--hi-dim)}
.pad.down,.pad.latched{background:var(--hi-accent);border-color:var(--hi-accent);color:#04201f}
.pad.down small,.pad.latched small{color:#04201f}
.pad.inert{opacity:.5;border-style:dashed}
.pad.compact{width:96px;height:56px}
.paddock{position:fixed;inset:0;pointer-events:none;z-index:1}
.overlays>.paddock{pointer-events:none}
.dockpad,.dockcard{position:fixed;pointer-events:auto;display:flex;flex-direction:column;gap:2px;background:rgba(14,17,22,.88);border:1px solid var(--hi-line);border-radius:16px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.5)}
.dockcard{flex-direction:row;align-items:center;gap:8px;font-size:13px;padding:4px 4px 4px 12px}
.dockpad-bar{display:flex;justify-content:space-between;align-items:center}
.dockpad .grip{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:32px;color:var(--hi-dim);touch-action:none;cursor:grab;font-size:18px}
.dockpad .icon.sm{min-height:32px;min-width:44px;width:44px;font-size:15px}
.padstrip{display:flex;gap:8px;flex-wrap:wrap}
`
