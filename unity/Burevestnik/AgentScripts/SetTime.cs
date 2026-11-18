using UnityEngine;

public static class SetTime
{
    public static string At(float t)
    {
        var d = Object.FindFirstObjectByType<FlightDirector>();
        d.time = t; d.Evaluate(t);
        return $"t={t} m={d.Mission(t):0.00}";
    }
}
