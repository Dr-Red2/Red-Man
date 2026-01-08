// game.js
// Pure JS, authentic-feel maze chase. Fresh assets, no original IP.
// Features: fruit, ghost house logic, speed tables, cinematic life loss, high scores, mobile controls, level 256 kill screen.

(() => {
  // --- Config ---
  const COLS = 28, ROWS = 31, TILE = 8;
  const FPS = 60, STEP = 1 / FPS;
  const CANVAS = document.getElementById('game');
  const CTX = CANVAS.getContext('2d');
  CANVAS.width = COLS * TILE;
  CANVAS.height = ROWS * TILE;

  const scoreEl = document.getElementById('score');
  const levelEl = document.getElementById('level');
  const livesEl = document.getElementById('lives');
  const highEl = document.getElementById('high');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlaySub = document.getElementById('overlay-sub');

  // Audio (fresh square/noise cues)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioEnabled = false;
  function enableAudioOnce() {
    if (!audioEnabled) {
      audioEnabled = true;
      audioCtx.resume?.();
    }
  }
  function beep(freq, durMs, type = 'square', vol = 0.08) {
    if (!audioEnabled) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    setTimeout(() => { gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02); osc.stop(audioCtx.currentTime + 0.03); }, durMs);
  }
  function noiseBurst(durMs, vol = 0.06) {
    if (!audioEnabled) return;
    const bufferSize = audioCtx.sampleRate * (durMs / 1000);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();
    gain.gain.value = vol;
    src.buffer = buffer; src.connect(gain).connect(audioCtx.destination); src.start();
    setTimeout(() => gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02), durMs);
  }
  function sfx(name) {
    switch (name) {
      case 'dot': beep(660, 30, 'square', 0.06); break;
      case 'energizer': beep(220, 140, 'square', 0.1); break;
      case 'eat': beep(880, 120, 'square', 0.12); noiseBurst(80, 0.04); break;
      case 'death': beep(120, 600, 'square', 0.15); break;
      case 'life': beep(440, 220, 'square', 0.08); break;
      case 'fruit': beep(520, 140, 'square', 0.1); break;
    }
  }

  // --- State ---
  let map = []; // 0 empty, 1 wall, 2 dot, 3 energizer, 4 tunnel
  let pelletsRemaining = 0;
  let mode = 'scatter'; // 'scatter' | 'chase' | 'frightened'
  let schedule = [
    { t: 7, m: 'scatter' }, { t: 20, m: 'chase' },
    { t: 7, m: 'scatter' }, { t: 20, m: 'chase' },
    { t: 5, m: 'scatter' }, { t: 20, m: 'chase' },
    { t: Infinity, m: 'chase' },
  ];
  let schedIndex = 0, modeTimer = 0;
  let level = 1, score = 0, lives = 3;
  let high = Number(localStorage.getItem('high') || 0);
  highEl.textContent = `High: ${high}`;

  // Fruit system
  const fruits = [
    { name: 'berry', score: 100 },
    { name: 'citrus', score: 300 },
    { name: 'melon', score: 500 },
    { name: 'ship', score: 700 },
    { name: 'star', score: 1000 },
  ];
  let fruitActive = false, fruitPos = null, fruitTimer = 0;

  // Input
  const touch = document.getElementById('touch');
  touch.addEventListener('click', (e) => {
    const t = e.target.getAttribute('data-dir');
    if (t) hero.nextDir = t;
  });
  window.addEventListener('keydown', (e) => {
    enableAudioOnce();
    const mapKeys = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
    };
    const d = mapKeys[e.code];
    if (d) hero.nextDir = d;
    if (!overlay.hidden) hideOverlay();
  });
  CANVAS.addEventListener('pointerdown', () => { enableAudioOnce(); if (!overlay.hidden) hideOverlay(); });

  // Helpers
  function updateHUD() {
    scoreEl.textContent = `Score: ${score}`;
    levelEl.textContent = `Level: ${level}`;
    livesEl.textContent = `Lives: ${lives}`;
    if (score > high) { high = score; localStorage.setItem('high', String(high)); highEl.textContent = `High: ${high}`; }
  }
  function dirVec(d) { return d === 'up' ? {x:0,y:-1} : d === 'down' ? {x:0,y:1} : d === 'left' ? {x:-1,y:0} : d === 'right' ? {x:1,y:0} : {x:0,y:0}; }
  function hitsWall(nx, ny) { const r = Math.floor(ny / TILE), c = Math.floor(nx / TILE); return map[r]?.[c] === 1; }
  function canTurn(pos, d) {
    if (!d || d === 'none') return false;
    const v = dirVec(d);
    const cx = Math.round(pos.x / TILE) * TILE, cy = Math.round(pos.y / TILE) * TILE;
    return !hitsWall(cx + v.x, cy + v.y);
  }
  function opposite(d) { return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : d === 'right' ? 'left' : 'none'; }
  function bestDir(from, to) {
    const options = ['up','left','down','right']; // tie-breaking order
    let best = 'none', bestDist = Infinity;
    for (const d of options) {
      const v = dirVec(d);
      const nx = from.x + v.x, ny = from.y + v.y;
      if (!hitsWall(nx, ny)) {
        const dist = Math.abs(nx - to.x) + Math.abs(ny - to.y);
        if (dist < bestDist) { bestDist = dist; best = d; }
      }
    }
    return best;
  }

  // Maze generation: fresh layout evoking classic flow
  function loadBaseMaze() {
    const m = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) m[r][c] = 1;

    // Horizontal corridors
    for (let r of [3, 6, 9, 12, 19, 22, 25, 28]) for (let c = 1; c < COLS - 1; c++) m[r][c] = 0;
    // Vertical pillars
    for (let c of [4, 7, 10, 13, 16, 19, 22, 25]) for (let r = 1; r < ROWS - 1; r++) m[r][c] = 1;
    // Gates
    for (let r of [5, 8, 21, 24, 27]) for (let c of [2, 12, 15, COLS - 3]) m[r][c] = 0;

    // House bounds
    for (let r = 13; r <= 17; r++) for (let c = 10; c <= 17; c++) m[r][c] = 1;
    for (let r = 14; r <= 16; r++) for (let c = 12; c <= 15; c++) m[r][c] = 0;
    // Gate tile (center)
    m[15][13] = 0;

    // Tunnels (wrap)
    for (let r of [15, 16]) { m[r][0] = 4; m[r][COLS - 1] = 4; }
    return m;
  }
  function placeDotsAndEnergizers() {
    pelletsRemaining = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (map[r][c] === 0) { map[r][c] = 2; pelletsRemaining++; }
    }
    const ener = [[3,2],[3,COLS-3],[ROWS-4,2],[ROWS-4,COLS-3]];
    for (const [r,c] of ener) { if (map[r][c] !== 1) map[r][c] = 3; }
  }
  function applyKillScreenSplit() {
    for (let r = 0; r < ROWS; r++) for (let c = COLS >> 1; c < COLS; c++) {
      const chaos = ((r * 131 + c * 197 + 256) & 7);
      map[r][c] = chaos < 2 ? 1 : chaos < 5 ? 2 : 0;
    }
  }
  function generateMap(lvl) {
    map = loadBaseMaze();
    placeDotsAndEnergizers();
    if (lvl === 256) applyKillScreenSplit();
  }

  // Entities
  class Entity {
    constructor(x, y, speedTiles) { this.pos = { x, y }; this.dir = 'none'; this.nextDir = 'none'; this.speedTiles = speedTiles; }
    get speedPx() { return this.speedTiles * TILE; }
    tile() { return { r: Math.floor(this.pos.y / TILE), c: Math.floor(this.pos.x / TILE) }; }
  }

  class Hero extends Entity {
    constructor() { super(14*TILE, 23*TILE, 6.0); this.invincible = false; }
    update(dt) {
      if (canTurn(this.pos, this.nextDir)) this.dir = this.nextDir;
      const v = dirVec(this.dir);
      let nx = this.pos.x + v.x * this.speedPx * dt, ny = this.pos.y + v.y * this.speedPx * dt;
      if (nx < 0) nx = (COLS - 1) * TILE; if (nx >= COLS * TILE) nx = 0;
      if (!hitsWall(nx, ny)) this.pos = { x: nx, y: ny };
      this.eat();
    }
    eat() {
      const { r, c } = this.tile();
      const cell = map[r]?.[c];
      if (cell === 2) { map[r][c] = 0; pelletsRemaining--; score += 10; sfx('dot'); }
      else if (cell === 3) { map[r][c] = 0; pelletsRemaining--; score += 50; energize(); sfx('energizer'); }
      // Fruit
      if (fruitActive && fruitPos && r === fruitPos.r && c === fruitPos.c) {
        const f = fruitForLevel(level);
        score += f.score; fruitActive = false; fruitPos = null; sfx('fruit');
      }
    }
  }
  const hero = new Hero();

  class Ghost extends Entity {
    constructor(type, x, y) {
      super(x, y, 5.5);
      this.type = type; // 'red' | 'pink' | 'cyan' | 'orange'
      this.frightened = false;
      this.eyesOnly = false;
      this.baseSpeed = 5.5;
      this.inHouse = true;
      this.dotCounter = 0; // dots eaten by hero since level start for staggered release
    }
    update(dt) {
      // Speed adjustments
      const { r, c } = this.tile();
      let speed = this.baseSpeed;
      if (map[r]?.[c] === 4) speed *= 0.6; // tunnels
      if (this.frightened) speed *= 0.8;
      this.speedTiles = speed;

      // House gate logic: stay until released
      if (this.inHouse) {
        // Move up/down slowly near gate
        const gate = { x: 13 * TILE, y: 15 * TILE };
        this.dir = bestDir(this.pos, gate);
        this.move(dt);
        return;
      }

      // Normal targeting
      this.chooseTarget();
      this.dir = bestDir(this.pos, this.target);
      this.move(dt);
    }
    move(dt) {
      const v = dirVec(this.dir);
      const nx = this.pos.x + v.x * this.speedPx * dt, ny = this.pos.y + v.y * this.speedPx * dt;
      if (!hitsWall(nx, ny)) this.pos = { x: nx, y: ny };
    }
    chooseTarget() {
      if (this.eyesOnly) { this.target = { x: 13 * TILE, y: 15 * TILE }; return; }
      if (mode === 'scatter') { this.target = scatterCorner(this.type); return; }
      if (this.frightened) { this.target = randomAdjacentTile(this.pos); return; }
      if (this.type === 'red') this.target = heroCenter();
      else if (this.type === 'pink') this.target = aheadOfHero(4);
      else if (this.type === 'cyan') this.target = cyanBlendTarget();
      else if (this.type === 'orange') this.target = orangeFeintTarget(this.pos);
    }
  }

  const ghosts = [
    new Ghost('red', 14*TILE, 11*TILE),
    new Ghost('pink', 13*TILE, 14*TILE),
    new Ghost('cyan', 14*TILE, 14*TILE),
    new Ghost('orange', 15*TILE, 14*TILE),
  ];

  // Targeting helpers
  function heroCenter() { return { x: Math.round(hero.pos.x), y: Math.round(hero.pos.y) }; }
  function aheadOfHero(n) {
    const v = dirVec(hero.dir);
    const c = heroCenter();
    const offset = hero.dir === 'up' ? { x: -TILE, y: 0 } : { x: 0, y: 0 }; // up-direction quirk
    return { x: c.x + v.x * n * TILE + offset.x, y: c.y + v.y * n * TILE + offset.y };
  }
  function cyanBlendTarget() {
    const twoAhead = aheadOfHero(2);
    const red = ghosts[0];
    const vx = (twoAhead.x - red.pos.x) * 2, vy = (twoAhead.y - red.pos.y) * 2;
    return { x: red.pos.x + vx, y: red.pos.y + vy };
  }
  function orangeFeintTarget(pos) {
    const dist = Math.hypot(pos.x - hero.pos.x, pos.y - hero.pos.y) / TILE;
    return dist >= 8 ? heroCenter() : scatterCorner('orange');
  }
  function scatterCorner(t) {
    if (t === 'red') return { x: (COLS - 3) * TILE, y: 2 * TILE };
    if (t === 'pink') return { x: 2 * TILE, y: 2 * TILE };
    if (t === 'cyan') return { x: (COLS - 3) * TILE, y: (ROWS - 3) * TILE };
    return { x: 2 * TILE, y: (ROWS - 3) * TILE };
  }
  function randomAdjacentTile(pos) {
    const dirs = ['up','down','left','right'];
    const d = dirs[Math.floor(Math.random() * 4)];
    const v = dirVec(d);
    return { x: pos.x + v.x * TILE, y: pos.y + v.y * TILE };
  }

  // Mode and frightened
  function updateMode(dt) {
    modeTimer += dt;
    if (mode === 'frightened') return;
    if (modeTimer >= schedule[schedIndex].t) {
      schedIndex = Math.min(schedIndex + 1, schedule.length - 1);
      mode = schedule[schedIndex].m;
      modeTimer = 0;
      reverseGhosts();
    }
  }
  function energize() {
    mode = 'frightened';
    ghosts.forEach(g => g.frightened = true);
    const ms = Math.max(800, 6000 - (level - 1) * 250);
    setTimeout(() => {
      ghosts.forEach(g => g.frightened = false);
      mode = schedule[schedIndex].m;
    }, ms);
  }
  function reverseGhosts() { ghosts.forEach(g => g.dir = opposite(g.dir)); }

  // Elroy (red speeds up as pellets dwindle)
  function applyElroy() {
    const red = ghosts[0];
    if (pelletsRemaining <= 60) red.baseSpeed = 6.2;
    if (pelletsRemaining <= 20) red.baseSpeed = 6.5;
  }

  // Fruit logic
  function fruitForLevel(lvl) {
    return fruits[Math.min(fruits.length - 1, Math.floor((lvl - 1) / 3))];
  }
  function spawnFruit() {
    if (fruitActive) return;
    // Spawn near house
    fruitPos = { r: 17, c: 13 };
    fruitActive = true;
    fruitTimer = 10; // seconds
  }
  function updateFruit(dt) {
    if (!fruitActive) return;
    fruitTimer -= dt;
    if (fruitTimer <= 0) { fruitActive = false; fruitPos = null; }
  }

  // Ghost house release logic
  let dotsEatenThisLevel = 0;
  function onDotEaten() {
    dotsEatenThisLevel++;
    ghosts.forEach((g, i) => {
      // Staggered thresholds (fresh values for authentic feel)
      const thresholds = [0, 20, 40, 60];
      if (g.inHouse && dotsEatenThisLevel >= thresholds[i]) g.inHouse = false;
    });
    // Fruit thresholds: spawn after certain dots
    if (dotsEatenThisLevel === 70 || dotsEatenThisLevel === 170) spawnFruit();
  }

  // Collision and life cycle
  let chain = 200;
  function eatScoreChain() { const val = chain; chain *= 2; if (chain > 1600) chain = 200; return val; }

  function checkCollisions() {
    ghosts.forEach(g => {
      const overlap = Math.hypot(g.pos.x - hero.pos.x, g.pos.y - hero.pos.y) < TILE * 0.6;
      if (!overlap) return;

      if (g.frightened && !g.eyesOnly) {
        score += eatScoreChain();
        g.eyesOnly = true; g.frightened = false;
        sfx('eat');
        // send eyes to house
        g.target = { x: 13 * TILE, y: 15 * TILE };
      } else if (!hero.invincible && !g.eyesOnly) {
        loseLife();
      }
    });
  }

  function loseLife() {
    sfx('death');
    lives--;
    updateHUD();
    showOverlay('Life lost', 'Press any key or tap');
    hero.invincible = true;
    // Cinematic pause
    setTimeout(() => {
      resetPositions();
      hero.invincible = false;
      hideOverlay();
    }, 1300);
    if (lives <= 0) gameOver();
  }

  function gameOver() {
    showOverlay('Game over', 'Press any key or tap to restart');
    lives = 3; level = 1; score = 0; chain = 200;
    setTimeout(() => {
      generateMap(level);
      resetPositions();
      hideOverlay();
    }, 1000);
  }

  function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlay.hidden = false;
  }
  function hideOverlay() { overlay.hidden = true; }

  // Level progression
  function nextLevel() {
    level++; chain = 200; dotsEatenThisLevel = 0;
    ghosts.forEach(g => { g.eyesOnly = false; g.frightened = false; g.inHouse = true; g.baseSpeed = 5.5; });
    hero.pos = { x: 14 * TILE, y: 23 * TILE }; hero.dir = 'none';
    mode = 'scatter'; modeTimer = 0; schedIndex = 0;
    generateMap(level);
    updateHUD();
  }

  function resetPositions() {
    hero.pos = { x: 14 * TILE, y: 23 * TILE }; hero.dir = 'none'; hero.nextDir = 'none';
    ghosts[0].pos = { x: 14 * TILE, y: 11 * TILE };
    ghosts[1].pos = { x: 13 * TILE, y: 14 * TILE };
    ghosts[2].pos = { x: 14 * TILE, y: 14 * TILE };
    ghosts[3].pos = { x: 15 * TILE, y: 14 * TILE };
  }

  // Speed table per level (coarse tuning)
  function applyLevelSpeeds() {
    // Base hero speed scales slightly; frightened and tunnel effects already in movement
    hero.speedTiles = Math.min(8.0, 6.0 + (level - 1) * 0.15);
    ghosts.forEach(g => g.baseSpeed = Math.min(7.2, 5.5 + (level - 1) * 0.12));
  }

  // Rendering
  function render() {
    CTX.fillStyle = '#000'; CTX.fillRect(0, 0, CANVAS.width, CANVAS.height);

    // Maze and pellets
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = map[r][c];
      if (t === 1) { CTX.fillStyle = getCss('--maze'); CTX.fillRect(c*TILE, r*TILE, TILE, TILE); }
      else if (t === 2) { CTX.fillStyle = getCss('--dot'); CTX.fillRect(c*TILE+3, r*TILE+3, 2, 2); }
      else if (t === 3) { CTX.fillStyle = getCss('--energizer'); CTX.beginPath(); CTX.arc(c*TILE+TILE/2, r*TILE+TILE/2, 3, 0, Math.PI*2); CTX.fill(); }
    }

    // Fruit
    if (fruitActive && fruitPos) {
      CTX.fillStyle = '#0f0';
      CTX.fillRect(fruitPos.c*TILE + TILE/2 - 2, fruitPos.r*TILE + TILE/2 - 2, 4, 4);
    }

    // Hero
    CTX.fillStyle = getCss('--hero');
    drawHero(hero.pos.x, hero.pos.y, hero.dir);

    // Ghosts
    ghosts.forEach(g => {
      CTX.fillStyle = g.frightened ? getCss('--frightened') :
        (g.type === 'red' ? getCss('--ghost1') :
         g.type === 'pink' ? getCss('--ghost2') :
         g.type === 'cyan' ? getCss('--ghost3') : getCss('--ghost4'));
      drawGhost(g.pos.x, g.pos.y, g.eyesOnly);
    });

    // Level 256 flavor HUD glitch
    if (level === 256) {
      CTX.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = 0; i < 40; i++) CTX.fillRect(Math.random()*CANVAS.width, Math.random()*CANVAS.height, 2, 2);
    }
  }

  function drawHero(x, y, d) {
    const open = Math.sin(performance.now()/60) * 0.4 + 0.4;
    const start = angleFromDir(d) + open * 0.5;
    const end = angleFromDir(d) + (Math.PI*2) - open * 0.5;
    CTX.beginPath();
    CTX.moveTo(x, y);
    CTX.arc(x, y, TILE/2 - 1, start, end);
    CTX.closePath();
    CTX.fill();
  }
  function angleFromDir(d) {
    return d === 'right' ? 0 : d === 'down' ? Math.PI/2 : d === 'left' ? Math.PI : d === 'up' ? -Math.PI/2 : 0;
  }
  function drawGhost(x, y, eyes) {
    const w = TILE - 2, h = TILE - 2;
    const px = x - w/2, py = y - h/2;
    CTX.fillRect(px, py+2, w, h-2);
    CTX.beginPath(); CTX.moveTo(px, py+h);
    for (let i = 0; i < 4; i++) CTX.arc(px + i*(w/3) + w/6, py+h, w/6, Math.PI, 0, false);
    CTX.fill();
    CTX.fillStyle = '#fff';
    CTX.fillRect(px+2, py+3, 3, 3); CTX.fillRect(px+w-5, py+3, 3, 3);
    CTX.fillStyle = '#22f'; if (!eyes) { CTX.fillRect(px+3, py+4, 2, 2); CTX.fillRect(px+w-4, py+4, 2, 2); }
  }
  function getCss(varName) { return getComputedStyle(document.documentElement).getPropertyValue(varName); }

  // Main loop
  let last = performance.now(), acc = 0;
  function loop(now) {
    const dt = (now - last) / 1000; last = now; acc += dt;
    while (acc >= STEP) {
      updateMode(STEP);
      hero.update(STEP);
      ghosts.forEach(g => g.update(STEP));
      applyElroy();
      updateFruit(STEP);
      checkCollisions();
      acc -= STEP;
    }
    render();
    updateHUD();
    requestAnimationFrame(loop);
  }

  // Game start
  function start() {
    generateMap(level);
    applyLevelSpeeds();
    resetPositions();
    updateHUD();
    showOverlay('Tap or press any key', 'Audio unlock required on mobile');
    requestAnimationFrame(loop);
  }

  // Dot counting hook
  const originalEat = hero.eat.bind(hero);
  hero.eat = function() {
    const before = pelletsRemaining;
    originalEat();
    if (pelletsRemaining < before) onDotEaten();
    if (pelletsRemaining <= 0) nextLevel();
  };

  start();
})();
