/** CSS absolute lengths use 96 pixels per inch, independent of display density. */
export function absoluteLengthPixels(value:unknown):number|null {
  if(typeof value!=='string')return null;
  const match=value.trim().match(/^(\d*\.?\d+)(px|pt|pc|in|cm|mm|q)$/i);
  if(!match)return null;
  const scale:Record<string,number>={px:1,pt:96/72,pc:16,in:96,cm:96/2.54,mm:96/25.4,q:96/101.6};
  const pixels=Number((Number(match[1])*scale[match[2].toLowerCase()]).toFixed(6));
  return Number.isFinite(pixels)&&pixels>=0?pixels:null;
}

/** Font sizes must be positive; layout lengths may explicitly be zero. */
export function absoluteFontPixels(value:unknown):number|null {
  const pixels=absoluteLengthPixels(value);
  return pixels !== null && pixels>0 ? pixels : null;
}
