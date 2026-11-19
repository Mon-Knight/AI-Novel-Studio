//! Existing application-data layout, isolated from the command registration list.
use std::path::PathBuf;

fn resolve_app_data_dir(base: Option<PathBuf>) -> Option<PathBuf> {
    base.map(|base| {
        #[cfg(target_os = "windows")]
        { base.join("com.ainovelstudio.app") }
        #[cfg(not(target_os = "windows"))]
        { base.join(".local").join("share").join("com.ainovelstudio.app") }
    })
}

pub(crate) fn get_app_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA").ok().map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var("HOME").ok().map(PathBuf::from);
    if let Some(dir) = resolve_app_data_dir(base) {
        let _ = std::fs::create_dir_all(&dir);
        return dir;
    }
    PathBuf::from(".")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_environment_retains_the_existing_fallback_choice() {
        assert_eq!(resolve_app_data_dir(None), None);
    }
    #[test]
    fn supplied_base_keeps_the_existing_platform_layout_without_touching_disk() {
        let base=PathBuf::from("isolated-startup-layout-fixture");
        #[cfg(target_os="windows")]
        let expected=base.join("com.ainovelstudio.app");
        #[cfg(not(target_os="windows"))]
        let expected=base.join(".local").join("share").join("com.ainovelstudio.app");
        assert_eq!(resolve_app_data_dir(Some(base)),Some(expected));
    }
}
