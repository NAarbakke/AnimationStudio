// The field of site/src/drone/main.js (GROUND_GLSL), ported to URP: soil, crop rows every 0.42 m, tramlines every 24 m,
// the patchwork of fields beyond the hedges, and the scuff where the rod went in. Lit by the main light with its shadows,
// ambient from the probe, fogged. Works in the three.js film's frame: p = (x, -z) of the Unity world position.
Shader "Film/Razorbill Ground"
{
    Properties { }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "RenderPipeline" = "UniversalPipeline" "Queue" = "Geometry" }
        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        ENDHLSL
        Pass
        {
            Name "ForwardLit" Tags { "LightMode" = "UniversalForward" }
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            float4 _Impact;   // x, z (film frame), age since the hit (< 0: not yet), unused

            // ---- 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT), as the film's NOISE chunk
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

            // ---- the film's field
            float hash21(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
            float band(float d, float hw, float aa) { return 1.0 - smoothstep(hw - aa, hw + aa, d); }
            float3 soil(float2 p, float fw)
            {
                float n = snoise(float3(p * 0.31, 0.0)) * 0.5
                        + snoise(float3(p * 1.9, 3.0)) * 0.3 * (1.0 - smoothstep(0.04, 0.3, fw))
                        + snoise(float3(p * 11.0, 7.0)) * 0.25 * (1.0 - smoothstep(0.008, 0.05, fw))
                        + snoise(float3(p * 47.0, 11.0)) * 0.34 * (1.0 - smoothstep(0.002, 0.012, fw))
                        + snoise(float3(p * 170.0, 13.0)) * 0.26 * (1.0 - smoothstep(0.0008, 0.004, fw));
                return lerp(float3(0.045, 0.027, 0.015), float3(0.125, 0.08, 0.046), saturate(0.5 + 0.7 * n));
            }
            float fmod2(float x, float y) { return x - y * floor(x / y); }   // GLSL mod
            float3 cropField(float2 p, float fw)
            {
                float3 s = soil(p, fw);
                float d = abs(frac(p.y / 0.42 + 0.5) - 0.5) * 0.42;
                float tm = abs(fmod2(p.y - 12.0, 24.0) - 12.0);
                float hw = 0.15 + 0.035 * snoise(float3(p * 0.9, 2.0)) + 0.03 * snoise(float3(p.x * 3.1, p.y * 0.2, 4.0));
                float cov = band(d, hw, max(fw, 0.003));
                cov = lerp(cov, 0.4, smoothstep(0.1, 0.4, fw));
                cov *= smoothstep(1.15, 1.35, tm);
                float3 green = lerp(float3(0.02, 0.06, 0.012), float3(0.045, 0.12, 0.02), 0.5 + 0.5 * snoise(float3(p * 0.045, 5.0)));
                float under = step(-165.0, p.x) * step(p.x, 110.0) * step(abs(p.y), 30.0);
                cov *= lerp(smoothstep(-0.35, 0.35, snoise(float3(p.x * 3.6, p.y * 1.3, 9.0))), 1.0, smoothstep(0.03, 0.12, fw));
                cov *= lerp(1.0, 0.35, under);
                if (_Impact.z >= 0.0) cov *= smoothstep(0.5, 1.2, length(p - _Impact.xy));
                green *= lerp(1.0, 0.5, under);
                float3 c = lerp(s, green, cov * lerp(1.0, 0.7, smoothstep(0.05, 0.25, fw) * (1.0 - under)));
                c *= lerp(1.0, 0.8, smoothstep(0.02, 0.15, fw) * (1.0 - under));
                float rut = band(abs(tm - 0.9), 0.17, max(fw, 0.02)) * (1.0 - smoothstep(0.2, 0.6, fw));
                return lerp(c, s * 0.72 + float3(0.02, 0.016, 0.01), rut);
            }
            float3 outer(float2 p, float fw)
            {
                float2 cs = float2(260.0, 210.0), q = (p + float2(37.0, 11.0)) / cs, id = floor(q), f = frac(q) * cs;
                float h = hash21(id), h2 = hash21(id + 17.0);
                float2 r = h2 > 0.5 ? p : p.yx;
                float3 c;
                float tone = snoise(float3(p * 0.012, h * 9.0)) * 0.5 + 0.5;
                if (h < 0.3) { c = lerp(float3(0.36, 0.25, 0.08), float3(0.52, 0.38, 0.13), tone); c *= 1.0 - 0.18 * band(abs(fmod2(r.y, 24.0) - 12.0), 0.5, max(fw, 0.05)); }
                else if (h < 0.5) { c = soil(p, fw) * 1.1; c *= lerp(1.0 - 0.35 * band(abs(frac(r.y / 0.4) - 0.5), 0.18, max(fw / 0.4, 0.02)), 0.88, smoothstep(0.05, 0.25, fw)); }
                else if (h < 0.78) { c = lerp(float3(0.06, 0.14, 0.03), float3(0.11, 0.21, 0.045), tone); c *= 1.0 + 0.12 * sign(sin(r.y * 3.14159 / 6.0)); }
                else { c = lerp(float3(0.45, 0.37, 0.03), float3(0.62, 0.52, 0.05), tone); }
                float e = min(min(f.x, cs.x - f.x), min(f.y, cs.y - f.y));
                c = lerp(c, float3(0.1, 0.16, 0.05), 1.0 - smoothstep(4.0, 5.0, e));
                c = lerp(c, float3(0.02, 0.05, 0.015) * (0.8 + 0.4 * snoise(float3(p * 0.3, 1.0))), 1.0 - smoothstep(2.0, 2.6, e));
                return c;
            }
            float3 fieldColor(float2 p)
            {
                float fw = length(fwidth(p));
                float2 lo = float2(-420.0, -140.0), hi = float2(240.0, 120.0);
                float2 dd = max(lo - p, p - hi); float out_ = max(dd.x, dd.y);
                float3 c;
                if (out_ < 0.0) c = cropField(p, fw);
                else if (out_ < 2.8) c = float3(0.02, 0.05, 0.015) * (0.8 + 0.4 * snoise(float3(p * 0.3, 1.0)));
                else if (out_ < 7.5) { c = float3(0.3, 0.25, 0.18) * (0.85 + 0.25 * snoise(float3(p * 0.5, 2.0))); c = lerp(c, float3(0.08, 0.15, 0.04), band(abs(out_ - 5.15), 0.5, 0.2)); }
                else c = outer(p, fw);
                if (_Impact.z >= 0.0)
                {
                    float r = length(p - _Impact.xy), grow = smoothstep(0.0, 0.05, _Impact.z);
                    c *= 1.0 - 0.45 * grow * (1.0 - smoothstep(0.02, 0.07 + 0.03 * snoise(float3(p * 60.0, 1.0)), r));
                }
                return c;
            }

            struct A { float4 pos : POSITION; };
            struct V { float4 pos : SV_POSITION; float3 wp : TEXCOORD0; float fog : TEXCOORD1; };
            V vert(A a) { V o; o.wp = TransformObjectToWorld(a.pos.xyz); o.pos = TransformWorldToHClip(o.wp); o.fog = ComputeFogFactor(o.pos.z); return o; }
            float4 frag(V i) : SV_Target
            {
                float3 albedo = fieldColor(float2(i.wp.x, -i.wp.z));
                Light L = GetMainLight(TransformWorldToShadowCoord(i.wp));
                float3 n = float3(0, 1, 0);
                float3 col = albedo * (L.color * (L.shadowAttenuation * saturate(dot(n, L.direction))) + SampleSH(n));
                return float4(MixFog(col, i.fog), 1.0);
            }
            ENDHLSL
        }
        Pass
        {
            Name "DepthOnly" Tags { "LightMode" = "DepthOnly" }
            ZWrite On ColorMask R
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            struct A { float4 pos : POSITION; };
            float4 vert(A a) : SV_POSITION { return TransformObjectToHClip(a.pos.xyz); }
            half frag() : SV_Target { return 0; }
            ENDHLSL
        }
    }
}
