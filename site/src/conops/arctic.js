// Scenic reconstruction of a Novaya Zemlya coastal terrace and mountain backdrop.
// Not a surveyed launch site. Keep CPU heights and GPU terrain from the same source.
const field = `
float shore1(float z){ return 1150.0 + 260.0*sin(z*0.0011) + 130.0*sin(z*0.0037 + 1.0) + 32.0*sin(z*0.013); }
float shore2(float z){ return uX2 + 800.0*sin(z*0.0006 + 0.5) + 300.0*sin(z*0.0021) + 65.0*sin(z*0.008); }
float ridges(float x, float z){
  float warp = sin(z*0.00053 + sin(x*0.00031))*0.8;
  float a = 0.5 + 0.5*sin(x*0.00071 + z*0.00036 + warp + 0.8);
  float b = 0.5 + 0.5*sin(z*0.0011 - x*0.00024 + sin(x*0.0009)*0.7);
  float crag = sin(x*0.0031+z*0.0022)*sin(z*0.0043-x*0.0015);
  return 0.16 + a*a*0.6 + b*b*0.2 + crag*0.04;
}
float landH1(float x, float z){
  float inland = smoothstep(300.0, 4800.0, -x);
  float flank = smoothstep(1500.0, 5200.0, abs(z));
  float detail = 2.4*sin(x*0.009 + z*0.005) + 1.2*sin(z*0.025 - x*0.018);
  return 12.0 + 5.0*sin(x*0.002 + 1.3)*sin(z*0.003) + detail + (inland*750.0 + flank*620.0)*ridges(x,z);
}
float landH2(float x, float z){
  float r = clamp((x - shore2(z))/2500.0, 0.0, 1.0);
  float flank = smoothstep(1800.0, 5800.0, abs(z));
  return 8.0 + r*(60.0 + 55.0*sin(x*0.0011 + z*0.0007)*sin(z*0.0013 - x*0.0004) + 22.0*sin(x*0.0047 + 0.7)*sin(z*0.0051)) + 6.0*r*sin(x*0.017 + z*0.013) + r*flank*900.0*ridges(x,z);
}
float terrainHeight(float x, float z){
  float m1 = 1.0 - smoothstep(-38.0, 38.0, x - shore1(z));
  float m2 = smoothstep(-48.0, 48.0, x - shore2(z));
  float h = mix(-22.0, landH1(x,z), m1);
  h = mix(h, landH2(x,z), m2);
  float padDistance = sqrt((x + 15.0)*(x + 15.0) + z*z);
  return mix(h, 6.0, 1.0 - smoothstep(85.0, 180.0, padDistance));
}`;

export const TERRAIN_GLSL = `uniform float uX2;\n${field}\nfloat terrainH(vec2 p){ return terrainHeight(p.x,p.y); }`;

// The height expressions use this small, identical GLSL/JS numeric subset.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, v) => { const t = clamp((v-a)/(b-a), 0, 1); return t*t*(3-2*t); };
const mix = (a, b, t) => a + (b-a)*t;
const jsField = field.replace(/float (\w+)\(float x, float z\)/g, 'function $1(x,z)')
  .replace(/float (\w+)\(float z\)/g, 'function $1(z)')
  .replace(/float /g, 'let ');
const sample = new Function('uX2', 'x', 'z', 'sin', 'abs', 'sqrt', 'clamp', 'smoothstep', 'mix', `${jsField}; return terrainHeight(x,z);`);
export const arcticHeight = (x, z, farShore) => sample(farShore, x, z, Math.sin, Math.abs, Math.sqrt, clamp, smoothstep, mix);
