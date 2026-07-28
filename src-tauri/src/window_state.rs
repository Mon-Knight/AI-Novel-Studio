// Native Feel P1: 窗口状态持久化 + 单实例检测
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Window;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1400.0,
            height: 900.0,
            x: -1,
            y: -1,
            maximized: false,
        }
    }
}

fn state_file_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("window-state.json")
}

fn lock_file_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("instance.lock")
}

/// 加载保存的窗口状态（含异常防护）
pub fn load_window_state(app_data_dir: &PathBuf) -> WindowState {
    let path = state_file_path(app_data_dir);
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<WindowState>(&content) {
                // 校验合理性
                let state = validate_window_state(state);
                return state;
            }
        }
        // JSON 损坏，删除无效文件
        let _ = fs::remove_file(&path);
    }
    WindowState::default()
}

/// 校验窗口状态合理性（屏幕外防护 / 最小尺寸 / JSON 损坏回退）
fn validate_window_state(mut state: WindowState) -> WindowState {
    const MIN_WIDTH: f64 = 1024.0;
    const MIN_HEIGHT: f64 = 680.0;

    // 最小尺寸强制
    if state.width < MIN_WIDTH {
        state.width = MIN_WIDTH;
    }
    if state.height < MIN_HEIGHT {
        state.height = MIN_HEIGHT;
    }

    // 最大化状态无需校验位置
    if state.maximized {
        return state;
    }

    // 屏幕外防护：检查位置是否在有效显示器范围内
    if let Some((max_x, max_y)) = get_virtual_screen_bounds() {
        // 坐标合法性：超出虚拟屏幕范围时回退
        if state.x < -200 || state.y < -200 || state.x > max_x || state.y > max_y {
            state.x = -1;
            state.y = -1;
        }
    } else {
        // 无法获取屏幕边界时的宽松检测：只拒绝极度异常值
        if state.x < -20000 || state.y < -20000 || state.x > 20000 || state.y > 20000 {
            state.x = -1;
            state.y = -1;
        }
    }

    state
}

/// 获取虚拟屏幕边界（所有显示器组合范围）
#[cfg(target_os = "windows")]
fn get_virtual_screen_bounds() -> Option<(i32, i32)> {
    // Windows: 使用 PowerShell 获取虚拟屏幕尺寸
    // GetSystemMetrics(SM_CXVIRTUALSCREEN) = 78, GetSystemMetrics(SM_CYVIRTUALSCREEN) = 79
    // 简化方案：直接返回足够大的范围，或使用 win32 API
    None // 暂时返回 None，后续可接入 windows crate
}

#[cfg(not(target_os = "windows"))]
fn get_virtual_screen_bounds() -> Option<(i32, i32)> {
    None
}

/// 保存窗口状态（跳过最小化状态）
pub fn save_window_state(window: &Window, app_data_dir: &PathBuf) {
    // 最小化时不保存位置（Windows 会返回 -32000）
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    if let Ok(scale_factor) = window.scale_factor() {
        if let Ok(position) = window.outer_position() {
            if let Ok(size) = window.outer_size() {
                let logical_size = size.to_logical(scale_factor);
                let logical_pos = position.to_logical(scale_factor);
                let maximized = window.is_maximized().unwrap_or(false);

                let state = WindowState {
                    width: logical_size.width,
                    height: logical_size.height,
                    x: logical_pos.x,
                    y: logical_pos.y,
                    maximized,
                };

                if let Ok(json) = serde_json::to_string_pretty(&state) {
                    let _ = fs::create_dir_all(app_data_dir);
                    let _ = fs::write(state_file_path(app_data_dir), json);
                }
            }
        }
    }
}

/// 应用窗口状态
pub fn apply_window_state(window: &Window, state: &WindowState) {
    use tauri::Position::Physical;
    use tauri::Size::Logical;

    if state.maximized {
        let _ = window.maximize();
        return;
    }

    // 只在有有效位置时设置
    if state.x >= 0 && state.y >= 0 {
        let _ = window.set_position(Physical(tauri::PhysicalPosition {
            x: state.x,
            y: state.y,
        }));
    }

    let _ = window.set_size(Logical(tauri::LogicalSize {
        width: state.width,
        height: state.height,
    }));
}

/// 检查并创建单实例锁
/// 返回 true 表示首次启动，false 表示已有实例在运行
pub fn try_acquire_instance_lock(app_data_dir: &PathBuf) -> bool {
    let _ = fs::create_dir_all(app_data_dir);
    let lock_path = lock_file_path(app_data_dir);

    // 检查已有锁文件
    if lock_path.exists() {
        // 读取锁文件中的 PID
        if let Ok(content) = fs::read_to_string(&lock_path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                // 检查该 PID 的进程是否仍在运行
                if is_process_running(pid) {
                    return false; // 已有实例在运行
                }
            }
        }
        // 锁文件存在但进程已死（过期锁），删除并继续
        let _ = fs::remove_file(&lock_path);
    }

    // 写入当前 PID
    let pid = std::process::id();
    let _ = fs::write(&lock_path, pid.to_string());
    true
}

/// 释放单实例锁
pub fn release_instance_lock(app_data_dir: &PathBuf) {
    let lock_path = lock_file_path(app_data_dir);
    let _ = fs::remove_file(&lock_path);
    // 同时清理可能残留的聚焦请求
    let focus_path = focus_request_path(app_data_dir);
    let _ = fs::remove_file(&focus_path);
}

/// 写入聚焦请求（供第二次启动调用）
pub fn write_focus_request(app_data_dir: &PathBuf) {
    let _ = fs::create_dir_all(app_data_dir);
    let path = focus_request_path(app_data_dir);
    let _ = fs::write(&path, "focus");
}

fn focus_request_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("focus.request")
}

#[cfg(target_os = "windows")]
fn is_process_running(pid: u32) -> bool {
    use std::process::Command;
    // 使用 tasklist 检查进程是否存在
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid)])
        .output();
    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.contains(&pid.to_string())
        }
        Err(_) => true, // 无法检测时保守假定进程在运行
    }
}

#[cfg(not(target_os = "windows"))]
fn is_process_running(_pid: u32) -> bool {
    // 非 Windows 平台暂不实现
    true
}
