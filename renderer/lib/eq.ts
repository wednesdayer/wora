// Per-track / per-album equalizer engine (Web Audio).
//
// Wora plays audio through howler with `html5: true` (an <audio> element).
// We tap that element with a MediaElementSource and route it through a chain
// of BiquadFilterNodes (10-band graphic EQ) + a preamp gain, then to the
// destination. Processing is 32-bit float end to end (no bit-depth loss), and
// gain changes use setTargetAtTime for click-free ramping.

export interface EqCurve {
  enabled: boolean;
  preamp: number; // dB
  bands: number[]; // gain in dB per band (same length/order as EQ_FREQS)
}

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export function flatCurve(): EqCurve {
  return { enabled: true, preamp: 0, bands: EQ_FREQS.map(() => 0) };
}

export function isFlat(c: EqCurve | null | undefined): boolean {
  if (!c) return true;
  if (Math.abs(c.preamp || 0) > 0.01) return false;
  return (c.bands || []).every((g) => Math.abs(g) < 0.01);
}

let ctx: AudioContext | null = null;
let mediaSource: MediaElementAudioSourceNode | null = null;
let filters: BiquadFilterNode[] = [];
let preampNode: GainNode | null = null;
let attachedEl: HTMLMediaElement | null = null;
let lastCurve: EqCurve | null = null;

// --- Tempo Control state (global playback params) ---
let pitchNode: AudioWorkletNode | null = null;
let pitchReady = false; // worklet module loaded
let pitchLoading = false;
let pitchSemitones = 0; // independent pitch shift
let tempoRate = 1; // element playbackRate (play speed * sample rate)
let tempoPreserve = true; // preservesPitch (false = varispeed / sample-rate)

function ensureWorklet(c: AudioContext): void {
  if (pitchReady || pitchLoading || !c.audioWorklet) return;
  pitchLoading = true;
  c.audioWorklet
    .addModule("/pitch-processor.js")
    .then(() => {
      pitchReady = true;
      pitchLoading = false;
      insertPitchNode(); // splice into the live graph if a track is attached
    })
    .catch((e) => {
      pitchLoading = false;
      console.warn("[tempo] pitch worklet failed to load:", e);
    });
}

// Insert the pitch node between source and filters on the existing graph
// (reuses the single MediaElementSource — never creates a second one).
function insertPitchNode(): void {
  if (!ctx || !pitchReady || pitchNode || !mediaSource || filters.length === 0)
    return;
  try {
    pitchNode = new AudioWorkletNode(ctx, "pitch-processor");
    mediaSource.disconnect();
    mediaSource.connect(pitchNode);
    pitchNode.connect(filters[0]);
    applyPitchRatio();
  } catch (e) {
    console.warn("[tempo] could not create pitch node:", e);
    pitchNode = null;
  }
}

function applyPitchRatio(): void {
  if (!pitchNode) return;
  const ratio = Math.pow(2, pitchSemitones / 12);
  pitchNode.port.postMessage({ pitchRatio: ratio });
}

function applyTempoToElement(): void {
  if (!attachedEl) return;
  try {
    attachedEl.playbackRate = tempoRate;
    (attachedEl as any).preservesPitch = tempoPreserve;
    (attachedEl as any).webkitPreservesPitch = tempoPreserve;
  } catch {}
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// Build (or rebuild) the EQ graph around a specific media element.
export function attachElement(el: HTMLMediaElement | null | undefined): void {
  if (!el) return;
  const c = ensureContext();
  if (!c) return;
  if (attachedEl === el && mediaSource) {
    applyCurve(lastCurve); // same element, just re-apply
    return;
  }

  // Tear down previous graph (previous element is being discarded by howler).
  try {
    if (mediaSource) mediaSource.disconnect();
  } catch {}
  try {
    if (pitchNode) pitchNode.disconnect();
  } catch {}
  pitchNode = null;
  filters.forEach((f) => {
    try {
      f.disconnect();
    } catch {}
  });
  try {
    if (preampNode) preampNode.disconnect();
  } catch {}

  try {
    // Help avoid Web Audio tainting on the custom wora:// protocol.
    if (!el.crossOrigin) el.crossOrigin = "anonymous";
  } catch {}

  try {
    mediaSource = c.createMediaElementSource(el);
  } catch (e) {
    // An element can only be wired to one MediaElementSource per context.
    console.warn("[eq] createMediaElementSource failed:", e);
    return;
  }

  filters = EQ_FREQS.map((freq) => {
    const b = c.createBiquadFilter();
    b.type = "peaking";
    b.frequency.value = freq;
    b.Q.value = 1.0;
    b.gain.value = 0;
    return b;
  });
  preampNode = c.createGain();
  preampNode.gain.value = 1;

  // Chain: source -> [pitch] -> filters -> preamp -> destination
  pitchNode = pitchReady ? new AudioWorkletNode(c, "pitch-processor") : null;
  let prev: AudioNode = mediaSource;
  if (pitchNode) {
    prev.connect(pitchNode);
    prev = pitchNode;
  }
  for (const f of filters) {
    prev.connect(f);
    prev = f;
  }
  prev.connect(preampNode);
  preampNode.connect(c.destination);

  attachedEl = el;
  void c.resume?.();
  ensureWorklet(c); // load pitch worklet (splices in later if not ready yet)
  applyCurve(lastCurve);
  applyTempoToElement();
  applyPitchRatio();
}

// Reach the underlying <audio> element from a howler Howl instance.
export function attachHowl(sound: any): void {
  const el: HTMLMediaElement | undefined = sound?._sounds?.[0]?._node;
  if (el) attachElement(el);
}

// Apply a curve live (click-free ramp). Pass null to bypass (flat).
export function applyCurve(curve: EqCurve | null | undefined): void {
  lastCurve = curve || null;
  if (!ctx || filters.length === 0) return;
  const on = !!(curve && curve.enabled);
  const now = ctx.currentTime;
  const tau = 0.02; // ~20ms smoothing
  filters.forEach((f, i) => {
    const g = on && curve.bands ? curve.bands[i] || 0 : 0;
    f.gain.setTargetAtTime(g, now, tau);
  });
  if (preampNode) {
    const preLin = on ? Math.pow(10, (curve.preamp || 0) / 20) : 1;
    preampNode.gain.setTargetAtTime(preLin, now, tau);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function isReady(): boolean {
  return filters.length > 0;
}

// ---- Tempo Control API ----

// Play speed / sample rate map to the element's playbackRate.
// preservePitch=true  -> time-stretch (play speed, pitch kept)
// preservePitch=false -> varispeed (sample-rate feel: pitch+tempo together)
export function setPlaybackRate(rate: number, preservePitch: boolean): void {
  tempoRate = Math.max(0.25, Math.min(4, rate || 1));
  tempoPreserve = preservePitch;
  applyTempoToElement();
}

// Independent pitch shift in semitones (tempo unchanged).
export function setPitchSemitones(semitones: number): void {
  pitchSemitones = Math.max(-12, Math.min(12, semitones || 0));
  const c = ensureContext();
  if (c) {
    if (!pitchReady) ensureWorklet(c);
    else if (!pitchNode) insertPitchNode();
  }
  applyPitchRatio();
}

export function getTempoState() {
  return { rate: tempoRate, preservePitch: tempoPreserve, pitchSemitones };
}
