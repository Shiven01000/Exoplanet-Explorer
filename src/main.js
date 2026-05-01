/* main.js — Three.js scene, camera, lights, render loop, and camera fly-to.
   Wrapped in an IIFE to keep scene internals out of the global scope;
   only animateCameraTo is exposed on window for planets.js to call.         */

(function () {

  // ── Scene ─────────────────────────────────────────────────────────────────
  // The scene is the container for everything in the 3D world.
  // 0x000810 is a near-black with a very slight blue tint — looks more like
  // deep space than pure black (#000000).
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000810);

  // ── Camera ────────────────────────────────────────────────────────────────
  // PerspectiveCamera(fov, aspectRatio, nearClip, farClip)
  // fov 60° is a natural-feeling field of view (human eye is ~120°, but
  // 60° avoids the distortion you get at wide angles in 3D scenes).
  // nearClip / farClip define the "frustum" — objects outside 0.1–2000 units
  // are not rendered. This prevents z-fighting on very close objects and
  // saves GPU work on very distant ones.
  var camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    4000
  );
  // Sunflower spiral spans radius 8–540; pull back to see the whole disk
  camera.position.set(0, 120, 600);

  // ── Renderer ──────────────────────────────────────────────────────────────
  // We pass the existing <canvas> element from index.html rather than letting
  // Three.js create one — this way the canvas is already in the DOM with our
  // CSS applied (position: fixed, fills viewport).
  var canvas   = document.getElementById("three-canvas");
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  // setPixelRatio ensures sharp rendering on high-DPI (Retina) screens.
  // Capped at 2 — going higher gives diminishing visual returns but
  // multiplies the number of pixels the GPU must render (4x at ratio=2).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // ── Lights ────────────────────────────────────────────────────────────────
  // Ambient: soft blue-tinted fill so the dark sides of planets aren't black.
  var ambientLight = new THREE.AmbientLight(0x223355, 0.7);
  scene.add(ambientLight);

  // Point: a bright white light positioned above and in front, creates
  // highlights and shadows that give planets a spherical appearance.
  var pointLight = new THREE.PointLight(0xffffff, 1.3, 600);
  pointLight.position.set(0, 60, 60);
  scene.add(pointLight);

  // A dim fill light from below prevents the undersides from being too dark.
  var fillLight = new THREE.PointLight(0x112244, 0.4, 400);
  fillLight.position.set(0, -80, 0);
  scene.add(fillLight);

  // ── OrbitControls ─────────────────────────────────────────────────────────
  // Allows mouse drag to orbit the camera around the scene origin.
  // enableDamping + dampingFactor give the camera inertia — it coasts to a
  // stop after the user releases the mouse rather than stopping instantly.
  // controls.update() must be called every frame for damping to work.
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.minDistance     = 4;
  controls.maxDistance     = 2500;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 0.25;

  // Pause auto-rotation when the user interacts, resume 3 s after they stop.
  var autoRotateTimer = null;
  renderer.domElement.addEventListener("pointerdown", function () {
    controls.autoRotate = false;
    clearTimeout(autoRotateTimer);
    autoRotateTimer = setTimeout(function () {
      controls.autoRotate = true;
    }, 3000);
  });

  // ── Resize handler ────────────────────────────────────────────────────────
  // When the window resizes, the camera's aspect ratio and the renderer's
  // output size must both be updated, or the scene will appear stretched.
  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Render loop ───────────────────────────────────────────────────────────
  // requestAnimationFrame schedules animate() to run before the next screen
  // repaint — typically 60 times per second. It automatically pauses when the
  // tab is hidden, saving battery and GPU resources.
  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    var elapsed = clock.getElapsedTime();

    controls.update();

    // Star twinkle — swings between 0.4 and 1.0 opacity, clearly visible
    if (window._starField) {
      window._starField.material.opacity = 0.7 + Math.sin(elapsed * 1.8) * 0.3;
    }

    // Planet rotation + habitable glow pulse
    animatePlanets(elapsed);

    renderer.render(scene, camera);
  }

  animate();

  // ── Camera fly-to (called by planets.js on click) ────────────────────────
  // GSAP tweens both camera.position and controls.target simultaneously.
  // controls.target must move too — if only the position moves, OrbitControls
  // will snap the camera back to the origin on the next user drag.
  // onUpdate calls controls.update() each tick so damping stays consistent.
  window.animateCameraTo = function (targetPosition, planetSize) {
    // Scale the stand-off distance with the planet's scene radius so the camera
    // lands the same number of planet-diameters away regardless of planet size.
    // Small planets (r≈0.3) → offset≈6, Earth-sized (r≈1) → offset≈11, giants (r≈3) → offset≈23
    var offset = (planetSize || 1) * 6 + 4;
    gsap.to(camera.position, {
      x: targetPosition.x + offset,
      y: targetPosition.y + offset * 0.5,
      z: targetPosition.z + offset,
      duration: 1.4,
      ease: "power2.inOut",
      onUpdate: function () { controls.update(); },
    });
    gsap.to(controls.target, {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z,
      duration: 1.4,
      ease: "power2.inOut",
    });
  };

  // ── Mouse interaction listeners ───────────────────────────────────────────
  // mousemove drives hover (tooltip + scale pulse).
  // click drives camera fly-to + info panel.
  // Both delegate to functions defined in planets.js.
  renderer.domElement.addEventListener("mousemove", function (e) {
    checkHover(e);
  });
  renderer.domElement.addEventListener("click", function (e) {
    checkClick(e);
  });

  // ── Wire in planets and UI ────────────────────────────────────────────────
  // initPlanets is defined in planets.js (loaded before this script).
  // It fetches the JSON, builds the scene objects, and fades the loading screen.
  initPlanets(scene, camera, renderer, controls);

})();
