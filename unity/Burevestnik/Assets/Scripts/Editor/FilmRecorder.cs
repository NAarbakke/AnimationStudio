// Burevestnik > Record Film: plays the scene once at a locked 30 fps and writes video/out/burevestnik-game.mp4.
using UnityEditor;
using UnityEditor.Recorder;
using UnityEditor.Recorder.Encoder;
using UnityEditor.Recorder.Input;
using UnityEditor.SceneManagement;
using UnityEngine;

[InitializeOnLoad]
public static class FilmRecorder
{
    const string FLAG = "Burevestnik.Record", SCENE = "Assets/Scenes/BurevestnikFlight.unity";
    public const string OUT = "../../video/out/burevestnik-game";   // relative to the project folder
    static RecorderController controller;

    static FilmRecorder() { EditorApplication.playModeStateChanged += OnPlayMode; }

    [MenuItem("Burevestnik/Record Film")]
    public static void Record()
    {
        if (EditorApplication.isPlaying) return;
        EditorSceneManager.SaveOpenScenes();
        if (EditorSceneManager.GetActiveScene().path != SCENE) EditorSceneManager.OpenScene(SCENE);
        PlayerSettings.runInBackground = true;
        SessionState.SetBool(FLAG, true);
        EditorApplication.isPlaying = true;
    }

    static void OnPlayMode(PlayModeStateChange s)
    {
        if (s != PlayModeStateChange.EnteredPlayMode || !SessionState.GetBool(FLAG, false)) return;
        SessionState.SetBool(FLAG, false);
        var dir = Object.FindFirstObjectByType<FlightDirector>();
        int frames = Mathf.CeilToInt(dir.FilmEnd * 30f);

        var settings = ScriptableObject.CreateInstance<RecorderControllerSettings>();
        var movie = ScriptableObject.CreateInstance<MovieRecorderSettings>();
        movie.name = "Burevestnik"; movie.Enabled = true;
        movie.EncoderSettings = new CoreEncoderSettings { Codec = CoreEncoderSettings.OutputCodec.MP4, EncodingQuality = CoreEncoderSettings.VideoEncodingQuality.High };
        movie.ImageInputSettings = new GameViewInputSettings { OutputWidth = 1920, OutputHeight = 1080 };
        movie.AudioInputSettings.PreserveAudio = false;
        movie.OutputFile = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", OUT)).Replace('\\', '/');
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
