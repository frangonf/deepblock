pub mod activitywatch;
pub mod audit;
pub mod backlog;
pub mod blocks;
pub mod compare;
pub mod config;
pub mod context;
pub mod health;
pub mod mode;
pub mod modules;
pub mod notes;
pub mod outcomes;
pub mod plans;
pub mod range_review;
pub mod review;
pub mod storage;
pub mod ws;

use axum::{
    Router,
    http::{Method, header},
    routing::{delete, get, patch, post},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::state::AppState;

use crate::request_policy::RequestPolicy;
use std::sync::Arc;

fn local_client_cors_layer(policy: &RequestPolicy) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(policy.origins()))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::CACHE_CONTROL,
            axum::http::HeaderName::from_static(storage::GENERATION_HEADER),
        ])
        .expose_headers([
            header::CONTENT_DISPOSITION,
            axum::http::HeaderName::from_static(storage::GENERATION_HEADER),
        ])
}

async fn validate_local_request(
    axum::extract::State(policy): axum::extract::State<Arc<RequestPolicy>>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|origin| !policy.allows(origin))
    {
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }
    if let Some(host) = request.headers().get(header::HOST) {
        let allowed = host
            .to_str()
            .ok()
            .and_then(|host| host.parse::<axum::http::uri::Authority>().ok())
            .is_some_and(|authority| {
                let host = authority.host().trim_matches(['[', ']']);
                host.eq_ignore_ascii_case("localhost")
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            });
        if !allowed {
            return (StatusCode::FORBIDDEN, "Host not allowed").into_response();
        }
    }
    next.run(request).await
}

pub fn router(state: AppState) -> Router {
    let policy = state.request_policy.clone();
    let dataset_state = state.clone();
    Router::new()
        .route("/storage/status", get(storage::status))
        .route("/storage/export", get(storage::export))
        .route(
            "/storage/import/preview",
            post(storage::preview).layer(axum::extract::DefaultBodyLimit::disable()),
        )
        .route("/storage/import/commit", post(storage::commit))
        .route("/storage/recovery", get(storage::recovery))
        .route("/storage/recovery/preview", post(storage::recovery_preview))
        .route("/", get(health::get_health))
        .route("/health", get(health::get_health))
        .route("/modules", get(modules::capabilities))
        .route("/plan/today", get(plans::get_today_plan))
        .route(
            "/context",
            get(context::get_catalog).put(context::update_catalog),
        )
        .route("/intent/{date}", get(context::get_effective_intent))
        .route("/intent/{date}/history", get(context::get_intents))
        .route("/plan/{date}", get(plans::get_plan_by_date))
        .route("/plan/revise", post(plans::revise_plan))
        .route("/plan/replan", post(plans::replan_batch))
        .route("/plan/undo", post(plans::undo_plan))
        .route("/plan/redo", post(plans::redo_plan))
        .route("/plan/compare", get(compare::compare_plan))
        .route("/blocks/{block_id}/outcome", patch(outcomes::patch_outcome))
        .route("/plan/review", get(review::review_today_plan))
        .route("/review/range", get(range_review::review_range))
        .route("/plan/audit", post(audit::audit_plan))
        .route(
            "/activitywatch/status",
            get(activitywatch::get_activitywatch_status),
        )
        .route(
            "/activitywatch/summary",
            get(activitywatch::get_activitywatch_summary),
        )
        .route("/blocks", post(blocks::add_block))
        .route(
            "/blocks/{block_id}",
            delete(blocks::delete_block).patch(blocks::patch_block),
        )
        .route("/blocks/{block_id}/move", patch(blocks::move_block))
        .route(
            "/blocks/{block_id}/reposition",
            patch(blocks::reposition_block),
        )
        .route(
            "/blocks/{block_id}/artifacts",
            post(blocks::add_artifact).delete(blocks::remove_artifact),
        )
        .route("/notes/ensure", post(notes::ensure_note))
        .route("/notes/{date}", get(notes::get_note).put(notes::save_note))
        .route(
            "/backlog",
            get(backlog::get_backlog).post(backlog::create_backlog_task),
        )
        .route(
            "/backlog/{task_id}",
            patch(backlog::update_backlog_task).delete(backlog::delete_backlog_task),
        )
        .route(
            "/config",
            get(config::get_config).patch(config::patch_config),
        )
        .route("/mode", get(mode::get_mode).post(mode::set_mode))
        .route(
            "/ws/events",
            get(ws::events).route_layer(axum::middleware::from_fn_with_state(
                policy.clone(),
                ws::validate_origin,
            )),
        )
        .layer(axum::middleware::from_fn_with_state(
            dataset_state,
            coordinate_dataset,
        ))
        .layer(local_client_cors_layer(&policy))
        .layer(axum::middleware::from_fn_with_state(
            policy,
            validate_local_request,
        ))
        .with_state(state)
}

async fn coordinate_dataset(
    axum::extract::State(state): axum::extract::State<AppState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    // Long-lived sockets and storage handlers coordinate their own lifetime.
    if request.uri().path().starts_with("/storage/") || request.uri().path() == "/ws/events" {
        return next.run(request).await;
    }
    let permit = Arc::new(state.maintenance.clone().read_owned().await);
    crate::state::REQUEST_PERMIT
        .scope(permit, async {
            if state
                .storage_unavailable
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Storage recovery required; restart the backend",
                )
                    .into_response();
            }
            let generation = match state.io(|s| s.planning_store()?.generation()).await {
                Ok(value) => value,
                Err(error) => return error.into_response(),
            };
            if !matches!(
                *request.method(),
                Method::GET | Method::HEAD | Method::OPTIONS
            ) {
                let provided = request
                    .headers()
                    .get(storage::GENERATION_HEADER)
                    .and_then(|v| v.to_str().ok());
                if provided.is_none() {
                    return (
                        StatusCode::PRECONDITION_REQUIRED,
                        "Dataset generation required; update your client",
                    )
                        .into_response();
                }
                if provided != Some(generation.as_str()) {
                    return (
                        StatusCode::CONFLICT,
                        "Dataset changed; reload before saving",
                    )
                        .into_response();
                }
            }
            let mut response = next.run(request).await;
            if let Ok(value) = generation.parse() {
                response
                    .headers_mut()
                    .insert(storage::GENERATION_HEADER, value);
            }
            response
        })
        .await
}
