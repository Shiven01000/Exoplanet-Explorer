/* ui.js — panels, filters, tooltips.
   Full implementation added in Steps 11-13. Stubs here prevent errors.     */

function buildFilterPanel()    { /* implemented in Step 12 */ }
function showInfoPanel(data)   { /* implemented in Step 11 */ }
function closeInfoPanel()      { /* implemented in Step 11 */ }
function showTooltip(e, name) {
  var tip = document.getElementById("planet-tooltip");
  tip.textContent  = name;
  tip.style.display = "block";
  tip.style.left   = (e.clientX + 14) + "px";
  tip.style.top    = (e.clientY - 8)  + "px";
}

function hideTooltip() {
  document.getElementById("planet-tooltip").style.display = "none";
}
function loadModelStats()      { /* implemented in Step 13 */ }
function updateTopBar(n, acc)  { /* implemented in Step 13 */ }
