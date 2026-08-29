import type { SoundName } from "./shared/types";

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(
  audio: AudioContext,
  destination: AudioNode,
  start: number,
  duration: number,
  frequency: number,
  endFrequency: number,
  gainValue: number,
  type: OscillatorType = "sine",
): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function noise(audio: AudioContext, destination: AudioNode, start: number, duration: number, gainValue: number): void {
  const frameCount = Math.ceil(audio.sampleRate * duration);
  const buffer = audio.createBuffer(1, frameCount, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) channel[index] = Math.random() * 2 - 1;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  filter.Q.value = 0.8;
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(destination);
  source.start(start);
}

export function playPetSound(sound: SoundName, volume: number): void {
  if (sound === "none" || volume <= 0) return;
  const audio = audioContext();
  if (!audio) return;
  const master = audio.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.28;
  master.connect(audio.destination);
  const now = audio.currentTime + 0.015;

  if (sound === "meow") {
    tone(audio, master, now, 0.42, 760, 430, 0.7, "triangle");
    tone(audio, master, now + 0.09, 0.34, 1120, 620, 0.22, "sine");
  } else if (sound === "purr") {
    for (let index = 0; index < 8; index += 1) {
      tone(audio, master, now + index * 0.08, 0.13, 52, 44, 0.22, "sawtooth");
    }
  } else if (sound === "chime") {
    tone(audio, master, now, 0.48, 740, 740, 0.5);
    tone(audio, master, now + 0.13, 0.58, 1110, 1110, 0.4);
  } else if (sound === "crunch") {
    noise(audio, master, now, 0.12, 0.55);
    noise(audio, master, now + 0.16, 0.1, 0.42);
    noise(audio, master, now + 0.31, 0.08, 0.32);
  } else if (sound === "pop") {
    tone(audio, master, now, 0.18, 260, 720, 0.62, "triangle");
  } else if (sound === "alert") {
    tone(audio, master, now, 0.18, 520, 520, 0.5, "square");
    tone(audio, master, now + 0.24, 0.22, 520, 620, 0.45, "square");
  }
}
