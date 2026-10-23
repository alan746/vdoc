import { Fragment, type Node, type NodeType } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import type { Selection, Transaction } from '@tiptap/pm/state';
import { promotedItemContent } from './promote-items';

const isList=(node:Node)=>['orderedList','bulletList','taskList'].includes(node.type.name);
const isTextBlock=(node:Node)=>['paragraph','heading'].includes(node.type.name);

function eligibleBlocks(selection: CellSelection): Node[] {
  const blocks: Node[] = [];
  selection.forEachCell(cell => cell.forEach(node => { if (isList(node) || isTextBlock(node)) blocks.push(node); }));
  return blocks;
}

/** Direct lists in selected cells only: nested lists and nested tables own their settings. */
export function selectedCellLists(selection: Selection) {
  const lists: {node: Node; pos: number; parent: Node; parentStart: number}[] = [];
  if (selection instanceof CellSelection) selection.forEachCell((cell, pos) => {
    cell.forEach((node, offset) => {
      if (isList(node)) lists.push({node, pos: pos + 1 + offset, parent: cell, parentStart: pos + 1});
    });
  });
  return lists;
}

/** Match the bulk toggle semantics for toolbar feedback; mixed cells are inactive. */
export function selectedCellListType(selection: Selection): string | null {
  if (!(selection instanceof CellSelection)) return null;
  const blocks = eligibleBlocks(selection), first = blocks[0];
  return first && isList(first) && blocks.every(node => node.type === first.type) ? first.type.name : null;
}

/** Lift all directly selected list items by one level, independently in each cell. */
type CellPlan = { pos: number; node: Node; content: Fragment };
/** Writes planned cell contents (last cell first, so positions stay valid) and keeps the same cells selected. */
function applyCellPlans(tr: Transaction, selection: CellSelection, plans: CellPlan[]) {
  const mapFrom = tr.mapping.maps.length;
  for (const plan of plans.sort((a, b) => b.pos - a.pos)) tr.replaceWith(plan.pos + 1, plan.pos + plan.node.nodeSize - 1, plan.content);
  const mapping = tr.mapping.slice(mapFrom);
  tr.setSelection(CellSelection.create(tr.doc, mapping.map(selection.$anchorCell.pos), mapping.map(selection.$headCell.pos)));
  return true;
}

export function liftCellLists(tr: Transaction, write = true): boolean {
  const selection = tr.selection;
  if (!(selection instanceof CellSelection) || !selectedCellLists(selection).length) return false;
  const plans: CellPlan[] = [];
  let valid = true;
  selection.forEachCell((cell, pos) => {
    const output: Node[] = [];
    for (const node of cell.content.content) {
      if (!isList(node)) { output.push(node); continue; }
      // The outer items leave their list. Child lists keep their contents, markers
      // and identities; a promoted numbering chain must not attach to a new parent.
      for (const item of node.content.content) output.push(...promotedItemContent(item));
    }
    const content = Fragment.fromArray(output);
    if (!cell.type.validContent(content)) valid = false;
    if (!content.eq(cell.content)) plans.push({pos, node: cell, content});
  });
  if (!valid) return false;
  return !write || applyCellPlans(tr, selection, plans);
}

/** Plan every cell before writing. A mixed selection applies the type everywhere;
 * only an entirely matching selection removes that list type. Nested blocks stay intact. */
export function toggleCellLists(tr:Transaction,listType:NodeType,itemType:NodeType,write:boolean,attributes?:Record<string,unknown>):boolean {
  const selection=tr.selection;
  if(!(selection instanceof CellSelection))return false;
  const cells:{node:Node;pos:number}[]=[];
  selection.forEachCell((node,pos)=>cells.push({node,pos}));
  const eligible=eligibleBlocks(selection);
  if(!eligible.length)return false;
  const remove=eligible.every(node=>node.type===listType);
  const plans:CellPlan[]=[];
  for(const cell of cells){
    const output:{node:Node;origin?:Node}[]=[];
    let paragraphs:Node[]=[];
    const flush=()=>{
      if(paragraphs.length)output.push({node:listType.create(attributes,paragraphs.map(p=>itemType.create(null,p)))});
      paragraphs=[];
    };
    for(const node of cell.node.content.content){
      if(!remove && isTextBlock(node)){paragraphs.push(node);continue;}
      flush();
      if(remove && node.type===listType){
        for(const item of node.content.content)for(const child of item.content.content)output.push({node:child});
      }else if(isList(node) && node.type!==listType){
        const items=node.content.content.map(item=>itemType.create(null,item.content,item.marks));
        if(!items.every(item=>itemType.validContent(item.content)))return false;
        output.push({node:listType.create({...attributes,blockId:node.attrs.blockId},items),origin:node});
      }else output.push({node,origin:node});
    }
    flush();
    // New numbering in a gap must not change the start/style of an existing series.
    const previous=new Map<Node,Node|null>();let oldPrevious:Node|null=null;
    for(const node of cell.node.content.content)if(node.type.name==='orderedList'){previous.set(node,oldPrevious);oldPrevious=node;}
    let newPrevious:Node|null=null;
    for(const entry of output)if(entry.node.type.name==='orderedList'){
      if(entry.origin?.type.name==='orderedList' && entry.node.attrs.continuePrevious && previous.get(entry.origin)!==newPrevious){
        entry.node=entry.node.type.create({...entry.node.attrs,continuePrevious:false},entry.node.content,entry.node.marks);
      }
      newPrevious=entry.origin?.type.name==='orderedList'?entry.origin:entry.node;
    }
    const content=Fragment.fromArray(output.map(entry=>entry.node));
    if(!cell.node.type.validContent(content))return false;
    if(!content.eq(cell.node.content))plans.push({...cell,content});
  }
  return !write || applyCellPlans(tr,selection,plans);
}
