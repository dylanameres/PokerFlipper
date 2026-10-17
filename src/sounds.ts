/** Lightweight Web Audio cues for online play (no asset files). */

export type SoundId = "fold" | "bet" | "yourTurn" | "emote";

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Call from a user gesture so later autoplay (your-turn) is allowed. */
export function unlockAudio(): void {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") {
    void audio.resume();
  }
  unlocked = true;
}

function tone(
  audio: AudioContext,
  {
    freq,
    duration,
    type = "sine",
    gain = 0.08,
    freqEnd,
    when = 0,
  }: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    freqEnd?: number;
    when?: number;
  },
): void {
  const now = audio.currentTime + when;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(freqEnd, 1),
      now + duration,
    );
  }
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** One plastic-chip clack: bandpassed noise + a short mid click. */
function chipClack(audio: AudioContext, when: number, gain = 0.05): void {
  const t0 = audio.currentTime + when;
  const dur = 0.045;
  const frames = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying noise burst.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }

  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(2400, t0);
  filter.Q.setValueAtTime(2.2, t0);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(audio.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.01);

  // Soft body of the chip hit.
  tone(audio, {
    freq: 420 + Math.random() * 80,
    freqEnd: 180,
    duration: 0.05,
    type: "triangle",
    gain: gain * 0.55,
    when,
  });
}

/** Several staggered clacks — reads as chips being tossed into the pot. */
function chipShuffle(audio: AudioContext): void {
  const offsets = [0, 0.035, 0.07, 0.11, 0.155];
  const gains = [0.055, 0.04, 0.048, 0.035, 0.042];
  for (let i = 0; i < offsets.length; i++) {
    chipClack(audio, offsets[i] + Math.random() * 0.012, gains[i]);
  }
}

export function playSound(id: SoundId, enabled: boolean): void {
  if (!enabled) return;
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") {
    if (!unlocked) return;
    void audio.resume().then(() => playSound(id, enabled));
    return;
  }

  switch (id) {
    case "fold":
      tone(audio, {
        freq: 180,
        freqEnd: 90,
        duration: 0.16,
        type: "triangle",
        gain: 0.07,
      });
      break;
    case "bet":
      chipShuffle(audio);
      break;
    case "yourTurn":
      // Former bet cue — brighter attention ping.
      tone(audio, {
        freq: 520,
        freqEnd: 780,
        duration: 0.09,
        type: "square",
        gain: 0.045,
      });
      tone(audio, {
        freq: 880,
        duration: 0.05,
        type: "sine",
        gain: 0.03,
        when: 0.02,
      });
      break;
    case "emote":
      tone(audio, {
        freq: 660,
        freqEnd: 990,
        duration: 0.07,
        type: "sine",
        gain: 0.04,
      });
      break;
  }
}
