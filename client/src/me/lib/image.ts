// Every photo is shrunk on the phone before it's sent: the evidence only has
// to show who and when, and small photos upload fast on mobile data and keep
// the database small. The thumbnail is for lists.
const PHOTO_MAX = 1280;
const THUMB_MAX = 360;

export interface PreparedPhoto {
  photo: Blob;
  thumb: Blob;
  previewUrl: string;
  takenAt: string;
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))), 'image/jpeg', quality)
  );
}

function drawScaled(source: CanvasImageSource, width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function prepare(source: CanvasImageSource, width: number, height: number, takenAt: Date): Promise<PreparedPhoto> {
  const photo = await toBlob(drawScaled(source, width, height, PHOTO_MAX), 0.78);
  const thumb = await toBlob(drawScaled(source, width, height, THUMB_MAX), 0.62);
  return { photo, thumb, previewUrl: URL.createObjectURL(photo), takenAt: takenAt.toISOString() };
}

// The frame on screen right now, from the live camera.
export function captureFrame(video: HTMLVideoElement) {
  return prepare(video, video.videoWidth, video.videoHeight, new Date());
}

// A photo from the phone's own camera app or its gallery. The file's time is
// the best guess at when it was taken.
export async function preparePickedFile(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    return await prepare(bitmap, bitmap.width, bitmap.height, new Date(file.lastModified || Date.now()));
  } finally {
    bitmap.close();
  }
}
