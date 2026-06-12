import os
import shutil
import subprocess
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import uvicorn

app = FastAPI()

# All projects live here
DOCS_DIR = os.path.join(os.path.dirname(__file__), "docs")
os.makedirs(DOCS_DIR, exist_ok=True)

class CompileRequest(BaseModel):
    source: str
    project_id: str

class RenameRequest(BaseModel):
    new_name: str

class MkdirRequest(BaseModel):
    dirname: str
    parent: Optional[str] = None   # relative path from project root

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def index():
    return FileResponse("static/index.html")

# ---------- Project creation ----------
@app.post("/project")
async def create_project():
    """Create a new project folder under docs/ with a random ID."""
    project_id = os.urandom(8).hex()
    work_dir = os.path.join(DOCS_DIR, project_id)
    os.makedirs(work_dir, exist_ok=False)  # should never exist
    return {"project_id": project_id}

# ---------- Rename project folder ----------
@app.post("/project/{project_id}/rename")
async def rename_project(project_id: str, req: RenameRequest):
    """Rename the root folder of a project."""
    old_path = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(old_path):
        raise HTTPException(status_code=404, detail="Project not found")

    new_name = req.new_name.strip()
    if not new_name or new_name == project_id:
        raise HTTPException(status_code=400, detail="Invalid new name")
    new_path = os.path.join(DOCS_DIR, new_name)
    if os.path.exists(new_path):
        raise HTTPException(status_code=409, detail="A project with that name already exists")

    os.rename(old_path, new_path)
    return {"project_id": new_name}

# ---------- Compilation ----------
@app.post("/compile")
async def compile_latex(req: CompileRequest):
    source = req.source
    if not source.strip():
        raise HTTPException(status_code=400, detail="No source provided")

    work_dir = os.path.join(DOCS_DIR, req.project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="Project not found")

    tex_path = os.path.join(work_dir, "document.tex")
    with open(tex_path, "w", encoding="utf-8") as f:
        f.write(source)

    try:
        for _ in range(2):
            result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", "document.tex"],
                cwd=work_dir,
                capture_output=True,
                text=True,
                timeout=30
            )
        log = result.stdout + "\n" + result.stderr
        pdf_path = os.path.join(work_dir, "document.pdf")
        if not os.path.exists(pdf_path):
            return {"success": False, "log": log, "project_id": req.project_id}
        return {"success": True, "project_id": req.project_id, "log": log}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Compilation timed out")

# ---------- File tree ----------
def build_tree(work_dir, relative_path=""):
    node = {"name": os.path.basename(relative_path) if relative_path else "root",
            "type": "directory",
            "children": []}
    try:
        entries = sorted(os.listdir(os.path.join(work_dir, relative_path)))
    except OSError:
        return node
    for entry in entries:
        if entry in ["document.tex", "document.pdf"]:
            continue
        ext = os.path.splitext(entry)[1]
        if ext in [".aux", ".log", ".out", ".toc", ".lof", ".lot", ".bbl", ".blg"]:
            continue
        full = os.path.join(work_dir, relative_path, entry)
        rel = os.path.join(relative_path, entry).replace("\\", "/")
        if os.path.isdir(full):
            node["children"].append(build_tree(work_dir, rel))
        else:
            node["children"].append({"name": entry, "type": "file"})
    return node

@app.get("/files/{project_id}")
async def list_files(project_id: str):
    work_dir = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    tree = build_tree(work_dir)
    return tree

# ---------- Create folder ----------
@app.post("/project/{project_id}/mkdir")
async def make_directory(project_id: str, req: MkdirRequest):
    work_dir = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    parent = req.parent or ""
    parent = parent.replace("..", "").strip("/")
    target = os.path.normpath(os.path.join(work_dir, parent, req.dirname))
    if not target.startswith(work_dir):
        raise HTTPException(status_code=400, detail="Invalid path")
    os.makedirs(target, exist_ok=True)
    return {"created": os.path.relpath(target, work_dir)}

# ---------- File upload with optional folder ----------
@app.post("/upload/{project_id}")
async def upload_file(project_id: str,
                      file: UploadFile = File(...),
                      folder: str = Form("")):
    work_dir = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    folder = folder.replace("..", "").strip("/")
    dest_dir = os.path.join(work_dir, folder) if folder else work_dir
    os.makedirs(dest_dir, exist_ok=True)
    filename = os.path.basename(file.filename)
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    dest_path = os.path.join(dest_dir, filename)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"filename": filename, "folder": folder}

# ---------- Delete file or directory ----------
@app.delete("/files/{project_id}")
async def delete_item(project_id: str, path: str = ""):
    work_dir = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="Project not found")
    safe = path.replace("..", "").strip("/")
    target = os.path.normpath(os.path.join(work_dir, safe))
    if not target.startswith(work_dir):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Not found")
    if os.path.isfile(target):
        if os.path.basename(target) in ["document.tex", "document.pdf"]:
            raise HTTPException(status_code=400, detail="Cannot delete source or PDF")
        os.remove(target)
    elif os.path.isdir(target):
        if len(os.listdir(target)) > 0:
            raise HTTPException(status_code=400, detail="Directory not empty")
        os.rmdir(target)
    return {"deleted": safe}

# ---------- PDF serving ----------
@app.get("/pdf/{project_id}")
async def get_pdf(project_id: str):
    work_dir = os.path.join(DOCS_DIR, project_id)
    if not os.path.isdir(work_dir):
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(os.path.join(work_dir, "document.pdf"))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3000)