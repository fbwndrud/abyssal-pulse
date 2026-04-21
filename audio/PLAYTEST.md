# Neon Pulse — Audio Playtest Checklist

The automated QA pipeline (LUFS, true peak, spectral, stereo, DC offset) has already confirmed the mix is technically healthy. What the analyzer **cannot** judge is the subjective feel. Please run through this checklist during one full play session and mark any item that trips your ear.

## Setup
- [ ] Use headphones **or** a decent stereo setup (laptop speakers hide width/low-end issues)
- [ ] Set system volume to your normal media-listening level; do **not** crank it

## 1. Mood & aesthetic (is it "dark synthwave"?)
- [ ] Menu feels chill and inviting — not aggressive, not dull
- [ ] Main BGM (low intensity) feels moody and cyberpunk — the kind of thing you'd want on for 15 min
- [ ] Main BGM (high intensity, when you're swarmed or below half HP) feels *noticeably* more intense than low intensity
- [ ] Boss music reads as a distinct "oh no" moment, not just another layer

## 2. Transitions
- [ ] Menu → gameplay crossfade is smooth (no abrupt cut, no dead silence)
- [ ] Boss spawn: music swap feels dramatic but doesn't clip or thump
- [ ] Boss death: music returns to main BGM without obvious seam
- [ ] If a run goes to the second boss, the *alternate* main track plays (tracks should rotate — you should hear both main_low and main_high over the course of a long run)

## 3. Dynamics (does ducking work?)
- [ ] During big explosions, the music briefly pulls back so the impact cuts through — but returns within a second
- [ ] No single SFX feels like it's drowning out the music for too long

## 4. SFX identifiability
- [ ] Shoot / hit / pickup / level-up are all distinguishable **with eyes closed**
- [ ] Boss laser is sufficiently different from normal beam/laser weapons
- [ ] UI click is present but not fatiguing when navigating menus

## 5. Positional audio
- [ ] Enemies exploding on the far left of the screen clearly pan left
- [ ] Enemies far off-camera (if you pull away) sound slightly muffled/distant, not identical to nearby ones
- [ ] No SFX sounds hard-panned 100% L/R in a way that feels jarring

## 6. Fatigue & session feel
- [ ] After 10+ minutes of play, your ears don't feel tired or want to turn the volume down
- [ ] No single frequency is "sticking" (piercing high, muddy low)
- [ ] You don't feel like you *have* to mute the game to concentrate

## 7. Silence & pacing
- [ ] Title screen isn't too loud on first load
- [ ] Death / victory jingles land correctly (not cut off, not too long)

## 8. Edge cases
- [ ] Pause / unpause: audio stops and resumes cleanly
- [ ] Alt-tab / browser tab backgrounded: audio behaves sensibly when you return
- [ ] First page load → click to start: no long delay before first sound plays (buffers should be pre-loaded)

## If something fails
Note the **scenario + file/moment**, e.g. "boss spawn at 2:30 — music cut out entirely for ~0.8 s". The two most likely root causes are:
1. Source track is too bright/dark for the scene → swap a file in `audio/` (keep filename, match format)
2. Layer/duck timing needs adjustment → `AUDIO.setMode()` or `duck()` parameters in `index.html`

Report any item you check, and the audio can be iterated on it specifically.
