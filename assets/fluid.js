/*
 * Cursor-driven fluid smoke.
 * A compact port of Pavel Dobryakov's WebGL Fluid Simulation (MIT License,
 * https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), trimmed to the parts
 * this site uses: no bloom or sunrays, pastel dye, pauses itself when idle.
 */
(function () {
  'use strict';

  const CONFIG = {
    SIM_RESOLUTION: 128,
    DYE_RESOLUTION: 720,
    DENSITY_DISSIPATION: 0.9,
    VELOCITY_DISSIPATION: 2.6,
    PRESSURE: 0.1,
    PRESSURE_ITERATIONS: 20,
    CURL: 3,
    SPLAT_RADIUS: 0.22,
    SPLAT_FORCE: 6000,
    COLOR_UPDATE_SPEED: 10,
    INTENSITY: 0.16,
    IDLE_MS: 7000,
  };

  // Hues drawn from the site palette: amber, lilac, mint, coral, sky.
  const HUES = [0.11, 0.73, 0.43, 0.03, 0.56];

  function startFluid(canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: true };
    let gl = canvas.getContext('webgl2', params);
    const isWebGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    if (!gl) return null;

    let halfFloat, linear;
    if (isWebGL2) {
      gl.getExtension('EXT_color_buffer_float');
      linear = gl.getExtension('OES_texture_float_linear');
    } else {
      halfFloat = gl.getExtension('OES_texture_half_float');
      linear = gl.getExtension('OES_texture_half_float_linear');
    }
    const texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
    if (!texType) return null;
    gl.clearColor(0, 0, 0, 0);

    function supportsFormat(internalFormat, format) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, texType, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(t);
      return ok;
    }
    function pickFormat(internalFormat, format) {
      if (supportsFormat(internalFormat, format)) return { internalFormat, format };
      if (isWebGL2 && internalFormat === gl.R16F) return pickFormat(gl.RG16F, gl.RG);
      if (isWebGL2 && internalFormat === gl.RG16F) return pickFormat(gl.RGBA16F, gl.RGBA);
      return null;
    }
    const fmtRGBA = isWebGL2 ? pickFormat(gl.RGBA16F, gl.RGBA) : pickFormat(gl.RGBA, gl.RGBA);
    const fmtRG = isWebGL2 ? pickFormat(gl.RG16F, gl.RG) : pickFormat(gl.RGBA, gl.RGBA);
    const fmtR = isWebGL2 ? pickFormat(gl.R16F, gl.RED) : pickFormat(gl.RGBA, gl.RGBA);
    if (!fmtRGBA || !fmtRG || !fmtR) return null;

    /* ---------- shaders ---------- */
    const VERT = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv, vL, vR, vT, vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`;
    const HEAD = 'precision highp float; precision highp sampler2D; varying vec2 vUv, vL, vR, vT, vB;\n';

    const FRAG = {
      clear: `uniform sampler2D uTexture; uniform float value;
        void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,

      display: `uniform sampler2D uTexture; uniform vec2 texelSize;
        void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
          c *= diffuse;
          float a = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c, a);
        }`,

      splat: `uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
        void main () {
          vec2 p = vUv - point.xy;
          p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
        }`,

      advection: `uniform sampler2D uVelocity; uniform sampler2D uSource;
        uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;
        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5;
          vec2 iuv = floor(st);
          vec2 fuv = fract(st);
          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
          vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
          vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }
        void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
          float decay = 1.0 + dissipation * dt;
          gl_FragColor = result / decay;
        }`,

      divergence: `uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).x;
          float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y;
          float B = texture2D(uVelocity, vB).y;
          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) { L = -C.x; }
          if (vR.x > 1.0) { R = -C.x; }
          if (vT.y > 1.0) { T = -C.y; }
          if (vB.y < 0.0) { B = -C.y; }
          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }`,

      curl: `uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).y;
          float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x;
          float B = texture2D(uVelocity, vB).x;
          gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
        }`,

      vorticity: `uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
        void main () {
          float L = texture2D(uCurl, vL).x;
          float R = texture2D(uCurl, vR).x;
          float T = texture2D(uCurl, vT).x;
          float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;
          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001;
          force *= curl * C;
          force.y *= -1.0;
          vec2 velocity = texture2D(uVelocity, vUv).xy + force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`,

      pressure: `uniform sampler2D uPressure; uniform sampler2D uDivergence;
        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          float divergence = texture2D(uDivergence, vUv).x;
          gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
        }`,

      gradient: `uniform sampler2D uPressure; uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uPressure, vL).x;
          float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x;
          float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`,
    };

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    function program(name, defines) {
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, (defines || '') + HEAD + FRAG[name]));
      gl.bindAttribLocation(p, 0, 'aPosition');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      return { use() { gl.useProgram(p); return u; } };
    }

    let P;
    try {
      P = {
        clear: program('clear'),
        display: program('display'),
        splat: program('splat'),
        advection: program('advection', linear ? '' : '#define MANUAL_FILTERING\n'),
        divergence: program('divergence'),
        curl: program('curl'),
        vorticity: program('vorticity'),
        pressure: program('pressure'),
        gradient: program('gradient'),
      };
    } catch (e) {
      return null;
    }

    // full-screen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    function blit(target) {
      if (target) {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      } else {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    function fbo(w, h, fmt, filter) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, w, h, 0, fmt.format, texType, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        texture, fbo: fb, width: w, height: h, tx: 1 / w, ty: 1 / h,
        attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; },
        free() { gl.deleteTexture(texture); gl.deleteFramebuffer(fb); },
      };
    }
    function doubleFbo(w, h, fmt, filter) {
      let a = fbo(w, h, fmt, filter), b = fbo(w, h, fmt, filter);
      return {
        width: w, height: h, tx: 1 / w, ty: 1 / h,
        get read() { return a; }, get write() { return b; },
        swap() { const t = a; a = b; b = t; },
        free() { a.free(); b.free(); },
      };
    }

    function resolution(res) {
      let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspect < 1) aspect = 1 / aspect;
      const min = Math.round(res), max = Math.round(res * aspect);
      return gl.drawingBufferWidth > gl.drawingBufferHeight ? { w: max, h: min } : { w: min, h: max };
    }

    let dye, velocity, divergence, curl, pressure;
    function initFramebuffers() {
      [dye, velocity, divergence, curl, pressure].forEach((f) => f && f.free());
      const sim = resolution(CONFIG.SIM_RESOLUTION);
      const dyeRes = resolution(CONFIG.DYE_RESOLUTION);
      const filter = linear ? gl.LINEAR : gl.NEAREST;
      gl.disable(gl.BLEND);
      dye = doubleFbo(dyeRes.w, dyeRes.h, fmtRGBA, filter);
      velocity = doubleFbo(sim.w, sim.h, fmtRG, filter);
      divergence = fbo(sim.w, sim.h, fmtR, gl.NEAREST);
      curl = fbo(sim.w, sim.h, fmtR, gl.NEAREST);
      pressure = doubleFbo(sim.w, sim.h, fmtR, gl.NEAREST);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resizeCanvas() {
      const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
      return false;
    }
    resizeCanvas();
    initFramebuffers();

    /* ---------- simulation ---------- */
    function step(dt) {
      gl.disable(gl.BLEND);
      let u = P.curl.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      gl.uniform1i(u.uVelocity, velocity.read.attach(0));
      blit(curl);

      u = P.vorticity.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      gl.uniform1i(u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(u.uCurl, curl.attach(1));
      gl.uniform1f(u.curl, CONFIG.CURL);
      gl.uniform1f(u.dt, dt);
      blit(velocity.write); velocity.swap();

      u = P.divergence.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      gl.uniform1i(u.uVelocity, velocity.read.attach(0));
      blit(divergence);

      u = P.clear.use();
      gl.uniform1i(u.uTexture, pressure.read.attach(0));
      gl.uniform1f(u.value, CONFIG.PRESSURE);
      blit(pressure.write); pressure.swap();

      u = P.pressure.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      gl.uniform1i(u.uDivergence, divergence.attach(0));
      for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(u.uPressure, pressure.read.attach(1));
        blit(pressure.write); pressure.swap();
      }

      u = P.gradient.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      gl.uniform1i(u.uPressure, pressure.read.attach(0));
      gl.uniform1i(u.uVelocity, velocity.read.attach(1));
      blit(velocity.write); velocity.swap();

      u = P.advection.use();
      gl.uniform2f(u.texelSize, velocity.tx, velocity.ty);
      if (u.dyeTexelSize) gl.uniform2f(u.dyeTexelSize, velocity.tx, velocity.ty);
      const vId = velocity.read.attach(0);
      gl.uniform1i(u.uVelocity, vId);
      gl.uniform1i(u.uSource, vId);
      gl.uniform1f(u.dt, dt);
      gl.uniform1f(u.dissipation, CONFIG.VELOCITY_DISSIPATION);
      blit(velocity.write); velocity.swap();

      if (u.dyeTexelSize) gl.uniform2f(u.dyeTexelSize, dye.tx, dye.ty);
      gl.uniform1i(u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(u.uSource, dye.read.attach(1));
      gl.uniform1f(u.dissipation, CONFIG.DENSITY_DISSIPATION);
      blit(dye.write); dye.swap();
    }

    function render() {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      const u = P.display.use();
      gl.uniform2f(u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
      gl.uniform1i(u.uTexture, dye.read.attach(0));
      blit(null);
    }

    function splat(x, y, dx, dy, color) {
      const aspect = canvas.width / canvas.height;
      let u = P.splat.use();
      gl.uniform1i(u.uTarget, velocity.read.attach(0));
      gl.uniform1f(u.aspectRatio, aspect);
      gl.uniform2f(u.point, x, y);
      gl.uniform3f(u.color, dx, dy, 0);
      let r = CONFIG.SPLAT_RADIUS / 100;
      if (aspect > 1) r *= aspect;
      gl.uniform1f(u.radius, r);
      blit(velocity.write); velocity.swap();

      gl.uniform1i(u.uTarget, dye.read.attach(0));
      gl.uniform3f(u.color, color.r, color.g, color.b);
      blit(dye.write); dye.swap();
    }

    function hsv(h, s, v) {
      const i = Math.floor(h * 6), f = h * 6 - i;
      const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
      const m = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
      return { r: m[0], g: m[1], b: m[2] };
    }
    function generateColor() {
      const h = HUES[Math.floor(Math.random() * HUES.length)] + (Math.random() - 0.5) * 0.04;
      const c = hsv((h + 1) % 1, 0.75, 1);
      c.r *= CONFIG.INTENSITY; c.g *= CONFIG.INTENSITY; c.b *= CONFIG.INTENSITY;
      return c;
    }

    /* ---------- pointer ---------- */
    const pointer = { x: 0, y: 0, px: 0, py: 0, dx: 0, dy: 0, moved: false, ready: false, color: generateColor() };
    function onMove(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = 1 - (clientY - rect.top) / rect.height;
      if (!pointer.ready) { pointer.x = x; pointer.y = y; pointer.ready = true; }
      pointer.px = pointer.x; pointer.py = pointer.y;
      pointer.x = x; pointer.y = y;
      const aspect = rect.width / rect.height;
      pointer.dx = (x - pointer.px) * (aspect < 1 ? aspect : 1);
      pointer.dy = (y - pointer.py) / (aspect > 1 ? aspect : 1);
      pointer.moved = Math.abs(pointer.dx) > 0 || Math.abs(pointer.dy) > 0;
      wake();
    }
    window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });

    /* ---------- loop (sleeps when idle) ---------- */
    let last = performance.now(), lastInput = last, running = false, colorTimer = 0;
    function wake() {
      lastInput = performance.now();
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
    }
    function frame() {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.016666);
      last = now;
      if (resizeCanvas()) initFramebuffers();
      colorTimer += dt * CONFIG.COLOR_UPDATE_SPEED;
      if (colorTimer >= 1) { colorTimer %= 1; pointer.color = generateColor(); }
      if (pointer.moved) {
        pointer.moved = false;
        splat(pointer.x, pointer.y, pointer.dx * CONFIG.SPLAT_FORCE, pointer.dy * CONFIG.SPLAT_FORCE, pointer.color);
      }
      step(dt);
      render();
      if (now - lastInput < CONFIG.IDLE_MS && !document.hidden) requestAnimationFrame(frame);
      else running = false;
    }

    // A few soft puffs on load so the page isn't empty before the mouse moves.
    function intro() {
      const pts = [[0.18, 0.72], [0.82, 0.62], [0.6, 0.88]];
      pts.forEach(([x, y]) => {
        const c = generateColor();
        c.r *= 6; c.g *= 6; c.b *= 6;
        splat(x, y, (Math.random() - 0.5) * 900, (Math.random() - 0.5) * 900, c);
      });
      wake();
    }
    intro();

    window.addEventListener('resize', wake);
    return { splat, wake };
  }

  window.startFluid = startFluid;
})();
