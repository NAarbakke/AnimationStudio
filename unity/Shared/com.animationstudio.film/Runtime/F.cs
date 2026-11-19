using System.Collections.Generic;
using UnityEngine;

namespace AnimationStudio.Film
{
    /// <summary>
    /// Maths shared by the films, and the bridge from the three.js films' frame to Unity's.
    ///
    /// The films are ported from site/src/*/main.js, which work in three.js's right-handed frame (+y up). Ports keep that
    /// frame for all their maths, with UnityEngine.Vector3/Quaternion used as plain algebra (both libraries use the same
    /// quaternion and matrix conventions), and convert only when they pose a Transform: a point (x, y, z) becomes
    /// (x, y, -z) and a rotation is conjugated to match. That mirror is what makes a Unity camera see exactly the image
    /// the three.js camera saw. glTFast imports GLB models mirrored in x instead, so every model hangs from a "Body"
    /// child turned 180 degrees about y (x and z mirrored together), see <see cref="ModelFix"/>.
    /// </summary>
    public static class F
    {
        public const float G = 9.81f, DEG = Mathf.PI / 180f;

        public static float Clamp(float x, float a, float b) => x < a ? a : (x > b ? b : x);
        public static float SStep(float a, float b, float x) { float u = Clamp((x - a) / (b - a), 0f, 1f); return u * u * (3f - 2f * u); }
        public static float Mix(float a, float b, float u) => a + (b - a) * u;
        public static Vector3 Mix(Vector3 a, Vector3 b, float u) => a + (b - a) * u;
        public static float Ease(float u) { u = Clamp(u, 0f, 1f); return u * u * u * (u * (u * 6f - 15f) + 10f); }
        public static Vector3 V(float x, float y, float z) => new Vector3(x, y, z);

        // ---------------------------------------------------------------- three.js frame -> Unity
        public static Vector3 U(Vector3 p) => new Vector3(p.x, p.y, -p.z);
        public static Quaternion U(Quaternion q) => new Quaternion(-q.x, -q.y, q.z, q.w);
        /// <summary>Rotation of a GLB model's Body child: glTFast's x mirror followed by our z mirror.</summary>
        public static readonly Quaternion ModelFix = Quaternion.Euler(0f, 180f, 0f);

        /// <summary>three.js Matrix4.makeBasis(x, y, z) as a quaternion (columns must be orthonormal, right-handed).</summary>
        public static Quaternion Basis(Vector3 x, Vector3 y, Vector3 z) => Quaternion.LookRotation(z, y);
        public static Quaternion AxisAngle(Vector3 axis, float rad) => Quaternion.AngleAxis(rad * Mathf.Rad2Deg, axis);
        /// <summary>three.js Euler(x, y, z, 'YZX').</summary>
        public static Quaternion EulerYZX(float x, float y, float z) =>
            AxisAngle(Vector3.up, y) * AxisAngle(Vector3.forward, z) * AxisAngle(Vector3.right, x);

        public static void Pose(Transform t, Vector3 p, Quaternion q) => t.SetPositionAndRotation(U(p), U(q));
        public static void Pose(Transform t, Matrix4x4 m) => t.SetPositionAndRotation(U((Vector3)m.GetColumn(3)), U(m.rotation));
        /// <summary>three.js camera.lookAt(target) from eye, plus a roll about the view axis (degrees, clockwise on screen).</summary>
        public static void LookAt(Camera cam, Vector3 eye, Vector3 target, float rollDeg = 0f)
        {
            Vector3 e = U(eye), tg = U(target);
            cam.transform.SetPositionAndRotation(e, Quaternion.LookRotation(tg - e, Vector3.up) * Quaternion.Euler(0f, 0f, rollDeg));
        }
        /// <summary>A three.js-frame direction (sun etc.) in Unity's frame.</summary>
        public static Vector3 Dir(Vector3 d) => U(d).normalized;

        // ---------------------------------------------------------------- keyframes
        /// <summary>Cubic Hermite through keys [t, v1, v2, ...] on uneven times, at rest at both ends (the films' keyed()).</summary>
        public static float[] Keyed(float[][] keys, float t)
        {
            int i = 0; while (i < keys.Length - 2 && t > keys[i + 1][0]) i++;
            float[] a = keys[i], b = keys[i + 1]; float h = b[0] - a[0], u = Clamp((t - a[0]) / h, 0f, 1f);
            float Slope(int k, int n) => (k <= 0 || k >= keys.Length - 1) ? 0f : (keys[k + 1][n] - keys[k - 1][n]) / (keys[k + 1][0] - keys[k - 1][0]);
            var o = new float[a.Length - 1];
            float u2 = u * u, u3 = u2 * u;
            for (int n = 1; n < a.Length; n++)
                o[n - 1] = (2 * u3 - 3 * u2 + 1) * a[n] + (u3 - 2 * u2 + u) * h * Slope(i, n) + (-2 * u3 + 3 * u2) * b[n] + (u3 - u2) * h * Slope(i + 1, n);
            return o;
        }

        /// <summary>Piecewise-linear playback rate, integrated: film time to world time (the films' slow motion).</summary>
        public sealed class TimeWarp
        {
            readonly double[] w; readonly float dt;
            public TimeWarp(float[][] rate, float dur, float dt = 1f / 240f)
            {
                this.dt = dt; int n = Mathf.CeilToInt(dur / dt) + 2; w = new double[n];
                float R(float t) { for (int i = 1; i < rate.Length; i++) if (t <= rate[i][0]) { var a = rate[i - 1]; var b = rate[i]; return Mix(a[1], b[1], (t - a[0]) / (b[0] - a[0])); } return 1f; }
                for (int i = 1; i < n; i++) w[i] = w[i - 1] + R((i - 0.5f) * dt) * dt;
            }
            public float this[float t] { get { float f = Mathf.Max(t, 0f) / dt; int i = Mathf.Min((int)f, w.Length - 2); return (float)(w[i] + (w[i + 1] - w[i]) * (f - i)); } }
        }

        // ---------------------------------------------------------------- the films' seeded generator
        /// <summary>The LCG in the films' rng(seed): same sequence, so placements match the three.js films.</summary>
        public sealed class Rng
        {
            uint s; public Rng(uint seed) { s = seed; }
            public float Next() { s = s * 1664525u + 1013904223u; return (float)(s / 4294967296.0); }
        }

        // ---------------------------------------------------------------- THREE.CatmullRomCurve3, centripetal, with getPointAt
        public sealed class CatmullRom
        {
            readonly Vector3[] p; readonly float[] lengths; readonly int div;
            public readonly float Length;
            public CatmullRom(Vector3[] points, int arcLengthDivisions = 200)
            {
                p = points; div = arcLengthDivisions; lengths = new float[div + 1];
                Vector3 last = GetPoint(0f); float sum = 0f;
                for (int i = 1; i <= div; i++) { Vector3 c = GetPoint(i / (float)div); sum += Vector3.Distance(c, last); lengths[i] = sum; last = c; }
                Length = sum;
            }
            static void Coef(float x0, float x1, float x2, float x3, float dt0, float dt1, float dt2, out float c0, out float c1, out float c2, out float c3)
            {
                float t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
                float t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
                t1 *= dt1; t2 *= dt1;
                c0 = x1; c1 = t1; c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2; c3 = 2 * x1 - 2 * x2 + t1 + t2;
            }
            public Vector3 GetPoint(float t)
            {
                int l = p.Length; float pp = (l - 1) * t; int ip = Mathf.FloorToInt(pp); float wgt = pp - ip;
                if (wgt == 0f && ip == l - 1) { ip = l - 2; wgt = 1f; }
                Vector3 p0 = ip > 0 ? p[(ip - 1) % l] : p[0] - p[1] + p[0];
                Vector3 p1 = p[ip % l], p2 = p[(ip + 1) % l];
                Vector3 p3 = ip + 2 < l ? p[(ip + 2) % l] : p[l - 1] - p[l - 2] + p[l - 1];
                float dt0 = Mathf.Pow((p0 - p1).sqrMagnitude, 0.25f), dt1 = Mathf.Pow((p1 - p2).sqrMagnitude, 0.25f), dt2 = Mathf.Pow((p2 - p3).sqrMagnitude, 0.25f);
                if (dt1 < 1e-4f) dt1 = 1f; if (dt0 < 1e-4f) dt0 = dt1; if (dt2 < 1e-4f) dt2 = dt1;
                Vector3 o;
                Coef(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2, out var a0, out var a1, out var a2, out var a3); o.x = a0 + a1 * wgt + a2 * wgt * wgt + a3 * wgt * wgt * wgt;
                Coef(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2, out a0, out a1, out a2, out a3); o.y = a0 + a1 * wgt + a2 * wgt * wgt + a3 * wgt * wgt * wgt;
                Coef(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2, out a0, out a1, out a2, out a3); o.z = a0 + a1 * wgt + a2 * wgt * wgt + a3 * wgt * wgt * wgt;
                return o;
            }
            /// <summary>Point at fraction u of the arc length (THREE.Curve.getPointAt).</summary>
            public Vector3 GetPointAt(float u)
            {
                float target = u * Length; int lo = 0, hi = div;
                while (lo <= hi) { int m = (lo + hi) >> 1; float c = lengths[m] - target; if (c < 0) lo = m + 1; else if (c > 0) hi = m - 1; else { hi = m; break; } }
                int i = Mathf.Max(hi, 0);
                if (i >= div) return GetPoint(1f);
                if (lengths[i] == target) return GetPoint(i / (float)div);
                float seg = lengths[i + 1] - lengths[i];
                return GetPoint((i + (target - lengths[i]) / seg) / div);
            }
        }

        public static List<T> L<T>(params T[] a) => new List<T>(a);
    }
}
