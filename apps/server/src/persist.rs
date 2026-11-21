use std::{fs, io::Write, path::Path};

use serde::{Serialize, de::DeserializeOwned};
use tempfile::NamedTempFile;

use crate::error::AppResult;

fn ensure_parent(path: &Path) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn persist_atomic(path: &Path, content: &[u8]) -> AppResult<()> {
    ensure_parent(path)?;

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let mut temp_file = NamedTempFile::new_in(parent)?;
    temp_file.write_all(content)?;
    temp_file.flush()?;
    temp_file.as_file().sync_all()?;
    // persist() atomically renames the temp file onto `path`; there is no
    // leftover temp file to clean up afterwards.
    temp_file.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn read_json_file<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

pub fn write_json_pretty<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    let content = serde_json::to_vec_pretty(value)?;
    persist_atomic(path, &content)
}

pub fn read_toml_file<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let content = fs::read_to_string(path)?;
    Ok(toml::from_str(&content)?)
}

pub fn write_toml_file<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let content = toml::to_string_pretty(value)?;
    persist_atomic(path, content.as_bytes())
}

pub fn read_text_file(path: &Path) -> AppResult<String> {
    Ok(fs::read_to_string(path)?)
}

pub fn write_text_file(path: &Path, content: &str) -> AppResult<()> {
    persist_atomic(path, content.as_bytes())
}
