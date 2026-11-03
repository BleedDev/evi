//! Minimal asar support and the loader archive, ported from src/shared/asar.ts and src/shared/shim.ts.
//! create_shim_asar must produce the same bytes as the TypeScript createShimAsar: scripts/test-installer.ts
//! compares them.
//!
//! Layout: a pickle holding the header size (uint32 4, uint32 headerSize), then the header pickle
//! (uint32 payload size, uint32 JSON length, the JSON padded to 4 bytes), then file contents.
//! File offsets in the header are relative to the end of the header.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

pub const SHIM_MARKER: &str = "// evi-shim";
/// Markers of loaders written before the rename to Evi, so they can be upgraded and uninstalled
pub const LEGACY_SHIM_MARKERS: &[&str] = &["// delight-shim"];
pub const ORIGINAL_ASAR: &str = "_app.asar";

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub fn read_asar_file(asar: &Path, file_path: &str) -> io::Result<String> {
    let mut f = File::open(asar)?;
    let mut sizes = [0u8; 16];
    f.read_exact(&mut sizes)?;
    let header_size = u32::from_le_bytes(sizes[4..8].try_into().unwrap()) as u64;
    let json_length = u32::from_le_bytes(sizes[12..16].try_into().unwrap()) as usize;

    let mut json = vec![0u8; json_length];
    f.read_exact(&mut json)?;
    let header: Value = serde_json::from_slice(&json).map_err(|e| invalid(format!("{} has a broken header: {e}", asar.display())))?;

    let not_found = || invalid(format!("{file_path} not found in {}", asar.display()));
    let entry = file_path.split('/').try_fold(&header, |e, part| e.get("files")?.get(part)).ok_or_else(not_found)?;
    let offset = entry["offset"].as_str().and_then(|s| s.parse().ok()).or_else(|| entry["offset"].as_u64()).ok_or_else(not_found)?;
    let size = entry["size"].as_u64().ok_or_else(not_found)? as usize;

    f.seek(SeekFrom::Start(8 + header_size + offset))?;
    let mut content = vec![0u8; size];
    f.read_exact(&mut content)?;
    Ok(String::from_utf8_lossy(&content).into_owned())
}

/// JSON.stringify for a string
fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

/// Builds a flat asar archive (no folders) from file name -> text content
pub fn create_asar(files: &[(&str, String)]) -> Vec<u8> {
    let mut entries = Vec::new();
    let mut offset = 0usize;
    for (name, data) in files {
        entries.push(format!("{}:{{\"size\":{},\"offset\":\"{}\"}}", js_string(name), data.len(), offset));
        offset += data.len();
    }
    let json = format!("{{\"files\":{{{}}}}}", entries.join(",")).into_bytes();
    let padded = json.len().div_ceil(4) * 4;

    let mut out = Vec::with_capacity(16 + padded + offset);
    out.extend_from_slice(&4u32.to_le_bytes());
    out.extend_from_slice(&((8 + padded) as u32).to_le_bytes());
    out.extend_from_slice(&((4 + padded) as u32).to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.resize(16 + padded, 0);
    for (_, data) in files {
        out.extend_from_slice(data.as_bytes());
    }
    out
}

/// The loader that replaces Discord's app.asar. If the core fails to load, it boots Discord vanilla.
fn create_shim(core_path: &str) -> String {
    let core = js_string(core_path);
    let original = js_string(ORIGINAL_ASAR);
    format!(
        r#"{SHIM_MARKER}
"use strict";
const path = require("path");

// The bundler inlines __dirname at build time, so the core learns its location from us
global.__eviCoreDir = path.dirname({core});
// Evi's and Discord's code compile from a cache after the first start. A short folder: nodejs/node#66438
try {{
    require("module").enableCompileCache(path.join(global.__eviCoreDir, "..", "cc"));
}} catch {{ }}
try {{
    require({core});
}} catch (err) {{
    if (global.__eviLoadedDiscord) throw err;
    console.error("[Evi] Core failed to load, starting Discord without it.", err);
    const {{ app }} = require("electron");
    const asar = path.join(__dirname, "..", {original});
    const pkg = require(path.join(asar, "package.json"));
    require.main.filename = path.join(asar, pkg.main);
    app.setAppPath(asar);
    require(require.main.filename);
}}
"#
    )
}

/// Electron derives the app name (and so the userData folder) from this, so it must mirror Discord's.
/// JSON.stringify({ name: pkg.name ?? "discord", productName: pkg.productName, main: "index.js" }, null, 4)
fn create_shim_package(discord_pkg: &Value) -> String {
    let name = discord_pkg.get("name").filter(|v| !v.is_null()).map_or_else(|| js_string("discord"), Value::to_string);
    let product = discord_pkg.get("productName").map(|p| format!("    \"productName\": {p},\n")).unwrap_or_default();
    format!("{{\n    \"name\": {name},\n{product}    \"main\": \"index.js\"\n}}")
}

pub fn create_shim_asar(core_path: &str, discord_pkg: &Value) -> Vec<u8> {
    create_asar(&[("index.js", create_shim(core_path)), ("package.json", create_shim_package(discord_pkg))])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_the_reader() {
        let dir = std::env::temp_dir().join(format!("evi-asar-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.asar");
        std::fs::write(&path, create_shim_asar("/x/core/main.js", &serde_json::json!({ "name": "discord", "productName": "Discord" }))).unwrap();
        assert!(read_asar_file(&path, "index.js").unwrap().starts_with(SHIM_MARKER));
        let pkg: Value = serde_json::from_str(&read_asar_file(&path, "package.json").unwrap()).unwrap();
        assert_eq!(pkg["main"], "index.js");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
