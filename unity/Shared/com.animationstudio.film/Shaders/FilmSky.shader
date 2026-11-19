// The films' analytic sky (site/src/*/main.js skyColor/skyBase): horizon to zenith gradient, warm glow round the sun,
// sun core and disc, optional drifting clouds. Colours are linear and passed as vectors so Unity does not convert them.
Shader "Film/Sky"
{
    Properties
    {
        _Horizon ("Horizon (linear)", Vector) = (0.66, 0.68, 0.70, 0)
        _Zenith ("Zenith (linear)", Vector) = (0.10, 0.25, 0.60, 0)
        _ZenithPow ("Zenith curve", Float) = 0.5
        _Below ("Below horizon (linear)", Vector) = (0.4, 0.4, 0.36, 0)
        _BelowK ("Below fade", Float) = 6
        _Glow ("Sun glow (linear)", Vector) = (1.0, 0.68, 0.38, 0)
        _GlowAmt ("Glow amount", Float) = 0.45
        _GlowPow ("Glow power", Float) = 5
        _GlowFade ("Glow fade with height", Float) = 1
        _Core ("Sun core (linear)", Vector) = (1.0, 0.86, 0.62, 0)
        _CoreAmt ("Core amount", Float) = 0.8
        _CorePow ("Core power", Float) = 80
        _Disc ("Sun disc", Float) = 30
        _SunDir ("Direction to the sun (Unity)", Vector) = (0.42, 0.5, 0.76, 0)
        _Clouds ("Clouds", Float) = 0
        _CloudDark ("Cloud shade (linear)", Vector) = (0.24, 0.27, 0.31, 0)
        _CloudLit ("Cloud lit (linear)", Vector) = (0.86, 0.84, 0.8, 0)
    }
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" "PreviewType" = "Skybox" "RenderPipeline" = "UniversalPipeline" }
        Cull Off ZWrite Off
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            float4 _Horizon, _Zenith, _Below, _Glow, _Core, _SunDir, _CloudDark, _CloudLit;
            float _ZenithPow, _BelowK, _GlowAmt, _GlowPow, _GlowFade, _CoreAmt, _CorePow, _Disc, _Clouds;
            float _FilmTime;   // global, set by the director

            struct A { float4 pos : POSITION; };
            struct V { float4 pos : SV_POSITION; float3 dir : TEXCOORD0; };

            V vert(A a) { V o; o.pos = TransformObjectToHClip(a.pos.xyz); o.dir = a.pos.xyz; return o; }

            float hash(float3 p) { p = frac(p * 0.3183099 + 0.1); p *= 17.0; return frac(p.x * p.y * p.z * (p.x + p.y + p.z)); }
            float vnoise(float3 x)
            {
                float3 i = floor(x), f = frac(x); f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(hash(i), hash(i + float3(1,0,0)), f.x), lerp(hash(i + float3(0,1,0)), hash(i + float3(1,1,0)), f.x), f.y),
                            lerp(lerp(hash(i + float3(0,0,1)), hash(i + float3(1,0,1)), f.x), lerp(hash(i + float3(0,1,1)), hash(i + float3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
            }
            float cfbm(float2 p)
            {
                float s = 0.0, a = 0.5;
                for (int i = 0; i < 5; i++) { s += a * vnoise(float3(p, _FilmTime * 0.004 + i * 3.1)); p = p * 2.07 + 1.3; a *= 0.5; }
                return s;
            }

            float4 frag(V i) : SV_Target
            {
                float3 d = normalize(i.dir), s = normalize(_SunDir.xyz);
                float e = saturate(d.y), mu = max(dot(d, s), 0.0);
                float3 col = lerp(_Horizon.rgb, _Zenith.rgb, pow(e, _ZenithPow));
                col += _Glow.rgb * pow(mu, _GlowPow) * _GlowAmt * (1.0 - _GlowFade * e);
                col += _Core.rgb * pow(mu, _CorePow) * _CoreAmt;
                if (d.y < 0.0) col = lerp(_Horizon.rgb, _Below.rgb, saturate(-d.y * _BelowK));
                if (_Clouds > 0.0 && d.y > 0.0)
                {
                    float2 uv = d.xz / (d.y + 0.1) * 0.9 + float2(_FilmTime * 0.002, 0.0);
                    float n = cfbm(uv), nl = cfbm(uv + s.xz * 0.18);
                    float cover = smoothstep(-0.12, 0.38, n) * smoothstep(0.0, 0.12, d.y);
                    float lit = saturate(0.55 + (n - nl) * 2.2);
                    float3 cc = lerp(_CloudDark.rgb, _CloudLit.rgb, lit) + float3(1.0, 0.7, 0.45) * pow(mu, 8.0) * 0.6 * lit;
                    col = lerp(col, cc, cover * 0.92 * _Clouds);
                }
                col += float3(1.0, 0.92, 0.8) * smoothstep(0.99985, 0.99992, dot(d, s)) * _Disc;
                return float4(col, 1.0);
            }
            ENDHLSL
        }
    }
}
