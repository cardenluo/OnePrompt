from __future__ import annotations
import io
import json
import os
import time
import wave
import hashlib
import zipfile
import numpy as np
import torch
from PIL import Image, ImageSequence
from PIL.PngImagePlugin import PngInfo
import folder_paths
import node_helpers
from comfy.cli_args import args
from comfy_api.input_impl import VideoFromFile




class AnyType(str):
    def __eq__(self, _) -> bool:
        return True
    def __ne__(self, __value: object) -> bool:
        return False
ANY_TYPE = AnyType("*")
any_type = AnyType("*")



try:
    import soundfile as _sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    _sf = None
    SOUNDFILE_AVAILABLE = False






#region---------------zip---------------------------


_ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"}
_ALLOWED_VIDEO_EXTS = {"mp4", "webm", "mkv", "avi", "mov", "m4v", "gif"}
_ALLOWED_AUDIO_EXTS = {"wav", "mp3", "flac", "ogg", "m4a", "aac"}
_ALLOWED_TEXT_EXTS = {"txt", "srt", "vtt", "csv", "md", "log"}
_ALLOWED_WORKFLOW_EXTS = {"json"}
NAME_INTO = "LIST"

_IMAGE_NAME_QUEUE_BY_SIG: dict[tuple, list[str]] = {}

def _safe_basename(name: str) -> str:
    name = name.replace("\\", "/")
    return os.path.basename(name)

def _safe_zip_member_relpath(name: str) -> str:
    name = (name or "").replace("\\", "/")
    drive, _ = os.path.splitdrive(name)
    if drive or name.startswith("/") or os.path.isabs(name):
        raise RuntimeError("非法路径")
    norm = os.path.normpath(name).replace("\\", "/")
    if norm.startswith("..") or norm.startswith("../"):
        raise RuntimeError("非法路径")
    if norm == ".":
        raise RuntimeError("非法路径")
    return norm

def _wav_bytes_to_audio(raw: bytes) -> dict:
    try:
        wf = wave.open(io.BytesIO(raw), "rb")
    except Exception as e:
        raise RuntimeError(f"无法读取 WAV: {e}")
    with wf:
        channels = int(wf.getnchannels())
        sample_rate = int(wf.getframerate())
        sampwidth = int(wf.getsampwidth())
        frames = int(wf.getnframes())
        pcm = wf.readframes(frames)
    if channels <= 0 or sample_rate <= 0 or frames <= 0:
        raise RuntimeError("无效 WAV")
    if sampwidth == 1:
        a = np.frombuffer(pcm, dtype=np.uint8).astype(np.float32)
        a = (a - 128.0) / 128.0
    elif sampwidth == 2:
        a = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 3:
        b = np.frombuffer(pcm, dtype=np.uint8)
        if b.size % 3 != 0:
            raise RuntimeError("无效 WAV PCM")
        b = b.reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        sign = (v & 0x800000) != 0
        v = v - (sign.astype(np.int32) << 24)
        a = v.astype(np.float32) / 8388608.0
    elif sampwidth == 4:
        a = np.frombuffer(pcm, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"不支持的 WAV 位深: {sampwidth * 8}bit")
    total_samples = a.size
    if total_samples % channels != 0:
        raise RuntimeError("无效 WAV 通道数据")
    a = a.reshape(-1, channels).T
    a = np.clip(a, -1.0, 1.0)
    waveform = torch.from_numpy(a).float().unsqueeze(0)
    return {"waveform": waveform, "sample_rate": sample_rate}


class file_AnyFileToZip:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self._run_key = None
        self._zip_info = None
        self._written_any = 0
        self._written_images = 0
        self._written_videos = 0
        self._written_audios = 0
        self._written_texts = 0
        self._written_workflows = 0
        self._written_files = 0
        self._seen_images = set()
        self._seen_files = set()
        self._seen_arcnames = set()
        self._ui_emitted = False
        self._last_call_ts = 0.0
    @classmethod
    def INPUT_TYPES(s):
        return {"optional": {"AnyFile_zip": (ANY_TYPE,),
                             "file_info": (NAME_INTO,)},
                               "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"}}
    @classmethod
    def VALIDATE_INPUTS(s, input_types=None, **kwargs):
        return True
    RETURN_TYPES = ()
    FUNCTION = "save_zip"
    OUTPUT_NODE = True
    CATEGORY = "OnePrompt"
    def _resolve_annotated_file(self, name: str) -> tuple[str, str]:
        name = (name or "").strip()
        if not name:
            raise RuntimeError("非法路径")
        raw_name, base_dir = folder_paths.annotated_filepath(name)
        if base_dir is None:
            base_dir = folder_paths.get_input_directory()
        base_dir = os.path.abspath(base_dir)
        raw_name = raw_name.replace("\\", "/")
        drive, _ = os.path.splitdrive(raw_name)
        if drive or os.path.isabs(raw_name) or raw_name.startswith("/"):
            raise RuntimeError("非法路径")
        norm = os.path.normpath(raw_name)
        if norm.startswith("..") or norm.startswith("../") or norm.startswith("..\\"):
            raise RuntimeError("非法路径")
        full = os.path.abspath(os.path.join(base_dir, norm))
        if os.path.commonpath((base_dir, full)) != base_dir:
            raise RuntimeError("非法路径")
        return norm.replace("\\", "/"), full
    def _audio_to_wav_bytes(self, audio) -> bytes:
        if isinstance(audio, dict):
            waveform = audio.get("waveform", None)
            sample_rate = audio.get("sample_rate", None)
        else:
            waveform = getattr(audio, "waveform", None)
            sample_rate = getattr(audio, "sample_rate", None)
        if waveform is None or sample_rate is None:
            raise RuntimeError("无效音频输入")
        if isinstance(waveform, torch.Tensor):
            w = waveform.detach().to(device="cpu")
        else:
            w = torch.as_tensor(waveform, device="cpu")
        if w.ndim == 3:
            w = w[0]
        if w.ndim == 1:
            w = w.unsqueeze(0)
        if w.ndim != 2:
            raise RuntimeError("无效音频波形维度")
        w = torch.clamp(w, -1.0, 1.0)
        w_i16 = (w * 32767.0).to(dtype=torch.int16)
        pcm = w_i16.t().contiguous().numpy().tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(int(w_i16.shape[0]))
            wf.setsampwidth(2)
            wf.setframerate(int(sample_rate))
            wf.writeframes(pcm)
        return buf.getvalue()
    def save_zip(self, AnyFile_zip=None, images=None, file_info=None, prompt=None, extra_pnginfo=None, **kwargs):
        filename_prefix = "ComfyUI_ZIP"
        if AnyFile_zip is None and images is not None:
            AnyFile_zip = images
        elif AnyFile_zip is not None and images is not None:
            AnyFile_zip = [AnyFile_zip, images]
        if AnyFile_zip is None:
            return {"ui": {"images": []}}
        def _as_list(v):
            if v is None:
                return []
            if isinstance(v, (list, tuple)):
                return list(v)
            return [v]
        def _parse_naming(v):
            if v is None:
                return None
            if isinstance(v, dict):
                # 兼容旧格式（按类型分类）和新格式（按扩展名分类）
                # 新格式：键为不带点的扩展名（如 "png", "jpg"）
                # 旧格式：键为类型名（如 "images", "videos", "workflows"）
                # 检查是否是新格式（键为不带点的扩展名）
                keys = [k for k in v.keys() if k]
                has_ext_keys = any(k and not k.startswith('.') and k.lower() in {"png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "mp4", "webm", "mkv", "avi", "mov", "m4v", "gif", "wav", "mp3", "flac", "ogg", "m4a", "aac", "txt", "json", "srt", "vtt", "csv", "md", "log"} for k in keys)

                if has_ext_keys:
                    # 新格式：按扩展名作为键（不带点）
                    # 需要将扩展名映射到类型
                    type_to_exts = {
                        "images": _ALLOWED_IMAGE_EXTS,
                        "videos": _ALLOWED_VIDEO_EXTS,
                        "audios": _ALLOWED_AUDIO_EXTS,
                        "texts": _ALLOWED_TEXT_EXTS,
                        "workflows": _ALLOWED_WORKFLOW_EXTS
                    }

                    # 按类型收集文件名
                    result = {}
                    for type_key, exts in type_to_exts.items():
                        files = []
                        for ext in exts:
                            if ext in v:
                                ext_files = v[ext]
                                if isinstance(ext_files, list):
                                    files.extend([str(f) for f in ext_files if str(f).strip() != ""])
                                elif ext_files is not None:
                                    files.append(str(ext_files))
                        result[type_key] = files
                    return result
                else:
                    # 旧格式：按类型分类
                    result = {}
                    for type_key in ["images", "videos", "audios", "texts", "workflows"]:
                        files = _as_list(v.get(type_key, None) or
                                      v.get({"图像": "images", "视频": "videos", "音频": "audios", "文本": "texts"}.get(type_key, type_key), None) or
                                      v.get({"images": "image_names", "videos": "video_names", "audios": "audio_names", "texts": "text_names"}.get(type_key), None) or
                                      v.get({"图像": "图像文件名", "视频": "视频文件名", "音频": "音频文件名", "文本": "文本文件名"}.get(type_key), None))
                        result[type_key] = [str(f) for f in files if str(f).strip() != ""]
                    return result
            return None
        try:
            marker_obj = {"prompt": prompt or {}, "extra_pnginfo": extra_pnginfo or {}}
            marker_json = json.dumps(marker_obj, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except Exception:
            marker_json = b""
        run_key = hashlib.sha256(marker_json).hexdigest()[:16]
        now = time.time()
        if run_key != self._run_key or (now - self._last_call_ts) > 60.0:
            self._run_key = run_key
            self._zip_info = None
            self._written_any = 0
            self._written_images = 0
            self._written_videos = 0
            self._written_audios = 0
            self._written_texts = 0
            self._written_workflows = 0
            self._written_files = 0
            self._seen_images = set()
            self._seen_files = set()
            self._seen_arcnames = set()
            self._name_queue_images = []
            self._name_queue_videos = []
            self._name_queue_audios = []
            self._name_queue_texts = []
            self._name_queue_workflows = []
            self._ui_emitted = False
        self._last_call_ts = now
        if not hasattr(self, "_name_ctx_set") or self._name_ctx_set != run_key:
            naming = _parse_naming(file_info)
            if naming is not None:
                self._name_queue_images = [str(x) for x in naming.get("images", []) if str(x).strip() != ""]
                self._name_queue_videos = [str(x) for x in naming.get("videos", []) if str(x).strip() != ""]
                self._name_queue_audios = [str(x) for x in naming.get("audios", []) if str(x).strip() != ""]
                self._name_queue_texts = [str(x) for x in naming.get("texts", []) if str(x).strip() != ""]
                self._name_queue_workflows = [str(x) for x in naming.get("workflows", []) if str(x).strip() != ""]
            self._name_ctx_set = run_key
        if self._zip_info is None:
            def _peek_dimensions(v):
                if v is None:
                    return 0, 0
                if isinstance(v, torch.Tensor):
                    if v.ndim >= 4:
                        return int(v.shape[2]), int(v.shape[1])
                    return 0, 0
                if isinstance(v, (list, tuple)):
                    for x in v:
                        w, h = _peek_dimensions(x)
                        if w or h:
                            return w, h
                    return 0, 0
                if hasattr(v, "get_dimensions"):
                    try:
                        w, h = v.get_dimensions()
                        return int(w), int(h)
                    except Exception:
                        return 0, 0
                return 0, 0
            width, height = _peek_dimensions(AnyFile_zip)
            full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, self.output_dir, width, height)
            zip_filename = f"{filename}_{counter:05}_.zip"
            zip_path = os.path.join(full_output_folder, zip_filename)
            self._zip_info = (zip_filename, zip_path, subfolder)
        else:
            zip_filename, zip_path, subfolder = self._zip_info
        metadata = None
        if not args.disable_metadata:
            metadata = PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for x in extra_pnginfo:
                    metadata.add_text(x, json.dumps(extra_pnginfo[x]))
        zip_mode = "w" if self._written_any == 0 else "a"
        video_metadata = None
        if not args.disable_metadata:
            vm = {}
            if extra_pnginfo is not None:
                vm.update(extra_pnginfo)
            if prompt is not None:
                vm["prompt"] = prompt
            if len(vm) > 0:
                video_metadata = vm
        with zipfile.ZipFile(zip_path, zip_mode, compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            def _resolve_file_ref(obj: dict) -> tuple[str, str] | None:
                filename = obj.get("filename", None)
                if filename is None:
                    filename = obj.get("name", None)
                if not filename:
                    return None
                subfolder = obj.get("subfolder", "") or ""
                t = obj.get("type", None) or "input"
                base_dir = folder_paths.get_directory_by_type(str(t))
                if base_dir is None:
                    return None
                base_dir = os.path.abspath(base_dir)
                rel = os.path.normpath(os.path.join(subfolder, str(filename))).replace("\\", "/")
                drive, _ = os.path.splitdrive(rel)
                if drive or os.path.isabs(rel) or rel.startswith("/") or rel.startswith("../") or rel.startswith("..\\") or rel.startswith(".."):
                    return None
                full = os.path.abspath(os.path.join(base_dir, rel))
                if os.path.commonpath((base_dir, full)) != base_dir:
                    return None
                return rel.replace("\\", "/"), full
            def _write_image_tensor(img_tensor: torch.Tensor):
                t = img_tensor
                if t.ndim == 4:
                    batch = [t[i : i + 1] for i in range(t.shape[0])]
                else:
                    batch = [t]
                for one in batch:
                    i = 255.0 * one[0].detach().to(device="cpu").numpy()
                    arr = np.clip(i, 0, 255).astype(np.uint8)
                    sig = (arr.shape, hashlib.sha1(arr.tobytes()).digest())
                    orig_name = None
                    if hasattr(self, "_name_queue_images") and len(self._name_queue_images) > 0:
                        orig_name = self._name_queue_images.pop(0)
                    if orig_name is None:
                        orig_queue = _IMAGE_NAME_QUEUE_BY_SIG.get(sig, None)
                        if orig_queue is not None and len(orig_queue) > 0:
                            orig_name = orig_queue.pop(0)
                    if orig_name is None:
                        if sig in self._seen_images:
                            continue
                        self._seen_images.add(sig)
                    img = Image.fromarray(arr)
                    buf = io.BytesIO()
                    arcname = None
                    if orig_name:
                        try:
                            arcname = _safe_zip_member_relpath(str(orig_name).replace("\\", "/"))
                        except Exception:
                            arcname = _safe_basename(str(orig_name))
                    if not arcname:
                        arcname = f"{filename_prefix}_{self._written_images:05}.png"
                    base, ext = os.path.splitext(arcname)
                    ext_l = ext.lower()
                    if ext_l in (".jpg", ".jpeg"):
                        img.save(buf, format="JPEG", quality=95, subsampling=0)
                    elif ext_l == ".webp":
                        img.save(buf, format="WEBP", quality=95, method=4)
                    elif ext_l in (".bmp", ".tif", ".tiff"):
                        img.save(buf, format="PNG", pnginfo=metadata, compress_level=4)
                        arcname = f"{base}.png"
                    else:
                        img.save(buf, format="PNG", pnginfo=metadata, compress_level=4)
                        if ext == "":
                            arcname = f"{arcname}.png"
                    if arcname in self._seen_arcnames:
                        n = 2
                        while True:
                            cand = f"{base}_dup{n}{os.path.splitext(arcname)[1]}"
                            if cand not in self._seen_arcnames:
                                arcname = cand
                                break
                            n += 1
                    self._seen_arcnames.add(arcname)
                    zf.writestr(arcname, buf.getvalue())
                    self._written_images += 1
                    self._written_any += 1
            def _write_video_obj(v):
                if not hasattr(v, "save_to"):
                    return
                orig_name = getattr(v, "__apt_zip_member", None)
                if orig_name is None and hasattr(self, "_name_queue_videos") and len(self._name_queue_videos) > 0:
                    orig_name = self._name_queue_videos.pop(0)
                source_path = getattr(v, "_VideoFromFile__file", None)
                arcname = None
                if orig_name:
                    try:
                        arcname = _safe_zip_member_relpath(str(orig_name).replace("\\", "/"))
                    except Exception:
                        arcname = _safe_basename(str(orig_name))
                if arcname and isinstance(source_path, str) and os.path.isfile(source_path):
                    base, ext = os.path.splitext(arcname)
                    if arcname in self._seen_arcnames:
                        n = 2
                        while True:
                            cand = f"{base}_dup{n}{ext}"
                            if cand not in self._seen_arcnames:
                                arcname = cand
                                break
                            n += 1
                    self._seen_arcnames.add(arcname)
                    zf.write(source_path, arcname=arcname)
                    self._written_videos += 1
                    self._written_any += 1
                    return
                buf = io.BytesIO()
                v.save_to(buf, metadata=video_metadata)
                data = buf.getvalue()
                if not arcname:
                    fmt = None
                    if hasattr(v, "get_container_format"):
                        try:
                            fmt = str(v.get_container_format()).lower()
                        except Exception:
                            fmt = None
                    ext = "mp4"
                    if fmt:
                        if "webm" in fmt:
                            ext = "webm"
                        elif "matroska" in fmt:
                            ext = "mkv"
                        elif "avi" in fmt:
                            ext = "avi"
                        elif "mp4" in fmt or "mov" in fmt:
                            ext = "mp4"
                    arcname = f"{filename_prefix}_video_{self._written_videos:05}.{ext}"
                base, ext = os.path.splitext(arcname)
                if arcname in self._seen_arcnames:
                    n = 2
                    while True:
                        cand = f"{base}_dup{n}{ext}"
                        if cand not in self._seen_arcnames:
                            arcname = cand
                            break
                        n += 1
                self._seen_arcnames.add(arcname)
                zf.writestr(arcname, data)
                self._written_videos += 1
                self._written_any += 1
            def _write_audio_obj(a):
                orig_name = a.get("__apt_zip_member", None) if isinstance(a, dict) else getattr(a, "__apt_zip_member", None)
                orig_bytes = a.get("__apt_zip_bytes", None) if isinstance(a, dict) else getattr(a, "__apt_zip_bytes", None)
                if orig_name is None and hasattr(self, "_name_queue_audios") and len(self._name_queue_audios) > 0:
                    orig_name = self._name_queue_audios.pop(0)
                arcname = None
                if orig_name:
                    try:
                        arcname = _safe_zip_member_relpath(str(orig_name).replace("\\", "/"))
                    except Exception:
                        arcname = _safe_basename(str(orig_name))
                if arcname and isinstance(orig_bytes, (bytes, bytearray)) and len(orig_bytes) > 0:
                    base, ext = os.path.splitext(arcname)
                    if arcname in self._seen_arcnames:
                        n = 2
                        while True:
                            cand = f"{base}_dup{n}{ext}"
                            if cand not in self._seen_arcnames:
                                arcname = cand
                                break
                            n += 1
                    self._seen_arcnames.add(arcname)
                    zf.writestr(arcname, bytes(orig_bytes))
                    self._written_audios += 1
                    self._written_any += 1
                    return
                data = self._audio_to_wav_bytes(a)
                if arcname:
                    base, _ = os.path.splitext(arcname)
                    arcname = f"{base}.wav"
                else:
                    arcname = f"{filename_prefix}_audio_{self._written_audios:05}.wav"
                base, ext = os.path.splitext(arcname)
                if arcname in self._seen_arcnames:
                    n = 2
                    while True:
                        cand = f"{base}_dup{n}{ext}"
                        if cand not in self._seen_arcnames:
                            arcname = cand
                            break
                        n += 1
                self._seen_arcnames.add(arcname)
                zf.writestr(arcname, data)
                self._written_audios += 1
                self._written_any += 1
            def _write_text(s: str):
                if s is None:
                    return
                s = str(s)
                if s.strip() == "":
                    return
                queued_name = None
                # 检查是否是工作流文件（json）
                is_workflow = False
                parts = s.split("\n", 1)
                if len(parts) == 2:
                    head = parts[0].strip()
                    ext = os.path.splitext(head)[1][1:].lower()  # 去掉点，只保留扩展名
                    if ext in _ALLOWED_WORKFLOW_EXTS:
                        is_workflow = True
                        if hasattr(self, "_name_queue_workflows") and len(self._name_queue_workflows) > 0:
                            queued_name = self._name_queue_workflows.pop(0)
                    elif ext in _ALLOWED_TEXT_EXTS or "/" in head or "\\" in head:
                        if hasattr(self, "_name_queue_texts") and len(self._name_queue_texts) > 0:
                            queued_name = self._name_queue_texts.pop(0)
                else:
                    # 没有文件名前缀，默认从 texts 队列获取
                    if hasattr(self, "_name_queue_texts") and len(self._name_queue_texts) > 0:
                        queued_name = self._name_queue_texts.pop(0)
                arcname = None
                body = s
                if len(parts) == 2:
                    head = parts[0].strip()
                    ext = os.path.splitext(head)[1][1:].lower()  # 去掉点，只保留扩展名
                    if ext in _ALLOWED_TEXT_EXTS or ext in _ALLOWED_WORKFLOW_EXTS or "/" in head or "\\" in head:
                        try:
                            arcname = _safe_zip_member_relpath(head.replace("\\", "/"))
                        except Exception:
                            arcname = _safe_basename(head)
                        body = parts[1]
                if not arcname:
                    if queued_name:
                        try:
                            arcname = _safe_zip_member_relpath(str(queued_name).replace("\\", "/"))
                        except Exception:
                            arcname = _safe_basename(str(queued_name))
                    if not arcname:
                        if is_workflow:
                            arcname = f"{filename_prefix}_workflow_{self._written_workflows:05}.json"
                        else:
                            arcname = f"{filename_prefix}_text_{self._written_texts:05}.txt"
                base, ext = os.path.splitext(arcname)
                if arcname in self._seen_arcnames:
                    n = 2
                    while True:
                        cand = f"{base}_dup{n}{ext}"
                        if cand not in self._seen_arcnames:
                            arcname = cand
                            break
                        n += 1
                self._seen_arcnames.add(arcname)
                data = str(body).encode("utf-8")
                zf.writestr(arcname, data)
                if is_workflow:
                    self._written_workflows += 1
                else:
                    self._written_texts += 1
                self._written_any += 1
            def _write_file(full_path: str, rel_in_zip: str):
                if not os.path.isfile(full_path):
                    return
                st = os.stat(full_path)
                sig = (os.path.normcase(full_path), int(st.st_mtime_ns), int(st.st_size))
                if sig in self._seen_files:
                    return
                self._seen_files.add(sig)
                arcname = "files/" + rel_in_zip.replace("\\", "/")
                zf.write(full_path, arcname=arcname)
                self._written_files += 1
                self._written_any += 1
            def _write_bytes(b: bytes):
                if not b:
                    return
                arcname = f"{filename_prefix}_blob_{self._written_files:05}.bin"
                zf.writestr(arcname, b)
                self._written_files += 1
                self._written_any += 1
            def _write_any(v):
                if v is None:
                    return
                if isinstance(v, (list, tuple)):
                    for x in v:
                        _write_any(x)
                    return
                if isinstance(v, torch.Tensor):
                    _write_image_tensor(v)
                    return
                if isinstance(v, (bytes, bytearray)):
                    _write_bytes(bytes(v))
                    return
                if isinstance(v, dict):
                    if "waveform" in v and "sample_rate" in v:
                        _write_audio_obj(v)
                        return
                    ref = _resolve_file_ref(v)
                    if ref is not None:
                        rel, full = ref
                        _write_file(full, rel)
                        return
                    _write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str))
                    return
                if hasattr(v, "save_to"):
                    _write_video_obj(v)
                    return
                waveform = getattr(v, "waveform", None)
                sample_rate = getattr(v, "sample_rate", None)
                if waveform is not None and sample_rate is not None:
                    _write_audio_obj(v)
                    return
                if isinstance(v, str):
                    raw = v.strip()
                    if raw != "":
                        try:
                            rel, full = self._resolve_annotated_file(raw)
                            if os.path.isfile(full):
                                _write_file(full, rel)
                                return
                        except Exception:
                            if os.path.isabs(raw) and os.path.isfile(raw):
                                rel = os.path.basename(raw)
                                _write_file(raw, rel)
                                return
                            pass
                        _write_text(raw)
                    return
                _write_text(str(v))
            _write_any(AnyFile_zip)
        if self._written_any == 0:
            raise RuntimeError("未写入任何内容（zip 输入为空或类型不支持）")
        ui_file = {"filename": zip_filename, "subfolder": subfolder, "type": self.type}
        if self._ui_emitted:
            return {"ui": {"images": []}}
        self._ui_emitted = True
        return {"ui": {"images": [ui_file]}}




class file_LoadAnyFileList:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        path_mode_options = ["自定义路径", "output目录", "input目录", "默认工作流"]
        extension_mode_options = ["自定义文件", "工作流",  "图像", "视频", "音频", "文本"]

        return {
            "required": {
                "folder_path": (path_mode_options, {"default": "自定义路径"}),
                "custom_path": ("STRING", {"multiline": False, "default": ""}),
                "recursive": ("BOOLEAN", {"default": True}),
                "output_file": (extension_mode_options, {"default": "图像"}),
                "custom_output_file": ("STRING", {"multiline": False, "default": ""})
            }
        }
      
    RETURN_TYPES = (ANY_TYPE, NAME_INTO, ANY_TYPE, ANY_TYPE)
    RETURN_NAMES = ("class_files", "total_file_info", "class_paths", "class_names")
    FUNCTION = "load_file_paths"
    CATEGORY = "OnePrompt"
    OUTPUT_IS_LIST = (True, False, True, True)

    def load_file_paths(self, folder_path: str, custom_path: str, recursive: bool = True, output_file: str = "图像", custom_output_file: str = ""):
        extensions = []
        is_custom_mode = False
        if output_file == "工作流":
            extensions = list(_ALLOWED_WORKFLOW_EXTS)
        elif output_file == "图像":
            extensions = list(_ALLOWED_IMAGE_EXTS)
        elif output_file == "视频":
            extensions = list(_ALLOWED_VIDEO_EXTS)
        elif output_file == "音频":
            extensions = list(_ALLOWED_AUDIO_EXTS)
        elif output_file == "文本":
            extensions = list(_ALLOWED_TEXT_EXTS)
        elif output_file == "自定义文件":
            is_custom_mode = True
            if custom_output_file.strip():
                raw_exts = [ext.strip() for ext in custom_output_file.split("|") if ext.strip()]
                extensions = [ext[1:].lower() if ext.startswith(".") else ext.lower() for ext in raw_exts]

        comfy_root = folder_paths.base_path if hasattr(folder_paths, 'base_path') else os.getcwd()
        final_abs_path = ""
        if folder_path == "自定义路径":
            final_abs_path = custom_path.strip().strip('"')
            if final_abs_path and not os.path.isabs(final_abs_path):
                input_dir = folder_paths.input_directory if hasattr(folder_paths, "input_directory") else comfy_root
                potential_path = os.path.join(input_dir, final_abs_path)
                final_abs_path = potential_path if os.path.exists(potential_path) else os.path.abspath(os.path.join(comfy_root, final_abs_path))
        elif folder_path == "output目录" and hasattr(folder_paths, "output_directory"):
            final_abs_path = folder_paths.output_directory
        elif folder_path == "input目录" and hasattr(folder_paths, "input_directory"):
            final_abs_path = folder_paths.input_directory
        elif folder_path == "默认工作流" and hasattr(folder_paths, 'user_directory'):
            final_abs_path = os.path.join(folder_paths.user_directory, "default", "workflows")

        if not final_abs_path or not (os.path.isfile(final_abs_path) or os.path.isdir(final_abs_path)):
            return ([], json.dumps([], ensure_ascii=False), [], [])

        is_file = os.path.isfile(final_abs_path)
        is_dir = os.path.isdir(final_abs_path)

        file_content_list = []
        full_paths_list = []
        file_names_list = []
        naming_info = {}

        def collect_naming_info(file_path):
            fname = os.path.basename(file_path)
            file_ext = os.path.splitext(fname)[1][1:].lower()
            if file_ext == "zip":
                return
            if file_ext not in naming_info:
                naming_info[file_ext] = []
            naming_info[file_ext].append(fname)

        if is_file:
            collect_naming_info(final_abs_path)
        elif is_dir:
            if recursive:
                for root, _, files in os.walk(final_abs_path):
                    for file in files:
                        collect_naming_info(os.path.join(root, file))
            else:
                for file in os.listdir(final_abs_path):
                    fp = os.path.join(final_abs_path, file)
                    if os.path.isfile(fp):
                        collect_naming_info(fp)

        def process_single_file(file_path):
            fname = os.path.basename(file_path)
            file_ext = os.path.splitext(fname)[1][1:].lower()

            if file_ext == "zip":
                return

            if is_custom_mode:
                if file_ext not in extensions:
                    return
            else:
                if file_ext not in extensions:
                    return

            content = None
            try:
                if file_ext in _ALLOWED_IMAGE_EXTS:
                    img = Image.open(file_path).convert("RGB")
                    img_np = np.array(img).astype(np.float32) / 255.0
                    content = torch.from_numpy(img_np).unsqueeze(0)
                elif file_ext in _ALLOWED_VIDEO_EXTS:
                    content = VideoFromFile(file_path)
                elif file_ext in _ALLOWED_AUDIO_EXTS:
                    if file_ext == "wav":
                        with open(file_path, "rb") as f:
                            raw = f.read()
                        content = _wav_bytes_to_audio(raw)
                    else:
                        if _sf is None:
                            raise RuntimeError("缺少 soundfile，无法解码该音频格式")
                        data, sr = _sf.read(file_path, always_2d=True, dtype="float32")
                        a = np.asarray(data, dtype=np.float32).T
                        a = np.clip(a, -1.0, 1.0)
                        waveform = torch.from_numpy(a).float().unsqueeze(0)
                        content = {"waveform": waveform, "sample_rate": int(sr)}
                elif file_ext in _ALLOWED_TEXT_EXTS:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                elif file_ext in _ALLOWED_WORKFLOW_EXTS:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
            except Exception:
                return

            if content is not None:
                file_content_list.append(content)
                full_paths_list.append(file_path)
                file_names_list.append(fname)

        if is_file:
            process_single_file(final_abs_path)
        elif is_dir:
            if recursive:
                for root, _, files in os.walk(final_abs_path):
                    for file in files:
                        process_single_file(os.path.join(root, file))
            else:
                for file in os.listdir(final_abs_path):
                    fp = os.path.join(final_abs_path, file)
                    if os.path.isfile(fp):
                        process_single_file(fp)
        return (file_content_list, naming_info, full_paths_list, file_names_list)


class file_LoadZipFile:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        input_dir = folder_paths.get_input_directory()
        zip_files = []
        try:
            for root, _, files in os.walk(input_dir):
                for file in files:
                    if file.lower().endswith('.zip'):
                        rel_path = os.path.relpath(os.path.join(root, file), input_dir)
                        zip_files.append(rel_path.replace(os.sep, '/'))
        except Exception:
            pass

        if not zip_files:
            zip_files = [""]

        return {
            "required": {
                "zip_file": (zip_files, {"zip_upload": True}),
            }
        }

    RETURN_TYPES = ("IMAGE", "VIDEO", "AUDIO", "STRING", NAME_INTO)
    RETURN_NAMES = ("images", "videos", "audios", "texts", "file_info")
    FUNCTION = "load_zip"
    CATEGORY = "OnePrompt"
    OUTPUT_IS_LIST = (True, True, True, True, False)

    def load_zip(self, zip_file: str = ""):
        # 获取 zip 文件路径
        zip_path = ""
        if zip_file and zip_file.strip():
            try:
                name, base_dir = folder_paths.annotated_filepath(zip_file)
                if base_dir is None:
                    base_dir = folder_paths.get_input_directory()
                zip_path = os.path.abspath(os.path.join(base_dir, name.replace('/', os.sep)))
            except Exception:
                pass

        if not zip_path or not os.path.isfile(zip_path):
            return ([], [], [], [], {"images": [], "videos": [], "audios": [], "texts": []})

        allowed_extensions = list(_ALLOWED_IMAGE_EXTS) + list(_ALLOWED_VIDEO_EXTS) + list(_ALLOWED_AUDIO_EXTS) + list(_ALLOWED_TEXT_EXTS)

        output_images = []
        output_videos = []
        output_audios = []
        output_texts = []
        naming_info = {}

        zip_key = hashlib.md5(zip_path.encode()).hexdigest()
        extract_root = os.path.join(folder_paths.get_temp_directory(), "apt_zip_extract", zip_key)
        os.makedirs(extract_root, exist_ok=True)

        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.namelist():
                    if member.endswith('/') or member.startswith('.'):
                        continue

                    member_clean = member.replace('\\', '/')
                    drive, _ = os.path.splitdrive(member_clean)
                    if drive or os.path.isabs(member_clean) or member_clean.startswith("/"):
                        continue
                    norm = os.path.normpath(member_clean)
                    if norm.startswith("..") or norm.startswith("../") or norm.startswith("..\\"):
                        continue

                    fname = os.path.basename(norm)
                    file_ext = os.path.splitext(fname)[1][1:].lower()

                    if file_ext not in allowed_extensions:
                        continue

                    temp_file = os.path.join(extract_root, norm)

                    try:
                        if file_ext in _ALLOWED_IMAGE_EXTS:
                            raw_data = zf.read(member)
                            img = Image.open(io.BytesIO(raw_data)).convert("RGB")
                            img_np = np.array(img).astype(np.float32) / 255.0
                            img_tensor = torch.from_numpy(img_np).unsqueeze(0)
                            output_images.append(img_tensor)
                            if file_ext not in naming_info:
                                naming_info[file_ext] = []
                            naming_info[file_ext].append(fname)

                        elif file_ext in _ALLOWED_VIDEO_EXTS:
                            os.makedirs(os.path.dirname(temp_file), exist_ok=True)
                            with open(temp_file, 'wb') as f:
                                f.write(zf.read(member))
                            try:
                                video = VideoFromFile(temp_file)
                                output_videos.append(video)
                                if file_ext not in naming_info:
                                    naming_info[file_ext] = []
                                naming_info[file_ext].append(fname)
                            except Exception:
                                pass

                        elif file_ext in _ALLOWED_AUDIO_EXTS:
                            raw_data = zf.read(member)
                            audio_data = None
                            if file_ext == "wav":
                                try:
                                    audio_data = _wav_bytes_to_audio(raw_data)
                                    output_audios.append(audio_data)
                                    if file_ext not in naming_info:
                                        naming_info[file_ext] = []
                                    naming_info[file_ext].append(fname)
                                except Exception:
                                    pass
                            else:
                                if _sf is None:
                                    continue
                                os.makedirs(os.path.dirname(temp_file), exist_ok=True)
                                audio_temp_file = temp_file
                                with open(audio_temp_file, 'wb') as f:
                                    f.write(raw_data)
                                try:
                                    data, sr = _sf.read(audio_temp_file, always_2d=True, dtype="float32")
                                    a = np.asarray(data, dtype=np.float32).T
                                    a = np.clip(a, -1.0, 1.0)
                                    waveform = torch.from_numpy(a).float().unsqueeze(0)
                                    audio_data = {"waveform": waveform, "sample_rate": int(sr)}
                                    output_audios.append(audio_data)
                                except Exception:
                                    pass
                                finally:
                                    try:
                                        os.remove(audio_temp_file)
                                    except:
                                        pass
                                if audio_data is not None:
                                    if file_ext not in naming_info:
                                        naming_info[file_ext] = []
                                    naming_info[file_ext].append(fname)

                        elif file_ext in _ALLOWED_TEXT_EXTS:
                            raw_data = zf.read(member)
                            text_content = raw_data.decode("utf-8", errors="ignore")
                            formatted_text = f"{fname}\n{text_content}"
                            output_texts.append(formatted_text)
                            if file_ext not in naming_info:
                                naming_info[file_ext] = []
                            naming_info[file_ext].append(fname)

                    except Exception:
                        continue

        except Exception:
            pass
            return ([], [], [], {},)

        return (output_images, output_videos, output_audios, output_texts, naming_info)



class file_AutoIndex_Rename:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": ("STRING", {"multiline": False, "default": "", "placeholder": "文件夹路径"}),
                "file_extensions": ("STRING", {"multiline": False, "default": "", "placeholder": "文件扩展名，多个用逗号分隔，如: jpg,png"}),
                "file_keyword": ("STRING", {"multiline": False, "default": "", "placeholder": "文件关键字，每行一个"}),
                "sequence_digits": ("INT", {"default": 5, "min": 1, "max": 10, "step": 1, "placeholder": "序号位数"}),
                "custom_name": ("STRING", {"multiline": False, "default": "", "placeholder": "自定义命名"}),
                "naming_format": (
                    [
                        "序号",
                        "命名+序号",
                        "序号+命名",
                        "命名",
                    ],
                    {"default": "序号"}
                )
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("status",)
    FUNCTION = "rename_files"
    CATEGORY = "OnePrompt"
    DESCRIPTION = """
    批量重命名文件，支持多种命名格式：
    - 序号：如 00001, 00002...
    - 命名+序号：如 name00001, name00002...
    - 序号+命名：如 00001name, 00002name...
    - 命名：如 name00001, name00002...
    
    序号从 00001 开始计数，位数可自定义。
    """

    def rename_files(self, folder_path, file_extensions, file_keyword, sequence_digits, custom_name, naming_format):
        import os
        import datetime
        
        # 验证文件夹路径
        if not folder_path or not os.path.isdir(folder_path):
            return ("错误：无效的文件夹路径",)
        
        # 解析文件扩展名
        extensions = []
        if file_extensions.strip():
            extensions = [ext.strip().lower() for ext in file_extensions.split(",") if ext.strip()]
        
        # 解析文件关键字
        keywords_list = []
        if file_keyword.strip():
            keywords_list = [f.strip() for f in file_keyword.splitlines() if f.strip()]
        
        # 获取要重命名的文件列表
        files_to_rename = []
        
        if keywords_list:
            # 按关键字匹配文件
            for file_name in os.listdir(folder_path):
                file_path = os.path.join(folder_path, file_name)
                if os.path.isfile(file_path):
                    # 检查文件名是否包含任何关键字
                    for keyword in keywords_list:
                        if keyword in file_name:
                            files_to_rename.append(file_path)
                            break
        else:
            # 处理文件夹中的所有文件
            for file_name in os.listdir(folder_path):
                file_path = os.path.join(folder_path, file_name)
                if os.path.isfile(file_path):
                    # 检查扩展名
                    if extensions:
                        ext = os.path.splitext(file_name)[1].lstrip(".").lower()
                        if ext in extensions:
                            files_to_rename.append(file_path)
                    else:
                        files_to_rename.append(file_path)
        
        if not files_to_rename:
            return ("错误：没有找到符合条件的文件",)
        
        # 开始重命名
        renamed_count = 0
        error_count = 0
        
        # 去重文件列表，确保每个文件只处理一次
        unique_files = []
        seen = set()
        for file_path in files_to_rename:
            if file_path not in seen:
                seen.add(file_path)
                unique_files.append(file_path)
        files_to_rename = unique_files
        
        # 对文件列表进行智能排序，按文件名中的数字顺序处理
        def natural_sort_key(file_path):
            filename = os.path.basename(file_path)
            # 分割文件名成数字和非数字部分
            parts = []
            current_part = ''
            is_digit = False
            for char in filename:
                if char.isdigit() != is_digit:
                    if current_part:
                        if is_digit:
                            parts.append((1, int(current_part)))
                        else:
                            parts.append((0, current_part))
                    current_part = char
                    is_digit = char.isdigit()
                else:
                    current_part += char
            if current_part:
                if is_digit:
                    parts.append((1, int(current_part)))
                else:
                    parts.append((0, current_part))
            return parts
        
        # 使用自然排序
        files_to_rename.sort(key=natural_sort_key)
        
        # 查找最高编号，确保准确
        import re
        existing_counters = []
        folder = files_to_rename[0] if files_to_rename else folder_path
        base_dir = os.path.dirname(folder)
        
        # 生成可能的命名格式模式
        patterns = []
        patterns.append(r"^(\d+)$")  # 序号
        patterns.append(r"^" + re.escape(custom_name) + r"(\d+)$")  # 命名+序号
        patterns.append(r"^(\d+)" + re.escape(custom_name) + r"$")  # 序号+命名
        patterns.append(r"^" + re.escape(custom_name) + r"(\d+)$")  # 命名
        
        # 扫描目录中的文件
        if os.path.exists(base_dir):
            for filename in os.listdir(base_dir):
                for pattern in patterns:
                    match = re.match(pattern, os.path.splitext(filename)[0])
                    if match:
                        try:
                            counter = int(match.group(1))
                            existing_counters.append(counter)
                        except:
                            pass
        
        # 确定起始编号
        if existing_counters:
            counter = max(existing_counters) + 1
        else:
            counter = 1
        
        for file_path in files_to_rename:
            try:
                # 获取文件扩展名
                ext = os.path.splitext(file_path)[1]
                
                # 生成序号
                sequence = f"{counter:0{sequence_digits}d}"
                
                if naming_format == "序号":
                    new_name = f"{sequence}{ext}"
                elif naming_format == "命名+序号":
                    new_name = f"{custom_name}{sequence}{ext}"
                elif naming_format == "序号+命名":
                    new_name = f"{sequence}{custom_name}{ext}"
                elif naming_format == "命名":
                    new_name = f"{custom_name}{sequence}{ext}"
                else:
                    new_name = f"{sequence}{ext}"
                
                # 递增计数器
                counter += 1
                
                # 构建新文件路径
                new_file_path = os.path.join(os.path.dirname(file_path), new_name)
                
                # 确保新文件名唯一
                counter = 1
                base_new_name = new_name
                while os.path.exists(new_file_path):
                    name_part = os.path.splitext(base_new_name)[0]
                    new_name = f"{name_part}_{counter}{ext}"
                    new_file_path = os.path.join(os.path.dirname(file_path), new_name)
                    counter += 1
                
                # 执行重命名
                os.rename(file_path, new_file_path)
                renamed_count += 1
                
            except Exception as e:
                error_count += 1
                print(f"重命名文件时出错: {file_path}, 错误: {str(e)}")
        
        # 返回状态
        if renamed_count > 0:
            status = f"成功：重命名了 {renamed_count} 个文件"
            if error_count > 0:
                status += f"，失败了 {error_count} 个文件"
        else:
            status = f"错误：重命名失败，失败了 {error_count} 个文件"
        
        return (status,)


class file_FileInfo_Merge_Single:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {
            "required": {
                "file_names_list": ("STRING", {"forceInput": True}),
                "extension": ("STRING", {"multiline": False, "default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("file_info",)
    FUNCTION = "merge_to_type"
    CATEGORY = "OnePrompt"
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (False,)

    def merge_to_type(self, file_names_list, extension=""):
        final_file_info = {}
        
        if isinstance(extension, list):
            ext_str = extension[0].strip() if (len(extension) > 0 and extension[0]) else ""
        else:
            ext_str = str(extension).strip()
        
        if not ext_str:
            return (json.dumps(final_file_info),)
        ext_key = ext_str.lower()
        if ext_key.startswith("."):
            ext_key = ext_key[1:]
        
        if not isinstance(file_names_list, list):
            file_names_list = [str(file_names_list).strip()] if str(file_names_list).strip() else []
        
        valid_files = [str(name).strip() for name in file_names_list if str(name).strip() != ""]
        unique_files = list(dict.fromkeys(valid_files))
        
        if unique_files:
            final_file_info[ext_key] = unique_files
        
        return (json.dumps(final_file_info, ensure_ascii=False),)



class file_FileInfo_Merge_mul:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {
            "optional": {
                "file_info_1": ("STRING", {"forceInput": True}),
                "file_info_2": ("STRING", {"forceInput": True}),
                "file_info_3": ("STRING",{"forceInput": True}),
                "file_info_4": ("STRING",{"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("merged_file_info",)
    FUNCTION = "merge_to_type"
    CATEGORY = "OnePrompt"
    INPUT_IS_LIST = False
    OUTPUT_IS_LIST = (False,)

    def merge_to_type(self, file_info_1, file_info_2, file_info_3="", file_info_4="",):
        final_file_info = {}
        all_inputs = [file_info_1, file_info_2, file_info_3, file_info_4]
        
        for input_str in all_inputs:
            if not input_str or not input_str.strip():
                continue
            try:
                data = json.loads(input_str)
                if not isinstance(data, dict):
                    continue
                for ext, files in data.items():
                    ext_key = ext.strip().lower()
                    if isinstance(files, list):
                        valid_files = [f.strip() for f in files if f.strip() != ""]
                        if valid_files:
                            if ext_key not in final_file_info:
                                final_file_info[ext_key] = []
                            final_file_info[ext_key].extend(valid_files)
                            final_file_info[ext_key] = list(dict.fromkeys(final_file_info[ext_key]))
            except:
                continue
        
        return (json.dumps(final_file_info, ensure_ascii=False),)



class file_Split_FileInfo:
    @classmethod
    def INPUT_TYPES(cls) -> dict:
        return {
            "required": {
                "file_info": (NAME_INTO,),
                "extensions": ("STRING", {"multiline": False, "default": ""}),
            }
        }

    RETURN_TYPES = (NAME_INTO, "STRING",)
    RETURN_NAMES = ("single_file_info", "file_names_list",)
    FUNCTION = "split_by_type"
    CATEGORY = "OnePrompt"
    OUTPUT_IS_LIST = (False, True,)

    def split_by_type(self, file_info, extensions=""):
        naming_info = None
        if isinstance(file_info, dict):
            naming_info = file_info
        elif isinstance(file_info, str):
            try:
                naming_info = json.loads(file_info)
            except Exception:
                empty_dict_json = json.dumps({})
                return ([empty_dict_json], [])
        else:
            empty_dict_json = json.dumps({})
            return ([empty_dict_json], [])

        if not isinstance(naming_info, dict):
            empty_dict_json = json.dumps({})
            return ([empty_dict_json], [])

        if not extensions or not extensions.strip():
            empty_dict_json = json.dumps({})
            return ([empty_dict_json], [])

        target_exts = set()
        raw_exts = [ext.strip() for ext in extensions.split("|") if ext.strip()]
        target_exts = set([ext[1:].lower() if ext.startswith(".") else ext.lower() for ext in raw_exts])

        if not target_exts:
            empty_dict_json = json.dumps({})
            return ([empty_dict_json], [])

        result_dict = {}
        result_names = []
        for ext_key, names in naming_info.items():
            if ext_key.lower() in target_exts:
                filtered_names = []
                if isinstance(names, list):
                    filtered_names = [str(n) for n in names if str(n).strip() != ""]
                elif names is not None:
                    filtered_names = [str(names)]
                
                if filtered_names:
                    result_dict[ext_key] = filtered_names
                    result_names.extend(filtered_names)

        result_dict_json = json.dumps(result_dict)
        return ([result_dict_json], result_names)







#endregion------------------------------------------------------------------------------

