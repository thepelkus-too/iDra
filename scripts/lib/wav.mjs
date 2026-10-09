// Deterministic test audio (no randomness, no third-party data): a quiet 220 Hz tone with a loud "kick"
// (decaying 55 Hz sine + LCG noise burst) every `beatEvery` seconds. Used for the audio regression fixture
// (packages/core/test/fixtures/beats.wav) and as Chromium's fake microphone in the e2e run.
export function makeBeatsWav({ sampleRate = 22050, seconds = 1.5, beatEvery = 0.5, channels = 1 } = {}) {
  const n = Math.round(sampleRate * seconds)
  const data = new Int16Array(n * channels)
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const sinceBeat = t % beatEvery
    let v = 0.05 * Math.sin(2 * Math.PI * 220 * t)
    if (sinceBeat < 0.12) {
      const env = Math.exp(-sinceBeat * 30)
      v += env * (0.7 * Math.sin(2 * Math.PI * 55 * sinceBeat) + 0.25 * rnd())
    }
    const s = Math.max(-1, Math.min(1, v))
    for (let c = 0; c < channels; c++) data[i * channels + c] = Math.round(s * 32767)
  }
  const bytes = data.length * 2
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * 2, 28)
  buf.writeUInt16LE(channels * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(bytes, 40)
  Buffer.from(data.buffer).copy(buf, 44)
  return buf
}
