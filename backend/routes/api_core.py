"""API domain routes: core. Auto-split from api.py — behavior unchanged."""
import routes.api_shared as _api_shared
from routes.api_shared import api  # noqa: F401
globals().update({k: v for k, v in vars(_api_shared).items() if not k.startswith("__")})

import routes.api_archive as _api_archive
globals().update({k: v for k, v in vars(_api_archive).items() if not k.startswith("__") and k != "api"})

import routes.api_marketplus as _api_marketplus
globals().update({k: v for k, v in vars(_api_marketplus).items() if not k.startswith("__") and k != "api"})

@api.route("/projects", methods=["POST"])
def create_project():
    """Upload product image and create a new project."""
    if "image" not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    # Save uploaded file
    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(Config.UPLOAD_FOLDER, filename)
    file.save(filepath)

    product_name = request.form.get("product_name", "")
    project = pipeline.create_project(filepath, product_name)

    return jsonify({
        "project_id": project["id"],
        "status": project["status"],
        "message": "프로젝트가 생성되었습니다.",
    }), 201


@api.route("/projects/<project_id>", methods=["GET"])
def get_project(project_id):
    """Get project status and summary."""
    summary = pipeline.get_project_summary(project_id)
    if not summary:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(summary)


@api.route("/projects/<project_id>/full", methods=["GET"])
def get_project_full(project_id):
    """Get full project data including all sections."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    # Convert image paths to URLs
    result = {
        "id": project["id"],
        "status": project["status"],
        "progress": project["progress"],
        "progress_message": project["progress_message"],
        "analysis": project.get("analysis"),
        "competitor_data": project.get("competitor_data"),
        "sections": {},
    }

    for sid, sdata in project.get("sections", {}).items():
        section_info = {**sdata}
        if section_info.get("image_path"):
            # Convert to relative URL
            section_info["image_url"] = "/static/generated/" + os.path.basename(section_info["image_path"])
        result["sections"][sid] = section_info

    # Product image URL
    if project.get("image_path"):
        result["product_image_url"] = "/static/uploads/" + os.path.basename(project["image_path"])

    return jsonify(result)


# ── Analysis Pipeline ────────────────────────────────────────────

@api.route("/projects/<project_id>/analyze", methods=["POST"])
def analyze_product(project_id):
    """Run product image analysis."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        analysis = pipeline.run_analysis(project_id)
        return jsonify({"status": "success", "analysis": analysis})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/search-competitors", methods=["POST"])
def search_competitors(project_id):
    """Search for competitor products."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        data = pipeline.run_competitor_search(project_id)
        return jsonify({"status": "success", "competitor_data": data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Section Generation ───────────────────────────────────────────

@api.route("/projects/<project_id>/sections/<section_id>/generate", methods=["POST"])
def generate_section(project_id, section_id):
    """Generate content for a specific section."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(silent=True) or {}
    custom_instructions = body.get("custom_instructions", "")

    try:
        content = pipeline.generate_section(project_id, section_id, custom_instructions)
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/sections/<section_id>/generate-image", methods=["POST"])
def generate_section_image(project_id, section_id):
    """Generate image for a specific section."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    try:
        image_path = pipeline.generate_section_image(project_id, section_id)
        if image_path:
            image_url = "/static/generated/" + os.path.basename(image_path)
            return jsonify({"status": "success", "image_url": image_url})
        else:
            return jsonify({"status": "warning", "message": "이미지 생성 실패. 텍스트 콘텐츠만 사용됩니다."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/projects/<project_id>/generate-all", methods=["POST"])
def generate_all_sections(project_id):
    """Start generating all 15 sections (runs in background)."""
    project = pipeline.get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    body = request.get_json(silent=True) or {}
    section_instructions = body.get("section_instructions", {})

    def run_generation():
        try:
            pipeline.generate_all_sections(project_id, section_instructions)
        except Exception as e:
            project["status"] = "error"
            project["progress_message"] = str(e)

    thread = threading.Thread(target=run_generation, daemon=True)
    thread.start()

    return jsonify({
        "status": "started",
        "message": "전체 섹션 생성이 시작되었습니다. 진행 상황을 확인하세요.",
    })


# ── Section Definitions ──────────────────────────────────────────

@api.route("/sections", methods=["GET"])
def list_sections():
    """Get all 15 section definitions."""
    return jsonify(get_all_sections())


@api.route("/provider", methods=["GET"])
def provider_status():
    """Return active Gemini transport route for billing-path verification."""
    use_vertex = getattr(pipeline.gemini, "use_vertex", False)
    vcfg = _load_vertex_config()
    return jsonify({
        "gemini_route": "vertex_ai" if use_vertex else "gemini_developer_api",
        "google_cloud_project": vcfg['project'] if use_vertex else None,
        "google_cloud_location": vcfg['location'] if use_vertex else None,
    })


@api.route("/vertex-config", methods=["GET"])
def get_vertex_config():
    """Vertex AI 설정 조회 (프로젝트 ID + 리전)."""
    data = _load_vertex_config()
    data.update(_get_vertex_auth_info())
    data["geminiRoute"] = "vertex_ai" if Config.GENAI_USE_VERTEXAI or data.get("project") else "gemini_developer_api"
    data["backendGeminiApiKey"] = bool(Config.GEMINI_API_KEY)
    data["backendGeminiApiKeyHint"] = _mask_secret(Config.GEMINI_API_KEY)
    return jsonify(data)


@api.route("/vertex-config", methods=["POST"])
def update_vertex_config():
    """Vertex AI 설정 저장 — 재시작 없이 즉시 반영."""
    body = request.get_json(silent=True) or {}
    project = str(body.get('project') or '').strip()
    location = str(body.get('location') or '').strip() or 'us-central1'
    if not project:
        return jsonify({"error": "project is required"}), 400
    _save_vertex_config(project, location)
    return jsonify({"ok": True, "project": project, "location": location})


def _jepum_detail_folders():
    if not os.path.isdir(_JEPUM_DETAIL_ROOT):
        return []
    folders = []
    for name in os.listdir(_JEPUM_DETAIL_ROOT):
        path = os.path.join(_JEPUM_DETAIL_ROOT, name)
        if not os.path.isdir(path):
            continue
        image_count = 0
        newest_file_mtime = 0
        for root, _, files in os.walk(path):
            for file_name in files:
                ext = os.path.splitext(file_name)[1].lower()
                if ext not in _JEPUM_IMAGE_EXTS:
                    continue
                image_count += 1
                try:
                    newest_file_mtime = max(newest_file_mtime, os.path.getmtime(os.path.join(root, file_name)))
                except OSError:
                    pass
        if image_count:
            try:
                folder_mtime = os.path.getmtime(path)
            except OSError:
                folder_mtime = 0
            folders.append((max(folder_mtime, newest_file_mtime), path, image_count))
    folders.sort(key=lambda item: item[0], reverse=True)
    return folders


def _jepum_image_files(folder):
    files = []
    for root, _, file_names in os.walk(folder):
        for file_name in file_names:
            ext = os.path.splitext(file_name)[1].lower()
            if ext not in _JEPUM_IMAGE_EXTS:
                continue
            path = os.path.join(root, file_name)
            try:
                files.append((os.path.getmtime(path), path, file_name))
            except OSError:
                pass
    files.sort(key=lambda item: item[0], reverse=True)
    return files


@api.route("/jepum-scraper/latest-detail-images", methods=["GET"])
def jepum_scraper_latest_detail_images():
    """Return representative images from recent JepumScraper detail page folders."""
    folders = _jepum_detail_folders()
    if not folders:
        return jsonify({
            "ok": False,
            "error": "JepumScraper 상세페이지 이미지 폴더를 찾지 못했습니다.",
            "root": _JEPUM_DETAIL_ROOT,
        }), 404

    try:
        limit = max(1, min(int(request.args.get("limit", "5")), 10))
    except Exception:
        limit = 5

    images = []
    used_folders = []
    for _, folder, image_count in folders[:limit]:
        files = _jepum_image_files(folder)
        if not files:
            continue
        _, path, file_name = files[0]
        mime = mimetypes.guess_type(path)[0] or "image/jpeg"
        try:
            with open(path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("ascii")
            stat = os.stat(path)
        except OSError:
            continue
        folder_name = os.path.basename(folder)
        used_folders.append({
            "folder": folder,
            "folderName": folder_name,
            "imageCount": image_count,
        })
        images.append({
            "name": file_name,
            "base64": encoded,
            "mime": mime,
            "size": stat.st_size,
            "lastModified": int(stat.st_mtime * 1000),
            "sourcePath": path,
            "folder": folder,
            "folderName": folder_name,
        })

    return jsonify({
        "ok": True,
        "root": _JEPUM_DETAIL_ROOT,
        "folders": used_folders,
        "count": len(images),
        "images": images,
    })


def _safe_jepum_detail_image_path(raw_path: str):
    text = str(raw_path or "").strip()
    if not text:
        return None, "path가 필요합니다."
    path = os.path.abspath(text)
    root = os.path.abspath(_JEPUM_DETAIL_ROOT)
    try:
        if os.path.commonpath([os.path.normcase(root), os.path.normcase(path)]) != os.path.normcase(root):
            return None, "JepumScraper 상세페이지 이미지 폴더 밖의 파일은 읽을 수 없습니다."
    except ValueError:
        return None, "허용되지 않은 이미지 경로입니다."
    ext = os.path.splitext(path)[1].lower()
    if ext not in _JEPUM_IMAGE_EXTS:
        return None, "이미지 파일만 읽을 수 있습니다."
    if not os.path.isfile(path):
        return None, "이미지 파일을 찾지 못했습니다."
    return path, ""


@api.route("/jepum-scraper/detail-image-base64", methods=["GET", "POST"])
def jepum_scraper_detail_image_base64():
    body = request.get_json(silent=True) or {}
    raw_path = body.get("path") or request.args.get("path") or ""
    path, error = _safe_jepum_detail_image_path(raw_path)
    if error:
        return jsonify({"ok": False, "error": error}), 400
    try:
        stat = os.stat(path)
        if stat.st_size > 12 * 1024 * 1024:
            return jsonify({"ok": False, "error": "이미지가 12MB를 초과합니다."}), 413
        with open(path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("ascii")
    except OSError as e:
        return jsonify({"ok": False, "error": f"이미지 읽기 실패: {e}"}), 500
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    return jsonify({
        "ok": True,
        "name": os.path.basename(path),
        "base64": encoded,
        "mime": mime,
        "bytes": stat.st_size,
        "sourcePath": path,
    })


@api.route("/sinhwa-db/status", methods=["GET"])
def sinhwa_db_status():
    """Return the local Sinhwa DB Hub status for the factory DB candidate UX."""
    return jsonify(_sinhwa_db_status_payload())


@api.route("/cafe24-control/status", methods=["GET"])
def cafe24_control_status():
    return jsonify(_cafe24_control_status_payload())


@api.route("/cafe24-control/start", methods=["POST"])
def cafe24_control_start():
    if not _local_action_request_allowed():
        return jsonify({
            "ok": False,
            "error": "로컬 앱에서 시작 요청을 보내야 합니다.",
        }), 403
    with _CAFE24_CONTROL_START_LOCK:
        status = _cafe24_control_status_payload()
        if status["running"]:
            return jsonify({
                **status,
                "message": "Cafe24 Control Tower가 이미 실행 중입니다. API Hub 후보 수집을 다시 시작합니다.",
            })
        if not _CAFE24_CONTROL_SCRIPT.is_file():
            return jsonify({
                **status,
                "ok": False,
                "error": "Cafe24 Control Tower 실행 스크립트를 찾지 못했습니다.",
                "message": "Cafe24 Control Tower 실행 스크립트를 찾지 못했습니다.",
            }), 404
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            subprocess.Popen(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(_CAFE24_CONTROL_SCRIPT),
                ],
                cwd=str(_CAFE24_CONTROL_ROOT),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
            )
        except OSError as exc:
            return jsonify({
                **status,
                "ok": False,
                "error": f"Cafe24 Control Tower 실행 실패: {exc}",
                "message": f"Cafe24 Control Tower 실행 실패: {exc}",
            }), 500

        deadline = time.time() + 45
        while time.time() < deadline:
            time.sleep(1)
            next_status = _cafe24_control_status_payload()
            if next_status["running"]:
                return jsonify({
                    **next_status,
                    "message": "Cafe24 Control Tower 실행을 확인했습니다. API Hub 후보 수집을 다시 시작합니다.",
                })

        final_status = _cafe24_control_status_payload()
        return jsonify({
            **final_status,
            "ok": False,
            "message": "Cafe24 Control Tower 실행 명령은 보냈지만 45초 안에 API 연결을 확인하지 못했습니다. 잠시 뒤 다시 확인해주세요.",
        }), 504


@api.route("/jepum-scraper/status", methods=["GET"])
def jepum_scraper_status():
    return jsonify(_jepum_scraper_status_payload())


@api.route("/jepum-scraper/start", methods=["POST"])
def jepum_scraper_start():
    with _JEPUM_START_LOCK:
        status = _jepum_scraper_status_payload()
        if status["running"]:
            return jsonify({
                **status,
                "message": "JepumScraper가 이미 실행 중입니다. VM 후보 수집을 계속합니다.",
            })
        python_path = _jepum_scraper_python_executable()
        if not _JEPUM_MAIN.is_file() or not python_path:
            return jsonify({
                **status,
                "ok": False,
                "error": "JepumScraper 실행 파일 또는 Python을 찾지 못했습니다.",
                "message": "JepumScraper 실행 파일 또는 Python을 찾지 못했습니다.",
            }), 404

        local_dir = Path(os.path.dirname(_LAST_WORK_PATH))
        local_dir.mkdir(parents=True, exist_ok=True)
        out_path = local_dir / "jepum-scraper-start.out.log"
        err_path = local_dir / "jepum-scraper-start.err.log"
        creationflags = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
        try:
            with open(out_path, "ab") as stdout, open(err_path, "ab") as stderr:
                subprocess.Popen(
                    [str(python_path), str(_JEPUM_MAIN)],
                    cwd=str(_JEPUM_ROOT),
                    stdout=stdout,
                    stderr=stderr,
                    creationflags=creationflags,
                )
        except OSError as exc:
            return jsonify({
                **status,
                "ok": False,
                "error": f"JepumScraper 실행 실패: {exc}",
                "message": f"JepumScraper 실행 실패: {exc}",
                "logPath": str(out_path),
                "errorLogPath": str(err_path),
            }), 500

        deadline = time.time() + 45
        while time.time() < deadline:
            time.sleep(1)
            next_status = _jepum_scraper_status_payload()
            if next_status["running"]:
                return jsonify({
                    **next_status,
                    "message": "JepumScraper 실행을 확인했습니다. VM 후보 수집을 계속합니다.",
                    "logPath": str(out_path),
                    "errorLogPath": str(err_path),
                })

        final_status = _jepum_scraper_status_payload()
        return jsonify({
            **final_status,
            "ok": False,
            "error": "JepumScraper가 45초 안에 준비되지 않았습니다.",
            "message": "JepumScraper가 45초 안에 준비되지 않았습니다.",
            "logPath": str(out_path),
            "errorLogPath": str(err_path),
        }), 504


@api.route("/sinhwa-db/start", methods=["POST"])
def sinhwa_db_start():
    """Start only the fixed local Sinhwa DB Hub program, then poll until ready."""
    if not _local_action_request_allowed():
        return jsonify({
            "ok": False,
            "error": "로컬 앱에서 시작 요청을 보내야 합니다.",
        }), 403
    status = _sinhwa_db_status_payload()
    if status["running"]:
        return jsonify({
            **status,
            "message": "신화사DB 프로그램이 이미 실행 중입니다. 후보 수집을 다시 시도할 수 있습니다.",
        })
    if not _SINHWA_DB_SCRIPT.is_file():
        return jsonify({
            **status,
            "ok": False,
            "error": "신화사DB 실행 스크립트를 찾지 못했습니다.",
            "message": "신화사DB 실행 스크립트를 찾지 못했습니다.",
        }), 404

    local_dir = Path(os.path.dirname(_LAST_WORK_PATH))
    local_dir.mkdir(parents=True, exist_ok=True)
    out_path = local_dir / "sinhwa-db-start.out.log"
    err_path = local_dir / "sinhwa-db-start.err.log"
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        with open(out_path, "ab") as stdout, open(err_path, "ab") as stderr:
            subprocess.Popen(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(_SINHWA_DB_SCRIPT),
                    "-Action",
                    "Start",
                ],
                cwd=str(_SINHWA_DB_ROOT),
                stdout=stdout,
                stderr=stderr,
                creationflags=creationflags,
            )
    except OSError as exc:
        return jsonify({
            **status,
            "ok": False,
            "error": f"신화사DB 실행 실패: {exc}",
            "message": f"신화사DB 실행 실패: {exc}",
            "logPath": str(out_path),
            "errorLogPath": str(err_path),
        }), 500

    deadline = time.time() + 45
    while time.time() < deadline:
        time.sleep(1)
        next_status = _sinhwa_db_status_payload()
        if next_status["running"]:
            return jsonify({
                **next_status,
                "message": "신화사DB 프로그램 실행을 확인했습니다. 후보 수집을 다시 시작합니다.",
                "logPath": str(out_path),
                "errorLogPath": str(err_path),
            })

    final_status = _sinhwa_db_status_payload()
    return jsonify({
        **final_status,
        "ok": False,
        "message": "신화사DB 실행 명령은 보냈지만 45초 안에 연결 확인이 끝나지 않았습니다. 잠시 뒤 다시 확인하거나 신화사DB 창을 확인해주세요.",
        "logPath": str(out_path),
        "errorLogPath": str(err_path),
    })


@api.route("/jepum-scraper/open-detail-folder", methods=["POST", "GET"])
def jepum_scraper_open_detail_folder():
    """Open the JepumScraper detail page image root folder in Windows Explorer."""
    if not os.path.isdir(_JEPUM_DETAIL_ROOT):
        return jsonify({
            "ok": False,
            "error": "JepumScraper 상세페이지 이미지 폴더를 찾지 못했습니다.",
            "root": _JEPUM_DETAIL_ROOT,
        }), 404
    try:
        subprocess.Popen(["explorer", _JEPUM_DETAIL_ROOT])
    except Exception as e:
        return jsonify({
            "ok": False,
            "error": f"폴더 열기 실패: {e}",
            "root": _JEPUM_DETAIL_ROOT,
        }), 500
    return jsonify({
        "ok": True,
        "root": _JEPUM_DETAIL_ROOT,
        "folder": _JEPUM_DETAIL_ROOT,
    })


@api.route("/image-proxy", methods=["GET"])
def image_proxy():
    """Fetch a known Cafe24 product image and return it as a data URL for local LLM image matching."""
    raw_url = str(request.args.get("url") or "").strip()
    if not raw_url:
        return jsonify({"ok": False, "error": "url 파라미터가 필요합니다."}), 400
    current_url = raw_url
    max_bytes = 8 * 1024 * 1024
    try:
        for _ in range(4):
            parsed = urlparse(current_url)
            if parsed.scheme not in {"http", "https"} or parsed.hostname not in _IMAGE_PROXY_ALLOWED_HOSTS:
                return jsonify({"ok": False, "error": "허용되지 않은 이미지 호스트입니다."}), 400
            resp = requests.get(
                current_url,
                headers={"Accept": "image/*,*/*", "User-Agent": "kuasangse-local-image-proxy/1.0"},
                timeout=15,
                stream=True,
                allow_redirects=False,
            )
            if 300 <= resp.status_code < 400:
                location = resp.headers.get("location")
                resp.close()
                if not location:
                    return jsonify({"ok": False, "error": "이미지 redirect 위치가 없습니다."}), 502
                current_url = urljoin(current_url, location)
                continue
            resp.raise_for_status()
            break
        else:
            return jsonify({"ok": False, "error": "이미지 redirect가 너무 많습니다."}), 502
    except Exception as e:
        return jsonify({"ok": False, "error": f"이미지 요청 실패: {e}"}), 502
    content_type = (resp.headers.get("content-type") or mimetypes.guess_type(parsed.path)[0] or "image/jpeg").split(";")[0].strip()
    if not content_type.startswith("image/"):
        return jsonify({"ok": False, "error": f"이미지가 아닌 응답입니다: {content_type}"}), 400
    content_length = int(resp.headers.get("content-length") or 0)
    if content_length > max_bytes:
        resp.close()
        return jsonify({"ok": False, "error": "이미지가 8MB를 초과합니다."}), 413
    chunks = []
    total_bytes = 0
    try:
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                resp.close()
                return jsonify({"ok": False, "error": "이미지가 8MB를 초과합니다."}), 413
            chunks.append(chunk)
    finally:
        resp.close()
    content = b"".join(chunks)
    if request.args.get("raw") == "1":
        return Response(content, mimetype=content_type, headers={"Cache-Control": "private, max-age=300"})
    encoded = base64.b64encode(content).decode("ascii")
    return jsonify({
        "ok": True,
        "mimeType": content_type,
        "bytes": len(content),
        "dataUrl": f"data:{content_type};base64,{encoded}",
    })


@api.route("/gemini/generate-content", methods=["POST"])
def gemini_generate_content_proxy():
    """
    Proxy Gemini generateContent calls to Vertex AI.
    Accepts a Gemini-style request body from browser and routes it to Vertex.
    """
    vcfg = _load_vertex_config()
    if not vcfg['project']:
        return jsonify({"error": {"message": "GOOGLE_CLOUD_PROJECT is not configured"}}), 500

    body = request.get_json(silent=True) or {}
    model = body.get("model", "").strip()
    if not model:
        return jsonify({"error": {"message": "Request must include model"}}), 400
    payload = dict(body)
    payload.pop("model", None)
    payload = _normalize_vertex_payload(payload)

    try:
        access_token = _get_adc_access_token()
    except Exception as e:
        return jsonify({"error": {"message": f"Vertex auth failed: {str(e)}"}}), 500

    image_request = _vertex_payload_requests_image(payload)
    model_candidates = _vertex_image_model_candidates(model) if image_request else [model]
    attempts = []
    last_status = 502
    last_data = None
    last_text = ""

    for candidate_model in model_candidates:
        locations = _vertex_locations_for_model(candidate_model, vcfg['location']) if image_request else [vcfg['location']]
        for location in locations:
            vertex_url = (
                f"https://aiplatform.googleapis.com/v1/projects/{vcfg['project']}"
                f"/locations/{location}/publishers/google/models/{candidate_model}:generateContent"
            )
            attempt = {"model": candidate_model, "location": location}
            try:
                resp = requests.post(
                    vertex_url,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=180,
                )
            except Exception as e:
                last_status = 502
                last_text = str(e)
                attempt.update({"status": 502, "message": last_text[:500]})
                attempts.append(attempt)
                continue

            last_status = resp.status_code
            try:
                data = resp.json()
            except Exception:
                data = {"error": {"message": resp.text or "Unexpected Vertex response"}}
            last_data = data
            last_text = resp.text or ""
            attempt.update({
                "status": resp.status_code,
                "message": _vertex_error_text(data, last_text)[:500] if resp.status_code >= 400 else "ok",
            })
            attempts.append(attempt)

            if resp.status_code < 400 and not data.get("error"):
                if isinstance(data, dict):
                    data["_proxyRoute"] = {
                        "requestedModel": model,
                        "model": candidate_model,
                        "location": location,
                        "fallback": candidate_model != model,
                        "attempts": attempts,
                    }
                return jsonify(data), resp.status_code

            if not image_request or not _vertex_error_retryable(resp.status_code, data, last_text):
                return jsonify(data), resp.status_code

    message = _vertex_error_text(last_data, last_text) or "Vertex image request failed"
    return jsonify({
        "error": {
            "message": f"Vertex 이미지 생성 재시도 실패: {message}",
            "attempts": attempts,
        }
    }), last_status


# ── Export ───────────────────────────────────────────────────────

@api.route("/projects/<project_id>/export", methods=["GET"])
def export_project(project_id):
    """Export project data for HTML generation."""
    export_data = pipeline.export_project(project_id)
    if not export_data:
        return jsonify({"error": "Project not found"}), 404

    # Convert image paths to URLs
    for section in export_data["sections"]:
        if section.get("image_path"):
            section["image_url"] = "/static/generated/" + os.path.basename(section["image_path"])

    return jsonify(export_data)


@api.route("/projects/<project_id>/export-html", methods=["GET"])
def export_html(project_id):
    """Generate and return a standalone HTML detail page."""
    export_data = pipeline.export_project(project_id)
    if not export_data:
        return jsonify({"error": "Project not found"}), 404

    html = generate_detail_page_html(export_data)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


def generate_detail_page_html(data: dict) -> str:
    """Generate a full HTML detail page from project data."""
    product = data.get("product_analysis", {})
    sections_html = ""

    for section in data.get("sections", []):
        content = section.get("content", {})
        if not content:
            continue

        color_scheme = content.get("color_scheme", {})
        bg = color_scheme.get("background", "#FFFFFF")
        text_primary = color_scheme.get("text_primary", "#333333")
        text_secondary = color_scheme.get("text_secondary", "#666666")
        accent = color_scheme.get("accent", "#FF6B35")

        font = content.get("font_suggestion", {})
        headline_size = font.get("headline_size", "36px")
        body_size = font.get("body_size", "16px")

        image_tag = ""
        if section.get("image_url"):
            image_tag = f'<img src="{section["image_url"]}" alt="{section["section_name"]}" style="max-width:100%;border-radius:12px;margin:20px 0;">'

        sections_html += f"""
    <section style="background:{bg};padding:60px 20px;text-align:center;">
      <div style="max-width:860px;margin:0 auto;">
        <h2 style="font-size:{headline_size};color:{text_primary};margin-bottom:12px;font-weight:700;">
          {content.get('headline', '')}
        </h2>
        <h3 style="font-size:20px;color:{text_secondary};margin-bottom:24px;font-weight:400;">
          {content.get('subheadline', '')}
        </h3>
        {image_tag}
        <p style="font-size:{body_size};color:{text_secondary};line-height:1.8;max-width:680px;margin:0 auto;">
          {content.get('body_text', '')}
        </p>
        {"<a href='#' style='display:inline-block;margin-top:24px;padding:14px 40px;background:" + accent + ";color:#fff;border-radius:8px;text-decoration:none;font-size:18px;font-weight:600;'>" + content.get('cta_text', '') + "</a>" if content.get('cta_text') else ""}
      </div>
    </section>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{product.get('product_name', '상세페이지')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Noto Sans KR', sans-serif; color: #333; }}
        img {{ max-width: 100%; height: auto; }}
        section {{ width: 100%; }}
    </style>
</head>
<body>
    {sections_html}
</body>
</html>"""
    return html
