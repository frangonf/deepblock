use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

pub async fn request(
    app: &Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        let status = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            app.clone().oneshot(
                Request::builder()
                    .uri("/storage/status")
                    .body(Body::empty())
                    .unwrap(),
            ),
        )
        .await
        .expect("status probe must not hang")
        .unwrap();
        let bytes = status.into_body().collect().await.unwrap().to_bytes();
        let status: Value = serde_json::from_slice(&bytes).unwrap();
        builder = builder.header(
            "x-deepblock-dataset-generation",
            status["generation"].as_str().unwrap(),
        );
    }
    let body = match body {
        Some(body) => {
            builder = builder.header("content-type", "application/json");
            Body::from(body.to_string())
        }
        None => Body::empty(),
    };
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        app.clone().oneshot(builder.body(body).expect("request")),
    )
    .await
    .expect("request must not hang")
    .expect("response");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
