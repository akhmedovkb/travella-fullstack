import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {parse}=require('@babel/parser');
const tree=parse(fs.readFileSync(new URL('../frontend/src/App.jsx',import.meta.url),'utf8'),{sourceType:'module',plugins:['jsx']});
const paths=new Set();
function visit(node,parent=''){
 if(!node||typeof node!=='object')return;
 let current=parent;
 if(node.type==='JSXElement'&&node.openingElement.name.name==='Route'){
  const attr=node.openingElement.attributes.find(a=>a.name?.name==='path');
  if(attr?.value?.value){const p=attr.value.value;current=p.startsWith('/')?p:(parent+'/'+p).replace(/\/+/g,'/');if(p!=='*')paths.add(current);}
 }
 for(const [key,value] of Object.entries(node)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(child=>visit(child,current));else if(value&&typeof value==='object')visit(value,current);}
}
visit(tree);
fs.writeFileSync(new URL('../shared/spaRoutes.json',import.meta.url),JSON.stringify([...paths].sort(),null,2)+'\n');
