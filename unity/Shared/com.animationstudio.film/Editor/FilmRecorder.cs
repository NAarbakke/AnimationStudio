// Film > Record: plays the open scene once at a locked 30 fps, 1920x1080, and writes <repo>/video/out/<OutputName>.mp4.
using System.IO;
using UnityEditor;
using UnityEditor.Recorder;
using UnityEditor.Recorder.Encoder;
using UnityEditor.Recorder.Input;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace AnimationStudio.Film.Editor
{
    [InitializeOnLoad]
    public static class FilmRecorder
    {
        const string FLAG = "AnimationStudio.Film.Record";
        static RecorderController controller;

        static FilmRecorder() { EditorApplication.playModeStateChanged += OnPlayMode; }

        /// <summary>The repository's video/out folder: projects live in &lt;repo&gt;/unity/&lt;Name&gt;/.</summary>
        public static string OutDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "video", "out")).Replace('\\', '/');

        [MenuItem("Film/Record")]
        public static void Record()
        {
            if (EditorApplication.isPlaying) return;
            if (Object.FindFirstObjectByType<FilmDirector>() == null) { Debug.LogError("[Film] no FilmDirector in the open scene"); return; }
            EditorSceneManager.SaveOpenScenes();
            // the Recorder's Game View source only gets frames from a Game view that exists and renders: a fresh
            // project's layout has the Scene tab in front, so open (and show) the Game view first
            EditorApplication.ExecuteMenuItem("Window/General/Game");
            PlayerSettings.runInBackground = true;
            SessionState.SetBool(FLAG, true);
            EditorApplication.isPlaying = true;
        }

        static void OnPlayMode(PlayModeStateChange s)
        {
            if (s != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(FLAG, false)) return;
            SessionState.SetBool(FLAG, false);
            var dir = Object.FindFirstObjectByType<FilmDirector>();
            int frames = Mathf.CeilToInt(dir.FilmEnd * 30f);

            var settings = ScriptableObject.CreateInstance<RecorderControllerSettings>();
            var movie = ScriptableObject.CreateInstance<MovieRecorderSettings>();
            movie.name = dir.OutputName; movie.Enabled = true;
            movie.EncoderSettings = new CoreEncoderSettings { Codec = CoreEncoderSettings.OutputCodec.MP4, EncodingQuality = CoreEncoderSettings.VideoEncodingQuality.High };
            movie.ImageInputSettings = new GameViewInputSettings { OutputWidth = 1920, OutputHeight = 1080 };
            movie.AudioInputSettings.PreserveAudio = false;
            Directory.CreateDirectory(OutDir);
            movie.OutputFile = OutDir + "/" + dir.OutputName;
            settings.AddRecorderSettings(movie);
            settings.SetRecordModeToFrameInterval(0, frames - 1);
            settings.FrameRate = 30f; settings.FrameRatePlayback = FrameRatePlayback.Constant; settings.CapFrameRate = true;

            dir.time = 0f;
            controller = new RecorderController(settings);
            controller.PrepareRecording();
            controller.StartRecording();
            Debug.Log($"[Film] recording {frames} frames to {movie.OutputFile}.mp4");
            EditorApplication.update += Poll;
        }

        static void Poll()
        {
            if (controller != null && controller.IsRecording()) return;
            EditorApplication.update -= Poll;
            controller = null;
            Debug.Log("[Film] done");
            EditorApplication.isPlaying = false;
        }
    }
}
