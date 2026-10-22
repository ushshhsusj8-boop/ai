// Literal UTF-16 offsets preserve positions even when case folding changes length.
export function searchTerms(query) {
  return [...new Set(String(query || '').slice(0,200).trim().split(/\s+/u).filter(Boolean))];
}
function pattern(term) { return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu'); }
export function sectionMatches(text, terms, limit=2000) {
  if(!terms.length||limit<=0)return [];
  text=String(text || '');
  if(!terms.every(term=>pattern(term).test(text)))return [];
  const ranges=[];
  for(const term of terms) {
    for(const match of text.matchAll(pattern(term))) {
      ranges.push({offset:match.index,length:match[0].length});
      if(ranges.length>=limit)break;
    }
    if(ranges.length>=limit)break;
  }
  ranges.sort((a,b)=>a.offset-b.offset||b.length-a.length);
  const merged=[];
  for(const range of ranges){const last=merged.at(-1);if(last&&range.offset<last.offset+last.length)last.length=Math.max(last.length,range.offset+range.length-last.offset);else merged.push({...range});}
  return merged;
}
export function documentMatches(doc, query, limit=2000) {
  const terms=searchTerms(query),matches=[];
  if(!terms.length||limit<=0)return matches;
  for(let sectionIndex=0;sectionIndex<(doc.sections?.length||0);sectionIndex++) {
    const section=doc.sections[sectionIndex];
    for(const range of sectionMatches(section.text,terms,limit-matches.length)) {
      matches.push({documentId:doc.id,sectionIndex,location:section.label,...range,text:section.text.slice(range.offset,range.offset+range.length)});
      if(matches.length>=limit)return matches;
    }
  }
  return matches;
}
