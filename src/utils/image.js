/**
 * Shrink a photo in the browser before uploading it.
 * Redrawing on a canvas also drops all EXIF metadata — including the GPS
 * position phones store in photos — so no location leaves the device.
 */
export async function resizeImage(file, maxSize = 1600, quality = 0.82) {
  if (!file || !/^image\//.test(file.type)) throw new Error('사진 파일만 올릴 수 있어요.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const source = bitmap || (await loadImage(file));
  const width = source.width;
  const height = source.height;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('사진을 처리하지 못했어요.');
  return blob;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('사진을 열지 못했어요.'));
    };
    img.src = url;
  });
}
