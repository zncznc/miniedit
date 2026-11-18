// 状态文件：%APPDATA%/MiniEdit/state.json —— 与 Electron 版共用同一份，卸载重装不丢设置。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct WindowState {
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct State {
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub window: Option<WindowState>,
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub last_dir: String,
    #[serde(default)]
    pub zoom: i32,
}

impl Default for State {
    fn default() -> Self {
        State {
            theme: String::new(),
            window: None,
            recent: Vec::new(),
            last_dir: String::new(),
            zoom: 0,
        }
    }
}

pub fn user_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("MINIEDIT_USERDATA") {
        return PathBuf::from(dir);
    }
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join("MiniEdit")
}

impl State {
    fn file() -> PathBuf {
        user_data_dir().join("state.json")
    }

    pub fn load() -> State {
        let text = std::fs::read_to_string(Self::file()).unwrap_or_default();
        if text.trim().is_empty() {
            return State::default();
        }
        // cjs 版写的是 lastDir / window.width，这里用 serde 的别名接住
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Raw {
            #[serde(default)]
            theme: String,
            #[serde(default)]
            window: Option<WindowState>,
            #[serde(default)]
            recent: Vec<String>,
            #[serde(default, rename = "lastDir")]
            last_dir: String,
            #[serde(default)]
            zoom: i32,
        }
        match serde_json::from_str::<Raw>(&text) {
            Ok(raw) => State {
                theme: raw.theme,
                window: raw.window,
                recent: raw.recent,
                last_dir: raw.last_dir,
                zoom: raw.zoom,
            },
            Err(_) => State::default(),
        }
    }

    pub fn save(&self) {
        let dir = user_data_dir();
        let _ = std::fs::create_dir_all(&dir);
        let payload = serde_json::json!({
            "theme": self.theme,
            "window": self.window,
            "recent": self.recent,
            "lastDir": self.last_dir,
            "zoom": self.zoom,
        });
        if let Ok(text) = serde_json::to_string_pretty(&payload) {
            let _ = std::fs::write(dir.join("state.json"), text);
        }
    }

    pub fn add_recent(&mut self, path: &str) {
        self.recent.retain(|p| p != path);
        self.recent.insert(0, path.to_string());
        self.recent.truncate(12);
        if let Some(parent) = std::path::Path::new(path).parent() {
            self.last_dir = parent.to_string_lossy().into_owned();
        }
        self.save();
    }
}
