use crate::{
    error::AppResult,
    range_review::{self, RangeReview},
    state::AppState,
};
use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct RangeQuery {
    start: String,
    end: String,
}

pub async fn review_range(
    State(state): State<AppState>,
    Query(query): Query<RangeQuery>,
) -> AppResult<Json<RangeReview>> {
    range_review::validate_range(&query.start, &query.end)?;
    Ok(Json(
        state
            .io(move |s| {
                let plans = s.planning_store()?.days_between(&query.start, &query.end)?;
                range_review::summarize(&plans, &query.start, &query.end)
            })
            .await?,
    ))
}
