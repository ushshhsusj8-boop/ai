(function () {
  function tableCsv(rows) {
    const cell=value=>{
      let text=String(value??'');
      // Spreadsheet applications must treat untrusted model output as text.
      if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text;
      return '"'+text.replace(/"/g,'""')+'"';
    };
    return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
  }
  function download(rows) {
    const url=URL.createObjectURL(new Blob([tableCsv(rows)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='plaude-table.csv';
    document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.plaudeTableExport={tableCsv,download};
})();
