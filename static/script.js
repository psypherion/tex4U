document.addEventListener('DOMContentLoaded', () => {

  // ---------- CodeMirror ----------
  const starterSource = [
    '\\documentclass{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage{amsmath, amssymb}',
    '\\usepackage{graphicx}',
    '',
    '\\begin{document}',
    '\\title{My Document}',
    '\\author{Local LaTeX}',
    '\\date{\\today}',
    '\\maketitle',
    '\\section{Introduction}',
    'Hello!',
    '% \\includegraphics[width=0.5\\textwidth]{figures/example.png}',
    '\\begin{equation}',
    '  E = mc^2',
    '\\end{equation}',
    '\\end{document}'
  ].join('\n');

  const editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
    mode: 'text/x-latex',
    theme: 'material-darker',
    lineNumbers: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    value: starterSource
  });

  // ---------- DOM elements ----------
  const compileBtn = document.getElementById('compile-btn');
  const downloadBtn = document.getElementById('download-btn');
  const newProjectBtn = document.getElementById('new-project-btn');
  const renameProjectBtn = document.getElementById('rename-project-btn');
  const toggleFilesBtn = document.getElementById('toggle-files-btn');
  const closeFilesBtn = document.getElementById('close-files-btn');
  const filesPanel = document.getElementById('files-panel');
  const fileInput = document.getElementById('file-input');
  const uploadBtn = document.getElementById('upload-btn');
  const fileTreeDiv = document.getElementById('file-tree');
  const statusSpan = document.getElementById('status');
  const logDiv = document.getElementById('log');
  const pdfFrame = document.getElementById('pdf-frame');
  const projectNameSpan = document.getElementById('project-name');
  const newFolderNameInput = document.getElementById('new-folder-name');
  const createFolderBtn = document.getElementById('create-folder-btn');

  // Search elements
  const searchBtn = document.getElementById('search-btn');
  const searchBar = document.getElementById('search-bar');
  const searchInput = document.getElementById('search-input');
  const searchPrevBtn = document.getElementById('search-prev-btn');
  const searchNextBtn = document.getElementById('search-next-btn');
  const searchCaseSensitive = document.getElementById('search-case-sensitive');
  const searchCloseBtn = document.getElementById('search-close-btn');

  // Cheat Sheet elements
  const cheatsheetBtn = document.getElementById('cheatsheet-btn');
  const cheatsheetModal = document.getElementById('cheatsheet-modal');
  const cheatsheetClose = document.getElementById('cheatsheet-close');
  const cheatsheetSearch = document.getElementById('cheatsheet-search');
  const cheatsheetList = document.getElementById('cheatsheet-list');

  let currentProjectId = null;
  let selectedUploadFolder = '';

  // Search state
  let searchMatches = [];
  let currentMatchIndex = -1;
  let searchMarkers = [];

  // ---------- UI helpers ----------
  function openFilesPanel() {
    filesPanel.classList.remove('collapsed');
    toggleFilesBtn.textContent = 'Files ◂';
  }
  function closeFilesPanel() {
    filesPanel.classList.add('collapsed');
    toggleFilesBtn.textContent = 'Files ▸';
  }
  toggleFilesBtn.addEventListener('click', () => {
    filesPanel.classList.contains('collapsed') ? openFilesPanel() : closeFilesPanel();
  });
  closeFilesBtn.addEventListener('click', closeFilesPanel);

  // ---------- Project management ----------
  async function createNewProject() {
    try {
      const resp = await fetch('/project', { method: 'POST' });
      if (!resp.ok) {
        const err = await resp.json();
        statusSpan.textContent = 'Error: ' + (err.detail || resp.status);
        return;
      }
      const data = await resp.json();
      currentProjectId = data.project_id;
      localStorage.setItem('latexProjectId', currentProjectId);
      projectNameSpan.textContent = currentProjectId;
      pdfFrame.src = '';
      logDiv.textContent = '';
      statusSpan.textContent = 'New project created';
      editor.setValue(starterSource);
      await updateFileTree();
    } catch (e) {
      statusSpan.textContent = 'Failed to create project';
    }
  }

  async function renameProject() {
    if (!currentProjectId) return;
    const newName = prompt('Enter new project name:', currentProjectId);
    if (!newName || newName.trim() === '' || newName.trim() === currentProjectId) return;
    try {
      const resp = await fetch(`/project/${currentProjectId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName.trim() })
      });
      if (!resp.ok) {
        const err = await resp.json();
        alert('Rename failed: ' + (err.detail || resp.status));
        return;
      }
      const data = await resp.json();
      currentProjectId = data.project_id;
      localStorage.setItem('latexProjectId', currentProjectId);
      projectNameSpan.textContent = currentProjectId;
      pdfFrame.src = `/pdf/${currentProjectId}?t=${Date.now()}`;
      statusSpan.textContent = 'Project renamed';
    } catch (e) {
      alert('Rename error: ' + e.message);
    }
  }

  async function ensureProject() {
    const storedId = localStorage.getItem('latexProjectId');
    if (!storedId) {
      await createNewProject();
      return;
    }
    currentProjectId = storedId;
    projectNameSpan.textContent = currentProjectId;
    try {
      const resp = await fetch(`/files/${currentProjectId}`);
      if (!resp.ok && resp.status === 404) {
        await createNewProject();
      }
    } catch {
      await createNewProject();
    }
  }

  // ---------- File tree ----------
  async function updateFileTree() {
    if (!currentProjectId) return;
    try {
      const resp = await fetch(`/files/${currentProjectId}`);
      if (!resp.ok) {
        if (resp.status === 404) {
          await createNewProject();
          return;
        }
        throw new Error(`Server responded with ${resp.status}`);
      }
      const tree = await resp.json();
      renderTree(tree, fileTreeDiv, '');
    } catch (e) {
      logDiv.textContent += `Error loading files: ${e.message}\n`;
    }
  }

  function renderTree(node, container, parentPath) {
    container.innerHTML = '';
    if (node.type === 'directory') {
      const children = node.children || [];
      if (parentPath === '') {
        children.forEach(child => {
          const childPath = child.name;
          container.appendChild(createTreeItem(child, childPath));
        });
      } else {
        const folderDiv = document.createElement('div');
        folderDiv.className = 'tree-folder';
        const header = document.createElement('div');
        header.className = 'tree-item folder-header';
        header.innerHTML = `
          <span class="tree-toggle">▼</span>
          <span class="tree-icon">📁</span>
          <span class="tree-name">${escapeHtml(node.name)}</span>
          <button class="delete-btn" data-path="${parentPath}" title="Delete folder">✕</button>
        `;
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        children.forEach(child => {
          const childPath = `${parentPath}/${child.name}`;
          childContainer.appendChild(createTreeItem(child, childPath));
        });
        folderDiv.appendChild(header);
        folderDiv.appendChild(childContainer);
        header.querySelector('.tree-toggle').addEventListener('click', () => {
          folderDiv.classList.toggle('collapsed');
          const toggle = header.querySelector('.tree-toggle');
          toggle.textContent = folderDiv.classList.contains('collapsed') ? '►' : '▼';
        });
        header.querySelector('.delete-btn').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Delete folder "${node.name}"? It must be empty.`)) {
            await deleteItem(parentPath);
          }
        });
        header.querySelector('.tree-name').addEventListener('click', () => {
          selectedUploadFolder = parentPath;
          statusSpan.textContent = `Upload target: ${parentPath || 'root'}`;
        });
        container.appendChild(folderDiv);
      }
    }
  }

  function createTreeItem(node, relativePath) {
    const item = document.createElement('div');
    if (node.type === 'directory') {
      const sub = document.createElement('div');
      sub.className = 'tree-node';
      renderTree(node, sub, relativePath);
      return sub;
    } else {
      item.className = 'tree-item';
      item.innerHTML = `
        <span class="tree-icon">📄</span>
        <span class="tree-name">${escapeHtml(node.name)}</span>
        <button class="delete-btn" data-path="${relativePath}" title="Delete file">✕</button>
      `;
      item.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete file "${node.name}"?`)) {
          await deleteItem(relativePath);
        }
      });
      item.querySelector('.tree-name').addEventListener('click', () => {
        const cursor = editor.getCursor();
        editor.replaceRange(relativePath, cursor);
      });
      return item;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------- Folder creation ----------
  createFolderBtn.addEventListener('click', async () => {
    const name = newFolderNameInput.value.trim();
    if (!name) return;
    if (!currentProjectId) return;
    try {
      const resp = await fetch(`/project/${currentProjectId}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirname: name, parent: selectedUploadFolder })
      });
      if (!resp.ok) {
        const err = await resp.json();
        logDiv.textContent += `Folder creation failed: ${err.detail}\n`;
      } else {
        newFolderNameInput.value = '';
        await updateFileTree();
      }
    } catch (e) {
      logDiv.textContent += `Error: ${e.message}\n`;
    }
  });

  // ---------- Upload ----------
  uploadBtn.addEventListener('click', async () => {
    if (!currentProjectId || fileInput.files.length === 0) return;
    statusSpan.textContent = 'Uploading...';
    for (let file of fileInput.files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', selectedUploadFolder);
      try {
        const resp = await fetch(`/upload/${currentProjectId}`, {
          method: 'POST',
          body: formData
        });
        if (!resp.ok) {
          const err = await resp.json();
          logDiv.textContent += `Upload failed for ${file.name}: ${err.detail}\n`;
        }
      } catch (e) {
        logDiv.textContent += `Upload error: ${e.message}\n`;
      }
    }
    statusSpan.textContent = 'Upload complete';
    fileInput.value = '';
    await updateFileTree();
  });

  async function deleteItem(relativePath) {
    if (!currentProjectId) return;
    try {
      const resp = await fetch(`/files/${currentProjectId}?path=${encodeURIComponent(relativePath)}`, {
        method: 'DELETE'
      });
      if (!resp.ok) {
        const err = await resp.json();
        logDiv.textContent += `Delete failed: ${err.detail}\n`;
      } else {
        await updateFileTree();
      }
    } catch (e) {
      logDiv.textContent += `Error: ${e.message}\n`;
    }
  }

  // ===================== CUSTOM SEARCH =====================

  function clearSearchHighlights() {
    searchMarkers.forEach(m => m.clear());
    searchMarkers = [];
    searchMatches = [];
    currentMatchIndex = -1;
  }

  function highlightMatches(query, caseSensitive) {
    clearSearchHighlights();
    if (!query) return;

    const text = editor.getValue();
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const from = indexToPos(text, match.index);
      const to = indexToPos(text, match.index + match[0].length);
      searchMatches.push(from);
      const marker = editor.markText(from, to, {
        className: 'cm-search-match'
      });
      searchMarkers.push(marker);
    }
  }

  function indexToPos(text, index) {
    let line = 0, ch = 0;
    for (let i = 0; i < index; i++) {
      if (text[i] === '\n') {
        line++;
        ch = 0;
      } else {
        ch++;
      }
    }
    return { line, ch };
  }

  function moveToNextMatch() {
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    const pos = searchMatches[currentMatchIndex];
    editor.scrollIntoView(pos, 80);
    editor.setSelection(pos, pos);
  }

  function moveToPrevMatch() {
    if (searchMatches.length === 0) return;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    const pos = searchMatches[currentMatchIndex];
    editor.scrollIntoView(pos, 80);
    editor.setSelection(pos, pos);
  }

  function openSearchBar() {
    searchBar.style.display = 'flex';
    searchBar.classList.add('show');
    searchInput.value = '';
    searchInput.focus();
    clearSearchHighlights();
  }

  function closeSearchBar() {
    searchBar.style.display = 'none';
    searchBar.classList.remove('show');
    clearSearchHighlights();
    editor.focus();
  }

  searchBtn.addEventListener('click', () => {
    if (searchBar.style.display === 'none' || searchBar.style.display === '') {
      openSearchBar();
    } else {
      closeSearchBar();
    }
  });

  searchCloseBtn.addEventListener('click', closeSearchBar);

  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    const caseSensitive = searchCaseSensitive.checked;
    highlightMatches(query, caseSensitive);
    if (searchMatches.length > 0) {
      currentMatchIndex = 0;
      const pos = searchMatches[0];
      editor.scrollIntoView(pos, 80);
      editor.setSelection(pos, pos);
    }
  });

  searchNextBtn.addEventListener('click', moveToNextMatch);
  searchPrevBtn.addEventListener('click', moveToPrevMatch);

  searchCaseSensitive.addEventListener('change', () => {
    const query = searchInput.value;
    highlightMatches(query, searchCaseSensitive.checked);
    if (searchMatches.length > 0) {
      currentMatchIndex = 0;
      const pos = searchMatches[0];
      editor.scrollIntoView(pos, 80);
      editor.setSelection(pos, pos);
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        moveToPrevMatch();
      } else {
        moveToNextMatch();
      }
    } else if (e.key === 'Escape') {
      closeSearchBar();
    }
  });

  // ===================== CHEAT SHEET =====================

  const latexCommands = [

  /* ==========================================================
     DOCUMENT & IEEE
  ========================================================== */

  { cat:'Document', cmd:'\\documentclass{article}', desc:'Article class' },
  { cat:'Document', cmd:'\\documentclass[journal]{IEEEtran}', desc:'IEEE Journal' },
  { cat:'Document', cmd:'\\documentclass[conference]{IEEEtran}', desc:'IEEE Conference' },
  { cat:'Document', cmd:'\\begin{document}' },
  { cat:'Document', cmd:'\\end{document}' },
  { cat:'Document', cmd:'\\usepackage{}' },
  { cat:'Document', cmd:'\\RequirePackage{}' },

  /* ==========================================================
     TITLE
  ========================================================== */

  { cat:'Title', cmd:'\\title{}' },
  { cat:'Title', cmd:'\\author{}' },
  { cat:'Title', cmd:'\\date{}' },
  { cat:'Title', cmd:'\\maketitle' },
  { cat:'Title', cmd:'\\thanks{}' },

  /* ==========================================================
     STRUCTURE
  ========================================================== */

  { cat:'Structure', cmd:'\\part{}' },
  { cat:'Structure', cmd:'\\chapter{}' },
  { cat:'Structure', cmd:'\\section{}' },
  { cat:'Structure', cmd:'\\subsection{}' },
  { cat:'Structure', cmd:'\\subsubsection{}' },
  { cat:'Structure', cmd:'\\paragraph{}' },
  { cat:'Structure', cmd:'\\subparagraph{}' },
  { cat:'Structure', cmd:'\\tableofcontents' },

  /* ==========================================================
     TEXT FORMATTING
  ========================================================== */

  { cat:'Text', cmd:'\\textbf{}' },
  { cat:'Text', cmd:'\\textit{}' },
  { cat:'Text', cmd:'\\underline{}' },
  { cat:'Text', cmd:'\\emph{}' },
  { cat:'Text', cmd:'\\texttt{}' },
  { cat:'Text', cmd:'\\textsf{}' },
  { cat:'Text', cmd:'\\textrm{}' },
  { cat:'Text', cmd:'\\textsc{}' },
  { cat:'Text', cmd:'\\textnormal{}' },

  /* ==========================================================
     FONT DECLARATIONS
  ========================================================== */

  { cat:'Font', cmd:'\\rmfamily' },
  { cat:'Font', cmd:'\\sffamily' },
  { cat:'Font', cmd:'\\ttfamily' },
  { cat:'Font', cmd:'\\bfseries' },
  { cat:'Font', cmd:'\\mdseries' },
  { cat:'Font', cmd:'\\itshape' },
  { cat:'Font', cmd:'\\slshape' },
  { cat:'Font', cmd:'\\upshape' },
  { cat:'Font', cmd:'\\scshape' },

  /* ==========================================================
     FONT SIZES
  ========================================================== */

  { cat:'Font Size', cmd:'\\tiny' },
  { cat:'Font Size', cmd:'\\scriptsize' },
  { cat:'Font Size', cmd:'\\footnotesize' },
  { cat:'Font Size', cmd:'\\small' },
  { cat:'Font Size', cmd:'\\normalsize' },
  { cat:'Font Size', cmd:'\\large' },
  { cat:'Font Size', cmd:'\\Large' },
  { cat:'Font Size', cmd:'\\LARGE' },
  { cat:'Font Size', cmd:'\\huge' },
  { cat:'Font Size', cmd:'\\Huge' },

  /* ==========================================================
     LISTS
  ========================================================== */

  { cat:'Lists', cmd:'\\begin{itemize}' },
  { cat:'Lists', cmd:'\\begin{enumerate}' },
  { cat:'Lists', cmd:'\\begin{description}' },
  { cat:'Lists', cmd:'\\item' },

  /* ==========================================================
     ALIGNMENT
  ========================================================== */

  { cat:'Alignment', cmd:'\\centering' },
  { cat:'Alignment', cmd:'\\raggedright' },
  { cat:'Alignment', cmd:'\\raggedleft' },
  { cat:'Alignment', cmd:'\\begin{center}' },
  { cat:'Alignment', cmd:'\\begin{flushleft}' },
  { cat:'Alignment', cmd:'\\begin{flushright}' },

  /* ==========================================================
     TABLES
  ========================================================== */

  { cat:'Tables', cmd:'\\begin{table}' },
  { cat:'Tables', cmd:'\\begin{table*}' },
  { cat:'Tables', cmd:'\\begin{tabular}' },
  { cat:'Tables', cmd:'\\begin{tabular*}' },
  { cat:'Tables', cmd:'\\hline' },
  { cat:'Tables', cmd:'\\cline{}' },
  { cat:'Tables', cmd:'\\multicolumn{}{}{}' },
  { cat:'Tables', cmd:'\\multirow{}{}{}' },
  { cat:'Tables', cmd:'\\toprule' },
  { cat:'Tables', cmd:'\\midrule' },
  { cat:'Tables', cmd:'\\bottomrule' },

  /* ==========================================================
     FIGURES
  ========================================================== */

  { cat:'Figures', cmd:'\\begin{figure}' },
  { cat:'Figures', cmd:'\\begin{figure*}' },
  { cat:'Figures', cmd:'\\includegraphics{}' },
  { cat:'Figures', cmd:'\\caption{}' },
  { cat:'Figures', cmd:'\\label{}' },

  /* ==========================================================
     REFERENCES
  ========================================================== */

  { cat:'References', cmd:'\\label{}' },
  { cat:'References', cmd:'\\ref{}' },
  { cat:'References', cmd:'\\pageref{}' },
  { cat:'References', cmd:'\\cite{}' },
  { cat:'References', cmd:'\\citep{}' },
  { cat:'References', cmd:'\\citet{}' },

  /* ==========================================================
     SETS
  ========================================================== */

  { cat:'Sets', cmd:'\\mathbb{N}' },
  { cat:'Sets', cmd:'\\mathbb{Z}' },
  { cat:'Sets', cmd:'\\mathbb{Q}' },
  { cat:'Sets', cmd:'\\mathbb{R}' },
  { cat:'Sets', cmd:'\\mathbb{C}' },
  { cat:'Sets', cmd:'\\emptyset' },
  { cat:'Sets', cmd:'\\cup' },
  { cat:'Sets', cmd:'\\cap' },
  { cat:'Sets', cmd:'\\subset' },
  { cat:'Sets', cmd:'\\subseteq' },
  { cat:'Sets', cmd:'\\supset' },
  { cat:'Sets', cmd:'\\supseteq' },
  { cat:'Sets', cmd:'\\setminus' },

  /* ==========================================================
     LOGIC
  ========================================================== */

  { cat:'Logic', cmd:'\\forall' },
  { cat:'Logic', cmd:'\\exists' },
  { cat:'Logic', cmd:'\\nexists' },
  { cat:'Logic', cmd:'\\land' },
  { cat:'Logic', cmd:'\\lor' },
  { cat:'Logic', cmd:'\\neg' },
  { cat:'Logic', cmd:'\\implies' },
  { cat:'Logic', cmd:'\\iff' },

  /* ==========================================================
     RELATIONS
  ========================================================== */

  { cat:'Relations', cmd:'\\leq' },
  { cat:'Relations', cmd:'\\geq' },
  { cat:'Relations', cmd:'\\neq' },
  { cat:'Relations', cmd:'\\equiv' },
  { cat:'Relations', cmd:'\\approx' },
  { cat:'Relations', cmd:'\\sim' },
  { cat:'Relations', cmd:'\\propto' },
  { cat:'Relations', cmd:'\\cong' },

  /* ==========================================================
     CALCULUS
  ========================================================== */

  { cat:'Calculus', cmd:'\\frac{}{}' },
  { cat:'Calculus', cmd:'\\sqrt{}' },
  { cat:'Calculus', cmd:'\\sqrt[n]{}' },
  { cat:'Calculus', cmd:'\\sum' },
  { cat:'Calculus', cmd:'\\prod' },
  { cat:'Calculus', cmd:'\\int' },
  { cat:'Calculus', cmd:'\\oint' },
  { cat:'Calculus', cmd:'\\iint' },
  { cat:'Calculus', cmd:'\\iiint' },
  { cat:'Calculus', cmd:'\\lim' },
  { cat:'Calculus', cmd:'\\partial' },
  { cat:'Calculus', cmd:'\\nabla' },
  { cat:'Calculus', cmd:'\\nabla^2' },

  /* ==========================================================
     LINEAR ALGEBRA
  ========================================================== */

  { cat:'Linear Algebra', cmd:'\\mathbf{x}' },
  { cat:'Linear Algebra', cmd:'\\mathbf{A}' },
  { cat:'Linear Algebra', cmd:'\\boldsymbol{\\theta}' },
  { cat:'Linear Algebra', cmd:'\\cdot' },
  { cat:'Linear Algebra', cmd:'\\times' },
  { cat:'Linear Algebra', cmd:'\\otimes' },
  { cat:'Linear Algebra', cmd:'\\oplus' },
  { cat:'Linear Algebra', cmd:'\\det' },
  { cat:'Linear Algebra', cmd:'\\operatorname{rank}' },
  { cat:'Linear Algebra', cmd:'\\operatorname{trace}' },

  /* ==========================================================
     MATRICES
  ========================================================== */

  { cat:'Matrices', cmd:'\\begin{matrix}' },
  { cat:'Matrices', cmd:'\\begin{pmatrix}' },
  { cat:'Matrices', cmd:'\\begin{bmatrix}' },
  { cat:'Matrices', cmd:'\\begin{Bmatrix}' },
  { cat:'Matrices', cmd:'\\begin{vmatrix}' },
  { cat:'Matrices', cmd:'\\begin{Vmatrix}' },

  /* ==========================================================
     PROBABILITY & STATISTICS
  ========================================================== */

  { cat:'Probability', cmd:'\\mathbb{P}' },
  { cat:'Probability', cmd:'\\mathbb{E}' },
  { cat:'Probability', cmd:'\\operatorname{Var}' },
  { cat:'Probability', cmd:'\\operatorname{Cov}' },
  { cat:'Probability', cmd:'\\Pr' },
  { cat:'Probability', cmd:'\\mathcal{N}(\\mu,\\sigma^2)' },

  /* ==========================================================
     OPTIMIZATION
  ========================================================== */

  { cat:'Optimization', cmd:'\\min' },
  { cat:'Optimization', cmd:'\\max' },
  { cat:'Optimization', cmd:'\\arg\\min' },
  { cat:'Optimization', cmd:'\\arg\\max' },
  { cat:'Optimization', cmd:'\\operatorname*{argmin}' },
  { cat:'Optimization', cmd:'\\operatorname*{argmax}' },

  /* ==========================================================
     PDE / PINNS
  ========================================================== */

  { cat:'PDE', cmd:'\\partial_t u' },
  { cat:'PDE', cmd:'\\partial_x u' },
  { cat:'PDE', cmd:'\\partial_{xx}u' },
  { cat:'PDE', cmd:'\\Delta u' },
  { cat:'PDE', cmd:'\\nabla\\cdot' },
  { cat:'PDE', cmd:'\\nabla\\times' },

  { cat:'PINNs', cmd:'\\mathcal{L}_{data}' },
  { cat:'PINNs', cmd:'\\mathcal{L}_{PDE}' },
  { cat:'PINNs', cmd:'\\mathcal{L}_{BC}' },
  { cat:'PINNs', cmd:'u_{\\theta}(x,t)' },
  { cat:'PINNs', cmd:'\\nabla_{\\theta}' },

  /* ==========================================================
     AMSMATH
  ========================================================== */

  { cat:'AMSMath', cmd:'\\begin{align}' },
  { cat:'AMSMath', cmd:'\\begin{align*}' },
  { cat:'AMSMath', cmd:'\\begin{gather}' },
  { cat:'AMSMath', cmd:'\\begin{multline}' },
  { cat:'AMSMath', cmd:'\\begin{split}' },
  { cat:'AMSMath', cmd:'\\boxed{}' },
  { cat:'AMSMath', cmd:'\\tag{}' },
  { cat:'AMSMath', cmd:'\\numberwithin{equation}{section}' },

  /* ==========================================================
     THEOREMS
  ========================================================== */

  { cat:'Theorems', cmd:'\\newtheorem{}{}' },
  { cat:'Theorems', cmd:'\\begin{theorem}' },
  { cat:'Theorems', cmd:'\\begin{lemma}' },
  { cat:'Theorems', cmd:'\\begin{proposition}' },
  { cat:'Theorems', cmd:'\\begin{corollary}' },
  { cat:'Theorems', cmd:'\\begin{proof}' },
  { cat:'Theorems', cmd:'\\qedhere' },

  /* ==========================================================
     GREEK LETTERS
  ========================================================== */

  { cat:'Greek', cmd:'\\alpha' },
  { cat:'Greek', cmd:'\\beta' },
  { cat:'Greek', cmd:'\\gamma' },
  { cat:'Greek', cmd:'\\delta' },
  { cat:'Greek', cmd:'\\epsilon' },
  { cat:'Greek', cmd:'\\varepsilon' },
  { cat:'Greek', cmd:'\\theta' },
  { cat:'Greek', cmd:'\\vartheta' },
  { cat:'Greek', cmd:'\\lambda' },
  { cat:'Greek', cmd:'\\mu' },
  { cat:'Greek', cmd:'\\pi' },
  { cat:'Greek', cmd:'\\rho' },
  { cat:'Greek', cmd:'\\sigma' },
  { cat:'Greek', cmd:'\\tau' },
  { cat:'Greek', cmd:'\\phi' },
  { cat:'Greek', cmd:'\\varphi' },
  { cat:'Greek', cmd:'\\omega' },
  { cat:'Greek', cmd:'\\Gamma' },
  { cat:'Greek', cmd:'\\Delta' },
  { cat:'Greek', cmd:'\\Theta' },
  { cat:'Greek', cmd:'\\Lambda' },
  { cat:'Greek', cmd:'\\Pi' },
  { cat:'Greek', cmd:'\\Sigma' },
  { cat:'Greek', cmd:'\\Phi' },
  { cat:'Greek', cmd:'\\Omega' },

  /* ==========================================================
     BIBTEX
  ========================================================== */

  { cat:'BibTeX', cmd:'\\bibliographystyle{IEEEtran}' },
  { cat:'BibTeX', cmd:'\\bibliography{}' },

  /* ==========================================================
     IEEE COMMON PACKAGES
  ========================================================== */

  { cat:'IEEE', cmd:'\\usepackage{amsmath}' },
  { cat:'IEEE', cmd:'\\usepackage{amssymb}' },
  { cat:'IEEE', cmd:'\\usepackage{amsfonts}' },
  { cat:'IEEE', cmd:'\\usepackage{amsthm}' },
  { cat:'IEEE', cmd:'\\usepackage{mathtools}' },
  { cat:'IEEE', cmd:'\\usepackage{bm}' },
  { cat:'IEEE', cmd:'\\usepackage{graphicx}' },
  { cat:'IEEE', cmd:'\\usepackage{subcaption}' },
  { cat:'IEEE', cmd:'\\usepackage{booktabs}' },
  { cat:'IEEE', cmd:'\\usepackage{multirow}' },
  { cat:'IEEE', cmd:'\\usepackage{algorithm}' },
  { cat:'IEEE', cmd:'\\usepackage{algpseudocode}' },
  { cat:'IEEE', cmd:'\\usepackage{siunitx}' },

  ];


  function renderCheatsheet(query) {
    cheatsheetList.innerHTML = '';
    const lowerQuery = query.toLowerCase();
    let currentCategory = '';

    latexCommands
      .filter(item => {
        if (!query) return true;
        return item.cmd.toLowerCase().includes(lowerQuery) ||
               item.desc.toLowerCase().includes(lowerQuery) ||
               item.cat.toLowerCase().includes(lowerQuery);
      })
      .forEach(item => {
        if (item.cat !== currentCategory) {
          currentCategory = item.cat;
          const catHeader = document.createElement('div');
          catHeader.className = 'cheatsheet-category';
          catHeader.textContent = currentCategory;
          cheatsheetList.appendChild(catHeader);
        }

        const div = document.createElement('div');
        div.className = 'cheatsheet-item';
        div.innerHTML = `<span class="cmd">${item.cmd}</span><span class="desc">${item.desc}</span>`;
        div.addEventListener('click', () => {
          const code = item.cmd.replace(/\n\s*/g, '\n'); // keep formatting
          const cursor = editor.getCursor();
          editor.replaceRange(code, cursor);
          closeCheatsheet();
          editor.focus();
        });
        cheatsheetList.appendChild(div);
      });
  }

  function openCheatsheet() {
    cheatsheetModal.classList.add('show');
    cheatsheetSearch.value = '';
    cheatsheetSearch.focus();
    renderCheatsheet('');
  }

  function closeCheatsheet() {
    cheatsheetModal.classList.remove('show');
  }

  cheatsheetBtn.addEventListener('click', openCheatsheet);
  cheatsheetClose.addEventListener('click', closeCheatsheet);
  cheatsheetSearch.addEventListener('input', () => renderCheatsheet(cheatsheetSearch.value));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cheatsheetModal.classList.contains('show')) {
      closeCheatsheet();
    }
  });

  cheatsheetModal.addEventListener('click', (e) => {
    if (e.target === cheatsheetModal) closeCheatsheet();
  });

  // ===================== COMPILATION =====================
  async function compile() {
    const source = editor.getValue();
    if (!source.trim() || !currentProjectId) return;
    statusSpan.textContent = 'Compiling…';
    logDiv.textContent = '';
    try {
      const response = await fetch('/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, project_id: currentProjectId })
      });
      const data = await response.json();
      if (data.success) {
        currentProjectId = data.project_id;
        localStorage.setItem('latexProjectId', currentProjectId);
        pdfFrame.src = `/pdf/${currentProjectId}?t=${Date.now()}`;
        statusSpan.textContent = '✓ Compilation successful';
        downloadBtn.disabled = false;
        logDiv.textContent = data.log || '';
      } else {
        statusSpan.textContent = '✗ Compilation failed';
        logDiv.textContent = data.log || data.error || 'Unknown error';
      }
    } catch (err) {
      statusSpan.textContent = '✗ Network error';
      logDiv.textContent = err.message;
    }
  }

  // ---------- Event listeners ----------
  compileBtn.addEventListener('click', compile);
  newProjectBtn.addEventListener('click', createNewProject);
  renameProjectBtn.addEventListener('click', renameProject);
  downloadBtn.addEventListener('click', () => {
    if (currentProjectId) window.open(`/pdf/${currentProjectId}`, '_blank');
  });

  // Editor extra keys (only compile)
  editor.setOption('extraKeys', {
    'Ctrl-Enter': compile,
    'Cmd-Enter': compile
  });

  // ---------- Initialisation ----------
  ensureProject().then(() => {
    updateFileTree();
    if (currentProjectId) {
      pdfFrame.src = `/pdf/${currentProjectId}?t=${Date.now()}`;
      downloadBtn.disabled = false;
    }
  });

});