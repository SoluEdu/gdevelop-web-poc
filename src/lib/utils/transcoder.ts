import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface TranscodeProgress {
  percent: number;
  currentFrame: number;
  totalFrames: number;
}

/**
 * Checks if MediaRecorder supports a specific MIME type / codec string natively.
 */
export function isMimeSupported(mimeType: string): boolean {
  if (typeof MediaRecorder === 'undefined' || !mimeType) return false;
  try {
    return MediaRecorder.isTypeSupported(mimeType.trim());
  } catch {
    return false;
  }
}

/**
 * In-browser transcoding of WebM Blob to MP4 using WebCodecs API and mp4-muxer.
 */
export async function transcodeWebMToMP4(
  webmBlob: Blob,
  onProgress?: (prog: TranscodeProgress) => void
): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Browser ini tidak mendukung WebCodecs VideoEncoder untuk konversi MP4.');
  }

  const videoUrl = URL.createObjectURL(webmBlob);
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Gagal memuat video WebM untuk konversi'));
    });

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const duration = video.duration && isFinite(video.duration) ? video.duration : 1;

    // Initialize MP4 Muxer
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    });

    // Initialize VideoEncoder
    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = e;
      },
    });

    encoder.configure({
      codec: 'avc1.42E01E', // Baseline H.264
      width,
      height,
      bitrate: 2_500_000,
    });

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Gagal membuat 2D canvas context');

    const fps = 30;
    const totalFrames = Math.max(1, Math.floor(duration * fps));
    const frameInterval = 1 / fps;

    for (let i = 0; i < totalFrames; i++) {
      if (encoderError) throw encoderError;

      const time = i * frameInterval;
      video.currentTime = time;
      await new Promise<void>((r) => {
        video.onseeked = () => r();
      });

      ctx.drawImage(video, 0, 0, width, height);

      const timestampUs = Math.round(time * 1_000_000);
      const videoFrame = new VideoFrame(canvas, { timestamp: timestampUs });

      encoder.encode(videoFrame, { keyFrame: i % 30 === 0 });
      videoFrame.close();

      if (onProgress) {
        onProgress({
          percent: Math.round(((i + 1) / totalFrames) * 100),
          currentFrame: i + 1,
          totalFrames,
        });
      }
    }

    await encoder.flush();
    muxer.finalize();

    const buffer = muxer.target.buffer;
    return new Blob([buffer], { type: 'video/mp4' });
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}
