using UnityEngine;

namespace AnimationStudio.Film
{
    /// <summary>
    /// A layer of camera-facing round sprites rebuilt every frame from the film clock, like the three.js films' point
    /// layers: Begin, Push a point per particle (three.js frame, size is the world diameter), End. A frozen
    /// ParticleSystem draws them, so the layer is deterministic and works the same in edit mode and while recording.
    /// </summary>
    [ExecuteAlways, RequireComponent(typeof(ParticleSystem))]
    public class PointCloud : MonoBehaviour
    {
        public int max = 2000;
        [Tooltip("Particle colours are divided by this, and the material colour multiplied by it, so additive fire can go past 1")]
        public float hdrScale = 1f;
        ParticleSystem ps; ParticleSystem.Particle[] buf; int n;

        void OnEnable() { Setup(); }

        void Setup()
        {
            ps = GetComponent<ParticleSystem>();
            var main = ps.main; main.simulationSpace = ParticleSystemSimulationSpace.World; main.maxParticles = max; main.playOnAwake = false;
            main.simulationSpeed = 0f; main.loop = false; main.startLifetime = 1e6f;
            var em = ps.emission; em.enabled = false;
            var sh = ps.shape; sh.enabled = false;
            if (buf == null || buf.Length < max) buf = new ParticleSystem.Particle[max];
        }

        public void Begin() { if (buf == null || ps == null) Setup(); n = 0; }

        public void Push(Vector3 p, float size, float r, float g, float b, float a)
        {
            if (n >= max || a <= 0.002f) return;
            float k = 1f / hdrScale;
            buf[n++] = new ParticleSystem.Particle
            {
                position = F.U(p), startSize = size, remainingLifetime = 1e6f, startLifetime = 1e6f,
                startColor = new Color(Mathf.Clamp01(r * k), Mathf.Clamp01(g * k), Mathf.Clamp01(b * k), Mathf.Clamp01(a)),
                rotation = (n * 47) % 360,
            };
        }

        public void End()
        {
            if (ps == null) Setup();
            if (!ps.isPlaying) { ps.Play(); }
            ps.SetParticles(buf, n);
        }
    }

    /// <summary>Turns a glow quad to face whichever camera renders it.</summary>
    [ExecuteAlways]
    public class FacingQuad : MonoBehaviour
    {
        void OnWillRenderObject()
        {
            var cam = Camera.current;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position, cam.transform.up);
        }
    }
}
