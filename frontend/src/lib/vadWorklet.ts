type VadMessage =
  | { type: "speech_start"; timestampMs: number }
  | { type: "speech_end"; timestampMs: number }
  | { type: "audio_frame"; payload: Float32Array }
  | { type: "error"; message: string };

class VadProcessor extends AudioWorkletProcessor {
  private threshold: number;
  private speechStartFrames: number;
  private speechEndFrames: number;
  private speaking = false;
  private aboveCount = 0;
  private belowCount = 0;

  constructor(options?: AudioWorkletProcessorOptions) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.threshold = typeof processorOptions.threshold === "number" ? processorOptions.threshold : 0.02;
    this.speechStartFrames =
      typeof processorOptions.speechStartFrames === "number" ? processorOptions.speechStartFrames : 3;
    this.speechEndFrames =
      typeof processorOptions.speechEndFrames === "number" ? processorOptions.speechEndFrames : 10;
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) {
      return true;
    }
    let sum = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / channel.length);

    if (rms >= this.threshold) {
      this.aboveCount += 1;
      this.belowCount = 0;
    } else {
      this.belowCount += 1;
      this.aboveCount = 0;
    }

    if (!this.speaking && this.aboveCount >= this.speechStartFrames) {
      this.speaking = true;
      this.postMessage({ type: "speech_start", timestampMs: Math.round(currentTime * 1000) });
    }

    if (this.speaking && this.belowCount >= this.speechEndFrames) {
      this.speaking = false;
      this.postMessage({ type: "speech_end", timestampMs: Math.round(currentTime * 1000) });
    }

    if (this.speaking) {
      const frame = new Float32Array(channel);
      this.postMessage({ type: "audio_frame", payload: frame }, [frame.buffer]);
    }

    return true;
  }

  private postMessage(message: VadMessage, transfer?: Transferable[]) {
    try {
      this.port.postMessage(message, transfer ?? []);
    } catch (error) {
      this.port.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : "vad postMessage failed",
      });
    }
  }
}

registerProcessor("vad-processor", VadProcessor);
