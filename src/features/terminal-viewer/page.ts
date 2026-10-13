export const VIEWER_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Matrix terminals</title><link rel="stylesheet" href="/terminal.css">
<style>
body{margin:0;background:#10151c;color:#e8eef5;font:14px system-ui}header{padding:14px;display:flex;gap:12px;align-items:center;border-bottom:1px solid #334155}
button,select{background:#253449;color:inherit;border:1px solid #50627b;border-radius:5px;padding:7px;cursor:pointer}button:focus{outline:2px solid #6dd8ad}
#status{margin-left:auto;color:#b1c6db}#panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:10px;padding:10px}
.pane{min-width:0;border:1px solid #40526b;border-radius:6px;overflow:hidden}.bar{display:flex;align-items:center;gap:6px;padding:6px;background:#1b2635}.title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.screen{height:360px;padding:6px;background:#10151c;resize:vertical;overflow:hidden}.pane:focus-within{border-color:#6dd8ad}#panes[data-layout="rows"]{grid-template-columns:1fr}
</style></head><body><header><strong>Matrix terminals</strong><button id="new">New shell</button><select id="layout" aria-label="Pane layout"><option value="grid">Split grid</option><option value="rows">Stacked</option></select><span id="status">Connecting…</span></header>
<main id="panes"></main><script type="module" src="/terminal.js"></script></body></html>`
