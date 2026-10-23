// The offscreen document records the tab (MediaRecorder needs a DOM) and samples a frame every second
// while it does, so there's no seeking in the finished webm (which has no duration metadata).
// On stop it uploads the video and up to 24 evenly spaced frames, and returns their URLs.
import { upload, type Pairing } from "../../lib/api";

const FRAME_EVERY_MS = 1000;
const MAX_SAMPLES = 300; // five minutes
const MAX_FRAMES = 24;
const FRAME_WIDTH = 1280;

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let samples: { t: number; blob: Blob }[] = [];
let sampler: ReturnType<typeof setInterval> | undefined;
let startedAt = 0;
let stream: MediaStream | null = null;

async function start(streamId: string) {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, maxWidth: 2560, maxHeight: 1600, maxFrameRate: 30 } } as MediaTrackConstraints,
  });
  chunks = [];
  samples = [];
  startedAt = Date.now();
  recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm", videoBitsPerSecond: 2_500_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);

  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  const grab = async () => {
    if (!video.videoWidth || samples.length >= MAX_SAMPLES) return;
    const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.75));
    if (blob) samples.push({ t: (Date.now() - startedAt) / 1000, blob });
  };
  await grab();
  sampler = setInterval(grab, FRAME_EVERY_MS);
  (window as unknown as { __grab: () => Promise<void> }).__grab = grab;
}

/** Up to `max` frames spread over the recording; the last one is always kept (it usually shows the bug). */
function pickFrames<T>(all: T[], max: number): T[] {
  if (all.length <= max) return all;
  const picked = Array.from({ length: max - 1 }, (_, i) => all[Math.floor((i * (all.length - 1)) / (max - 1))]);
  return [...picked, all.at(-1)!];
}

async function stop(pairing: Pairing) {
  if (!recorder) throw new Error("Not recording");
  await (window as unknown as { __grab: () => Promise<void> }).__grab(); // the final state
  clearInterval(sampler);
  const done = new Promise<void>((r) => (recorder!.onstop = () => r()));
  recorder.stop();
  await done;
  stream?.getTracks().forEach((t) => t.stop());
  const durationMs = Date.now() - startedAt;
  const video = new Blob(chunks, { type: "video/webm" });
  const frames = pickFrames(samples, MAX_FRAMES);
  recorder = null;

  const [videoUrl, ...frameUrls] = await Promise.all([
    upload(video, "recording.webm", pairing),
    ...frames.map((f, i) => upload(f.blob, `frame-${i}.jpg`, pairing)),
  ]);
  return { videoUrl, durationMs, frames: frames.map((f, i) => ({ t: Math.round(f.t * 10) / 10, url: frameUrls[i] })) };
}

chrome.runtime.onMessage.addListener((msg: { type: string; streamId?: string; pairing?: Pairing }, _sender, reply) => {
  if (msg.type === "offscreen:start") {
    start(msg.streamId!).then(
      () => reply({ ok: true }),
      (e) => reply({ ok: false, error: String(e?.message ?? e) }),
    );
    return true;
  }
  if (msg.type === "offscreen:stop") {
    stop(msg.pairing!).then(
      (media) => reply({ ok: true, media }),
      (e) => reply({ ok: false, error: String(e?.message ?? e) }),
    );
    return true;
  }
});
