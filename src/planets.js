/* planets.js — data loading, 3D mesh creation, textures, glow, and interactions.
   Exposes initPlanets(), filterPlanets(), checkHover(), checkClick(),
   and animatePlanets() to the global scope for main.js and ui.js to call.    */

// ── Module-level state ────────────────────────────────────────────────────────
// planetMeshes holds { mesh, data, glowSprite, habitableGlow } per planet,
// giving every other function a single place to look up meshes and raw data.
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

    // Build UI now that planet data is loaded
    buildFilterPanel();
    loadModelStats();

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


// ── Procedural planet textures ────────────────────────────────────────────────
// Each planet gets a unique canvas-drawn texture based on its type.
// A seeded LCG RNG driven by the planet name ensures the same planet always
// looks the same across page loads (deterministic, not random each time).

function _hashStr(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function _makeRng(seed) {
  var s = seed >>> 0;
  return function () {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Convert 0–255 float to a 2-char hex string (used for alpha stops).
function _hexA(n) {
  return ('0' + Math.round(n).toString(16)).slice(-2);
}

function _planetType(data) {
  var r = data.radius, t = data.temperature;
  if (r > 5)             return 'gas';
  if (r > 2)             return 'subneptune';
  if (t > 1500)          return 'lava';
  if (t < 150)           return 'ice';
  if (data.is_habitable) return 'habitable';
  if (t > 600)           return 'hot_rocky';
  return 'rocky';
}

function createPlanetTexture(data) {
  var W = 256, H = 128;
  var cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  var ctx = cvs.getContext('2d');
  var rng  = _makeRng(_hashStr(data.name || ''));
  var type = _planetType(data);
  var col  = getPlanetColor(data.temperature);
  var r    = Math.round(col.r * 255);
  var g    = Math.round(col.g * 255);
  var b    = Math.round(col.b * 255);
  function cl(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  if (type === 'gas') {
    // Base fill, then alpha-blended wavy bands at higher opacity than before
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.fillRect(0, 0, W, H);
    var numBands = 9 + Math.floor(rng() * 5);
    for (var i = 0; i < numBands; i++) {
      var by = (i / numBands) * H, bh = H / numBands;
      var d  = (rng() - 0.5) * 130;  // was 90 — wider brightness swing
      ctx.fillStyle = 'rgba(' + cl(r+d) + ',' + cl(g+d*0.8) + ',' + cl(b+d*0.6) + ','
                      + (0.65 + rng() * 0.3) + ')';  // was 0.3–0.8, now 0.65–0.95
      ctx.beginPath();
      ctx.moveTo(0, by + rng() * 8 - 4);
      ctx.bezierCurveTo(W*0.33, by+rng()*14-7, W*0.67, by+rng()*14-7, W, by+rng()*8-4);
      ctx.lineTo(W, by + bh); ctx.lineTo(0, by + bh); ctx.closePath(); ctx.fill();
    }
    // Storm spot — larger and more visible
    for (var s = 0; s < 1 + Math.floor(rng() * 2); s++) {
      var sx = W*(0.2+rng()*0.6), sy = H*(0.3+rng()*0.4);
      var sw = W*(0.07+rng()*0.1), sh2 = H*(0.055+rng()*0.07);
      var stG = ctx.createRadialGradient(sx, sy, 0, sx, sy, sw);
      stG.addColorStop(0,   rng() > 0.5 ? 'rgba(0,0,0,0.75)' : 'rgba(255,230,170,0.85)');
      stG.addColorStop(0.6, rng() > 0.5 ? 'rgba(0,0,0,0.3)'  : 'rgba(255,200,100,0.35)');
      stG.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = stG;
      ctx.beginPath(); ctx.ellipse(sx, sy, sw, sh2, 0, 0, Math.PI*2); ctx.fill();
    }

  } else if (type === 'habitable') {
    // Deep ocean base
    ctx.fillStyle = '#0a2d5e'; ctx.fillRect(0, 0, W, H);
    // Slightly brighter shallow water
    ctx.fillStyle = 'rgba(25,85,165,0.6)';
    for (var i2 = 0; i2 < 5; i2++) {
      ctx.beginPath();
      ctx.ellipse(rng()*W, rng()*H, 25+rng()*45, 18+rng()*30, rng()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    // Land — larger blobs, higher opacity (was 0.3-0.5, now solid via fillStyle)
    var lands = ['#2a7a14', '#1e6510', '#527a18', '#7a4f18', '#5e3a10'];
    for (var l = 0; l < 4 + Math.floor(rng() * 3); l++) {
      ctx.fillStyle = lands[Math.floor(rng() * lands.length)];
      var lx = rng()*W, ly = H*0.1 + rng()*H*0.8;
      ctx.beginPath(); ctx.moveTo(lx, ly);
      for (var p = 0; p < 10; p++) {
        var pa = (p/10)*Math.PI*2, pr = 18 + rng()*38;
        ctx.lineTo(lx + Math.cos(pa)*pr, ly + Math.sin(pa)*pr*0.8);
      }
      ctx.closePath(); ctx.fill();
    }
    // Polar caps — solid then gradient fade
    ctx.fillStyle = 'rgba(230,245,255,0.95)';
    ctx.fillRect(0, 0, W, H*0.13);
    ctx.fillRect(0, H*0.87, W, H*0.13);
    var ng = ctx.createLinearGradient(0, H*0.13, 0, H*0.22);
    ng.addColorStop(0, 'rgba(230,245,255,0.7)'); ng.addColorStop(1, 'rgba(230,245,255,0)');
    ctx.fillStyle = ng; ctx.fillRect(0, H*0.13, W, H*0.09);
    var sg2 = ctx.createLinearGradient(0, H*0.78, 0, H*0.87);
    sg2.addColorStop(0, 'rgba(230,245,255,0)'); sg2.addColorStop(1, 'rgba(230,245,255,0.7)');
    ctx.fillStyle = sg2; ctx.fillRect(0, H*0.78, W, H*0.09);
    // Cloud streaks — higher opacity than before (was 0.15–0.35, now 0.4–0.65)
    for (var c = 0; c < 5; c++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + rng()*0.25) + ')';
      ctx.beginPath();
      ctx.ellipse(rng()*W, H*(0.2+rng()*0.6), W*(0.16+rng()*0.28), 3+rng()*7, rng()*0.3, 0, Math.PI*2);
      ctx.fill();
    }

  } else if (type === 'lava') {
    // Dark base
    ctx.fillStyle = '#1a0800'; ctx.fillRect(0, 0, W, H);
    // Rock plates
    for (var i3 = 0; i3 < 12; i3++) {
      ctx.fillStyle = 'rgba(' + cl(30+rng()*25) + ',' + cl(10+rng()*8) + ',4,0.7)';
      ctx.beginPath();
      ctx.ellipse(rng()*W, rng()*H, 18+rng()*50, 12+rng()*35, rng()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    // Cracks — thicker (was 0.5–3, now 2–6) with soft outer glow
    for (var i4 = 0; i4 < 18; i4++) {
      var x1=rng()*W, y1=rng()*H, x2=x1+rng()*85-42, y2=y1+rng()*85-42;
      var mx=x1+rng()*30-15, my=y1+rng()*30-15;
      ctx.strokeStyle = 'rgba(255,90,0,0.45)';
      ctx.lineWidth = 6 + rng()*7;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(mx,my,x2,y2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,' + cl(160+rng()*80) + ',20,0.9)';
      ctx.lineWidth = 1.5 + rng()*2.5;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(mx,my,x2,y2); ctx.stroke();
    }
    // Lava pools — larger radius than before (was 4–16, now 10–28)
    for (var i5 = 0; i5 < 7; i5++) {
      var px=rng()*W, py=rng()*H, pr2=10+rng()*18;
      var pg = ctx.createRadialGradient(px,py,0,px,py,pr2);
      pg.addColorStop(0,   'rgba(255,220,80,0.98)');
      pg.addColorStop(0.45,'rgba(255,80,0,0.8)');
      pg.addColorStop(1,   'rgba(120,15,0,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px,py,pr2,0,Math.PI*2); ctx.fill();
    }

  } else if (type === 'ice') {
    // Bright base
    var ig = ctx.createLinearGradient(0,0,W,H);
    ig.addColorStop(0,'#c5e8f8'); ig.addColorStop(0.5,'#eaf6ff'); ig.addColorStop(1,'#a8d4ee');
    ctx.fillStyle = ig; ctx.fillRect(0,0,W,H);
    // Tinted patches
    for (var i6b = 0; i6b < 10; i6b++) {
      ctx.fillStyle = 'rgba(150,205,240,0.45)';
      ctx.beginPath();
      ctx.ellipse(rng()*W, rng()*H, 15+rng()*45, 10+rng()*30, rng()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    // Cracks — thicker and more opaque (was 0–1.5px at 0.5 opacity, now 1.5–4px)
    for (var i6 = 0; i6 < 28; i6++) {
      ctx.strokeStyle = 'rgba(50,110,185,' + (0.55 + rng()*0.35) + ')';
      ctx.lineWidth = 1.5 + rng()*2.5;
      var ix=rng()*W, iy=rng()*H;
      ctx.beginPath(); ctx.moveTo(ix,iy);
      ctx.lineTo(ix+rng()*65-32, iy+rng()*65-32); ctx.stroke();
    }

  } else if (type === 'subneptune') {
    // Gradient base
    var sng = ctx.createLinearGradient(0,0,W,H);
    sng.addColorStop(0,   'rgb('+cl(r+50)+','+cl(g+35)+','+cl(b+65)+')');
    sng.addColorStop(1,   'rgb('+cl(r-45)+','+cl(g-30)+','+cl(b+35)+')');
    ctx.fillStyle = sng; ctx.fillRect(0,0,W,H);
    // Cloud bands — higher opacity (was 0.04–0.16, now 0.2–0.4)
    for (var i8 = 0; i8 < 7; i8++) {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + rng()*0.2) + ')';
      ctx.fillRect(0, rng()*H, W, 5 + rng()*14);
    }

  } else {
    // Rocky base
    ctx.fillStyle = 'rgb('+r+','+g+','+b+')'; ctx.fillRect(0,0,W,H);
    // Surface variation patches — higher opacity (was /200, now /130)
    for (var i9 = 0; i9 < 10; i9++) {
      var dv = (rng()-0.5)*80;
      ctx.fillStyle = 'rgba('+(dv>0?0:255)+',0,0,'+Math.abs(dv)/130+')';
      ctx.beginPath();
      ctx.ellipse(rng()*W, rng()*H, 12+rng()*38, 9+rng()*26, rng()*Math.PI, 0, Math.PI*2);
      ctx.fill();
    }
    // Craters — darker floor (was 0.45, now 0.65) and brighter rim (was 0.18, now 0.45)
    for (var i10 = 0; i10 < 12; i10++) {
      var cx2=rng()*W, cy2=rng()*H, cr2=4+rng()*18;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath(); ctx.arc(cx2,cy2,cr2,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,210,0.45)'; ctx.lineWidth = 1.5+rng()*2.5;
      ctx.beginPath(); ctx.arc(cx2,cy2,cr2,0,Math.PI*2); ctx.stroke();
    }
    if (type === 'hot_rocky') {
      var hg = ctx.createLinearGradient(0,0,W*0.38,0);
      hg.addColorStop(0,'rgba(255,90,0,0.45)'); hg.addColorStop(1,'rgba(255,90,0,0)');
      ctx.fillStyle = hg; ctx.fillRect(0,0,W*0.38,H);
    }
  }

  return new THREE.CanvasTexture(cvs);
}


// ── Glow sprite for habitable planets ────────────────────────────────────────
// A Sprite is a flat image that always faces the camera (billboard behaviour).
// We draw a radial gradient on an HTML canvas to create a soft circular glow,
// then turn it into a Three.js texture.
//
// depthWrite: false — transparent pixels don't occlude objects behind the sprite.
// AdditiveBlending — glow colour is added to the background rather than
//   painted over it, making it look luminous instead of opaque.
// glowStrength (0–1) controls how opaque the centre of the glow is.
// 0.45 = subtle per-planet halo; 1.0 = bright habitable bloom.
function addGlowSprite(scene, position, planetSize, color, scaleFactor, glowStrength) {
  var canvas = document.createElement("canvas");
  canvas.width  = 128;
  canvas.height = 128;
  var ctx = canvas.getContext("2d");
  var s   = (glowStrength !== undefined) ? glowStrength : 0.6;

  var hex      = "#" + color.getHexString();
  var gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0,   hex + _hexA(s * 210));
  gradient.addColorStop(0.3, hex + _hexA(s * 130));
  gradient.addColorStop(0.7, hex + _hexA(s *  50));
  gradient.addColorStop(1,   hex + "00");

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
  // Sort by orbital distance so inner rings = close-orbiting planets,
  // outer rings = wide-orbit planets. Physically meaningful AND ensures
  // the golden-angle spacing spreads diverse planets rather than clustering
  // all the similar-orbit ones together.
  var sorted = planets.slice().sort(function (a, b) {
    return a.orbital_distance - b.orbital_distance;
  });

  sorted.forEach(function (data, i) {

    // ── Size ──────────────────────────────────────────────────────────────────
    var size = mapRange(data.radius, 0.3, 15, 0.3, 3.0);

    // ── Position — golden-angle sunflower spiral ───────────────────────────
    // The golden angle (≈137.508°) is irrational, so no two planets ever
    // share the same angular spoke regardless of how many planets there are.
    // r = 8 * sqrt(i+1) guarantees each planet has ~8 units of clearance from
    // its nearest neighbours — safely above the 6-unit diameter of the largest
    // sphere. The scene spans radius 8 (innermost) to ~540 (outermost).
    //
    // Y still encodes star temperature (cool dwarfs low, hot stars high) plus
    // a small sine jitter so the disk has visible thickness from all angles.
    var goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.399 rad (137.508°)
    var sceneRadius = 8 * Math.sqrt(i + 1);
    var angle       = i * goldenAngle;
    var x = Math.cos(angle) * sceneRadius;
    var z = Math.sin(angle) * sceneRadius;
    var y = ((data.star_temp - 3000) / 7000) * 160 - 80 +
            Math.sin(i * 0.7) * 15;

    // ── Geometry and material ─────────────────────────────────────────────────
    var geometry = new THREE.SphereGeometry(size, 32, 32);
    var color    = getPlanetColor(data.temperature);

    // Procedural canvas texture gives each planet a unique surface appearance.
    // color is kept as emissive so the planet glows faintly with its own tint
    // even on the unlit side. The map itself is white-multiplied (no color tint).
    var material = new THREE.MeshStandardMaterial({
      map:               createPlanetTexture(data),
      emissive:          color,
      emissiveIntensity: data.is_habitable ? 0.15 : 0.04,
      roughness:         0.85,
      metalness:         0.0,
    });

    var mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.userData.planetData    = data;
    // Rotation speed from orbital period — shorter period = faster spin, capped so
    // nothing spins distractingly fast. Units: radians per frame at 60 fps.
    // Spread rotation speeds visibly: 0.004–0.012 rad/frame = 8–24 sec per rotation
    mesh.userData.rotationSpeed = 0.004 + (_hashStr(data.name) % 100) / 100 * 0.008;
    // Unique phase offset so habitable glows don't all pulse in sync
    mesh.userData.glowPhase     = i * 0.41;

    scene.add(mesh);

    // Temperature-coloured glow halo on every planet (scaleFactor 14, strength 0.45)
    var glowSprite = addGlowSprite(scene, mesh.position, size, color, 14, 0.45);

    // Large bright-green bloom for habitable planets (scaleFactor 42, full strength)
    var habitableGlow = null;
    if (data.is_habitable) {
      habitableGlow = addGlowSprite(
        scene, mesh.position, size, new THREE.Color(0x00e676), 42, 1.0
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
    animateCameraTo(mesh.position, mesh.geometry.parameters.radius);
  }
}


// ── Per-frame animations ──────────────────────────────────────────────────────
function animatePlanets(elapsed) {
  planetMeshes.forEach(function (p) {
    // Axial rotation
    p.mesh.rotation.y += p.mesh.userData.rotationSpeed;

    // Habitable glow breathes — each planet has its own phase so they pulse
    // independently rather than all brightening and dimming together.
    if (p.habitableGlow && p.habitableGlow.visible) {
      var base  = p.mesh.geometry.parameters.radius * 42;
      var pulse = 1.0 + Math.sin(elapsed * 1.3 + p.mesh.userData.glowPhase) * 0.18;
      p.habitableGlow.scale.setScalar(base * pulse);
    }
  });
}


// ── Filtering ─────────────────────────────────────────────────────────────────
// Called by ui.js whenever a slider or checkbox changes.
// null for maxDistance / maxMass means "no upper limit" (slider at ceiling).
// Planets with unknown distance or mass always pass through — we don't
// penalise missing data caused by incomplete observations.
function filterPlanets(minScore, minRadius, maxRadius, habitableOnly, maxDistance, maxMass) {
  var count = 0;
  planetMeshes.forEach(function (p) {
    var d    = p.data;
    var show = (
      d.habitability_score >= minScore &&
      d.radius >= minRadius            &&
      d.radius <= maxRadius            &&
      (!habitableOnly || d.is_habitable) &&
      (maxDistance === null || maxDistance === undefined || d.distance === null || d.distance <= maxDistance) &&
      (maxMass     === null || maxMass     === undefined || d.mass     === null || d.mass     <= maxMass)
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
