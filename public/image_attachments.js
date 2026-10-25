import {getLimits} from './site_limits.js';
export const MAX_IMAGES_PER_MESSAGE = getLimits().imagesPerMessage;
export const MAX_CONTEXT_IMAGES = getLimits().contextImages;
export const MAX_IMAGE_BYTES = getLimits().imageBytes;
export const MAX_IMAGE_EDGE = getLimits().imageEdge;

export function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png' && bytes.length >= 33
    && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
    && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216
    && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      }
      offset += size;
    }
  }
  throw new Error('图片内容不是有效的 JPEG 或 PNG。');
}

export function validateImages(value, role = 'user') {
  if (value === undefined) return [];
  if (role !== 'user' || !Array.isArray(value) || value.length > getLimits().imagesPerMessage) {
    throw new Error('每条用户消息超过当前每条消息图片数量预算。');
  }
  return value.map(image => {
    const url = image?.dataUrl;
    if (typeof url !== 'string' || url.length > Math.ceil(getLimits().imageBytes / 3) * 4 + 32) throw new Error('图片过大，请重新添加并压缩。');
    const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[2].length % 4 !== 0) throw new Error('图片必须是内嵌 JPEG 或 PNG，不接受远程链接。');
    let raw;
    try { raw = atob(match[2]); } catch { throw new Error('图片编码无效。'); }
    if (!raw.length || raw.length > getLimits().imageBytes || btoa(raw) !== match[2]) throw new Error('图片编码或大小无效。');
    const { width, height } = imageDimensions(Uint8Array.from(raw, c => c.charCodeAt(0)), match[1]);
    if (!width || !height || width > getLimits().imageEdge || height > getLimits().imageEdge) throw new Error('图片尺寸超过当前像素边长预算，请重新添加并压缩。');
    const name = String(image.name || '图片').replaceAll('\\', '/').split('/').at(-1)
      .replace(/[\x00-\x1f\x7f<>]/g, '_').slice(0, 100) || '图片';
    return { name, dataUrl: url, width, height };
  });
}

export async function prepareImage(file) {
  if (!file?.size || file.size > getLimits().documentBytes) throw new Error('图片不能为空，且不能超过 5 MiB。');
  if (!/\.(png|jpe?g|webp)$/i.test(file.name) && !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('支持 PNG、JPEG 和 WebP 图片。');
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('图片无法解码，请检查文件是否损坏。'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > getLimits().imagePixels) throw new Error('图片最多 1200 万像素，请缩小后重试。');
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, getLimits().imageEdge / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', attempt ? 0.76 : 0.88);
      if (dataUrl.length <= getLimits().imageBytes * 4 / 3 + 23) return validateImages([{ name: file.name, dataUrl }])[0];
      scale *= 0.8;
    }
    throw new Error('图片压缩后仍过大，请裁剪重点区域后重试。');
  } finally { bitmap.close(); }
}

export function imageParts(messages, protocol) {
  return messages.map(({ role, content, images }) => ({ role,
    content: images?.length ? [
      { type: protocol === 'responses' ? 'input_text' : 'text', text: content },
      ...images.map(image => protocol === 'responses'
        ? { type: 'input_image', image_url: image.dataUrl, detail: 'auto' }
        : { type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } }),
    ] : content,
  }));
}
