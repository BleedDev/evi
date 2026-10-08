//! Evi's releases on GitHub. The installer doesn't carry Evi itself: it downloads the release's
//! evi-core.json (the core and official plugins, what the CLI embeds as dist/embed.json) and checks it
//! against evi-core.json.sha256, the same scheme as src/cli/update.ts.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};

pub const REPO: &str = "BleedDev/evi";
pub const CORE_ASSET: &str = "evi-core.json";
pub const CHECKSUM_ASSET: &str = "evi-core.json.sha256";
const MAX_CORE_BYTES: u64 = 64 * 1024 * 1024;

/// Everything an install lays down. retired lists official plugins that became part of Evi itself.
#[derive(Deserialize)]
pub struct CorePayload {
    pub version: String,
    pub core: BTreeMap<String, String>,
    pub plugins: BTreeMap<String, BTreeMap<String, String>>,
    #[serde(default)]
    pub retired: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Release {
    pub tag: String,
    pub version: String,
    pub core_url: Option<String>,
    pub checksum_url: Option<String>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

/// evi.rest's mirror of GitHub's release API: same paths and JSON, without GitHub's 60 calls an hour per address
pub const MIRROR_API: &str = "https://evi.rest/v1/github";
pub const GITHUB_API: &str = "https://api.github.com";

/// Where to ask for releases, in order: evi.rest's mirror, then GitHub itself. EVI_UPDATE_API alone
/// when set: tests serve fake releases from a local server. Like releaseApis in src/shared/release.ts.
fn apis_for(overridden: Option<&str>) -> Vec<String> {
    match overridden.map(|s| s.trim().trim_end_matches('/')).filter(|s| !s.is_empty()) {
        Some(api) => vec![api.to_string()],
        None => vec![MIRROR_API.to_string(), GITHUB_API.to_string()],
    }
}

fn apis() -> Vec<String> {
    apis_for(std::env::var("EVI_UPDATE_API").ok().as_deref())
}

fn agent(timeout: u64) -> ureq::Agent {
    let tls = ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_global(Some(Duration::from_secs(timeout)))
        .http_status_as_error(false)
        .user_agent("evi-installer")
        .build()
        .into()
}

fn host(url: &str) -> &str {
    url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or(url)
}

fn get(url: &str, timeout: u64) -> Result<ureq::http::Response<ureq::Body>, String> {
    agent(timeout)
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Couldn’t reach {}: {e}", host(url)))
}

/// "v1.2.3-beta.1+build" -> "1.2.3-beta.1", like cleanVersion in src/shared/release.ts
pub fn clean_version(tag: &str) -> String {
    let t = tag.trim();
    let t = t.strip_prefix('v').or_else(|| t.strip_prefix('V')).unwrap_or(t);
    t.split('+').next().unwrap_or("").to_string()
}

/// GETs `<api>/repos/BleedDev/evi/<path>` from each API in turn, moving on to the next when one can't
/// be reached, times out or answers 5xx. Anything else (a release, a 404, GitHub's 403) is the answer.
fn get_release_api(apis: &[String], path: &str) -> Result<ureq::http::Response<ureq::Body>, String> {
    let mut failure = String::from("No release API to ask");
    for (i, api) in apis.iter().enumerate() {
        let last = i + 1 == apis.len();
        match get(&format!("{api}/repos/{REPO}/{path}"), 15) {
            Ok(res) if res.status().as_u16() < 500 || last => return Ok(res),
            Ok(res) => failure = format!("{} answered {}", host(api), res.status().as_u16()),
            Err(e) => failure = e,
        }
    }
    Err(failure)
}

fn fetch_from(apis: &[String], path: &str) -> Result<Option<Release>, String> {
    let mut res = get_release_api(apis, path)?;
    let status = res.status().as_u16();
    if status == 404 {
        return Ok(None);
    }
    if status == 403 || status == 429 {
        return Err("GitHub’s rate limit was hit. Try again in a few minutes.".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("GitHub answered {status}"));
    }
    let body = res.body_mut().with_config().limit(4 * 1024 * 1024).read_to_vec().map_err(|e| format!("Couldn’t read GitHub’s answer: {e}"))?;
    let data: GitHubRelease = serde_json::from_slice(&body).map_err(|e| format!("GitHub’s answer didn’t make sense: {e}"))?;
    if data.draft {
        return Ok(None);
    }
    let asset = |name: &str| data.assets.iter().find(|a| a.name == name).map(|a| a.browser_download_url.clone());
    Ok(Some(Release { version: clean_version(&data.tag_name), core_url: asset(CORE_ASSET), checksum_url: asset(CHECKSUM_ASSET), tag: data.tag_name }))
}

/// The latest published release, or None if nothing has been published yet. Drafts and prereleases never show up here.
pub fn latest() -> Result<Option<Release>, String> {
    fetch_from(&apis(), "releases/latest")
}

fn download(url: &str, max: u64, timeout: u64) -> Result<Vec<u8>, String> {
    let mut res = get(url, timeout)?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("Download failed: {status} ({url})"));
    }
    res.body_mut().with_config().limit(max).read_to_vec().map_err(|e| format!("Download interrupted: {e}"))
}

pub fn has_core(release: &Release) -> bool {
    release.core_url.is_some() && release.checksum_url.is_some()
}

/// Downloads a release's evi-core.json and checks it against the published SHA-256
pub fn download_core(release: &Release, on_verify: impl FnOnce()) -> Result<CorePayload, String> {
    let (Some(core_url), Some(checksum_url)) = (&release.core_url, &release.checksum_url) else {
        return Err(format!("Release {} doesn’t include {CORE_ASSET}", release.tag));
    };
    let checksum_text = String::from_utf8_lossy(&download(checksum_url, 4096, 30)?).into_owned();
    let expected = checksum_text
        .split(|c: char| !c.is_ascii_hexdigit())
        .find(|word| word.len() == 64)
        .map(str::to_lowercase)
        .ok_or_else(|| format!("{CHECKSUM_ASSET} doesn’t contain a SHA-256 hash"))?;
    let bytes = download(core_url, MAX_CORE_BYTES, 10 * 60)?;
    on_verify();
    let actual = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if actual != expected {
        return Err("The download doesn’t match the release’s checksum. Nothing was changed.".into());
    }
    parse_core(&bytes)
}

pub fn parse_core(bytes: &[u8]) -> Result<CorePayload, String> {
    let payload: CorePayload = serde_json::from_slice(bytes).map_err(|e| format!("{CORE_ASSET} is broken: {e}"))?;
    if !payload.core.contains_key("main.js") {
        return Err(format!("{CORE_ASSET} has no main.js"));
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_tags() {
        assert_eq!(clean_version("v1.2.3-beta.1+x"), "1.2.3-beta.1");
    }

    #[test]
    fn asks_the_mirror_then_github_unless_overridden() {
        assert_eq!(apis_for(None), vec![MIRROR_API.to_string(), GITHUB_API.to_string()]);
        assert_eq!(apis_for(Some("")), vec![MIRROR_API.to_string(), GITHUB_API.to_string()]);
        assert_eq!(apis_for(Some("http://127.0.0.1:9/api/")), vec!["http://127.0.0.1:9/api".to_string()]);
    }

    /// A local HTTP server answering `times` requests with one status and body
    fn serve(status: u16, body: &'static str, times: usize) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(times) {
                let mut stream = stream.unwrap();
                let (mut buf, mut req) = ([0u8; 4096], Vec::new());
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    req.extend_from_slice(&buf[..n]);
                }
                let res = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(res.as_bytes()).unwrap();
            }
        });
        format!("http://{addr}")
    }

    /// An address nothing listens on
    fn closed() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    }

    const RELEASE: &str = r#"{"tag_name":"v0.6.0","draft":false,"assets":[{"name":"evi-core.json","browser_download_url":"https://x/evi-core.json"},{"name":"evi-core.json.sha256","browser_download_url":"https://x/evi-core.json.sha256"}]}"#;

    #[test]
    fn falls_back_to_github_when_the_mirror_fails() {
        // A 5xx from the mirror: GitHub answers
        let release = fetch_from(&[serve(502, "{}", 1), serve(200, RELEASE, 1)], "releases/latest").unwrap().unwrap();
        assert_eq!(release.version, "0.6.0");
        assert!(has_core(&release));
        // The mirror can't be reached
        assert_eq!(fetch_from(&[closed(), serve(200, RELEASE, 1)], "releases/latest").unwrap().unwrap().tag, "v0.6.0");
        // A 404 is an answer: nothing published, and GitHub (unreachable here) isn't asked
        assert!(fetch_from(&[serve(404, r#"{"message":"Not Found"}"#, 1), closed()], "releases/latest").unwrap().is_none());
        // Both failing says what the last one answered
        assert_eq!(fetch_from(&[serve(503, "{}", 1), serve(500, "{}", 1)], "releases/latest").unwrap_err(), "GitHub answered 500");
        assert!(fetch_from(&[serve(503, "{}", 1), closed()], "releases/latest").unwrap_err().starts_with("Couldn’t reach 127.0.0.1"));
    }
}
