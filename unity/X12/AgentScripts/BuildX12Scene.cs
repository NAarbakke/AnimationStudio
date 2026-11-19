// Builds Assets/Scenes/X12.unity from scratch: run through the Unity CLI (unity command script.run, entry
// BuildX12Scene.Run). Everything placed here follows site/src/x12/main.js.
using System.Collections.Generic;
using AnimationStudio.Film;
using AnimationStudio.Film.Editor;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UI;
using static AnimationStudio.Film.F;
using static X12World;
using K = AnimationStudio.Film.Editor.FilmKit;

public static class BuildX12Scene
{
    static readonly Color CYAN = new Color(0.5f, 0.89f, 1f, 1f), AMBER = new Color(1f, 0.78f, 0.36f, 1f), TXT = new Color(0.86f, 0.94f, 1f, 0.95f);

    public static string Run()
    {
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var glb = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Models/x12-autonomous.glb");

        // ---------------------------------------------------------------- terrain, far ranges, sea
        var terrainMat = K.Gltf("Terrain", Color.white, 0.92f, 0f);
        var ter = K.MeshObject("Fjord", null, K.Save(Terrain(), "Fjord"), terrainMat, false);
        ter.GetComponent<MeshRenderer>().receiveShadows = true;
        K.MeshObject("Ranges", null, K.Save(Ranges(), "Ranges"), K.Lit("RangesMat", new Color(0.12f, 0.13f, 0.15f).gamma, 0.05f, 0f), false);
        var waterMat = K.Save(new Material(Shader.Find("Film/X12 Water")) { name = "Water" }, "Water", "mat");
        K.MeshObject("Sea", null, K.Save(SeaGrid(), "SeaGrid"), waterMat, false).GetComponent<MeshRenderer>().receiveShadows = false;

        // ---------------------------------------------------------------- the boat
        var boat = new GameObject("X12").transform; var body = K.Body(boat);
        var parts = new Dictionary<string, Transform>();
        foreach (Transform c in glb.transform) parts[c.name] = K.CopyNode(c, body).transform;
        var highlights = new List<Highlight>();
        foreach (var kv in X12Director.GROUPS) foreach (var label in kv.Value) if (parts.TryGetValue(label, out var node)) foreach (var r in node.GetComponentsInChildren<Renderer>()) highlights.Add(new Highlight { group = kv.Key, r = r });
        Bounds LocalBounds(Transform n) { var m = n.GetComponent<MeshFilter>().sharedMesh; var b = m.bounds; b.center = n.localPosition + n.localRotation * b.center; return b; }
        var navB = LocalBounds(parts["Navigation radar"]);
        float launcherBase = LocalBounds(parts["Air defence launcher (port)"]).min.y;
        // the hull's half-beam along its length, for the water's hull cut-out and waterline foam (film frame x = -glb x)
        var beam = new float[128];
        void Beam(Transform n, bool collar)
        {
            var m = n.GetComponent<MeshFilter>().sharedMesh;
            foreach (var v in m.vertices) { float x = -v.x, y = v.y, z = Mathf.Abs(v.z); if (collar && y > 0.75f) continue; int b = Mathf.Clamp(Mathf.FloorToInt((x + 6.2f) / 12.4f * 128), 0, 127); beam[b] = Mathf.Max(beam[b], z); }
        }
        Beam(parts["Tube collar"], true); Beam(parts["Hull"], false);
        { var sm = (float[])beam.Clone(); for (int i = 0; i < 128; i++) beam[i] = Mathf.Max(sm[i], 0.5f * (sm[Mathf.Max(0, i - 1)] + sm[Mathf.Min(127, i + 1)])) - 0.08f; }

        // ---------------------------------------------------------------- escorts, threat, interceptor, debris
        var ships = new Transform[SHIPS.Length];
        for (int i = 0; i < SHIPS.Length; i++) ships[i] = Ship(SHIPS[i]);
        var droneMat = K.Lit("DroneBody", K.Hex(0x3a3d39), 0.45f, 0.2f); var droneDark = K.Lit("DroneDark", K.Hex(0x15171a), 0.5f, 0f);
        var drone = new GameObject("AttackDrone").transform;
        Part(drone, PrimitiveType.Cylinder, V(0, 0, 0), AxisAngle(Vector3.forward, -Mathf.PI / 2), V(0.37f, 1.5f, 0.37f), droneMat);
        Part(drone, PrimitiveType.Sphere, V(1.62f, 0, 0), Quaternion.identity, V(0.7f, 0.36f, 0.36f), droneMat);
        K.MeshObject("wing", drone, K.Save(Flat(new[] { V(0.7f, 0, 0), V(-1.35f, 0, 1.3f), V(-1.55f, 0, 1.3f), V(-1.4f, 0, 0), V(-1.55f, 0, -1.3f), V(-1.35f, 0, -1.3f) }, 0.02f), "DroneWing"), droneMat);
        foreach (var s in new[] { -1f, 1f }) Part(drone, PrimitiveType.Cube, V(-1.42f, 0.2f, s * 1.3f), Quaternion.identity, V(0.35f, 0.45f, 0.03f), droneMat);
        Part(drone, PrimitiveType.Cylinder, V(-1.6f, 0, 0), AxisAngle(Vector3.forward, Mathf.PI / 2), V(0.16f, 0.09f, 0.16f), droneDark);
        var discPivot = new GameObject("prop").transform; discPivot.SetParent(drone, false); discPivot.localPosition = U(V(-1.7f, 0, 0));
        var discMat = K.Unlit("DroneProp", new Color(0.07f, 0.07f, 0.07f, 0.35f), true); discMat.SetTexture("_BaseMap", K.Puff(false));
        var disc = GameObject.CreatePrimitive(PrimitiveType.Quad); Object.DestroyImmediate(disc.GetComponent<Collider>()); disc.transform.SetParent(discPivot, false);
        disc.transform.localRotation = Quaternion.Euler(0, 90, 0); disc.transform.localScale = Vector3.one * 0.84f; disc.GetComponent<MeshRenderer>().sharedMaterial = discMat;
        var missileW = K.Lit("Missile", K.Hex(0xd9dcdc), 0.6f, 0.2f); var missileD = K.Lit("MissileDark", K.Hex(0x2b2e31), 0.5f, 0f);
        var missile = new GameObject("Interceptor").transform;
        Part(missile, PrimitiveType.Cylinder, V(0, 0, 0), AxisAngle(Vector3.forward, -Mathf.PI / 2), V(0.13f, 0.725f, 0.13f), missileW);
        Part(missile, PrimitiveType.Sphere, V(0.78f, 0, 0), Quaternion.identity, V(0.36f, 0.13f, 0.13f), missileW);
        Part(missile, PrimitiveType.Cylinder, V(0.45f, 0, 0), AxisAngle(Vector3.forward, -Mathf.PI / 2), V(0.134f, 0.04f, 0.134f), missileD);
        for (int i = 0; i < 4; i++) Part(missile, PrimitiveType.Cube, AxisAngle(Vector3.right, i * Mathf.PI / 2) * V(-0.6f, 0, 0.1f), AxisAngle(Vector3.right, i * Mathf.PI / 2), V(0.22f, 0.004f, 0.13f), missileD);
        var debrisMat = K.Lit("Debris", K.Hex(0x26282a), 0.3f, 0f);
        var pieces = X12Director.Debris(); var debris = new Transform[pieces.Length];
        for (int i = 0; i < pieces.Length; i++) { var d = new GameObject($"debris_{i}").transform; Part(d, PrimitiveType.Cube, Vector3.zero, Quaternion.identity, pieces[i].size, debrisMat); debris[i] = d; d.gameObject.SetActive(false); }
        var spray = K.Cloud("Spray", K.Particle("Spray", Color.white, K.Puff(false), false), 6000);
        var smoke = K.Cloud("Smoke", K.Particle("Smoke", Color.white, K.Puff(false), false), 5000, 1f, true);
        var fire = K.Cloud("Fire", K.Particle("Fire", Color.white * 14f, K.Puff(true), true), 600, 14f);

        // ---------------------------------------------------------------- light, sky, fog, post, cameras
        Vector3 SUN = X12Director.SunDir;
        K.Sun(SUN, K.Hex(0xffe2bf), 2.5f, 0.8f);
        var sky = K.Sky("Sky", SUN, new Vector4(0.46f, 0.52f, 0.58f), new Vector4(0.12f, 0.2f, 0.34f), new Vector4(0.1f, 0.13f, 0.16f), 1f);
        sky.SetFloat("_ZenithPow", 0.55f); sky.SetFloat("_BelowK", 5f); sky.SetVector("_Glow", new Vector4(1f, 0.72f, 0.46f)); sky.SetFloat("_GlowPow", 6f); sky.SetFloat("_GlowFade", 0.6f);
        sky.SetVector("_Core", new Vector4(1f, 0.88f, 0.7f)); sky.SetFloat("_CoreAmt", 1.4f); sky.SetFloat("_CorePow", 120f); sky.SetFloat("_Disc", 20f);
        K.Atmosphere(new Color(0.46f, 0.52f, 0.58f), 0.000105f, K.Hex(0xa9bdd6), K.Hex(0x1d2a33), 0.9f);
        K.Pipeline(120f);
        K.Post("FilmPost", 0.4f, 0.92f, 0.14f);
        var cam = K.FilmCamera(24000f);
        var eoCam = K.FilmCamera(24000f); eoCam.name = "EoirCamera"; eoCam.tag = "Untagged"; Object.DestroyImmediate(eoCam.GetComponent<AudioListener>()); eoCam.enabled = false; eoCam.GetComponent<UniversalAdditionalCameraData>().renderPostProcessing = false;   // no grade or vignette under the thermal look

        // ---------------------------------------------------------------- HUD
        var root = K.Canvas("HUD");
        var eoCanvas = K.Canvas("EoirView", 5); var eoImg = K.Stretch("view", eoCanvas, Color.white).gameObject; Object.DestroyImmediate(eoImg.GetComponent<Image>());
        var eoImage = eoImg.AddComponent<RawImage>(); eoImage.material = K.Save(new Material(Shader.Find("Film/UI EOIR")) { name = "Eoir" }, "Eoir", "mat"); eoImage.raycastTarget = false; eoImg.SetActive(false);
        Color dim = new Color(TXT.r, TXT.g, TXT.b, 0.35f);
        var hud = K.Group("Hud", root); var h = hud.transform; K.Chrome(h, root, dim);
        K.Label("callsign", h, new Vector2(0, 1), new Vector2(72, -104), new Vector2(800, 30), 20, TextAnchor.UpperLeft, dim * 2f, "X-12 AUTONOMOUS  //  USV  //  ESCORT GROUP NORTH");
        var phase = K.Label("phase", h, new Vector2(0, 1), new Vector2(72, -132), new Vector2(900, 44), 34, TextAnchor.UpperLeft, AMBER, "TRANSIT");
        K.Label("clockLabel", h, new Vector2(1, 1), new Vector2(-72, -104), new Vector2(400, 30), 20, TextAnchor.UpperRight, dim * 2f, "MISSION TIME");
        var clock = K.Label("clock", h, new Vector2(1, 1), new Vector2(-72, -128), new Vector2(400, 52), 44, TextAnchor.UpperRight, TXT, "T+00:00.0");
        K.Label("note", h, new Vector2(1, 0), new Vector2(-72, 98), new Vector2(700, 22), 15, TextAnchor.LowerRight, dim * 1.6f, "GOLDFISH X12 HULL  ·  NOTIONAL MISSION FIT  ·  CONCEPT VISUALISATION");

        // the chapter card and its leader
        var card = K.Group("Card", root);
        var cardRect = K.UI("cardPanel", card.transform, new Vector2(0, 0.5f), new Vector2(72, 40), new Vector2(620, 300));
        K.Stretch("bg", cardRect, new Color(0.02f, 0.04f, 0.06f, 0.62f)); K.Box("edge", cardRect, new Vector2(0, 1), Vector2.zero, new Vector2(4, 300), AMBER).rectTransform.pivot = new Vector2(0, 1);
        var cidx = K.Label("idx", cardRect, new Vector2(0, 1), new Vector2(26, -18), new Vector2(200, 22), 16, TextAnchor.UpperLeft, dim * 2.2f);
        var cgrp = K.Label("grp", cardRect, new Vector2(0, 1), new Vector2(26, -44), new Vector2(560, 24), 18, TextAnchor.UpperLeft, AMBER);
        var ctitle = K.Label("title", cardRect, new Vector2(0, 1), new Vector2(26, -72), new Vector2(570, 44), 36, TextAnchor.UpperLeft, Color.white);
        var clist = K.Label("list", cardRect, new Vector2(0, 1), new Vector2(26, -132), new Vector2(570, 150), 20, TextAnchor.UpperLeft, TXT); clist.lineSpacing = 1.25f;
        var leader = K.Group("Leader", root);
        var line = K.Box("line", leader.transform, Vector2.zero, Vector2.zero, new Vector2(100, 2), AMBER).rectTransform; line.pivot = new Vector2(0, 0.5f);
        var dot = K.UI("dot", leader.transform, Vector2.zero, Vector2.zero, new Vector2(22, 22)); dot.pivot = new Vector2(0.5f, 0.5f);
        var ringTex = K.Save(Ring(64, 3), "Ring"); var discTex = K.Save(Disc(64), "Disc");
        Img(dot, "ring", ringTex, AMBER, new Vector2(22, 22)); Img(dot, "core", discTex, AMBER, new Vector2(8, 8));

        // sprint telemetry
        var tele = K.Group("Tele", root);
        var kn = K.Label("kn", tele.transform, new Vector2(0, 0), new Vector2(72, 170), new Vector2(240, 80), 72, TextAnchor.LowerLeft, Color.white, "0");
        K.Label("knUnit", tele.transform, new Vector2(0, 0), new Vector2(230, 182), new Vector2(80, 30), 24, TextAnchor.LowerLeft, AMBER, "KN");
        K.Label("row1", tele.transform, new Vector2(0, 0), new Vector2(72, 140), new Vector2(600, 26), 19, TextAnchor.LowerLeft, TXT, "MODE  <color=#ffc75c>ESCORT · AUTONOMOUS</color>");
        K.Label("row2", tele.transform, new Vector2(0, 0), new Vector2(72, 112), new Vector2(600, 26), 19, TextAnchor.LowerLeft, TXT, "SEA STATE  <color=#ffc75c>5</color>  ·  WIND  <color=#ffc75c>28 KN</color>");

        // engagement: steps, radar scope, target box, alert
        var steps = K.Group("Steps", root); var stepTexts = new Text[5];
        string[] names = { "DETECT", "TRACK", "IDENTIFY", "ENGAGE", "NEUTRALISED" };
        for (int i = 0; i < 5; i++) stepTexts[i] = K.Label(names[i], steps.transform, new Vector2(0.5f, 1), new Vector2((i - 2) * 190, -186), new Vector2(180, 30), 20, TextAnchor.UpperCenter, dim, names[i]);
        for (int i = 0; i < 4; i++) K.Box("sep", steps.transform, new Vector2(0.5f, 1), new Vector2((i - 1.5f) * 190, -198), new Vector2(40, 1), dim);
        var scope = K.Group("Scope", root);
        var sc = K.UI("scope", scope.transform, new Vector2(1, 0), new Vector2(-72, 150), new Vector2(300, 300));
        var centre = K.UI("centre", sc, new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero); centre.pivot = new Vector2(0.5f, 0.5f);
        Img(centre, "bg", discTex, new Color(0.02f, 0.05f, 0.07f, 0.66f), new Vector2(280, 280));
        Img(centre, "ring1", ringTex, new Color(0.5f, 0.89f, 1f, 0.25f), new Vector2(93.4f, 93.4f)); Img(centre, "ring2", ringTex, new Color(0.5f, 0.89f, 1f, 0.25f), new Vector2(186.6f, 186.6f));
        Img(centre, "ring3", ringTex, new Color(0.5f, 0.89f, 1f, 0.45f), new Vector2(280, 280));
        K.Box("h", centre, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(276, 1), new Color(0.5f, 0.89f, 1f, 0.25f)).rectTransform.pivot = new Vector2(0.5f, 0.5f);
        K.Box("v", centre, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(1, 276), new Color(0.5f, 0.89f, 1f, 0.25f)).rectTransform.pivot = new Vector2(0.5f, 0.5f);
        var sweep = Img(centre, "sweep", K.Save(Wedge(256, 0.5f), "Sweep"), new Color(0.5f, 0.89f, 1f, 1f), new Vector2(280, 280));
        var blips = new RectTransform[6]; var blipLabels = new Text[6];
        for (int i = 0; i < 6; i++) { blips[i] = Img(centre, $"blip_{i}", discTex, CYAN, new Vector2(10, 10)); blipLabels[i] = K.Label("lbl", blips[i], new Vector2(0.5f, 0.5f), new Vector2(8, 6), new Vector2(120, 18), 13, TextAnchor.LowerLeft, Color.white); blipLabels[i].rectTransform.pivot = Vector2.zero; }
        var own = K.Label("own", centre, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(30, 30), 16, TextAnchor.MiddleCenter, Color.white, "▲"); own.rectTransform.pivot = new Vector2(0.5f, 0.5f);
        K.Label("rng", sc, new Vector2(0, 0), new Vector2(22, -4), new Vector2(160, 20), 14, TextAnchor.UpperLeft, dim * 2.2f, "RNG 3 KM");
        K.Label("mode", sc, new Vector2(1, 0), new Vector2(-22, -4), new Vector2(160, 20), 14, TextAnchor.UpperRight, dim * 2.2f, "AIR · SURF");
        var boxG = K.Group("TargetBox", root);
        var box = K.UI("box", boxG.transform, Vector2.zero, Vector2.zero, new Vector2(64, 64)); box.pivot = new Vector2(0.5f, 0.5f); K.Brackets(box, CYAN, 16, 2);
        var boxl = K.Label("boxl", box, new Vector2(0, 0), new Vector2(0, -8), new Vector2(420, 44), 17, TextAnchor.UpperLeft, CYAN); boxl.rectTransform.pivot = new Vector2(0, 1);
        var alert = K.Group("Alert", root);
        var ar = K.UI("alertPanel", alert.transform, new Vector2(1, 1), new Vector2(-72, -196), new Vector2(480, 110));
        K.Stretch("bg", ar, new Color(0.02f, 0.04f, 0.06f, 0.66f));
        var alertT = K.Label("t", ar, new Vector2(0, 1), new Vector2(20, -14), new Vector2(440, 30), 26, TextAnchor.UpperLeft, AMBER, "AIR CONTACT");
        var alertB = K.Label("b", ar, new Vector2(0, 1), new Vector2(20, -52), new Vector2(440, 56), 17, TextAnchor.UpperLeft, TXT);

        // EO/IR overlay over the gimbal's view
        var eoir = K.Group("EoirOverlay", root); var eo = eoir.transform; Color eoC = new Color(1, 1, 1, 0.85f);
        { var c = K.UI("c", eo, new Vector2(0.5f, 0.5f), Vector2.zero, Vector2.zero); c.pivot = new Vector2(0.5f, 0.5f); Img(c, "circle", ringTex, eoC, new Vector2(56, 56)); }
        K.Box("l1", eo, new Vector2(0.5f, 1), Vector2.zero, new Vector2(1.5f, 1080 * 0.44f), eoC); K.Box("l2", eo, new Vector2(0.5f, 0), Vector2.zero, new Vector2(1.5f, 1080 * 0.44f), eoC);
        K.Box("l3", eo, new Vector2(0, 0.5f), Vector2.zero, new Vector2(1920 * 0.45f, 1.5f), eoC); K.Box("l4", eo, new Vector2(1, 0.5f), Vector2.zero, new Vector2(1920 * 0.45f, 1.5f), eoC);
        K.Label("tl", eo, new Vector2(0, 1), new Vector2(80, -100), new Vector2(500, 60), 18, TextAnchor.UpperLeft, Color.white, "EO/IR · MWIR · WHT HOT\nFOV 0.8° · STAB ON");
        var eoirR = K.Label("tr", eo, new Vector2(1, 1), new Vector2(-80, -100), new Vector2(400, 80), 18, TextAnchor.UpperRight, Color.white, "TRK 07");
        K.Label("bl", eo, new Vector2(0, 0), new Vector2(80, 100), new Vector2(500, 30), 18, TextAnchor.LowerLeft, Color.white, "AUTO-TRACK · LOCKED");
        var eoirC = K.Label("cls", eo, new Vector2(0.5f, 0), new Vector2(0, 150), new Vector2(900, 34), 22, TextAnchor.LowerCenter, Color.white, "CLASSIFIED · ONE-WAY ATTACK UAS · 97 %");

        // titles
        CanvasGroup TitleCard(string name, string p, string small)
        {
            var g = K.Group(name, root); var tt = g.transform;
            if (small != null) K.Stretch("dim", tt, new Color(0, 0, 0, 0.5f));
            K.Label("kicker", tt, new Vector2(0.5f, 0.5f), new Vector2(0, 104), new Vector2(1600, 30), 22, TextAnchor.MiddleCenter, AMBER, K.Spaced("UNCREWED SURFACE VESSEL"));
            K.Label("h1", tt, new Vector2(0.5f, 0.5f), new Vector2(0, 40), new Vector2(1600, 110), 96, TextAnchor.MiddleCenter, Color.white, "X-12 AUTONOMOUS");
            K.Box("rule", tt, new Vector2(0.5f, 0.5f), new Vector2(0, -26), new Vector2(520, 2), new Color(1, 1, 1, 0.6f));
            K.Label("p", tt, new Vector2(0.5f, 0.5f), new Vector2(0, -66), new Vector2(1600, 40), 28, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.88f), p);
            if (small != null) K.Label("small", tt, new Vector2(0.5f, 0.5f), new Vector2(0, -120), new Vector2(1600, 30), 18, TextAnchor.MiddleCenter, new Color(1, 1, 1, 0.6f), small);
            return g;
        }
        var intro = TitleCard("Intro", "Persistent sensing and defence for the High North", null);
        var endG = TitleCard("End", "DETECT · DECIDE · DEFEND", "Goldfish X12 hull · notional mission fit · concept visualisation");
        var fade = K.Group("Fade", root); K.Stretch("black", fade.transform, Color.black);

        // ---------------------------------------------------------------- director
        var dir = new GameObject("X12Director").AddComponent<X12Director>();
        dir.boat = boat; dir.navRadar = parts["Navigation radar"]; dir.navCentre = navB.center; dir.gimbal = parts["EO/IR gimbal"];
        dir.launcherPort = parts["Air defence launcher (port)"]; dir.launcherStbd = parts["Air defence launcher (starboard)"]; dir.launcherBase = launcherBase;
        dir.highlights = highlights; dir.beam = beam;
        dir.ships = ships; dir.drone = drone; dir.droneDisc = discPivot; dir.droneRenderers = drone.GetComponentsInChildren<Renderer>(); dir.missile = missile; dir.debris = debris;
        dir.spray = spray; dir.smoke = smoke; dir.fire = fire; dir.cam = cam; dir.eoCam = eoCam;
        dir.canvasRect = root; dir.fadeG = fade; dir.intro = intro; dir.card = card; dir.leader = leader; dir.tele = tele; dir.steps = steps; dir.scope = scope; dir.boxG = boxG; dir.alert = alert; dir.eoir = eoir; dir.endG = endG; dir.hud = hud;
        dir.cidx = cidx; dir.cgrp = cgrp; dir.ctitle = ctitle; dir.clist = clist; dir.kn = kn; dir.alertT = alertT; dir.alertB = alertB; dir.boxl = boxl; dir.eoirR = eoirR; dir.eoirC = eoirC; dir.clock = clock; dir.phaseText = phase;
        dir.stepTexts = stepTexts; dir.cardRect = cardRect; dir.leaderLine = line; dir.leaderDot = dot; dir.box = box; dir.sweep = sweep; dir.blips = blips; dir.blipLabels = blipLabels; dir.eoImage = eoImage;
        dir.time = 15f; dir.Evaluate(15f);

        K.EnsureFolder("Assets/Scenes");
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/X12.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/X12.unity", true) };
        K.BakeEnvironment(); EditorSceneManager.SaveScene(scene);
        K.Flush();
        return $"built X12: film {dir.FilmEnd} s, intercept at {I_PT}, {highlights.Count} highlight renderers";
    }

    // ---------------------------------------------------------------- terrain: the film's height function, baked with colour and sun visibility
    static Mesh Terrain()
    {
        float x0 = -7200, x1 = 6800, z0 = -6200, z1 = 6200, step = 20;
        int nx = Mathf.RoundToInt((x1 - x0) / step) + 1, nz = Mathf.RoundToInt((z1 - z0) / step) + 1;
        var H = new float[nx * nz];
        for (int j = 0; j < nz; j++) for (int i = 0; i < nx; i++) H[j * nx + i] = TerrainH(x0 + i * step, z0 + j * step);
        float HAt(float x, float z)
        {
            float fi = Clamp((x - x0) / step, 0, nx - 1.001f), fj = Clamp((z - z0) / step, 0, nz - 1.001f); int i = (int)fi, j = (int)fj; float u = fi - i, v = fj - j;
            return Mix(Mix(H[j * nx + i], H[j * nx + i + 1], u), Mix(H[(j + 1) * nx + i], H[(j + 1) * nx + i + 1], u), v);
        }
        var SUN = X12Director.SunDir; float sh = Mathf.Sqrt(SUN.x * SUN.x + SUN.z * SUN.z), sx = SUN.x / sh, sz = SUN.z / sh, tanE = SUN.y / sh;
        var pos = new Vector3[nx * nz]; var col = new Color[nx * nz];
        for (int j = 0; j < nz; j++) for (int i = 0; i < nx; i++)
        {
            int k = j * nx + i; float x = x0 + i * step, z = z0 + j * step, h = H[k];
            pos[k] = U(new Vector3(x, h, z));
            // sun visibility: march toward the sun over the height grid, soft at the shadow's edge
            float m = 1e9f;
            if (h > -5) for (float d = 30; d < 5000; d *= 1.06f) { float ry = h + 2 + d * tanE; if (ry > 1700) break; m = Mathf.Min(m, ry - HAt(x + sx * d, z + sz * d)); if (m < -40) break; }
            float vis = SStep(-30, 20, m);
            float gx = (H[j * nx + Mathf.Min(i + 1, nx - 1)] - H[j * nx + Mathf.Max(i - 1, 0)]) / (2 * step), gz = (H[Mathf.Min(j + 1, nz - 1) * nx + i] - H[Mathf.Max(j - 1, 0) * nx + i]) / (2 * step);
            float ny = 1 / Mathf.Sqrt(gx * gx + gz * gz + 1), n1 = Fbm(x / 300, z / 300, 4), n2 = Fbm(x / 60, z / 60, 3);
            float veg = (1 - SStep(120 + 70 * n1, 300, h)) * SStep(0.6f, 0.8f, ny), forest = veg * (1 - SStep(40, 160 + 40 * n2, h)) * SStep(0f, 0.3f, n1 + 0.2f);
            float t = 0.8f + 0.35f * n2, r = 0.034f * t, g = 0.036f * t, b = 0.04f * t;
            r = Mix(r, 0.036f * t, veg); g = Mix(g, 0.037f * t, veg); b = Mix(b, 0.026f * t, veg);
            r = Mix(r, 0.016f, forest); g = Mix(g, 0.027f, forest); b = Mix(b, 0.013f, forest);
            if (h < 7) { float wet = 1 - SStep(1, 7, h); r = Mix(r, 0.022f, wet); g = Mix(g, 0.024f, wet); b = Mix(b, 0.022f, wet); }
            // the film's per-pixel rock tone and snow line, at vertex resolution
            float r2 = 1 - Mathf.Abs(Noise2(x * 0.035f + 3, z * 0.035f + 3)), nn = Noise2(x * 0.004f, z * 0.004f) * 0.6f + Noise2(x * 0.02f, z * 0.02f) * 0.3f;
            float tone = 0.75f + 0.4f * Mix(r2, 0.6f, 0.5f); r *= tone; g *= tone; b *= tone;
            float line = 240 + 130 * nn, snow = SStep(line - 70, line + 50, h) * SStep(0.52f, 0.72f, ny + 0.06f * r2);
            snow = Mathf.Max(snow, SStep(130, 240, h) * SStep(0.8f, 0.9f, ny) * SStep(0f, 0.35f, nn + 0.25f));
            snow *= 1 - 0.35f * SStep(0.6f, 1f, r2) * 0.5f;
            float sa = Clamp(snow, 0, 1), sc = 0.92f + 0.08f * r2; r = Mix(r, 0.78f * sc, sa); g = Mix(g, 0.81f * sc, sa); b = Mix(b, 0.86f * sc, sa);
            float lit = Mix(0.38f, 1f, vis);
            col[k] = new Color(r * lit, g * lit, b * lit, 1);
        }
        var idx = new int[(nx - 1) * (nz - 1) * 6]; int n = 0;
        for (int j = 0; j < nz - 1; j++) for (int i = 0; i < nx - 1; i++) { int a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = b; idx[n++] = d; idx[n++] = c; }
        var mesh = new Mesh { name = "Fjord", indexFormat = IndexFormat.UInt32 }; mesh.vertices = pos; mesh.colors = col; mesh.triangles = idx; mesh.RecalculateNormals(); mesh.RecalculateBounds();
        return mesh;
    }
    static Mesh Ranges()
    {
        int segs = 360, rings = 6; var r = new Rng(9); var ph = new float[6]; for (int i = 0; i < 6; i++) ph[i] = r.Next() * 6.28f;
        var v = new List<Vector3>(); var idx = new List<int>();
        for (int j = 0; j <= rings; j++) for (int i = 0; i <= segs; i++)
        {
            float a = i / (float)segs * Mathf.PI * 2, u = j / (float)rings, rad = Mix(7600, 13000, u), west = SStep(0.35f, 0.8f, -Mathf.Cos(a));
            float hh = (500 + 380 * Mathf.Sin(3 * a + ph[0]) * Mathf.Sin(7 * a + ph[1]) + 220 * Mathf.Sin(13 * a + ph[2]) + 90 * Mathf.Sin(29 * a + ph[3])) * Mathf.Sin(Mathf.PI * Mathf.Min(1, u * 1.4f)) * (1 - 0.9f * west);
            v.Add(U(new Vector3(Mathf.Cos(a) * rad, Mathf.Max(-20, hh), Mathf.Sin(a) * rad)));
        }
        for (int j = 0; j < rings; j++) for (int i = 0; i < segs; i++) { int a = j * (segs + 1) + i, b = a + segs + 1; idx.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b }); }
        var m = new Mesh { name = "Ranges", indexFormat = IndexFormat.UInt32 }; m.SetVertices(v); m.SetTriangles(idx, 0); m.RecalculateNormals(); return m;
    }
    static Mesh SeaGrid()
    {
        // offsets round the camera in the film frame; the shader adds the camera position and the swell
        int rings = 300, segs = 512; var v = new Vector3[(rings + 1) * (segs + 1)]; var idx = new List<int>((rings) * segs * 6);
        for (int j = 0; j <= rings; j++) { float r = 0.34f * (Mathf.Pow(1.0345f, j) - 1); for (int i = 0; i <= segs; i++) { float a = i / (float)segs * 2 * Mathf.PI; v[j * (segs + 1) + i] = new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r); } }
        for (int j = 0; j < rings; j++) for (int i = 0; i < segs; i++) { int a = j * (segs + 1) + i, b = a + segs + 1; idx.AddRange(new[] { a, a + 1, b, a + 1, b + 1, b }); }
        var m = new Mesh { name = "SeaGrid", indexFormat = IndexFormat.UInt32 }; m.vertices = v; m.SetTriangles(idx, 0);
        m.bounds = new Bounds(Vector3.zero, Vector3.one * 100000f); return m;
    }

    // ---------------------------------------------------------------- escort ships, from boxes and an extruded hull
    static Transform Ship(Ship s)
    {
        var g = new GameObject("ship_" + s.kind).transform; float L = s.L, Bm = s.B;
        int[] cols = s.kind == "cargo" ? new[] { 0x5b1c16, 0xe9e7e1 } : s.kind == "patrol" ? new[] { 0x59626a, 0x8d969c } : new[] { 0x1f416f, 0xeceae4 };
        var hullM = K.Lit($"{s.kind}Hull", K.Hex(cols[0]), 0.4f, 0.1f); var supM = K.Lit($"{s.kind}Super", K.Hex(cols[1]), 0.45f, 0.1f); var dark = K.Lit($"{s.kind}Dark", K.Hex(0x1b1d20), 0.4f, 0f);
        float free = s.kind == "cargo" ? 6 : 4.2f, draft = s.kind == "cargo" ? 5 : 3, deck = free;
        // hull outline (x along the ship, y across), extruded from -draft to +free
        var outline = new List<Vector2> { new Vector2(-L / 2, -Bm / 2 * 0.86f), new Vector2(L * 0.18f, -Bm / 2) };
        for (int i = 1; i <= 12; i++) { float u = i / 12f; outline.Add(Q(new Vector2(L * 0.18f, -Bm / 2), new Vector2(L * 0.42f, -Bm / 2), new Vector2(L / 2, 0), u)); }
        for (int i = 1; i <= 12; i++) { float u = i / 12f; outline.Add(Q(new Vector2(L / 2, 0), new Vector2(L * 0.42f, Bm / 2), new Vector2(L * 0.18f, Bm / 2), u)); }
        outline.Add(new Vector2(-L / 2, Bm / 2 * 0.86f));
        K.MeshObject("hull", g, K.Save(Extrude(outline, -draft, free), $"Hull_{s.kind}"), hullM, false);
        void Box(float w, float hgt, float d, float x, float y, float z, Material m, float rotZ = 0) => Part(g, PrimitiveType.Cube, V(x, y + hgt / 2, z), AxisAngle(Vector3.forward, rotZ), V(w, hgt, d), m, false);
        if (s.kind == "cargo")
        {
            Box(14, 9, Bm * 0.9f, -L / 2 + 9, deck, 0, supM); Box(10, 3, Bm * 1.05f, -L / 2 + 9, deck + 9, 0, supM); Box(2.6f, 6, 2.6f, -L / 2 + 4, deck + 9, 0, dark);
            int[] cc = { 0x8c2b22, 0x24466e, 0x3e6b3a, 0xb0802a, 0x6b6e71 };
            for (int i = 0; i < 6; i++) for (int k = 0; k < 2; k++) Box(6.1f, 2.6f, Bm * 0.8f, -L / 2 + 22 + i * 7.4f, deck + k * 2.6f, 0, K.Lit($"Box{(i * 3 + k) % 5}", K.Hex(cc[(i * 3 + k) % 5]), 0.3f, 0f));
        }
        else if (s.kind == "patrol")
        {
            Box(L * 0.32f, 5, Bm * 0.8f, L * 0.02f, deck, 0, supM); Box(L * 0.16f, 2.8f, Bm * 0.7f, L * 0.08f, deck + 5, 0, supM);
            Box(1.2f, 10, 1.2f, L * 0.02f, deck + 7.8f, 0, dark); Part(g, PrimitiveType.Sphere, V(L * 0.02f, deck + 18.4f, 0), Quaternion.identity, Vector3.one * 2.6f, supM, false);
            Box(3, 1.6f, 3, L * 0.3f, deck, 0, supM); Part(g, PrimitiveType.Cylinder, V(L * 0.3f + 3, deck + 1.1f, 0), AxisAngle(Vector3.forward, Mathf.PI / 2), V(0.3f, 2.25f, 0.3f), dark, false);
        }
        else
        {
            Box(L * 0.3f, 7, Bm * 0.92f, L * 0.22f, deck, 0, supM); Box(L * 0.2f, 2.5f, Bm, L * 0.24f, deck + 7, 0, supM); Box(1, 8, 1, L * 0.24f, deck + 9.5f, 0, dark);
            Box(1.2f, 12, 1.2f, -L * 0.25f, deck, 0, K.Lit("Crane", K.Hex(0xc9a227), 0.4f, 0f), 0.5f);
        }
        return g;
    }
    static Vector2 Q(Vector2 a, Vector2 c, Vector2 b, float u) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;
    static Mesh Extrude(List<Vector2> o, float y0, float y1)
    {
        // outline (x, across) -> film frame (x, y, -across), as THREE.ExtrudeGeometry turned upright; sides, deck and keel
        var v = new List<Vector3>(); var t = new List<int>(); int n = o.Count;
        Vector3 P(Vector2 p, float y) => U(new Vector3(p.x, y, -p.y));
        for (int i = 0; i < n; i++) { var a = o[i]; var b = o[(i + 1) % n]; int k = v.Count; v.AddRange(new[] { P(a, y0), P(b, y0), P(b, y1), P(a, y1) }); t.AddRange(new[] { k, k + 1, k + 2, k, k + 2, k + 3 }); }
        Vector2 c = Vector2.zero; foreach (var p in o) c += p; c /= n;
        foreach (var y in new[] { y0, y1 }) { int ci = v.Count; v.Add(P(c, y)); int s = v.Count; foreach (var p in o) v.Add(P(p, y)); for (int i = 0; i < n; i++) { t.AddRange(new[] { ci, s + i, s + (i + 1) % n }); } }
        // double-sided with its own vertices for the back faces: shared vertices would average the normals to zero (NaN shading)
        int nv = v.Count, nt = t.Count; v.AddRange(v.GetRange(0, nv)); for (int i = 0; i < nt; i += 3) t.AddRange(new[] { t[i] + nv, t[i + 2] + nv, t[i + 1] + nv });
        var m = new Mesh { name = "Hull", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 }; m.SetVertices(v); m.SetTriangles(t, 0); m.RecalculateNormals(); return m;
    }

    // ---------------------------------------------------------------- small helpers
    /// <summary>A primitive as a child, placed in the parent's film frame.</summary>
    static Transform Part(Transform parent, PrimitiveType type, Vector3 p, Quaternion q, Vector3 scale, Material m, bool shadows = true)
    {
        var go = GameObject.CreatePrimitive(type); Object.DestroyImmediate(go.GetComponent<Collider>()); go.transform.SetParent(parent, false);
        go.transform.localPosition = U(p); go.transform.localRotation = U(q); go.transform.localScale = scale;
        var r = go.GetComponent<MeshRenderer>(); r.sharedMaterial = m; r.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off; return go.transform;
    }
    static Mesh Flat(Vector3[] poly, float y)
    {
        var v = new List<Vector3>(); var t = new List<int>(); foreach (var p in poly) v.Add(U(new Vector3(p.x, y, p.z)));
        for (int i = 1; i < poly.Length - 1; i++) t.AddRange(new[] { 0, i, i + 1 });
        int nv = v.Count, nt = t.Count; v.AddRange(v.GetRange(0, nv)); for (int i = 0; i < nt; i += 3) t.AddRange(new[] { t[i] + nv, t[i + 2] + nv, t[i + 1] + nv });
        var m = new Mesh { name = "Flat" }; m.SetVertices(v); m.SetTriangles(t, 0); m.RecalculateNormals(); return m;
    }
    static RectTransform Img(RectTransform parent, string name, Texture2D tex, Color c, Vector2 size)
    {
        var rt = K.UI(name, parent, new Vector2(0.5f, 0.5f), Vector2.zero, size); rt.pivot = new Vector2(0.5f, 0.5f);
        var ri = rt.gameObject.AddComponent<RawImage>(); ri.texture = tex; ri.color = c; ri.raycastTarget = false;
        return rt;
    }
    static Texture2D Ring(int N, float w)
    {
        var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = "Ring", wrapMode = TextureWrapMode.Clamp }; float R = N / 2f - 1;
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) { float d = Mathf.Abs(new Vector2(x + 0.5f - N / 2f, y + 0.5f - N / 2f).magnitude - (R - w / 2)); t.SetPixel(x, y, new Color(1, 1, 1, Clamp(w / 2 + 0.5f - d, 0, 1))); }
        t.Apply(); return t;
    }
    static Texture2D Disc(int N)
    {
        var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = "Disc", wrapMode = TextureWrapMode.Clamp }; float R = N / 2f - 1;
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) { float d = new Vector2(x + 0.5f - N / 2f, y + 0.5f - N / 2f).magnitude; t.SetPixel(x, y, new Color(1, 1, 1, Clamp(R - d + 0.5f, 0, 1))); }
        t.Apply(); return t;
    }
    static Texture2D Wedge(int N, float span)
    {
        // the radar sweep: alpha rising across `span` radians counter-clockwise of straight up, up to the leading edge
        var t = new Texture2D(N, N, TextureFormat.RGBA32, true) { name = "Sweep", wrapMode = TextureWrapMode.Clamp }; float R = N / 2f - 1;
        for (int y = 0; y < N; y++) for (int x = 0; x < N; x++)
        {
            float dx = x + 0.5f - N / 2f, dy = y + 0.5f - N / 2f, r = Mathf.Sqrt(dx * dx + dy * dy), a = Mathf.Atan2(dx, dy);   // 0 = up, clockwise positive
            float al = (r <= R && a <= 0 && a >= -span) ? 0.35f * (1 - (-a / span)) * Clamp(r / R * 1.2f, 0, 1) : 0f;
            t.SetPixel(x, y, new Color(1, 1, 1, al));
        }
        t.Apply(); return t;
    }
}
