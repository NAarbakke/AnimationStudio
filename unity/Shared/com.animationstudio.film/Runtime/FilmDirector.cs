using UnityEngine;

namespace AnimationStudio.Film
{
    /// <summary>
    /// Base of every film: everything on screen is a pure function of film time <see cref="time"/>, so the editor can
    /// scrub any frame and Film > Record gets the same result in play mode (the Recorder locks the frame rate).
    /// </summary>
    [ExecuteAlways]
    public abstract class FilmDirector : MonoBehaviour
    {
        public float time;
        public bool play = true;

        /// <summary>Length of the film in seconds, end card included.</summary>
        public abstract float FilmEnd { get; }
        /// <summary>File name (no extension) the recorder writes into video/out/.</summary>
        public virtual string OutputName => name;
        public abstract void Evaluate(float t);

        protected virtual void Start() { if (Application.isPlaying) time = 0f; }

        protected virtual void Update()
        {
            if (Application.isPlaying && play) time += Time.deltaTime;
            Evaluate(time);
        }
    }
}
