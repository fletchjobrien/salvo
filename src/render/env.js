import * as THREE from 'three';

// Lighting / atmosphere presets. Colours are sRGB hex, converted to linear.
const sunDir = (elevDeg, azDeg) => {
  const e = THREE.MathUtils.degToRad(elevDeg);
  const a = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
};

export const ENVIRONMENTS = {
  dusk: {
    label: 'Golden Hour',
    sunDir: sunDir(7, 35),
    sunColor: 0xffb070,
    sunIntensity: 3.2,
    sunDisc: 0xfff0c8,
    hemiSky: 0x8fa6d8,
    hemiGround: 0x2a3440,
    hemiIntensity: 0.9,
    zenith: 0x1f3566,
    horizon: 0xf2a47a,
    horizonFar: 0x8e7f9e,
    fog: 0xc69a8a,
    fogDensity: 0.000062,
    deep: 0x05202e,
    scatter: 0x1f6f78,
    foam: 0xfff4ea,
    cloud: 0xffc6a0,
    cloudShade: 0x5a4a66,
    cloudCover: 0.48,
    stars: 0,
    exposure: 1.0,
    smokeTint: 0xcfb6aa,
  },
  day: {
    label: 'Clear Morning',
    sunDir: sunDir(32, 140),
    sunColor: 0xfff1dc,
    sunIntensity: 3.0,
    sunDisc: 0xffffff,
    hemiSky: 0xa8c4ef,
    hemiGround: 0x2f3c48,
    hemiIntensity: 1.1,
    zenith: 0x2f6bc4,
    horizon: 0xbcd6ee,
    horizonFar: 0xa8c6e6,
    fog: 0xb4cde4,
    fogDensity: 0.00005,
    deep: 0x032a45,
    scatter: 0x1a8ca0,
    foam: 0xffffff,
    cloud: 0xffffff,
    cloudShade: 0x8a9ab4,
    cloudCover: 0.42,
    stars: 0,
    exposure: 0.95,
    smokeTint: 0xdcdcdc,
  },
  night: {
    label: 'Moonlit Night',
    sunDir: sunDir(24, -30),
    sunColor: 0x9fb8ff,
    sunIntensity: 0.9,
    sunDisc: 0xe8f0ff,
    hemiSky: 0x24345e,
    hemiGround: 0x070a12,
    hemiIntensity: 0.55,
    zenith: 0x02050f,
    horizon: 0x16233f,
    horizonFar: 0x0e1730,
    fog: 0x111b30,
    fogDensity: 0.000075,
    deep: 0x010812,
    scatter: 0x0b2a40,
    foam: 0x8fa4c8,
    cloud: 0x3a4766,
    cloudShade: 0x0a0f1c,
    cloudCover: 0.4,
    stars: 1,
    exposure: 1.35,
    smokeTint: 0x5a6070,
  },
};

export function linear(hex) {
  return new THREE.Color(hex);
}
