use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use thiserror::Error;
use tracing::error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("TOML deserialize error: {0}")]
    TomlDeserialize(#[from] toml::de::Error),
    #[error("TOML serialize error: {0}")]
    TomlSerialize(#[from] toml::ser::Error),
    #[error("HTTP client error: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("Address parse error: {0}")]
    AddrParse(#[from] std::net::AddrParseError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, detail) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, json!(message)),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, json!(message)),
            Self::Conflict(message) => (StatusCode::CONFLICT, json!(message)),
            other => {
                // Never leak internal failure details (filesystem paths,
                // upstream hosts, parse internals) to clients; log them for
                // local diagnosis instead.
                error!(error = %other, "internal error while handling request");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!("Internal server error"),
                )
            }
        };

        (status, Json(json!({ "detail": detail }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn response_body(response: Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .expect("body should be readable");
        String::from_utf8(bytes.to_vec()).expect("body should be utf-8")
    }

    #[tokio::test]
    async fn internal_errors_return_generic_detail() {
        let io_error = std::fs::read_to_string("/nonexistent/deepblock/missing.json").unwrap_err();
        let response = AppError::from(io_error).into_response();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        let body = response_body(response).await;
        assert_eq!(body, "{\"detail\":\"Internal server error\"}");
    }

    #[tokio::test]
    async fn bad_request_keeps_its_message() {
        let response = AppError::BadRequest("Invalid time '99:99'".to_string()).into_response();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = response_body(response).await;
        assert_eq!(body, "{\"detail\":\"Invalid time '99:99'\"}");
    }

    #[tokio::test]
    async fn not_found_keeps_its_message() {
        let response = AppError::NotFound("Block 'x' was not found".to_string()).into_response();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body = response_body(response).await;
        assert_eq!(body, "{\"detail\":\"Block 'x' was not found\"}");
    }
}
