// Operation SKYFALL, game cut: the Razorbill farm drone flies in over a crop field, its fishhook releases the sensor rod,
// the rod lands in a furrow, the crop fades back and larvae climb the rod; each crossing of the spiral sensor strip spikes
// the plot. A port of site/src/drone/main.js (same numbers, seeds and camera moves) with a game HUD on top. All maths is
// in the three.js film's frame and converted when a Transform is posed (AnimationStudio.Film.F).
using System.Collections.Generic;
using AnimationStudio.Film;
using UnityEngine;
using UnityEngine.UI;
using static AnimationStudio.Film.F;

[ExecuteAlways]
public class RazorbillDirector : FilmDirector
{
    public override string OutputName => "razorbill-game";
    public override float FilmEnd => DUR;

    [Header("Drone")]
    public Transform drone;                     // posed with the drone matrix (feet, nose +x in the film frame)
    public Transform[] propPivots; public Transform[] discs;
    public Transform hook, horn, lever; public Vector3 leverHome;
    public Transform arrow;                     // the rod's "arrow" frame
    [Header("Ground")]
    public CropField crops;
    public Transform[] clods; public PointCloud dust;
    public MeshFilter[] larvae;
    [Header("Camera and HUD")]
    public Camera cam;
    public CanvasGroup hud, title, fade, plotGroup;
    public Text phase, clock, speedText, aglText, payloadText, droneLabel, dropLabel;
    public Image payloadDot;
    public RectTransform droneBox, dropBox, canvasRect, plotHead;
    public RawImage plot;

    // ---------------------------------------------------------------- timing
    public const float DUR = 39f;
    static readonly float[][] RATE = { new[] { 0f, 1f }, new[] { 18.6f, 1f }, new[] { 19f, 0.4f }, new[] { 20.6f, 0.4f }, new[] { 20.8f, 0.7f }, new[] { 21.5f, 0.7f }, new[] { 21.7f, 0.3f }, new[] { 22.8f, 0.3f }, new[] { 23.4f, 1f }, new[] { DUR, 1f } };
    static TimeWarp warp;
    public static float W(float t) { warp ??= new TimeWarp(RATE, DUR); return warp[Clamp(t, 0f, DUR)]; }
    const float W_DECEL = 11f, W_HOV = 17.6f, V_IN = 10f, V_OUT = 11f;
    static float W_REL => W(19.7f);
    static float W_DEP => W_REL + 2.7f;

    // ---------------------------------------------------------------- field layout
    public const float ROW = 0.42f;
    public static float TRAM(float z) => Mathf.Abs(((z - 12f) % 24f + 36f) % 24f - 12f);
    public const float PX0 = -165f, PX1 = 110f, PZ = 30f;                    // where real plants stand
    public const float FX0 = -420f, FX1 = 240f, FZ0 = -140f, FZ1 = 120f;     // the main field
    const float Z_DROP = ROW / 2f, ARROW_Z = 0f;
    public static readonly Vector3 CAM_DIR = new Vector3(0.25f, 0f, -1f).normalized;
    public const float IMPACT_CAM_D = 1.9f, IMPACT_CAM_Y = 1.12f, REVEAL_CIRCLE = 0.8f, REVEAL_LANE = 0.5f, REVEAL_LENGTH = 3.2f;

    // ---------------------------------------------------------------- flight path
    static float Speed(float w) => w < W_HOV ? V_IN * (1f - SStep(W_DECEL, W_HOV, w)) : w < W_DEP ? 0f : V_OUT * SStep(W_DEP, W_DEP + 5f, w);
    const float DW = 1f / 120f;
    static Vector3[] pathP, pathU; static float[] pathYaw; static int NP;

    static void BuildPath()
    {
        if (pathP != null) return;
        var approach = new CatmullRom(new[] { V(-330, 18, 48), V(-230, 12, 30), V(-140, 8.5f, -4), V(-70, 7, 6), V(-25, 5.8f, Z_DROP - ARROW_Z + 1.1f), V(0, 5.2f, Z_DROP - ARROW_Z) }, 4000);
        var depart = new CatmullRom(new[] { V(0, 5.2f, Z_DROP - ARROW_Z), V(14, 6.5f, -1), V(55, 14, -14), V(130, 28, -45), V(260, 48, -95), V(450, 75, -170) }, 4000);
        float L1 = approach.Length, L2 = depart.Length, wEnd = W(DUR) + 1f, wRel = W_REL, wDep = W_DEP;
        NP = Mathf.CeilToInt(wEnd / DW) + 2;
        var S = new double[NP];
        for (int i = 1; i < NP; i++) S[i] = S[i - 1] + Speed((i - 0.5f) * DW) * DW;
        double sHov = S[Mathf.RoundToInt(W_HOV / DW)], sDep = S[Mathf.RoundToInt(wDep / DW)];
        var P = new Vector3[NP];
        for (int i = 0; i < NP; i++)
        {
            float w = i * DW; Vector3 p;
            if (w <= W_HOV) p = approach.GetPointAt(Clamp((float)((L1 - (sHov - S[i])) / L1), 0f, 1f));
            else p = depart.GetPointAt(Clamp((float)((S[i] - sDep) / L2), 0f, 1f));
            float hov = SStep(W_HOV - 1.5f, W_HOV + 0.5f, w) * (1f - SStep(wDep - 0.5f, wDep + 1.5f, w));
            p.x += hov * 0.035f * Mathf.Sin(1.3f * w); p.y += hov * 0.045f * Mathf.Sin(0.9f * w + 1); p.z += hov * 0.03f * Mathf.Sin(1.1f * w + 2);
            p.y += 0.14f * SStep(wRel + 0.2f, wRel + 1.2f, w) * (1f - SStep(wDep, wDep + 2f, w));   // lighter without the rod
            P[i] = p;
        }
        // thrust axis from the smoothed acceleration plus gravity and a little drag; heading from the ground track
        var Vv = new Vector3[NP]; var A = new Vector3[NP];
        for (int i = 0; i < NP; i++) { int a = Mathf.Max(0, i - 1), b = Mathf.Min(NP - 1, i + 1); Vv[i] = (P[b] - P[a]) / ((b - a) * DW); }
        for (int i = 0; i < NP; i++) { int a = Mathf.Max(0, i - 1), b = Mathf.Min(NP - 1, i + 1); A[i] = (Vv[b] - Vv[a]) / ((b - a) * DW); }
        float sig = 0.22f / DW; int R = Mathf.CeilToInt(sig * 3); var ker = new float[2 * R + 1];
        for (int k = 0; k <= 2 * R; k++) ker[k] = Mathf.Exp(-((k - R) * (k - R)) / (2 * sig * sig));
        pathU = new Vector3[NP]; pathYaw = new float[NP]; float yaw = 0f;
        for (int i = 0; i < NP; i++)
        {
            Vector3 a = Vector3.zero; float ws = 0f;
            for (int k = -R; k <= R; k++) { int j = Mathf.Clamp(i + k, 0, NP - 1); a += A[j] * ker[k + R]; ws += ker[k + R]; }
            pathU[i] = (a / ws + new Vector3(0, G, 0) + Vv[i] * 0.2f).normalized;
            float hv = Mathf.Sqrt(Vv[i].x * Vv[i].x + Vv[i].z * Vv[i].z);
            if (hv > 0.4f)
            {
                float y = Mathf.Atan2(-Vv[i].z, Vv[i].x);
                while (y - yaw > Mathf.PI) y -= 2 * Mathf.PI; while (y - yaw < -Mathf.PI) y += 2 * Mathf.PI;
                yaw = i > 0 ? Mix(yaw, y, Clamp(hv / 3f, 0f, 1f) * 0.08f) : y;
            }
            pathYaw[i] = yaw;
        }
        pathP = P;
    }

    public struct State { public Vector3 pos, U, F, R, Fh, Rh, c; public Quaternion q; public Matrix4x4 m; public float speed; }
    public static State StateAt(float w)
    {
        BuildPath();
        float f = Clamp(w / DW, 0f, NP - 2.001f); int i = (int)f; float k = f - i;
        State o;
        o.pos = Vector3.LerpUnclamped(pathP[i], pathP[i + 1], k);
        o.U = Vector3.LerpUnclamped(pathU[i], pathU[i + 1], k).normalized;
        float yaw = Mix(pathYaw[i], pathYaw[i + 1], k);
        o.Fh = new Vector3(Mathf.Cos(yaw), 0, -Mathf.Sin(yaw)); o.Rh = new Vector3(Mathf.Sin(yaw), 0, Mathf.Cos(yaw));
        o.R = Vector3.Cross(o.Fh, o.U).normalized; o.F = Vector3.Cross(o.U, o.R).normalized;
        o.q = Basis(o.F, o.U, o.R); o.m = Matrix4x4.TRS(o.pos, o.q, Vector3.one);
        o.c = o.pos + o.U * 0.15f; o.speed = Speed(w);
        return o;
    }
    /// <summary>Ground track of the flight, for placing the plants the cameras get close to.</summary>
    public static List<Vector2> Track(float step = 2f)
    {
        var l = new List<Vector2>(); float wEnd = W(DUR);
        for (float w = 0; w < wEnd; w += 0.05f) { var p = StateAt(w).pos; if (l.Count == 0 || (l[l.Count - 1] - new Vector2(p.x, p.z)).magnitude > step) l.Add(new Vector2(p.x, p.z)); }
        return l;
    }

    // ---------------------------------------------------------------- the rod's fall
    // It hangs from the hook by its wire ring, down the thrust axis; the hook turns until the ring slips off and the rod
    // falls nose first, the fins swinging it toward vertical. "Arrow" frame: +x to the nose, origin halfway along the rod.
    public const float TIP = 0.556f, HOLD_Y = -0.8f;
    const float TA = 0.18f, PHT = 85f * DEG, KD = 5f, PEN = 0.13f;
    public static readonly Matrix4x4 ARROW_LOCAL = Matrix4x4.Translate(new Vector3(0, HOLD_Y, ARROW_Z)) * Matrix4x4.Rotate(AxisAngle(Vector3.forward, -Mathf.PI / 2));
    struct Fall { public Vector3 p0, v0, k, dHit, tipHit, side; public Quaternion q0, qHit; public float ph0, hit; }
    static Fall? fall;
    static float Phi(in Fall f, float tau) => PHT + (f.ph0 - PHT + (0f + KD * (f.ph0 - PHT)) * tau) * Mathf.Exp(-KD * tau);
    static void FallPose(in Fall f, float tau, out Vector3 p, out Quaternion q)
    {
        p = f.p0 + f.v0 * tau; p.y -= 0.5f * G * tau * tau;
        q = AxisAngle(f.k, Phi(f, tau) - f.ph0) * f.q0;
    }
    static Fall FallData
    {
        get
        {
            if (fall.HasValue) return fall.Value;
            Matrix4x4 At(float tau) => StateAt(W_REL + tau).m * ARROW_LOCAL;
            Matrix4x4 m0 = At(TA), m1 = At(TA - 1e-3f);
            var f = new Fall { p0 = m0.GetColumn(3), q0 = m0.rotation };
            f.v0 = (f.p0 - (Vector3)m1.GetColumn(3)) / 1e-3f;
            Vector3 d0 = f.q0 * Vector3.right; f.ph0 = Mathf.Asin(-d0.y);
            Vector3 h = new Vector2(d0.x, d0.z).magnitude > 1e-4f ? new Vector3(d0.x, 0, d0.z).normalized : Vector3.right;
            f.k = Vector3.Cross(h, Vector3.down).normalized;
            float tau = 0f; Vector3 p; Quaternion q;
            for (; tau < 4f; tau += 5e-4f) { FallPose(f, tau, out p, out q); if (p.y + (q * new Vector3(TIP, 0, 0)).y <= 0) break; }
            f.hit = tau; FallPose(f, tau, out p, out q);
            f.qHit = q; f.dHit = q * Vector3.right; f.tipHit = p + f.dHit * TIP; f.side = Vector3.Cross(f.dHit, f.k).normalized;
            fall = f; return f;
        }
    }
    static float W_HIT => W_REL + TA + FallData.hit;
    public static Vector3 IMPACT { get { var t = FallData.tipHit; t.y = 0; return t; } }

    static Matrix4x4 ArrowPose(float w, Matrix4x4 droneM)
    {
        var f = FallData; float tau = w - W_REL;
        if (tau < TA) return droneM * ARROW_LOCAL;
        float tb = tau - TA;
        if (tb < f.hit) { FallPose(f, tb, out var p, out var q); return Matrix4x4.TRS(p, q, Vector3.one); }
        float a = tb - f.hit;   // stuck: driven in, then quivering about the buried tip
        Vector3 tip = f.tipHit + f.dHit * (PEN * (1f - Mathf.Exp(-a / 0.008f)));
        Quaternion qq = AxisAngle(f.k, 0.085f * Mathf.Exp(-3.2f * a) * Mathf.Sin(2 * Mathf.PI * 7 * a))
                      * AxisAngle(f.side, 0.03f * Mathf.Exp(-3.5f * a) * Mathf.Sin(2 * Mathf.PI * 6.3f * a + 1)) * f.qHit;
        return Matrix4x4.TRS(tip - (qq * Vector3.right) * TIP, qq, Vector3.one);
    }

    // ---------------------------------------------------------------- impact: dust and clods, pure functions of age
    static Vector4[] dustSeed; static Vector4[] clodSeed;
    void Impact(float age)
    {
        if (dustSeed == null)
        {
            var r = new Rng(21); dustSeed = new Vector4[140]; for (int i = 0; i < 140; i++) dustSeed[i] = new Vector4(r.Next(), r.Next(), r.Next(), r.Next());
            var r2 = new Rng(33); clodSeed = new Vector4[18]; for (int i = 0; i < 18; i++) clodSeed[i] = new Vector4(r2.Next() * 6.283f, 0.4f + r2.Next() * 1.0f, 1.0f + r2.Next() * 1.6f, 0.002f + r2.Next() * 0.004f);
        }
        Vector3 O = IMPACT;
        if (dust)
        {
            dust.Begin();
            if (age >= 0)
                foreach (var s in dustSeed)
                {
                    float a = age, az = s.x * 6.2832f, sp = Mix(0.12f, 0.6f, s.y), up = Mix(0.4f, 1.4f, s.z), travel = (1f - Mathf.Exp(-2.6f * a)) / 2.6f;
                    var p = O + new Vector3(Mathf.Cos(az) * sp * travel, up * sp * travel * 0.9f - 0.05f * a * a + 0.01f, Mathf.Sin(az) * sp * travel);
                    p.y = Mathf.Max(p.y, 0.005f);
                    float al = SStep(0, 0.04f, a) * (1f - SStep(0.4f, 2.2f + s.w, a));
                    float size = (0.05f + 0.2f * a * (0.6f + s.w)) * (0.6f + s.y);
                    Color c = Color.Lerp(new Color(0.42f, 0.33f, 0.22f), new Color(0.58f, 0.48f, 0.36f), s.w);
                    dust.Push(p, size, c.r, c.g, c.b, al * 0.09f);
                }
            dust.End();
        }
        if (clods != null)
            for (int i = 0; i < clods.Length && i < clodSeed.Length; i++)
            {
                var s = clodSeed[i]; float a = Mathf.Max(0, age), tl = 2 * s.z / G, tt = Mathf.Min(a, tl), h = s.z * tt - 0.5f * G * tt * tt;
                var p = new Vector3(O.x + Mathf.Cos(s.x) * s.y * 0.35f * tt, Mathf.Max(s.w * 0.6f, h + 0.01f), O.z + Mathf.Sin(s.x) * s.y * 0.35f * tt);
                F.Pose(clods[i], p, AxisAngle(new Vector3(1, 0.3f, 0.2f).normalized, s.x + tt * 9));
                clods[i].localScale = Vector3.one * (age < 0 ? 0f : s.w);
            }
    }

    // ---------------------------------------------------------------- larvae on the rod
    // A larva crawls a path measured along the rod from the soil (s > 0) or across the soil toward it (s < 0).
    // rod_tape is a spiral strip 12.5 mm wide with a 60 mm pitch; each crossing spikes the signal.
    const float ROD_R = 0.0111f, TAPE_PITCH = 0.06f, TAPE_LOW = -1.271f, TAPE_W = 0.0125f, V_LARVA = 0.024f;
    const float ROD_NOSE = TIP - HOLD_Y;
    public const int RINGS = 96, SIDES = 20;
    static readonly float[] LEGS = { 0.11f, 0.15f, 0.19f, 0.5f, 0.57f, 0.64f, 0.71f, 0.95f };
    struct Larva { public float t0, th, len, amp; public int i; }
    static Larva[] LARVAE;
    static Vector3 RodUp => -FallData.dHit;
    static Vector3 Around(float th) => FallData.qHit * new Vector3(0, Mathf.Cos(th), Mathf.Sin(th));
    static Larva[] Larvae()
    {
        if (LARVAE != null) return LARVAE;
        var v = Quaternion.Inverse(FallData.qHit) * CAM_DIR; float thCam = Mathf.Atan2(v.z, v.y);
        float[][] L = { new[] { 23.6f, -48f, 0.036f, 1f }, new[] { 25.33f, 12f, 0.033f, 0.82f }, new[] { 27.17f, 52f, 0.038f, 0.93f }, new[] { 28.13f, -14f, 0.03f, 0.72f } };
        LARVAE = new Larva[4];
        for (int i = 0; i < 4; i++) LARVAE[i] = new Larva { t0 = L[i][0], th = thCam + L[i][1] * DEG, len = L[i][2], amp = L[i][3], i = i };
        return LARVAE;
    }
    static float LarvaS(in Larva l, float t, float u) => V_LARVA * (t - l.t0) - 0.03f + 0.0012f * Mathf.Sin(6.9f * (t - l.t0)) - l.len * u * (1 + 0.07f * Mathf.Sin(6.9f * t - 9.4f * u + l.i));
    static float LarvaTh(in Larva l, float s) => l.th + (s > 0 ? 0.16f * Mathf.Sin(s * 24 + l.i * 1.7f) : 0f);
    static float LarvaSignal(in Larva l, float t)
    {
        float s = LarvaS(l, t, 0.45f); if (s <= 0) return 0f;
        float centre = TAPE_LOW + TAPE_W / 2 - LarvaTh(l, s) / DEG / 90f * (TAPE_PITCH / 4), y = -ROD_NOSE + PEN + s;
        float d = ((y - centre) % TAPE_PITCH + TAPE_PITCH * 1.5f) % TAPE_PITCH - TAPE_PITCH / 2;
        return l.amp * Mathf.Exp(-(d / 0.0048f) * (d / 0.0048f));
    }
    public const float PLOT_T0 = 25.2f, PLOT_T1 = 37.4f;
    static float[] signal;
    public static float[] Signal()
    {
        if (signal != null) return signal;
        int n = Mathf.RoundToInt((PLOT_T1 - PLOT_T0) * 60); signal = new float[n + 1]; var r = new Rng(77);
        foreach (var _ in Larvae()) { }
        for (int i = 0; i <= n; i++)
        {
            float t = PLOT_T0 + i / 60f, v = 0f; foreach (var l in LARVAE) v += LarvaSignal(l, t);
            signal[i] = v + 0.018f * (r.Next() - 0.5f) + 0.012f * Mathf.Sin(t * 2.3f) + 0.008f * Mathf.Sin(t * 7.1f);
        }
        return signal;
    }
    static Vector3 PathAt(in Larva l, float s, out Vector3 n)
    {
        var f = FallData; Vector3 e = Around(LarvaTh(l, s)); float k = SStep(-0.006f, 0.006f, s);
        Vector3 p = f.tipHit + RodUp * Mathf.Max(s, 0) + e * (ROD_R + Mathf.Max(-s, 0)); p.y = Mathf.Max(p.y, 0.001f);
        n = Vector3.Lerp(Vector3.up, e, k).normalized; return p;
    }
    Vector3[] lv;
    void PoseLarvae(float t)
    {
        if (larvae == null) return;
        var Ls = Larvae();
        for (int li = 0; li < larvae.Length && li < Ls.Length; li++)
        {
            var l = Ls[li]; var mf = larvae[li]; bool on = t >= l.t0;
            if (mf.gameObject.activeSelf != on) mf.gameObject.SetActive(on);
            if (!on) continue;
            var mesh = mf.sharedMesh; if (lv == null || lv.Length != (RINGS + 1) * (SIDES + 1)) lv = new Vector3[(RINGS + 1) * (SIDES + 1)];
            float R = l.len * 0.085f;
            for (int j = 0; j <= RINGS; j++)
            {
                float u = j / (float)RINGS, s = LarvaS(l, t, u);
                Vector3 pa = PathAt(l, s, out var nn), pb = PathAt(l, s - 0.0015f, out _), pc = PathAt(l, s + 0.0015f, out _);
                Vector3 tt = (pb - pc).normalized; nn = (nn - tt * Vector3.Dot(nn, tt)).normalized; Vector3 bb = Vector3.Cross(nn, tt).normalized;
                float r = R * Mathf.Sqrt(SStep(0, 0.05f, u)) * Mathf.Sqrt(1 - SStep(0.92f, 1, u)) * Mix(0.8f, 1, SStep(0.06f, 0.15f, u)) * Mix(1, 0.8f, SStep(0.72f, 0.95f, u));
                float lift = R * 0.16f * Mathf.Max(0, Mathf.Sin(6.9f * t - 9.4f * u + l.i)), rib = u > 0.085f ? 1 + 0.06f * Mathf.Abs(Mathf.Cos(Mathf.PI * (u - 0.085f) * 12.2f)) : 1f;
                Vector3 wc = pa + nn * (r * 0.8f + lift);
                for (int i = 0; i <= SIDES; i++)
                {
                    float phi = i / (float)SIDES * 2 * Mathf.PI, c = Mathf.Cos(phi), d = Mathf.Sin(phi);
                    float leg = 0f;
                    foreach (var kk in LEGS) { float dphi = Mathf.Min(Mathf.Abs(phi - 3.75f), Mathf.Abs(phi - 5.67f)); leg = Mathf.Max(leg, Mathf.Exp(-((u - kk) / 0.013f) * ((u - kk) / 0.013f)) * Mathf.Exp(-(dphi / 0.32f) * (dphi / 0.32f))); }
                    float rr = r * rib * (1 + 0.32f * leg);
                    lv[j * (SIDES + 1) + i] = U(wc + bb * (c * rr) + nn * (d * rr));
                }
            }
            mesh.vertices = lv; mesh.RecalculateNormals(); mesh.RecalculateBounds();
        }
    }

    // ---------------------------------------------------------------- shots
    static readonly float[][] SCAN = {
        new[] { 4.4f, 0.5f, 6.0f, 0.6f, -0.45f, 34f }, new[] { 5.4f, 0.62f, 5.8f, 0.55f, -0.45f, 34f },
        new[] { 8.0f, 1.6f, 0.85f, -1.28f, -1.28f, 30f }, new[] { 10.0f, 3.1f, 0.7f, -0.98f, -0.98f, 30f }, new[] { 12.2f, 4.6f, 0.7f, -0.45f, -0.45f, 30f },
        new[] { 13.6f, 5.9f, 1.25f, 0.15f, -0.1f, 34f }, new[] { 15.3f, 7.1f, 1.35f, 0.55f, 0.1f, 34f },
        new[] { 16.8f, 7.95f, 1.05f, -0.12f, -0.03f, 32f }, new[] { 18.6f, 2.3f + 2 * Mathf.PI, 0.5f, -0.13f, -0.04f, 26f },
    };
    void Orbit(in State S, float az, float r, float y, float look, out Vector3 eye, out Vector3 tgt)
    {
        eye = S.pos - S.Fh * (Mathf.Cos(az) * r) + S.Rh * (Mathf.Sin(az) * r) + new Vector3(0, y, 0);
        tgt = S.pos + S.U * look;
    }
    void Shot(float t, in State S, Vector3 arrowP, out Vector3 eye, out Vector3 tgt, out float fov)
    {
        var f = FallData;
        if (t < 4.4f)
        {   // establishing: high and broad, the drone crossing the field under the title
            float u = t / 4.4f;
            eye = StateAt(W(2.2f)).pos + new Vector3(Mix(-11, -3, u), Mix(13, 11, u), Mix(-20, -18, u));
            tgt = S.c + S.Fh * 4 + new Vector3(0, -1.2f, 0); fov = 34;
        }
        else if (t < 18.6f)
        {   // one move: wide, in to the rod's nose, up the rod circling it, the drone close, back to the hook
            var k = Keyed(SCAN, t); Orbit(S, k[0], k[1], k[2], k[3], out eye, out tgt); fov = k[4];
        }
        else if (t < 20.6f)
        {   // the release, close: the hook turns and the ring slips off its tip
            float u = (t - 18.6f) / 2f; Orbit(S, 2.3f, Mix(0.5f, 0.46f, u), -0.13f, -0.04f, out eye, out tgt); fov = 26;
        }
        else if (t < 21.45f)
        {   // falling with the rod, the crop coming up behind it
            float u = (t - 20.6f) / 0.85f;
            eye = arrowP + new Vector3(Mix(-1.7f, -1.55f, u), Mix(0.75f, 0.55f, u), Mix(-1.0f, -0.9f, u)); tgt = arrowP; fov = 38;
        }
        else
        {   // the strike, then one push through the fading crop, down to the rod, which sits left of the plot
            float u = Ease((t - 22.6f) / 3.2f), h = Mathf.Max(0.07f, 0.08f + V_LARVA * (t - 31f));
            Vector3 mid = f.tipHit + RodUp * h, side = Vector3.Cross(Vector3.up, CAM_DIR).normalized;
            eye = f.tipHit + CAM_DIR * Mix(IMPACT_CAM_D, 0.31f, u); eye.y = Mix(IMPACT_CAM_Y, h + 0.035f, u);
            tgt = Vector3.Lerp(f.tipHit + new Vector3(0, 0.62f, 0), mid, u) + side * (0.075f * u); fov = 30;
        }
    }

    // ---------------------------------------------------------------- frame
    public override void Evaluate(float t)
    {
        if (!drone) return;
        float w = W(t);
        Shader.SetGlobalFloat("_FilmTime", w);
        var S = StateAt(w);
        F.Pose(drone, S.m);
        // props: a slow forward "strobe" turn per frame at 30 fps, like filmed rotors, plus the blur disc
        if (propPivots != null)
            for (int i = 0; i < propPivots.Length; i++)
            {
                float a = (i % 2 == 1 ? 1 : -1) * (2 * Mathf.PI * 30f * 3.07f * w + i * 1.3f);
                propPivots[i].localRotation = Quaternion.AngleAxis(-a * Mathf.Rad2Deg, Vector3.up);   // glb frame: y rotations flip
                if (discs != null && i < discs.Length) discs[i].localRotation = Quaternion.AngleAxis(a * Mathf.Rad2Deg, Vector3.up);
            }
        float ha = -0.7f * SStep(W_REL - 0.25f, W_REL + 0.1f, w);
        if (hook) hook.localRotation = Quaternion.AngleAxis(ha * Mathf.Rad2Deg, Vector3.right);
        if (horn) horn.localRotation = Quaternion.AngleAxis(ha * Mathf.Rad2Deg, Vector3.right);
        if (lever) lever.localPosition = leverHome + new Vector3(0, 0.022f * (Mathf.Cos(ha) - 1), 0.022f * Mathf.Sin(ha));
        var am = ArrowPose(w, S.m); if (arrow) F.Pose(arrow, am);
        Vector3 arrowP = am.GetColumn(3);

        float age = w >= W_HIT ? w - W_HIT : -1f;
        Impact(age);
        Shader.SetGlobalVector("_Impact", new Vector4(IMPACT.x, IMPACT.z, age, 0f));
        if (crops) { crops.reveal = SStep(22.2f, 24.6f, t); crops.impact = IMPACT; }
        PoseLarvae(t);

        Shot(t, S, arrowP, out var eye, out var tgt, out float fov);
        if (cam)
        {
            LookAt(cam, eye, tgt); cam.fieldOfView = fov;
            float clear = Mathf.Min(eye.y - 0.4f, Vector3.Distance(eye, S.c) - 1.2f, Vector3.Distance(eye, arrowP) - 0.8f);
            cam.nearClipPlane = Clamp(clear * 0.5f, 0.01f, 5f);
        }
        Hud(t, w, S, arrowP);
    }

    // ---------------------------------------------------------------- HUD
    Texture2D plotTex; Color32[] plotBase, plotBuf;
    const int PW = 860, PH = 520, PX0p = 96, PX1p = 824, PY0p = 400, PY1p = 60;   // the film's SVG plot box (y down)

    void Hud(float t, float w, in State S, Vector3 arrowP)
    {
        if (fade) fade.alpha = Mathf.Max(1f - SStep(0f, 0.8f, t), SStep(DUR - 1.1f, DUR - 0.1f, t));
        if (title) title.alpha = SStep(0.7f, 1.4f, t) * (1f - SStep(3.7f, 4.3f, t));
        if (hud) hud.alpha = SStep(4.0f, 5.0f, t) * (1f - SStep(DUR - 1.6f, DUR - 0.8f, t));
        float wHit = W_HIT, wRel = W_REL;
        bool released = w >= wRel + TA, landed = w >= wHit;
        if (phase) phase.text = w < W_DECEL ? "TRANSIT  //  FIELD 7" : w < W_HOV - 0.3f ? "APPROACH  //  DROP POINT" : w < wRel - 0.25f ? "HOVER  //  HOLDING 5 M"
                                : !released ? "RELEASE" : !landed ? "ROD AWAY" : t < 23.6f ? "IMPACT  //  ROD IN FURROW" : t < PLOT_T0 ? "SENSING" : "SENSING  //  SIGNAL LIVE";
        if (clock) clock.text = $"T+{Mathf.FloorToInt(w / 60f):00}:{w % 60f:00.0}";
        if (!landed)
        {
            if (speedText) speedText.text = $"{S.speed:0.0}\n<size=22>m/s  GS</size>";
            if (aglText) aglText.text = $"{S.pos.y:0.0}\n<size=22>m  AGL</size>";
        }
        else
        {   // after the drop the readouts follow the rod: larvae on it, how deep it went in
            int onRod = 0; foreach (var l in Larvae()) if (LarvaS(l, t, 0.45f) > 0) onRod++;
            float depth = PEN * (1f - Mathf.Exp(-(w - wHit) / 0.008f)) * 100f;
            if (speedText) speedText.text = $"{onRod}\n<size=22>LARVAE ON ROD</size>";
            if (aglText) aglText.text = $"{depth:0}\n<size=22>cm  IN SOIL</size>";
        }
        if (payloadText) payloadText.text = "PAYLOAD   SENSOR ROD   " + (!released ? "ARMED" : !landed ? "RELEASED" : "IN SOIL  ·  " + (t < 23.6f ? "STANDBY" : "LIVE"));
        if (payloadDot) payloadDot.color = !released ? new Color(1f, 0.78f, 0.36f) : !landed ? new Color(1f, 0.45f, 0.3f) : new Color(0.45f, 1f, 0.6f);

        Track(droneBox, droneLabel, S.c, 0.75f, t > 4.6f && t < 21.4f, d => $"RAZORBILL  {d:0.0} m");
        Track(dropBox, dropLabel, IMPACT, 0.9f, t > 4.6f && t < 20.4f, d => $"DROP POINT  {d:0} m");

        if (plotGroup) plotGroup.alpha = SStep(PLOT_T0 - 0.5f, PLOT_T0 + 0.1f, t);
        if (plot && t > PLOT_T0 - 0.6f) DrawPlot(t);
    }

    void Track(RectTransform box, Text label, Vector3 p3, float size, bool on, System.Func<float, string> txt)
    {
        if (!box || !cam || !canvasRect) return;
        Vector3 sp = cam.WorldToViewportPoint(U(p3));
        bool vis = on && sp.z > 0 && sp.x > 0.02f && sp.x < 0.98f && sp.y > 0.08f && sp.y < 0.92f;
        if (box.gameObject.activeSelf != vis) box.gameObject.SetActive(vis);
        if (!vis) return;
        Vector2 cs = canvasRect.rect.size;
        box.anchoredPosition = new Vector2((sp.x - 0.5f) * cs.x, (sp.y - 0.5f) * cs.y);
        float px = size / (2f * sp.z * Mathf.Tan(cam.fieldOfView * 0.5f * DEG)) * cs.y, s = Clamp(px * 1.2f, 36f, 300f);
        box.sizeDelta = new Vector2(s, s);
        if (label) label.text = txt(sp.z);
    }

    void DrawPlot(float t)
    {
        if (plotTex == null || plotTex.width != PW)
        {
            plotTex = new Texture2D(PW, PH, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            plotBase = new Color32[PW * PH]; plotBuf = new Color32[PW * PH];
            var panel = new Color32(8, 12, 16, 170); for (int i = 0; i < plotBase.Length; i++) plotBase[i] = panel;
            void HLine(int y, int x0, int x1, Color32 c, int th) { for (int yy = y; yy < y + th; yy++) for (int x = x0; x <= x1; x++) Set(plotBase, x, yy, c); }
            void VLine(int x, int y0, int y1, Color32 c, int th) { for (int xx = x; xx < x + th; xx++) for (int y = y0; y <= y1; y++) Set(plotBase, xx, y, c); }
            var grid = new Color32(200, 235, 255, 40); foreach (var y in new[] { 60, 180, 300 }) HLine(y, PX0p, PX1p, grid, 1);
            var axis = new Color32(200, 235, 255, 200); VLine(PX0p, 36, 420, axis, 2); HLine(420, PX0p, PX1p, axis, 2);
            plot.texture = plotTex;
        }
        System.Array.Copy(plotBase, plotBuf, plotBase.Length);
        var sig = Signal(); float u = Clamp((t - PLOT_T0) / (PLOT_T1 - PLOT_T0), 0f, 1f), last = u * (sig.Length - 1);
        float X(float i) => Mix(PX0p, PX1p, i / (sig.Length - 1)); float Y(float v) => Mix(PY0p, PY1p, v / 1.25f);
        var col = new Color32(255, 200, 92, 255);
        for (int i = 1; i <= (int)last; i++) Line(plotBuf, X(i - 1), Y(sig[i - 1]), X(i), Y(sig[i]), col);
        int k = Mathf.Min((int)last, sig.Length - 2); float v = Mix(sig[k], sig[k + 1], last - k);
        Disc(plotBuf, X(last), Y(v), 6, col);
        plotTex.SetPixels32(plotBuf); plotTex.Apply(false);
    }
    static void Set(Color32[] b, int x, int ySvg, Color32 c) { int y = PH - 1 - ySvg; if (x < 0 || x >= PW || y < 0 || y >= PH) return; b[y * PW + x] = c; }
    static void Line(Color32[] b, float x0, float y0, float x1, float y1, Color32 c)
    {
        int n = Mathf.CeilToInt(Mathf.Max(Mathf.Abs(x1 - x0), Mathf.Abs(y1 - y0))) + 1;
        for (int i = 0; i <= n; i++) { float x = Mathf.Lerp(x0, x1, i / (float)n), y = Mathf.Lerp(y0, y1, i / (float)n); for (int dx = -1; dx <= 1; dx++) for (int dy = -1; dy <= 1; dy++) Set(b, Mathf.RoundToInt(x) + dx, Mathf.RoundToInt(y) + dy, c); }
    }
    static void Disc(Color32[] b, float cx, float cy, int r, Color32 c)
    { for (int dx = -r; dx <= r; dx++) for (int dy = -r; dy <= r; dy++) if (dx * dx + dy * dy <= r * r) Set(b, Mathf.RoundToInt(cx) + dx, Mathf.RoundToInt(cy) + dy, c); }

    // ---------------------------------------------------------------- the larva skin (the film's canvas texture)
    public static Texture2D LarvaSkin()
    {
        int W_ = 1024, H = 256; var tex = new Texture2D(W_, H, TextureFormat.RGBA32, true) { name = "LarvaSkin", anisoLevel = 8 };
        var r = new Rng(91); var px = new Color32[W_ * H];
        float[] Mixc(float[] a, float[] b, float u) => new[] { Mix(a[0], b[0], u), Mix(a[1], b[1], u), Mix(a[2], b[2], u) };
        for (int y = 0; y < H; y++) for (int x = 0; x < W_; x++)
        {
            float u = x / (float)W_, phi = (1 - y / (float)H) * 2 * Mathf.PI, back = Mathf.Abs(((phi - Mathf.PI / 2 + 3 * Mathf.PI) % (2 * Mathf.PI)) - Mathf.PI), seg = (u - 0.085f) * 12.2f, fs = seg - Mathf.Floor(seg);
            float[] col = { 104, 86, 58 };
            col = Mixc(col, new float[] { 50, 38, 27 }, 1 - SStep(0.28f, 0.5f, Mathf.Abs(back - 0.78f)));
            col = Mixc(col, new float[] { 176, 164, 124 }, 1 - SStep(0.07f, 0.15f, back));
            col = Mixc(col, new float[] { 162, 142, 92 }, 1 - SStep(0.12f, 0.24f, Mathf.Abs(back - 1.62f)));
            col = Mixc(col, new float[] { 134, 124, 92 }, SStep(2.1f, 2.5f, back));
            float crease = 0.82f + 0.3f * SStep(0, 0.14f, fs) * (1 - SStep(0.86f, 1, fs)); for (int c = 0; c < 3; c++) col[c] *= crease;
            foreach (var (ba, fa) in new[] { (0.34f, 0.38f), (0.95f, 0.62f) })
            {
                float d = Mathf.Sqrt(((back - ba) * 0.13f) * ((back - ba) * 0.13f) + ((fs - fa) / 12.2f) * ((fs - fa) / 12.2f)) * W_ / 8f;
                col = Mixc(col, new float[] { 18, 13, 10 }, 1 - SStep(0.55f, 0.95f, d));
            }
            if (u < 0.085f)
            {
                col = Mixc(new float[] { 104, 62, 26 }, new float[] { 58, 32, 14 }, 0.5f + 0.5f * Mathf.Sin(x * 0.7f + y * 0.42f));
                if (Mathf.Min(Mathf.Abs(back - (0.085f - u) * 6), back < 0.1f && u > 0.04f ? 0 : 9) < 0.09f) col = new float[] { 198, 182, 138 };
            }
            float k = 0.93f + 0.14f * r.Next();
            px[(H - 1 - y) * W_ + x] = new Color32((byte)Mathf.Clamp(col[0] * k, 0, 255), (byte)Mathf.Clamp(col[1] * k, 0, 255), (byte)Mathf.Clamp(col[2] * k, 0, 255), 255);
        }
        tex.SetPixels32(px); tex.Apply(true); return tex;
    }
    /// <summary>The larva tube's topology: (RINGS+1) x (SIDES+1) vertices, wound for the mirrored frame.</summary>
    public static Mesh LarvaMesh()
    {
        var m = new Mesh { name = "Larva" }; var uv = new List<Vector2>(); var idx = new List<int>();
        for (int j = 0; j <= RINGS; j++) for (int i = 0; i <= SIDES; i++) uv.Add(new Vector2(j / (float)RINGS, i / (float)SIDES));
        for (int j = 0; j < RINGS; j++) for (int i = 0; i < SIDES; i++) { int a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1; idx.AddRange(new[] { a, c, b, b, c, d }); }
        m.vertices = new Vector3[uv.Count]; m.SetUVs(0, uv); m.SetTriangles(idx, 0); m.MarkDynamic();
        m.bounds = new Bounds(Vector3.zero, Vector3.one * 1000);
        return m;
    }
}
