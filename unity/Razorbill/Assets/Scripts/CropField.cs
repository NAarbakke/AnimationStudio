// The maize and the hedge trees of site/src/drone/main.js (addCrops, addTrees): the same seeded placements, drawn with
// GPU instancing. The film stands about 313 000 plants; only those near the flight's ground track (where the cameras get
// low) and round the drop point are drawn here, the painted rows of the ground texture carry the rest. The plants round
// the rod and in a lane toward the macro camera shrink away as `reveal` goes from 0 to 1, as they fade in the film.
using System.Collections.Generic;
using AnimationStudio.Film;
using UnityEngine;
using UnityEngine.Rendering;
using static AnimationStudio.Film.F;

[ExecuteAlways]
public class CropField : MonoBehaviour
{
    public Mesh[] hero = new Mesh[3], field = new Mesh[3], tree = new Mesh[3], treeFar = new Mesh[3];
    public Material plantMat;
    public Vector2[] track;            // the flight's ground track, film frame (x, z)
    public float keepDistance = 16f;
    [Range(0, 1)] public float reveal;
    [HideInInspector] public Vector3 impact;
    public int drawn;

    const float HERO_R = 12f;
    List<Matrix4x4>[] batches;         // 0..2 hero, 3..5 field, 6..8 tree, 9..11 far tree
    struct Rev { public Vector3 p; public Matrix4x4 m; public int mesh; }
    List<Rev> rev; List<Matrix4x4>[] revNow;
    Matrix4x4[] chunk = new Matrix4x4[1023];

    void OnEnable() { batches = null; RenderPipelineManager.beginCameraRendering += Draw; }
    void OnDisable() { RenderPipelineManager.beginCameraRendering -= Draw; }

    static Matrix4x4 ToUnity(Vector3 p, float ang, Vector3 s) => Matrix4x4.TRS(U(p), U(AxisAngle(Vector3.up, ang)) * ModelFix, s);

    void Build()
    {
        batches = new List<Matrix4x4>[12]; for (int i = 0; i < 12; i++) batches[i] = new List<Matrix4x4>();
        rev = new List<Rev>(); revNow = new List<Matrix4x4>[3]; for (int i = 0; i < 3; i++) revNow[i] = new List<Matrix4x4>();
        // ground-track buckets for the near test
        var cells = new Dictionary<long, List<Vector2>>(); float cs = keepDistance;
        long Key(int a, int b) => ((long)a << 32) ^ (uint)b;
        if (track != null) foreach (var p in track) { var k = Key(Mathf.FloorToInt(p.x / cs), Mathf.FloorToInt(p.y / cs)); if (!cells.TryGetValue(k, out var l)) cells[k] = l = new List<Vector2>(); l.Add(p); }
        bool Near(float x, float z)
        {
            int cx = Mathf.FloorToInt(x / cs), cz = Mathf.FloorToInt(z / cs); float d2 = keepDistance * keepDistance;
            for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) if (cells.TryGetValue(Key(cx + a, cz + b), out var l)) foreach (var p in l) if ((p.x - x) * (p.x - x) + (p.y - z) * (p.y - z) < d2) return true;
            return false;
        }

        Vector3 imp = RazorbillDirector.IMPACT, dir = RazorbillDirector.CAM_DIR, cam = imp + dir * RazorbillDirector.IMPACT_CAM_D;
        float ROW = RazorbillDirector.ROW, X0 = RazorbillDirector.PX0, X1 = RazorbillDirector.PX1, PZ = RazorbillDirector.PZ;
        // addCrops: the same rng calls in the same order as the film
        var r = new Rng(11); var list = new List<Vector2>(320000);
        for (int k = Mathf.CeilToInt(-PZ / ROW); k <= Mathf.FloorToInt(PZ / ROW); k++)
        {
            float z = k * ROW; if (RazorbillDirector.TRAM(z) < 1.3f) continue;
            for (float x = X0; x < X1; x += 0.09f + r.Next() * 0.05f) list.Add(new Vector2(x + (r.Next() - 0.5f) * 0.06f, z + (r.Next() - 0.5f) * 0.07f));
        }
        foreach (var q in list)
        {
            float x = q.x, z = q.y, edge = Mathf.Min(x - X0, X1 - x, PZ - Mathf.Abs(z));
            float s = (0.9f + r.Next() * 0.15f) * Mix(0.35f, 1f, SStep(0, 10, edge)), ang = r.Next() * 6.283f, sy = Mix(0.35f, 1f, SStep(0, 10, edge)) * (0.93f + r.Next() * 0.12f);
            r.Next(); r.Next(); r.Next();                      // the film's per-instance tint
            float dx = x - imp.x, dz = z - imp.z, dist = Mathf.Sqrt(dx * dx + dz * dz);
            int variant = Mathf.FloorToInt(r.Next() * 3); bool isHero = dist < HERO_R;
            if (Mathf.Sqrt((x - cam.x) * (x - cam.x) + (z - cam.z) * (z - cam.z)) < 0.5f) continue;   // nothing in front of the lens
            float along = Clamp(dx * dir.x + dz * dir.z, 0, RazorbillDirector.REVEAL_LENGTH);
            float lane = Mathf.Sqrt((dx - dir.x * along) * (dx - dir.x * along) + (dz - dir.z * along) * (dz - dir.z * along));
            bool fades = lane < RazorbillDirector.REVEAL_LANE || dist < RazorbillDirector.REVEAL_CIRCLE;
            if (!isHero && !Near(x, z)) continue;
            var p = new Vector3(x, 0, z); var m = ToUnity(p, ang, new Vector3(s, sy, s));
            if (fades) rev.Add(new Rev { p = p, m = m, mesh = variant });
            else batches[(isHero ? 0 : 3) + variant].Add(m);
        }
        // addTrees
        var t = new Rng(5); var spots = new List<Vector2>();
        float FX0 = RazorbillDirector.FX0, FX1 = RazorbillDirector.FX1, FZ0 = RazorbillDirector.FZ0, FZ1 = RazorbillDirector.FZ1;
        for (float x = FX0 - 30; x < FX1 + 30; x += 7 + t.Next() * 9) spots.Add(new Vector2(x, FZ0 - 3.5f - t.Next() * 3));
        for (float x = FX0; x < FX1; x += 18 + t.Next() * 40) spots.Add(new Vector2(x, FZ1 + 3.5f + t.Next() * 2));
        for (float z = FZ0; z < FZ1; z += 10 + t.Next() * 25) { spots.Add(new Vector2(FX1 + 3.5f + t.Next() * 2, z)); spots.Add(new Vector2(FX0 - 3.5f - t.Next() * 2, z)); }
        int near = spots.Count;
        for (int n = 0; n < 160; n++) { float a = t.Next() * 6.283f, d = 700 + t.Next() * 1500; spots.Add(new Vector2(Mathf.Cos(a) * d, Mathf.Sin(a) * d)); }
        for (int i = 0; i < spots.Count; i++)
        {
            float h = (7 + t.Next() * 8) / 10, w = h * Mix(0.9f, 1.15f, t.Next()), ang = t.Next() * 6.283f;
            t.Next(); t.Next(); t.Next();
            int v = Mathf.FloorToInt(t.Next() * 3);
            batches[(i < near ? 6 : 9) + v].Add(ToUnity(new Vector3(spots[i].x, 0, spots[i].y), ang, new Vector3(w, h, w)));
        }
        drawn = 0; foreach (var b in batches) drawn += b.Count; drawn += rev.Count;
    }

    void Draw(ScriptableRenderContext ctx, Camera cam)
    {
        if (!plantMat || cam.cameraType == CameraType.Preview) return;
        if (batches == null) Build();
        var bounds = new Bounds(Vector3.zero, Vector3.one * 20000f);
        var lit = new RenderParams(plantMat) { camera = cam, worldBounds = bounds, shadowCastingMode = ShadowCastingMode.On, receiveShadows = true };
        var unlit = lit; unlit.shadowCastingMode = ShadowCastingMode.Off;
        for (int i = 0; i < 12; i++)
        {
            Mesh mesh = i < 3 ? hero[i] : i < 6 ? field[i - 3] : i < 9 ? tree[i - 6] : treeFar[i - 9];
            if (mesh) Batch(i < 6 ? lit : unlit, mesh, batches[i]);
        }
        // the plants that make way for the macro shot
        for (int i = 0; i < 3; i++) revNow[i].Clear();
        foreach (var p in rev)
        {
            float rd = Vector2.Distance(new Vector2(p.p.x, p.p.z), new Vector2(impact.x, impact.z));
            float rn = Frac(Mathf.Sin(p.p.x * 127.1f + p.p.z * 311.7f) * 43758.5453f);
            float fade = 1f - SStep(0f, 0.3f, reveal * 1.7f - (rd / RazorbillDirector.REVEAL_LENGTH + 0.35f * rn));
            if (fade < 0.01f) continue;
            revNow[p.mesh].Add(p.m * Matrix4x4.Scale(new Vector3(Mathf.Lerp(0.6f, 1f, fade), fade, Mathf.Lerp(0.6f, 1f, fade))));
        }
        bool heroRev = true;
        for (int i = 0; i < 3; i++) if (hero[i]) Batch(lit, heroRev ? hero[i] : field[i], revNow[i]);
    }

    static float Frac(float x) => x - Mathf.Floor(x);

    void Batch(RenderParams rp, Mesh mesh, List<Matrix4x4> list)
    {
        for (int s = 0; s < list.Count; s += chunk.Length)
        {
            int n = Mathf.Min(chunk.Length, list.Count - s);
            list.CopyTo(s, chunk, 0, n);
            Graphics.RenderMeshInstanced(rp, mesh, 0, chunk, n);
        }
    }
}
