import { Extension } from '@tiptap/core';
import { paragraphBordersAttribute } from './paragraph-borders';
import { paragraphBackgroundAttribute } from './paragraph-background';
import { paginationAttributes } from './paragraph-pagination';
import { indentAttributes } from './paragraph-indent';
import { tabIntervalAttribute } from './paragraph-tabs';
import { absoluteLengthPixels } from '../../domain/text/font-size';

export const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      ...paginationAttributes(),
      paragraphBorderJoin: {default:false,parseHTML:(el:HTMLElement)=>el.getAttribute('data-paragraph-border-join')==='true',renderHTML:(a:Record<string,unknown>)=>a.paragraphBorderJoin?{'data-paragraph-border-join':'true'}:{}},
      paragraphBorders: paragraphBordersAttribute(),
      paragraphBackground: paragraphBackgroundAttribute(),
      ...indentAttributes(),
      tabInterval: tabIntervalAttribute(),
      direction: { default: 'auto', parseHTML: el => ['ltr','rtl'].includes(el.getAttribute('dir') || el.style.direction) ? (el.getAttribute('dir') || el.style.direction) : 'auto', renderHTML: a => ({dir:a.direction || 'auto'}) },
      spaceBefore: { default: null, parseHTML: el => absoluteLengthPixels(el.style.marginTop), renderHTML: a => a.spaceBefore !== null ? { style: `margin-top: ${a.spaceBefore}px` } : {} },
      spaceAfter: { default: null, parseHTML: el => absoluteLengthPixels(el.style.marginBottom), renderHTML: a => a.spaceAfter !== null ? { style: `margin-bottom: ${a.spaceAfter}px` } : {} },
      lineHeight: { default: null, parseHTML: el => el.style.lineHeight || null, renderHTML: attrs => attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {} },
    } }];
  },
});
