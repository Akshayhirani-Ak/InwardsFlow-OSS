// InwardsFlow — audio feedback REMOVED (floor request, 22 Nov 2026).
//
// The app used to synthesize scan/verify/error tones through a Web Audio
// SoundEngine. The floor asked for silence: no feedback sounds anywhere.
// The exported names are kept as no-ops so the existing call sites across
// the app stay valid and silent — nothing in this file can ever create
// an AudioContext or play a tone. Do not re-add sounds without a fresh
// floor request.

class SoundEngine {
  playSuccess(): void {}
  playNotification(): void {}
  playWarning(): void {}
}

export const soundEffects = new SoundEngine();

export const playScanBeep = () => soundEffects.playSuccess();
export const playVerifyChime = () => soundEffects.playNotification();
export const playErrorBuzzer = () => soundEffects.playWarning();
