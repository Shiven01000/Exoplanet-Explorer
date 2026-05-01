/* ui.js — panels, filters, tooltips.
   Full implementation added in Steps 11-13. Stubs here prevent errors.     */

var MAX_DISTANCE = 30000;  // ly — slider ceiling
var MAX_MASS     = 4000;   // Earth masses — slider ceiling

function buildFilterPanel() {
  var panel = document.getElementById("filter-panel");
  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;">' +
      '<h2>FILTERS</h2>' +
      '<button class="panel-close" id="filter-toggle" onclick="toggleFilterPanel()" title="Collapse">▲</button>' +
    '</div>' +

    '<div id="filter-body">' +
      '<div class="filter-group">' +
        '<label>Min habitability score: <strong id="score-val">0%</strong></label>' +
        '<input type="range" id="f-score" min="0" max="100" value="0" step="1">' +
      '</div>' +

      '<div class="filter-group">' +
        '<label class="checkbox-row">' +
          '<input type="checkbox" id="f-habitable">' +
          '<span>Habitable planets only</span>' +
        '</label>' +
      '</div>' +

      '<div class="filter-group">' +
        '<label>Max distance: <strong id="dist-val">All</strong></label>' +
        '<input type="range" id="f-dist" min="0" max="' + MAX_DISTANCE + '" value="' + MAX_DISTANCE + '" step="500">' +
      '</div>' +

      '<div class="filter-group">' +
        '<label>Max mass: <strong id="mass-val">All</strong></label>' +
        '<input type="range" id="f-mass" min="0" max="' + MAX_MASS + '" value="' + MAX_MASS + '" step="10">' +
      '</div>' +

      '<div class="filter-group">' +
        '<label>Min radius: <strong id="rmin-val">0.3</strong> Earth radii</label>' +
        '<input type="range" id="f-rmin" min="0.3" max="15" value="0.3" step="0.1">' +
      '</div>' +

      '<div class="filter-group">' +
        '<label>Max radius: <strong id="rmax-val">15</strong> Earth radii</label>' +
        '<input type="range" id="f-rmax" min="0.3" max="15" value="15" step="0.1">' +
      '</div>' +

      '<div class="filter-group">' +
        '<span id="filtered-count">— planets</span>' +
      '</div>' +
    '</div>';

  panel.addEventListener("input",  applyFilters);
  panel.addEventListener("change", applyFilters);
  applyFilters();
}

function toggleFilterPanel() {
  var body    = document.getElementById("filter-body");
  var btn     = document.getElementById("filter-toggle");
  var closing = body.style.display !== "none";
  body.style.display = closing ? "none" : "block";
  btn.textContent    = closing ? "▼" : "▲";
  btn.title          = closing ? "Expand" : "Collapse";
}

function applyFilters() {
  var score   = parseFloat(document.getElementById("f-score").value) / 100;
  var habOnly = document.getElementById("f-habitable").checked;
  var dist    = parseFloat(document.getElementById("f-dist").value);
  var mass    = parseFloat(document.getElementById("f-mass").value);
  var rMin    = parseFloat(document.getElementById("f-rmin").value);
  var rMax    = parseFloat(document.getElementById("f-rmax").value);

  // Keep min radius ≤ max radius
  if (rMin > rMax) { rMax = rMin; document.getElementById("f-rmax").value = rMin; }

  // Update labels — show "All" when slider is at its ceiling
  document.getElementById("score-val").textContent = Math.round(score * 100) + "%";
  document.getElementById("dist-val").textContent  = dist >= MAX_DISTANCE ? "All" : dist.toLocaleString() + " ly";
  document.getElementById("mass-val").textContent  = mass >= MAX_MASS     ? "All" : mass.toFixed(0) + " M⊕";
  document.getElementById("rmin-val").textContent  = rMin.toFixed(1);
  document.getElementById("rmax-val").textContent  = rMax.toFixed(1);

  var maxDist = dist >= MAX_DISTANCE ? null : dist;
  var maxMass = mass >= MAX_MASS     ? null : mass;
  filterPlanets(score, rMin, rMax, habOnly, maxDist, maxMass);
}
function showInfoPanel(data) {
  var panel  = document.getElementById("info-panel");
  var score  = Math.round(data.habitability_score * 100);
  var dist   = data.distance ? data.distance.toFixed(0) + " ly" : "Unknown";
  var mass   = data.mass     ? data.mass.toFixed(2) + " Earth masses" : "Unknown";

  panel.innerHTML =
    '<button class="panel-close" onclick="closeInfoPanel()">✕</button>' +
    '<div class="planet-name">' + data.name + '</div>' +
    '<div class="star-name">Host star: ' + data.star + '</div>' +
    '<div class="data-grid">' +
      _dataItem("RADIUS",       data.radius.toFixed(2) + " Earth radii") +
      _dataItem("MASS",         mass) +
      _dataItem("ORB. PERIOD",  data.orbital_period.toFixed(1) + " days") +
      _dataItem("TEMPERATURE",  Math.round(data.temperature) + " K") +
      _dataItem("STAR TEMP",    Math.round(data.star_temp) + " K") +
      _dataItem("DISTANCE",     dist) +
    '</div>' +
    '<div class="hab-section">' +
      '<div class="hab-label">Habitability Score</div>' +
      '<div class="hab-bar-track">' +
        '<div class="hab-bar-fill" style="width:' + score + '%"></div>' +
      '</div>' +
      '<div class="hab-score-text">' + score + '%</div>' +
      '<span class="hab-badge ' + (data.is_habitable ? "badge-habitable" : "badge-not") + '">' +
        (data.is_habitable ? "Potentially Habitable" : "Not in Habitable Zone") +
      '</span>' +
    '</div>';

  panel.classList.remove("hidden");
  panel.classList.add("visible");
}

function _dataItem(label, value) {
  return '<div class="data-item">' +
    '<span class="data-label">' + label + '</span>' +
    '<span class="data-value">' + value + '</span>' +
  '</div>';
}

function closeInfoPanel() {
  var panel = document.getElementById("info-panel");
  panel.classList.remove("visible");
  panel.classList.add("hidden");
}
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
function loadModelStats() {
  fetch("data/model_stats.json")
    .then(function (r) { return r.json(); })
    .then(function (stats) {
      updateTopBar(stats.total_planets, stats.accuracy);

      document.getElementById("model-stats-text").textContent =
        "Random Forest · " +
        stats.n_estimators + " trees · " +
        stats.accuracy.toFixed(1) + "% accuracy · " +
        "top feature: " + stats.top_feature + " · " +
        stats.habitable_count + " habitable / " + stats.total_planets + " planets";
    })
    .catch(function () {
      document.getElementById("model-stats-text").textContent = "Model stats unavailable";
    });
}

function updateTopBar(n, acc) {
  document.getElementById("planet-count-display").textContent   = n.toLocaleString() + " planets";
  document.getElementById("model-accuracy-display").textContent = acc.toFixed(1) + "% ML accuracy";
}
