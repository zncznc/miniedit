// MiniEdit 的 WebView2 外壳：界面仍是 index.html + js/app.js，
// 只是把 Electron 主进程那层换成 wry + tao + 原生对话框。
//
// 没有这一行，GNU 工具链默认按 console 子系统链接，双击就会先弹一个黑框；
// 改成 windows 子系统后 PE 头里是 2，才是一个正常的 GUI 程序。
#![windows_subsystem = "windows"]

mod bridge;
mod bundle;
mod state;
mod text;

use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde_json::{json, Value};
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::http::{header, Request, Response};
use wry::{DragDropEvent, WebViewBuilder};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_SIZE: u64 = 32 * 1024 * 1024; // 超过 32MB 不开，避免把窗口拖死

#[derive(Debug, Clone)]
enum UserEvent {
    Ipc(String),
    Reply(u64, Value),
    OpenFiles(Vec<String>),
    Probe,
}

struct App {
    state: Mutex<state::State>,
    dirty: Mutex<bool>,
    close_now: Mutex<bool>,
}

static BUNDLE: OnceLock<Value> = OnceLock::new();

fn js_str(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".into())
}

fn mime_of(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// 前端文件目录：开发时用 MINIEDIT_WEB 指仓库根，打包后是 exe 旁边的 web/
fn web_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MINIEDIT_WEB") {
        return PathBuf::from(dir);
    }
    bundle::root_dir().join("web")
}

fn serve_file(req: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let raw = req.uri().path();
    let mut rel = raw.trim_start_matches('/');
    if rel.is_empty() {
        rel = "index.html";
    }
    // 只允许在 web 目录内取文件
    let mut full = web_dir();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        full.push(part);
    }
    match std::fs::read(&full) {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, mime_of(&full))
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(_) => Response::builder()
            .status(404)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Cow::Owned(format!("404 {}", rel).into_bytes()))
            .unwrap(),
    }
}

fn mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_item(path: &Path) -> Result<Value, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("不是文件".into());
    }
    if meta.len() > MAX_SIZE {
        return Err(format!("文件 {}MB，超过预览上限 32MB", meta.len() / 1048576));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let d = text::detect(&bytes);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(json!({
        "path": path.to_string_lossy(),
        "name": name,
        "text": d.text,
        "encoding": d.encoding,
        "encodingLabel": text::label(d.encoding),
        "binary": d.binary,
        "eol": text::detect_eol(&d.text),
        "size": meta.len(),
        "mtimeMs": mtime_ms(path),
    }))
}

fn write_item(app: &App, file_path: &str, content: &str, encoding: &str, eol: &str) -> Result<Value, String> {
    let path = Path::new(file_path);
    let text_final = if eol.is_empty() {
        content.to_string()
    } else {
        text::normalize_eol(content, eol)
    };
    let payload = text::encode(&text_final, encoding);
    // GBK 装不下的字符会被写成 '?'，这种情况必须让用户知道，而不是悄悄丢字
    let lossy = text::decode_as(&payload, encoding) != text_final;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, &payload).map_err(|e| e.to_string())?;
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    app.state.lock().unwrap().add_recent(file_path);
    Ok(json!({
        "path": file_path,
        "size": size,
        "mtimeMs": mtime_ms(path),
        "encoding": encoding,
        "lossy": lossy,
    }))
}

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into()))
}

fn start_dir(app: &App) -> PathBuf {
    let st = app.state.lock().unwrap();
    if st.last_dir.is_empty() {
        home_dir()
    } else {
        PathBuf::from(&st.last_dir)
    }
}

fn handle_ipc(
    app: &Arc<App>,
    body: &str,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
) -> Option<(u64, Value)> {
    let msg: Value = serde_json::from_str(body).ok()?;
    let id = msg.get("id").and_then(|v| v.as_u64())?;
    let method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let args = msg.get("args").cloned().unwrap_or(Value::Null);
    let arg_str = |key: &str| args.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let encoding_of = |key: &str| {
        let e = args.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string();
        if e.is_empty() {
            "utf-8".to_string()
        } else {
            e
        }
    };

    let reply = match method {
        "boot-meta" => {
            let st = app.state.lock().unwrap();
            let recovery: Value = std::fs::read(state::user_data_dir().join("recovery.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or(json!([]));
            json!({
                "version": VERSION,
                "platform": "win32",
                "recent": st.recent,
                "zoom": st.zoom,
                "theme": st.theme,
                "userData": state::user_data_dir().to_string_lossy(),
                "hasMenu": false,
                "recovery": recovery,
            })
        }
        "read" => {
            let p = arg_str("path");
            match read_item(Path::new(&p)) {
                Ok(item) => {
                    app.state.lock().unwrap().add_recent(&p);
                    json!({ "ok": true, "item": item })
                }
                Err(e) => json!({ "ok": false, "error": e, "path": p }),
            }
        }
        // 只问修改时间，不读正文：切回窗口时用它判断文件有没有被别的程序改过
        "stat" => {
            let p = arg_str("path");
            match std::fs::metadata(&p) {
                Ok(m) if m.is_file() => json!({
                    "ok": true,
                    "mtimeMs": mtime_ms(Path::new(&p)),
                    "size": m.len(),
                }),
                Ok(_) => json!({ "ok": false, "error": "不是文件" }),
                Err(e) => json!({ "ok": false, "error": e.to_string() }),
            }
        }
        "read-many" => {
            let paths: Vec<String> = args
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let mut items = Vec::new();
            let mut errors = Vec::new();
            for p in paths {
                match read_item(Path::new(&p)) {
                    Ok(item) => {
                        app.state.lock().unwrap().add_recent(&p);
                        items.push(item);
                    }
                    Err(e) => errors.push(json!({ "path": p, "error": e })),
                }
            }
            json!({ "ok": true, "items": items, "errors": errors })
        }
        "write" => {
            let file_path = arg_str("filePath");
            let content = arg_str("text");
            let encoding = encoding_of("encoding");
            let eol = arg_str("eol");
            match write_item(app, &file_path, &content, &encoding, &eol) {
                Ok(item) => json!({ "ok": true, "item": item }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "open-dialog" => {
            // 原生对话框会自己跑消息循环，放到独立线程里弹，别卡住 WebView2 的回调
            let app2 = app.clone();
            let proxy2 = proxy.clone();
            let start = start_dir(app);
            std::thread::spawn(move || {
                let reply = dialog_open(&app2, start);
                let _ = proxy2.send_event(UserEvent::Reply(id, reply));
            });
            return None;
        }
        "save-dialog" => {
            let app2 = app.clone();
            let proxy2 = proxy.clone();
            let start = start_dir(app);
            let default_name = {
                let n = arg_str("defaultName");
                if n.is_empty() {
                    "未命名.txt".to_string()
                } else {
                    n
                }
            };
            let content = arg_str("text");
            let encoding = encoding_of("encoding");
            let eol = arg_str("eol");
            std::thread::spawn(move || {
                let reply = dialog_save(&app2, start, &default_name, &content, &encoding, &eol);
                let _ = proxy2.send_event(UserEvent::Reply(id, reply));
            });
            return None;
        }
        "confirm-close" => {
            let proxy2 = proxy.clone();
            let name = arg_str("name");
            std::thread::spawn(move || {
                let answer = rfd::MessageDialog::new()
                    .set_title("未保存的更改")
                    .set_description(format!("“{}” 有未保存的更改。\n要先保存吗？", name))
                    .set_buttons(rfd::MessageButtons::YesNoCancel)
                    .show();
                let value = match answer {
                    rfd::MessageDialogResult::Yes => json!("save"),
                    rfd::MessageDialogResult::No => json!("discard"),
                    _ => json!("cancel"),
                };
                let _ = proxy2.send_event(UserEvent::Reply(id, value));
            });
            return None;
        }
        "error-dialog" => {
            let proxy2 = proxy.clone();
            let message = arg_str("message");
            let detail = arg_str("detail");
            std::thread::spawn(move || {
                rfd::MessageDialog::new()
                    .set_title("MiniEdit")
                    .set_description(format!("{}\n\n{}", message, detail))
                    .set_level(rfd::MessageLevel::Error)
                    .set_buttons(rfd::MessageButtons::Ok)
                    .show();
                let _ = proxy2.send_event(UserEvent::Reply(id, Value::Null));
            });
            return None;
        }
        "set-dirty" => {
            let d = args.get("dirty").and_then(|v| v.as_bool()).unwrap_or(false);
            *app.dirty.lock().unwrap() = d;
            json!(null)
        }
        "set-title" => {
            let name = arg_str("name");
            let dirty = args.get("dirty").and_then(|v| v.as_bool()).unwrap_or(false);
            *app.dirty.lock().unwrap() = dirty;
            let title = if name.is_empty() {
                "MiniEdit".to_string()
            } else {
                format!("{}{} — MiniEdit", if dirty { "● " } else { "" }, name)
            };
            json!({ "title": title })
        }
        "set-theme" => {
            let name = arg_str("name");
            let mut st = app.state.lock().unwrap();
            st.theme = name;
            st.save();
            json!(null)
        }
        "set-zoom" => {
            let zoom = args.get("zoom").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
            let mut st = app.state.lock().unwrap();
            st.zoom = zoom;
            st.save();
            json!({ "zoom": zoom })
        }
        "recent" => {
            let st = app.state.lock().unwrap();
            json!(st.recent)
        }
        "reveal" => {
            let p = arg_str("path");
            if !p.is_empty() {
                let _ = std::process::Command::new("explorer.exe")
                    .arg(format!("/select,{}", p))
                    .spawn();
            }
            json!(null)
        }
        "sample" => {
            let name = arg_str("name");
            let path = web_dir().join("assets").join("samples").join(&name);
            match read_item(&path) {
                Ok(item) => json!({ "ok": true, "item": item }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "temp-path" => json!(std::env::temp_dir()
            .join("miniedit-selftest.txt")
            .to_string_lossy()),
        // 未保存内容的快照：tao 拦不住窗口关闭，所以改成"随时存、下次启动恢复"
        "save-recovery" => {
            let tabs = args.get("tabs").cloned().unwrap_or(json!([]));
            let path = state::user_data_dir().join("recovery.json");
            let empty = tabs.as_array().map(|a| a.is_empty()).unwrap_or(true);
            if empty {
                let _ = std::fs::remove_file(&path);
            } else {
                let _ = std::fs::create_dir_all(state::user_data_dir());
                let _ = std::fs::write(&path, serde_json::to_vec_pretty(&tabs).unwrap_or_default());
            }
            json!({ "ok": true })
        }
        "close" => {
            *app.close_now.lock().unwrap() = true;
            json!(null)
        }
        _ => json!({ "ok": false, "error": format!("未知方法 {}", method) }),
    };
    Some((id, reply))
}

fn dialog_open(app: &Arc<App>, start: PathBuf) -> Value {
    let picked = rfd::FileDialog::new()
        .set_title("打开文件")
        .set_directory(start)
        .add_filter("所有文件", &["*"])
        .add_filter("文本", &["txt", "log", "md", "ini", "conf", "cfg", "json"])
        .add_filter(
            "代码",
            &[
                "c", "h", "cpp", "js", "ts", "py", "html", "css", "xml", "sql", "go", "java", "cs",
                "php", "rb", "lua", "sh", "bat", "ps1", "mjs",
            ],
        )
        .pick_files()
        .unwrap_or_default();
    let mut items = Vec::new();
    let mut errors = Vec::new();
    for p in picked {
        let path = p.to_string_lossy().into_owned();
        match read_item(&p) {
            Ok(item) => {
                app.state.lock().unwrap().add_recent(&path);
                items.push(item);
            }
            Err(e) => errors.push(json!({ "path": path, "error": e })),
        }
    }
    json!({ "ok": true, "items": items, "errors": errors })
}

fn dialog_save(
    app: &Arc<App>,
    start: PathBuf,
    default_name: &str,
    content: &str,
    encoding: &str,
    eol: &str,
) -> Value {
    let picked = rfd::FileDialog::new()
        .set_title("另存为")
        .set_directory(start)
        .set_file_name(default_name)
        .add_filter("所有文件", &["*"])
        .save_file();
    match picked {
        None => json!({ "ok": false, "canceled": true }),
        Some(path) => {
            let file_path = path.to_string_lossy().into_owned();
            match write_item(app, &file_path, content, encoding, eol) {
                Ok(item) => json!({ "ok": true, "item": item }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
    }
}

fn main() {
    let app_state = state::State::load();
    let bounds = app_state.window.clone().unwrap_or_default();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let mut builder = WindowBuilder::new()
        .with_title("MiniEdit")
        .with_inner_size(LogicalSize::new(
            bounds.width.unwrap_or(1180.0),
            bounds.height.unwrap_or(760.0),
        ))
        .with_min_inner_size(LogicalSize::new(720.0, 460.0));
    if let (Some(x), Some(y)) = (bounds.x, bounds.y) {
        builder = builder.with_position(PhysicalPosition::new(x, y));
    }
    let window = builder.build(&event_loop).expect("窗口创建失败");
    if bounds.maximized {
        window.set_maximized(true);
    }

    let app = Arc::new(App {
        state: Mutex::new(app_state),
        dirty: Mutex::new(false),
        close_now: Mutex::new(false),
    });

    let ipc_proxy = proxy.clone();
    let drag_proxy = proxy.clone();

    // WebView2 默认把缓存/存储写在 exe 旁边（装到 Program Files 就写不进去，还会把安装目录撑大），
    // 统一挪到 %APPDATA%\MiniEdit\webview2
    let mut web_context = wry::WebContext::new(Some(state::user_data_dir().join("webview2")));

    let webview = WebViewBuilder::with_web_context(&mut web_context)
        .with_custom_protocol("miniedit".to_string(), move |_id, req| {
            if req.uri().path() == "/api/bundle" {
                let value = BUNDLE.get_or_init(|| {
                    // 参考数据跟着前端目录走：开发时是仓库根，打包后是 exe 旁的 web/
                    let ref_dir = web_dir().join("assets").join("reference");
                    bundle::build(&ref_dir)
                });
                let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
                return Response::builder()
                    .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
                    .header(header::CACHE_CONTROL, "no-store")
                    .body(Cow::Owned(body))
                    .unwrap();
            }
            serve_file(&req)
        })
        .with_initialization_script(bridge::INIT_JS)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.into_body()));
        })
        .with_drag_drop_handler(move |event| match event {
            DragDropEvent::Drop { paths, .. } => {
                let list: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let _ = drag_proxy.send_event(UserEvent::OpenFiles(list));
                true
            }
            _ => false,
        })
        .with_url("miniedit://localhost/index.html")
        .build(&window)
        .expect("WebView2 初始化失败");

    // 命令行带路径启动（双击关联文件 / 拖到 exe 上）
    let pending: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).is_file())
        .collect();
    if !pending.is_empty() {
        // 页面可能还没加载完，交给注入脚本在 DOMContentLoaded 后自取
        let _ = webview.evaluate_script(&format!(
            "window.__pendingFiles = {};",
            js_str(&json!(pending))
        ));
    }

    // 无头自检：等界面渲染完（首帧高亮 + 主题应用），跑一遍探针再退出
    if std::env::var("MINIEDIT_SMOKE_SHELL").is_ok() {
        let probe_proxy = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(3500));
            let _ = probe_proxy.send_event(UserEvent::Probe);
        });
    }

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::CloseRequested => {
                    {
                        let mut st = app.state.lock().unwrap();
                        let scale = window.scale_factor();
                        let size = window.inner_size().to_logical::<f64>(scale);
                        let pos = window.outer_position().map(|p| p.to_logical::<f64>(scale)).ok();
                        let mut ws = st.window.clone().unwrap_or_default();
                        ws.maximized = window.is_maximized();
                        if !ws.maximized {
                            ws.width = Some(size.width);
                            ws.height = Some(size.height);
                            if let Some(p) = pos {
                                ws.x = Some(p.x);
                                ws.y = Some(p.y);
                            }
                        }
                        st.window = Some(ws);
                        st.save();
                    }
                    *control_flow = ControlFlow::Exit;
                }
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {}
                _ => {}
            },
            Event::UserEvent(UserEvent::Ipc(body)) => {
                if body.contains("\"method\":\"__smoke\"") {
                    match serde_json::from_str::<Value>(&body) {
                        Ok(v) => println!("SMOKE_SHELL {}", v.get("args").cloned().unwrap_or(Value::Null)),
                        Err(e) => println!("SMOKE_SHELL {{\"stage\":\"parse-error\",\"error\":\"{}\"}}", e),
                    }
                    println!("SMOKE_OK");
                    *control_flow = ControlFlow::Exit;
                    return;
                }
                let closing = body.contains("\"method\":\"close\"");
                if let Some((id, reply)) = handle_ipc(&app, &body, &proxy) {
                    let script = format!("window.__miniReply({}, {});", id, js_str(&reply));
                    let _ = webview.evaluate_script(&script);
                }
                if closing {
                    *control_flow = ControlFlow::Exit;
                }
            }
            Event::UserEvent(UserEvent::Reply(id, value)) => {
                let script = format!("window.__miniReply({}, {});", id, js_str(&value));
                let _ = webview.evaluate_script(&script);
            }
            Event::UserEvent(UserEvent::Probe) => {
                let _ = webview.evaluate_script(bridge::SMOKE_JS);
            }
            Event::UserEvent(UserEvent::OpenFiles(paths)) => {
                let _ = webview.evaluate_script(&format!(
                    "window.__openFilesCb && window.__openFilesCb({});",
                    js_str(&json!(paths))
                ));
            }
            _ => {}
        }
    });
}
