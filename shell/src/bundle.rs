// 把 assets/reference 下原版的分发数据打成一份 JSON，字段与 desktop/reference.cjs 完全一致。

use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn read_text(path: &Path) -> String {
    let bytes = fs::read(path).unwrap_or_default();
    if bytes.len() > 1 && bytes[0] == 0xff && bytes[1] == 0xfe {
        return crate::text::decode_as(&bytes, "utf-16le");
    }
    if bytes.len() > 1 && bytes[0] == 0xfe && bytes[1] == 0xff {
        return crate::text::decode_as(&bytes, "utf-16be");
    }
    match String::from_utf8(bytes.clone()) {
        Ok(text) => text,
        Err(_) => {
            let (text, _, _) = encoding_rs::GBK.decode(&bytes);
            text.into_owned()
        }
    }
}

fn list(dir: &Path, ext: &str) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.to_lowercase().ends_with(ext))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

pub fn build(ref_dir: &Path) -> Value {
    let syn_dir = ref_dir.join("syntax");
    let theme_dir = ref_dir.join("theme");
    let syntaxes = list(&syn_dir, ".mac");
    let themes = list(&theme_dir, ".ini");

    let mut files = Map::new();
    for name in &syntaxes {
        files.insert(name.clone(), Value::String(read_text(&syn_dir.join(name))));
    }
    // .kwd 是外挂关键字表，php.mac 用 AddWordFromFile 按文件名取
    for name in list(&syn_dir, ".kwd") {
        files.insert(name.clone(), Value::String(read_text(&syn_dir.join(name))));
    }

    let mut theme_files = Map::new();
    for name in &themes {
        theme_files.insert(name.clone(), Value::String(read_text(&theme_dir.join(name))));
    }

    let settings = fs::read_to_string(ref_dir.join("setting.ini"))
        .map(|_| read_text(&ref_dir.join("setting.ini")))
        .unwrap_or_default();

    json!({
        "syntaxes": syntaxes,
        "themes": themes,
        "files": Value::Object(files),
        "themeFiles": Value::Object(theme_files),
        "settings": settings,
        "root": ref_dir.to_string_lossy(),
        "count": 0,
    })
}

/// 程序目录：exe 所在处（打包后就是安装目录）。开发时用 MINIEDIT_ROOT 指到仓库根。
pub fn root_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MINIEDIT_ROOT") {
        return PathBuf::from(dir);
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}
