// Pieces the scene builders (each project's AgentScripts/Build*.cs) share: materials and textures saved under
// Assets/Generated, models hung the right way round, lights, sky, post, the film camera and HUD primitives.
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

namespace AnimationStudio.Film.Editor
{
    public static class FilmKit
    {
        public const string GEN = "Assets/Generated";
        public static Font Font => Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        public static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int k = path.LastIndexOf('/'); EnsureFolder(path.Substring(0, k)); AssetDatabase.CreateFolder(path.Substring(0, k), path.Substring(k + 1));
        }
        /// <summary>
        /// Save under Assets/Generated. An existing asset of the same type is updated in place (same GUID, so nothing that
        /// already references it breaks, and rebuilds keep references stable); use the returned object.
        /// </summary>
        public static T Save<T>(T asset, string name, string ext = "asset") where T : Object
        {
            EnsureFolder(GEN); var p = $"{GEN}/{name}.{ext}";
            var existing = AssetDatabase.LoadAssetAtPath<T>(p);
            if (existing != null && existing.GetType() == asset.GetType() && !(asset is VolumeProfile))
            { EditorUtility.CopySerialized(asset, existing); EditorUtility.SetDirty(existing); return existing; }
            AssetDatabase.DeleteAsset(p); AssetDatabase.CreateAsset(asset, p); return asset;
        }
        /// <summary>Mark everything under Assets/Generated dirty and write it: edits made after Save then persist.</summary>
        public static void Flush()
        {
            foreach (var guid in AssetDatabase.FindAssets("", new[] { GEN })) { var o = AssetDatabase.LoadMainAssetAtPath(AssetDatabase.GUIDToAssetPath(guid)); if (o) EditorUtility.SetDirty(o); }
            AssetDatabase.SaveAssets();
        }
        public static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f);

        // ---------------------------------------------------------------- materials
        public static Shader GltfShader => Shader.Find("Shader Graphs/glTF-pbrMetallicRoughness");
        /// <summary>glTF PBR material (multiplies vertex colours); colour in sRGB like the films' hex values.</summary>
        public static Material Gltf(string name, Color srgb, float rough, float metal, bool twoSided = false)
        {
            var m = new Material(GltfShader) { name = name, enableInstancing = true };
            m.SetColor("baseColorFactor", srgb); m.SetFloat("roughnessFactor", rough); m.SetFloat("metallicFactor", metal);
            if (twoSided) { m.SetFloat("_Cull", 0f); m.doubleSidedGI = true; }
            return Save(m, name, "mat");
        }
        public static Material Lit(string name, Color srgb, float smooth, float metal)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Lit")) { name = name, enableInstancing = true };
            m.SetColor("_BaseColor", srgb); m.SetFloat("_Smoothness", smooth); m.SetFloat("_Metallic", metal);
            return Save(m, name, "mat");
        }
        public static Material Unlit(string name, Color c, bool transparent = false)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Unlit")) { name = name };
            m.SetColor("_BaseColor", c);
            if (transparent) { m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", 0f); m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha); m.SetFloat("_ZWrite", 0f); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); m.renderQueue = 3000; }
            return Save(m, name, "mat");
        }
        /// <summary>Particle material: alpha blended (smoke, spray) or additive with an HDR colour (fire, glows).</summary>
        public static Material Particle(string name, Color c, Texture tex, bool additive, bool soft = false)
        {
            var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = name };
            m.SetFloat("_Surface", 1f); m.SetFloat("_ZWrite", 0f); m.SetFloat("_Cull", 0f); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (additive) { m.SetFloat("_Blend", 2f); m.SetFloat("_SrcBlend", (float)BlendMode.One); m.SetFloat("_DstBlend", (float)BlendMode.One); m.renderQueue = 3100; }
            else { m.SetFloat("_Blend", 0f); m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha); m.renderQueue = 3000; }
            if (soft) { m.EnableKeyword("_SOFTPARTICLES_ON"); m.SetFloat("_SoftParticlesEnabled", 1f); m.SetFloat("_SoftParticlesFarFadeDistance", 1.5f); }
            m.SetColor("_BaseColor", c); m.SetTexture("_BaseMap", tex);
            return Save(m, name, "mat");
        }

        // ---------------------------------------------------------------- textures
        /// <summary>The point sprites of the three.js films: alpha (1 - r^2)^1.6; premultiplied for additive use.</summary>
        public static Texture2D Puff(bool premultiplied)
        {
            int N = 64; var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = premultiplied ? "PuffAdd" : "Puff", wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
            {
                float dx = (x + 0.5f) / N * 2f - 1f, dy = (y + 0.5f) / N * 2f - 1f, r2 = Mathf.Min(1f, dx * dx + dy * dy), a = Mathf.Pow(1f - r2, 1.6f);
                t.SetPixel(x, y, premultiplied ? new Color(a, a, a, a) : new Color(1f, 1f, 1f, a));
            }
            t.Apply(); return Save(t, t.name);
        }
        public static Texture2D Glow()
        {
            int N = 64; var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = "Glow", wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
            { float dx = (x - 31.5f) / 31.5f, dy = (y - 31.5f) / 31.5f, k = Mathf.Max(0f, Mathf.Exp(-(dx * dx + dy * dy) * 5f) - 0.0067f); t.SetPixel(x, y, new Color(k, k, k, k)); }
            t.Apply(); return Save(t, "Glow");
        }

        // ---------------------------------------------------------------- models
        /// <summary>Hang a GLB's nodes under parent/Body, turned so the model sits as it did in three.js (see F.ModelFix).</summary>
        public static Transform Body(Transform parent, string name = "Body")
        {
            var b = new GameObject(name).transform; b.SetParent(parent, false); b.localRotation = F.ModelFix; return b;
        }
        /// <summary>Copy a GLB node (and its children) as plain GameObjects, keeping its local transform.</summary>
        public static GameObject CopyNode(Transform src, Transform parent, Material mat = null, bool shadows = true)
        {
            var go = new GameObject(src.name); go.transform.SetParent(parent, false);
            go.transform.localPosition = src.localPosition; go.transform.localRotation = src.localRotation; go.transform.localScale = src.localScale;
            var mf = src.GetComponent<MeshFilter>(); var mr = src.GetComponent<MeshRenderer>();
            if (mf) { go.AddComponent<MeshFilter>().sharedMesh = mf.sharedMesh; var r = go.AddComponent<MeshRenderer>(); r.sharedMaterials = mat ? new[] { mat } : mr.sharedMaterials; r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off; }
            foreach (Transform c in src) CopyNode(c, go.transform, mat, shadows);
            return go;
        }
        public static GameObject MeshObject(string name, Transform parent, Mesh mesh, Material mat, bool shadows = true)
        {
            var go = new GameObject(name); go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh; var r = go.AddComponent<MeshRenderer>(); r.sharedMaterial = mat;
            r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off; return go;
        }
        public static PointCloud Cloud(string name, Material mat, int max, float hdrScale = 1f, bool sort = false)
        {
            var go = new GameObject(name); var ps = go.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var pc = go.AddComponent<PointCloud>(); pc.max = max; pc.hdrScale = hdrScale;
            var r = go.GetComponent<ParticleSystemRenderer>(); r.sharedMaterial = mat; r.renderMode = ParticleSystemRenderMode.Billboard;
            r.sortMode = sort ? ParticleSystemSortMode.Distance : ParticleSystemSortMode.None; r.maxParticleSize = 50f; r.minParticleSize = 0f;
            r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            return pc;
        }

        // ---------------------------------------------------------------- environment
        public static Light Sun(Vector3 sunDir3, Color srgb, float intensity, float shadowStrength = 0.85f)
        {
            var go = new GameObject("Sun"); var l = go.AddComponent<Light>(); l.type = LightType.Directional;
            go.transform.rotation = Quaternion.LookRotation(-F.Dir(sunDir3)); l.color = srgb; l.intensity = intensity;
            l.shadows = LightShadows.Soft; l.shadowStrength = shadowStrength; l.shadowBias = 0.02f; l.shadowNormalBias = 0.25f;
            RenderSettings.sun = l; return l;
        }
        public static Material Sky(string name, Vector3 sunDir3, Vector4 horizon, Vector4 zenith, Vector4 below, float clouds = 0f)
        {
            var m = new Material(Shader.Find("Film/Sky")) { name = name };
            m.SetVector("_SunDir", F.Dir(sunDir3)); m.SetVector("_Horizon", horizon); m.SetVector("_Zenith", zenith); m.SetVector("_Below", below); m.SetFloat("_Clouds", clouds);
            m = Save(m, name, "mat"); RenderSettings.skybox = m; return m;
        }
        /// <summary>Exp2 fog (identical to THREE.FogExp2), trilight ambient like the films' hemisphere light.</summary>
        public static void Atmosphere(Color fogLinear, float density, Color skyAmb, Color groundAmb, float ambient)
        {
            RenderSettings.fog = true; RenderSettings.fogMode = FogMode.ExponentialSquared; RenderSettings.fogDensity = density;
            RenderSettings.fogColor = fogLinear.gamma;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = skyAmb * ambient; RenderSettings.ambientEquatorColor = Color.Lerp(skyAmb, groundAmb, 0.5f) * ambient; RenderSettings.ambientGroundColor = groundAmb * ambient;
        }
        public static void Pipeline(float shadowDistance, int cascades = 4)
        {
            var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if (!urp) return;
            urp.shadowDistance = shadowDistance; urp.shadowCascadeCount = cascades; urp.msaaSampleCount = 4;
            if (cascades == 4) urp.cascade4Split = new Vector3(0.015f, 0.06f, 0.25f);
            EditorUtility.SetDirty(urp);
        }
        /// <summary>The films' grade: ACES with a little exposure, bloom, and a light vignette and grain for the game look.</summary>
        public static Volume Post(string name, float bloom, float threshold, float exposure, float vignette = 0.22f, float grain = 0.12f)
        {
            var profile = ScriptableObject.CreateInstance<VolumeProfile>(); profile = Save(profile, name);
            var b = profile.Add<Bloom>(true); b.threshold.Override(threshold); b.intensity.Override(bloom); b.scatter.Override(0.7f);
            var tm = profile.Add<Tonemapping>(true); tm.mode.Override(TonemappingMode.ACES);
            var ca = profile.Add<ColorAdjustments>(true); ca.postExposure.Override(exposure);
            var vg = profile.Add<Vignette>(true); vg.intensity.Override(vignette); vg.smoothness.Override(0.45f);
            var fg = profile.Add<FilmGrain>(true); fg.type.Override(FilmGrainLookup.Thin1); fg.intensity.Override(grain);
            foreach (var c in profile.components) AssetDatabase.AddObjectToAsset(c, profile);
            var v = new GameObject("PostVolume").AddComponent<Volume>(); v.isGlobal = true; v.sharedProfile = profile; return v;
        }
        public static Camera FilmCamera(float far)
        {
            var go = new GameObject("FilmCamera") { tag = "MainCamera" }; var cam = go.AddComponent<Camera>();
            cam.nearClipPlane = 0.05f; cam.farClipPlane = far; cam.fieldOfView = 40f; go.AddComponent<AudioListener>();
            var d = go.AddComponent<UniversalAdditionalCameraData>(); d.renderPostProcessing = true; d.stopNaN = true; d.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing; d.antialiasingQuality = AntialiasingQuality.High;
            return cam;
        }
        public static void BakeEnvironment()
        {
            Lightmapping.bakedGI = false; Lightmapping.realtimeGI = false; Lightmapping.Bake();
        }

        // ---------------------------------------------------------------- HUD
        public static RectTransform Canvas(string name, int order = 10)
        {
            var go = new GameObject(name, typeof(RectTransform)); var c = go.AddComponent<Canvas>(); c.renderMode = RenderMode.ScreenSpaceOverlay; c.sortingOrder = order;
            var s = go.AddComponent<CanvasScaler>(); s.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; s.referenceResolution = new Vector2(1920, 1080); s.matchWidthOrHeight = 0.5f;
            return (RectTransform)go.transform;
        }
        /// <summary>A rect anchored and pivoted at the same normalised point of its parent.</summary>
        public static RectTransform UI(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size)
        {
            var go = new GameObject(name, typeof(RectTransform)); var rt = (RectTransform)go.transform; rt.SetParent(parent, false);
            rt.anchorMin = rt.anchorMax = anchor; rt.pivot = anchor; rt.anchoredPosition = pos; rt.sizeDelta = size; return rt;
        }
        public static Text Label(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, int fontSize, TextAnchor align, Color color, string text = "", bool shadow = true)
        {
            var rt = UI(name, parent, anchor, pos, size); var t = rt.gameObject.AddComponent<Text>();
            t.font = Font; t.fontSize = fontSize; t.alignment = align; t.color = color; t.text = text; t.supportRichText = true; t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Overflow; t.verticalOverflow = VerticalWrapMode.Overflow;
            if (shadow) { var sh = rt.gameObject.AddComponent<Shadow>(); sh.effectColor = new Color(0, 0, 0, 0.45f); sh.effectDistance = new Vector2(1.5f, -1.5f); }
            return t;
        }
        public static Image Box(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, Color color)
        { var rt = UI(name, parent, anchor, pos, size); var i = rt.gameObject.AddComponent<Image>(); i.color = color; i.raycastTarget = false; return i; }
        public static Image Stretch(string name, Transform parent, Color color)
        { var i = Box(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, color); var rt = i.rectTransform; rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.sizeDelta = Vector2.zero; return i; }
        public static CanvasGroup Group(string name, Transform parent)
        {
            var rt = UI(name, parent, Vector2.zero, Vector2.zero, Vector2.zero); rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.sizeDelta = Vector2.zero;
            var g = rt.gameObject.AddComponent<CanvasGroup>(); g.interactable = false; g.blocksRaycasts = false; return g;
        }
        /// <summary>Four corner brackets round a rect (a target box).</summary>
        public static void Brackets(RectTransform box, Color c, float len = 22f, float w = 2f)
        {
            foreach (var a in new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) })
            {
                var h = Box("bh", box, a, Vector2.zero, new Vector2(len, w), c); h.rectTransform.pivot = a;
                var v = Box("bv", box, a, Vector2.zero, new Vector2(w, len), c); v.rectTransform.pivot = a;
            }
        }
        /// <summary>Thin corner marks round the frame and letterbox bars: the shared game-HUD chrome.</summary>
        public static void Chrome(Transform hud, Transform root, Color dim, float bar = 62f)
        {
            foreach (var a in new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) })
            {
                float sx = a.x == 0 ? 1 : -1, sy = a.y == 0 ? 1 : -1; var o = new Vector2(48 * sx, (bar + 30) * sy);
                Box("corner_h", hud, a, o, new Vector2(70, 2), dim); Box("corner_v", hud, a, o, new Vector2(2, 70), dim);
            }
            Box("barTop", root, new Vector2(0.5f, 1), Vector2.zero, new Vector2(4000, bar), Color.black);
            Box("barBottom", root, new Vector2(0.5f, 0), Vector2.zero, new Vector2(4000, bar), Color.black);
        }
        public static string Spaced(string s) => string.Join(" ", s.ToCharArray());
    }
}
