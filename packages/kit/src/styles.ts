// The kit's base CSS: popovers, sheets, toasts, the scrub HUD and the keypad. Editors put it into their own stylesheet
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
`
