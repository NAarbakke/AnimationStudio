// Builds Assets/Scenes/BurevestnikFlight.unity from scratch. Run through the Unity MCP (script run), entry BuildFlightScene.Run.
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;

public static class BuildFlightScene
{
    const string GEN = "Assets/Generated";
    static Shader gltf;
    static Font font;
    static readonly List<RectTransform> TickRects = new List<RectTransform>(); static readonly List<float> TickMission = new List<float>();
    static readonly Color HUD = new Color(0.78f, 0.96f, 1f, 0.92f), AMBER = new Color(1f, 0.78f, 0.36f, 1f);

    public static string Run()
    {
        if (!AssetDatabase.IsValidFolder(GEN)) AssetDatabase.CreateFolder("Assets", "Generated");
        var glb = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/burevestnik.glb");
        Mesh M(string n) => glb.transform.Find(n).GetComponent<MeshFilter>().sharedMesh;
        gltf = glb.transform.Find("skin").GetComponent<MeshRenderer>().sharedMaterial.shader;
        font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

        // ---------- materials ----------
        var mSkin = Gltf("Skin", Hex(0xa3161d), 0.58f, 0.05f);
        var mBooster = Gltf("Booster", Hex(0xbfc2c3), 0.40f, 0.48f);
        var mKicker = Gltf("Kicker", Hex(0x3b3e38), 0.55f, 0.25f);
        var mSite = Gltf("Site", Color.white, 0.74f, 0.12f);
        var mRock = Gltf("Rock", new Color(0.92f, 0.9f, 0.88f), 0.96f, 0f);
        var mIce = Gltf("Ice", new Color(1f, 1f, 1f), 0.35f, 0f);
        var mGround = Gltf("Ground", Color.white, 0.93f, 0f);
        var mSteel = Gltf("Steel", Hex(0x50544c), 0.5f, 0.5f);
        var lit = Shader.Find("Universal Render Pipeline/Lit");
        var mSea = Save(new Material(lit) { name = "Sea" }, "Sea");
        mSea.SetColor("_BaseColor", new Color(0.09f, 0.19f, 0.23f)); mSea.SetFloat("_Smoothness", 0.82f); mSea.SetFloat("_Metallic", 0f);
        mSea.SetTexture("_BumpMap", WaveNormals()); mSea.SetFloat("_BumpScale", 0.35f); mSea.EnableKeyword("_NORMALMAP"); mSea.SetTextureScale("_BumpMap", new Vector2(1400f, 1400f));
        var soft = SoftTexture();
        var mFlameCore = Additive("FlameCore", new Color(1f, 0.85f, 0.55f) * 6f, FlameTexture());
        var mFlameOuter = Additive("FlameOuter", new Color(1f, 0.42f, 0.12f) * 3.2f, FlameTexture());
        var mCruise = Additive("CruiseGlow", new Color(0.55f, 0.7f, 1f) * 1.6f, FlameTexture());
        var mGlow = Additive("Glow", new Color(1f, 0.6f, 0.25f) * 2.5f, GlowTexture());
        var mSmoke = Smoke(soft);

        // ---------- terrain, sea, ice ----------
        var terrain = new GameObject("Terrain");
        terrain.AddComponent<MeshFilter>().sharedMesh = TerrainMesh();
        var tr = terrain.AddComponent<MeshRenderer>(); tr.sharedMaterial = mGround; tr.shadowCastingMode = ShadowCastingMode.Off;  // low sun: self-shadow acne
        var sea = GameObject.CreatePrimitive(PrimitiveType.Plane); sea.name = "Sea";
        Object.DestroyImmediate(sea.GetComponent<Collider>());
        sea.transform.position = new Vector3(0f, -0.02f, 4500f); sea.transform.localScale = new Vector3(6000f, 1f, 6000f);  // 60 km: sea to every horizon
        sea.GetComponent<MeshRenderer>().sharedMaterial = mSea;

        var rnd = new System.Random(913);
        float R() => (float)rnd.NextDouble();
        var rocks = new[] { M("rock_0"), M("rock_1"), M("rock_2"), M("rock_3") };
        var scatter = new GameObject("Scatter").transform;
        int ice = 0, rock = 0;
        for (int i = 0; i < 20000 && ice < 1600; i++)
        {
            float z = Mathf.Lerp(3050f, 7600f, R()), x = FlightDirector.Valley(z) + (R() - 0.5f) * (i % 3 == 0 ? 2400f : 700f);
            if (FlightDirector.Height(x, z) > -3f) continue;
            float s = Mathf.Lerp(3f, 16f, R() * R());
            Place(scatter, "ice", rocks[ice % 4], mIce, new Vector3(x, 0.15f, z), Quaternion.Euler(0f, R() * 360f, 0f), new Vector3(s, 0.11f, s * Mathf.Lerp(0.6f, 1f, R())));
            ice++;
        }
        for (int i = 0; i < 4000 && rock < 420; i++)
        {
            bool cliff = i % 2 == 1;
            float x = cliff ? (R() - 0.5f) * 1400f : (R() - 0.5f) * 1300f;
            float z = cliff ? FlightDirector.Coast1(x) + (R() - 0.7f) * 120f : (R() - 0.3f) * 1500f;
            if (!cliff && Mathf.Sqrt(x * x + z * z) < 85f) continue;
            float h = FlightDirector.Height(x, z); if (h < 0.5f) continue;
            float s = Mathf.Lerp(0.5f, cliff ? 4.5f : 2.6f, R() * R());
            Place(scatter, "rock", rocks[rock % 4], mRock, new Vector3(x, h - 0.25f * s, z), Quaternion.Euler(R() * 20f, R() * 360f, R() * 20f), Vector3.one * s);
            rock++;
        }

        // ---------- launch site (film frame mapped: local = (-x, y, z), yaw negated, parent turned 90 deg) ----------
        var site = new GameObject("LaunchSite").transform; site.rotation = Quaternion.Euler(0f, 90f, 0f);
        void P(string n, float x, float z, float y = 6f, float yaw = 0f) =>
            Place(site, n, M(n), mSite, Vector3.zero, Quaternion.identity, Vector3.one, new Vector3(-x, y, z), Quaternion.Euler(0f, -yaw * Mathf.Rad2Deg, 0f));
        P("launcher", 0, 0); P("rails", 0, 0); P("shelter", -34, 0); P("wall", -16, 0); P("building_a", -70, 40); P("building_b", -60, -45);
        foreach (var q in new[] { new Vector2(18, 22), new Vector2(18, -22), new Vector2(-28, 24), new Vector2(-28, -24) }) P("mast", q.x, q.y);
        P("container", -21, 10.5f, 6, 1.45f); P("container", -22.5f, -10, 6, 0.2f); P("container", -22.5f, -10, 8.72f, 0.14f); P("container", -9, -11.5f, 6, 0.05f);
        P("drums", 7.5f, 9.5f); P("drums", -6, 11, 6, 2.1f);
        for (int i = 0; i < 6; i++) P("barrier", -7 + i * 3.05f, -13.4f);
        Place(site, "canister", M("canister"), mSite, Vector3.zero, Quaternion.identity, Vector3.one, new Vector3(0f, 9.4f, 0f), Quaternion.Euler(0f, 0f, -18f));
        var cover = GameObject.CreatePrimitive(PrimitiveType.Cube); cover.name = "CanisterCover"; Object.DestroyImmediate(cover.GetComponent<Collider>());
        cover.transform.localScale = new Vector3(2.0f, 1.15f, 0.06f); cover.GetComponent<MeshRenderer>().sharedMaterial = mSteel;

        // ---------- vehicle rig ----------
        var missile = new GameObject("Burevestnik").transform;
        var body = new GameObject("Body").transform; body.SetParent(missile, false); body.localRotation = Quaternion.Euler(0f, 90f, 0f);
        Transform Pivot(string name, Vector3 at) { var t = new GameObject(name).transform; t.SetParent(body, false); t.localPosition = at; return t; }
        Place(body, "skin", M("skin"), mSkin, Vector3.zero, Quaternion.identity, Vector3.one);
        var wingR = Pivot("wingR", new Vector3(-0.55f, 0.2925f, 0f)); Place(wingR, "wing_R", M("wing_R"), mSkin, Vector3.zero, Quaternion.identity, Vector3.one);
        var wingL = Pivot("wingL", new Vector3(-0.55f, 0.3375f, 0f)); Place(wingL, "wing_L", M("wing_L"), mSkin, Vector3.zero, Quaternion.identity, Vector3.one);
        var fin = Pivot("fin", new Vector3(4.125f, -0.21f, 0f)); Place(fin, "fin", M("fin"), mSkin, Vector3.zero, Quaternion.Euler(90f, 0f, 0f), Vector3.one);
        var stabR = Pivot("stabR", new Vector3(4.035f, 0.22f, 0.2961f)); Place(stabR, "stab_R", M("stab_R"), mSkin, Vector3.zero, Quaternion.identity, Vector3.one);
        var stabL = Pivot("stabL", new Vector3(4.035f, 0.22f, -0.2961f)); Place(stabL, "stab_L", M("stab_L"), mSkin, Vector3.zero, Quaternion.identity, Vector3.one);
        var kicker = Pivot("kicker", new Vector3(4.755f, 0f, 0f)); Place(kicker, "kicker_mesh", M("kicker"), mKicker, Vector3.zero, Quaternion.identity, Vector3.one);
        var bR = Pivot("boosterR", new Vector3(-0.05f, -0.16f, 0.603f)); Place(bR, "booster_R", M("booster_R"), mBooster, Vector3.zero, Quaternion.identity, Vector3.one);
        var bL = Pivot("boosterL", new Vector3(-0.05f, -0.16f, -0.603f)); Place(bL, "booster_L", M("booster_L"), mBooster, Vector3.zero, Quaternion.identity, Vector3.one);
        // nozzle discs
        var cone = ConeMesh();
        Transform Flame(string name, Transform parent, Vector3 at, float len, float rad, Material core, Material outer, bool glow)
        {
            var f = new GameObject(name).transform; f.SetParent(parent, false); f.localPosition = at; f.localRotation = Quaternion.Euler(0f, 180f, 0f);
            Place(f, "outer", cone, outer, Vector3.zero, Quaternion.identity, new Vector3(rad, rad, len));
            if (core) Place(f, "core", cone, core, Vector3.zero, Quaternion.identity, new Vector3(rad * 0.55f, rad * 0.55f, len * 0.45f));
            if (glow) { var q = GameObject.CreatePrimitive(PrimitiveType.Quad); Object.DestroyImmediate(q.GetComponent<Collider>()); q.name = "glow"; q.transform.SetParent(f, false); q.transform.localScale = Vector3.one * rad * 9f; q.GetComponent<MeshRenderer>().sharedMaterial = mGlow; q.AddComponent<Billboard>(); }
            foreach (var r in f.GetComponentsInChildren<MeshRenderer>()) r.shadowCastingMode = ShadowCastingMode.Off;
            return f;
        }
        var fK = Flame("flameKicker", kicker, new Vector3(1.8f, 0f, 0f), 7f, 0.33f, mFlameCore, mFlameOuter, true);
        fK.localRotation = Quaternion.Euler(0f, 90f, 0f);   // kicker sits in Body's frame: aft is +X there
        var fR = Flame("flameBoosterR", missile, new Vector3(0.603f, -0.16f, -2.7f), 6f, 0.2f, mFlameCore, mFlameOuter, true);
        var fL = Flame("flameBoosterL", missile, new Vector3(-0.603f, -0.16f, -2.7f), 6f, 0.2f, mFlameCore, mFlameOuter, true);
        var fC = Flame("flameCruise", missile, new Vector3(0f, -0.02f, -4.72f), 2.6f, 0.17f, null, mCruise, false);

        var smK = Trail("smokeKicker", kicker, new Vector3(2.2f, 0f, 0f), mSmoke, 160f, 1.0f, 7f, 7f);
        var smR = Trail("smokeBoosterR", missile, new Vector3(0.603f, -0.16f, -3.2f), mSmoke, 260f, 0.8f, 6f, 8f);
        var smL = Trail("smokeBoosterL", missile, new Vector3(-0.603f, -0.16f, -3.2f), mSmoke, 260f, 0.8f, 6f, 8f);
        var pad = PadSmoke(mSmoke);
        var puff = Trail("sepPuff", null, Vector3.zero, mSmoke, 900f, 1.2f, 4f, 2.5f);
        var flashGo = new GameObject("LaunchFlash"); var flash = flashGo.AddComponent<Light>(); flash.type = LightType.Point; flash.range = 90f; flash.color = new Color(1f, 0.62f, 0.3f); flash.intensity = 0f; flash.shadows = LightShadows.None;

        // ---------- light, sky, fog, post ----------
        var sunGo = new GameObject("Sun"); var sun = sunGo.AddComponent<Light>(); sun.type = LightType.Directional;
        Vector3 sunDir = Quaternion.Euler(-9f, 62f, 0f) * Vector3.forward;  // 9 deg up, east-north-east
        sunGo.transform.rotation = Quaternion.LookRotation(-sunDir); sun.color = new Color(1f, 0.9f, 0.8f); sun.intensity = 2.2f; sun.shadows = LightShadows.Soft; sun.shadowStrength = 0.85f;
        var sky = Save(new Material(Shader.Find("Skybox/Procedural")) { name = "Sky" }, "Sky");
        sky.SetFloat("_SunSize", 0.035f); sky.SetFloat("_SunSizeConvergence", 6f); sky.SetFloat("_AtmosphereThickness", 0.82f);
        sky.SetColor("_SkyTint", new Color(0.46f, 0.52f, 0.62f)); sky.SetColor("_GroundColor", new Color(0.62f, 0.67f, 0.74f)); sky.SetFloat("_Exposure", 1.15f);
        RenderSettings.skybox = sky; RenderSettings.sun = sun; RenderSettings.ambientMode = AmbientMode.Skybox; RenderSettings.ambientIntensity = 1.1f;
        RenderSettings.fog = true; RenderSettings.fogMode = FogMode.ExponentialSquared; RenderSettings.fogDensity = 0.00021f; RenderSettings.fogColor = new Color(0.72f, 0.77f, 0.84f);
        DynamicGI.UpdateEnvironment();
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if (urp) { urp.shadowDistance = 500f; urp.msaaSampleCount = 4; EditorUtility.SetDirty(urp); }

        var profile = ScriptableObject.CreateInstance<VolumeProfile>();
        AssetDatabase.CreateAsset(profile, GEN + "/FilmPost.asset");
        var bloom = profile.Add<Bloom>(true); bloom.threshold.Override(1.0f); bloom.intensity.Override(0.7f); bloom.scatter.Override(0.72f);
        var tone = profile.Add<Tonemapping>(true); tone.mode.Override(TonemappingMode.ACES);
        var ca = profile.Add<ColorAdjustments>(true); ca.postExposure.Override(0.25f); ca.contrast.Override(14f); ca.saturation.Override(-6f); 
        var vig = profile.Add<Vignette>(true); vig.intensity.Override(0.27f); vig.smoothness.Override(0.45f);
        // no motion blur: URP blurs by camera motion only, which smears a missile the camera is tracking
        var grain = profile.Add<FilmGrain>(true); grain.type.Override(FilmGrainLookup.Thin1); grain.intensity.Override(0.18f);
        var chroma = profile.Add<ChromaticAberration>(true); chroma.intensity.Override(0.06f);
        foreach (var c in profile.components) AssetDatabase.AddObjectToAsset(c, profile);
        var vol = new GameObject("PostVolume").AddComponent<Volume>(); vol.isGlobal = true; vol.sharedProfile = profile;

        var camGo = new GameObject("FilmCamera") { tag = "MainCamera" };
        var cam = camGo.AddComponent<Camera>(); cam.nearClipPlane = 0.2f; cam.farClipPlane = 16000f; cam.fieldOfView = 40f;
        camGo.AddComponent<AudioListener>();
        var acd = camGo.AddComponent<UniversalAdditionalCameraData>(); acd.renderPostProcessing = true; acd.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;

        // ---------- HUD ----------
        var ui = BuildHud(out var hud, out var title, out var endCard, out var fade, out var phase, out var clock, out var spd, out var alt, out var agl, out var prop, out var bracket, out var bracketLabel, out var fill);

        // ---------- director ----------
        var dir = new GameObject("FlightDirector").AddComponent<FlightDirector>();
        dir.missile = missile; dir.wingR = wingR; dir.wingL = wingL; dir.fin = fin; dir.stabR = stabR; dir.stabL = stabL; dir.kicker = kicker; dir.boosterR = bR; dir.boosterL = bL; dir.cover = cover.transform;
        dir.flameKicker = fK; dir.flameBoosterR = fR; dir.flameBoosterL = fL; dir.flameCruise = fC;
        dir.smokeKicker = smK; dir.smokeBoosterR = smR; dir.smokeBoosterL = smL; dir.padSmoke = pad; dir.sepPuff = puff; dir.flash = flash;
        dir.cam = cam; dir.hud = hud; dir.titleCard = title; dir.endCard = endCard; dir.fade = fade;
        dir.phase = phase; dir.clock = clock; dir.speedText = spd; dir.altText = alt; dir.aglText = agl; dir.propText = prop;
        dir.ticks = TickRects.ToArray(); dir.tickMission = TickMission.ToArray(); dir.bracket = bracket; dir.bracketLabel = bracketLabel; dir.progressFill = fill; dir.canvasRect = ui;
        dir.time = 2f; dir.Evaluate(2f);

        if (!AssetDatabase.IsValidFolder("Assets/Scenes")) AssetDatabase.CreateFolder("Assets", "Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/BurevestnikFlight.unity");
        // ambient probe and sky reflection for the new scene (no lightmaps)
        Lightmapping.bakedGI = false; Lightmapping.realtimeGI = false; Lightmapping.Bake();
        EditorSceneManager.SaveScene(scene);
        AssetDatabase.SaveAssets();
        return $"built: film {dir.FilmEnd:0.0} s, {ice} floes, {rock} rocks";
    }

    // ================================================================ helpers
    static Color Hex(int h) => new Color(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f);
    static Material Save(Material m, string name) { var p = $"{GEN}/{name}.mat"; AssetDatabase.DeleteAsset(p); AssetDatabase.CreateAsset(m, p); return m; }
    static Material Gltf(string name, Color c, float rough, float metal)
    {
        var m = new Material(gltf) { name = name, enableInstancing = true };
        m.SetColor("baseColorFactor", c); m.SetFloat("roughnessFactor", rough); m.SetFloat("metallicFactor", metal);
        return Save(m, name);
    }
    static Material Additive(string name, Color c, Texture tex)
    {
        var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = name };
        m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", 2f); m.SetFloat("_SrcBlend", (float)BlendMode.One); m.SetFloat("_DstBlend", (float)BlendMode.One); m.SetFloat("_ZWrite", 0f);
        m.SetFloat("_Cull", 0f); m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); m.renderQueue = 3100;
        m.SetColor("_BaseColor", c); m.SetTexture("_BaseMap", tex);
        return Save(m, name);
    }
    static Material Smoke(Texture tex)
    {
        var m = new Material(Shader.Find("Universal Render Pipeline/Particles/Unlit")) { name = "Smoke" };
        m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", 0f); m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha); m.SetFloat("_ZWrite", 0f);
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); m.renderQueue = 3000;
        m.SetColor("_BaseColor", new Color(0.82f, 0.83f, 0.86f, 1f)); m.SetTexture("_BaseMap", tex);
        m.EnableKeyword("_SOFTPARTICLES_ON"); m.SetFloat("_SoftParticlesEnabled", 1f); m.SetFloat("_SoftParticlesFarFadeDistance", 2f);
        return Save(m, "Smoke");
    }
    static Texture2D SoftTexture()
    {
        var t = new Texture2D(128, 128, TextureFormat.RGBA32, true) { name = "Soft", wrapMode = TextureWrapMode.Clamp };
        var noise = new System.Random(5);
        for (int y = 0; y < 128; y++) for (int x = 0; x < 128; x++)
        {
            float dx = (x - 63.5f) / 63.5f, dy = (y - 63.5f) / 63.5f, r = Mathf.Sqrt(dx * dx + dy * dy);
            float n = 0.75f + 0.25f * Mathf.PerlinNoise(x * 0.09f, y * 0.09f);
            float a = Mathf.Clamp01(Mathf.Exp(-r * r * 3.2f) - 0.04f) * n;
            t.SetPixel(x, y, new Color(1f, 1f, 1f, a));
        }
        t.Apply(); AssetDatabase.DeleteAsset(GEN + "/Soft.asset"); AssetDatabase.CreateAsset(t, GEN + "/Soft.asset"); return t;
    }
    static Texture2D WaveNormals()
    {
        int N = 256; var t = new Texture2D(N, N, TextureFormat.RGBA32, true, true) { name = "Waves", wrapMode = TextureWrapMode.Repeat };
        float H(int x, int y)
        {   // tileable: sum of integer-frequency waves
            float u = x / (float)N * Mathf.PI * 2f, v = y / (float)N * Mathf.PI * 2f, h = 0f; var r = new System.Random(3);
            for (int k = 0; k < 24; k++) { int fx = r.Next(-9, 10), fy = r.Next(-9, 10); float ph = (float)r.NextDouble() * 6.28f, a = 1f / (1f + Mathf.Sqrt(fx * fx + fy * fy)); h += a * Mathf.Sin(fx * u + fy * v + ph); }
            return h;
        }
        var hs = new float[N, N]; for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) hs[x, y] = H(x, y);
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
        {
            float dx = hs[(x + 1) % N, y] - hs[(x + N - 1) % N, y], dy = hs[x, (y + 1) % N] - hs[x, (y + N - 1) % N];
            var n = new Vector3(-dx * 2f, -dy * 2f, 1f).normalized; t.SetPixel(x, y, new Color(n.x * 0.5f + 0.5f, n.y * 0.5f + 0.5f, n.z * 0.5f + 0.5f, 1f));
        }
        t.Apply(); AssetDatabase.DeleteAsset(GEN + "/Waves.asset"); AssetDatabase.CreateAsset(t, GEN + "/Waves.asset"); return t;
    }
    static Texture2D GlowTexture()
    {
        // premultiplied: additive blending ignores alpha
        var t = new Texture2D(64, 64, TextureFormat.RGBA32, true) { name = "Glow", wrapMode = TextureWrapMode.Clamp };
        for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
        { float dx = (x - 31.5f) / 31.5f, dy = (y - 31.5f) / 31.5f, r2 = dx * dx + dy * dy; float k = Mathf.Max(0f, Mathf.Exp(-r2 * 5f) - 0.0067f); t.SetPixel(x, y, new Color(k, k, k, k)); }
        t.Apply(); AssetDatabase.DeleteAsset(GEN + "/Glow.asset"); AssetDatabase.CreateAsset(t, GEN + "/Glow.asset"); return t;
    }
    static Texture2D FlameTexture()
    {
        var p = GEN + "/Flame.asset"; var old = AssetDatabase.LoadAssetAtPath<Texture2D>(p); if (old) return old;
        var t = new Texture2D(8, 128, TextureFormat.RGBA32, false) { name = "Flame", wrapMode = TextureWrapMode.Clamp };
        for (int y = 0; y < 128; y++) { float v = y / 127f; float k = Mathf.Pow(1f - v, 1.6f) * Mathf.SmoothStep(0f, 1f, v * 12f); for (int x = 0; x < 8; x++) t.SetPixel(x, y, new Color(k, k, k, k)); }
        t.Apply(); AssetDatabase.CreateAsset(t, p); return t;
    }
    static Mesh ConeMesh()
    {
        // unit cone along +Z from radius 1 at z = 0 to a point at z = 1; v runs along the length for the flame texture
        var p = GEN + "/FlameCone.asset"; var old = AssetDatabase.LoadAssetAtPath<Mesh>(p); if (old) return old;
        int seg = 24, rings = 8; var v = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>();
        for (int r = 0; r <= rings; r++) for (int s = 0; s <= seg; s++)
        {
            float z = r / (float)rings, a = s / (float)seg * Mathf.PI * 2f, rad = Mathf.Pow(1f - z, 0.7f) * (1f + 0.25f * Mathf.Sin(z * Mathf.PI));
            v.Add(new Vector3(Mathf.Cos(a) * rad, Mathf.Sin(a) * rad, z)); uv.Add(new Vector2(s / (float)seg, z));
        }
        for (int r = 0; r < rings; r++) for (int s = 0; s < seg; s++)
        { int a = r * (seg + 1) + s, b = a + seg + 1; tri.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 }); }
        var m = new Mesh { name = "FlameCone" }; m.SetVertices(v); m.SetUVs(0, uv); m.SetTriangles(tri, 0); m.RecalculateNormals(); m.RecalculateBounds();
        AssetDatabase.CreateAsset(m, p); return m;
    }

    static void Place(Transform parent, string name, Mesh mesh, Material mat, Vector3 pos, Quaternion rot, Vector3 scale, Vector3? local = null, Quaternion? localRot = null)
    {
        var go = new GameObject(name); go.transform.SetParent(parent, false);
        if (local.HasValue) { go.transform.localPosition = local.Value; go.transform.localRotation = localRot ?? Quaternion.identity; }
        else if (parent && parent.name == "Scatter") { go.transform.position = pos; go.transform.rotation = rot; }
        else { go.transform.localPosition = pos; go.transform.localRotation = rot; }
        go.transform.localScale = scale;
        go.AddComponent<MeshFilter>().sharedMesh = mesh; go.AddComponent<MeshRenderer>().sharedMaterial = mat;
    }

    static ParticleSystem Trail(string name, Transform parent, Vector3 at, Material mat, float rate, float size0, float size1, float life)
    {
        var go = new GameObject(name); if (parent) go.transform.SetParent(parent, false); go.transform.localPosition = at;
        var ps = go.AddComponent<ParticleSystem>(); ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.World; main.startLifetime = new ParticleSystem.MinMaxCurve(life * 0.7f, life);
        main.startSpeed = new ParticleSystem.MinMaxCurve(0.5f, 3f); main.startSize = new ParticleSystem.MinMaxCurve(size0 * 0.8f, size0 * 1.3f); main.maxParticles = 6000;
        main.startRotation = new ParticleSystem.MinMaxCurve(0f, Mathf.PI * 2f); main.gravityModifier = -0.01f; main.playOnAwake = true; main.loop = true;
        main.startColor = new ParticleSystem.MinMaxGradient(new Color(0.9f, 0.9f, 0.92f, 0.55f), new Color(0.75f, 0.76f, 0.8f, 0.45f));
        var em = ps.emission; em.rateOverTime = rate; em.enabled = false;
        var sh = ps.shape; sh.shapeType = ParticleSystemShapeType.Sphere; sh.radius = 0.15f;
        var sz = ps.sizeOverLifetime; sz.enabled = true; sz.size = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.EaseInOut(0f, 1f, 1f, size1 / size0));
        var col = ps.colorOverLifetime; col.enabled = true;
        var g = new Gradient(); g.SetKeys(new[] { new GradientColorKey(new Color(1f, 0.85f, 0.7f), 0f), new GradientColorKey(Color.white, 0.08f), new GradientColorKey(Color.white, 1f) },
            new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(1f, 0.04f), new GradientAlphaKey(0.6f, 0.4f), new GradientAlphaKey(0f, 1f) });
        col.color = g;
        var rot = ps.rotationOverLifetime; rot.enabled = true; rot.z = new ParticleSystem.MinMaxCurve(-0.4f, 0.4f);
        var lim = ps.limitVelocityOverLifetime; lim.enabled = true; lim.limit = 2f; lim.dampen = 0.15f;
        var r = go.GetComponent<ParticleSystemRenderer>(); r.sharedMaterial = mat; r.sortMode = ParticleSystemSortMode.Distance; r.shadowCastingMode = ShadowCastingMode.Off; r.maxParticleSize = 4f;
        ps.Play();
        return ps;
    }
    static ParticleSystem PadSmoke(Material mat)
    {
        var ps = Trail("padSmoke", null, Vector3.zero, mat, 420f, 4f, 16f, 10f);
        ps.transform.position = FlightDirector.CANISTER_REAR; ps.transform.rotation = Quaternion.LookRotation(new Vector3(0f, -0.45f, -1f));
        var main = ps.main; main.startSpeed = new ParticleSystem.MinMaxCurve(10f, 26f); main.gravityModifier = -0.03f;
        var sh = ps.shape; sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 38f; sh.radius = 0.8f;
        var lim = ps.limitVelocityOverLifetime; lim.limit = 3f; lim.dampen = 0.08f;
        return ps;
    }

    static Mesh TerrainMesh()
    {
        float x0 = -3600f, x1 = 3600f, z0 = -1600f, z1 = 10600f, step = 18f;
        int nx = Mathf.RoundToInt((x1 - x0) / step) + 1, nz = Mathf.RoundToInt((z1 - z0) / step) + 1;
        var v = new Vector3[nx * nz]; var c = new Color[nx * nz]; var tri = new int[(nx - 1) * (nz - 1) * 6];
        for (int j = 0; j < nz; j++) for (int i = 0; i < nx; i++)
        { float x = x0 + i * step, z = z0 + j * step; v[j * nx + i] = new Vector3(x, FlightDirector.Height(x, z), z); }
        int k = 0;
        for (int j = 0; j < nz - 1; j++) for (int i = 0; i < nx - 1; i++)
        { int a = j * nx + i, b = a + nx; tri[k++] = a; tri[k++] = b; tri[k++] = a + 1; tri[k++] = a + 1; tri[k++] = b; tri[k++] = b + 1; }
        var m = new Mesh { name = "Terrain", indexFormat = IndexFormat.UInt32 }; m.vertices = v; m.triangles = tri; m.RecalculateNormals();
        var n = m.normals;
        // glTF vertex colours are linear: author in sRGB, convert
        Color snow = new Color(0.93f, 0.95f, 0.99f).linear, tundra = new Color(0.52f, 0.46f, 0.36f).linear, rock = new Color(0.36f, 0.35f, 0.34f).linear, bed = new Color(0.2f, 0.23f, 0.23f).linear, apron = new Color(0.56f, 0.56f, 0.54f).linear;
        for (int idx = 0; idx < v.Length; idx++)
        {
            float x = v[idx].x, z = v[idx].z, h = v[idx].y, ny = n[idx].y;
            float patch = Mathf.PerlinNoise(x * 0.012f + 5f, z * 0.012f + 9f) * 0.7f + Mathf.PerlinNoise(x * 0.05f, z * 0.05f) * 0.3f;
            float snowAmt = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.3f, 0.46f, patch + h * 0.0012f));
            if (z > 6000f) snowAmt = Mathf.Max(snowAmt, Mathf.InverseLerp(30f, 120f, h));
            Color col = Color.Lerp(tundra, snow, snowAmt);
            col = Color.Lerp(rock, col, Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.62f, 0.86f, ny)));
            col = Color.Lerp(bed, col, Mathf.InverseLerp(-1.5f, 1.5f, h));
            float d = Mathf.Sqrt(x * x + z * z); col = Color.Lerp(apron, col, Mathf.InverseLerp(70f, 95f, d));
            col *= 0.94f + 0.08f * Mathf.PerlinNoise(x * 0.21f, z * 0.21f);
            c[idx] = col;
        }
        m.colors = c; m.RecalculateBounds();
        var p = GEN + "/Terrain.asset"; AssetDatabase.DeleteAsset(p); AssetDatabase.CreateAsset(m, p);
        return m;
    }

    // ================================================================ HUD
    static RectTransform UI(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size)
    {
        var go = new GameObject(name, typeof(RectTransform)); var rt = (RectTransform)go.transform; rt.SetParent(parent, false);
        rt.anchorMin = rt.anchorMax = anchor; rt.pivot = anchor; rt.anchoredPosition = pos; rt.sizeDelta = size; return rt;
    }
    static Text Label(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, int fontSize, TextAnchor align, Color color, string text = "")
    {
        var rt = UI(name, parent, anchor, pos, size); var t = rt.gameObject.AddComponent<Text>();
        t.font = font; t.fontSize = fontSize; t.alignment = align; t.color = color; t.text = text; t.supportRichText = true;
        t.horizontalOverflow = HorizontalWrapMode.Overflow; t.verticalOverflow = VerticalWrapMode.Overflow;
        var sh = rt.gameObject.AddComponent<Shadow>(); sh.effectColor = new Color(0f, 0f, 0f, 0.45f); sh.effectDistance = new Vector2(1.5f, -1.5f);
        return t;
    }
    static Image Box(string name, Transform parent, Vector2 anchor, Vector2 pos, Vector2 size, Color color)
    { var rt = UI(name, parent, anchor, pos, size); var i = rt.gameObject.AddComponent<Image>(); i.color = color; i.raycastTarget = false; return i; }
    static Image Stretch(string name, Transform parent, Color color)
    { var i = Box(name, parent, Vector2.zero, Vector2.zero, Vector2.zero, color); var rt = i.rectTransform; rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.sizeDelta = Vector2.zero; return i; }
    static CanvasGroup Group(string name, Transform parent)
    { var rt = UI(name, parent, Vector2.zero, Vector2.zero, Vector2.zero); rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.sizeDelta = Vector2.zero; var g = rt.gameObject.AddComponent<CanvasGroup>(); g.interactable = false; g.blocksRaycasts = false; return g; }
    static string Spaced(string s) => string.Join(" ", s.ToCharArray());

    static RectTransform BuildHud(out CanvasGroup hud, out CanvasGroup title, out CanvasGroup endCard, out CanvasGroup fade, out Text phase, out Text clock, out Text spd, out Text alt, out Text agl, out Text prop,
                                  out RectTransform bracket, out Text bracketLabel, out RectTransform fill)
    {
        var cgo = new GameObject("HUD", typeof(RectTransform)); var canvas = cgo.AddComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 10;
        var scaler = cgo.AddComponent<CanvasScaler>(); scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize; scaler.referenceResolution = new Vector2(1920f, 1080f); scaler.matchWidthOrHeight = 0.5f;
        var root = cgo.transform;
        Color dim = new Color(HUD.r, HUD.g, HUD.b, 0.35f);

        hud = Group("Hud", root); var h = hud.transform;
        // screen corners
        foreach (var a in new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) })
        {
            float sx = a.x == 0 ? 1 : -1, sy = a.y == 0 ? 1 : -1; Vector2 o = new Vector2(48 * sx, (a.y == 0 ? 92 : 92) * sy);
            Box("corner_h", h, a, o, new Vector2(70, 2), dim); Box("corner_v", h, a, o, new Vector2(2, 70), dim);
        }
        Label("callsign", h, new Vector2(0, 1), new Vector2(72, -104), new Vector2(700, 30), 20, TextAnchor.UpperLeft, dim * 2f, "BUREVESTNIK  //  9M730  //  TEST RANGE");
        phase = Label("phase", h, new Vector2(0, 1), new Vector2(72, -132), new Vector2(900, 44), 34, TextAnchor.UpperLeft, AMBER, "PRE-LAUNCH");
        Label("clockLabel", h, new Vector2(1, 1), new Vector2(-72, -104), new Vector2(400, 30), 20, TextAnchor.UpperRight, dim * 2f, "MISSION TIME");
        clock = Label("clock", h, new Vector2(1, 1), new Vector2(-72, -128), new Vector2(400, 52), 44, TextAnchor.UpperRight, HUD, "T-00:05.0");
        // speed and altitude boxes
        Label("spdLabel", h, new Vector2(0, 0.5f), new Vector2(110, 70), new Vector2(200, 26), 18, TextAnchor.LowerLeft, dim * 2f, "SPD");
        spd = Label("speed", h, new Vector2(0, 0.5f), new Vector2(110, 0), new Vector2(260, 100), 42, TextAnchor.UpperLeft, HUD);
        Box("spdBar", h, new Vector2(0, 0.5f), new Vector2(92, -40), new Vector2(3, 150), dim);
        Label("altLabel", h, new Vector2(1, 0.5f), new Vector2(-110, 70), new Vector2(200, 26), 18, TextAnchor.LowerRight, dim * 2f, "ALT");
        alt = Label("alt", h, new Vector2(1, 0.5f), new Vector2(-110, 0), new Vector2(260, 100), 42, TextAnchor.UpperRight, HUD);
        agl = Label("agl", h, new Vector2(1, 0.5f), new Vector2(-110, -96), new Vector2(260, 30), 24, TextAnchor.UpperRight, AMBER);
        Box("altBar", h, new Vector2(1, 0.5f), new Vector2(-92, -40), new Vector2(3, 150), dim);
        // progress bar with event ticks
        var bar = UI("progress", h, new Vector2(0.5f, 0), new Vector2(0, 118), new Vector2(980, 4));
        Stretch("track", bar, dim);
        var f = Stretch("fill", bar, HUD); fill = f.rectTransform; fill.anchorMax = new Vector2(0f, 1f);
        TickRects.Clear(); TickMission.Clear();
        foreach (var (m, txt) in new[] { (0f, "LAUNCH"), (2.5f, "KICK SEP"), (12.5f, "BOOST SEP"), (-1f, "FEET WET"), (-2f, "FJORD") })
        {
            var tk = UI("tick", bar, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(2, 14)); tk.pivot = new Vector2(0.5f, 0.5f);
            var img = tk.gameObject.AddComponent<Image>(); img.color = HUD; img.raycastTarget = false;
            var lab = Label("tickLabel", tk, new Vector2(0.5f, 0.5f), new Vector2(0, -12), new Vector2(120, 22), 15, TextAnchor.UpperCenter, dim * 2f, txt);
            lab.rectTransform.pivot = new Vector2(0.5f, 1f);
            TickRects.Add(tk); TickMission.Add(m);
        }
        prop = Label("prop", h, new Vector2(0.5f, 0), new Vector2(0, 140), new Vector2(980, 26), 18, TextAnchor.LowerLeft, HUD);
        Label("note", h, new Vector2(1, 0), new Vector2(-72, 98), new Vector2(600, 22), 15, TextAnchor.LowerRight, dim * 1.6f, "NOTIONAL CONOPS  ·  VISUAL INTERPRETATION, NOT ENGINEERING DATA");
        // target bracket
        bracket = UI("bracket", h, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(200, 120)); bracket.pivot = new Vector2(0.5f, 0.5f);
        foreach (var a in new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) })
        {
            float sx = a.x == 0 ? 1 : -1, sy = a.y == 0 ? 1 : -1;
            var hb = Box("bh", bracket, a, Vector2.zero, new Vector2(22, 2), AMBER); hb.rectTransform.pivot = a;
            var vb = Box("bv", bracket, a, Vector2.zero, new Vector2(2, 22), AMBER); vb.rectTransform.pivot = a;
        }
        bracketLabel = Label("bracketLabel", bracket, new Vector2(0, 1), new Vector2(0, 8), new Vector2(300, 22), 16, TextAnchor.LowerLeft, AMBER);
        bracketLabel.rectTransform.pivot = new Vector2(0, 0);

        // letterbox (always on)
        Box("barTop", root, new Vector2(0.5f, 1), Vector2.zero, new Vector2(4000, 62), Color.black);
        Box("barBottom", root, new Vector2(0.5f, 0), Vector2.zero, new Vector2(4000, 62), Color.black);

        title = Group("Title", root); var t = title.transform;
        Label("t1", t, new Vector2(0.5f, 0.5f), new Vector2(0, 40), new Vector2(1600, 120), 104, TextAnchor.MiddleCenter, Color.white, Spaced("BUREVESTNIK"));
        Box("rule", t, new Vector2(0.5f, 0.5f), new Vector2(0, -26), new Vector2(520, 2), new Color(1, 1, 1, 0.6f));
        Label("t2", t, new Vector2(0.5f, 0.5f), new Vector2(0, -70), new Vector2(1600, 40), 26, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.85f), "9M730   ·   NOTIONAL TEST FLIGHT   ·   ARCTIC RANGE");
        Label("t3", t, new Vector2(0.5f, 0.5f), new Vector2(0, -112), new Vector2(1600, 30), 17, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.55f), "visual interpretation  —  not engineering data");

        endCard = Group("EndCard", root); var e = endCard.transform;
        Stretch("black", e, Color.black);
        Label("e1", e, new Vector2(0.5f, 0.5f), new Vector2(0, 20), new Vector2(1600, 120), 84, TextAnchor.MiddleCenter, Color.white, Spaced("BUREVESTNIK"));
        Label("e2", e, new Vector2(0.5f, 0.5f), new Vector2(0, -60), new Vector2(1600, 40), 22, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.7f), "NOTIONAL CONOPS   ·   UNLIMITED RANGE, LOW-ALTITUDE NUCLEAR CRUISE");

        fade = Group("Fade", root); Stretch("black", fade.transform, Color.black);
        return (RectTransform)root;
    }
}
