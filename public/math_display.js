// Self-hosted KaTeX. Math is display-only; model text never enables HTML or URLs.
(function () {
  const pairs = {'$$':'$$', '$':'$', '\\(':'\\)', '\\[':'\\]'};
  function escaped(source, at) {
    let count=0; while(at>0 && source[--at]==='\\') count++;
    return count%2===1;
  }
  function segments(source) {
    source=String(source);
    const protectedRanges=[...source.matchAll(/`[^`\n]*`|\[[^\]\n]*\]\([^\s)]+\)/g)].map(m=>[m.index,m.index+m[0].length]);
    const protectedAt=at=>protectedRanges.some(([start,end])=>at>=start&&at<end);
    const parts=[], pattern=/\$\$|\\\(|\\\[|\$/g;
    let cursor=0, match, count=0;
    while((match=pattern.exec(source)) && count<100) {
      const at=match.index, left=match[0], right=pairs[left];
      if(escaped(source,at)||protectedAt(at))continue;
      let end=source.indexOf(right,at+left.length);
      while(end>=0 && (escaped(source,end)||protectedAt(end)))end=source.indexOf(right,end+right.length);
      if(end<0)continue;
      const text=source.slice(at+left.length,end);
      if(!text.trim() || (left==='$' && (text.includes('\n') || /\d/.test(source[end+1]||'') || /\d/.test(source[at-1]||''))))continue;
      if(at>cursor)parts.push({text:source.slice(cursor,at)});
      parts.push({text,raw:source.slice(at,end+right.length),math:true,display:left==='$$'||left==='\\['});
      count++; cursor=end+right.length; pattern.lastIndex=cursor;
    }
    if(cursor<source.length)parts.push({text:source.slice(cursor)});
    return parts;
  }
  function render(part) {
    const node=document.createElement(part.display?'div':'span');
    node.className=part.display?'message-math-block':'message-math-inline';
    node.dataset.mathSource=part.text;
    if(part.text.length>8000 || !window.katex) {node.textContent=part.raw;return node;}
    try {
      window.katex.render(part.text,node,{displayMode:part.display,throwOnError:true,trust:false,
        strict:'ignore',maxExpand:200,maxSize:10,macros:{},output:'htmlAndMathml'});
    } catch {
      node.textContent=part.raw;node.classList.add('message-math-fallback');
      node.title='此公式暂不能排版，保留原文。';
    }
    return node;
  }
  function blockAt(lines,index) {
    const opening=/^\s*(\$\$|\\\[)/.exec(lines[index]);
    if(!opening)return null;
    const left=opening[1],right=pairs[left],source=lines[index].slice(opening[0].length);
    let value=source;
    for(let end=index;end<Math.min(lines.length,index+200);end++) {
      if(end>index)value+='\n'+lines[end];
      const close=value.indexOf(right);
      if(close>=0 && !value.slice(close+right.length).trim())return {end,part:{text:value.slice(0,close),raw:left+value.slice(0,close)+right,display:true,math:true}};
      if(value.length>8000)return null;
    }
    return null;
  }
  window.plaudeMath={segments,render,blockAt};
})();
