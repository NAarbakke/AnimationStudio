// The world of site/src/x12/main.js, in the film's frame (+y up, the fjord along +x): the Gerstner swell (the same eight
// waves on the CPU here and in the water shader), the fjord's height function, the boat's track and its motion on the
// sea, the escort group and the attack drone's run. Pure functions of time; the director and the scene builder share them.
using AnimationStudio.Film;
using UnityEngine;
using static AnimationStudio.Film.F;

public static class X12World
{
    public const float DUR = 78f;
    public const float VD = 52f, T_PASS = 64f, T_DET = 53.6f, T_TRK = 55.2f, T_ID = 58.4f, T_L = 61.2f, T_I = 65.2f;

    // ---------------------------------------------------------------- sea
    public struct Wave { public float L, k, A, w, dx, dz, Q, ph; }
    public static readonly Wave[] WAVES = MakeWaves();
    static Wave[] MakeWaves()
    {
        float[,] src = { { 48, 0.52f, 180 }, { 31, 0.36f, 160 }, { 22, 0.26f, 205 }, { 14, 0.15f, 170 }, { 9, 0.09f, 195 }, { 6, 0.055f, 150 }, { 3.8f, 0.032f, 215 }, { 2.4f, 0.018f, 175 } };
        var o = new Wave[8];
        for (int i = 0; i < 8; i++)
        {
            float L = src[i, 0], A = src[i, 1] * (L > 10 ? 1.3f : 1f), deg = src[i, 2], k = 2 * Mathf.PI / L;
            o[i] = new Wave { L = L, k = k, A = A, w = Mathf.Sqrt(G * k), dx = Mathf.Cos(deg * DEG), dz = Mathf.Sin(deg * DEG), Q = 0.8f / (k * A * 8), ph = i * 1.7f };
        }
        return o;
    }
    public static Vector3 WaveDisp(float x, float z, float t)
    {
        float dx = 0, dy = 0, dz = 0;
        foreach (var w in WAVES) { float f = w.k * (w.dx * x + w.dz * z) - w.w * t + w.ph, c = Mathf.Cos(f); dx += w.Q * w.A * w.dx * c; dz += w.Q * w.A * w.dz * c; dy += w.A * Mathf.Sin(f); }
        return new Vector3(dx, dy, dz);
    }
    /// <summary>Sea surface height at (x, z): undo the horizontal Gerstner shift first.</summary>
    public static float SeaH(float x, float z, float t)
    {
        float px = x, pz = z;
        for (int i = 0; i < 4; i++) { var d = WaveDisp(px, pz, t); px = x - d.x; pz = z - d.z; }
        return WaveDisp(px, pz, t).y;
    }

    // ---------------------------------------------------------------- fjord
    static readonly int[] perm = MakePerm();
    static int[] MakePerm()
    {
        var r = new Rng(1234); var p = new int[256]; for (int i = 0; i < 256; i++) p[i] = i;
        for (int i = 255; i > 0; i--) { int j = Mathf.FloorToInt(r.Next() * (i + 1)); (p[i], p[j]) = (p[j], p[i]); }
        var o = new int[512]; for (int i = 0; i < 512; i++) o[i] = p[i & 255]; return o;
    }
    static float Grad(int h, float x, float y) { float a = h * 0.7853981634f; return Mathf.Cos(a) * x + Mathf.Sin(a) * y; }
    public static float Noise2(float x, float y)
    {
        float X = Mathf.Floor(x), Y = Mathf.Floor(y), fx = x - X, fy = y - Y; int xi = (int)X & 255, yi = (int)Y & 255;
        float u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
        int aa = perm[perm[xi] + yi], ab = perm[perm[xi] + yi + 1], ba = perm[perm[xi + 1] + yi], bb = perm[perm[xi + 1] + yi + 1];
        return Mix(Mix(Grad(aa, fx, fy), Grad(ba, fx - 1, fy), u), Mix(Grad(ab, fx, fy - 1), Grad(bb, fx - 1, fy - 1), u), v);
    }
    public static float Fbm(float x, float y, int o = 5) { float s = 0, a = 0.5f, f = 1; for (int i = 0; i < o; i++) { s += a * Noise2(x * f + i * 17.3f, y * f - i * 9.1f); f *= 2.03f; a *= 0.5f; } return s; }
    public static float Ridged(float x, float y, int o = 6)
    {
        float s = 0, a = 0.55f, f = 1, w = 1;
        for (int i = 0; i < o; i++) { float n = 1 - Mathf.Abs(Noise2(x * f + i * 31.7f, y * f + i * 7.9f)); n *= n * w; w = Clamp(n * 1.6f, 0, 1); s += a * n; f *= 2.07f; a *= 0.48f; }
        return s;
    }
    public static float FjordC(float x) => 70 * Mathf.Sin(x / 1300 + 0.5f) + 0.00011f * Mathf.Pow(Mathf.Max(0, x - 2600), 2);
    public static float FjordW(float x) => 820 + 170 * Mathf.Sin(x / 1700 + 1.2f) + 120 * Mathf.Sin(x / 640);
    public static float BoatZ(float x) => 0.35f * FjordC(x) + 28 * Mathf.Sin(x / 380 + 0.4f);
    public static readonly Vector3 JUNCTION = new Vector3(1000, 0, FjordC(1000) - FjordW(1000) + 40);
    static readonly Vector2 SIDE_DIR = new Vector2(-0.25f, -0.97f).normalized;
    public static float LandDist(float x, float z)
    {
        float wig = 55 * Fbm(x / 420, z / 420, 3);
        float dm = Mathf.Abs(z - FjordC(x)) - FjordW(x) + wig;
        dm -= 4200 * SStep(-3300, -5600, x);
        float rx = x - JUNCTION.x, rz = z - JUNCTION.z, along = rx * SIDE_DIR.x + rz * SIDE_DIR.y, perp = Mathf.Abs(rx * SIDE_DIR.y - rz * SIDE_DIR.x);
        float ds = along > -400 ? perp - (240 + 0.04f * Mathf.Max(along, 0)) + wig * 0.6f : 1e4f;
        float k = 160, hh = Clamp(0.5f + 0.5f * (ds - dm) / k, 0, 1);
        return Mix(ds, dm, hh) - k * hh * (1 - hh);
    }
    public static float TerrainH(float x, float z)
    {
        float d = LandDist(x, z);
        float skerry = x < -2600 ? Mathf.Max(0, Fbm(x / 160, z / 160, 4) - 0.28f) * 260 * SStep(-2600, -3400, x) : 0;
        if (d < 0) return Mathf.Max(-45 + d * 0.05f, skerry > 0 ? skerry - 8 : -1e9f);
        float valley = 0.4f + 0.6f * SStep(0.12f, 0.7f, Mathf.Abs(Mathf.Sin(x / 1150 * Mathf.PI + 1.3f * Noise2(x / 3000, z / 3000))));
        float rg = Ridged(x / 2300, z / 2300), pk = Ridged(x / 900 + 11, z / 900 - 4, 4);
        float M = (300 + 820 * Mathf.Pow(rg, 1.25f) + 260 * pk * rg) * valley * (1 - 0.75f * SStep(-3000, -5200, x));
        float rise = Mathf.Pow(1 - Mathf.Exp(-d / 280), 0.85f);
        return 2 + M * rise + 40 * Fbm(x / 230, z / 230, 4) * rise + Mathf.Min(d * 0.25f, 6) + skerry;
    }

    // ---------------------------------------------------------------- boat track
    const float X0 = -760f; public const float DW = 1f / 60f;
    public static float Speed(float w) => w < 5.5f ? 21 : w < 12 ? Mix(21, 7, SStep(5.5f, 12, w)) : w < 46 ? 7 : w < 69 ? Mix(7, 23.5f, SStep(46, 51.5f, w)) : Mix(23.5f, 15, SStep(69, 76, w));
    static double[] bx, bz; static float[] by, byaw, bpitch, broll, bv, bbowV; static int NP;
    static void BuildBoat()
    {
        if (bx != null) return;
        NP = Mathf.CeilToInt((DUR + 2) / DW) + 2;
        bx = new double[NP]; bz = new double[NP]; by = new float[NP]; byaw = new float[NP]; bpitch = new float[NP]; broll = new float[NP]; bv = new float[NP]; bbowV = new float[NP];
        var rh = new float[NP]; var rp = new float[NP]; var rr = new float[NP]; double s = 0;
        for (int i = 0; i < NP; i++)
        {
            float w = i * DW; if (i > 0) s += Speed(w - DW / 2) * DW;
            float x = (float)(X0 + s), z = BoatZ(x), dz = BoatZ(x + 0.5f) - BoatZ(x - 0.5f);
            float yaw = Mathf.Atan2(dz, 1) + 0.025f * Mathf.Sin(0.6f * w) + 0.012f * Mathf.Sin(1.7f * w + 1);
            bx[i] = x; bz[i] = z; byaw[i] = yaw; bv[i] = Speed(w);
            float c = Mathf.Cos(yaw), sn = Mathf.Sin(yaw);
            float At(float fx, float fz) => SeaH(x + c * fx - sn * fz, z + sn * fx + c * fz, w);
            float hb = At(4.2f, 0), hs = At(-4.6f, 0), hp = At(0, -1.6f), hst = At(0, 1.6f);
            rh[i] = (hb + hs + hp + hst) / 4; rp[i] = Mathf.Atan2(hb - hs, 8.8f); rr[i] = -Mathf.Atan2(hst - hp, 3.2f);
        }
        float[] Smooth(float[] a, float sig)
        {
            int R = Mathf.CeilToInt(sig * 3 / DW); var ker = new float[2 * R + 1]; for (int k = 0; k <= 2 * R; k++) ker[k] = Mathf.Exp(-((k - R) * DW) * ((k - R) * DW) / (2 * sig * sig));
            var o = new float[NP];
            for (int i = 0; i < NP; i++) { float sum = 0, ws = 0; for (int k = -R; k <= R; k++) { int j = Mathf.Clamp(i + k, 0, NP - 1); sum += a[j] * ker[k + R]; ws += ker[k + R]; } o[i] = sum / ws; }
            return o;
        }
        var h = Smooth(rh, 0.16f); var p = Smooth(rp, 0.17f); var r = Smooth(rr, 0.26f);
        for (int i = 0; i < NP; i++)
        {
            float v = bv[i], plane = SStep(9, 19, v), yr = (byaw[Mathf.Min(i + 1, NP - 1)] - byaw[Mathf.Max(i - 1, 0)]) / (2 * DW);
            by[i] = h[i] * 0.95f + 0.18f * plane - 0.16f;
            bpitch[i] = p[i] * (0.85f + 0.35f * plane) + (4.2f * SStep(4, 10, v) - 1.8f * SStep(12, 22, v)) * DEG;
            broll[i] = r[i] * 0.75f - yr * v * 0.03f;
        }
        // the transom's buoyancy: where a crest would climb the outboards, lift the hull and trim the stern up, smoothly
        for (int pass = 0; pass < 3; pass++)
        {
            var ex = new float[NP];
            for (int i = 0; i < NP; i++)
            {
                float c = Mathf.Cos(byaw[i]), sn = Mathf.Sin(byaw[i]), w = i * DW;
                float hw = SeaH((float)bx[i] - c * 5.9f, (float)bz[i] - sn * 5.9f, w);
                ex[i] = Mathf.Max(0, hw - (by[i] - 5.9f * Mathf.Sin(bpitch[i])) - 0.18f);
            }
            int R = Mathf.RoundToInt(0.25f / DW); var mx = new float[NP];
            for (int i = 0; i < NP; i++) { float m = 0; for (int k = -R; k <= R; k++) m = Mathf.Max(m, ex[Mathf.Clamp(i + k, 0, NP - 1)]); mx[i] = m; }
            var e = Smooth(mx, 0.12f);
            for (int i = 0; i < NP; i++) { by[i] += 0.6f * e[i]; bpitch[i] -= 0.45f * e[i] / 5.9f; }
        }
        for (int i = 0; i < NP; i++) { int a = Mathf.Max(0, i - 2), b = Mathf.Min(NP - 1, i + 2); bbowV[i] = ((by[b] + 4 * Mathf.Sin(bpitch[b])) - (by[a] + 4 * Mathf.Sin(bpitch[a]))) / ((b - a) * DW); }
    }
    public struct Boat { public Vector3 pos, Fh, Rh, vel; public Quaternion q; public Matrix4x4 m; public float v, bowV, yaw; }
    /// <summary>Boat state at world time w; soft scales pitch and roll (the tour keeps the deck steadier on screen).</summary>
    public static Boat BoatAt(float w, float soft = 1f)
    {
        BuildBoat();
        float f = Clamp(w / DW, 0, NP - 2.001f); int i = (int)f; float k = f - i;
        float L(float[] a) => Mix(a[i], a[i + 1], k);
        Boat o; o.yaw = L(byaw);
        o.pos = new Vector3((float)(bx[i] + (bx[i + 1] - bx[i]) * k), L(by), (float)(bz[i] + (bz[i + 1] - bz[i]) * k));
        o.q = EulerYZX(L(broll) * soft, -o.yaw, L(bpitch) * soft);
        o.m = Matrix4x4.TRS(o.pos, o.q, Vector3.one);
        o.Fh = new Vector3(Mathf.Cos(o.yaw), 0, Mathf.Sin(o.yaw)); o.Rh = new Vector3(-Mathf.Sin(o.yaw), 0, Mathf.Cos(o.yaw));
        o.v = L(bv); o.bowV = L(bbowV); o.vel = o.Fh * o.v;
        return o;
    }
    public static Vector3 ToWorld(in Boat b, float x, float y, float z) => b.m.MultiplyPoint3x4(new Vector3(x, y, z));

    // ---------------------------------------------------------------- escort group and threat
    public struct Ship { public string kind; public float L, B, dx, dz; }
    public static readonly Ship[] SHIPS = {
        new Ship { kind = "cargo", L = 86, B = 14, dx = 0, dz = 40 },
        new Ship { kind = "patrol", L = 58, B = 9.5f, dx = 190, dz = -150 },
        new Ship { kind = "supply", L = 48, B = 11, dx = -210, dz = 170 },
    };
    public static float ConvoyX(float t) => 1200 + 6.5f * (t - 60);
    public static Vector3 ShipPos(in Ship s, float t) { float x = ConvoyX(t) + s.dx; return new Vector3(x, 0, 0.35f * FjordC(x) + s.dz); }
    public static readonly Vector3 DIR_IN = MakeDirIn();
    static Vector3 MakeDirIn() { var c = ShipPos(SHIPS[0], 72); return new Vector3(c.x - JUNCTION.x, 0, c.z - JUNCTION.z).normalized; }
    public static readonly Vector3 SIDE3 = new Vector3(-DIR_IN.z, 0, DIR_IN.x);
    public static Vector3 DroneAt(float t)
    {
        var p = JUNCTION + DIR_IN * ((t - T_PASS) * VD) + SIDE3 * (6 * Mathf.Sin(t * 0.7f));
        p.y = 46 + 3 * Mathf.Sin(t * 0.55f) - 0.6f * (t - 50); return p;
    }
    public static readonly Vector3 I_PT = DroneAt(T_I);
}
