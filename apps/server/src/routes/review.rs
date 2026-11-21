use axum::{
    Json,
    extract::{Query, State},
};
use serde::Deserialize;

use crate::{
    error::AppResult,
    models::{PlanReviewResponse, today_string, validate_date_param},
    review,
    state::AppState,
};

#[derive(Debug, Default, Deserialize)]
pub struct ReviewQuery {
    date: Option<String>,
}

pub async fn review_today_plan(
    State(state): State<AppState>,
    Query(query): Query<ReviewQuery>,
) -> AppResult<Json<PlanReviewResponse>> {
    let date = match query.date {
        Some(date) => {
            validate_date_param(&date)?;
            date
        }
        None => today_string(),
    };

    let plan = state.load_plan_async(&date).await?;
    Ok(Json(review::review_plan(&plan)))
}
