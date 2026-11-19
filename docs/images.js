import {LIMITS} from './checker.js';

// Read encoded dimensions before decoding to reject oversized images early.
export function encodedSize(buffer) {
  const b=new Uint8Array(buffer),v=new DataView(buffer);
  const ascii=(start,n)=>String.fromCharCode(...b.slice(start,start+n));
  if(b.length>=24 && b[0]===137 && ascii(1,3)==='PNG' && ascii(12,4)==='IHDR')return [v.getUint32(16),v.getUint32(20)];
  if(b.length>=4 && b[0]===255 && b[1]===216){
    let offset=2;
    while(offset+4<=b.length){
      if(b[offset++]!==255)break;while(b[offset]===255)offset++;
      const marker=b[offset++];if(marker===217||marker===218)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(offset+2>b.length)break;const length=v.getUint16(offset);
      if(length<2||offset+length>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)return [v.getUint16(offset+5),v.getUint16(offset+3)];
      offset+=length;
    }
  }
  if(b.length>=30 && ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP'){
    const type=ascii(12,4);
    if(type==='VP8X')return [1+b[24]+(b[25]<<8)+(b[26]<<16),1+b[27]+(b[28]<<8)+(b[29]<<16)];
    if(type==='VP8 ' && b[23]===157 && b[24]===1 && b[25]===42)return [v.getUint16(26,true)&0x3fff,v.getUint16(28,true)&0x3fff];
    if(type==='VP8L' && b[20]===47)return [1+(b[21]|(b[22]&63)<<8),1+((b[22]>>6)|b[23]<<2|(b[24]&15)<<10)];
  }
  throw new Error('Unreadable image header');
}

export async function inspectImage(file) {
  const bytes=await file.arrayBuffer(),[width,height]=encodedSize(bytes);
  if(!width||!height)throw new Error('Empty image');
  if(width*height>LIMITS.pixels){const error=new Error('Pixel limit');error.code='image_pixels';throw error;}
  const bitmap=await createImageBitmap(file);
  try {if(!bitmap.width||!bitmap.height)throw new Error('Decode failed');}finally {bitmap.close();}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {width,height,digest};
}
