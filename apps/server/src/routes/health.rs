use axum::Json;

use crate::models::HealthResponse;

pub async fn get_health() -> Json<HealthResponse> {
    Json(HealthResponse {
        service: "deepblock".to_string(),
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}
