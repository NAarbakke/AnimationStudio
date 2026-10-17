// The maths page plays the ManimGX inserts rendered from video/manim (npm run insert copies them to site/public/videos/,
// which is git-ignored, so a fresh checkout has none until they are rendered): say so instead of a blank player.
for (const video of document.querySelectorAll<HTMLVideoElement>('.film video')) {
  const missing = () => { video.hidden = true; video.nextElementSibling!.toggleAttribute('hidden', false); };
  video.addEventListener('error', missing);
  if (video.error) missing();
}
