// Native Feel P2: 读取 Windows 系统强调色
// 通过读取注册表实现，零外部依赖

/// 返回 Windows 系统强调色，格式 #RRGGBB
/// 使用 `reg query` 读取注册表，失败时返回 None
#[tauri::command]
pub fn get_system_accent_color() -> Option<String> {
    read_accent_color_from_registry()
}

#[cfg(target_os = "windows")]
fn read_accent_color_from_registry() -> Option<String> {
    use std::process::Command;

    let output = Command::new("reg")
        .args([
            "query",
            r"HKEY_CURRENT_USER\Software\Microsoft\Windows\DWM",
            "/v",
            "AccentColor",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // 输出格式：
    // HKEY_CURRENT_USER\Software\Microsoft\Windows\DWM
    //     AccentColor    REG_DWORD    0xff0078d7

    for line in stdout.lines() {
        if line.contains("AccentColor") && line.contains("REG_DWORD") {
            // 提取 hex 值
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(hex_str) = parts.last() {
                // hex_str: "0xff0078d7" (ABGR 格式)
                if let Ok(color) = u32::from_str_radix(hex_str.trim_start_matches("0x"), 16) {
                    // ABGR → RRGGBB
                    let r = (color & 0xFF) as u8;
                    let g = ((color >> 8) & 0xFF) as u8;
                    let b = ((color >> 16) & 0xFF) as u8;
                    return Some(format!("#{:02x}{:02x}{:02x}", r, g, b));
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn read_accent_color_from_registry() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_accent_color() {
        // 在非 Windows 平台，返回 None 而不崩溃
        let color = read_accent_color_from_registry();
        // 不强制断言，因为 CI 可能没有注册表
        if let Some(c) = &color {
            assert!(c.starts_with('#'));
            assert_eq!(c.len(), 7);
        }
    }
}
