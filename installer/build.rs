fn main() {
    // Both frontends use package.json, not Cargo.toml's placeholder version
    println!("cargo:rerun-if-changed=../package.json");
    let pkg: serde_json::Value = serde_json::from_str(include_str!("../package.json")).unwrap();
    println!("cargo:rustc-env=EVI_SETUP_VERSION={}", pkg["version"].as_str().unwrap());
    #[cfg(feature = "gui")]
    tauri_build::build();
}
