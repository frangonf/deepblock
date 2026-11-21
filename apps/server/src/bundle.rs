//! Versioned portable ZIPs. Markdown remains files; structured values never pass through JS.
use crate::{
    error::{AppError, AppResult},
    storage::PortablePlanning,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::Path,
};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

pub const MAX_JSON: u64 = 64 * 1024 * 1024;
pub const MAX_BUNDLE: u64 = 1024 * 1024 * 1024;
const MAX_MANIFEST: u64 = 16 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    size: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    bundle_version: u32,
    #[serde(deserialize_with = "crate::storage::unique_map")]
    files: BTreeMap<String, Entry>,
}
fn invalid(message: impl ToString) -> AppError {
    AppError::BadRequest(message.to_string())
}
pub fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn fingerprint(portable: &PortablePlanning) -> AppResult<String> {
    Ok(digest(&serde_json::to_vec(portable)?))
}

pub fn write(path: &Path, portable: &PortablePlanning) -> AppResult<()> {
    portable.validate()?;
    let mut planning = portable.clone();
    planning.notes.clear();
    planning.configuration = None;
    let json = serde_json::to_vec_pretty(&planning)?;
    if json.len() as u64 > MAX_JSON {
        return Err(invalid(
            "Planning JSON exceeds 64 MiB; no partial export was created",
        ));
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut zip = ZipWriter::new(staged.as_file_mut());
        let mut files = BTreeMap::new();
        let mut total = 0_u64;
        let mut add = |name: String, bytes: &[u8]| -> AppResult<()> {
            total = total
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| invalid("Bundle too large"))?;
            if total > MAX_BUNDLE {
                return Err(invalid(
                    "Expanded bundle exceeds 1 GiB; no partial export was created",
                ));
            }
            zip.start_file(
                &name,
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .map_err(invalid)?;
            zip.write_all(bytes)?;
            files.insert(
                name,
                Entry {
                    size: bytes.len() as u64,
                    sha256: digest(bytes),
                },
            );
            Ok(())
        };
        add("planning.json".into(), &json)?;
        for (date, text) in &portable.notes {
            add(format!("notes/{date}.md"), text.as_bytes())?;
        }
        if let Some(configuration) = &portable.configuration {
            add("configuration/config.toml".into(), configuration.as_bytes())?;
        }
        let manifest = serde_json::to_vec_pretty(&Manifest {
            bundle_version: 1,
            files,
        })?;
        if manifest.len() as u64 > MAX_MANIFEST || total + manifest.len() as u64 > MAX_BUNDLE {
            return Err(invalid("Bundle manifest too large"));
        }
        zip.start_file("manifest.json", SimpleFileOptions::default())
            .map_err(invalid)?;
        zip.write_all(&manifest)?;
        zip.finish().map_err(invalid)?;
    }
    if staged.as_file().metadata()?.len() > MAX_BUNDLE {
        return Err(invalid(
            "Compressed bundle exceeds 1 GiB; no partial export was created",
        ));
    }
    staged.as_file().sync_all()?;
    staged
        .persist_noclobber(path)
        .map_err(|error| error.error)?;
    sync_dir(parent)?;
    Ok(())
}

pub fn read(path: &Path) -> AppResult<PortablePlanning> {
    if fs::metadata(path)?.len() > MAX_BUNDLE {
        return Err(invalid("Import exceeds 1 GiB"));
    }
    let mut file = fs::File::open(path)?;
    let mut magic = [0; 4];
    let count = file.read(&mut magic)?;
    if count != 4 || magic != *b"PK\x03\x04" {
        if fs::metadata(path)?.len() > MAX_JSON {
            return Err(invalid("Legacy JSON exceeds 64 MiB"));
        }
        let portable: PortablePlanning =
            serde_json::from_reader(fs::File::open(path)?).map_err(invalid)?;
        portable.validate().map_err(invalid)?;
        return Ok(portable);
    }
    let mut archive = ZipArchive::new(fs::File::open(path)?).map_err(invalid)?;
    let mut names = BTreeSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(invalid)?;
        let name = entry.name().map_err(invalid)?.into_owned();
        if !safe_name(&name)
            || !names.insert(name)
            || entry.is_dir()
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 != 0 && mode & 0o170000 != 0o100000)
        {
            return Err(invalid("Unsafe, duplicate or unexpected archive entry"));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| invalid("Archive too large"))?;
        if total > MAX_BUNDLE {
            return Err(invalid("Expanded bundle exceeds 1 GiB"));
        }
    }
    let manifest_bytes = entry_bytes(&mut archive, "manifest.json", MAX_MANIFEST)?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(invalid)?;
    if manifest.bundle_version != 1 {
        return Err(invalid("Unsupported bundle version"));
    }
    let declared: BTreeSet<_> = manifest
        .files
        .keys()
        .cloned()
        .chain(std::iter::once("manifest.json".into()))
        .collect();
    if declared != names || !manifest.files.contains_key("planning.json") {
        return Err(invalid("Missing or undeclared bundle entries"));
    }
    let mut planning = None;
    let mut notes = BTreeMap::new();
    let mut configuration = None;
    for (name, expected) in manifest.files {
        let limit = if name == "planning.json" {
            MAX_JSON
        } else {
            MAX_BUNDLE
        };
        if expected.size > limit {
            return Err(invalid("Bundle entry exceeds its size limit"));
        }
        let bytes = entry_bytes(&mut archive, &name, expected.size)?;
        if bytes.len() as u64 != expected.size || digest(&bytes) != expected.sha256 {
            return Err(invalid("Bundle size or checksum mismatch"));
        }
        match name.as_str() {
            "planning.json" => {
                planning =
                    Some(serde_json::from_slice::<PortablePlanning>(&bytes).map_err(invalid)?)
            }
            "configuration/config.toml" => {
                configuration = Some(String::from_utf8(bytes).map_err(invalid)?)
            }
            _ => {
                let date = &name[6..name.len() - 3];
                notes.insert(date.to_owned(), String::from_utf8(bytes).map_err(invalid)?);
            }
        }
    }
    let mut portable = planning.ok_or_else(|| invalid("Missing planning data"))?;
    if !portable.notes.is_empty() || portable.configuration.is_some() {
        return Err(invalid(
            "ZIP planning data must reference separate notes and configuration",
        ));
    }
    portable.notes = notes;
    portable.configuration = configuration;
    portable.validate().map_err(invalid)?;
    Ok(portable)
}
fn safe_name(name: &str) -> bool {
    if matches!(
        name,
        "manifest.json" | "planning.json" | "configuration/config.toml"
    ) {
        return true;
    }
    name.strip_prefix("notes/")
        .and_then(|s| s.strip_suffix(".md"))
        .is_some_and(|date| crate::models::validate_date_param(date).is_ok())
}
fn entry_bytes(archive: &mut ZipArchive<fs::File>, name: &str, limit: u64) -> AppResult<Vec<u8>> {
    let entry = archive.by_name(name).map_err(invalid)?;
    if entry.size() > limit {
        return Err(invalid("Archive entry exceeds its size limit"));
    }
    let mut bytes = Vec::new();
    entry.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(invalid("Archive expansion exceeds its declared size"));
    }
    Ok(bytes)
}
pub(crate) fn sync_dir(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::PortablePlanning;
    use serde_json::json;

    #[test]
    fn round_trips_resources_larger_than_a_few_kilobytes() {
        // Guards the 64 MiB JSON / 1 GiB bundle ceilings: a payload far above
        // a few kilobytes must export and import unchanged.
        let portable = PortablePlanning {
            format_version: 1,
            days: BTreeMap::new(),
            resources: BTreeMap::from([(
                "backlog".to_string(),
                json!([{ "id": "task", "label": "x".repeat(8 * 1024), "status": "todo" }]),
            )]),
            intents: Vec::new(),
            notes: BTreeMap::new(),
            managed_note_root: "notes".to_string(),
            configuration: None,
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bundle.zip");
        write(&path, &portable).expect("multi-kilobyte planning JSON is within limits");
        let restored = read(&path).unwrap_or_else(|error| panic!("bundle round-trips: {error:?}"));
        assert_eq!(
            restored.resources["backlog"][0]["label"]
                .as_str()
                .unwrap()
                .len(),
            8 * 1024
        );
    }

    fn planning_with(label_len: usize, notes: usize) -> PortablePlanning {
        let mut note_map = BTreeMap::new();
        let start = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        for day in 0..notes {
            let date = start + chrono::Duration::days(day as i64);
            note_map.insert(date.to_string(), "note".to_string());
        }
        PortablePlanning {
            format_version: 1,
            days: BTreeMap::new(),
            resources: BTreeMap::from([(
                "backlog".to_string(),
                json!([{ "id": "task", "label": "x".repeat(label_len), "status": "todo" }]),
            )]),
            intents: Vec::new(),
            notes: note_map,
            managed_note_root: "notes".to_string(),
            configuration: None,
        }
    }

    #[test]
    fn round_trips_multi_megabyte_bundles() {
        // A multi-megabyte payload with hundreds of notes stays far under the
        // real ceilings (64 MiB JSON, 1 GiB bundle, 16 MiB manifest) while
        // exceeding any single-operator degradation of them.
        let portable = planning_with(2 * 1024 * 1024, 10_000);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bundle.zip");
        write(&path, &portable).expect("multi-megabyte bundle is within limits");
        let restored = read(&path).unwrap_or_else(|error| panic!("bundle round-trips: {error:?}"));
        assert_eq!(
            restored.resources["backlog"][0]["label"]
                .as_str()
                .unwrap()
                .len(),
            2 * 1024 * 1024
        );
        assert_eq!(restored.notes.len(), 10_000);
    }

    #[test]
    fn write_creates_missing_parent_directories() {
        let portable = planning_with(8, 0);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing/nested/bundle.zip");
        write(&path, &portable).expect("write creates parent directories");
        assert!(path.is_file());
    }

    #[test]
    fn write_rejects_planning_json_over_the_ceiling() {
        let portable = planning_with(MAX_JSON as usize + 1024, 0);
        let dir = tempfile::tempdir().unwrap();
        let error = write(&dir.path().join("bundle.zip"), &portable)
            .expect_err("payloads above 64 MiB are rejected");
        assert!(error.to_string().contains("exceeds 64 MiB"), "{error}");
    }

    #[test]
    fn read_accepts_regular_file_permission_bits() -> Result<(), Box<dyn std::error::Error>> {
        // Foreign archivers store plain permission bits without file-type
        // bits; such entries must import cleanly.
        let portable = planning_with(8, 1);
        let dir = tempfile::tempdir()?;
        let src = dir.path().join("src.zip");
        write(&src, &portable)?;
        let mut in_archive = ZipArchive::new(fs::File::open(&src)?)?;
        let names: Vec<String> = (0..in_archive.len())
            .map(|i| Ok(in_archive.by_index(i)?.name()?.into_owned()))
            .collect::<zip::result::ZipResult<_>>()?;
        let rewritten = dir.path().join("rewritten.zip");
        {
            let mut out = ZipWriter::new(fs::File::create(&rewritten)?);
            for name in &names {
                let mut entry = in_archive.by_name(name)?;
                out.start_file(name, SimpleFileOptions::default().unix_permissions(0o644))?;
                std::io::copy(&mut entry, &mut out)?;
            }
            out.finish()?;
        }
        let restored = read(&rewritten)?;
        assert_eq!(restored.format_version, 1);
        Ok(())
    }

    #[test]
    fn read_handles_foreign_unix_mode_bits() {
        // ZipWriter always adds S_IFREG, so patch the central directory's
        // external-attributes field to store foreign modes directly: plain
        // permission bits must import, bare non-regular type bits must not.
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.zip");
        craft_single_entry(&src);
        let name_len = "notes/2026-01-01.md".len();
        for (mode, accepted) in [(0o644u32, true), (0o170000u32, false)] {
            let mut bytes = fs::read(&src).unwrap();
            let cd = bytes.len() - 22 - (46 + name_len);
            let attrs = cd + 38;
            bytes[attrs..attrs + 4].copy_from_slice(&(mode << 16).to_le_bytes());
            let path = dir.path().join(format!("mode-{mode:o}.zip"));
            fs::write(&path, bytes).unwrap();
            let error = read(&path).err().map(|e| e.to_string()).unwrap_or_default();
            assert_eq!(
                error.contains("Unsafe, duplicate"),
                !accepted,
                "mode {mode:o}: {error}"
            );
        }
    }

    fn craft_single_entry(path: &Path) {
        let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
        zip.start_file("notes/2026-01-01.md", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"a").unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn read_rejects_archives_that_trip_any_single_safety_guard() {
        let craft = |path: &Path, fill: &dyn Fn(&mut ZipWriter<fs::File>)| {
            let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
            fill(&mut zip);
            zip.finish().unwrap();
        };
        let dir = tempfile::tempdir().unwrap();
        let opts = SimpleFileOptions::default();

        // Path escape in the entry name, unique and not a directory.
        craft(&dir.path().join("escape.zip"), &|zip| {
            zip.start_file("../escape.md", opts).unwrap();
            zip.write_all(b"a").unwrap();
        });
        // Safe name and unique, but symlink file-type bits in the unix mode.
        craft(&dir.path().join("symlink.zip"), &|zip| {
            zip.add_symlink("notes/2026-01-02.md", "elsewhere", opts)
                .unwrap();
        });

        for name in ["escape.zip", "symlink.zip"] {
            let error = read(&dir.path().join(name)).expect_err(&format!("{name} is rejected"));
            assert!(
                error.to_string().contains("Unsafe, duplicate"),
                "{name}: {error}"
            );
        }
    }
}
