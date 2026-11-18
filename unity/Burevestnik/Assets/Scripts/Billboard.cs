using UnityEngine;

// Turns a glow quad to face the camera that is rendering it.
[ExecuteAlways]
public class Billboard : MonoBehaviour
{
    void OnWillRenderObject()
    {
        var cam = Camera.current;
        if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position, cam.transform.up);
    }
}
