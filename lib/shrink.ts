// Shrink a phone photo before upload: long edge capped, re-encoded as JPEG.
// Keeps uploads under Vercel's body limit and cuts the image cost on the API.
// Drawing through <img> lets the browser decode HEIC (iPhone) and apply EXIF rotation.
const LONG_EDGE = 1800;

export async function shrinkPhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This photo format can't be opened. Try a JPEG or PNG."));
      el.src = url;
    });
    const scale = Math.min(1, LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the photo on this device.");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) throw new Error("Couldn't process the photo on this device.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
