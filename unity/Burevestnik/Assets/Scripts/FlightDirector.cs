// Burevestnik game-style film. Everything on screen is a pure function of film time `time`, so the editor can scrub
// any frame and the Recorder gets the same result. Mission time m (0 at kicker ignition) runs slower in the two
// separation slow-motions. World: launch heads +Z, y up, metres. Staging follows site/src/conops/main.js; this is a
// notional visual interpretation, not engineering data.
using AnimationStudio.Film;
using UnityEngine;
using UnityEngine.UI;

[ExecuteAlways]
public class FlightDirector : FilmDirector
{
    public override string OutputName => "burevestnik-game";

    [Header("Vehicle rig (Body is rotated so the GLB's -X nose points along +Z)")]
    public Transform missile;
    public Transform wingR, wingL, fin, stabR, stabL, kicker, boosterR, boosterL;
    public Transform cover;

    [Header("Effects")]
    public Transform flameKicker, flameBoosterR, flameBoosterL, flameCruise;
    public ParticleSystem smokeKicker, smokeBoosterR, smokeBoosterL, padSmoke, sepPuff;
    public Light flash;

    [Header("Camera and HUD")]
    public Camera cam;
    public CanvasGroup hud, titleCard, endCard, fade;
    public Text phase, clock, speedText, altText, aglText, propText, bracketLabel;
    public RectTransform bracket, progressFill, canvasRect;
    public RectTransform[] ticks; public float[] tickMission;   // -1 = sea cliff, -2 = fjord entry
    public float barWidth = 980f;

    // ---- events, mission seconds ----
    public const float T_IGN = 5.6f;                 // film time of kicker ignition
    const float KBO = 2.2f, KSEP = 2.5f, SIGN = 2.9f, SBO = 12.0f, SSEP = 12.5f, M_END = 39.5f;
    const float DEPLOY_F0 = 1.35f, DEPLOY_F1 = 1.85f, DEPLOY_W0 = 1.5f, DEPLOY_W1 = 2.3f;
    const float LAUNCH_ELEV = 18f * Mathf.Deg2Rad, RAIL = 11.4f;
    public static readonly Vector3 P0 = new Vector3(0f, 9.647f, 0.761f);  // missile centre in the canister
    public static readonly Vector3 CANISTER_REAR = new Vector3(0f, 7.58f, -5.61f), CANISTER_MOUTH = new Vector3(0f, 11.24f, 5.66f);

    // rig homes inside Body (GLB frame: nose -X, up +Y, right +Z)
    static readonly Vector3 KICK_HOME = new Vector3(4.755f, 0f, 0f);
    static readonly Vector3 BR_HOME = new Vector3(-0.05f, -0.16f, 0.603f), BL_HOME = new Vector3(-0.05f, -0.16f, -0.603f);

    // ---- path tables ----
    const float DM = 1f / 120f, DT = 1f / 240f;
    [System.NonSerialized] Vector3[] pathPos; [System.NonSerialized] float[] pathV, pathBank, pathPsi, pathGam;
    [System.NonSerialized] float[] filmToMission; [System.NonSerialized] float filmEnd;
    public override float FilmEnd { get { Build(); return filmEnd; } }
    [System.NonSerialized] bool built;

    // ============================================================ terrain (shared with the scene builder)
    static float Fbm(float x, float z, int oct)
    {
        float s = 0f, a = 0.5f, f = 1f, n = 0f;
        for (int i = 0; i < oct; i++) { s += a * Mathf.PerlinNoise(x * f + 31.7f * i, z * f - 17.3f * i); n += a; a *= 0.5f; f *= 2.03f; }
        return s / n;
    }
    static float SStep(float a, float b, float x) { float t = Mathf.Clamp01((x - a) / (b - a)); return t * t * (3f - 2f * t); }
    public static float Coast1(float x) => 3000f + 160f * (Mathf.PerlinNoise(x * 0.0015f, 3.3f) - 0.5f) * 2f;
    public static float Coast2(float x) => 6500f + 220f * (Mathf.PerlinNoise(x * 0.0011f, 9.1f) - 0.5f) * 2f;
    // Heading over horizontal distance flown: straight out to sea, then a slalom through the islands and the fjord.
    public static float HeadingAt(float s)
    {
        float w = SStep(3300f, 4300f, s), u = s - 3300f;
        return w * (14f * Mathf.Sin(u / 1100f) + 4f * Mathf.Sin(u / 520f + 0.6f)) * Mathf.Deg2Rad;
    }
    // The valley is carved along the ground track that heading flies, so the missile can never meet a wall.
    [System.NonSerialized] static float[] trackX; const float TRACK_DZ = 5f;
    public static float Valley(float z)
    {
        if (trackX == null)
        {
            int n = Mathf.CeilToInt(14000f / TRACK_DZ) + 2; trackX = new float[n];
            float x = 0f, zz = 0f, s = 0f; int i = 0;
            while (i < n)
            {
                while (zz < i * TRACK_DZ) { float h = HeadingAt(s); x += Mathf.Sin(h) * 0.5f; zz += Mathf.Cos(h) * 0.5f; s += 0.5f; }
                trackX[i++] = x;
            }
        }
        float f = Mathf.Clamp(z, 0f, 13990f) / TRACK_DZ; int k = Mathf.FloorToInt(f);
        return Mathf.Lerp(trackX[k], trackX[k + 1], f - k);
    }
    public static float Height(float x, float z)
    {
        float n1 = Fbm(x * 0.0009f + 11f, z * 0.0009f + 7f, 4), n2 = Fbm(x * 0.004f + 3f, z * 0.004f + 5f, 3);
        // tundra plateau with the flat launch apron at y = 6, rising to sea cliffs
        float tundra = 9f + (n1 - 0.5f) * 44f + (n2 - 0.5f) * 7f + 26f * SStep(1900f, 2900f, z);
        float d = Mathf.Sqrt(x * x + z * z);
        tundra = Mathf.Lerp(6f, tundra, SStep(80f, 220f, d));
        // sea with rocky islands
        float isl = Fbm(x * 0.0017f + 40f, z * 0.0017f + 90f, 4);
        float sea = -16f + (n2 - 0.5f) * 8f + Mathf.Max(0f, isl - 0.57f) * 650f;
        float h = Mathf.Lerp(tundra, sea, SStep(Coast1(x) - 45f, Coast1(x) + 25f, z));
        // fjord: water in the valley, mountains either side
        float dx = Mathf.Abs(x - Valley(z));
        float wall = SStep(230f, 760f, dx);
        float ridge = 1f - Mathf.Abs(2f * Fbm(x * 0.0032f + 9f, z * 0.0032f + 2f, 4) - 1f);
        float mount = ((0.3f + 0.7f * n1) * 620f + ridge * ridge * 260f) * wall + Fbm(x * 0.011f, z * 0.011f, 3) * 55f * wall - 14f * (1f - wall);
        float c = SStep(Coast2(x) - 250f, Coast2(x) + 500f, z);
        return Mathf.Lerp(h, Mathf.Max(mount, Mathf.Lerp(-14f, h, 1f - wall)), c);
    }
    public static float Ground(float x, float z) => Mathf.Max(Height(x, z), 0f);

    // ============================================================ timing
    static float MissionRate(float m)
    {
        // slow motion through deploy / kicker sep / booster light, and through booster separation
        float r = 1f;
        r = Mathf.Min(r, Mathf.Lerp(1f, 0.28f, SStep(1.30f, 1.45f, m)) + Mathf.Lerp(0f, 0.72f, SStep(3.25f, 3.45f, m)));
        r = Mathf.Min(r, Mathf.Lerp(1f, 0.30f, SStep(12.0f, 12.15f, m)) + Mathf.Lerp(0f, 0.70f, SStep(13.3f, 13.5f, m)));
        return r;
    }

    float Speed(float m)
    {
        if (m <= 0f) return 0f;
        float vK = 35f * KBO, vS = vK - 4f * (SIGN - KBO);
        if (m < KBO) return 35f * m;
        if (m < SIGN) return vK - 4f * (m - KBO);
        if (m < SBO) return vS + (258f - vS) * (1f - Mathf.Exp(-(m - SIGN) / 4.5f)) / (1f - Mathf.Exp(-(SBO - SIGN) / 4.5f));
        return 258f - 10f * (1f - Mathf.Exp(-(m - SBO) / 6f));
    }

    void Build()
    {
        if (built && pathPos != null) return;
        int n = Mathf.CeilToInt((M_END + 2f) / DM) + 2;
        pathPos = new Vector3[n]; pathV = new float[n]; pathBank = new float[n]; pathPsi = new float[n]; pathGam = new float[n];
        Vector3 p = P0; float g = LAUNCH_ELEV, psi = 0f, s = 0f, sh = 0f, bank = 0f;
        for (int i = 0; i < n; i++)
        {
            float m = i * DM, v = Speed(m);
            float psiNext = HeadingAt(sh + v * Mathf.Cos(g) * DM), psiDot = (psiNext - psi) / DM;
            float bankWant = Mathf.Atan(v * psiDot / 9.81f);
            bank = Mathf.MoveTowards(bank, bankWant, 70f * Mathf.Deg2Rad * DM);
            pathPos[i] = p; pathV[i] = v; pathBank[i] = bank; pathPsi[i] = psi; pathGam[i] = g;

            if (s < RAIL) g = LAUNCH_ELEV;
            else if (m < SIGN) g += -0.35f * 9.81f * Mathf.Cos(g) / Mathf.Max(v, 20f) * DM;
            else
            {
                // boost: climb to about 220 m; after booster separation, terrain following 45 m above
                // the highest ground in the next 600 m
                Vector3 f = new Vector3(Mathf.Sin(psi), 0f, Mathf.Cos(psi));
                float hMax = 0f;
                for (int k = 0; k <= 6; k++) { Vector3 q = p + f * (k * 100f); hMax = Mathf.Max(hMax, Ground(q.x, q.z)); }
                bool boost = m < SSEP + 0.6f;
                float target = boost ? 220f : hMax + 45f;
                float vz = Mathf.Clamp((target - p.y) * 0.5f, boost ? -30f : -95f, boost ? 60f : 45f);
                float gWant = Mathf.Clamp(Mathf.Asin(Mathf.Clamp(vz / Mathf.Max(v, 1f), -0.6f, 0.6f)), -0.6f, 20f * Mathf.Deg2Rad);
                g = Mathf.MoveTowards(g, gWant, 14f * Mathf.Deg2Rad * DM);
            }
            psi = psiNext; sh += v * Mathf.Cos(g) * DM;
            Vector3 dir = new Vector3(Mathf.Sin(psi) * Mathf.Cos(g), Mathf.Sin(g), Mathf.Cos(psi) * Mathf.Cos(g));
            p += dir * v * DM; s += v * DM;
        }
        // film time -> mission time
        int nt = 4096 * 8; var list = new System.Collections.Generic.List<float>(nt);
        float mm = -T_IGN, t = 0f;
        while (mm < M_END) { list.Add(mm); mm += (mm < 0f ? 1f : MissionRate(mm)) * DT; t += DT; }
        list.Add(mm);
        filmToMission = list.ToArray();
        filmEnd = (filmToMission.Length - 1) * DT + 3.5f;   // plus the end card
        built = true;
    }

    public float Mission(float t)
    {
        Build();
        float f = Mathf.Max(t, 0f) / DT; int i = Mathf.FloorToInt(f);
        if (i >= filmToMission.Length - 1) return filmToMission[filmToMission.Length - 1];
        return Mathf.Lerp(filmToMission[i], filmToMission[i + 1], f - i);
    }
    public float FilmTimeOf(float m) { Build(); for (int i = 0; i < filmToMission.Length; i++) if (filmToMission[i] >= m) return i * DT; return filmEnd; }

    struct Pose { public Vector3 p, f, r, u, vel; public float v, bank; public Quaternion q; }
    Pose Sample(float m)
    {
        Build();
        m = Mathf.Clamp(m, 0f, M_END + 1.5f);
        float fi = m / DM; int i = Mathf.Min(Mathf.FloorToInt(fi), pathPos.Length - 2); float a = fi - i;
        Pose o;
        o.p = Vector3.Lerp(pathPos[i], pathPos[i + 1], a);
        float g = Mathf.Lerp(pathGam[i], pathGam[i + 1], a), psi = Mathf.Lerp(pathPsi[i], pathPsi[i + 1], a);
        o.f = new Vector3(Mathf.Sin(psi) * Mathf.Cos(g), Mathf.Sin(g), Mathf.Cos(psi) * Mathf.Cos(g));
        o.v = Mathf.Lerp(pathV[i], pathV[i + 1], a); o.bank = Mathf.Lerp(pathBank[i], pathBank[i + 1], a);
        o.q = Quaternion.LookRotation(o.f, Vector3.up) * Quaternion.Euler(0f, 0f, -o.bank * Mathf.Rad2Deg);
        o.r = o.q * Vector3.right; o.u = o.q * Vector3.up; o.vel = o.f * o.v;
        return o;
    }

    // ============================================================ per frame

    public override void Evaluate(float t)
    {
        if (missile == null) return;
        Build();
        float m = Mission(t);
        Pose P = m <= 0f ? Sample(0f) : Sample(m);
        missile.SetPositionAndRotation(P.p, P.q);

        // deploy: wings swing out from over the back, fin and tailplanes unfold
        float df = SStep(DEPLOY_F0, DEPLOY_F1, m), dw = SStep(DEPLOY_W0, DEPLOY_W1, m);
        if (wingR) wingR.localRotation = Quaternion.Euler(0f, 84f * (1f - dw), 0f);
        if (wingL) wingL.localRotation = Quaternion.Euler(0f, -84f * (1f - dw), 0f);
        if (fin) fin.localRotation = Quaternion.Euler(-90f * (1f - df), 0f, 0f);
        if (stabR) stabR.localRotation = Quaternion.Euler(90f * (1f - df), 0f, 0f);
        if (stabL) stabL.localRotation = Quaternion.Euler(-90f * (1f - df), 0f, 0f);

        Detach(kicker, KICK_HOME, m, KSEP, new Vector3(0f, -1.2f, -7f), new Vector3(70f, 25f, 160f), 0.12f);
        Detach(boosterR, BR_HOME, m, SSEP, new Vector3(5.5f, -2f, -3f), new Vector3(40f, 110f, -60f), 0.35f);
        Detach(boosterL, BL_HOME, m, SSEP, new Vector3(-5.5f, -2f, -3f), new Vector3(-30f, -120f, 70f), 0.35f);

        // canister cover blows off at ignition
        if (cover)
        {
            float d = Mathf.Max(m + 0.05f, 0f);
            Vector3 axis = new Vector3(0f, Mathf.Sin(LAUNCH_ELEV), Mathf.Cos(LAUNCH_ELEV));
            cover.position = CANISTER_MOUTH +(axis * 26f + new Vector3(3f, 7f, 0f)) * d + 0.5f * Physics.gravity * d * d;
            cover.rotation = Quaternion.LookRotation(axis) * Quaternion.Euler(d * 400f, d * 130f, 0f);
            if (cover.position.y < Ground(cover.position.x, cover.position.z) + 0.05f && d > 0.5f)
                cover.position = new Vector3(cover.position.x, Ground(cover.position.x, cover.position.z) + 0.05f, cover.position.z);
        }

        // flames
        float flick = 0.85f + 0.15f * Mathf.PerlinNoise(t * 31f, 0.3f);
        float kOn = m >= 0f && m < KBO ? SStep(0f, 0.05f, m) * (1f - SStep(KBO - 0.25f, KBO, m)) : 0f;
        float sOn = m >= SIGN && m < SBO ? SStep(SIGN, SIGN + 0.18f, m) * (1f - SStep(SBO - 1.2f, SBO, m)) : 0f;
        float cOn = SStep(SSEP + 0.3f, SSEP + 2.5f, m);
        SetFlame(flameKicker, kOn * flick, 1f);
        SetFlame(flameBoosterR, sOn * (0.9f + 0.1f * Mathf.PerlinNoise(t * 27f, 1.7f)), 1f);
        SetFlame(flameBoosterL, sOn * (0.9f + 0.1f * Mathf.PerlinNoise(t * 29f, 4.1f)), 1f);
        SetFlame(flameCruise, cOn * (0.92f + 0.08f * Mathf.PerlinNoise(t * 19f, 8f)), 1f);
        Emit(smokeKicker, kOn > 0.05f); Emit(smokeBoosterR, sOn > 0.05f && m < SSEP); Emit(smokeBoosterL, sOn > 0.05f && m < SSEP);
        if (padSmoke) { var e = padSmoke.emission; e.enabled = m > 0f && m < 1.6f; }
        if (sepPuff) { var e = sepPuff.emission; e.enabled = (m > KSEP && m < KSEP + 0.15f) || (m > SSEP && m < SSEP + 0.25f); sepPuff.transform.position = P.p - P.f * 2f; }
        if (flash) { flash.transform.position = m < 1f ? CANISTER_REAR + Vector3.up : P.p - P.f * 6f; flash.intensity = 45f * kOn * flick * (m < 1.2f ? 1f : 0.35f) + 22f * sOn * flick; }

        CameraShot(t, m, P);
        Hud(t, m, P);
    }

    void Detach(Transform part, Vector3 home, float m, float mSep, Vector3 kick, Vector3 spin, float drag)
    {
        if (!part) return;
        Transform body = part.parent;
        if (m < mSep) { part.localPosition = home; part.localRotation = Quaternion.identity; return; }
        // Ballistic from the moment of separation; written in world space, then back into Body's frame.
        Pose S = Sample(mSep);
        Vector3 world0 = S.p + S.q * (Quaternion.Euler(0f, 90f, 0f) * home);
        Vector3 v0 = S.vel + S.q * kick;
        float d = m - mSep, k = drag;
        Vector3 pos = world0 + v0 * ((1f - Mathf.Exp(-k * d)) / k) + 0.5f * Physics.gravity * d * d;
        float gy = Ground(pos.x, pos.z) + 0.3f; if (pos.y < gy) pos.y = gy;
        Quaternion rot = S.q * Quaternion.Euler(0f, 90f, 0f) * Quaternion.Euler(spin * d);
        part.position = pos; part.rotation = rot;
    }

    static void SetFlame(Transform f, float k, float len)
    {
        if (!f) return;
        bool on = k > 0.01f; if (f.gameObject.activeSelf != on) f.gameObject.SetActive(on);
        if (on) f.localScale = new Vector3(Mathf.Lerp(0.6f, 1f, k), Mathf.Lerp(0.6f, 1f, k), k * len);
    }
    static void Emit(ParticleSystem ps, bool on) { if (!ps) return; var e = ps.emission; e.enabled = on; }

    // ============================================================ cameras
    [System.NonSerialized] float mCliff = -1f, mFjord = -1f;
    void FindMarks()
    {
        if (mCliff > 0f) return;
        for (float m = SSEP; m < M_END; m += 0.05f) { var s = Sample(m); if (mCliff < 0f && s.p.z > Coast1(s.p.x)) mCliff = m; if (mFjord < 0f && s.p.z > Coast2(s.p.x) + 300f) { mFjord = m; break; } }
        if (mCliff < 0f) mCliff = 18f; if (mFjord < 0f) mFjord = 30f;
    }

    void CameraShot(float t, float m, Pose P)
    {
        if (!cam) return;
        FindMarks();
        Vector3 pos, look; float fov, roll = 0f, shake = 0f;
        Quaternion flat = Quaternion.LookRotation(Vector3.ProjectOnPlane(P.f, Vector3.up).normalized + Vector3.forward * 1e-4f, Vector3.up);
        Vector3 F = flat * Vector3.forward, R = flat * Vector3.right, U = Vector3.up;
        float ign = SStep(-0.05f, 0.1f, m);

        if (t < 4.6f)
        {   // 1 establishing: dawn orbit round the launcher
            float u = SStep(0f, 4.6f, t);
            float a = Mathf.Lerp(208f, 152f, u) * Mathf.Deg2Rad, r = Mathf.Lerp(150f, 62f, u);
            pos = new Vector3(Mathf.Cos(a) * r, Mathf.Lerp(62f, 15f, u), Mathf.Sin(a) * r);
            look = new Vector3(0f, 8f, 3f); fov = 42f;
        }
        else if (m < 1.30f)
        {   // 2 ground camera at the canister mouth: cover off, missile out
            pos = new Vector3(-17f, 7.6f, 19f);
            look = Vector3.Lerp(CANISTER_MOUTH + Vector3.down * 0.5f, P.p + P.f * 3f, SStep(0.25f, 1.1f, m));
            fov = Mathf.Lerp(40f, 46f, ign); shake = 0.9f * ign * (1f - SStep(0.6f, 1.3f, m)) + 0.05f;
        }
        else if (m < 3.45f)
        {   // 3 tracking alongside in slow motion: unfold, kicker away, boosters light
            float u = SStep(1.3f, 3.45f, m);
            pos = P.p + R * 15.5f + U * 2.2f + F * Mathf.Lerp(4f, -5f, u);
            look = P.p + F * 0.2f; fov = 34f; shake = 0.04f + 0.25f * SStep(SIGN, SIGN + 0.2f, m);
        }
        else if (m < 7.8f)
        {   // 4a chase on the climb
            float u = SStep(3.45f, 7.8f, m);
            pos = P.p - P.f * Mathf.Lerp(16f, 21f, u) + U * Mathf.Lerp(2.2f, 3.5f, u) + R * Mathf.Lerp(-3f, 2f, u);
            look = P.p + P.f * 22f; fov = 46f; shake = 0.12f;
        }
        else if (m < 12.0f)
        {   // 4b long lens from below and to the side, boosters burning out over the tundra
            Pose A = Sample(10.5f);
            pos = A.p + Vector3.Cross(Vector3.up, A.f).normalized * 260f - A.f * 120f; pos.y = Ground(pos.x, pos.z) + 6f;
            look = P.p; fov = Mathf.Lerp(16f, 11f, SStep(7.8f, 12f, m));
        }
        else if (m < 13.6f)
        {   // 5 booster separation, slow motion, rear quarter close in
            pos = P.p - P.f * 9.5f + P.r * 3.6f + P.u * 1.6f; look = P.p + P.f * 3f; fov = 44f; shake = 0.06f;
        }
        else if (m < mCliff - 1.4f)
        {   // 6 dive to the deck: aerial telephoto from the flank, above the hills
            pos = P.p + R * 150f - F * 40f + U * 28f; pos.y = Mathf.Max(pos.y, Ground(pos.x, pos.z) + 45f);
            look = P.p + F * 8f; fov = 15f;
        }
        else if (m < mCliff + 1.0f)
        {   // 7 flyby: camera on the cliff top as it streaks out to sea
            // a drone holding just off the cliff edge, a little below the flight line
            Pose A = Sample(mCliff + 0.15f);
            pos = A.p + Vector3.Cross(Vector3.up, A.f).normalized * 28f + A.f * 10f + Vector3.down * 7f;
            look = Vector3.Lerp(A.p - A.f * 150f, P.p, SStep(mCliff - 1.4f, mCliff - 0.9f, m)); fov = 50f;
            shake = 0.3f * Mathf.Exp(-Mathf.Pow((m - mCliff - 0.15f) * 4f, 2f));
        }
        else if (m < mCliff + 5.5f)
        {   // 8a low chase over the sea and ice
            pos = P.p - P.f * 13f + U * 0.9f + R * 1.5f * Mathf.Sin(m * 0.8f); look = P.p + P.f * 30f;
            fov = 58f; roll = -P.bank * Mathf.Rad2Deg * 0.12f; shake = 0.08f;
        }
        else if (m < mCliff + 10f)
        {   // 8b skimming the water: camera near the waterline, the missile banking past above the ice
            float u = SStep(mCliff + 5.5f, mCliff + 10f, m);
            pos = P.p + R * Mathf.Lerp(34f, 24f, u) + F * Mathf.Lerp(22f, -16f, u) + Vector3.down * 14f;
            look = P.p + Vector3.down * 4f; fov = 48f; shake = 0.05f;
        }
        else if (m < mCliff + 13f)
        {   // 8c high chase through the island slalom
            pos = P.p - F * 48f + U * 22f; look = P.p + F * 25f; fov = 44f; roll = -P.bank * Mathf.Rad2Deg * 0.1f;
        }
        else if (m < mFjord - 0.5f)
        {   // 8d over the shoulder, looking ahead to the fjord mouth
            pos = P.p - P.f * 6.5f + P.u * 1.6f; look = P.p + P.f * 120f + P.u * 3f;
            fov = 62f; roll = -P.bank * Mathf.Rad2Deg * 0.6f; shake = 0.05f;
        }
        else if (m < M_END - 4.5f)
        {   // 9 head-on through the fjord, the camera flying ahead of it
            float u = SStep(mFjord - 0.5f, M_END - 4.5f, m);
            pos = P.p + P.f * Mathf.Lerp(30f, 15f, u) + U * 2.5f + R * Mathf.Lerp(4f, -3f, u); look = P.p - P.f * 2f;
            fov = 42f; roll = P.bank * Mathf.Rad2Deg * 0.15f; shake = 0.06f;
        }
        else
        {   // 10 it goes on down the fjord into the haze
            Pose A = Sample(M_END - 4.5f);
            pos = A.p - A.f * 30f + Vector3.up * 6f; look = P.p; fov = Mathf.Lerp(40f, 22f, SStep(M_END - 4.5f, M_END, m));
        }

        float gy = Ground(pos.x, pos.z) + 1.2f; if (pos.y < gy) pos.y = gy;
        Vector3 sh = new Vector3(Mathf.PerlinNoise(t * 23f, 0f) - 0.5f, Mathf.PerlinNoise(0f, t * 23f) - 0.5f, Mathf.PerlinNoise(t * 17f, 7f) - 0.5f) * shake;
        cam.transform.position = pos + sh * 0.6f;
        cam.transform.rotation = Quaternion.LookRotation(look - pos, Vector3.up) * Quaternion.Euler(sh.y * 3f, sh.x * 3f, roll + sh.z * 4f);
        cam.fieldOfView = fov;
    }

    // ============================================================ HUD
    void Hud(float t, float m, Pose P)
    {
        if (!hud) return;
        float end = (filmToMission.Length - 1) * DT;
        if (titleCard) titleCard.alpha = SStep(0.4f, 1.4f, t) * (1f - SStep(3.6f, 4.5f, t));
        if (hud) hud.alpha = SStep(3.8f, 4.8f, t) * (1f - SStep(end - 1.5f, end - 0.5f, t));
        if (endCard) endCard.alpha = SStep(end - 0.2f, end + 1.0f, t);
        if (fade) fade.alpha = 1f - SStep(0f, 0.8f, t);

        string ph = m < 0f ? "PRE-LAUNCH" : m < KBO ? "HOT LAUNCH  //  KICKER" : m < KSEP ? "WINGS DEPLOYED" : m < SIGN ? "KICKER SEPARATION" : m < SBO ? "BOOST  //  TWIN SRB" :
                    m < SSEP + 1f ? "BOOSTER SEPARATION" : m < SSEP + 3f ? "REACTOR CRITICAL" : m < mCliff + 1f ? "NUCLEAR CRUISE" : m < mFjord ? "TERRAIN FOLLOWING  //  SEA" : "TERRAIN FOLLOWING  //  FJORD";
        if (phase) phase.text = ph;
        if (clock)
        {
            float mm = Mathf.Abs(m); string sign = m < 0f ? "T-" : "T+";
            clock.text = $"{sign}{Mathf.FloorToInt(mm / 60f):00}:{mm % 60f:00.0}";
        }
        float v = m > 0f ? P.v : 0f, agl = P.p.y - Ground(P.p.x, P.p.z);
        if (speedText) speedText.text = $"{v / 340f:0.00} M\n<size=22>{v:000} m/s</size>";
        if (altText) altText.text = $"{P.p.y:0000} m\n<size=22>ALT MSL</size>";
        if (aglText) aglText.text = $"AGL {Mathf.Max(agl, 0f):000} m";
        if (propText) propText.text = "PROPULSION   " + (m < 0f ? "IN CANISTER" : m < KBO ? "SOLID KICKER" : m < SIGN ? "COAST" : m < SBO ? "TWIN SOLID BOOSTERS" : m < SSEP + 2.5f ? "TURBOJET  >  NUCLEAR" : "DIRECT-CYCLE NUCLEAR (NOTIONAL)");
        float span = end - T_IGN;
        if (progressFill) progressFill.anchorMax = new Vector2(Mathf.Clamp01((t - T_IGN) / span), 1f);
        if (ticks != null && tickMission != null)
            for (int i = 0; i < ticks.Length && i < tickMission.Length; i++)
            {
                float tm = tickMission[i] == -1f ? mCliff : tickMission[i] == -2f ? mFjord : tickMission[i];
                ticks[i].anchoredPosition = new Vector2((Mathf.Clamp01((FilmTimeOf(tm) - T_IGN) / span) - 0.5f) * barWidth, ticks[i].anchoredPosition.y);
            }

        // target bracket on the missile
        if (bracket && canvasRect)
        {
            Vector3 sp = cam.WorldToViewportPoint(P.p);
            bool vis = sp.z > 0f && sp.x > -0.05f && sp.x < 1.05f && sp.y > -0.05f && sp.y < 1.05f && t > 4.6f;
            bracket.gameObject.SetActive(vis);
            if (vis)
            {
                Vector2 size = canvasRect.rect.size;
                bracket.anchoredPosition = new Vector2((sp.x - 0.5f) * size.x, (sp.y - 0.5f) * size.y);
                float px = 9.5f / (2f * sp.z * Mathf.Tan(cam.fieldOfView * 0.5f * Mathf.Deg2Rad)) * size.y;
                float s = Mathf.Clamp(px * 0.9f, 46f, 520f);
                bracket.sizeDelta = new Vector2(s, s * 0.62f);
                if (bracketLabel) bracketLabel.text = $"9M730  {sp.z:0} m";
            }
        }
    }
}
