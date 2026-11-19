// One-off repair: the hull and wing meshes were saved double-sided on shared vertices (normals summed to zero -> NaN
// shading -> bloom blowout). Keep one winding of each face pair, then add the back faces on their own vertices.
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.Universal;

public static class FixDoubleSided
{
    public static string Run()
    {
        var log = new System.Text.StringBuilder();
        foreach (var name in new[] { "Hull_cargo", "Hull_patrol", "Hull_supply", "DroneWing" })
        {
            var path = $"Assets/Generated/{name}.asset"; var m = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (m == null) { log.AppendLine($"{name}: missing"); continue; }
            var v = new List<Vector3>(m.vertices); var t = m.triangles; var seen = new HashSet<(int, int, int)>(); var keep = new List<int>();
            (int, int, int) Key(int a, int b, int c) { int lo = Mathf.Min(a, Mathf.Min(b, c)); return lo == a ? (a, b, c) : lo == b ? (b, c, a) : (c, a, b); }
            for (int i = 0; i < t.Length; i += 3)
            {
                if (seen.Contains(Key(t[i], t[i + 2], t[i + 1]))) continue;   // the reverse of a face already kept
                seen.Add(Key(t[i], t[i + 1], t[i + 2])); keep.AddRange(new[] { t[i], t[i + 1], t[i + 2] });
            }
            int nv = v.Count, nt = keep.Count; v.AddRange(v.GetRange(0, nv));
            for (int i = 0; i < nt; i += 3) keep.AddRange(new[] { keep[i] + nv, keep[i + 2] + nv, keep[i + 1] + nv });
            m.Clear(); m.SetVertices(v); m.SetTriangles(keep, 0); m.RecalculateNormals(); m.RecalculateBounds(); EditorUtility.SetDirty(m);
            int zero = 0; foreach (var n in m.normals) if (n.sqrMagnitude < 0.5f) zero++;
            log.AppendLine($"{name}: tris {t.Length / 3} -> {keep.Count / 3}, zero normals {zero}");
        }
        foreach (var c in Object.FindObjectsByType<UniversalAdditionalCameraData>(FindObjectsSortMode.None)) { c.stopNaN = true; EditorUtility.SetDirty(c); log.AppendLine($"stopNaN on {c.name}"); }
        AssetDatabase.SaveAssets(); EditorSceneManager.MarkAllScenesDirty(); EditorSceneManager.SaveOpenScenes();
        return log.ToString();
    }
}
