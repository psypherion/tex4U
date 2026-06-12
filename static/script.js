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

let currentProjectId = null;
let selectedUploadFolder = '';   // relative path within project

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
  // Check if project exists by fetching file list
  try {
    const resp = await fetch(`/files/${currentProjectId}`);
    if (!resp.ok && resp.status === 404) {
      // Project folder missing – create a new one
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

// ---------- Compilation ----------
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
      currentProjectId = data.project_id;  // in case it changed, but it won't
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