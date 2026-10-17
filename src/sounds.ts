/** Lightweight Web Audio cues for online play (no asset files). */

export type SoundId = "fold" | "bet" | "yourTurn";

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
  }: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    freqEnd?: number;
  },
): void {
  const now = audio.currentTime;
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
  g.gain.exponentialRampToValueAtTime(gain, now + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g);
  g.connect(audio.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
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
      });
      break;
    case "yourTurn":
      tone(audio, {
        freq: 660,
        duration: 0.1,
        type: "sine",
        gain: 0.07,
      });
      window.setTimeout(() => {
        const again = getCtx();
        if (!again || !enabled) return;
        tone(again, {
          freq: 880,
          duration: 0.12,
          type: "sine",
          gain: 0.07,
        });
      }, 90);
      break;
  }
}
