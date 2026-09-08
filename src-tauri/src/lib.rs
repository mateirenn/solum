use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

fn temporary_path(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The selected project filename is invalid.".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create a temporary project path: {error}"))?
        .as_nanos();
    Ok(path.with_file_name(format!(
        ".{file_name}.tmp-{}-{timestamp}",
        std::process::id()
    )))
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = temporary_path(path)?;
    let write_result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result.map_err(|error| format!("Could not atomically write the project: {error}"))
}

fn project_path(path: String) -> Result<PathBuf, String> {
    if path.contains('\0') {
        return Err("The selected project path is invalid.".to_string());
    }
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute()
        || candidate
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("rterrain"))
            != Some(true)
    {
        return Err("Solum project files must use the .rterrain extension.".to_string());
    }
    Ok(candidate)
}

#[tauri::command]
async fn read_project_file(path: String) -> Result<String, String> {
    let path = project_path(path)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(path).map_err(|error| format!("Could not read the project: {error}"))
    })
    .await
    .map_err(|error| format!("Could not read the project: {error}"))?
}

#[tauri::command]
async fn write_project_file(path: String, contents: String) -> Result<(), String> {
    let path = project_path(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "The selected project folder is invalid.".to_string())?;
    if !parent.is_dir() {
        return Err("The selected project folder does not exist.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        atomic_write(&path, contents.as_bytes())
            .map_err(|error| format!("Could not save the project: {error}"))
    })
    .await
    .map_err(|error| format!("Could not save the project: {error}"))?
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate Solum app data: {error}"))?;
    Ok(directory.join("recovery.rterrain"))
}

#[tauri::command]
async fn read_recovery_file(app: AppHandle) -> Result<Option<String>, String> {
    let path = recovery_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read the recovery snapshot: {error}")),
    })
    .await
    .map_err(|error| format!("Could not read the recovery snapshot: {error}"))?
}

#[tauri::command]
async fn write_recovery_file(app: AppHandle, contents: String) -> Result<(), String> {
    const MAX_RECOVERY_BYTES: usize = 256 * 1024 * 1024;
    if contents.len() > MAX_RECOVERY_BYTES {
        return Err("The recovery snapshot is too large to write safely.".to_string());
    }
    let path = recovery_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = path
            .parent()
            .ok_or_else(|| "The Solum app data folder is invalid.".to_string())?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("Could not create the recovery folder: {error}"))?;
        atomic_write(&path, contents.as_bytes())
            .map_err(|error| format!("Could not write the recovery snapshot: {error}"))
    })
    .await
    .map_err(|error| format!("Could not write the recovery snapshot: {error}"))?
}

#[tauri::command]
async fn clear_recovery_file(app: AppHandle) -> Result<(), String> {
    let path = recovery_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not clear the recovery snapshot: {error}")),
    })
    .await
    .map_err(|error| format!("Could not clear the recovery snapshot: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project_file,
            write_project_file,
            read_recovery_file,
            write_recovery_file,
            clear_recovery_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Solum");
}

#[cfg(test)]
mod tests {
    use super::{atomic_write, project_path};

    #[test]
    fn accepts_absolute_rterrain_paths() {
        assert!(project_path(r"C:\temp\terrain.rterrain".to_string()).is_ok());
    }

    #[test]
    fn rejects_unscoped_or_wrong_extension_paths() {
        assert!(project_path("terrain.rterrain".to_string()).is_err());
        assert!(project_path(r"C:\temp\terrain.json".to_string()).is_err());
        assert!(project_path("C:\\temp\\bad\0.rterrain".to_string()).is_err());
    }

    #[test]
    fn atomically_replaces_existing_contents() {
        let path = std::env::temp_dir().join(format!(
            "solum-atomic-write-{}.rterrain",
            std::process::id()
        ));
        atomic_write(&path, b"first snapshot").expect("first snapshot should be written");
        atomic_write(&path, b"second snapshot").expect("second snapshot should replace the first");
        assert_eq!(
            std::fs::read_to_string(&path).expect("snapshot should be readable"),
            "second snapshot"
        );
        let _ = std::fs::remove_file(path);
    }
}
