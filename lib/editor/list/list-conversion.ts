import { CellSelection } from '@tiptap/pm/tables';
import { toggleCellLists } from './cell-lists';
import { Extension, commands as coreCommands, getNodeType, type CommandProps } from '@tiptap/core';
import { Fragment, type Node, type NodeType, type ResolvedPos } from '@tiptap/pm/model';
import { AllSelection, NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import { validListStart } from '../../domain/rules/list-numbering';

const isList = (node: Node) => ['orderedList','bulletList','taskList'].includes(node.type.name);
function listAt($pos: ResolvedPos) {
  for (let depth=$pos.depth;depth>0;depth--) {
    const node=$pos.node(depth);
    if (['tableCell','tableHeader'].includes(node.type.name)) return null;
    if (isList(node)) return {node,pos:$pos.before(depth),index:$pos.index(depth)};
  }
  return null;
}
function cellAt($pos: ResolvedPos): number | null {
  for(let depth=$pos.depth;depth>0;depth--)if(['tableCell','tableHeader'].includes($pos.node(depth).type.name))return $pos.before(depth);
  return null;
}
export function listSelectionBoundaryError(selection: Selection): string | null {
  if(selection instanceof CellSelection)return null;
  if (!(selection instanceof TextSelection || selection instanceof NodeSelection || selection instanceof AllSelection)) return 'Select text or table cells before changing the list type.';
  if(selection instanceof TextSelection && cellAt(selection.$from)!==cellAt(selection.$to.doc.resolve(Math.max(selection.from,selection.to-1)))) return 'Select text within one table cell before changing the list type.';
  if(selection instanceof NodeSelection && !isList(selection.node))return 'Select text before changing the list type.';
  return null;
}
function selectedItems(doc: Node, selection: Selection) {
  if (selection instanceof NodeSelection && isList(selection.node)) return {node:selection.node,pos:selection.from,from:0,to:selection.node.childCount};
  if (selection instanceof AllSelection && doc.firstChild && isList(doc.firstChild) && doc.content.content.slice(1).every(n=>n.type.name==='paragraph' && !n.content.size)) return {node:doc.firstChild!,pos:0,from:0,to:doc.firstChild!.childCount};
  if (!(selection instanceof TextSelection)) return null;
  const from=listAt(selection.$from),to=listAt(doc.resolve(Math.max(selection.from,selection.to-1)));
  return from && to && from.pos===to.pos ? {node:from.node,pos:from.pos,from:from.index,to:to.index+1} : null;
}
function toggle(listName: string | NodeType, itemName: string | NodeType, keepMarks: boolean | undefined, attributes: Record<string,unknown> | undefined, props: CommandProps): boolean {
  const {state,tr,editor,dispatch,commands,can}=props;
  if (editor.view.composing) return false;
  if(listSelectionBoundaryError(state.selection))return false;
  const listType=getNodeType(listName,state.schema),itemType=getNodeType(itemName,state.schema);
  if(state.selection instanceof CellSelection)return toggleCellLists(tr,listType,itemType,!!dispatch,attributes);
  const context=selectedItems(state.doc,state.selection);
  if (!context) {
    if(state.selection instanceof NodeSelection)return false;
    // Do not flatten existing structures to make an ambiguous selection fit.
    let containsStructure=!!listAt(state.selection.$from) || !!listAt(state.selection.$to);
    state.doc.nodesBetween(state.selection.from,state.selection.to,(node,pos)=>{if((isList(node) || node.type.name==='table') && pos>=state.selection.from && pos<state.selection.to)containsStructure=true;});
    if(containsStructure)return false;
    // A new list remains independent of adjacent lists and their custom settings.
    if(can().wrapInList(listType,attributes)) {
      const range=state.selection.$from.blockRange(state.selection.$to);
      let following: {pos:number;node:Node} | null=null;
      if(listType.name==='orderedList' && range) {
        let position=range.end;
        for(let i=range.endIndex;i<range.parent.childCount;i++) {
          const sibling=range.parent.child(i);
          if(sibling.type.name==='orderedList'){if(sibling.attrs.continuePrevious)following={pos:position,node:sibling};break;}
          position+=sibling.nodeSize;
        }
      }
      const mapFrom=tr.mapping.maps.length,ok=commands.wrapInList(listType,attributes);
      if(ok && dispatch && following)tr.setNodeMarkup(tr.mapping.slice(mapFrom).map(following.pos,1),undefined,{...following.node.attrs,continuePrevious:false});
      return ok;
    }
    return coreCommands.toggleList(listName,itemName,keepMarks,attributes)(props);
  }
  const {node,pos,from,to}=context;
  if(node.type===listType){
    if (!(state.selection instanceof TextSelection)) {
      if(!dispatch)return true;
      tr.setSelection(TextSelection.between(tr.doc.resolve(pos+1),tr.doc.resolve(pos+node.nodeSize-1)));
    }
    void state.tr;
    return commands.liftListItem(itemType);
  }
  const before:Node[]=[],selected:Node[]=[],after:Node[]=[];
  node.forEach((child,_offset,index)=>{
    if(index<from)before.push(child);
    else if(index>=to)after.push(child);
    else selected.push(itemType.create(null,child.content,child.marks));
  });
  if (!selected.length || !selected.every(child=>itemType.validContent(child.content)))return false;
  const splitCounter=node.type.name==='orderedList' && before.length && after.length ? node.attrs.start+before.length : null;
  if(splitCounter!==null && !validListStart(splitCounter))return false;
  const converted=listType.create({...attributes,blockId:!before.length&&!after.length?node.attrs.blockId:null},selected);
  const replacements:Node[]=[];
  if(before.length)replacements.push(node.copy(Fragment.fromArray(before)));
  replacements.push(converted);
  if(after.length)replacements.push(node.type.create({...node.attrs,blockId:before.length?null:node.attrs.blockId,...(splitCounter!==null?{start:splitCounter,continuePrevious:true}:{})},after));
  const $list=state.doc.resolve(pos),replacement=Fragment.fromArray(replacements);
  if(!$list.parent.canReplace($list.index(),$list.index()+1,replacement))return false;
  if(!dispatch)return true;
  // A newly numbered series must not steal an existing continuation, nor should
  // removing its entire source redirect it to some older, unrelated series.
  let protectFollowing: {pos:number;node:Node} | null=null;
  if(listType.name==='orderedList' || (node.type.name==='orderedList' && !before.length && !after.length)) {
    let siblingPos=pos+node.nodeSize;
    for(let index=$list.index()+1;index<$list.parent.childCount;index++) {
      const sibling=$list.parent.child(index);
      if(sibling.type.name==='orderedList') {
        if(sibling.attrs.continuePrevious)protectFollowing={pos:siblingPos,node:sibling};
        break;
      }
      siblingPos+=sibling.nodeSize;
    }
  }
  const selection=tr.selection,marks=tr.storedMarks,mapFrom=tr.mapping.maps.length;
  tr.replaceWith(pos,pos+node.nodeSize,replacement);
  if(protectFollowing)tr.setNodeMarkup(tr.mapping.slice(mapFrom).map(protectFollowing.pos,1),undefined,{...protectFollowing.node.attrs,continuePrevious:false});
  const convertedPos=pos+(before.length?replacements[0].nodeSize:0);
  if(selection instanceof TextSelection){
    // Item contents keep their sizes; splitting the prefix adds two wrapper tokens.
    const shift=before.length?2:0;
    tr.setSelection(TextSelection.create(tr.doc,selection.anchor+shift,selection.head+shift));
  }else if(selection instanceof NodeSelection)tr.setSelection(NodeSelection.create(tr.doc,convertedPos));
  else tr.setSelection(new AllSelection(tr.doc));
  if(marks)tr.setStoredMarks(marks);
  return true;
}

export const ListConversion=Extension.create({
  name:'vdocListConversion',priority:85,
  addCommands(){return {toggleList:(list,item,keepMarks,attributes)=>props=>toggle(list,item,keepMarks,attributes,props)};},
});
