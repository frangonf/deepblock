//! The backend always validates loopback Host authorities. Development may
//! additionally admit exact browser origins, without trusting proxy headers.
use axum::http::HeaderValue;

use crate::error::{AppError, AppResult};

const LOCAL_ORIGINS: [&str; 7] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

#[derive(Clone, Debug)]
pub struct RequestPolicy {
    origins: Vec<HeaderValue>,
}

impl Default for RequestPolicy {
    fn default() -> Self {
        Self {
            origins: LOCAL_ORIGINS
                .into_iter()
                .map(HeaderValue::from_static)
                .collect(),
        }
    }
}

impl RequestPolicy {
    pub fn from_environment() -> AppResult<Self> {
        match std::env::var("DEEPBLOCK_DEV_ORIGINS") {
            Ok(origins) => {
                if std::env::var("DEEPBLOCK_DEV_MODE").as_deref() != Ok("1") {
                    return Err(AppError::BadRequest("DEEPBLOCK_DEV_ORIGINS requires DEEPBLOCK_DEV_MODE=1; do not expose an unauthenticated production backend".into()));
                }
                Self::development(&origins)
            }
            Err(std::env::VarError::NotPresent) => Ok(Self::default()),
            Err(error) => Err(AppError::BadRequest(format!(
                "Invalid DEEPBLOCK_DEV_ORIGINS: {error}"
            ))),
        }
    }

    pub fn development(origins: &str) -> AppResult<Self> {
        let mut policy = Self::default();
        for origin in origins.split(',') {
            let origin = origin.trim();
            let invalid = || {
                AppError::BadRequest(format!(
                    "Invalid development origin {origin:?}: expected an exact http(s) origin without credentials, path, query, wildcard, or fragment"
                ))
            };
            let url = reqwest::Url::parse(origin).map_err(|_| invalid())?;
            if !matches!(url.scheme(), "http" | "https")
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || url.port() == Some(0)
                || url.host_str().is_none_or(|host| host.contains('*'))
                || url.origin().ascii_serialization() != origin
            {
                return Err(invalid());
            }
            let header = HeaderValue::from_str(origin).map_err(|_| invalid())?;
            if !policy.origins.contains(&header) {
                policy.origins.push(header);
            }
        }
        Ok(policy)
    }

    pub fn allows(&self, origin: &HeaderValue) -> bool {
        self.origins.contains(origin)
    }

    pub fn origins(&self) -> Vec<HeaderValue> {
        self.origins.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_origins_are_exact_and_keep_local_clients() {
        let policy = RequestPolicy::development("http://devbox.lan:5173,http://192.168.1.20:5173")
            .expect("policy");
        assert!(policy.allows(&HeaderValue::from_static("http://devbox.lan:5173")));
        assert!(policy.allows(&HeaderValue::from_static("tauri://localhost")));
        assert!(!policy.allows(&HeaderValue::from_static("http://devbox.lan.evil:5173")));
        assert!(!policy.allows(&HeaderValue::from_static("http://devbox.lan:5174")));
    }

    #[test]
    fn rejects_ambiguous_or_unsafe_origin_configuration() {
        for origin in [
            "",
            "*",
            "null",
            "http://*.lan:5173",
            "http://user:password@devbox:5173",
            "http://devbox:5173/path",
            "http://devbox:5173/",
            "http://devbox:5173?x=1",
            "http://devbox:5173#x",
            "ftp://devbox:5173",
            "http://devbox:0",
        ] {
            assert!(RequestPolicy::development(origin).is_err(), "{origin}");
        }
    }
}
