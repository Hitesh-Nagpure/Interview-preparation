// Web Audio API chime player
// Strictly triggers sound ONLY upon slide or word transition (no warning ticks)

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Play crisp transition chime when picture or word changes
  playTransitionChime() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;

      // Dual-tone pleasant acoustic chime
      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      // 880Hz (A5) harmonized with 1320Hz (E6)
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(440, now + 0.35);

      osc2.frequency.setValueAtTime(1320, now);
      osc2.frequency.exponentialRampToValueAtTime(660, now + 0.35);

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.linearRampToValueAtTime(0.3, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.55);
      osc2.stop(now + 0.55);
    } catch (err) {
      console.warn('Audio play error:', err);
    }
  }

  // Double bell when test completes
  playCompletionChime() {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.5]; // C major arpeggio
      freqs.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0.2, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.4);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.45);
      });
    } catch (err) {
      console.warn('Completion chime error:', err);
    }
  }

  // Single resonant brass bell (for 2m 30s warning in SSB lecturette)
  playSingleBell(startTimeOffset = 0) {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime + startTimeOffset;

      // Realistic physical brass bell overtone ratios: fundamental, minor third, octave, fifth
      const harmonics = [
        { freq: 987.77, gain: 0.45, decay: 1.6 },
        { freq: 1480.0, gain: 0.25, decay: 1.1 },
        { freq: 1975.5, gain: 0.20, decay: 0.8 },
        { freq: 2750.0, gain: 0.12, decay: 0.5 }
      ];

      harmonics.forEach(({ freq, gain, decay }) => {
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(gain, now + 0.005); // sharp metallic strike
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + decay);

        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + decay + 0.05);
      });
    } catch (err) {
      console.warn('Single bell audio error:', err);
    }
  }

  // Double brass bell (for 3m 00s completion in SSB lecturette)
  playDoubleBell() {
    if (this.isMuted) return;
    this.playSingleBell(0);
    this.playSingleBell(0.38); // second strike 380ms later
  }

  // Countdown acoustic tick (for 3, 2, 1 pre-recording countdown)
  playCountdownTick(isFinal = false) {
    if (this.isMuted) return;
    try {
      this.init();
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isFinal ? 880 : 440, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(isFinal ? 0.25 : 0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + (isFinal ? 0.25 : 0.1));
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start(now);
      osc.stop(now + (isFinal ? 0.26 : 0.11));
    } catch (e) {}
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
}

export const soundEngine = new SoundEngine();
