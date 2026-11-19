// X-12 Autonomous, game cut: the uncrewed X-12 runs down a northern Norwegian fjord in rough seas, a camera tour of its
// hull and mission fit, a sprint toward an escort group, and the detection and interception of a one-way attack drone.
// A port of site/src/x12/main.js (same numbers, seeds, camera moves and overlays) with game-HUD chrome. All maths in
// the film's frame (X12World); converted when a Transform is posed.
using System.Collections.Generic;
using AnimationStudio.Film;
using UnityEngine;
using UnityEngine.UI;
using static AnimationStudio.Film.F;
using static X12World;

[System.Serializable] public class Highlight { public string group; public Renderer r; }

[ExecuteAlways]
public class X12Director : FilmDirector
{
    public override string OutputName => "x12-game";
    public override float FilmEnd => DUR;

    [Header("Boat")]
    public Transform boat;
    public Transform navRadar, gimbal, launcherPort, launcherStbd;
    public Vector3 navCentre;                 // glb frame
    public float launcherBase;                // y of the launchers' feet
    public List<Highlight> highlights = new List<Highlight>();
    public float[] beam = new float[128];
    [Header("World")]
    public Transform[] ships;
    public Transform drone, droneDisc, missile; public Renderer[] droneRenderers;
    public Transform[] debris;
    public PointCloud spray, smoke, fire;
    [Header("Camera")]
    public Camera cam, eoCam;
    [Header("HUD")]
    public RectTransform canvasRect;
    public CanvasGroup fadeG, intro, card, leader, tele, steps, scope, boxG, alert, eoir, endG, hud;
    public Text cidx, cgrp, ctitle, clist, kn, alertT, alertB, boxl, eoirR, eoirC, clock, phaseText;
    public Text[] stepTexts;
    public RectTransform cardRect, leaderLine, leaderDot, box, sweep;
    public RectTransform[] blips; public Text[] blipLabels;
    public RawImage eoImage;

    // ---------------------------------------------------------------- the camera tour and its chapters
    static readonly float[][] TOUR = {
        new[] { 13.0f, 7.5f, 1.9f, 9.5f, 0.2f, 0.3f, 0, 40 }, new[] { 15.6f, -1.5f, 1.7f, 8.2f, -0.8f, 0.25f, 0, 40 },
        new[] { 18.0f, -11.5f, 1.8f, 4.8f, -5.8f, 0.45f, 0, 34 }, new[] { 20.6f, -10.8f, 2.6f, -2.8f, -5.8f, 0.45f, 0, 32 },
        new[] { 22.8f, 2.8f, 3.8f, 6.2f, -0.7f, 2.35f, 0, 34 }, new[] { 25.1f, -4.0f, 4.1f, 5.6f, -0.7f, 2.5f, 0, 32 },
        new[] { 27.4f, 0.9f, 3.6f, 2.8f, -0.7f, 2.6f, 0, 34 }, new[] { 29.8f, 7.8f, 2.9f, 2.9f, 4.1f, 0.9f, 0, 36 },
        new[] { 32.0f, 2.4f, 1.65f, 1.9f, 0, 1.3f, 0, 30 }, new[] { 34.2f, 2.0f, 1.25f, -1.7f, 0, 1.3f, 0, 30 },
        new[] { 36.4f, -0.8f, 2.4f, -4.0f, -1.2f, 0.85f, 0, 36 }, new[] { 38.8f, -3.4f, 3.3f, -3.2f, -1.2f, 1.5f, 0, 38 },
        new[] { 41.0f, -2.0f, 2.9f, 3.6f, -3.9f, 1.1f, 0, 34 }, new[] { 43.6f, -7.2f, 2.7f, 2.6f, -3.9f, 1.2f, 0, 34 },
        new[] { 46.0f, -15f, 2.6f, 4.0f, -1, 1.0f, 0, 40 },
    };
    public struct Chapter { public float t, end; public string g, grp, title; public Vector3 anchor; public float a2t; public Vector3 anchor2; public string[] lines; }
    public static readonly Chapter[] CHAPTERS = {
        new Chapter { t = 13.0f, end = 18.0f, g = "hull", grp = "Hull and decks", title = "Goldfish X12 hull", anchor = V(2.2f, 0.35f, 1.55f),
            lines = new[] { "Four-step deep-V planing hull", "GRP/CRP vacuum-infused sandwich", "12.45 m LOA · 3.6 m beam · Category B offshore", "Non-skid deck in place of the crewed hardtop and seats" } },
        new Chapter { t = 18.0f, end = 22.8f, g = "prop", grp = "Propulsion", title = "Triple 500 hp outboards", anchor = V(-6.0f, 0.9f, 0.75f),
            lines = new[] { "Supercharged V8s, 1,500 hp combined", "Sprint at 45 kn, on a hull proven beyond 50", "1,000 l fuel for long patrols" } },
        new Chapter { t = 22.8f, end = 27.4f, g = "mast", grp = "Sensor mast", title = "360° radar coverage", anchor = V(-0.3f, 2.3f, 0.35f),
            lines = new[] { "Four fixed phased-array faces for air and surface search", "Rotating navigation radar for collision avoidance", "Faceted, radar-absorbent composite mast" } },
        new Chapter { t = 27.4f, end = 32.0f, g = "percep", grp = "Perception", title = "Lidar and panoramic vision", anchor = V(-0.36f, 2.88f, 0.07f), a2t = 29.0f, anchor2 = V(4.4f, 0.88f, 0.0f),
            lines = new[] { "Mast-head 360° lidar and four corner solid-state units", "Four day / low-light cameras for the remote operator", "Bow pod: forward lidar and camera for close quarters" } },
        new Chapter { t = 32.0f, end = 36.4f, g = "eoir", grp = "Identification", title = "Stabilised EO/IR turret", anchor = V(0.12f, 1.29f, 0),
            lines = new[] { "Electro-optical and infrared imaging", "Holds a track through sea state and spray", "Confirms what the radar has found" } },
        new Chapter { t = 36.4f, end = 41.0f, g = "auto", grp = "Autonomy and links", title = "Mission electronics bay", anchor = V(-1.62f, 0.85f, 0),
            lines = new[] { "Autonomy computers, power and networking", "SATCOM for beyond-line-of-sight command and video", "VHF / AIS, mesh datalink and dual GNSS heading" } },
        new Chapter { t = 41.0f, end = 46.0f, g = "ad", grp = "Air defence", title = "Two trainable launchers", anchor = V(-4.0f, 1.45f, 0.55f),
            lines = new[] { "Eight ready short-range interceptors", "Cued directly by the surveillance radar", "Human authorisation in the loop for every engagement" } },
    };
    public static readonly Dictionary<string, string[]> GROUPS = new Dictionary<string, string[]>
    {
        ["hull"] = new[] { "Hull", "Tube collar", "Foredeck", "Aft deck", "Cockpit" },
        ["prop"] = new[] { "Outboard (port)", "Outboard (centre)", "Outboard (starboard)", "Engine bracket" },
        ["mast"] = new[] { "Sensor mast", "Surveillance radar arrays", "Navigation radar" },
        ["percep"] = new[] { "Lidar units", "Panoramic cameras", "Bow sensor pod" },
        ["eoir"] = new[] { "EO/IR gimbal" },
        ["auto"] = new[] { "Mission electronics bay", "SATCOM terminal", "Comms and GNSS antennas" },
        ["ad"] = new[] { "Launcher deck", "Air defence launcher (port)", "Air defence launcher (starboard)" },
    };

    // ---------------------------------------------------------------- launchers, radar, gimbal
    const float LH = 0.72f, EL = 20f * DEG;
    static Vector3 LRoot(int sz, float b) => new Vector3(-4.0f, b, sz * 0.55f);
    static float Train0(int sz) => -sz * 15f * DEG;
    static float AngLerp(float a, float b, float u) { float d = b - a; while (d > Mathf.PI) d -= 2 * Mathf.PI; while (d < -Mathf.PI) d += 2 * Mathf.PI; return a + d * u; }
    static void AimAt(in Boat S, Vector3 root, Vector3 target, float loft, out float th, out float el)
    {
        Vector3 lp = S.m.inverse.MultiplyPoint3x4(target) - root;
        th = Mathf.Atan2(-lp.z, lp.x); el = Mathf.Atan2(lp.y, new Vector2(lp.x, lp.z).magnitude) + loft;
    }
    static Matrix4x4 R(Vector3 axis, float a) => Matrix4x4.Rotate(AxisAngle(axis, a));
    static Matrix4x4 T(Vector3 p) => Matrix4x4.Translate(p);
    /// <summary>A model-frame transform (film frame) as the local transform of a node under the GLB's Body.</summary>
    static void SetGlbLocal(Transform node, Matrix4x4 m)
    {
        Vector3 p = m.GetColumn(3); Quaternion q = m.rotation;
        node.localPosition = new Vector3(-p.x, p.y, p.z); node.localRotation = new Quaternion(q.x, -q.y, -q.z, q.w);
    }
    void Launcher(Transform node, int sz, float train, float el)
    {
        if (!node) return; var root = LRoot(sz, launcherBase);
        SetGlbLocal(node, T(root) * R(Vector3.up, train) * T(new Vector3(0, LH, 0)) * R(Vector3.forward, el - EL) * T(new Vector3(0, -LH, 0)) * R(Vector3.up, -Train0(sz)) * T(-root));
    }
    void PoseRig(float w, in Boat S)
    {
        if (navRadar) SetGlbLocal(navRadar, T(new Vector3(-navCentre.x, 0, navCentre.z)) * R(Vector3.up, -w * 2 * Mathf.PI / 2.5f) * T(new Vector3(navCentre.x, 0, -navCentre.z)));
        {
            AimAt(S, LRoot(-1, launcherBase), I_PT, 9 * DEG, out var th, out var el); float u = Ease((w - 56.2f) / 3.4f) * (1 - Ease((w - 70) / 3));
            Launcher(launcherPort, -1, AngLerp(Train0(-1), th, u), Mix(EL, el, u));
            AimAt(S, LRoot(1, launcherBase), I_PT, 9 * DEG, out var th2, out var el2); float u2 = Ease((w - 57) / 3.4f) * (1 - Ease((w - 69) / 3)) * 0.6f;
            Launcher(launcherStbd, 1, AngLerp(Train0(1), th2, u2), Mix(EL, el2, u2));
        }
        if (gimbal)
        {
            Vector3 C = new Vector3(0, 1.29f, 0), tgt = S.m.inverse.MultiplyPoint3x4(w < 64.9f ? DroneAt(w) : I_PT) - C;
            float scan = 0.9f * Mathf.Sin(w * 0.35f), track = SStep(T_DET - 0.6f, T_TRK, w);
            float yaw = AngLerp(scan, Mathf.Atan2(-tgt.z, tgt.x), track), tilt = Mix(-0.08f + 0.05f * Mathf.Sin(w * 0.5f), Mathf.Atan2(tgt.y, new Vector2(tgt.x, tgt.z).magnitude), track);
            SetGlbLocal(gimbal, T(C) * R(Vector3.up, yaw) * R(Vector3.forward, tilt) * T(-C));
        }
    }

    // ---------------------------------------------------------------- the interceptor
    struct Msl { public Vector3 p0, p1, p2, back, d0; }
    Msl? msl;
    Msl Launch
    {
        get
        {
            if (msl.HasValue) return msl.Value;
            var B = BoatAt(T_L); var root = LRoot(-1, launcherBase);
            AimAt(B, root, I_PT, 9 * DEG, out var th, out var el); float u = Ease((T_L - 56.2f) / 3.4f) * (1 - Ease((T_L - 70) / 3));
            Matrix4x4 elev = B.m * T(root) * R(Vector3.up, AngLerp(Train0(-1), th, u)) * T(new Vector3(0, LH, 0)) * R(Vector3.forward, Mix(EL, el, u));
            var m = new Msl { p0 = elev.MultiplyPoint3x4(new Vector3(0.95f, 0.08f, -0.08f)), back = elev.MultiplyPoint3x4(new Vector3(-0.75f, 0.08f, -0.08f)) };
            m.d0 = (m.p0 - m.back).normalized; float dist = Vector3.Distance(m.p0, I_PT);
            m.p1 = m.p0 + m.d0 * (dist * 0.35f); m.p2 = Vector3.Lerp(m.p1, I_PT, 0.62f) + new Vector3(0, dist * 0.05f, 0);
            msl = m; return m;
        }
    }
    const float MSL_T = T_I - T_L;
    Vector3 MissileAt(float tau)
    {
        var M = Launch; float x = Clamp(tau / MSL_T, 0, 1), u = 0.05f * x + 0.95f * Mathf.Pow(x, 1.45f), v = 1 - u;
        return M.p0 * (v * v * v) + M.p1 * (3 * v * v * u) + M.p2 * (3 * v * u * u) + I_PT * (u * u * u);
    }
    static Quaternion LookQ(Vector3 from, Vector3 to, float pitchJitter = 0f)
    {
        Vector3 z = (to - from).normalized, x = Vector3.Cross(Vector3.up, z).normalized, y = Vector3.Cross(z, x);
        return Basis(x, y, z) * AxisAngle(Vector3.up, -Mathf.PI / 2) * AxisAngle(Vector3.right, pitchJitter);
    }

    // ---------------------------------------------------------------- debris
    public struct Piece { public Vector3 size, v, spin; public float w, drag, splash; public bool fire; public Vector3 splashP; }
    static Piece[] pieces;
    public static Piece[] Debris()
    {
        if (pieces != null) return pieces;
        var r = new Rng(71); pieces = new Piece[18];
        for (int i = 0; i < 18; i++)
        {
            var s = i < 3 ? new Vector3(0.9f, 0.05f, 0.6f) : new Vector3(0.12f + r.Next() * 0.35f, 0.04f + r.Next() * 0.12f, 0.1f + r.Next() * 0.3f);
            float az = r.Next() * 6.283f, el = (r.Next() - 0.3f) * 1.4f, sp = 6 + r.Next() * 20;
            var p = new Piece { size = s, v = new Vector3(Mathf.Cos(az) * Mathf.Cos(el) * sp, Mathf.Sin(el) * sp + 4, Mathf.Sin(az) * Mathf.Cos(el) * sp) + DIR_IN * (VD * 0.45f) };
            p.spin = new Vector3(r.Next() - 0.5f, r.Next() - 0.5f, r.Next() - 0.5f).normalized; p.w = 4 + r.Next() * 14; p.drag = 0.25f + r.Next() * 0.6f; p.fire = i < 5;
            float a = 0; for (; a < 8; a += 0.01f) if (!DebrisAt(p, a, out _)) break;
            p.splash = a; DebrisAt(p, a, out p.splashP); pieces[i] = p;
        }
        return pieces;
    }
    static bool DebrisAt(in Piece d, float a, out Vector3 o)
    {
        float k = d.drag, tr = (1 - Mathf.Exp(-k * a)) / k;
        o = I_PT + d.v * tr; o.y -= 0.5f * G * a * a * 0.92f;
        return o.y > SeaH(o.x, o.z, T_I + a) - 0.2f;
    }

    // ---------------------------------------------------------------- spray, smoke and fire, rebuilt from the clock
    struct Sp { public bool bow; public float life, ph; public float s0, s1, s2, s3, s4; }
    static Sp[] SPRAY; static Vector4[] SMOKE; static int[] SMOKE_KIND;
    static readonly Vector3 WIND = new Vector3(-2.5f, 0.4f, 1.2f);
    static void Seeds()
    {
        if (SPRAY != null) return;
        var r = new Rng(41); SPRAY = new Sp[4100];
        for (int i = 0; i < 4100; i++) { bool bow = i < 2600; SPRAY[i] = new Sp { bow = bow, life = bow ? 0.9f + 0.7f * r.Next() : 1.2f + 0.8f * r.Next(), ph = r.Next(), s0 = r.Next(), s1 = r.Next(), s2 = r.Next(), s3 = r.Next(), s4 = r.Next() }; }
        var q = new Rng(99); SMOKE = new Vector4[250]; SMOKE_KIND = new int[250];
        for (int i = 0; i < 250; i++) { SMOKE_KIND[i] = i < 90 ? 0 : i < 160 ? 1 : 2; SMOKE[i] = new Vector4(q.Next(), q.Next(), q.Next(), q.Next()); }
    }
    static Vector3 SphereDir(Vector4 s) { float z = 2 * s.x - 1, a = s.y * 6.283f, q = Mathf.Sqrt(1 - z * z); return new Vector3(q * Mathf.Cos(a), z, q * Mathf.Sin(a)); }

    void EmitSpray(float w)
    {
        if (!spray) return;
        foreach (var p in SPRAY)
        {
            float birth = Mathf.Floor((w - p.ph * p.life) / p.life) * p.life + p.ph * p.life, age = w - birth;
            if (birth < 0) continue;
            var sb = BoatAt(birth); float v = sb.v, slam = Clamp(-sb.bowV / 2.5f, 0, 1.4f), amt, life = p.life; Vector3 pos, d;
            if (p.bow)
            {
                amt = SStep(9, 20, v) * 0.8f + slam * Mix(0.25f, 0.8f, SStep(6, 16, v));
                if (amt < 0.02f || p.s4 > amt) continue;
                float side = p.s0 < 0.5f ? -1 : 1, lx = Mix(0.8f, 3.8f, p.s1);
                pos = ToWorld(sb, lx, Mix(-0.05f, 0.25f, p.s2), side * 1.78f * Mathf.Sqrt(1 - (lx / 6.3f) * (lx / 6.3f)));
                float outv = Mix(1.2f, 3.5f, p.s2) + 0.16f * v, up = Mix(0.6f, 2.2f, p.s3) + 0.09f * v + slam * 1.6f;
                d = sb.Rh * (side * outv) + sb.Fh * (v * 0.55f + (p.s1 - 0.5f) * 2); d.y = up;
            }
            else
            {
                amt = SStep(11, 21, v);
                if (amt < 0.02f || p.s4 > amt) continue;
                pos = ToWorld(sb, -6.35f, -0.05f, new[] { -0.74f, 0, 0.74f }[Mathf.Min(2, (int)(p.s0 * 3))]);
                d = sb.Fh * (v * Mix(0.35f, 0.75f, p.s1)) + sb.Rh * ((p.s2 - 0.5f) * 3); d.y = Mix(3.0f, 7.5f, p.s3) * (0.3f + 0.7f * SStep(11, 21, v));
                life *= 1.2f;
            }
            float tr = (1 - Mathf.Exp(-1.1f * age)) / 1.1f;
            float x = pos.x + d.x * tr, z = pos.z + d.z * tr, y = pos.y + d.y * tr - 0.5f * G * age * age * 0.8f;
            if (y < SeaH(x, z, w) - 0.1f) continue;
            float u = age / life, a = (p.bow ? 0.26f : 0.2f) * Mathf.Min(1, amt) * Mathf.Pow(Mathf.Max(0, 1 - u), 1.4f) * SStep(0, 0.05f, age);
            float size = (p.bow ? 0.06f : 0.08f) + age * (p.bow ? 0.22f + 0.025f * v : 0.55f), lit = 0.8f + 0.25f * p.s2;
            spray.Push(new Vector3(x, y, z), size, 0.86f * lit, 0.9f * lit, 0.93f * lit, a);
        }
    }

    void EmitFx(float w, Vector3 camP)
    {
        var M = Launch; float tau = w - T_L, sky = 0.62f + 0.25f * SunDir.y;
        void Smoke(Vector3 p, float sz, float r, float g, float b, float a) { if (smoke) smoke.Push(p, sz, r, g, b, a); }
        void Fire(Vector3 p, float sz, float r, float g, float b, float a) { if (fire) fire.Push(p, sz, r * a, g * a, b * a, 1f); }
        if (tau > 0)
            for (int i = 0; i < SMOKE.Length; i++)
            {
                if (SMOKE_KIND[i] != 0) continue; var s = SMOKE[i];
                float a = tau - s.w * 0.25f; if (a <= 0) continue;
                bool front = s.x < 0.4f; Vector3 bse = front ? M.p0 : M.back, dir = (SphereDir(s) * 0.6f + M.d0 * (front ? 1 : -1.3f)).normalized;
                float reach = (front ? 2.2f : 3.2f) * (0.5f + s.z) * (1 - Mathf.Exp(-a * 3));
                var p = bse + dir * reach + WIND * a + new Vector3(0, a * 0.5f, 0);
                if (Vector3.Distance(p, camP) < 4) continue;
                Smoke(p, 0.4f + 1.5f * Mathf.Sqrt(a) * (0.6f + s.y), 0.74f * sky, 0.74f * sky, 0.75f * sky, 0.32f * (1 - SStep(1.0f, 4.5f, a)) * SStep(0, 0.04f, a));
            }
        float tEnd = Mathf.Min(tau, MSL_T);
        for (float te = 0; te < tEnd; te += 0.0028f)
        {
            float a = tau - te; int k = Mathf.FloorToInt(te / 0.0028f);
            float j = Mathf.Sin(k * 12.9898f) * 43758.5453f, jr = j - Mathf.Floor(j);
            var p = MissileAt(te) + WIND * (a * 0.7f) + new Vector3(Mathf.Sin(k * 1.7f), Mathf.Cos(k * 2.3f), Mathf.Sin(k * 0.9f)) * (0.35f * Mathf.Sqrt(a));
            if (Vector3.Distance(p, camP) < 5) continue;
            Smoke(p, 1.3f + 1.7f * Mathf.Sqrt(a) * (0.7f + 0.6f * jr), 0.82f * sky, 0.82f * sky, 0.84f * sky, 0.36f * (1 - SStep(2.5f, 9, a)) * SStep(0, 0.05f, a));
        }
        if (tau > 0 && tau < MSL_T)
        {
            Vector3 p = MissileAt(tau), dir = (MissileAt(tau + 0.01f) - p).normalized;
            for (int i = 0; i < 4; i++) { float f = 0.85f + 0.3f * Mathf.Sin(w * 90 + i * 2.1f); Fire(p + dir * (-0.8f - i * 0.28f), (0.9f - i * 0.16f) * f, 9, 5.2f, 2.0f, 1 - i * 0.2f); }
            if (tau < 0.12f) Fire(M.back, 1.4f * (1 - tau / 0.12f), 10, 6, 2.5f, 1);
        }
        float b = w - T_I;
        if (b > 0)
        {
            if (b < 0.18f) Fire(I_PT, 40 * (1 - b / 0.18f) + 8, 14, 11, 8, 1);
            for (int i = 0; i < SMOKE.Length; i++)
            {
                var s = SMOKE[i];
                if (SMOKE_KIND[i] == 1)
                {
                    var p = I_PT + SphereDir(s) * (8.5f * (0.5f + 0.5f * s.z) * (1 - Mathf.Exp(-b * 7))) + DIR_IN * (VD * 0.25f * (1 - Mathf.Exp(-b * 2)));
                    float heat = Mathf.Exp(-b * (2.6f + 2 * s.w));
                    Fire(p, 3 + 5 * Mathf.Sqrt(b), 9 * heat + 0.3f, 3.6f * heat * heat + 0.1f, 0.8f * heat * heat * heat, heat * 0.9f);
                }
                else if (SMOKE_KIND[i] == 2)
                {
                    var p = I_PT + SphereDir(s) * (13 * (0.4f + 0.6f * s.z) * (1 - Mathf.Exp(-b * 2.2f))) + DIR_IN * (VD * 0.25f * (1 - Mathf.Exp(-b * 2))) + WIND * b + new Vector3(0, 1.2f * b, 0);
                    float c = 0.07f + 0.08f * s.w + 0.1f * SStep(1, 6, b);
                    Smoke(p, 6 + 7 * Mathf.Sqrt(b) * (0.6f + s.y), c, c * 0.96f, c * 0.92f, 0.75f * SStep(0.08f, 0.4f, b) * (1 - SStep(4, 12, b)));
                }
            }
            foreach (var d in Debris())
            {
                float end = Mathf.Min(b, d.splash);
                for (float a = 0.05f; a < end; a += 0.06f)
                {
                    DebrisAt(d, a, out var p); float age = b - a; p += WIND * age;
                    float c = 0.1f + 0.08f * SStep(0.5f, 4, age);
                    Smoke(p, 0.6f + 1.2f * Mathf.Sqrt(age), c, c, c, 0.45f * (1 - SStep(1, 6, age)) * (d.fire ? 1 : 0.5f));
                }
                if (d.fire && b < d.splash && b < 2.5f) { DebrisAt(d, b, out var p); Fire(p, 1.6f + 0.5f * Mathf.Sin(w * 70 + d.w), 9, 4, 1.2f, 1 - b / 2.5f); }
                if (b > d.splash && spray)
                {
                    float a = b - d.splash;
                    for (int k = 0; k < 14; k++)
                    {
                        float az = k * 2.4f + d.w, sp = 2 + (k % 5), up = 5 + (k % 3) * 2.5f, y = up * a - 0.5f * G * a * a;
                        if (y < -0.2f) continue;
                        spray.Push(new Vector3(d.splashP.x + Mathf.Cos(az) * sp * a, d.splashP.y + y, d.splashP.z + Mathf.Sin(az) * sp * a), 0.3f + a * 1.2f, 0.86f, 0.9f, 0.93f, 0.5f * (1 - SStep(0.5f, 1.6f, a)));
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------- shots
    public static readonly Vector3 SunDir = new Vector3(-0.42f, 0.40f, 0.81f).normalized;
    static Vector3 Shake(float t, float a) => new Vector3(Mathf.Sin(t * 13.7f) + 0.5f * Mathf.Sin(t * 31.3f + 1), Mathf.Sin(t * 17.3f + 2) + 0.5f * Mathf.Sin(t * 27.7f), Mathf.Sin(t * 11.1f + 4)) * a;
    bool Shot(float t, out Vector3 eye, out Vector3 tgt, out float fov)
    {
        bool eo = false;
        if (t < 7)
        {   // aerial over the fjord, the boat running up it under the title
            float u = t / 7; var b = BoatAt(t);
            eye = b.pos + b.Fh * Mix(-150, -70, u) + b.Rh * Mix(70, 38, u) + new Vector3(0, Mix(46, 22, u), 0);
            tgt = b.pos + b.Fh * Mix(260, 160, u) + b.Rh * Mix(-235, -150, u) + new Vector3(0, Mix(4, 0, u), 0); fov = 36;
        }
        else if (t < 13)
        {   // low on the water: it charges past and settles to cruise
            var bs = BoatAt(11.6f).pos; float cx = bs.x + 3, cz = bs.z + 13;
            eye = new Vector3(cx, SeaH(cx, cz, t) * 0.6f + 1.5f, cz); tgt = BoatAt(t).pos + new Vector3(0, 0.9f, 0); fov = Mix(26, 44, SStep(7, 12.5f, t));
        }
        else if (t < 46)
        {   // the tour
            var k = Keyed(TOUR, t); var b = BoatAt(t, 0.35f);
            eye = b.pos + b.Fh * k[0] + b.Rh * k[2] + new Vector3(0, k[1], 0);
            tgt = b.pos + b.Fh * k[3] + b.Rh * k[5] + new Vector3(0, k[4], 0); fov = k[6];
        }
        else if (t < 49.4f)
        {   // power up: the camera lets it go
            var b = BoatAt(46, 0.35f); var k = Keyed(TOUR, 46); float drift = 7 * (t - 46) - 1.2f * (t - 46) * (t - 46) * 0.5f;
            eye = b.pos + b.Fh * (k[0] + Mathf.Max(drift, 0)) + b.Rh * k[2] + new Vector3(0, k[1], 0);
            tgt = BoatAt(t).pos + new Vector3(0, 1.1f, 0); fov = Mix(40, 30, SStep(46, 49.5f, t));
        }
        else if (t < 53.6f)
        {   // alongside at speed, from a chase helicopter
            var b = BoatAt(t, 0.2f); float u = (t - 49.4f) / 4.2f;
            eye = b.pos + b.Fh * Mix(8, 2, u) + b.Rh * -24 + new Vector3(0, Mix(5.5f, 7.5f, u), 0) + Shake(t, 0.12f);
            tgt = b.pos + b.Fh * 1.5f + new Vector3(0, 0.8f, 0); fov = 30;
        }
        else if (t < 57.2f)
        {   // the threat, low over the side fjord
            var D = DroneAt(t); float u = (t - 53.6f) / 3.6f;
            eye = D + DIR_IN * Mix(-11, -8, u) + SIDE3 * Mix(5, 3.2f, u) + new Vector3(0, Mix(-1.4f, 1.6f, u), 0);
            tgt = D + DIR_IN * 22; fov = 38;
        }
        else if (t < 60.3f)
        {   // through the gimbal: the boat's own view of the drone
            var b = BoatAt(t); eye = ToWorld(b, 0.15f, 1.29f, 0); var D = DroneAt(t);
            tgt = D + Shake(t * 0.6f, 0.0008f * Vector3.Distance(eye, D)); fov = 0.8f; eo = true;
        }
        else if (t < 63.6f)
        {   // the launcher on the port quarter: it fires
            var b = BoatAt(t, 0.6f);
            eye = b.pos + b.Fh * 1.2f + b.Rh * -7.2f + new Vector3(0, 2.3f, 0);
            tgt = ToWorld(b, -4.0f, 1.3f, -0.55f); tgt.y += 1.6f * SStep(T_L + 0.1f, T_L + 1.6f, t);
            if (t > T_L) eye += Shake(t, 0.07f * Mathf.Exp(-(t - T_L) * 2.5f));
            fov = Mix(40, 50, SStep(T_L, T_L + 1.5f, t));
        }
        else if (t < 68.6f)
        {   // the intercept: from behind the drone, out over the main fjord, the interceptor coming head-on
            var c = I_PT - DIR_IN * Mix(120, 135, (t - 63.6f) / 5) - SIDE3 * 26; c.y = I_PT.y + 4;
            eye = c + (t > T_I ? Shake(t, 0.12f * Mathf.Exp(-(t - T_I) * 2)) : Vector3.zero);
            var D = DroneAt(Mathf.Min(t, T_I)); tgt = Vector3.Lerp(D, I_PT, SStep(T_I - 1.2f, T_I, t)) + new Vector3(0, -Mix(0, 16, SStep(T_I + 0.6f, T_I + 3.4f, t)), 0);
            fov = Mix(15, 34, SStep(T_I + 0.15f, T_I + 2.2f, t));
        }
        else
        {   // on to the escorts: low behind the boat, rising to the wide
            float u = Ease((t - 68.6f) / 9); var b = BoatAt(t, 0.3f);
            eye = b.pos + b.Fh * Mix(-16, -60, u) + b.Rh * Mix(5, 30, u) + new Vector3(0, Mix(2.2f, 70, u), 0);
            tgt = b.pos + b.Fh * Mix(10, 300, u) + new Vector3(0, Mix(1, -10, u), 0); fov = Mix(38, 34, u);
        }
        return eo;
    }

    // ---------------------------------------------------------------- frame
    static readonly Vector4[] trail = new Vector4[44], wave0 = new Vector4[8], wave1 = new Vector4[8], rip0 = new Vector4[12], rip1 = new Vector4[12], shipsV = new Vector4[3], shipD = new Vector4[3];
    MaterialPropertyBlock mpb;
    RenderTexture eoRT;

    public override void Evaluate(float t)
    {
        if (!boat) return;
        float w = t; Seeds();
        Shader.SetGlobalFloat("_FilmTime", w);
        var B = BoatAt(w); F.Pose(boat, B.m);
        PoseRig(w, B);
        // escorts
        for (int i = 0; i < SHIPS.Length && ships != null && i < ships.Length; i++)
        {
            var s = SHIPS[i]; var p = ShipPos(s, t); float dzdx = 0.35f * (FjordC(p.x + 1) - FjordC(p.x - 1)) / 2, yaw = Mathf.Atan2(dzdx, 1), c = Mathf.Cos(yaw), sn = Mathf.Sin(yaw);
            float hb = SeaH(p.x + c * s.L * 0.35f, p.z + sn * s.L * 0.35f, t), hs = SeaH(p.x - c * s.L * 0.35f, p.z - sn * s.L * 0.35f, t);
            p.y = SeaH(p.x, p.z, t) * 0.4f;
            F.Pose(ships[i], p, EulerYZX(0.012f * Mathf.Sin(t * 0.7f + i), -yaw, Mathf.Atan2(hb - hs, s.L * 0.7f) * 0.4f));
            shipsV[i] = new Vector4(p.x, p.z, s.L, s.B); shipD[i] = new Vector4(c, sn, 0, 0);
        }
        // the drone until the intercept, then its pieces; the interceptor between launch and intercept
        bool alive = w < T_I;
        if (drone) { drone.gameObject.SetActive(alive); if (alive) { var p = DroneAt(w); F.Pose(drone, p, LookQ(p, DroneAt(w + 0.05f), 0.12f * Mathf.Sin(w * 0.7f + 1))); if (droneDisc) droneDisc.localRotation = Quaternion.AngleAxis(-w * 50 * Mathf.Rad2Deg, Vector3.right); } }
        var D = Debris();
        if (debris != null) for (int i = 0; i < debris.Length && i < D.Length; i++)
            {
                float a = w - T_I; bool on = a > 0 && a < D[i].splash; debris[i].gameObject.SetActive(on);
                if (on) { DebrisAt(D[i], a, out var p); F.Pose(debris[i], p, AxisAngle(D[i].spin, a * D[i].w)); }
            }
        if (missile)
        {
            bool on = w > T_L && w < T_I; missile.gameObject.SetActive(on);
            if (on) { var p = MissileAt(w - T_L); F.Pose(missile, p, LookQ(p, MissileAt(w - T_L + 0.01f))); }
        }
        // the sea's inputs
        for (int i = 0; i < 44; i++) { float a = i * 0.45f, tw = w - a; if (tw < 0) { trail[i] = new Vector4(0, 0, -1, 0); continue; } var sb = BoatAt(tw); trail[i] = new Vector4(sb.pos.x - sb.Fh.x * 5.6f, sb.pos.z - sb.Fh.z * 5.6f, a, sb.v); }
        for (int i = 0; i < 8; i++) { var wv = WAVES[i]; wave0[i] = new Vector4(wv.k, wv.A, wv.w, wv.Q); wave1[i] = new Vector4(wv.dx, wv.dz, wv.ph, wv.L); }
        for (int i = 0; i < 12; i++)
        {
            float L = 0.3f + 1.6f * Mathf.Pow(i / 11f, 1.6f), a = (190 + 70 * Mathf.Sin(i * 2.4f)) * DEG, k = 2 * Mathf.PI / L;
            rip0[i] = new Vector4(k, Mathf.Sqrt(G * k), Mathf.Cos(a), Mathf.Sin(a)); rip1[i] = new Vector4(i * 2.1f, L, 0, 0);
        }
        Shader.SetGlobalVectorArray("_Trail", trail); Shader.SetGlobalVectorArray("_Wave0", wave0); Shader.SetGlobalVectorArray("_Wave1", wave1);
        Shader.SetGlobalVectorArray("_Rip0", rip0); Shader.SetGlobalVectorArray("_Rip1", rip1);
        Shader.SetGlobalVectorArray("_Ships", shipsV); Shader.SetGlobalVectorArray("_ShipD", shipD);
        Shader.SetGlobalMatrix("_BoatInv", B.m.inverse); Shader.SetGlobalFloat("_BoatV", B.v);
        if (beam != null && beam.Length == 128) Shader.SetGlobalFloatArray("_Beam", beam);
        float firstSplash = 99f; foreach (var d in D) firstSplash = Mathf.Min(firstSplash, d.splash);
        Shader.SetGlobalVector("_Splash", new Vector4(I_PT.x, I_PT.z, w - T_I - firstSplash, 0));
        Shader.SetGlobalVector("_Sun3", SunDir); Shader.SetGlobalFloat("_FogD", 0.000105f); Shader.SetGlobalVector("_FogCol", new Vector4(0.46f, 0.52f, 0.58f, 1));

        // camera
        bool eo = Shot(t, out var eye, out var tgt, out float fov);
        float sea = SeaH(eye.x, eye.z, w); if (eye.y < sea + 0.35f) eye.y = sea + 0.35f;
        if (cam)
        {
            LookAt(cam, eye, tgt); cam.fieldOfView = fov;
            cam.nearClipPlane = eo ? 2f : Clamp(Mathf.Min(Vector3.Distance(eye, B.pos) - 8, eye.y - sea - 0.2f) * 0.5f, 0.05f, 4f);
            Shader.SetGlobalVector("_Cam", new Vector4(Mathf.Round(eye.x * 2) / 2, 0, Mathf.Round(eye.z * 2) / 2, 0));
        }
        EoirView(eo);

        if (spray) spray.Begin(); if (smoke) smoke.Begin(); if (fire) fire.Begin();
        EmitSpray(w); EmitFx(w, eye);
        if (spray) spray.End(); if (smoke) smoke.End(); if (fire) fire.End();
        Overlays(t, w, B);
    }

    void EoirView(bool eo)
    {
        if (!eoCam || !eoImage) return;
        if (eo)
        {
            if (eoRT == null) { eoRT = new RenderTexture(1920, 1080, 24, RenderTextureFormat.DefaultHDR) { name = "EOIR" }; eoRT.Create(); }
            eoCam.targetTexture = eoRT; eoImage.texture = eoRT;
            eoCam.transform.SetPositionAndRotation(cam.transform.position, cam.transform.rotation);
            eoCam.fieldOfView = cam.fieldOfView; eoCam.nearClipPlane = cam.nearClipPlane;
        }
        if (eoCam.enabled != eo) eoCam.enabled = eo;
        if (eoImage.gameObject.activeSelf != eo) eoImage.gameObject.SetActive(eo);
        mpb ??= new MaterialPropertyBlock();
        if (droneRenderers != null) foreach (var r in droneRenderers) { if (!r) continue; r.GetPropertyBlock(mpb); mpb.SetColor("_BaseColor", eo ? Color.black : r.sharedMaterial.GetColor("_BaseColor")); r.SetPropertyBlock(mpb); }
    }

    // ---------------------------------------------------------------- overlays
    static readonly Color HI = new Color(1f, 0.70f, 0.36f);
    int chapterShown = -1;
    void Overlays(float t, float w, in Boat B)
    {
        if (fadeG) fadeG.alpha = Mathf.Max(1 - SStep(0, 1.2f, t), SStep(DUR - 1.2f, DUR - 0.1f, t));
        if (intro) intro.alpha = SStep(1.0f, 1.8f, t) * (1 - SStep(5.6f, 6.6f, t));
        if (hud) hud.alpha = SStep(6.4f, 7.4f, t) * (1 - SStep(72.0f, 72.8f, t)) * (t >= 57.2f && t < 60.3f ? 0f : 1f);   // the EO/IR view has its own chrome
        if (clock) clock.text = $"T+{Mathf.FloorToInt(t / 60f):00}:{t % 60f:00.0}";
        if (phaseText) phaseText.text = t < 13 ? "TRANSIT  //  VESTFJORD" : t < 46 ? "SYSTEMS TOUR" : t < T_DET ? "SPRINT  //  JOINING ESCORT" : t < T_I + 0.3f ? "ENGAGEMENT  //  TRACK 07" : "ESCORT  //  GROUP SAFE";
        // the chapter card, its leader to the part on screen, the part glowing
        int ci = -1; for (int i = 0; i < CHAPTERS.Length; i++) if (t >= CHAPTERS[i].t && t < CHAPTERS[i].end) ci = i;
        mpb ??= new MaterialPropertyBlock();
        foreach (var h in highlights)
        {
            if (!h.r) continue; float on = 0;
            if (ci >= 0 && CHAPTERS[ci].g == h.group) { var ch = CHAPTERS[ci]; on = SStep(ch.t + 0.3f, ch.t + 1.0f, t) * (1 - SStep(ch.end - 0.8f, ch.end - 0.1f, t)) * (0.24f + 0.06f * Mathf.Sin(t * 4)); }
            h.r.GetPropertyBlock(mpb); mpb.SetColor("emissiveFactor", HI * (on * 1.6f)); h.r.SetPropertyBlock(mpb);
        }
        if (ci >= 0)
        {
            var ch = CHAPTERS[ci];
            if (ci != chapterShown)
            {
                chapterShown = ci;
                if (cidx) cidx.text = $"{ci + 1:00} / {CHAPTERS.Length:00}"; if (cgrp) cgrp.text = ch.grp.ToUpperInvariant(); if (ctitle) ctitle.text = ch.title;
                if (clist) clist.text = "•  " + string.Join("\n•  ", ch.lines);
            }
            float a = SStep(ch.t + 0.4f, ch.t + 1.1f, t) * (1 - SStep(ch.end - 0.7f, ch.end - 0.1f, t));
            if (card) card.alpha = a; if (cardRect) cardRect.anchoredPosition = new Vector2(72, 40 - (1 - a) * 14);
            var an = ch.a2t > 0 && t > ch.a2t ? ch.anchor2 : ch.anchor;
            bool vis = ToCanvas(ToWorld(B, an.x, an.y, an.z), out var p);
            if (leader && cardRect && leaderLine && leaderDot)
            {
                leader.alpha = a * (vis ? 1 : 0);
                Vector2 c0 = CardCorner();
                Vector2 d = p - c0; leaderLine.anchoredPosition = c0; leaderLine.sizeDelta = new Vector2(d.magnitude, 2); leaderLine.localRotation = Quaternion.Euler(0, 0, Mathf.Atan2(d.y, d.x) * Mathf.Rad2Deg);
                leaderDot.anchoredPosition = p;
            }
        }
        else { if (card) card.alpha = 0; if (leader) leader.alpha = 0; }
        // sprint telemetry
        if (tele) tele.alpha = SStep(47.2f, 48, t) * (1 - SStep(53.2f, 53.7f, t));
        if (kn) kn.text = Mathf.RoundToInt(B.v * 1.944f).ToString();
        // engagement
        float hudA = SStep(T_DET - 0.1f, T_DET + 0.4f, t) * (1 - SStep(68.2f, 69, t)); bool eo = t >= 57.2f && t < 60.3f;
        if (steps) steps.alpha = hudA; if (scope) scope.alpha = hudA * (eo ? 0 : 1);
        float[] st = { T_DET, T_TRK, T_ID, 60.4f, T_I + 0.3f }; int cur = -1; foreach (var s in st) if (t >= s) cur++;
        if (stepTexts != null) for (int i = 0; i < stepTexts.Length; i++)
                stepTexts[i].color = i < cur ? new Color(0.5f, 0.95f, 0.75f, 0.75f) : i == cur ? (i == 4 ? new Color(1f, 0.42f, 0.36f) : new Color(1f, 0.78f, 0.36f)) : new Color(0.75f, 0.9f, 1f, 0.35f);
        if (hudA > 0 && sweep)
        {
            var Bv = B;   // local functions cannot capture an in parameter
            float sw = (t * 2 * Mathf.PI / 2.2f) % (2 * Mathf.PI);
            sweep.localRotation = Quaternion.Euler(0, 0, -sw * Mathf.Rad2Deg);
            int n = 0;
            void Blip(Vector3 p, Color c, float r, string lbl)
            {
                if (blips == null || n >= blips.Length) return;
                Vector3 lp = p - Bv.pos; float fx = Vector3.Dot(lp, Bv.Fh), rx = Vector3.Dot(lp, Bv.Rh), k = 140f / 3000f;
                float x = rx * k, y = fx * k; if (Mathf.Sqrt(x * x + y * y) > 136) return;
                var b = blips[n]; b.gameObject.SetActive(true); b.anchoredPosition = new Vector2(x, y); b.sizeDelta = new Vector2(r * 2, r * 2); b.GetComponent<Graphic>().color = c;
                if (blipLabels != null) blipLabels[n].text = lbl ?? ""; n++;
            }
            foreach (var s in SHIPS) Blip(ShipPos(s, w), new Color(0.5f, 0.95f, 0.75f), 4.5f, null);
            if (t < T_I + 0.2f) Blip(DroneAt(w), t > T_ID ? new Color(1f, 0.42f, 0.36f) : new Color(0.5f, 0.89f, 1f), 5, t > T_ID ? "UAS-07" : "TRK 07");
            if (t > T_L && t < T_I) Blip(MissileAt(t - T_L), new Color(0.5f, 0.89f, 1f), 3, null);
            for (int i = n; blips != null && i < blips.Length; i++) blips[i].gameObject.SetActive(false);
        }
        // target box on the drone
        bool boxOn = (t >= 53.9f && t < 57.2f) || (t >= 63.6f && t < T_I);
        if (boxG && box)
        {
            bool onScreen = ToCanvas(DroneAt(w), out var p), vis = boxOn && onScreen;
            boxG.alpha = vis ? 1 : 0;
            if (vis)
            {
                box.anchoredPosition = p; var D = DroneAt(w); int rng = Mathf.RoundToInt(Vector3.Distance(D, B.pos));
                foreach (var img in box.GetComponentsInChildren<Image>()) img.color = t > T_ID ? new Color(1f, 0.42f, 0.36f) : new Color(0.5f, 0.89f, 1f);
                if (boxl) { boxl.color = t > T_ID ? new Color(1f, 0.42f, 0.36f) : new Color(0.5f, 0.89f, 1f); boxl.text = t > T_ID ? $"UAS-07 · HOSTILE\n<size=15>RNG {rng} M · {Mathf.RoundToInt(VD * 1.944f)} KN</size>" : $"TRK 07 · AIR · UNKNOWN\n<size=15>RNG {rng} M · {Mathf.RoundToInt(VD * 1.944f)} KN · ALT {Mathf.RoundToInt(D.y)} M</size>"; }
            }
        }
        // the alert card
        float al = SStep(T_DET + 0.2f, T_DET + 0.8f, t) * (1 - SStep(56.8f, 57.2f, t)) + SStep(60.4f, 60.9f, t) * (1 - SStep(63.3f, 63.6f, t)) + SStep(T_I + 0.4f, T_I + 0.9f, t) * (1 - SStep(68.2f, 68.6f, t));
        if (alert) alert.alpha = al;
        if (alertT) { alertT.text = t < 57.2f ? "AIR CONTACT" : t < 63.6f ? "ENGAGE · AUTHORISED" : "TARGET NEUTRALISED"; alertT.color = t < 57.2f ? new Color(1f, 0.78f, 0.36f) : t < 63.6f ? new Color(1f, 0.42f, 0.36f) : new Color(0.5f, 0.95f, 0.75f); }
        if (alertB) alertB.text = t < 57.2f ? "Surveillance radar · track 07\nLow, fast, inbound to the escort group"
                : t < 63.6f ? "Operator consent received over SATCOM\nPort launcher · interceptor 1 of 8"
                : $"Intercept {Mathf.RoundToInt(Vector3.Distance(I_PT, BoatAt(T_L).pos))} m from own ship\nEscort group unharmed · 7 rounds ready";
        if (eoir) eoir.alpha = eo ? 1 : 0;
        if (eo && eoirR) { var D = DroneAt(w); eoirR.text = $"TRK 07\nRNG {Mathf.RoundToInt(Vector3.Distance(D, B.pos))} M\nBRG {((Mathf.Atan2(D.z - B.pos.z, D.x - B.pos.x) / DEG + 450) % 360):0.0}°"; }
        if (eo && eoirC) eoirC.color = new Color(1, 1, 1, SStep(T_ID, T_ID + 0.3f, t));
        if (endG) endG.alpha = SStep(72.4f, 73.6f, t);
    }

    Vector2 CardCorner() { var r = cardRect; return new Vector2(r.anchoredPosition.x + r.sizeDelta.x, canvasRect.rect.height * 0.5f + r.anchoredPosition.y + r.sizeDelta.y * 0.5f - 20); }
    bool ToCanvas(Vector3 p3, out Vector2 p)
    {
        p = Vector2.zero; if (!cam || !canvasRect) return false;
        var sp = cam.WorldToViewportPoint(U(p3)); var cs = canvasRect.rect.size;
        p = new Vector2(sp.x * cs.x, sp.y * cs.y);
        return sp.z > 0 && sp.x > -0.05f && sp.x < 1.05f && sp.y > -0.05f && sp.y < 1.05f;
    }
}
