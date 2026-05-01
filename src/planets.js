/* planets.js — loads exoplanets.json and renders planets as 3D spheres.
   Colors, glow, and interactions are added in later steps.                  */

// ── Module-level state ────────────────────────────────────────────────────────
// These arrays are shared across functions in this file.
// planetMeshes holds one { mesh, data } object per planet so we can
// later raycast against meshes and look up the underlying data on hit.
var allPlanets   = [];
var planetMeshes = [];

// Scene references passed in from main.js
var _scene, _camera, _renderer, _controls;


// ── Entry point ───────────────────────────────────────────────────────────────
// Called once from main.js after the Three.js scene is set up.
function initPlanets(scene, camera, renderer, controls) {
  _scene    = scene;
  _camera   = camera;
  _renderer = renderer;
  _controls = controls;
  loadAndRender();
}


// ── Data loading ──────────────────────────────────────────────────────────────
// async function so we can use await for the fetch call.
// Any error (missing file, bad JSON, network failure) is caught and displayed
// on the loading screen rather than silently failing.
async function loadAndRender() {
  try {
    var response = await fetch("data/exoplanets.json");

    if (!response.ok) {
      throw new Error(
        "Could not load exoplanets.json (HTTP " + response.status + "). " +
        "Run the ML pipeline first: cd ml && python train_model.py"
      );
    }

    allPlanets = await response.json();
    console.log("Loaded " + allPlanets.length + " planets from JSON.");

    // Build the 3D scene objects
    createStarField(_scene);
    createPlanetMeshes(_scene, allPlanets);

    console.log("planetMeshes.length =", planetMeshes.length);

    // Fade out the loading screen to reveal the scene
    var loadingScreen = document.getElementById("loading-screen");
    loadingScreen.classList.add("fade-out");
    setTimeout(function () {
      loadingScreen.style.display = "none";
    }, 750);

  } catch (err) {
    // Show the error on the loading screen so the user knows what went wrong
    document.querySelector(".loader-text").textContent = "Error loading data";
    document.querySelector(".loader-sub").textContent  = err.message;
    console.error(err);
  }
}


// ── Colour: temperature → colour via smooth interpolation ────────────────────
// Instead of hard colour cutoffs (snap to nearest), we linearly interpolate
// between adjacent stops. A planet at 260K sits between the blue stop (200K)
// and green stop (273K), so it gets a proportional mix of both colours.
// THREE.Color.lerp(other, alpha) blends the colour toward `other` by `alpha`
// (0 = unchanged, 1 = fully other).
function getPlanetColor(temp) {
  // Stops are spread across the ACTUAL temperature distribution in the dataset:
  //   median = 808K, 81% of planets are above 500K.
  // The old scale spent most of its range on the coldest 20% of planets.
  // This scale gives the hot majority real visual variation.
  var stops = [
    { t: 0,    c: new THREE.Color(0x1a237e) },  // deep blue   — frozen (< 200K)
    { t: 200,  c: new THREE.Color(0x1565c0) },  // blue        — cold
    { t: 273,  c: new THREE.Color(0x2e7d32) },  // green       — habitable zone
    { t: 400,  c: new THREE.Color(0xf57f17) },  // amber       — warm
    { t: 700,  c: new THREE.Color(0xbf360c) },  // deep orange — hot (30% of planets here)
    { t: 1200, c: new THREE.Color(0x7f0000) },  // dark red    — very hot (median is 808K)
    { t: 2500, c: new THREE.Color(0x3e0000) },  // maroon      — extreme
    { t: 4050, c: new THREE.Color(0x1a0000) },  // near black  — star-surface hot
  ];

  if (temp <= stops[0].t) return stops[0].c.clone();

  for (var i = 1; i < stops.length; i++) {
    if (temp <= stops[i].t) {
      var alpha = (temp - stops[i - 1].t) / (stops[i].t - stops[i - 1].t);
      return stops[i - 1].c.clone().lerp(stops[i].c, alpha);
    }
  }

  return stops[stops.length - 1].c.clone();
}


// ── Glow sprite for habitable planets ────────────────────────────────────────
// A Sprite is a flat image that always faces the camera (billboard behaviour).
// We draw a radial gradient on an HTML canvas to create a soft circular glow,
// then turn it into a Three.js texture.
//
// depthWrite: false — transparent pixels don't occlude objects behind the sprite.
// AdditiveBlending — glow colour is added to the background rather than
//   painted over it, making it look luminous instead of opaque.
function addGlowSprite(scene, position, planetSize, color, scaleFactor) {
  var canvas = document.createElement("canvas");
  canvas.width  = 128;
  canvas.height = 128;
  var ctx = canvas.getContext("2d");

  var hex      = "#" + color.getHexString();
  var gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0,   hex + "99");  // semi-transparent centre
  gradient.addColorStop(0.3, hex + "55");  // fade toward edge
  gradient.addColorStop(0.7, hex + "22");  // nearly transparent
  gradient.addColorStop(1,   hex + "00");  // fully transparent at rim

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  var texture = new THREE.CanvasTexture(canvas);
  var mat = new THREE.SpriteMaterial({
    map:         texture,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });

  var sprite = new THREE.Sprite(mat);
  sprite.position.copy(position);
  sprite.scale.setScalar(planetSize * (scaleFactor || 9));
  sprite.userData.isGlow = true;

  scene.add(sprite);
  return sprite;
}


// ── Helper: map a value from one range to another ─────────────────────────────
// e.g. mapRange(1.0, 0.3, 15, 0.3, 3.0) maps Earth's radius (1.0 Earth radii)
// to a sphere size of ~0.37 units in the scene.
// The input value is clamped to [inMin, inMax] before mapping.
function mapRange(val, inMin, inMax, outMin, outMax) {
  var clamped = Math.max(inMin, Math.min(inMax, val));
  return outMin + (clamped - inMin) / (inMax - inMin) * (outMax - outMin);
}


// ── Planet meshes ─────────────────────────────────────────────────────────────
function createPlanetMeshes(scene, planets) {
  planets.forEach(function (data, i) {

    // ── Size ──────────────────────────────────────────────────────────────────
    // Map the planet's radius in Earth radii to a scene unit sphere size.
    // Real radii in our dataset range from ~0.3 to ~25 Earth radii.
    // We map that to a visual range of 0.3 to 3.0 units so small planets
    // are still visible and giant ones don't dominate the whole view.
    var size = mapRange(data.radius, 0.3, 15, 0.3, 3.0);

    // ── Position ──────────────────────────────────────────────────────────────
    // Spiral layout — deterministic, no random overlap.
    //
    // angle: evenly-spaced around 7 full spiral rotations across the dataset.
    //
    // sceneRadius: base of 20 ensures nothing lands at the origin; log-scaled
    //   orbital distance * 120 spreads the bulk of planets across 37–180 units;
    //   star_temp * 30 adds a secondary spread axis so planets around different
    //   star types don't all sit at the same radius. Capped at 250 to prevent
    //   the ~0.5% of extreme-orbit outliers from stretching the scene to 1000+
    //   units and making the other 99% invisible.
    //
    // y: star_temp drives the vertical band (cool red dwarfs low, hot stars
    //   high) across ±100 units. Per-planet sine jitter of ±40 breaks up flat
    //   horizontal layers so the scene looks 3D from all angles.
    var angle       = (i / planets.length) * Math.PI * 2 * 7;
    var rawRadius   = 20 + Math.log1p(data.orbital_distance) * 120 +
                      (data.star_temp / 5000) * 30;
    var sceneRadius = Math.min(rawRadius, 250);
    var y = ((data.star_temp - 3000) / 7000) * 200 - 100 +
            Math.sin(i * 0.37) * 40;
    var x = Math.cos(angle) * sceneRadius;
    var z = Math.sin(angle) * sceneRadius;

    // ── Geometry and material ─────────────────────────────────────────────────
    var geometry = new THREE.SphereGeometry(size, 16, 16);
    var color    = getPlanetColor(data.temperature);

    // MeshStandardMaterial is physically-based — it reacts to scene lights.
    // emissive makes planets glow slightly with their own colour so they are
    // visible even on the dark side. Habitable planets glow more strongly.
    var material = new THREE.MeshStandardMaterial({
      color:             color,
      emissive:          color,
      emissiveIntensity: data.is_habitable ? 0.18 : 0.04,
      roughness:         0.75,
      metalness:         0.1,
    });

    var mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.userData.planetData = data;

    scene.add(mesh);

    // Subtle temperature-coloured glow on every planet
    var glowSprite = addGlowSprite(scene, mesh.position, size, color, 5);

    // Prominent bright-green glow for habitable planets
    var habitableGlow = null;
    if (data.is_habitable) {
      habitableGlow = addGlowSprite(
        scene, mesh.position, size, new THREE.Color(0x00e676), 18
      );
    }

    planetMeshes.push({ mesh: mesh, data: data, glowSprite: glowSprite, habitableGlow: habitableGlow });
  });
}


// ── Star field ────────────────────────────────────────────────────────────────
// We render 10,000 stars as a SINGLE Three.js Points object rather than
// 10,000 individual Mesh objects. This means one GPU draw call instead of
// 10,000 — critical for maintaining 60 fps.
function createStarField(scene) {
  var count     = 10000;
  var positions = new Float32Array(count * 3);  // x,y,z for each star

  for (var i = 0; i < count; i++) {
    // Uniformly distribute points on a sphere shell at radius 400–1000 units.
    // Using spherical coordinates (theta, phi) rather than random x,y,z
    // gives even distribution — random x,y,z would cluster at corners.
    var theta = Math.random() * Math.PI * 2;
    var phi   = Math.acos(2 * Math.random() - 1);
    var r     = 400 + Math.random() * 600;

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3)  // 3 values (x,y,z) per point
  );

  var material = new THREE.PointsMaterial({
    color:           0xffffff,
    size:            1.5,
    sizeAttenuation: true,   // farther stars appear smaller (perspective)
    transparent:     true,
    opacity:         0.8,
  });

  var stars = new THREE.Points(geometry, material);
  scene.add(stars);

  // Expose for the twinkle animation we'll add later
  window._starField = stars;
}


// ── Hover & click via raycasting ──────────────────────────────────────────────
// Both functions share one Raycaster and one mouse vector, recreated each call.
// We only test against planet meshes — glow sprites are excluded so clicks
// on the large habitable halo still register on the planet, not the sprite.

var _hoveredMesh = null;  // track which mesh is currently enlarged

function _raycastPlanets(clientX, clientY) {
  var raycaster = new THREE.Raycaster();
  var mouse     = new THREE.Vector2(
    (clientX / window.innerWidth)  *  2 - 1,
    (clientY / window.innerHeight) * -2 + 1
  );
  raycaster.setFromCamera(mouse, _camera);
  return raycaster.intersectObjects(planetMeshes.map(function (p) { return p.mesh; }));
}

function checkHover(event) {
  var hits = _raycastPlanets(event.clientX, event.clientY);

  if (hits.length > 0) {
    var mesh = hits[0].object;

    // Only update if we've moved to a different planet
    if (_hoveredMesh !== mesh) {
      if (_hoveredMesh) _hoveredMesh.scale.setScalar(1.0);
      _hoveredMesh = mesh;
      mesh.scale.setScalar(1.2);
    }

    showTooltip(event, mesh.userData.planetData.name);
    document.body.style.cursor = "pointer";
  } else {
    if (_hoveredMesh) {
      _hoveredMesh.scale.setScalar(1.0);
      _hoveredMesh = null;
    }
    hideTooltip();
    document.body.style.cursor = "default";
  }
}

function checkClick(event) {
  var hits = _raycastPlanets(event.clientX, event.clientY);
  if (hits.length > 0) {
    var mesh = hits[0].object;
    var data = mesh.userData.planetData;
    showInfoPanel(data);
    animateCameraTo(mesh.position);
  }
}


// ── Filter (stub) ─────────────────────────────────────────────────────────────
// Full implementation comes in Step 12. This stub prevents a crash if ui.js
// calls filterPlanets before it's fully implemented.
function filterPlanets(minScore, minRadius, maxRadius, habitableOnly) {
  var count = 0;
  planetMeshes.forEach(function (p) {
    var d    = p.data;
    var show = (
      d.habitability_score >= minScore &&
      d.radius >= minRadius            &&
      d.radius <= maxRadius            &&
      (!habitableOnly || d.is_habitable)
    );
    p.mesh.visible = show;
    if (p.glowSprite)    p.glowSprite.visible    = show;
    if (p.habitableGlow) p.habitableGlow.visible = show;
    if (show) count++;
  });
  var el = document.getElementById("filtered-count");
  if (el) el.textContent = count + " planets";
  return count;
}
