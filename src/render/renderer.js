import * as THREE from 'three';

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tColor; uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.6, l), 1.0);
  }`;

const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tInput; uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
    c += texture2D(tInput, vUv + dir * 1.3846).rgb * 0.316216;
    c += texture2D(tInput, vUv - dir * 1.3846).rgb * 0.316216;
    c += texture2D(tInput, vUv + dir * 3.2308).rgb * 0.070270;
    c += texture2D(tInput, vUv - dir * 3.2308).rgb * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }`;

const FINAL_FRAG = /* glsl */ `
  uniform sampler2D tColor, tDepth, tBloom1, tBloom2;
  uniform vec2 res;
  uniform float near, far, levels, bloomStr, exposure, time, vignette, flash, damage;
  uniform vec3 flashColor;
  varying vec2 vUv;
  const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  float linDepth(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return 2.0 * near * far / (far + near - z * (far - near));
  }
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  void main() {
    vec2 px = floor(vUv * res);
    vec2 uv = (px + 0.5) / res;
    vec4 src = texture2D(tColor, uv);
    vec3 c = src.rgb;

    // Ink outline on solid geometry (alpha==1) where a neighbour is farther.
    if (src.a > 0.99) {
      float d = linDepth(uv);
      vec2 o = 1.0 / res;
      float dn = max(max(linDepth(uv + vec2(o.x, 0.0)), linDepth(uv - vec2(o.x, 0.0))),
                     max(linDepth(uv + vec2(0.0, o.y)), linDepth(uv - vec2(0.0, o.y))));
      float edge = smoothstep(0.015, 0.05, (dn - d) / d);
      c *= 1.0 - edge * 0.65;
    }

    c += texture2D(tBloom1, vUv).rgb * bloomStr + texture2D(tBloom2, vUv).rgb * bloomStr * 1.4;
    c += flashColor * flash;
    c *= exposure;
    c = aces(c);
    // subtle warm/cool split tone
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, c * vec3(1.04, 1.0, 0.94), smoothstep(0.4, 1.0, l));
    c = mix(c, c * vec3(0.94, 0.98, 1.06), 1.0 - smoothstep(0.0, 0.4, l));
    c = pow(c, vec3(1.0 / 2.2));

    vec2 q = vUv - 0.5;
    c *= 1.0 - dot(q, q) * vignette;
    c = mix(c, vec3(l, l * 0.4, l * 0.35) * 1.2, damage * (0.4 + 0.6 * smoothstep(0.1, 0.5, length(q))));

    // ordered dither + quantise
    int bi = int(mod(px.x, 4.0)) + int(mod(px.y, 4.0)) * 4;
    float b = BAYER[bi] / 16.0 - 0.5;
    c = floor(c * levels + 0.5 + b) / levels;
    gl_FragColor = vec4(c, 1.0);
  }`;

function fsQuad(material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return scene;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.setPixelRatio(1);
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 2, 32000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.pixelScale = 0; // 0 = auto
    this.lowW = 1;
    this.lowH = 1;

    const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtMain = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.rtMain.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.rtB1a = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB1b = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB2a = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rtB2b = new THREE.WebGLRenderTarget(1, 1, rtOpts);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, threshold: { value: 1.0 } },
      vertexShader: FS_VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tInput: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtMain.texture },
        tDepth: { value: this.rtMain.depthTexture },
        tBloom1: { value: this.rtB1a.texture },
        tBloom2: { value: this.rtB2a.texture },
        res: { value: new THREE.Vector2(1, 1) },
        near: { value: this.camera.near },
        far: { value: this.camera.far },
        levels: { value: 22 },
        bloomStr: { value: 0.55 },
        exposure: { value: 1 },
        time: { value: 0 },
        vignette: { value: 0.9 },
        flash: { value: 0 },
        flashColor: { value: new THREE.Color(1, 0.7, 0.4) },
        damage: { value: 0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.brightScene = fsQuad(this.brightMat);
    this.blurScene = fsQuad(this.blurMat);
    this.finalScene = fsQuad(this.finalMat);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setPixelScale(s) {
    this.pixelScale = s;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const ps = this.pixelScale || Math.max(2, Math.round(h / 300));
    this.lowW = Math.max(160, Math.floor(w / ps));
    this.lowH = Math.max(90, Math.floor(h / ps));
    this.rtMain.setSize(this.lowW, this.lowH);
    const bw = Math.max(1, this.lowW >> 1);
    const bh = Math.max(1, this.lowH >> 1);
    this.rtB1a.setSize(bw, bh);
    this.rtB1b.setSize(bw, bh);
    this.rtB2a.setSize(Math.max(1, bw >> 2), Math.max(1, bh >> 2));
    this.rtB2b.setSize(Math.max(1, bw >> 2), Math.max(1, bh >> 2));
    this.finalMat.uniforms.res.value.set(this.lowW, this.lowH);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.onResize) this.onResize(this.lowW, this.lowH);
  }

  // World-units-to-low-res-pixels factor for point sprites.
  pointScale() {
    return this.lowH / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  blur(src, tmp, dst, w, h) {
    this.blurMat.uniforms.tInput.value = src.texture;
    this.blurMat.uniforms.dir.value.set(1 / w, 0);
    this.gl.setRenderTarget(tmp);
    this.gl.render(this.blurScene, this.orthoCam);
    this.blurMat.uniforms.tInput.value = tmp.texture;
    this.blurMat.uniforms.dir.value.set(0, 1 / h);
    this.gl.setRenderTarget(dst);
    this.gl.render(this.blurScene, this.orthoCam);
  }

  render() {
    const gl = this.gl;
    gl.setRenderTarget(this.rtMain);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(this.scene, this.camera);

    // bloom chain
    this.brightMat.uniforms.tColor.value = this.rtMain.texture;
    gl.setRenderTarget(this.rtB1b);
    gl.render(this.brightScene, this.orthoCam);
    const w1 = this.rtB1a.width;
    const h1 = this.rtB1a.height;
    this.blur(this.rtB1b, this.rtB1a, this.rtB1b, w1, h1);
    // copy result into rtB1a via a second blur at larger radius
    this.blur(this.rtB1b, this.rtB1a, this.rtB1b, w1 / 2, h1 / 2);
    // downsample into level 2
    this.blurMat.uniforms.tInput.value = this.rtB1b.texture;
    this.blurMat.uniforms.dir.value.set(0, 0);
    gl.setRenderTarget(this.rtB2b);
    gl.render(this.blurScene, this.orthoCam);
    const w2 = this.rtB2a.width;
    const h2 = this.rtB2a.height;
    this.blur(this.rtB2b, this.rtB2a, this.rtB2b, w2, h2);
    this.blur(this.rtB2b, this.rtB2a, this.rtB2b, w2 / 2, h2 / 2);

    this.finalMat.uniforms.tBloom1.value = this.rtB1b.texture;
    this.finalMat.uniforms.tBloom2.value = this.rtB2b.texture;
    gl.setRenderTarget(null);
    gl.render(this.finalScene, this.orthoCam);
  }
}
