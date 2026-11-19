// A thermal "white hot" look for a UI RawImage showing a camera's render texture: the three.js films' CSS filter
// grayscale(1) invert(1) brightness(b) contrast(c), worked in sRGB like the browser does.
Shader "Film/UI EOIR"
{
    Properties
    {
        [PerRendererData] _MainTex ("Texture", 2D) = "white" {}
        _Bright ("Brightness", Float) = 0.62
        _Contrast ("Contrast", Float) = 2.1
    }
    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" "CanUseSpriteAtlas" = "True" }
        Cull Off ZWrite Off ZTest [unity_GUIZTestMode] Blend SrcAlpha OneMinusSrcAlpha
        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"
            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            float _Bright, _Contrast;
            struct A { float4 pos : POSITION; float2 uv : TEXCOORD0; float4 col : COLOR; };
            struct V { float4 pos : SV_POSITION; float2 uv : TEXCOORD0; float4 col : COLOR; };
            V vert(A a) { V o; o.pos = TransformObjectToHClip(a.pos.xyz); o.uv = a.uv; o.col = a.col; return o; }
            float4 frag(V i) : SV_Target
            {
                float3 c = LinearToSRGB(saturate(SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv).rgb));
                float g = dot(c, float3(0.2126, 0.7152, 0.0722));
                float v = saturate(((1.0 - g) * _Bright - 0.5) * _Contrast + 0.5);
                return float4(SRGBToLinear(float3(v, v, v)), i.col.a);
            }
            ENDHLSL
        }
    }
}
