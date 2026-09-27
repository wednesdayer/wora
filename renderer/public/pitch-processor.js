// Inline pitch-shift AudioWorklet (rate-preserving: same tempo, shifted pitch).
// Time-domain delay-line pitch shifter with two crossfaded taps (classic
// Bode-style). Quality is good for moderate shifts; extreme shifts soften.
// pitchRatio is set via port messages ({ pitchRatio }); 1.0 = bypass.
class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = 1.0;
    this.win = 2048; // grain/window length in samples
    this.bufLen = 8192; // ring buffer per channel (power of 2)
    this.mask = this.bufLen - 1;
    this.buffers = [];
    this.writeIdx = 0;
    this.phase = 0; // 0..win, ramps each sample
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.pitchRatio === "number") {
        this.ratio = Math.max(0.25, Math.min(4, e.data.pitchRatio));
      }
    };
  }

  ensure(channels) {
    while (this.buffers.length < channels) {
      this.buffers.push(new Float32Array(this.bufLen));
    }
  }

  read(buf, pos) {
    // linear-interpolated read from ring buffer at fractional position (samples behind write)
    const p = pos & this.mask;
    const i0 = p;
    const i1 = (p + 1) & this.mask;
    const frac = pos - Math.floor(pos);
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const chs = output.length;
    this.ensure(chs);

    const n = output[0].length;
    const win = this.win;
    const half = win / 2;
    // delay moves at rate (1 - ratio) so output pitch = input * ratio
    const rate = 1 - this.ratio;

    for (let i = 0; i < n; i++) {
      // write current input sample(s) into ring buffers
      for (let c = 0; c < chs; c++) {
        const inCh = input[c] || input[0];
        this.buffers[c][this.writeIdx] = inCh ? inCh[i] : 0;
      }

      if (this.ratio === 1.0) {
        for (let c = 0; c < chs; c++)
          output[c][i] = this.buffers[c][this.writeIdx];
        this.writeIdx = (this.writeIdx + 1) & this.mask;
        continue;
      }

      // two taps offset by half a window, triangular crossfade
      const d1 = this.phase; // 0..win
      const d2 = (this.phase + half) % win;
      // triangular windows (peak at center of each tap's active span)
      const w1 = 1 - Math.abs((d1 - half) / half); // 0 at edges, 1 at center
      const w2 = 1 - Math.abs((d2 - half) / half);
      const wsum = w1 + w2 || 1;

      for (let c = 0; c < chs; c++) {
        const buf = this.buffers[c];
        // read positions are "delay" samples behind the write head
        const base = this.writeIdx + this.bufLen;
        const s1 = this.read(buf, base - d1);
        const s2 = this.read(buf, base - d2);
        output[c][i] = (s1 * w1 + s2 * w2) / wsum;
      }

      this.phase += rate;
      if (this.phase >= win) this.phase -= win;
      else if (this.phase < 0) this.phase += win;
      this.writeIdx = (this.writeIdx + 1) & this.mask;
    }
    return true;
  }
}

registerProcessor("pitch-processor", PitchProcessor);
