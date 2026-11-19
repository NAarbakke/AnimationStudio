// Builds Assets/Scenes/Razorbill.unity from scratch: run through the Unity CLI (unity command script.run, entry
// BuildRazorbillScene.Run). Everything placed here follows site/src/drone/main.js.
using System.Collections.Generic;
using AnimationStudio.Film;
using AnimationStudio.Film.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;
using static AnimationStudio.Film.F;
using K = AnimationStudio.Film.Editor.FilmKit;

public static class BuildRazorbillScene
{
    static readonly Color HUD = new Color(0.8f, 0.96f, 0.86f, 0.92f), AMBER = new Color(1f, 0.78f, 0.36f, 1f);

    public static string Run()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var glb = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/razorbill.glb");
        var veg = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/vegetation.glb");
        Mesh VM(string n) => veg.transform.Find(n).GetComponent<MeshFilter>().sharedMesh;

        // ---------------------------------------------------------------- materials (the film's MAT table)
        var MAT = new Dictionary<string, Material>
        {
            ["hub"] = K.Gltf("Hub", K.Hex(0x1c1d20), 0.42f, 0.35f), ["top"] = K.Gltf("Top", K.Hex(0x232427), 0.4f, 0.35f),
            ["battery"] = K.Gltf("Battery", K.Hex(0xdcdcd8), 0.55f, 0.05f), ["arm"] = K.Gltf("Arm", K.Hex(0x141517), 0.36f, 0.4f),
            ["leg"] = K.Gltf("Leg", K.Hex(0xd6d9dc), 0.45f, 0.1f), ["motor"] = K.Gltf("Motor", K.Hex(0x34373c), 0.3f, 0.85f),
            ["prop"] = K.Gltf("Prop", K.Hex(0x0f1012), 0.4f, 0.1f), ["release"] = K.Gltf("Release", K.Hex(0xb8bcc1), 0.28f, 0.9f),
            ["rod_shaft"] = K.Gltf("RodShaft", K.Hex(0x4d5056), 0.55f, 0.45f), ["rod_tape"] = K.Gltf("RodTape", K.Hex(0xf0f1f2), 0.22f, 1f),
            ["rod_cone"] = K.Gltf("RodCone", K.Hex(0x1c1d20), 0.45f, 0.2f), ["rod_cap"] = K.Gltf("RodCap", K.Hex(0x1c1d20), 0.45f, 0.2f),
            ["rod_fins"] = K.Gltf("RodFins", K.Hex(0xd94f08), 0.6f, 0f, true), ["rod_ring"] = K.Gltf("RodRing", K.Hex(0xc8ccd0), 0.25f, 1f),
        };
        Material MatFor(string node) { var n = node.ToLowerInvariant(); return MAT.TryGetValue(n, out var m) ? m : MAT.TryGetValue(n.Split('_')[0], out m) ? m : MAT["hub"]; }
        var plant = K.Gltf("Plant", Color.white, 0.88f, 0f, true);

        // ---------------------------------------------------------------- drone: Body holds the GLB nodes, pivots for what moves
        var drone = new GameObject("Razorbill").transform;
        var body = K.Body(drone);
        var nodes = new Dictionary<string, Transform>();
        foreach (Transform c in glb.transform) if (!c.name.StartsWith("rod_")) nodes[c.name] = K.CopyNode(c, body, MatFor(c.name)).transform;
        Vector3 LocalCentre(Transform n) { var m = n.GetComponent<MeshFilter>().sharedMesh; return n.localPosition + n.localRotation * Vector3.Scale(n.localScale, m.bounds.center); }
        var discTex = DiscTexture();
        var discMat = K.Unlit("PropBlur", Color.white, true); discMat.SetTexture("_BaseMap", discTex);
        var props = new Transform[4]; var discs = new Transform[4];
        for (int n = 0; n < 4; n++)
        {
            var motor = nodes[$"motor_{n}"]; var prop = nodes[$"prop_{n}"];
            Vector3 mc = LocalCentre(motor), pc = LocalCentre(prop);
            var pivot = new GameObject($"propPivot_{n}").transform; pivot.SetParent(body, false); pivot.localPosition = new Vector3(mc.x, 0, mc.z);
            prop.SetParent(pivot, true); props[n] = pivot;
            // blade radius from the mesh
            var pm = prop.GetComponent<MeshFilter>().sharedMesh; float rad = 0f;
            foreach (var v in pm.vertices) { var p = prop.localPosition + prop.localRotation * Vector3.Scale(prop.localScale, v); rad = Mathf.Max(rad, new Vector2(p.x, p.z).magnitude); }
            var dpiv = new GameObject($"disc_{n}").transform; dpiv.SetParent(body, false); dpiv.localPosition = new Vector3(mc.x, pc.y, mc.z);
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad); Object.DestroyImmediate(q.GetComponent<Collider>());
            q.transform.SetParent(dpiv, false); q.transform.localRotation = Quaternion.Euler(90, 0, 0); q.transform.localScale = Vector3.one * 2 * rad;
            var qr = q.GetComponent<MeshRenderer>(); qr.sharedMaterial = discMat; qr.shadowCastingMode = ShadowCastingMode.Off;
            discs[n] = dpiv;
        }
        Transform OnPivot(string name, Vector3 at) { var p = new GameObject("pivot_" + name).transform; p.SetParent(body, false); p.localPosition = at; nodes[name].SetParent(p, true); return p; }
        var hook = OnPivot("release_hook", new Vector3(0, 0.095f, 0.002f));
        var horn = OnPivot("release_horn", new Vector3(0, 0.092f, 0.036f));
        var lever = nodes["release_lever"];

        // the rod: its nodes keep their places in the drone frame, inside a group that undoes ARROW_LOCAL
        var arrow = new GameObject("Rod").transform;
        var inv = RazorbillDirector.ARROW_LOCAL.inverse;
        var rodFrame = new GameObject("RodFrame").transform; rodFrame.SetParent(arrow, false);
        rodFrame.localPosition = U((Vector3)inv.GetColumn(3)); rodFrame.localRotation = U(inv.rotation);
        var rodBody = K.Body(rodFrame);
        foreach (Transform c in glb.transform) if (c.name.StartsWith("rod_")) K.CopyNode(c, rodBody, MatFor(c.name));

        // ---------------------------------------------------------------- ground, hills, farmyard
        var groundMat = K.Save(new Material(Shader.Find("Film/Razorbill Ground")) { name = "Ground" }, "Ground", "mat");
        var gp = GameObject.CreatePrimitive(PrimitiveType.Plane); gp.name = "Ground"; Object.DestroyImmediate(gp.GetComponent<Collider>());
        gp.transform.localScale = new Vector3(1400, 1, 1400); var gr = gp.GetComponent<MeshRenderer>(); gr.sharedMaterial = groundMat; gr.shadowCastingMode = ShadowCastingMode.Off;
        K.MeshObject("Hills", null, K.Save(Hills(), "Hills"), K.Lit("HillsMat", K.Hex(0x45583a), 0.05f, 0f), false);
        Farmyard();

        // ---------------------------------------------------------------- crops and trees
        var cropsGo = new GameObject("Crops"); var crops = cropsGo.AddComponent<CropField>();
        crops.hero = new[] { VM("crop_hero_0"), VM("crop_hero_1"), VM("crop_hero_2") }; crops.field = new[] { VM("crop_field_0"), VM("crop_field_1"), VM("crop_field_2") };
        crops.tree = new[] { VM("tree_0"), VM("tree_1"), VM("tree_2") }; crops.treeFar = new[] { VM("tree_far_0"), VM("tree_far_1"), VM("tree_far_2") };
        crops.plantMat = plant; crops.track = RazorbillDirector.Track().ToArray();

        // ---------------------------------------------------------------- impact: clods, dust; larvae
        var clodMesh = K.Save(ClodMesh(), "Clod"); var clodMat = K.Lit("Clod", K.Hex(0x2c1e12), 0f, 0f);
        var clodRoot = new GameObject("Clods").transform; var clods = new Transform[18];
        for (int i = 0; i < 18; i++) clods[i] = K.MeshObject($"clod_{i}", clodRoot, clodMesh, clodMat).transform;
        var dust = K.Cloud("Dust", K.Particle("Dust", Color.white, K.Puff(false), false), 140, 1f, true);
        var skin = K.Save(RazorbillDirector.LarvaSkin(), "LarvaSkin");
        var skinMat = K.Lit("Larva", Color.white, 0.58f, 0f); skinMat.SetTexture("_BaseMap", skin);
        var larvaeRoot = new GameObject("Larvae").transform; var larvae = new MeshFilter[4];
        for (int i = 0; i < 4; i++) { var go = K.MeshObject($"larva_{i}", larvaeRoot, K.Save(RazorbillDirector.LarvaMesh(), $"Larva{i}"), skinMat); larvae[i] = go.GetComponent<MeshFilter>(); go.SetActive(false); }

        // ---------------------------------------------------------------- light, sky, fog, post
        Vector3 SUN = new Vector3(0.42f, 0.5f, -0.76f).normalized;
        K.Sun(SUN, K.Hex(0xffe7c4), 2.4f);
        K.Sky("Sky", SUN, new Vector4(0.66f, 0.68f, 0.70f), new Vector4(0.10f, 0.25f, 0.60f), new Vector4(0.4f, 0.4f, 0.36f));
        K.Atmosphere(new Color(0.6f, 0.63f, 0.66f), 0.00022f, K.Hex(0xb4c8e8), K.Hex(0x6b5a3e), 0.75f);
        K.Pipeline(70f);
        K.Post("FilmPost", 0.35f, 0.95f, 0.14f);
        var cam = K.FilmCamera(9000f);

        // ---------------------------------------------------------------- HUD
        var root = K.Canvas("HUD");
        var hud = K.Group("Hud", root); var h = hud.transform; Color dim = new Color(HUD.r, HUD.g, HUD.b, 0.35f);
        K.Chrome(h, root, dim);
        K.Label("callsign", h, new Vector2(0, 1), new Vector2(72, -104), new Vector2(700, 30), 20, TextAnchor.UpperLeft, dim * 2f, "RAZORBILL  //  OPERATION SKYFALL  //  SENSOR DROP");
        var phase = K.Label("phase", h, new Vector2(0, 1), new Vector2(72, -132), new Vector2(900, 44), 34, TextAnchor.UpperLeft, AMBER, "TRANSIT");
        K.Label("clockLabel", h, new Vector2(1, 1), new Vector2(-72, -104), new Vector2(400, 30), 20, TextAnchor.UpperRight, dim * 2f, "MISSION TIME");
        var clock = K.Label("clock", h, new Vector2(1, 1), new Vector2(-72, -128), new Vector2(400, 52), 44, TextAnchor.UpperRight, HUD, "T+00:00.0");
        K.Label("spdLabel", h, new Vector2(0, 0.5f), new Vector2(110, 70), new Vector2(200, 26), 18, TextAnchor.LowerLeft, dim * 2f, "SPEED");
        var spd = K.Label("speed", h, new Vector2(0, 0.5f), new Vector2(110, 0), new Vector2(260, 100), 42, TextAnchor.UpperLeft, HUD);
        K.Box("spdBar", h, new Vector2(0, 0.5f), new Vector2(92, -40), new Vector2(3, 150), dim);
        K.Label("altLabel", h, new Vector2(1, 0.5f), new Vector2(-110, 70), new Vector2(200, 26), 18, TextAnchor.LowerRight, dim * 2f, "HEIGHT");
        var agl = K.Label("agl", h, new Vector2(1, 0.5f), new Vector2(-110, 0), new Vector2(260, 100), 42, TextAnchor.UpperRight, HUD);
        K.Box("altBar", h, new Vector2(1, 0.5f), new Vector2(-92, -40), new Vector2(3, 150), dim);
        var dot = K.Box("payloadDot", h, new Vector2(0, 0), new Vector2(76, 112), new Vector2(12, 12), AMBER);
        var payload = K.Label("payload", h, new Vector2(0, 0), new Vector2(98, 104), new Vector2(900, 28), 20, TextAnchor.LowerLeft, HUD);
        K.Label("note", h, new Vector2(1, 0), new Vector2(-72, 98), new Vector2(600, 22), 15, TextAnchor.LowerRight, dim * 1.6f, "CONCEPT VISUALISATION");
        RectTransform Tracker(string name, Color c, out Text label)
        {
            var b = K.UI(name, h, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(80, 80)); b.pivot = new Vector2(0.5f, 0.5f); K.Brackets(b, c, 16, 2);
            label = K.Label(name + "Label", b, new Vector2(0, 1), new Vector2(0, 6), new Vector2(320, 22), 16, TextAnchor.LowerLeft, c); label.rectTransform.pivot = Vector2.zero;
            return b;
        }
        var droneBox = Tracker("droneBox", HUD, out var droneLabel);
        var dropBox = Tracker("dropBox", AMBER, out var dropLabel);
        // the film's signal plot, bottom right, over the macro shot
        var plotGroup = K.Group("Plot", root);
        var plotRect = K.UI("plotPanel", plotGroup.transform, new Vector2(1, 0), new Vector2(-72, 100), new Vector2(580, 351));
        var plot = plotRect.gameObject.AddComponent<RawImage>(); plot.raycastTarget = false;
        K.Label("plotY", plotRect, new Vector2(0, 0.5f), new Vector2(6, 0), new Vector2(200, 24), 18, TextAnchor.MiddleLeft, dim * 2.4f, "SIGNAL");
        K.Label("plotX", plotRect, new Vector2(0.5f, 0), new Vector2(0, 30), new Vector2(200, 24), 18, TextAnchor.LowerCenter, dim * 2.4f, "TIME");
        K.Label("plotT", plotRect, new Vector2(0, 1), new Vector2(80, -12), new Vector2(560, 24), 18, TextAnchor.UpperLeft, AMBER, "ROD SENSOR  //  LARVA CROSSINGS");
        var title = K.Group("Title", root); var tt = title.transform;
        K.Label("t1", tt, new Vector2(0.5f, 0.5f), new Vector2(0, 40), new Vector2(1600, 120), 96, TextAnchor.MiddleCenter, Color.white, K.Spaced("OPERATION SKYFALL"));
        K.Box("rule", tt, new Vector2(0.5f, 0.5f), new Vector2(0, -26), new Vector2(520, 2), new Color(1, 1, 1, 0.6f));
        K.Label("t2", tt, new Vector2(0.5f, 0.5f), new Vector2(0, -70), new Vector2(1600, 40), 28, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.85f), "RAZORBILL FARM DRONE");
        var fade = K.Group("Fade", root); K.Stretch("black", fade.transform, Color.black);

        // ---------------------------------------------------------------- director
        var dir = new GameObject("RazorbillDirector").AddComponent<RazorbillDirector>();
        dir.drone = drone; dir.propPivots = props; dir.discs = discs; dir.hook = hook; dir.horn = horn; dir.lever = lever; dir.leverHome = lever.localPosition;
        dir.arrow = arrow; dir.crops = crops; dir.clods = clods; dir.dust = dust; dir.larvae = larvae;
        dir.cam = cam; dir.hud = hud; dir.title = title; dir.fade = fade; dir.plotGroup = plotGroup;
        dir.phase = phase; dir.clock = clock; dir.speedText = spd; dir.aglText = agl; dir.payloadText = payload; dir.payloadDot = dot;
        dir.droneBox = droneBox; dir.droneLabel = droneLabel; dir.dropBox = dropBox; dir.dropLabel = dropLabel; dir.canvasRect = root; dir.plot = plot;
        dir.time = 9f; dir.Evaluate(9f);

        K.EnsureFolder("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/Razorbill.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Razorbill.unity", true) };
        K.BakeEnvironment(); EditorSceneManager.SaveScene(scene);
        K.Flush();
        return $"built Razorbill: {crops.drawn} plants and trees placed (computed at first draw), film {dir.FilmEnd} s, impact {RazorbillDirector.IMPACT}";
    }

    // ---------------------------------------------------------------- helpers
    static Texture2D DiscTexture()
    {
        int N = 256; var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = "PropBlur", wrapMode = TextureWrapMode.Clamp };
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
        {
            float u = (x + 0.5f) / N * 2 - 1, v = (y + 0.5f) / N * 2 - 1, r = Mathf.Sqrt(u * u + v * v), a = Mathf.Atan2(v, u);
            float s = Mathf.Pow(0.5f + 0.5f * Mathf.Cos(2 * a), 10f);
            float al = (r > 1f || r < 0.14f) ? 0f : (0.07f + 0.2f * s) * SStep(1f, 0.9f, r) * SStep(0.14f, 0.3f, r);
            t.SetPixel(x, y, new Color(0.05f, 0.05f, 0.05f, al));
        }
        t.Apply(); return K.Save(t, "PropBlur");
    }
    static Mesh Hills()
    {
        // the film's ring of distant hills, mostly fog
        int segs = 256, rings = 8; var r = new Rng(7); var ph = new float[6]; for (int i = 0; i < 6; i++) ph[i] = r.Next() * 6.28f;
        var v = new List<Vector3>(); var idx = new List<int>();
        for (int j = 0; j <= rings; j++) for (int i = 0; i <= segs; i++)
        {
            float a = i / (float)segs * Mathf.PI * 2, u = j / (float)rings, rad = Mix(2600, 5200, u);
            float hh = 0.55f * (60 + 70 * Mathf.Sin(3 * a + ph[0]) * Mathf.Sin(5 * a + ph[1]) + 35 * Mathf.Sin(11 * a + ph[2]) + 15 * Mathf.Sin(23 * a + ph[3])) * Mathf.Sin(Mathf.PI * Mathf.Min(1, u * 1.6f)) + 20 * u;
            v.Add(U(new Vector3(Mathf.Cos(a) * rad, Mathf.Max(-5, hh * (1 + u)), Mathf.Sin(a) * rad)));
        }
        for (int j = 0; j < rings; j++) for (int i = 0; i < segs; i++) { int a = j * (segs + 1) + i, b = a + segs + 1; idx.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b }); }
        var m = new Mesh { name = "Hills", indexFormat = IndexFormat.UInt32 }; m.SetVertices(v); m.SetTriangles(idx, 0); m.RecalculateNormals(); return m;
    }
    static Mesh ClodMesh()
    {
        var src = Resources.GetBuiltinResource<Mesh>("Sphere.fbx"); var m = Object.Instantiate(src); m.name = "Clod";
        var vs = m.vertices;
        for (int i = 0; i < vs.Length; i++) { var p = vs[i] * 2f; float k = 0.72f + 0.2f * Mathf.Sin(p.x * 4.1f + 1) * Mathf.Sin(p.y * 3.3f) + 0.12f * Mathf.Sin(p.z * 7.3f + p.x * 5); vs[i] = new Vector3(p.x * k, p.y * k * 0.75f, p.z * k); }
        m.vertices = vs; m.RecalculateNormals(); m.RecalculateBounds(); return m;
    }
    static void Farmyard()
    {
        // the film's farmyard: two barns with gable roofs and a silo, at (300, 0, -230) turned 0.35 rad
        var yard = new GameObject("Farmyard").transform; yard.position = U(new Vector3(300, 0, -230)); yard.rotation = U(AxisAngle(Vector3.up, 0.35f));
        var barnM = K.Lit("Barn", K.Hex(0x7a2a1e), 0.2f, 0f); var roofM = K.Lit("Roof", K.Hex(0x3b3d40), 0.4f, 0f); var siloM = K.Lit("Silo", K.Hex(0xb9bcbf), 0.6f, 0.6f);
        void Barn(float w, float hgt, float d, float x, float z)
        {
            var b = GameObject.CreatePrimitive(PrimitiveType.Cube); Object.DestroyImmediate(b.GetComponent<Collider>()); b.name = "barn";
            b.transform.SetParent(yard, false); b.transform.localPosition = U(new Vector3(x, hgt / 2, z)); b.transform.localScale = new Vector3(w, hgt, d); b.GetComponent<MeshRenderer>().sharedMaterial = barnM;
            // gable: ridge 0.341 d above the eaves line at h + 0.16 d, half width 0.537 d (the film's 3-sided cylinder)
            float y0 = hgt + 0.16f * d, top = y0 + 0.341f * d, eave = y0 - 0.1705f * d, hw = 0.537f * d;
            var m = new Mesh { name = "Roof" };
            var v = new List<Vector3>(); var t = new List<int>();
            Vector3 P(float px, float py, float pz) => U(new Vector3(px, py, pz));
            void Quad(Vector3 a, Vector3 b2, Vector3 c, Vector3 e) { int n = v.Count; v.AddRange(new[] { a, b2, c, e }); t.AddRange(new[] { n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2 }); }
            Quad(P(x - w / 2, eave, z - hw), P(x + w / 2, eave, z - hw), P(x + w / 2, top, z), P(x - w / 2, top, z));
            Quad(P(x - w / 2, eave, z + hw), P(x + w / 2, eave, z + hw), P(x + w / 2, top, z), P(x - w / 2, top, z));
            Quad(P(x - w / 2, eave, z - hw), P(x - w / 2, eave, z + hw), P(x - w / 2, top, z), P(x - w / 2, top, z));
            Quad(P(x + w / 2, eave, z - hw), P(x + w / 2, eave, z + hw), P(x + w / 2, top, z), P(x + w / 2, top, z));
            m.SetVertices(v); m.SetTriangles(t, 0); m.RecalculateNormals();
            K.MeshObject("roof", yard, K.Save(m, $"Roof_{x}_{z}"), roofM);
        }
        Barn(30, 8, 14, 0, 0); Barn(18, 6, 10, 28, 14);
        var silo = GameObject.CreatePrimitive(PrimitiveType.Cylinder); Object.DestroyImmediate(silo.GetComponent<Collider>()); silo.name = "silo";
        silo.transform.SetParent(yard, false); silo.transform.localPosition = U(new Vector3(-22, 8, 6)); silo.transform.localScale = new Vector3(6.4f, 8f, 6.4f); silo.GetComponent<MeshRenderer>().sharedMaterial = siloM;
    }
}
