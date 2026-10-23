import {describe,expect,it} from 'vitest';
import {CURRENT_DOCUMENT_VERSION,documentMigrations,migrateDocument,type DocumentMigration} from '../lib/domain/rules/document-migrations';
import {parseDocumentEnvelope} from '../lib/domain/rules/document-validation';
import {parseDocument} from '../lib/infrastructure/persistence/storage';

const v1=()=>({version:1,title:'Report',savedAt:'2026-10-02T12:00:00.000Z',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Body 中文'}]}]}});
// Sample v1→v2 upgrade: renames `title` to `name`.
const renameTitle:DocumentMigration=({title,...rest})=>({...rest,name:title});

describe('document migrations',()=>{
 it('matches the current format version',()=>{
  expect(documentMigrations).toHaveLength(CURRENT_DOCUMENT_VERSION-1);
 });
 it('passes a current v1 document through unchanged',()=>{
  const value=v1();
  expect(migrateDocument(value)).toEqual(v1());
  expect(parseDocument(JSON.stringify(value))).toMatchObject({version:CURRENT_DOCUMENT_VERSION,title:'Report'});
 });
 it('applies migrations in order up to the current version without mutating the input',()=>{
  const value=v1();
  const addTag:DocumentMigration=value=>({...value,tag:`v2:${value.name}`});
  expect(migrateDocument(value,[renameTitle],2)).toEqual({version:2,name:'Report',savedAt:value.savedAt,content:value.content});
  expect(migrateDocument(value,[renameTitle,addTag],3)).toMatchObject({version:3,name:'Report',tag:'v2:Report'});
  expect(migrateDocument({...value,version:2,name:'Already'},[renameTitle,addTag],3)).toMatchObject({version:3,tag:'v2:Already'});
  expect(value).toEqual(v1());
 });
 it('rejects versions newer than supported with a clear message',()=>{
  expect(()=>migrateDocument({...v1(),version:CURRENT_DOCUMENT_VERSION+1})).toThrow('created by a newer version of VDoc');
  expect(()=>parseDocument(JSON.stringify({...v1(),version:CURRENT_DOCUMENT_VERSION+1}))).toThrow('created by a newer version of VDoc');
 });
 it.each([0,-1,1.5,'1',null,undefined])('rejects invalid version %s as an unsupported backup',version=>{
  expect(()=>parseDocumentEnvelope(JSON.stringify({...v1(),version}))).toThrow('This is not a supported VDoc backup.');
 });
 it('rejects a migration list that does not reach the current version',()=>{
  expect(()=>migrateDocument(v1(),[],2)).toThrow('do not match');
 });
});
