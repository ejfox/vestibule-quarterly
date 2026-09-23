/*
 * gl.js — full-bleed WebGL fragment-shader background for Vestibule Quarterly.
 *
 * A slow domain-warped fbm field: ink diffusing through paper. Monochrome by
 * design (black on bone), high-contrast contour bands that drift and breathe.
 * Reacts faintly to the pointer. Zero dependencies, one canvas, one program.
 *
 * Degrades gracefully: no WebGL, a context-creation failure, or
 * prefers-reduced-motion → the canvas stays blank and CSS carries the page.
 */
(() => {
  const canvas = document.getElementById('gl');
  if (!canvas) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const gl =
    canvas.getContext('webgl', { antialias: false, alpha: true }) ||
    canvas.getContext('experimental-webgl', { antialias: false, alpha: true });
  if (!gl) return; // CSS fallback background remains

  const VERT = `
    attribute vec2 p;
    void main() { gl_Position = vec4(p, 0.0, 1.0); }
  `;

  // fbm + domain warp. Palette clamps to near black-and-white with a warm bone
  // paper tone, so it reads as "print" not "screensaver".
  const FRAG = `
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*(3.0-2.0*f);
      return mix(mix(hash(i+vec2(0,0)), hash(i+vec2(1,0)), u.x),
                 mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
    }
    // low-octave fbm — big soft forms, not marble detail
    float fbm(vec2 p){
      float v = 0.0, a = 0.55;
      for(int i=0;i<3;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
      return v;
    }

    void main(){
      vec2 uv = gl_FragCoord.xy / u_res.xy;
      vec2 p = uv;
      p.x *= u_res.x / u_res.y;          // aspect-correct
      float t = u_time * 0.012;          // slow drift — the ink barely moves

      vec2 m = (u_mouse / u_res) - 0.5;

      // one gentle domain warp at a large scale — a few big shapes drifting
      vec2 q = vec2(fbm(p*0.85 + t), fbm(p*0.85 - t + 4.0));
      float f = fbm(p*0.85 + 1.1*q + 0.2*m);

      float ink = smoothstep(0.25, 0.85, f);   // soft, high-contrast wash

      // bone paper -> near-black ink
      vec3 paper = vec3(0.965, 0.957, 0.937);
      vec3 dark  = vec3(0.055, 0.055, 0.070);
      vec3 col = mix(paper, dark, ink);

      // faint grain so the big gradients don't band on cheap panels
      float g = (hash(gl_FragCoord.xy + t) - 0.5) * 0.015;
      col += g;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('shader compile failed:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes   = gl.getUniformLocation(prog, 'u_res');
  const uTime  = gl.getUniformLocation(prog, 'u_time');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => {
    mouse.tx = e.clientX * (window.devicePixelRatio || 1);
    mouse.ty = (innerHeight - e.clientY) * (window.devicePixelRatio || 1);
  }, { passive: true });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(innerWidth * dpr);
    const h = Math.floor(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(uRes, w, h);
  }
  addEventListener('resize', resize, { passive: true });
  resize();

  const start = performance.now();

  function frame(now) {
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce) requestAnimationFrame(frame);
  }

  if (reduce) {
    // one static, evolved frame — still a composed image, just not moving
    gl.uniform2f(uMouse, canvas.width * 0.5, canvas.height * 0.5);
    gl.uniform1f(uTime, 12.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else {
    requestAnimationFrame(frame);
  }
})();
