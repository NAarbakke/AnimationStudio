// The sea of site/src/x12/main.js: a polar grid round the camera, the Gerstner swell in the vertex shader (the same waves
// as X12World.WaveDisp), and in the fragment shader the analytic normal, ripples, sky reflection, sun glint, breaking
// crests from the swell's Jacobian, the boat's wake from its last 20 s of track, foam hugging the hull, bow spray, the
// escorts' wakes, the debris splash and fog. All maths in the film's frame (Unity world z negated); inputs are globals
// the director sets every frame.
Shader "Film/X12 Water"
{
    Properties { }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry+10" }
        Pass
        {
            Name "ForwardLit" Tags { "LightMode" = "UniversalForward" }
            Cull Off
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 4.5
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float _FilmTime, _BoatV, _FogD;
            float4 _Cam, _Sun3, _FogCol, _Splash;
            float4 _Wave0[8], _Wave1[8];      // (k, A, omega, Q), (dx, dz, phase, L)
            float4 _Rip0[12], _Rip1[12];      // (k, omega, cos a, sin a), (phase, L, 0, 0)
            float4x4 _BoatInv;                // film frame
            float _Beam[128];                 // half-beam of the hull along its length (-6.2 .. 6.2 m)
            float4 _Trail[44];                // stern positions (x, z), age, speed; age < 0 ends the list
            float4 _Ships[3], _ShipD[3];      // (x, z, L, B), (cos, sin) heading

            // ---- simplex noise (Ashima Arts / Stefan Gustavson, MIT)
            float3 mod289(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float4 mod289(float4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float4 permute(float4 x) { return mod289(((x * 34.0) + 1.0) * x); }
            float4 taylorInvSqrt(float4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            float snoise(float3 v)
            {
                const float2 C = float2(1.0 / 6.0, 1.0 / 3.0); const float4 D = float4(0.0, 0.5, 1.0, 2.0);
                float3 i = floor(v + dot(v, C.yyy)); float3 x0 = v - i + dot(i, C.xxx);
                float3 g = step(x0.yzx, x0.xyz); float3 l = 1.0 - g; float3 i1 = min(g.xyz, l.zxy); float3 i2 = max(g.xyz, l.zxy);
                float3 x1 = x0 - i1 + C.xxx; float3 x2 = x0 - i2 + C.yyy; float3 x3 = x0 - D.yyy;
                i = mod289(i);
                float4 p = permute(permute(permute(i.z + float4(0.0, i1.z, i2.z, 1.0)) + i.y + float4(0.0, i1.y, i2.y, 1.0)) + i.x + float4(0.0, i1.x, i2.x, 1.0));
                float n_ = 0.142857142857; float3 ns = n_ * D.wyz - D.xzx;
                float4 j = p - 49.0 * floor(p * ns.z * ns.z);
                float4 x_ = floor(j * ns.z); float4 y_ = floor(j - 7.0 * x_);
                float4 x = x_ * ns.x + ns.yyyy; float4 y = y_ * ns.x + ns.yyyy; float4 h = 1.0 - abs(x) - abs(y);
                float4 b0 = float4(x.xy, y.xy); float4 b1 = float4(x.zw, y.zw);
                float4 s0 = floor(b0) * 2.0 + 1.0; float4 s1 = floor(b1) * 2.0 + 1.0; float4 sh = -step(h, 0.0);
                float4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; float4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                float3 p0 = float3(a0.xy, h.x), p1 = float3(a0.zw, h.y), p2 = float3(a1.xy, h.z), p3 = float3(a1.zw, h.w);
                float4 norm = taylorInvSqrt(float4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
                p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                float4 m = max(0.6 - float4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
                return 42.0 * dot(m * m, float4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
            }

            float sq(float x) { return x * x; }
            float3 waveDisp(float2 p, float dist)
            {
                float3 d = 0;
                for (int i = 0; i < 8; i++)
                {
                    float4 a = _Wave0[i], b = _Wave1[i];
                    float f = a.x * dot(b.xy, p) - a.z * _FilmTime + b.z, amp = a.y * (1.0 - smoothstep(b.w * 40.0, b.w * 120.0, dist));
                    d.xz += a.w * amp * b.xy * cos(f); d.y += amp * sin(f);
                }
                return d;
            }
            void waveNormal(float2 p, float dist, float fw, out float3 n, out float jac)
            {
                n = float3(0, 1, 0); float jx = 1.0, jz = 1.0, jxz = 0.0;
                for (int i = 0; i < 8; i++)
                {
                    float4 a = _Wave0[i], b = _Wave1[i];
                    float f = a.x * dot(b.xy, p) - a.z * _FilmTime + b.z, c = cos(f), s = sin(f);
                    float wa = a.x * a.y * (1.0 - smoothstep(b.w * 40.0, b.w * 120.0, dist)) * (1.0 - smoothstep(b.w * 0.3, b.w * 0.9, fw));
                    n.x -= b.x * wa * c; n.z -= b.y * wa * c; n.y -= a.w * wa * s;
                    jx -= a.w * b.x * b.x * wa * s; jz -= a.w * b.y * b.y * wa * s; jxz -= a.w * b.x * b.y * wa * s;
                }
                jac = jx * jz - jxz * jxz;
            }
            float3 ripples(float2 p, float fw)
            {
                float3 n = 0;
                for (int i = 0; i < 12; i++)
                {
                    float4 a = _Rip0[i], b = _Rip1[i];
                    float f = a.x * dot(a.zw, p) - a.y * _FilmTime + b.x, wa = 0.045 * (1.0 - smoothstep(b.y * 0.25, b.y * 0.8, fw));
                    n.xz -= a.zw * wa * cos(f);
                }
                return n;
            }
            float3 skyBase(float3 d)
            {
                float3 s = normalize(_Sun3.xyz);
                float e = saturate(d.y), mu = max(dot(d, s), 0.0);
                float3 col = lerp(float3(0.46, 0.52, 0.58), float3(0.12, 0.2, 0.34), pow(e, 0.55));
                col += float3(1.0, 0.72, 0.46) * pow(mu, 6.0) * 0.45 * (1.0 - 0.6 * e);
                col += float3(1.0, 0.88, 0.7) * pow(mu, 120.0) * 1.4;
                if (d.y < 0.0) col = lerp(float3(0.46, 0.52, 0.58), float3(0.1, 0.13, 0.16), saturate(-d.y * 5.0));
                return col;
            }
            float beamAt(float x) { int i = (int)clamp((x + 6.2) / 12.4 * 128.0, 0.0, 127.0); return _Beam[i]; }

            struct A { float4 pos : POSITION; };
            struct V { float4 pos : SV_POSITION; float3 wp : TEXCOORD0; float2 p0 : TEXCOORD1; float dist : TEXCOORD2; };
            V vert(A a)
            {
                V o; float2 p0 = a.pos.xz + _Cam.xz; float dist = length(a.pos.xz);
                float3 d = waveDisp(p0, dist);
                o.wp = float3(p0.x + d.x, d.y, p0.y + d.z); o.p0 = p0; o.dist = dist;
                o.pos = TransformWorldToHClip(float3(o.wp.x, o.wp.y, -o.wp.z));
                return o;
            }
            float4 frag(V i) : SV_Target
            {
                float3 cam = float3(_WorldSpaceCameraPos.x, _WorldSpaceCameraPos.y, -_WorldSpaceCameraPos.z);
                float3 sun = normalize(_Sun3.xyz);
                // inside the hull's waterplane the sea is the boat's business
                float3 lp = mul(_BoatInv, float4(i.wp, 1.0)).xyz;
                float bw = beamAt(lp.x), edge = abs(lp.z) - bw;
                bool inFoot = lp.x > -6.0 && lp.x < 6.1 && edge < -0.04;
                float hullBot = lerp(-0.45, 0.02, saturate(abs(lp.z) / 1.4)) + 0.14 * sq(max(lp.x - 2.5, 0.0)) + 0.05;
                if (inFoot && lp.y > hullBot && lp.y < 1.0) discard;
                float under = inFoot ? 1.0 : exp(-sq(max(edge, 0.0) / 0.5)) * step(-6.0, lp.x) * step(lp.x, 6.1);

                float fw = length(fwidth(i.p0));
                float3 n; float jac; waveNormal(i.p0, i.dist, fw, n, jac);
                n = normalize(n + ripples(i.p0, fw));
                float3 Vd = normalize(cam - i.wp);
                float cosv = max(dot(n, Vd), 0.0), fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
                float3 R = reflect(-Vd, n); R.y = abs(R.y);
                float3 refl = lerp(skyBase(R), float3(0.42, 0.45, 0.5), 0.3);
                float wall = (0.05 + 0.3 * smoothstep(0.25, 0.95, abs(R.z))) * (1.0 - smoothstep(-5200.0, -3200.0, i.wp.x) * 0.8);
                refl = lerp(refl, float3(0.06, 0.068, 0.078), (1.0 - smoothstep(0.0, wall * 1.8, R.y)) * 0.7);
                float spec = pow(max(dot(R, sun), 0.0), 900.0) * 24.0 + pow(max(dot(R, sun), 0.0), 80.0) * 0.35;
                float crest = saturate(i.wp.y * 0.55 + 0.45);
                float back = pow(max(dot(-Vd, sun) * 0.5 + 0.5, 0.0), 3.0);
                float3 body = float3(0.004, 0.016, 0.022) + float3(0.012, 0.06, 0.055) * crest * (0.35 + 1.4 * back * crest);
                float3 col = lerp(body * (0.6 + 0.6 * max(sun.y, 0.0)), refl, fres) + float3(1.0, 0.9, 0.75) * spec;
                col *= 1.0 - 0.6 * under;

                // foam: breaking crests, the boat's wake and hull, the escorts' wakes, the splash
                float fn = snoise(float3(i.p0 * 0.35, _FilmTime * 0.15)) * 0.5 + snoise(float3(i.p0 * 1.4, _FilmTime * 0.3)) * 0.3 + snoise(float3(i.p0 * 5.0, _FilmTime * 0.5)) * 0.2;
                float cap = smoothstep(0.62, 0.25, jac) * smoothstep(0.1, 0.4, crest);
                float wk = 0.0, wakeArm = 0.0;
                for (int k = 0; k < 43; k++)
                {
                    float4 a = _Trail[k], b = _Trail[k + 1];
                    if (b.z < 0.0) break;
                    float2 ab = b.xy - a.xy, ap = i.wp.xz - a.xy; float L2 = max(dot(ab, ab), 1e-4);
                    float ur = dot(ap, ab) / L2, u = saturate(ur); float2 q = a.xy + ab * u; float dist = length(i.wp.xz - q);
                    float inside = step(-0.02, ur) * step(ur, 1.02);
                    float age = lerp(a.z, b.z, u), spd = lerp(a.w, b.w, u);
                    float width = 1.1 + 0.35 * age + 0.02 * spd * age;
                    wk = max(wk, exp(-sq(dist / width)) * exp(-age / (3.0 + 0.22 * spd)) * clamp(spd / 16.0, 0.12, 1.0));
                    float arm = 1.4 + age * spd * 0.33;
                    wakeArm = max(wakeArm, inside * exp(-sq((dist - arm) / (0.6 + 0.15 * age))) * exp(-age / 4.0) * saturate((spd - 4.0) / 10.0));
                }
                float along = smoothstep(-6.2, -4.5, lp.x) * smoothstep(6.3, 4.8, lp.x);
                float hull = exp(-sq(max(edge, 0.0) / (0.28 + 0.025 * _BoatV))) * (0.4 + 0.5 * saturate(_BoatV / 15.0)) * along;
                float streak = 0.5 + 0.5 * snoise(float3(lp.x * 0.25, abs(lp.z) * 3.0, _FilmTime * 0.4));
                float bowSpray = exp(-sq(max(edge, 0.0) / (0.35 + 0.05 * _BoatV))) * saturate((_BoatV - 6.0) / 12.0) * smoothstep(-1.0, 2.0, lp.x) * smoothstep(6.3, 4.5, lp.x) * streak;
                float sw = 0.0;
                for (int s = 0; s < 3; s++)
                {
                    float2 d = _ShipD[s].xy, rel = i.wp.xz - _Ships[s].xy; float Ls = _Ships[s].z, Bm = _Ships[s].w;
                    float al = dot(rel, d), side = abs(d.x * rel.y - d.y * rel.x), behind = -(al + Ls * 0.5);
                    float inHull = 1.0 - smoothstep(0.0, 2.5, side - Bm * 0.5 * sqrt(max(0.0, 1.0 - sq(max(al, 0.0) / (Ls * 0.5)))));
                    sw = max(sw, inHull * smoothstep(Ls * 0.5 + 4.0, Ls * 0.3, abs(al)) * 0.6);
                    if (behind > 0.0)
                    {
                        sw = max(sw, exp(-sq(side / (Bm * 0.55 + behind * 0.05))) * exp(-behind / 260.0) * 0.9);
                        sw = max(sw, exp(-sq((side - Bm * 0.5 - behind * 0.34) / (1.5 + behind * 0.03))) * exp(-behind / 180.0) * 0.55);
                    }
                }
                float spl = 0.0;
                if (_Splash.z >= 0.0) spl = exp(-sq(length(i.wp.xz - _Splash.xy) / 18.0)) * exp(-_Splash.z / 3.0);
                float foamAmt = max(max(cap * 0.85, wk), max(wakeArm * 0.8, max(hull, bowSpray)));
                foamAmt = max(foamAmt, max(sw, spl * 0.8));
                float foam = smoothstep(0.15, 0.75, foamAmt * (0.65 + 0.7 * fn) + foamAmt * 0.25);
                foam = lerp(foam, foamAmt * 0.6, smoothstep(0.3, 3.0, fw));
                float3 foamCol = float3(0.78, 0.82, 0.85) * (0.55 + 0.6 * max(dot(n, sun), 0.0));
                col = lerp(col, foamCol, foam);

                float fd = length(i.wp - cam);
                col = lerp(col, _FogCol.rgb, 1.0 - exp(-sq(_FogD * fd)));
                return float4(col, 1.0);
            }
            ENDHLSL
        }
    }
}
